<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { fmtDate, hijri, num, sar, todayStr } from '../lib';
import { ITEM_COLOR, SEP_COLOR, type SepDetail, type SepItem, type Settlement } from '../separation';
import { loadSummary, rel } from '../self/ess';
import '../../projects/projects.css';
import '../hr.css';
import '../self/ess.css';

const props = defineProps<{ id: string }>();
const router = useRouter();
const toast = useToast();
const s = ref<SepDetail | null>(null);
const error = ref('');
const busy = ref(false);

async function load() {
  try {
    s.value = await api<SepDetail>(`/hr/separations/${props.id}`);
    adj.list = (s.value.settlement?.adjustments ?? []).map((a) => ({ ...a }));
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

async function run(fn: () => Promise<SepDetail>, ok: string) {
  if (busy.value) return;
  busy.value = true;
  try {
    s.value = await fn();
    adj.list = (s.value.settlement?.adjustments ?? []).map((a) => ({ ...a }));
    toast.success(ok);
    loadSummary(true);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}

// إخلاء بند
const act = reactive({ code: '', decision: 'clear' as 'clear' | 'block' | 'reopen', deduction: 0, note: '' });
function openItem(i: SepItem, decision: 'clear' | 'block' | 'reopen' = 'clear') {
  Object.assign(act, { code: i.code, decision, deduction: 0, note: '' });
}
const actItem = computed(() => s.value?.items.find((i) => i.code === act.code) ?? null);
const saveItem = () => run(() => api(`/hr/separations/${props.id}/items/${act.code}`, {
  method: 'POST', json: { decision: act.decision, deduction: act.decision === 'clear' ? act.deduction || 0 : undefined, note: act.note || null },
}), act.decision === 'clear' ? 'تم إخلاء البند' : act.decision === 'block' ? 'أُوقف البند بملاحظتك' : 'أُعيد فتح البند').then(() => { act.code = ''; });

// بيان المستحقات
const adj = reactive({ list: [] as { kind: 'addition' | 'deduction'; label: string; amount: number }[] });
const settle = () => run(() => api(`/hr/separations/${props.id}/settle`, { method: 'POST', json: { adjustments: adj.list.filter((a) => a.label && a.amount > 0) } }), 'أُعد بيان المستحقات وأُرسل للاعتماد');

// الاعتماد
const dec = reactive({ decision: 'approve' as 'approve' | 'return', note: '' });
const decide = () => run(() => api(`/hr/separations/${props.id}/decision`, { method: 'POST', json: { decision: dec.decision, note: dec.note || null } }),
  dec.decision === 'approve' ? 'تم الاعتماد' : 'أُعيد البيان لشؤون الموظفين').then(() => { dec.note = ''; });

const payDate = ref(todayStr());
const pay = () => run(() => api(`/hr/separations/${props.id}/pay`, { method: 'POST', json: { voucherDate: payDate.value } }), 'أُنشئ سند صرف المستحقات في النظام المالي');
function cancel() {
  const note = prompt('سبب إلغاء الملف');
  if (note) run(() => api(`/hr/separations/${props.id}/cancel`, { method: 'POST', json: { note } }), 'أُلغي الملف');
}

const st = computed<Settlement | null>(() => s.value?.settlement ?? s.value?.preview ?? null);
const STEPS = ['clearance', 'settlement', 'approved', 'paid'];
const stepIdx = computed(() => STEPS.indexOf(s.value?.status ?? ''));
const STEP_AR = ['إخلاء الطرف', 'بيان المستحقات واعتماده', 'إنهاء الخدمة والقيد', 'صرف المستحقات'];
const who = (i: SepItem) => i.approverName ?? i.roleName ?? i.kindLabel;
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-else-if="!s" class="ess-skeleton"><i /><i /><i /></div>
    <template v-else>
      <section class="ess-banner" :style="{ '--c': SEP_COLOR[s.status] }">
        <div class="row">
          <div>
            <p class="ess-kicker" style="color: rgba(255,255,255,.85)">ملف إنهاء خدمة رقم {{ s.separationNo }}{{ s.fromRequest ? ' · من طلب استقالة' : '' }}</p>
            <h1>{{ s.employee.fullName }}</h1>
            <p style="margin: 0; opacity: .92">{{ s.employee.jobTitle }} · {{ s.employee.unitName }} · {{ s.reasonLabel }} · آخر يوم عمل {{ fmtDate(s.lastWorkingDay) }}</p>
          </div>
          <div style="display: grid; gap: 8px; justify-items: end">
            <span class="ess-pill">{{ s.statusLabel }}</span>
            <small style="opacity: .85">فتحه {{ s.createdByName }} {{ rel(s.createdAt) }}</small>
          </div>
        </div>
      </section>

      <ol class="sep-steps">
        <li v-for="(t, i) in STEP_AR" :key="t" :class="{ done: s.status !== 'cancelled' && i < stepIdx, cur: i === stepIdx }"><b>{{ i + 1 }}</b><span>{{ t }}</span></li>
      </ol>

      <div class="ess-actions no-print" style="margin-bottom: 14px">
        <button class="btn btn-sm" @click="router.back()">→ رجوع</button>
        <RouterLink :to="`/hr/separations/${s.id}/print`" class="btn btn-sm">🖨️ نموذج إخلاء الطرف وبيان المستحقات</RouterLink>
        <button v-if="s.can.cancel" class="btn btn-sm btn-danger" @click="cancel">إلغاء الملف</button>
      </div>

      <div v-if="s.assetCustody?.length" class="custody-block no-print">
        <b>⚠ لدى الموظف عهدة أصول ثابتة ({{ s.assetCustody.length }})، ولا يُقبل إخلاء طرفه إلا بعد استلامها منه أو نقلها لموظف آخر.</b>
        <ul><li v-for="x in s.assetCustody" :key="x.id"><RouterLink :to="`/accounting/assets/${x.id}`">{{ x.code }} · {{ x.name }}</RouterLink></li></ul>
        <RouterLink to="/accounting/assets/custody" class="btn btn-sm">شاشة العهد في الأصول الثابتة</RouterLink>
      </div>

      <div class="ess-grid">
        <section class="card ess-card wide">
          <h2>بنود إخلاء الطرف <small class="pm-muted">{{ s.cleared }} من {{ s.items.length }}</small></h2>
          <div class="sep-items">
            <div v-for="(i, k) in s.items" :key="i.code" class="sep-item" :style="{ '--c': ITEM_COLOR[i.status], '--i': k }">
              <span class="dot">{{ i.status === 'cleared' ? '✓' : i.status === 'blocked' ? '!' : k + 1 }}</span>
              <div class="tx">
                <b>{{ i.name }}</b>
                <span class="pm-muted">{{ i.description }}</span>
                <span>المسؤول: <b>{{ who(i) }}</b> · <span :style="{ color: ITEM_COLOR[i.status] }">{{ i.statusLabel }}</span></span>
                <span v-if="i.actorName" class="pm-muted">{{ i.actorName }}{{ i.onBehalf ? ' (نيابة)' : '' }} · {{ rel(i.at) }}</span>
                <p v-if="i.note" class="note">{{ i.note }}</p>
                <p v-if="i.deduction" class="note" style="color: #b91c1c">خصم {{ sar(i.deduction) }} من المستحقات</p>
              </div>
              <div v-if="i.can" class="ess-actions">
                <button v-if="i.status !== 'cleared'" class="btn btn-sm btn-primary" @click="openItem(i, 'clear')">إخلاء</button>
                <button v-if="i.status === 'pending'" class="btn btn-sm" @click="openItem(i, 'block')">إيقاف بملاحظة</button>
                <button v-if="i.status !== 'pending'" class="btn btn-sm" @click="openItem(i, 'reopen')">إعادة فتح</button>
              </div>
            </div>
          </div>
          <form v-if="actItem" class="sep-act" @submit.prevent="saveItem">
            <b>{{ act.decision === 'clear' ? 'إخلاء' : act.decision === 'block' ? 'إيقاف' : 'إعادة فتح' }} بند «{{ actItem.name }}»</b>
            <label v-if="act.decision === 'clear' && actItem.allowDeduction" class="field"><span>مبلغ يُخصم من المستحقات (عهدة مفقودة أو مطالبة)</span>
              <input v-model.number="act.deduction" type="number" min="0" step="0.01" class="input" /></label>
            <label class="field"><span>{{ act.decision === 'block' ? 'ما الذي يمنع الإخلاء؟ (إلزامي)' : act.deduction ? 'سبب الخصم (إلزامي)' : 'ملاحظة' }}</span>
              <textarea v-model="act.note" class="input" rows="2" :required="act.decision === 'block' || act.deduction > 0" /></label>
            <div class="ess-actions"><button class="btn btn-primary" :disabled="busy">حفظ</button><button type="button" class="btn" @click="act.code = ''">إلغاء</button></div>
          </form>
        </section>

        <section v-if="st" class="card ess-card">
          <h2>{{ s.settlement ? 'بيان المستحقات' : 'معاينة المستحقات (تقديرية)' }}</h2>
          <table class="table sep-table">
            <tbody>
              <tr><td>مكافأة نهاية الخدمة <small class="pm-muted">{{ st.eos.years }} سنة و{{ st.eos.months }} شهر و{{ st.eos.days }} يوم · {{ st.eos.explanation }}</small></td><td class="hr-num">{{ sar(st.eos.amount) }}</td></tr>
              <tr><td>بدل رصيد الإجازات <small class="pm-muted">{{ num(st.leaveDays) }} يوم × {{ sar(st.dailyWage) }}</small></td><td class="hr-num">{{ sar(st.leaveEncashment) }}</td></tr>
              <tr v-for="(a, k) in st.adjustments.filter((x) => x.kind === 'addition')" :key="`a${k}`"><td>{{ a.label }}</td><td class="hr-num">{{ sar(a.amount) }}</td></tr>
              <tr class="sum"><td>إجمالي المستحقات</td><td class="hr-num">{{ sar(st.gross) }}</td></tr>
              <tr v-if="st.advancesTotal"><td>رصيد السلف المتبقي</td><td class="hr-num neg">− {{ sar(st.advancesTotal) }}</td></tr>
              <tr v-if="st.clearanceDeductions"><td>خصومات إخلاء الطرف</td><td class="hr-num neg">− {{ sar(st.clearanceDeductions) }}</td></tr>
              <tr v-for="(a, k) in st.adjustments.filter((x) => x.kind === 'deduction')" :key="`d${k}`"><td>{{ a.label }}</td><td class="hr-num neg">− {{ sar(a.amount) }}</td></tr>
              <tr class="net"><td>صافي المستحق للموظف</td><td class="hr-num">{{ sar(st.net) }}</td></tr>
            </tbody>
          </table>
          <p class="pm-muted">راتب الشهر الأخير حتى آخر يوم عمل يُصرف في مسير الرواتب المعتاد.{{ s.settlement ? ` أعده ${s.settlement.computedByName} ${rel(s.settlement.computedAt)}.` : '' }}</p>
          <template v-if="s.can.settle">
            <p class="hr-sec">بنود إضافية</p>
            <div v-for="(a, k) in adj.list" :key="k" style="display: grid; grid-template-columns: 120px 1fr 130px auto; gap: 6px; margin-bottom: 6px">
              <select v-model="a.kind" class="input"><option value="addition">إضافة</option><option value="deduction">خصم</option></select>
              <input v-model="a.label" class="input" placeholder="الوصف، مثل: بدل مهلة الإشعار" />
              <input v-model.number="a.amount" type="number" min="0" step="0.01" class="input" />
              <button type="button" class="btn btn-sm" @click="adj.list.splice(k, 1)">✕</button>
            </div>
            <div class="ess-actions">
              <button type="button" class="btn btn-sm" @click="adj.list.push({ kind: 'addition', label: '', amount: 0 })">+ بند</button>
              <button class="btn btn-sm btn-primary" :disabled="busy" @click="settle">{{ s.settlement ? 'إعادة حساب البيان' : 'إعداد بيان المستحقات وإرساله للاعتماد' }}</button>
            </div>
          </template>
          <p v-else-if="s.status === 'clearance' && s.viewer.hr" class="pm-muted">يُعد البيان بعد إخلاء كل البنود.</p>
        </section>

        <section v-if="s.settlement || s.status === 'settlement'" class="card ess-card">
          <h2>الاعتماد والصرف</h2>
          <div class="ess-steps">
            <div v-for="(x, k) in s.stages" :key="k" :class="['ess-step', { cur: x.current }]" :style="{ '--i': k, '--c': x.done ? '#10b981' : '#94a3b8' }">
              <span class="dot">{{ x.done ? '✓' : k + 1 }}</span>
              <div><b>{{ x.name }}</b><span>{{ x.done ? 'اعتُمد' : x.current ? 'بانتظار القرار' : 'لاحقًا' }}</span></div>
            </div>
          </div>
          <div v-if="s.plan?.problems.length" class="alert alert-error">قبل الاعتماد أكمل: {{ s.plan.problems.join('، ') }}</div>
          <div v-if="s.can.decide" class="sep-act ess-decide">
            <div class="ess-filters">
              <button type="button" :class="{ on: dec.decision === 'approve' }" style="--c: #10b981" @click="dec.decision = 'approve'">✓ اعتماد</button>
              <button type="button" :class="{ on: dec.decision === 'return' }" style="--c: #f97316" @click="dec.decision = 'return'">↩ إرجاع للتعديل</button>
            </div>
            <label class="field"><span>{{ dec.decision === 'return' ? 'سبب الإرجاع (إلزامي)' : 'ملاحظة' }}</span><textarea v-model="dec.note" class="input" rows="2" /></label>
            <button class="btn btn-primary" :disabled="busy" @click="decide">تأكيد القرار</button>
          </div>
          <p v-else-if="s.can.decideReason && s.status === 'settlement' && s.viewer.hr" class="pm-muted">{{ s.can.decideReason }}</p>
          <div v-if="s.entry" class="ess-hints" style="margin-top: 10px">
            <span>القيد رقم {{ s.entry.entryNo }}</span>
            <span v-if="s.approvedAt">اعتُمد {{ fmtDate(s.approvedAt) }}</span>
          </div>
          <div v-if="s.voucher" class="ess-item" style="--c: #0ea5e9">
            <span class="em">💳</span><span class="tx"><b>سند صرف رقم {{ s.voucher.serial }}</b><span>{{ sar(s.voucher.amount) }} · {{ s.voucher.statusLabel }}</span></span>
            <RouterLink :to="`/accounting/vouchers/${s.voucher.id}`" class="btn btn-sm">فتح السند</RouterLink>
          </div>
          <div v-if="s.can.pay" class="sep-act">
            <b>صرف المستحقات</b>
            <label class="field"><span>تاريخ سند الصرف</span><input v-model="payDate" type="date" class="input" /></label>
            <button class="btn btn-primary" :disabled="busy" @click="pay">إنشاء سند الصرف في النظام المالي</button>
          </div>
        </section>

        <section class="card ess-card" :class="{ wide: !st }">
          <h2>سجل الملف</h2>
          <ol class="ess-timeline">
            <li v-for="(h, k) in [...s.history].reverse()" :key="k" :style="{ '--i': k }">
              <b>{{ h.label }}</b><template v-if="h.stageName"> ({{ h.stageName }})</template> — {{ h.actorName }}
              <span>{{ rel(h.at) }} · {{ hijri(h.at) }}</span>
              <p v-if="h.note" class="pm-muted" style="margin: 2px 0 0">{{ h.note }}</p>
            </li>
          </ol>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.custody-block { border: 2px solid #dc2626; background: #fef2f2; color: #7f1d1d; border-radius: 14px; padding: 12px 16px; margin-bottom: 14px; }
.custody-block ul { margin: 6px 0 10px; padding-inline-start: 20px; }
.sep-steps { list-style: none; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 0; margin: 0 0 14px; }
.sep-steps li { display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); font-size: .88rem; }
.sep-steps li b { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--surface-2); flex-shrink: 0; }
.sep-steps li.done { color: #047857; border-color: #a7f3d0; background: #ecfdf5; }
.sep-steps li.done b { background: #10b981; color: #fff; }
.sep-steps li.cur { color: var(--text); border-color: #fcd34d; background: #fffbeb; font-weight: 600; }
.sep-steps li.cur b { background: #f59e0b; color: #fff; animation: ess-pulse 1.8s infinite; }
.sep-items { display: grid; gap: 10px; }
.sep-item { display: grid; grid-template-columns: 36px 1fr auto; gap: 12px; align-items: start; padding: 12px; border-radius: 14px; border: 1px solid var(--border); border-inline-start: 4px solid var(--c);
  animation: ess-in .4s calc(var(--i) * 50ms) var(--ease) both; }
.sep-item .dot { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--c); color: #fff; font-weight: 700; }
.sep-item .tx { display: grid; gap: 2px; min-width: 0; }
.sep-item .note { margin: 4px 0 0; padding: 6px 10px; border-radius: 10px; background: var(--surface-2); font-size: .84rem; }
.sep-act { margin-top: 12px; padding: 12px; border-radius: 14px; border: 1px dashed var(--border); display: grid; gap: 8px; }
.sep-table td { white-space: normal; }
.sep-table small { display: block; }
.sep-table .neg { color: #b91c1c; }
.sep-table .sum td { font-weight: 700; background: var(--surface-2); }
.sep-table .net td { font-weight: 800; font-size: 1.05rem; color: #047857; background: #ecfdf5; }
@media (max-width: 760px) {
  .sep-steps { grid-template-columns: 1fr 1fr; }
  .sep-item { grid-template-columns: 36px 1fr; }
  .sep-item .ess-actions { grid-column: 1 / -1; }
}
</style>
