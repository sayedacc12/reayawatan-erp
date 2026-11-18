<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, openProtectedFile } from '../../../api';
import { useToast } from '../../../stores/toast';
import { fmtDate, hijri, num, sar } from '../lib';
import { KIND_ICON, REQ_COLOR, STEP_COLOR, STEP_LABEL, loadSummary, rel, type Field } from './ess';

interface Step {
  kind: string; kindLabel: string; name: string; approverName: string | null; roleName: string | null; status: string; actorName: string | null;
  onBehalf: boolean; note: string | null; at: string | null; current: boolean;
}
interface Detail {
  id: string; requestNo: number; kind: string; kindLabel: string; typeId: string; typeName: string; color: string; status: string; statusLabel: string; summary: string;
  data: Record<string, unknown> & { extra?: Record<string, unknown> }; startDate: string | null; fields: Field[];
  employee: { id: string; employeeNo: number; fullName: string; jobTitle: string; unitName: string } | null;
  steps: Step[]; currentStep: string | null;
  attachments: { id: string; name: string; mime: string; size: number; uploadedByName: string; at: string }[];
  history: { action: string; label: string; note: string | null; actorName: string; at: string }[];
  result: Record<string, unknown> | null;
  balance: { name: string; available: number | null; entitlement: number | null; taken: number; pending: number } | null;
  advance: { amount: number; paid: number; remaining: number; installmentAmount: number; paidInstallments: number; installments: number; startMonth: string; repayments: { month: string; amount: number }[] } | null;
  createdByName: string; createdAt: string; decidedAt: string | null;
  can: { decide: boolean; onBehalf: boolean; cancel: boolean; edit: boolean; attach: boolean; print: boolean };
  viewer: { owner: boolean; manager: boolean; hr: boolean };
}

const props = defineProps<{ id: string }>();
const router = useRouter();
const toast = useToast();
const r = ref<Detail | null>(null);
const error = ref('');
const busy = ref(false);
const decision = ref<'approve' | 'return' | 'reject'>('approve');
const note = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

async function load() {
  try {
    r.value = await api<Detail>(`/hr/me/requests/${props.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

const d = computed(() => r.value?.data ?? {});
const s = (k: string) => (d.value[k] === null || d.value[k] === undefined || d.value[k] === '' ? '—' : String(d.value[k]));
const rows = computed(() => {
  const x = r.value;
  if (!x) return [];
  const out: { k: string; v: string }[] = [];
  if (x.kind === 'leave') out.push({ k: 'نوع الإجازة', v: s('leaveTypeName') }, { k: 'من', v: fmtDate(s('startDate')) }, { k: 'إلى', v: fmtDate(s('endDate')) }, { k: 'عدد الأيام', v: s('days') });
  if (x.kind === 'permission') out.push({ k: 'نوع الاستئذان', v: s('permissionKindName') }, { k: 'التاريخ', v: fmtDate(s('date')) }, { k: 'من الساعة', v: s('fromTime') }, { k: 'إلى الساعة', v: s('toTime') }, { k: 'المدة', v: `${num(Number(d.value.hours))} ساعة` });
  if (x.kind === 'exit_reentry') out.push({ k: 'نوع التأشيرة', v: s('visaTypeName') }, { k: 'تاريخ السفر', v: fmtDate(s('travelDate')) }, { k: 'تاريخ العودة', v: fmtDate(s('returnDate')) }, { k: 'المدة', v: `${s('days')} يومًا` }, { k: 'جهة السفر', v: s('destination') }, { k: 'المرافقون', v: s('dependents') });
  if (x.kind === 'letter') out.push({ k: 'النموذج', v: s('templateName') }, { k: 'الجهة الموجه إليها', v: s('addressee') });
  if (x.kind === 'advance') out.push({ k: 'المبلغ', v: sar(Number(d.value.amount)) }, { k: 'عدد الأقساط', v: s('installments') }, { k: 'القسط الشهري', v: sar(Number(d.value.installmentAmount)) }, { k: 'السبب', v: s('reason') });
  if (x.kind === 'resignation') out.push({ k: 'آخر يوم عمل', v: fmtDate(s('lastWorkingDay')) }, { k: 'مدة الإشعار', v: `${s('noticeDays')} يومًا` }, { k: 'سبب الاستقالة', v: s('reason') });
  for (const f of x.fields) {
    const v = d.value.extra?.[f.key];
    out.push({ k: f.label, v: v === true ? 'نعم' : v === false ? 'لا' : v === null || v === undefined || v === '' ? '—' : String(v) });
  }
  if (d.value.note) out.push({ k: 'ملاحظة', v: s('note') });
  return out;
});

async function decide() {
  if (!r.value || busy.value) return;
  if (decision.value !== 'approve' && !note.value.trim()) return toast.error('اكتب سبب الإرجاع أو الرفض');
  busy.value = true;
  try {
    await api(`/hr/me/requests/${r.value.id}/decision`, { method: 'POST', json: { decision: decision.value, note: note.value || null } });
    toast.success(decision.value === 'approve' ? 'تم الاعتماد' : decision.value === 'return' ? 'أُعيد الطلب لصاحبه' : 'رُفض الطلب');
    note.value = '';
    loadSummary(true);
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function cancel() {
  if (!r.value || !confirm('إلغاء هذا الطلب؟')) return;
  try {
    await api(`/hr/me/requests/${r.value.id}/cancel`, { method: 'POST', json: {} });
    toast.success('أُلغي الطلب');
    loadSummary(true);
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function attach(ev: Event) {
  const list = (ev.target as HTMLInputElement).files;
  if (!r.value || !list?.length) return;
  const fd = new FormData();
  [...list].forEach((f) => fd.append('files', f, f.name));
  try {
    await api(`/hr/me/requests/${r.value.id}/attachments`, { method: 'POST', body: fd });
    toast.success('أُضيفت المرفقات');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    if (fileInput.value) fileInput.value.value = '';
  }
}
const open = (attId: string) => openProtectedFile(`/hr/me/requests/${props.id}/attachments/${attId}`).catch((e) => toast.error((e as Error).message));
const size = (b: number) => (b > 1048576 ? `${num(b / 1048576)} م.ب` : `${Math.max(1, Math.round(b / 1024))} ك.ب`);
const CHOICES = [
  { v: 'approve' as const, label: '✓ اعتماد', c: '#10b981' }, { v: 'return' as const, label: '↩ إرجاع للتعديل', c: '#f97316' }, { v: 'reject' as const, label: '✕ رفض', c: '#ef4444' },
];
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-else-if="!r" class="ess-skeleton"><i /><i /><i /></div>
    <template v-else>
      <section class="ess-banner" :style="{ '--c': r.color }">
        <div class="row">
          <div>
            <p class="ess-kicker" style="color: rgba(255,255,255,.8)">{{ KIND_ICON[r.kind] ?? '📝' }} {{ r.kindLabel }} · طلب رقم {{ r.requestNo }}</p>
            <h1>{{ r.typeName }}</h1>
            <p style="margin: 0; opacity: .9">{{ r.summary }}</p>
          </div>
          <div style="display: grid; gap: 8px; justify-items: end">
            <span class="ess-pill" :style="{ '--c': REQ_COLOR[r.status] }">{{ r.statusLabel }}</span>
            <small style="opacity: .85">قُدّم {{ rel(r.createdAt) }} · {{ fmtDate(r.createdAt) }}</small>
          </div>
        </div>
      </section>

      <div class="ess-actions no-print" style="margin-bottom: 14px">
        <button class="btn btn-sm" @click="router.back()">→ رجوع</button>
        <RouterLink v-if="r.can.edit" :to="`/me/new/${r.typeId}?edit=${r.id}`" class="btn btn-sm btn-primary">تعديل وإعادة التقديم</RouterLink>
        <RouterLink v-if="r.can.print" :to="`/me/requests/${r.id}/letter`" class="btn btn-sm btn-primary">🖨️ عرض الخطاب وطباعته</RouterLink>
        <button v-if="r.can.cancel" class="btn btn-sm btn-danger" @click="cancel">إلغاء الطلب</button>
      </div>

      <div class="ess-grid">
        <div style="display: grid; gap: 16px; align-content: start">
          <section v-if="r.can.decide" class="card ess-card ess-decide">
            <h2>قرارك على الطلب</h2>
            <p v-if="r.can.onBehalf" class="pm-muted">ستعتمد نيابة عن صاحب الخطوة «{{ r.currentStep }}» بصلاحية مدير النظام.</p>
            <div class="choice">
              <button v-for="c in CHOICES" :key="c.v" type="button" :class="{ on: decision === c.v }" :style="{ '--c': c.c }" @click="decision = c.v">{{ c.label }}</button>
            </div>
            <label class="field"><span>{{ decision === 'approve' ? 'ملاحظة (اختيارية)' : 'السبب (إلزامي)' }}</span><textarea v-model="note" class="input" rows="2" /></label>
            <button class="btn btn-primary" :disabled="busy" @click="decide">{{ busy ? 'جارٍ الحفظ…' : 'تأكيد القرار' }}</button>
          </section>

          <section class="card ess-card">
            <h2>بيانات الطلب</h2>
            <div v-if="r.employee && !r.viewer.owner" class="ess-item" style="--c: #6366f1; margin-bottom: 10px">
              <span class="em">👤</span>
              <span class="tx"><b>{{ r.employee.fullName }}</b><span>{{ r.employee.jobTitle }} · {{ r.employee.unitName }} · الرقم {{ r.employee.employeeNo }}</span></span>
            </div>
            <div class="ess-kv">
              <div v-for="x in rows" :key="x.k"><span>{{ x.k }}</span><b>{{ x.v }}</b></div>
            </div>
            <div v-if="r.balance" class="ess-hints" style="margin-top: 12px">
              <span>رصيد {{ r.balance.name }} المتاح: {{ r.balance.available === null ? 'غير محدود' : `${num(r.balance.available)} يوم` }}</span>
              <span>المستخدم: {{ num(r.balance.taken) }} يوم</span>
              <span v-if="r.balance.pending">قيد الاعتماد: {{ num(r.balance.pending) }} يوم</span>
            </div>
            <div v-if="r.advance" style="margin-top: 14px">
              <p class="hr-sec">سداد السلفة</p>
              <div class="ess-bal">
                <div class="r"><b>سُدّد {{ sar(r.advance.paid) }} من {{ sar(r.advance.amount) }}</b><span class="pm-muted">{{ r.advance.paidInstallments }} / {{ r.advance.installments }} قسط</span></div>
                <div class="bar"><i class="t" :style="{ width: `${Math.min(100, (r.advance.paid / r.advance.amount) * 100)}%` }" /></div>
              </div>
              <p class="pm-muted">يبدأ الخصم من شهر {{ r.advance.startMonth }} بقسط {{ sar(r.advance.installmentAmount) }}. المتبقي {{ sar(r.advance.remaining) }}.</p>
            </div>
            <div v-if="r.result?.separationId" class="ess-hints" style="margin-top: 12px">
              <span>فُتح ملف إنهاء الخدمة رقم {{ r.result.separationNo }}</span>
              <RouterLink :to="`/hr/separations/${r.result.separationId}`">متابعة إخلاء الطرف والمستحقات ←</RouterLink>
            </div>
            <div v-if="r.result?.letterNo" class="ess-hints" style="margin-top: 12px">
              <span>رقم الخطاب {{ r.result.letterNo }}</span><span>بتاريخ {{ fmtDate(String(r.result.date)) }}</span>
            </div>
          </section>

          <section class="card ess-card">
            <h2>المرفقات <small class="pm-muted">({{ r.attachments.length }})</small></h2>
            <div class="ess-files">
              <button v-for="a in r.attachments" :key="a.id" type="button" class="ess-file" @click="open(a.id)">
                {{ a.mime === 'application/pdf' ? '📄' : '🖼️' }} {{ a.name }} <small class="pm-muted">{{ size(a.size) }} · {{ a.uploadedByName }}</small>
              </button>
            </div>
            <p v-if="!r.attachments.length" class="pm-empty">لا توجد مرفقات</p>
            <template v-if="r.can.attach">
              <input ref="fileInput" type="file" multiple accept="application/pdf,image/*" hidden @change="attach" />
              <button class="btn btn-sm" style="margin-top: 10px" @click="fileInput?.click()">📎 إضافة مرفق (PDF أو صورة)</button>
            </template>
          </section>
        </div>

        <div style="display: grid; gap: 16px; align-content: start">
          <section class="card ess-card">
            <h2>مسار الاعتماد</h2>
            <div class="ess-steps">
              <div v-for="(st, i) in r.steps" :key="i" :class="['ess-step', { cur: st.current && r.status === 'pending' }]" :style="{ '--i': i, '--c': STEP_COLOR[st.status] }">
                <span class="dot">{{ st.status === 'approved' ? '✓' : st.status === 'rejected' ? '✕' : st.status === 'returned' ? '↩' : i + 1 }}</span>
                <div>
                  <b>{{ st.name }}</b>
                  <span>{{ st.approverName ?? st.roleName ?? st.kindLabel }} · {{ st.current && r.status === 'pending' ? 'بانتظار القرار' : STEP_LABEL[st.status] }}</span>
                  <span v-if="st.actorName && st.status !== 'waiting'">{{ st.actorName }}{{ st.onBehalf ? ' (نيابة)' : '' }}{{ st.at ? ` · ${rel(st.at)}` : '' }}</span>
                  <p v-if="st.note" class="note">{{ st.note }}</p>
                </div>
              </div>
            </div>
          </section>
          <section class="card ess-card">
            <h2>سجل الطلب</h2>
            <ol class="ess-timeline">
              <li v-for="(h, i) in [...r.history].reverse()" :key="i" :style="{ '--i': i }">
                <b>{{ h.label }}</b> — {{ h.actorName }}
                <span>{{ rel(h.at) }} · {{ hijri(h.at) }}</span>
                <p v-if="h.note" class="pm-muted" style="margin: 2px 0 0">{{ h.note }}</p>
              </li>
            </ol>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>
