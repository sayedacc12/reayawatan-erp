<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import VoucherForm from '../components/VoucherForm.vue';
import { ENTRY_STATUS, VOUCHER_STATUS, dt, money } from '../lib';
import '../../../shared/module.css';
import '../acc.css';

interface V {
  id: string; kind: 'receipt' | 'payment'; kindLabel: string; serial: number; fiscalYear: number; voucherDate: string; partyName: string; partnerId: string | null; partnerName: string | null;
  amount: number; amountWords: string; purpose: string; sourceType: 'manual' | 'opportunity' | 'store' | 'payroll' | 'membership' | 'separation' | 'comms' | 'assets'; sourceRef: string | null; projectName: string | null;
  method: string; methodLabel: string; methodRef: string | null; cashAccountId: string | null; cashAccountName: string | null; cashKind: string; cashGl: string;
  counterAccountId: string; counterAccountCode: string; counterAccountName: string; analytic: { analyticId: string; percent: number; code: string; name: string }[];
  status: string; statusLabel: string; stages: { id: string; name: string; instructions: string | null }[]; currentStageId: string | null; stageName: string | null;
  request: { kind: 'draft' | 'cancel'; byName: string; reason: string; at: string } | null;
  entries: { id: string; entryNo: number; status: string; cancelReason: string | null; postedAt: string | null; cancelledAt: string | null }[];
  entryId: string | null; approvedAt: string | null; createdByName: string; createdAt: string; organization: { name: string; taxNumber: string | null };
  actions: { id: string; action: string; label: string; stageName: string | null; note: string | null; actorName: string; at: string }[];
  lockedSource?: boolean; lines?: { accountCode: string; accountName: string; debit: number; credit: number; label: string | null }[] | null;
  can: { edit: boolean; submit: boolean; decide: boolean; approveDirect: boolean; cancelDraft: boolean; request: boolean; decideRequest: boolean };
}
const props = defineProps<{ id: string }>();
const toast = useToast();
const v = ref<V | null>(null);
const error = ref('');
const busy = ref(false);
const editing = ref(false);
async function load() {
  try {
    v.value = await api<V>(`/accounting/voucher/${props.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(() => props.id, load);
const isR = computed(() => v.value?.kind === 'receipt');
async function call(path: string, body: unknown, msg: string) {
  busy.value = true;
  try {
    v.value = await api<V>(`/accounting/voucher/${props.id}${path}`, { method: 'POST', json: body ?? {} });
    toast.success(msg);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const submit = () => call('/submit', {}, v.value!.stages.length ? 'أُرسل السند للاعتماد' : 'اعتُمد السند ورُحّل قيده');
function decide(decision: 'approve' | 'reject' | 'return') {
  let note: string | null = null;
  if (decision !== 'approve') {
    note = prompt(decision === 'reject' ? 'سبب الرفض:' : 'سبب الإرجاع للتعديل:');
    if (!note) return;
  } else if (!confirm(isLast.value ? 'اعتماد نهائي؟ سيصبح السند قيد يومية مرحّلًا لا يُعدَّل.' : 'الموافقة ونقل السند للمرحلة التالية؟')) return;
  call('/decide', { decision, note }, decision === 'approve' ? (isLast.value ? 'اعتُمد السند ورُحّل قيده' : 'تمت الموافقة') : decision === 'reject' ? 'رُفض السند' : 'أُعيد السند للتعديل');
}
function request(kind: 'draft' | 'cancel') {
  const reason = prompt(kind === 'draft' ? 'سبب إعادة السند للمسودة (يُعكس القيد ويبقى رقمه):' : 'سبب إلغاء السند (يبقى رقمه ويظهر ملغيًا):');
  if (!reason) return;
  const msg = v.value!.status !== 'approved' ? 'أُلغي السند' : isR.value ? 'أُرسل الطلب للاعتماد الثاني' : kind === 'draft' ? 'أُعيد السند للمسودة وعُكس قيده' : 'أُلغي السند وعُكس قيده';
  call('/request', { kind, reason }, msg);
}
function decideRequest(decision: 'approve' | 'reject') {
  const note = decision === 'reject' ? prompt('سبب رفض الطلب:') : null;
  if (decision === 'reject' && !note) return;
  if (decision === 'approve' && !confirm('اعتماد الطلب؟ سيُعكس قيد السند.')) return;
  call('/request/decide', { decision, note }, decision === 'approve' ? 'نُفّذ الطلب وعُكس القيد' : 'رُفض الطلب');
}
const stageIdx = computed(() => v.value?.stages.findIndex((s) => s.id === v.value!.currentStageId) ?? -1);
const isLast = computed(() => !!v.value && stageIdx.value === v.value.stages.length - 1);
const stepState = (i: number) => {
  if (!v.value) return '';
  if (v.value.status === 'approved') return 'done';
  if (v.value.status === 'pending') return i < stageIdx.value ? 'done' : i === stageIdx.value ? 'now' : '';
  return '';
};
function saved() {
  editing.value = false;
  load();
}
</script>

<template>
  <div v-if="v">
    <section :class="['pm-hero', 'ac-hero', 'no-print', v.kind]">
      <div>
        <p class="pm-kicker"><RouterLink :to="isR ? '/accounting/receipts' : '/accounting/payments'" style="color: inherit">{{ isR ? 'سندات القبض' : 'سندات الصرف' }}</RouterLink> ‹ رقم {{ v.serial }}</p>
        <h1>{{ v.kindLabel }} رقم {{ v.serial }}</h1>
        <p class="pm-sub"><span class="pm-pill" :style="{ '--c': VOUCHER_STATUS[v.status].color, background: 'rgba(255,255,255,.9)' }">{{ v.statusLabel }}</span>
          <template v-if="v.stageName"> · المرحلة الحالية: {{ v.stageName }}</template></p>
      </div>
      <div class="pm-actions">
        <button v-if="v.can.edit" class="btn ac-ghost" @click="editing = true">تعديل</button>
        <button v-if="v.can.submit && (v.stages.length || v.can.approveDirect)" class="btn ac-glow" :disabled="busy" @click="submit">{{ v.stages.length ? 'إرسال للاعتماد' : 'اعتماد وترحيل' }}</button>
        <template v-if="v.can.decide">
          <button class="btn ac-glow" :disabled="busy" @click="decide('approve')">{{ isLast ? 'اعتماد نهائي' : 'موافقة' }}</button>
          <button class="btn ac-ghost" :disabled="busy" @click="decide('return')">إرجاع للتعديل</button>
          <button class="btn ac-ghost" :disabled="busy" @click="decide('reject')">رفض</button>
        </template>
        <button v-if="v.can.cancelDraft" class="btn ac-ghost" :disabled="busy" @click="request('cancel')">إلغاء السند</button>
        <template v-if="v.can.request">
          <button class="btn ac-ghost" :disabled="busy" @click="request('draft')">إعادة للمسودة</button>
          <button class="btn ac-ghost" :disabled="busy" @click="request('cancel')">إلغاء السند</button>
        </template>
        <button class="btn ac-ghost" onclick="window.print()">طباعة</button>
      </div>
    </section>

    <div v-if="v.request" class="ac-warn pulse no-print">
      <div style="flex: 1"><b>طلب {{ v.request.kind === 'draft' ? 'إعادة السند للمسودة' : 'إلغاء السند' }} من {{ v.request.byName }}</b><div class="pm-muted">{{ v.request.reason }} · {{ dt(v.request.at) }}</div>
        <div class="pm-muted">يحتاج اعتمادًا ثانيًا من مستخدم آخر لديه صلاحية الاعتماد الثاني لإلغاء سندات القبض.</div></div>
      <template v-if="v.can.decideRequest">
        <button class="btn btn-sm btn-primary" :disabled="busy" @click="decideRequest('approve')">اعتماد الطلب</button>
        <button class="btn btn-sm" :disabled="busy" @click="decideRequest('reject')">رفض</button>
      </template>
    </div>

    <div v-if="v.stages.length" class="stepper no-print">
      <div class="step done"><i>✓</i><span>إنشاء السند</span></div>
      <div v-for="(s, i) in v.stages" :key="s.id" :class="['step', stepState(i)]" :title="s.instructions ?? ''"><i>{{ stepState(i) === 'done' ? '✓' : i + 1 }}</i><span>{{ s.name }}</span></div>
      <div :class="['step', { done: v.status === 'approved' }]"><i>{{ v.status === 'approved' ? '✓' : '★' }}</i><span>قيد مرحّل</span></div>
    </div>

    <div class="layout">
      <!-- السند بشكله الورقي -->
      <article :class="['paper', v.kind, { void: v.status === 'cancelled' || v.status === 'rejected' }]">
        <div v-if="v.status === 'cancelled' || v.status === 'rejected'" class="stamp">{{ v.status === 'cancelled' ? 'ملغي' : 'مرفوض' }}</div>
        <header>
          <div><h2>{{ v.organization.name }}</h2><small v-if="v.organization.taxNumber">الرقم الضريبي: <span class="ac-code">{{ v.organization.taxNumber }}</span></small></div>
          <div class="title"><b>{{ v.kindLabel }}</b><small>{{ isR ? 'Receipt Voucher' : 'Payment Voucher' }}</small></div>
          <div class="no"><span>رقم</span><b class="ac-code">{{ v.serial }}</b><span>التاريخ {{ v.voucherDate }}</span></div>
        </header>
        <div class="amount"><span>المبلغ</span><b class="ac-code">{{ money(v.amount) }}</b><span>ر.س</span></div>
        <p class="row"><span>{{ isR ? 'استلمنا نحن' : 'صرفنا نحن' }}</span><b>{{ v.organization.name }}</b></p>
        <p class="row"><span>{{ isR ? 'من السادة' : 'إلى السادة' }}</span><b>{{ v.partyName }}</b></p>
        <p class="row"><span>مبلغ وقدره</span><b class="words">{{ v.amountWords }}</b></p>
        <p class="row"><span>وهو قيمة</span><b>{{ v.purpose }}</b></p>
        <p class="row"><span>{{ v.methodLabel }}</span><b>{{ v.cashAccountName || (v.partnerName ? `على حساب ${v.partnerName}` : '—') }}<template v-if="v.methodRef"> · رقم {{ v.methodRef }}</template></b></p>
        <p v-if="!v.lines" class="row"><span>{{ isR ? 'الحساب الدائن' : 'الحساب المدين' }}</span><b><span class="ac-code">{{ v.counterAccountCode }}</span> {{ v.counterAccountName }}</b></p>
        <p v-if="v.analytic.length" class="row"><span>التحليلي</span><b>{{ v.analytic.map((a) => `${a.name}${v!.analytic.length > 1 ? ` ${a.percent}%` : ''}`).join('، ') }}</b></p>
        <p v-if="v.projectName" class="row"><span>المشروع</span><b>{{ v.projectName }}</b></p>
        <p v-if="v.sourceType !== 'manual'" class="row"><span>المصدر</span><b>{{ v.sourceType === 'opportunity' ? 'فرصة تبرع' : v.sourceType === 'payroll' ? 'مسير رواتب شهر' : v.sourceType === 'membership' ? 'اشتراك عضوية، مطالبة' : v.sourceType === 'separation' ? 'مستحقات نهاية خدمة، ملف' : v.sourceType === 'comms' ? 'المعاملة الإدارية رقم' : v.sourceType === 'assets' ? 'الأصول الثابتة، الأصل' : 'مشروع المتجر' }} {{ v.sourceRef }}</b></p>
        <table v-if="v.lines" class="vlines">
          <thead><tr><th>الحساب</th><th>البيان</th><th>مدين</th><th>دائن</th></tr></thead>
          <tbody><tr v-for="(l, i) in v.lines" :key="i"><td><span class="ac-code">{{ l.accountCode }}</span> {{ l.accountName }}</td><td>{{ l.label }}</td><td class="ac-num">{{ l.debit ? money(l.debit) : '' }}</td><td class="ac-num">{{ l.credit ? money(l.credit) : '' }}</td></tr></tbody>
        </table>
        <footer>
          <div><span>المحاسب</span><b>{{ v.createdByName }}</b></div>
          <div><span>المراجع</span><b>&nbsp;</b></div>
          <div><span>المعتمد</span><b>{{ v.approvedAt ? v.actions.filter((a) => a.action === 'final')[0]?.actorName ?? '' : '' }}</b></div>
          <div><span>{{ isR ? 'المسلِّم' : 'المستلِم' }}</span><b>&nbsp;</b></div>
        </footer>
      </article>

      <aside class="side no-print">
        <div v-if="v.lockedSource" class="ac-warn">هذا السند صادر من الأصول الثابتة، فلا يُعدَّل من النظام المالي. يُعتمد أو يُرفض بالمراحل المعتادة، وأثره يظهر على الأصل مباشرة.</div>
        <section class="card pm-panel">
          <h2>القيود الناتجة</h2>
          <p v-if="!v.entries.length" class="pm-empty">يصدر القيد عند الاعتماد النهائي</p>
          <RouterLink v-for="e in v.entries" :key="e.id" :to="`/accounting/entries/${e.id}`" :class="['erow', e.status]">
            <span>القيد <b class="ac-code">{{ e.entryNo }}</b></span>
            <span class="pm-pill" :style="{ '--c': ENTRY_STATUS[e.status].color }">{{ ENTRY_STATUS[e.status].label }}</span>
            <small v-if="e.cancelReason" class="pm-muted">{{ e.cancelReason }}</small>
          </RouterLink>
        </section>
        <section class="card pm-panel">
          <h2>سجل الإجراءات</h2>
          <ol class="log">
            <li v-for="a in [...v.actions].reverse()" :key="a.id" :class="a.action">
              <b>{{ a.label }}</b><template v-if="a.stageName"> · {{ a.stageName }}</template>
              <div class="pm-muted">{{ a.actorName }} · {{ dt(a.at) }}</div>
              <div v-if="a.note" class="note">{{ a.note }}</div>
            </li>
          </ol>
        </section>
      </aside>
    </div>

    <div v-if="editing" class="modal-backdrop" @click.self="editing = false">
      <div class="modal modal-wide" style="max-width: 900px; padding: 0; background: none; box-shadow: none">
        <VoucherForm :kind="v.kind" :org-name="v.organization.name" :initial="{ ...v, analytic: v.analytic.map((a) => ({ analyticId: a.analyticId, percent: a.percent })) }" @saved="saved" @close="editing = false" />
      </div>
    </div>
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
</template>

<style scoped>
.vlines { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: .85rem; }
.vlines th, .vlines td { border-bottom: 1px solid var(--border); padding: 5px 6px; text-align: start; }
.ac-hero.payment::before { background: radial-gradient(460px 220px at 88% -10%, rgba(251,146,60,.45), transparent 70%), radial-gradient(520px 260px at 5% 130%, rgba(180,83,9,.5), transparent 70%); }
.stepper { display: flex; gap: 0; margin-bottom: 18px; overflow-x: auto; }
.step { flex: 1; min-width: 120px; display: flex; flex-direction: column; align-items: center; gap: 6px; position: relative; color: var(--muted); font-size: .84rem; }
.step::before { content: ''; position: absolute; top: 16px; inset-inline-start: -50%; width: 100%; height: 3px; background: var(--border); z-index: 0; }
.step:first-child::before { display: none; }
.step i { position: relative; z-index: 1; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-weight: 700; background: var(--surface); border: 2px solid var(--border); }
.step.done { color: var(--success); }
.step.done i { background: #10b981; border-color: #10b981; color: #fff; box-shadow: 0 0 14px rgba(16,185,129,.45); }
.step.done::before { background: #10b981; }
.step.now { color: #4f46e5; font-weight: 700; }
.step.now i { border-color: #6366f1; color: #4f46e5; animation: ring 1.8s infinite; }
@keyframes ring { 0% { box-shadow: 0 0 0 0 rgba(99,102,241,.5); } 100% { box-shadow: 0 0 0 12px rgba(99,102,241,0); } }
.layout { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 18px; align-items: start; }
.paper { --c: #0f766e; position: relative; overflow: hidden; background: #fff; border-radius: 16px; padding: 26px 30px; border: 2px solid var(--c); box-shadow: 0 20px 40px rgba(15,23,42,.08);
  background-image: radial-gradient(circle at 0 0, color-mix(in srgb, var(--c) 8%, transparent), transparent 35%); animation: pm-rise .5s var(--ease) both; }
.paper.payment { --c: #b45309; }
.paper header { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: center; border-bottom: 3px double var(--c); padding-bottom: 14px; margin-bottom: 16px; }
.paper header h2 { margin: 0; font-size: 1.1rem; }
.paper header small { color: var(--muted); }
.paper .title { text-align: center; display: flex; flex-direction: column; }
.paper .title b { font-size: 1.6rem; color: var(--c); }
.paper .title small { letter-spacing: 2px; }
.paper .no { display: flex; flex-direction: column; align-items: flex-end; color: var(--muted); font-size: .85rem; }
.paper .no b { font-size: 1.5rem; color: #dc2626; }
.amount { float: inline-end; margin: 0 0 10px 0; display: flex; gap: 8px; align-items: center; border: 2px solid var(--c); border-radius: 12px; padding: 6px 14px; color: var(--c); font-weight: 700; }
.amount b { font-size: 1.4rem; color: var(--text); }
.row { display: flex; gap: 12px; margin: 0; padding: 9px 0; border-bottom: 1px dotted #cbd5e1; clear: none; }
.row span { min-width: 110px; color: var(--c); font-weight: 700; }
.row .words { color: var(--c); }
.paper footer { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 40px; text-align: center; }
.paper footer div { display: flex; flex-direction: column; gap: 18px; }
.paper footer span { color: var(--muted); font-size: .85rem; }
.paper footer b { border-top: 1px solid #94a3b8; padding-top: 6px; min-height: 1.6em; font-size: .85rem; }
.paper.void { filter: saturate(.4); }
.stamp { position: absolute; top: 44%; left: 50%; transform: translate(-50%, -50%) rotate(-18deg); font-size: 4rem; font-weight: 900; color: rgba(220,38,38,.38); border: 6px solid rgba(220,38,38,.38);
  border-radius: 16px; padding: 0 30px; pointer-events: none; animation: stampin .6s var(--ease) both; }
@keyframes stampin { from { transform: translate(-50%, -50%) rotate(-18deg) scale(2.4); opacity: 0; } }
.side { display: flex; flex-direction: column; gap: 16px; }
.erow { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 9px 10px; border-radius: 10px; border: 1px solid var(--border); margin-bottom: 8px; color: inherit; }
.erow:hover { background: var(--surface-2); }
.erow small { width: 100%; }
.erow.cancelled { opacity: .75; }
.log { list-style: none; margin: 0; padding: 0; position: relative; }
.log li { position: relative; padding: 0 22px 14px 0; border-inline-start: 2px solid var(--border); margin-inline-start: 6px; padding-inline-start: 16px; }
.log li::before { content: ''; position: absolute; inset-inline-start: -7px; top: 3px; width: 12px; height: 12px; border-radius: 50%; background: var(--primary); }
.log li.reject::before, .log li.cancel::before, .log li.to_draft::before { background: #ef4444; }
.log li.return::before, .log li.request_draft::before, .log li.request_cancel::before { background: #f59e0b; }
.log li.final::before { background: #10b981; box-shadow: 0 0 10px #10b981; }
.note { background: var(--surface-2); border-radius: 8px; padding: 6px 10px; margin-top: 4px; font-size: .85rem; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } .paper { padding: 18px; } .paper header { grid-template-columns: 1fr; } .paper .no { align-items: flex-start; } }
@media print { .layout { display: block; } .paper { box-shadow: none; } }
</style>
