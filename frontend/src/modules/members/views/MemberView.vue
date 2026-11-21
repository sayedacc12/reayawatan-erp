<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api, openProtectedFile, token } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import MemberCard from '../components/MemberCard.vue';
import PersonForm from '../components/PersonForm.vue';
import StatusPill from '../components/StatusPill.vue';
import { CHANNELS, HISTORY_LABEL, P, VOUCHER_STATUS, copy, fmtDate, fmtDateTime, loadLookups, lookups, publicUrl, sar, whatsappLink, type CardData } from '../lib';
import '../../../shared/module.css';
import '../members.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const m = ref<any>(null);
const error = ref('');
const busy = ref(false);
const editing = ref(false);
const tab = ref<'data' | 'statement' | 'history'>('data');
const previews = ref<Record<string, string>>({});
const form = ref<InstanceType<typeof PersonForm> | null>(null);
const card = ref<CardData | null>(null);
const showCard = ref(false);
const dialog = ref<null | 'status' | 'type' | 'notice'>(null);
const d = ref({ status: 'suspended', typeCode: '', note: '', channel: 'whatsapp', message: '' });

const canEdit = computed(() => session.can(P.members));
const canPay = computed(() => session.can(P.payments));

async function loadPreviews() {
  Object.values(previews.value).forEach((u) => URL.revokeObjectURL(u));
  previews.value = {};
  for (const doc of m.value?.documents ?? []) {
    if (!doc.mime.startsWith('image/')) continue;
    try {
      const res = await fetch(`/api/members/members/${props.id}/documents/${doc.key}`, { headers: { Authorization: `Bearer ${token.get()}` } });
      if (res.ok) previews.value[doc.key] = URL.createObjectURL(await res.blob());
    } catch { /* المعاينة اختيارية */ }
  }
}
async function load() {
  try {
    m.value = await api(`/members/members/${props.id}`);
    await loadPreviews();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await loadLookups().catch(() => null);
  await load();
});
onBeforeUnmount(() => Object.values(previews.value).forEach((u) => URL.revokeObjectURL(u)));

async function run(fn: () => Promise<unknown>, ok: string) {
  busy.value = true;
  try {
    await fn();
    toast.success(ok);
    dialog.value = null;
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function save(data: Record<string, unknown>) {
  busy.value = true;
  try {
    m.value = await api(`/members/members/${props.id}`, { method: 'PATCH', json: data });
    editing.value = false;
    toast.success('حُفظت بيانات العضو');
  } catch (e) {
    form.value?.setError((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const setStatus = () => run(async () => {
  m.value = await api(`/members/members/${props.id}/status`, { method: 'POST', json: { status: d.value.status, note: d.value.note.trim() || null } });
}, 'حُدثت حالة العضوية');
const changeType = () => run(async () => {
  m.value = await api(`/members/members/${props.id}/type`, { method: 'POST', json: { typeCode: d.value.typeCode, note: d.value.note.trim() || null } });
}, 'تغير نوع العضوية');
const logNotice = () => run(async () => {
  await api(`/members/members/${props.id}/notices`, { method: 'POST', json: { channel: d.value.channel, message: d.value.message } });
  await load();
}, 'سُجل التنبيه');
function openDialog(kind: 'status' | 'type' | 'notice') {
  d.value = { status: m.value.status === 'suspended' || m.value.status === 'terminated' ? 'active' : 'suspended', typeCode: '', note: '', channel: 'whatsapp', message: '' };
  if (kind === 'notice') d.value.message = `السلام عليكم ${m.value.fullName}، `;
  dialog.value = kind;
}
async function renew() {
  busy.value = true;
  try {
    const r = await api<{ invoiceId: string | null; created: boolean; extended: boolean }>(`/members/members/${props.id}/renewal`, { method: 'POST' });
    toast.success(r.extended ? 'جُددت العضوية (النوع بدون اشتراك)' : r.created ? 'أُصدرت مطالبة التجديد' : 'توجد مطالبة تجديد مفتوحة بالفعل');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function upload(key: string, ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  busy.value = true;
  try {
    m.value = await api(`/members/members/${props.id}/documents/${key}`, { method: 'POST', body: fd });
    await loadPreviews();
    toast.success('رُفع المستند');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
    (ev.target as HTMLInputElement).value = '';
  }
}
const openDoc = (key: string) => openProtectedFile(`/members/members/${props.id}/documents/${key}`).catch((e) => toast.error((e as Error).message));
async function openCard() {
  try {
    card.value = await api<CardData>(`/members/members/${props.id}/card`);
    showCard.value = true;
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function printCard() {
  document.body.classList.add('mb-printing');
  window.print();
  setTimeout(() => document.body.classList.remove('mb-printing'), 300);
}
async function copyPay(t: string) {
  if (await copy(publicUrl(`/m/pay/${t}`))) toast.success('نُسخ رابط السداد');
}
const docList = computed(() => {
  const req = (lookups.value?.documents ?? []).filter((x) => x.isActive);
  const keys = new Set([...req.map((x) => x.key), ...(m.value?.documents ?? []).map((x: any) => x.key)]);
  return [...keys].map((k) => ({ key: k, name: req.find((x) => x.key === k)?.name ?? m.value.documents.find((x: any) => x.key === k)?.name ?? k, doc: m.value.documents.find((x: any) => x.key === k) ?? null }));
});
const openInvoice = computed(() => m.value?.statement.find((s: any) => s.status === 'unpaid' && s.kind === 'renewal'));
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="m">
      <section class="pm-hero mb-hero">
        <div>
          <p class="pm-kicker">عضو رقم <span class="mb-code">{{ m.memberNo }}</span> · {{ m.source === 'direct' ? `أضافه ${m.createdByName ?? 'موظف'}` : 'انضم بطلب عضوية' }}</p>
          <h1>{{ m.fullName }}</h1>
          <p class="pm-sub">{{ m.typeName }} · عضو منذ {{ fmtDate(m.joinedOn) }} · العضوية الحالية حتى {{ fmtDate(m.endDate) }}
            <template v-if="m.daysLeft >= 0"> (بعد {{ m.daysLeft }} يوم)</template><template v-else> (انتهت منذ {{ -m.daysLeft }} يوم)</template></p>
        </div>
        <div class="pm-actions">
          <StatusPill :status="m.status" :label="m.statusLabel" />
          <button class="btn mb-glow" @click="openCard">بطاقة العضوية</button>
          <button v-if="canPay && !openInvoice && m.status !== 'terminated'" class="btn mb-ghost" :disabled="busy" @click="renew">إصدار مطالبة تجديد</button>
          <a v-if="m.mobile" class="btn mb-ghost" :href="whatsappLink(m.mobile, `السلام عليكم ${m.fullName}`)" target="_blank" rel="noopener">واتساب</a>
        </div>
      </section>

      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #10b981; --i: 0"><span>إجمالي المسدد</span><strong>{{ sar(m.totals.paid) }}</strong><small>{{ m.totals.years }} اشتراك مسدد</small></div>
        <div class="pm-kpi" style="--a: #f59e0b; --i: 1"><span>مطالبات مفتوحة</span><strong>{{ sar(m.totals.open) }}</strong><small>بانتظار السداد أو التأكيد</small></div>
        <div class="pm-kpi" style="--a: #1e3a8a; --i: 2"><span>حق التصويت</span><strong>{{ m.voting ? 'له حق' : 'ليس بعد' }}</strong><small>{{ m.voting ? 'يُحتسب في النصاب' : m.votingNote ?? '' }}</small></div>
        <div class="pm-kpi" style="--a: #0ea5e9; --i: 3"><span>آخر تنبيه</span><strong>{{ m.notices[0] ? fmtDate(m.notices[0].createdAt) : '—' }}</strong><small>{{ m.notices.length }} تنبيه مسجل</small></div>
      </div>

      <div v-if="m.statusNote && (m.status === 'suspended' || m.status === 'terminated')" class="alert alert-error">{{ m.statusLabel }}: {{ m.statusNote }}</div>

      <div class="mb-tabs">
        <button :class="['mb-tab', { on: tab === 'data' }]" @click="tab = 'data'">البيانات والمستندات</button>
        <button :class="['mb-tab', { on: tab === 'statement' }]" @click="tab = 'statement'">كشف الاشتراكات ({{ m.statement.length }})</button>
        <button :class="['mb-tab', { on: tab === 'history' }]" @click="tab = 'history'">السجل والتنبيهات</button>
      </div>

      <div v-if="editing && lookups" class="card pm-panel">
        <h2>تعديل بيانات العضو</h2>
        <PersonForm ref="form" mode="member" :types="lookups.types" :nationalities="lookups.nationalities" :fields="lookups.applicationFields" :initial="m" :busy="busy"
          submit-label="حفظ" @submit="save" @cancel="editing = false" />
      </div>

      <div v-if="tab === 'data'" class="mb-grid">
        <section class="card pm-panel">
          <h2>البيانات الشخصية
            <span v-if="canEdit" style="margin-inline-start: auto; display: inline-flex; gap: 6px">
              <button class="btn btn-sm" @click="editing = true">تعديل</button>
              <button class="btn btn-sm" @click="openDialog('type')">تغيير النوع</button>
              <button class="btn btn-sm" @click="openDialog('status')">{{ m.status === 'suspended' || m.status === 'terminated' ? 'إعادة التفعيل' : 'إيقاف أو إنهاء' }}</button>
            </span>
          </h2>
          <dl class="pm-dl">
            <dt>رقم الهوية</dt><dd class="mb-code">{{ m.nationalId }}</dd>
            <dt>انتهاء الهوية</dt><dd>{{ fmtDate(m.idExpiry) }}</dd>
            <dt>الجنسية</dt><dd>{{ m.nationality }}</dd>
            <dt>الجنس</dt><dd>{{ m.gender === 'female' ? 'أنثى' : 'ذكر' }}</dd>
            <dt>تاريخ الميلاد</dt><dd>{{ fmtDate(m.birthDate) }}</dd>
            <dt>الجوال</dt><dd class="mb-code">{{ m.mobile }}</dd>
            <dt>البريد</dt><dd class="mb-code">{{ m.email ?? '—' }}</dd>
            <dt>المدينة</dt><dd>{{ m.city ?? '—' }}</dd>
            <dt>العنوان</dt><dd>{{ m.address ?? '—' }}</dd>
            <dt>المهنة وجهة العمل</dt><dd>{{ [m.occupation, m.employer].filter(Boolean).join(' · ') || '—' }}</dd>
            <dt>المؤهل</dt><dd>{{ m.qualification ?? '—' }}</dd>
            <template v-for="f in lookups?.applicationFields ?? []" :key="f.key"><dt>{{ f.label }}</dt><dd>{{ m.answers[f.key] === true ? 'نعم' : m.answers[f.key] === false ? 'لا' : m.answers[f.key] ?? '—' }}</dd></template>
            <dt>طلب العضوية</dt><dd><RouterLink v-if="m.application" :to="`/members/applications/${m.application.id}`" class="pm-link">{{ m.application.applicationNo }}</RouterLink><span v-else>—</span></dd>
          </dl>
        </section>
        <section class="card pm-panel">
          <h2>المستندات وصورة الهوية</h2>
          <div v-for="x in docList" :key="x.key" class="doc">
            <img v-if="previews[x.key]" :src="previews[x.key]" alt="" @click="openDoc(x.key)" />
            <span v-else class="ph" @click="x.doc && openDoc(x.key)">{{ x.doc ? 'PDF' : '—' }}</span>
            <span style="flex: 1"><b>{{ x.name }}</b><small class="pm-muted" style="display: block">{{ x.doc ? `${x.doc.fileName} · ${fmtDate(x.doc.uploadedAt)}` : 'لم يُرفع بعد' }}</small></span>
            <label v-if="canEdit" class="btn btn-sm">{{ x.doc ? 'استبدال' : 'رفع' }}<input type="file" hidden accept="image/jpeg,image/png,application/pdf" :disabled="busy" @change="upload(x.key, $event)" /></label>
          </div>
          <p v-if="m.type?.benefits" class="pm-muted" style="white-space: pre-line"><b>مزايا {{ m.typeName }}:</b> {{ m.type.benefits }}</p>
        </section>
      </div>

      <section v-else-if="tab === 'statement'" class="card pm-panel">
        <h2>كشف اشتراكات العضو</h2>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>المطالبة</th><th>النوع</th><th>الفترة</th><th>المبلغ</th><th>السداد</th><th>سند القبض</th><th>الحالة</th></tr></thead>
            <tbody>
              <tr v-for="s in m.statement" :key="s.id" class="mb-row" @click="$router.push(`/members/invoices/${s.id}`)">
                <td class="mb-code">{{ s.invoiceNo }}<span class="pm-muted" style="display: block">{{ fmtDate(s.createdAt) }}</span></td>
                <td>{{ s.kindLabel }}</td>
                <td>{{ s.periodStart ? `${fmtDate(s.periodStart)} - ${fmtDate(s.periodEnd)}` : '—' }}</td>
                <td><b>{{ sar(s.amount) }}</b></td>
                <td>{{ s.paidOn ? `${fmtDate(s.paidOn)} · ${s.methodLabel}` : `يستحق ${fmtDate(s.dueDate)}` }}</td>
                <td>
                  <span v-if="s.voucher" class="mb-code">#{{ s.voucher.serial }} · {{ VOUCHER_STATUS[s.voucher.status] ?? s.voucher.status }}</span>
                  <span v-else-if="s.voucherError" class="pm-viol" :title="s.voucherError">لم يُنشأ</span>
                  <span v-else class="pm-muted">—</span>
                </td>
                <td><StatusPill :status="s.status" :label="s.statusLabel" />
                  <button v-if="s.payToken" class="btn btn-sm" style="margin-inline-start: 6px" @click.stop="copyPay(s.payToken)">نسخ رابط السداد</button></td>
              </tr>
              <tr v-if="!m.statement.length"><td colspan="7" class="pm-empty">لا توجد مطالبات لهذا العضو</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <div v-else class="mb-grid">
        <section class="card pm-panel">
          <h2>سجل العضوية</h2>
          <ul class="mb-log">
            <li v-for="(h, i) in m.history" :key="i" :style="{ '--c': h.action === 'suspended' || h.action === 'terminated' ? '#ef4444' : '#0f766e' }">
              <b>{{ HISTORY_LABEL[h.action] ?? h.action }}</b> · {{ h.byName }} · <span class="pm-muted">{{ fmtDateTime(h.at) }}</span>
              <div v-if="h.note">{{ h.note }}</div>
            </li>
          </ul>
        </section>
        <section class="card pm-panel">
          <h2>التنبيهات المرسلة <button v-if="canEdit" class="btn btn-sm" style="margin-inline-start: auto" @click="openDialog('notice')">تسجيل تنبيه</button></h2>
          <p v-if="!m.notices.length" class="mb-empty">لم يُسجل أي تنبيه</p>
          <ul class="mb-log">
            <li v-for="n in m.notices" :key="n.id" style="--c: #0ea5e9">
              <b>{{ CHANNELS[n.channel] ?? n.channel }}</b> · {{ n.sentByName ?? 'النظام' }} · <span class="pm-muted">{{ fmtDateTime(n.createdAt) }} · قبل الانتهاء بـ {{ n.daysLeft }} يوم</span>
              <div class="mb-pre">{{ n.message }}</div>
            </li>
          </ul>
        </section>
      </div>
    </template>

    <div v-if="dialog && m" class="modal-backdrop" @click.self="dialog = null">
      <div class="card modal">
        <template v-if="dialog === 'status'">
          <h2>حالة العضوية</h2>
          <label class="field"><span>الحالة الجديدة</span>
            <select v-model="d.status" class="input">
              <option v-if="m.status === 'suspended' || m.status === 'terminated'" value="active">إعادة التفعيل</option>
              <option v-if="m.status !== 'suspended'" value="suspended">إيقاف مؤقت</option>
              <option v-if="m.status !== 'terminated'" value="terminated">إنهاء العضوية بقرار</option>
            </select></label>
          <label class="field"><span>السبب {{ d.status === 'active' ? '(اختياري)' : '*' }}</span><textarea v-model="d.note" class="input" rows="3" placeholder="مثل: قرار مجلس الإدارة رقم ..." /></label>
          <div class="modal-actions"><button class="btn" @click="dialog = null">إلغاء</button><button class="btn btn-primary" :disabled="busy" @click="setStatus">حفظ</button></div>
        </template>
        <template v-else-if="dialog === 'type'">
          <h2>تغيير نوع العضوية</h2>
          <p class="pm-muted">يسري النوع الجديد من الآن، ويُطبق اشتراكه في التجديد القادم.</p>
          <label class="field"><span>النوع الجديد</span>
            <select v-model="d.typeCode" class="input"><option value="">اختر</option><option v-for="t in lookups?.types.filter((x) => x.isActive && x.code !== m.typeCode)" :key="t.code" :value="t.code">{{ t.name }} · {{ sar(t.fee) }}</option></select></label>
          <label class="field"><span>ملاحظة</span><input v-model="d.note" class="input" /></label>
          <div class="modal-actions"><button class="btn" @click="dialog = null">إلغاء</button><button class="btn btn-primary" :disabled="busy || !d.typeCode" @click="changeType">حفظ</button></div>
        </template>
        <template v-else>
          <h2>تسجيل تنبيه للعضو</h2>
          <label class="field"><span>الوسيلة</span><select v-model="d.channel" class="input"><option v-for="(l, k) in CHANNELS" v-show="k !== 'auto'" :key="k" :value="k">{{ l }}</option></select></label>
          <label class="field"><span>نص التنبيه</span><textarea v-model="d.message" class="input" rows="5" /></label>
          <div class="modal-actions">
            <button class="btn" @click="dialog = null">إلغاء</button>
            <a v-if="d.channel === 'whatsapp'" class="btn" :href="whatsappLink(m.mobile, d.message)" target="_blank" rel="noopener">فتح واتساب</a>
            <button class="btn btn-primary" :disabled="busy" @click="logNotice">تسجيل</button>
          </div>
        </template>
      </div>
    </div>

    <div v-if="showCard && card" class="modal-backdrop" @click.self="showCard = false">
      <div class="card modal" style="max-width: 460px">
        <h2>بطاقة العضوية</h2>
        <div class="mb-print-area"><MemberCard :card="card" :photo="previews.photo ?? null" /></div>
        <p class="pm-muted" style="font-size: .8rem">يتحقق أي شخص من البطاقة برمزها في صفحة <span class="mb-code">{{ publicUrl('/m/verify') }}</span></p>
        <div class="modal-actions"><button class="btn" @click="showCard = false">إغلاق</button><button class="btn btn-primary" @click="printCard">طباعة</button></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.doc { display: flex; gap: 12px; align-items: center; padding: 8px; border: 1px solid var(--border); border-radius: 12px; margin-bottom: 8px; }
.doc img, .doc .ph { width: 96px; height: 62px; object-fit: cover; border-radius: 8px; background: var(--surface-2); display: grid; place-items: center; font-weight: 700; color: var(--muted); cursor: pointer; }
h2 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
</style>

<style>
@media print {
  body.mb-printing * { visibility: hidden; }
  body.mb-printing .mb-print-area, body.mb-printing .mb-print-area * { visibility: visible; }
  body.mb-printing .mb-print-area { position: fixed; inset: 0 auto auto 0; width: 86mm; }
}
</style>
