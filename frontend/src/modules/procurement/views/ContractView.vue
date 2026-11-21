<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, openProtectedFile } from '../../../api';
import { useToast } from '../../../stores/toast';
import { CONTRACT_COLOR, EVAL_COLOR, GRADE_COLOR, INVOICE_COLOR, ORDER_COLOR, fmtDate, fmtDateTime, fmtSize, sar, today, upload } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

const props = defineProps<{ id: string }>();
const router = useRouter();
const toast = useToast();
const d = ref<any>(null);
const busy = ref(false);
type Modal = '' | 'approve' | 'return' | 'suspend' | 'resume' | 'close' | 'terminate' | 'cancel' | 'amend' | 'decideAmend' | 'penalty' | 'decidePenalty' | 'kpi';
const modal = ref<Modal>('');
const note = ref('');
const decision = ref<'approve' | 'reject'>('approve');
const target = ref<any>(null);
const am = ref<any>({});
const pen = ref<any>({});
const kpi = ref<any>({});
const base = () => `/procurement/contracts/${props.id}`;
const TITLES: Record<string, string> = {
  approve: 'اعتماد العقد', return: 'إعادة العقد للتعديل', suspend: 'إيقاف العقد مؤقتًا', resume: 'استئناف العقد', close: 'إغلاق العقد بانتهائه',
  terminate: 'إنهاء العقد قبل مدته', cancel: 'إلغاء العقد', amend: 'طلب ملحق', decideAmend: 'قرار الملحق', penalty: 'تسجيل جزاء', decidePenalty: 'قرار الجزاء', kpi: 'قراءة مؤشر الخدمة',
};

async function load() {
  try {
    d.value = await api(base());
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
watch(() => props.id, load);

const slaName = (k: string) => d.value?.slas.find((s: any) => s.key === k)?.name ?? '—';
const pendingAmendment = computed(() => d.value?.amendments.find((x: any) => x.status === 'pending'));

function open(m: Modal, t: any = null) {
  note.value = '';
  decision.value = 'approve';
  target.value = t;
  if (m === 'amend') am.value = { kind: 'extension', reason: '', endsOn: d.value.endsOn, value: d.value.value, terms: d.value.terms ?? '' };
  if (m === 'penalty') pen.value = { ruleKey: d.value.penaltyRules[0]?.key ?? '', date: today(), days: 1, amount: 0, reason: '', orderId: '' };
  if (m === 'kpi') kpi.value = { slaKey: d.value.slas[0]?.key ?? '', period: today().slice(0, 7), value: 0, note: '' };
  modal.value = m;
}
const rule = computed(() => d.value?.penaltyRules.find((r: any) => r.key === pen.value.ruleKey));

async function act(path: string, json: object, done: string) {
  busy.value = true;
  try {
    d.value = await api(`${base()}${path}`, { method: 'POST', json });
    toast.success(done);
    modal.value = '';
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const nul = (v: any) => (v === '' || v === undefined ? null : v);
function confirm() {
  const m = modal.value;
  if (m === 'approve' || m === 'return') return act(`/${m}`, { note: nul(note.value) }, m === 'approve' ? 'اعتُمد العقد وأصبح ساريًا' : 'أُعيد العقد');
  if (['suspend', 'resume', 'close', 'terminate', 'cancel'].includes(m)) return act('/status', { action: m, reason: nul(note.value) }, 'حُدّثت حالة العقد');
  if (m === 'amend') {
    const a = am.value;
    const body: any = { kind: a.kind, reason: a.reason };
    if (a.kind === 'extension') body.endsOn = a.endsOn;
    if (a.kind === 'value') body.value = Number(a.value);
    if (a.kind === 'terms') body.terms = a.terms;
    return act('/amendments', body, 'أُرسل الملحق للاعتماد');
  }
  if (m === 'decideAmend') return act(`/amendments/${target.value.no}/decide`, { decision: decision.value, note: nul(note.value) }, 'سُجل القرار');
  if (m === 'penalty') {
    const p = pen.value;
    return act('/penalties', {
      ruleKey: nul(p.ruleKey), date: p.date, days: rule.value?.basis === 'per_day' ? Number(p.days) : null, amount: rule.value ? null : Number(p.amount),
      reason: p.reason, orderId: nul(p.orderId),
    }, 'سُجل الجزاء بانتظار الاعتماد');
  }
  if (m === 'decidePenalty') return act(`/penalties/${target.value.id}/decide`, { decision: decision.value, note: nul(note.value) }, 'سُجل القرار');
  if (m === 'kpi') return act('/kpis', { slaKey: kpi.value.slaKey, period: kpi.value.period, value: Number(kpi.value.value), note: nul(kpi.value.note) }, 'سُجلت القراءة');
}
const release = (key: string) => act(`/guarantees/${key}/release`, {}, 'أُفرج عن الضمان');
async function submit() {
  await act('/submit', {}, 'أُرسل العقد للاعتماد');
}
async function addFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    d.value = await upload(`${base()}/files`, f);
    toast.success('أُرفق الملف');
  } catch (err) {
    toast.error((err as Error).message);
  }
}
async function removeFile(key: string) {
  try {
    d.value = await api(`${base()}/files/${key}`, { method: 'DELETE' });
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const openFile = (key: string) => openProtectedFile(`${base()}/files/${key}`).catch((e) => toast.error((e as Error).message));
</script>

<template>
  <div v-if="d">
    <div class="page-head">
      <div>
        <h1>{{ d.code }} · {{ d.title }}</h1>
        <p class="muted">
          {{ d.kindLabel }} · <span class="pm-pill" :style="{ '--c': CONTRACT_COLOR[d.status] }">{{ d.statusLabel }}</span>
          · النسخة {{ d.version }}<span v-if="d.reference"> · المرجع {{ d.reference }}</span>
        </p>
      </div>
      <div class="pc-inline pc-noprint">
        <template v-if="d.can.edit">
          <button class="btn" @click="router.push(`/procurement/contracts/${d.id}/edit`)">تعديل</button>
          <button class="btn btn-primary" :disabled="busy" @click="submit">إرسال للاعتماد</button>
        </template>
        <button v-if="d.can.decide" class="btn btn-primary" @click="open('approve')">اعتماد</button>
        <button v-if="d.can.decide" class="btn" @click="open('return')">إعادة</button>
        <button v-if="d.can.amend" class="btn" @click="open('amend')">طلب ملحق</button>
        <button v-if="d.can.suspend" class="btn btn-ghost" @click="open('suspend')">إيقاف مؤقت</button>
        <button v-if="d.can.resume" class="btn" @click="open('resume')">استئناف</button>
        <button v-if="d.can.close" class="btn btn-ghost" @click="open('close')">إغلاق</button>
        <button v-if="d.can.terminate" class="btn btn-ghost" @click="open('terminate')">إنهاء</button>
        <button v-if="d.can.cancel" class="btn btn-ghost" @click="open('cancel')">إلغاء</button>
      </div>
    </div>
    <div v-if="d.returnReason && d.status === 'returned'" class="alert alert-error">{{ d.returnReason }}</div>
    <div v-if="d.endReason && ['terminated', 'cancelled', 'suspended'].includes(d.status)" class="alert alert-error">{{ d.endReason }}</div>
    <div v-for="(a, i) in d.alerts" :key="i" class="alert alert-error" style="margin-bottom: 8px">⚠ {{ a }}</div>

    <div class="pc-cards" style="margin-bottom: 14px">
      <div class="pc-kpi"><small>قيمة العقد (السقف)</small><b>{{ sar(d.value) }}</b></div>
      <div class="pc-kpi" :class="{ hot: d.usedPct >= d.alertPct }"><small>المستخدم بالتعميدات</small><b>{{ sar(d.used) }}</b><small>{{ d.usedPct }}%</small></div>
      <div class="pc-kpi"><small>المتبقي</small><b>{{ sar(d.remaining) }}</b></div>
      <div class="pc-kpi"><small>المفوتر والمسدد</small><b>{{ sar(d.invoiced) }}</b><small>المسدد {{ sar(d.paid) }}</small></div>
      <div class="pc-kpi"><small>الجزاءات المعتمدة</small><b>{{ sar(d.approvedPenalties) }}</b></div>
    </div>

    <div class="pc-grid" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)">
      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <dl class="pc-dl">
            <div><dt>المورد</dt><dd><RouterLink class="pm-link" :to="`/procurement/suppliers/${d.supplier.id}`">{{ d.supplier.code }} · {{ d.supplier.name }}</RouterLink>
              <span v-if="d.supplier.grade" class="pm-pill" :style="{ '--c': GRADE_COLOR[d.supplier.grade], marginInlineStart: '4px' }">{{ d.supplier.grade }}</span></dd></div>
            <div><dt>المدة</dt><dd>{{ fmtDate(d.startsOn) }} إلى {{ fmtDate(d.endsOn) }}</dd></div>
            <div v-if="d.project"><dt>المشروع</dt><dd>{{ d.project }}</dd></div>
            <div v-if="d.fundingBatch"><dt>مصدر التمويل</dt><dd>{{ d.fundingBatch }}</dd></div>
            <div v-if="d.budgetLine"><dt>بند الموازنة</dt><dd>{{ d.budgetLine }}</dd></div>
            <div><dt>أعدّه</dt><dd>{{ d.createdByName }}</dd></div>
            <div v-if="d.approvedByName"><dt>اعتمده</dt><dd>{{ d.approvedByName }} <small class="pm-muted">{{ fmtDateTime(d.approvedAt) }}</small></dd></div>
            <div><dt>يظهر للمورد</dt><dd>{{ d.shareWithSupplier ? 'نعم، في بوابته' : 'لا' }}</dd></div>
          </dl>
          <p v-if="d.scope" style="white-space: pre-line; margin: 12px 0 0"><b>النطاق:</b> {{ d.scope }}</p>
          <p v-if="d.terms" class="pm-muted" style="white-space: pre-line; margin: 8px 0 0"><b>الشروط:</b> {{ d.terms }}</p>
        </section>

        <section v-if="d.partnership" class="card pm-panel" style="border-inline-start: 4px solid #0891b2">
          <h2>عقد مشترك مع شريك</h2>
          <p style="margin: 0">الجهة شريك للجمعية أيضًا، والعقد مرتبط بعقد الشراكة
            <RouterLink class="pm-link" :to="`/partnerships/contracts/${d.partnership.id}`">{{ d.partnership.number }} · {{ d.partnership.title }}</RouterLink>
            <span v-if="d.partnership.partnerName"> مع {{ d.partnership.partnerName }}</span>.</p>
        </section>

        <section class="card pm-panel">
          <h2>الأسعار التعاقدية</h2>
          <table class="pc-lines">
            <thead><tr><th>البند</th><th>الوحدة</th><th>سعر الوحدة</th><th>الحد الأعلى للكمية</th></tr></thead>
            <tbody>
              <tr v-for="p in d.prices" :key="p.key"><td>{{ p.description }}</td><td>{{ p.unit ?? '—' }}</td><td class="pc-num">{{ p.unitPrice }}</td><td class="pc-num">{{ p.maxQty ?? '—' }}</td></tr>
              <tr v-if="!d.prices.length"><td colspan="4" class="pm-muted">لا توجد أسعار تعاقدية.</td></tr>
            </tbody>
          </table>
        </section>

        <section class="card pm-panel">
          <div class="pc-inline" style="justify-content: space-between"><h2>مستويات الخدمة وقراءاتها</h2><button v-if="d.can.kpi" class="btn" @click="open('kpi')">تسجيل قراءة</button></div>
          <table class="pc-lines">
            <thead><tr><th>المؤشر</th><th>المستهدف</th><th>الفترة</th><th>القراءة</th><th>النتيجة</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in d.kpiReadings" :key="i">
                <td>{{ slaName(r.slaKey) }}<small v-if="r.note" class="pm-muted" style="display: block">{{ r.note }}</small></td>
                <td>{{ d.slas.find((s: any) => s.key === r.slaKey)?.direction === 'max' ? '≤' : '≥' }} {{ d.slas.find((s: any) => s.key === r.slaKey)?.target }} {{ d.slas.find((s: any) => s.key === r.slaKey)?.unit }}</td>
                <td>{{ r.period }}</td><td class="pc-num">{{ r.value }}</td>
                <td><span :class="r.met ? 'pc-okflag' : 'pc-warn'">{{ r.met ? 'محقق' : 'غير محقق' }}</span></td>
              </tr>
              <tr v-if="!d.kpiReadings.length"><td colspan="5" class="pm-muted">{{ d.slas.length ? 'لم تُسجل قراءات بعد.' : 'لا توجد مؤشرات خدمة في العقد.' }}</td></tr>
            </tbody>
          </table>
        </section>

        <section class="card pm-panel">
          <div class="pc-inline" style="justify-content: space-between"><h2>الجزاءات</h2><button v-if="d.can.penalty" class="btn" @click="open('penalty')">تسجيل جزاء</button></div>
          <p v-if="d.penaltyRules.length" class="pm-muted" style="font-size: .82rem; margin: 0 0 6px">
            القواعد: <span v-for="(r, i) in d.penaltyRules" :key="r.key">{{ i ? '، ' : '' }}{{ r.name }} ({{ d.penaltyBasis[r.basis] }} {{ r.rate }}{{ r.capPct ? `، بسقف ${r.capPct}%` : '' }})</span>
          </p>
          <table class="pc-lines">
            <thead><tr><th>التاريخ</th><th>السبب</th><th>المبلغ</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              <tr v-for="p in d.penalties" :key="p.id">
                <td>{{ fmtDate(p.date) }}</td>
                <td>{{ p.reason }}<small class="pm-muted" style="display: block">{{ p.ruleName ?? 'مبلغ يدوي' }} · سجله {{ p.byName }}</small></td>
                <td class="pc-num">{{ sar(p.amount) }}</td>
                <td>{{ { pending: 'بانتظار الاعتماد', approved: 'معتمد', rejected: 'مرفوض' }[p.status as string] }}<small v-if="p.decidedByName" class="pm-muted" style="display: block">{{ p.decidedByName }}</small></td>
                <td><button v-if="p.status === 'pending' && d.can.decidePenalty && p.byId !== d.me" class="btn" @click="open('decidePenalty', p)">قرار</button></td>
              </tr>
              <tr v-if="!d.penalties.length"><td colspan="5" class="pm-muted">لا توجد جزاءات.</td></tr>
            </tbody>
          </table>
        </section>

        <section class="card pm-panel">
          <h2>الملاحق</h2>
          <ul class="pc-log">
            <li v-for="a in [...d.amendments].reverse()" :key="a.no">
              <span><b>ملحق {{ a.no }}: {{ d.amendmentKinds[a.kind] }}</b> · {{ { pending: 'بانتظار الاعتماد', approved: 'معتمد', rejected: 'مرفوض' }[a.status as string] }}
                <small class="pm-muted">{{ a.byName }} · {{ fmtDateTime(a.at) }}</small>
                <div style="font-size: .85rem">{{ a.reason }}</div>
                <div class="pm-muted" style="font-size: .8rem">
                  <span v-if="a.before.endsOn !== a.after.endsOn">النهاية: {{ a.before.endsOn }} ← {{ a.after.endsOn }}. </span>
                  <span v-if="a.before.value !== a.after.value">القيمة: {{ sar(a.before.value) }} ← {{ sar(a.after.value) }}. </span>
                  <span v-if="a.before.terms !== a.after.terms">تعديل الشروط. </span>
                </div>
              </span>
              <button v-if="a.status === 'pending' && d.can.decideAmendment && a.byId !== d.me" class="btn" @click="open('decideAmend', a)">قرار</button>
            </li>
            <li v-if="!d.amendments.length" class="pm-muted">لا توجد ملاحق.</li>
          </ul>
        </section>

        <section class="card pm-panel">
          <h2>التعميدات والفواتير على العقد</h2>
          <table class="pc-lines">
            <thead><tr><th>التعميد</th><th>التسليم</th><th>القيمة</th><th>الحالة</th></tr></thead>
            <tbody>
              <tr v-for="o in d.orders" :key="o.id" class="pc-row" @click="router.push(`/procurement/orders/${o.id}`)">
                <td class="pc-code">{{ o.code }}<small class="pm-muted" style="display: block">{{ o.title }}</small></td><td>{{ fmtDate(o.deliveryDate) }}</td>
                <td class="pc-num">{{ sar(o.total) }}</td><td><span class="pm-pill" :style="{ '--c': ORDER_COLOR[o.status] }">{{ o.statusLabel }}</span></td>
              </tr>
              <tr v-if="!d.orders.length"><td colspan="4" class="pm-muted">لم يصدر تعميد على العقد بعد.</td></tr>
            </tbody>
          </table>
          <ul v-if="d.invoices.length" class="pc-log" style="margin-top: 8px">
            <li v-for="i in d.invoices" :key="i.id"><span><RouterLink class="pm-link" :to="`/procurement/invoices/${i.id}`">{{ i.code }}</RouterLink> · {{ i.supplierInvoiceNo }} · {{ sar(i.total) }}
              <span class="pm-pill" :style="{ '--c': INVOICE_COLOR[i.status] }">{{ i.status }}</span></span></li>
          </ul>
        </section>
      </div>

      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2>الضمانات</h2>
          <ul class="pc-log">
            <li v-for="g in d.guarantees" :key="g.key">
              <span><b>{{ d.guaranteeKinds[g.kind] }}</b> · {{ sar(g.amount) }}
                <small class="pm-muted" style="display: block">{{ g.ref ?? '' }} {{ g.issuer ?? '' }}{{ g.expiresOn ? ` · ينتهي ${fmtDate(g.expiresOn)}` : '' }}</small>
                <small v-if="g.released" class="pc-okflag">أُفرج عنه</small></span>
              <button v-if="!g.released && d.can.release" class="btn btn-ghost" :disabled="busy" @click="release(g.key)">إفراج</button>
            </li>
            <li v-if="!d.guarantees.length" class="pm-muted">لا توجد ضمانات.</li>
          </ul>
        </section>
        <section class="card pm-panel">
          <h2>المخاطر المرتبطة</h2>
          <ul class="pc-log">
            <li v-for="r in d.risks" :key="r.id"><span><RouterLink class="pm-link" :to="`/risk/register/${r.id}`">{{ r.code }}</RouterLink> · {{ r.title }} <small class="pm-muted">{{ r.levelLabel ?? r.level }}</small></span></li>
            <li v-if="!d.risks.length" class="pm-muted">لا توجد مخاطر مرتبطة.</li>
          </ul>
        </section>
        <section class="card pm-panel">
          <h2>تقييمات المورد على العقد</h2>
          <ul class="pc-log">
            <li v-for="e in d.evaluations" :key="e.id"><span><RouterLink class="pm-link" :to="`/procurement/evaluations/${e.id}`">{{ e.code }}</RouterLink> · {{ e.total }}
              <span class="pm-pill" :style="{ '--c': GRADE_COLOR[e.grade] }">{{ e.grade }}</span> <span class="pm-pill" :style="{ '--c': EVAL_COLOR[e.status] }">{{ e.status }}</span></span></li>
            <li v-if="!d.evaluations.length" class="pm-muted">لا توجد تقييمات.</li>
          </ul>
        </section>
        <section class="card pm-panel">
          <h2>المستندات</h2>
          <p v-if="d.requiredDocs.length" class="pm-muted" style="font-size: .82rem; margin: 0 0 6px">المطلوب من المورد: {{ d.requiredDocs.join('، ') }}</p>
          <ul class="pc-log">
            <li v-for="f in d.attachments" :key="f.key"><span><a class="pm-link" href="#" @click.prevent="openFile(f.key)">{{ f.name }}</a> <small class="pm-muted">{{ fmtSize(f.size) }}</small></span>
              <button v-if="d.can.files" class="btn btn-ghost" @click="removeFile(f.key)">✕</button></li>
            <li v-if="!d.attachments.length" class="pm-muted">لا توجد مرفقات.</li>
          </ul>
          <label v-if="d.can.files" class="btn" style="margin-top: 8px">إرفاق<input type="file" accept=".pdf,image/*" hidden @change="addFile" /></label>
        </section>
        <section class="card pm-panel">
          <h2>السجل</h2>
          <ul class="pc-log">
            <li v-for="(x, i) in [...d.log].reverse()" :key="i"><span><b>{{ x.action }}</b> · {{ x.byName }} <small class="pm-muted">{{ fmtDateTime(x.at) }}</small><div v-if="x.note" class="pm-muted" style="font-size: .8rem">{{ x.note }}</div></span></li>
          </ul>
        </section>
      </div>
    </div>

    <div v-if="modal" class="modal-backdrop" @click.self="modal = ''">
      <form class="card modal" @submit.prevent="confirm">
        <h2>{{ TITLES[modal] }}</h2>
        <template v-if="modal === 'amend'">
          <p v-if="pendingAmendment" class="alert alert-error">على العقد ملحق بانتظار الاعتماد.</p>
          <label class="field"><span>نوع الملحق</span><select v-model="am.kind" class="input"><option v-for="(l, k) in d.amendmentKinds" :key="k" :value="k">{{ l }}</option></select></label>
          <label v-if="am.kind === 'extension'" class="field"><span>تاريخ النهاية الجديد</span><input v-model="am.endsOn" type="date" class="input" :min="d.startsOn" required /></label>
          <label v-if="am.kind === 'value'" class="field"><span>القيمة الجديدة (لا تقل عن المستخدم {{ sar(d.used) }})</span><input v-model.number="am.value" type="number" :min="d.used || 1" step="any" class="input" required /></label>
          <label v-if="am.kind === 'terms'" class="field"><span>الشروط بعد التعديل</span><textarea v-model="am.terms" class="input" rows="5" /></label>
          <p v-if="am.kind === 'prices'" class="pm-muted" style="font-size: .85rem">لتعديل الأسعار التعاقدية اكتب التعديل المطلوب في السبب، ثم يُعتمد ويُحدّث جدول الأسعار في ملحق لاحق.</p>
          <label class="field"><span>السبب</span><textarea v-model="am.reason" class="input" rows="3" required minlength="5" /></label>
        </template>
        <template v-else-if="modal === 'penalty'">
          <label class="field"><span>القاعدة</span><select v-model="pen.ruleKey" class="input"><option value="">مبلغ يدوي</option><option v-for="r in d.penaltyRules" :key="r.key" :value="r.key">{{ r.name }}</option></select></label>
          <label class="field"><span>تاريخ المخالفة</span><input v-model="pen.date" type="date" class="input" :max="today()" required /></label>
          <label v-if="rule?.basis === 'per_day'" class="field"><span>أيام التأخير ({{ rule.rate }} عن كل يوم)</span><input v-model.number="pen.days" type="number" min="1" class="input" required /></label>
          <label v-if="!rule" class="field"><span>المبلغ</span><input v-model.number="pen.amount" type="number" min="0.01" step="any" class="input" required /></label>
          <label class="field"><span>التعميد المرتبط{{ rule?.basis === 'percent' ? ` (يُحسب ${rule.rate}% من قيمته)` : ' (اختياري)' }}</span>
            <select v-model="pen.orderId" class="input" :required="rule?.basis === 'percent'"><option value="">—</option><option v-for="o in d.orders" :key="o.id" :value="o.id">{{ o.code }} · {{ sar(o.total) }}</option></select></label>
          <label class="field"><span>السبب</span><textarea v-model="pen.reason" class="input" rows="3" required minlength="5" /></label>
        </template>
        <template v-else-if="modal === 'kpi'">
          <label class="field"><span>المؤشر</span><select v-model="kpi.slaKey" class="input"><option v-for="s in d.slas" :key="s.key" :value="s.key">{{ s.name }} ({{ s.direction === 'max' ? '≤' : '≥' }} {{ s.target }} {{ s.unit }})</option></select></label>
          <label class="field"><span>الشهر</span><input v-model="kpi.period" type="month" class="input" required /></label>
          <label class="field"><span>القراءة</span><input v-model.number="kpi.value" type="number" min="0" step="any" class="input" required /></label>
          <label class="field"><span>ملاحظة</span><input v-model="kpi.note" class="input" maxlength="500" /></label>
        </template>
        <template v-else>
          <div v-if="modal === 'decideAmend' || modal === 'decidePenalty'" class="pc-inline" style="margin-bottom: 8px">
            <label><input v-model="decision" type="radio" value="approve" /> اعتماد</label>
            <label><input v-model="decision" type="radio" value="reject" /> رفض</label>
          </div>
          <p v-if="modal === 'decidePenalty' && target" class="pm-muted" style="font-size: .85rem">{{ target.reason }}: {{ sar(target.amount) }}</p>
          <p v-if="modal === 'decideAmend' && target" class="pm-muted" style="font-size: .85rem">{{ target.reason }}</p>
          <label class="field">
            <span>{{ ['approve', 'resume'].includes(modal) || (decision === 'approve' && modal.startsWith('decide')) ? 'ملاحظة (اختياري)' : 'السبب' }}</span>
            <textarea v-model="note" class="input" rows="3" :required="!['approve', 'resume'].includes(modal) && !(decision === 'approve' && modal.startsWith('decide'))" />
          </label>
        </template>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">تأكيد</button><button type="button" class="btn" @click="modal = ''">رجوع</button></div>
      </form>
    </div>
  </div>
</template>
