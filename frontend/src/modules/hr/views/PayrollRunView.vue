<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import CountUp from '../../../shared/CountUp.vue';
import { P, STATUS_COLOR, fmtDate, num, sar, todayStr } from '../lib';
import '../../../shared/module.css';
import '../hr.css';

/** كشف رواتب شهر: الأسطر وتعديلاتها، مراحل الاعتماد، القيد المحاسبي، سندات الصرف وكشوف البنوك */
interface Line {
  employeeId: string; employeeNo: number; fullName: string; unitName: string; jobTitle: string; iban: string | null;
  items: { code: string; name: string; full: number; earned: number }[]; gross: number; workedDays: number; ratio: number; dailyWage: number; unpaidDays: number; unpaidDeduction: number;
  attendance: { tracked: boolean; absentDays: number; lateMinutes: number; missingOut: number; overridden: boolean };
  absenceDeduction: number; lateDeduction: number; additions: { code: string; amount: number; note: string | null }[];
  otherDeduction: number; otherDeductionNote: string | null; advanceDeduction?: number; earned: number; gosiEmployee: number; gosiEmployer: number; totalDeductions: number; net: number; employerCost: number;
  contract?: { basis: 'monthly' | 'daily' | 'hourly' | 'task'; rate: number; units: number; manualUnits: boolean; note: string | null };
}
interface Voucher { id: string; serial: number; amount: number; status: string; statusLabel: string; purpose: string; cashAccountName: string; voucherDate: string }
interface Run {
  id: string; month: string; monthLabel: string; kind: 'staff' | 'contractors'; kindLabel: string; payBasisLabels: Record<string, string>; unitLabels: Record<string, string>;
  status: string; statusLabel: string; lines: Line[]; totals: Record<string, number>; warnings: string[];
  stages: { name: string; current: boolean; done: boolean }[]; stageName: string | null;
  history: { action: string; label: string; stageName: string | null; note: string | null; actorName: string; at: string; employeeId?: string; employeeName?: string | null; changes?: { field: string; label: string; before: number | string | null; after: number | string | null }[] }[];
  entry: { id: string; entryNo: string; status: string } | null; vouchers: Voucher[]; createdByName: string; approvedAt: string | null;
  allowanceTypes: { code: string; name: string }[]; planError: string | null;
  edits: { employeeId: string | null; employeeName: string | null; reason: string | null; actorName: string; at: string; changes: { field: string; label: string; before: number | string | null; after: number | string | null }[] }[];
  entryPreview: { account: string; debit: number; credit: number; label: string; analytic: string }[];
  voucherPlan: { partyName: string | null; cashAccountName: string; payableAccount: string; amount: number; items: string[]; employees: number }[];
  bankSheets: { cashAccountId: string; cashAccountName: string; total: number; rows: { employeeNo: number; fullName: string; iban: string | null; amount: number }[] }[];
  can: { edit: boolean; submit: boolean; cancel: boolean; decide: boolean; reopen: boolean; vouchers: boolean };
}
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const router = useRouter();
const run = ref<Run | null>(null);
const tab = ref<'lines' | 'edits' | 'entry' | 'pay' | 'history'>('lines');
const q = ref('');
const busy = ref(false);
async function load() {
  try {
    run.value = await api<Run>(`/hr/payroll-runs/${props.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
async function act(path: string, json: unknown = {}, ok = '') {
  busy.value = true;
  try {
    run.value = await api<Run>(`/hr/payroll-runs/${props.id}/${path}`, { method: 'POST', json });
    if (ok) toast.success(ok);
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  } finally {
    busy.value = false;
  }
}
const typeName = (code: string) => run.value?.allowanceTypes.find((t) => t.code === code)?.name ?? code;
const lines = computed(() => (run.value?.lines ?? []).filter((l) => !q.value || l.fullName.includes(q.value) || l.unitName.includes(q.value) || String(l.employeeNo) === q.value));
const edited = computed(() => new Set((run.value?.edits ?? []).map((x) => x.employeeId)));
/** بنود الإضافات تُحفظ برموزها، فتُعرض بأسمائها */
const showVal = (field: string, v: number | string | null) => (v === null ? '—' : field === 'additionItems' ? String(v).replace(/([a-z_0-9]+):/g, (_, c: string) => `${addName({ code: c, note: null })}:`) : v);
const fmtAt = (at: string) => new Date(at).toLocaleString('ar-SA-u-ca-gregory');
const attDed = (l: Line) => l.unpaidDeduction + l.absenceDeduction + l.lateDeduction;
const editable = computed(() => !!run.value?.can.edit);
const hasStages = computed(() => !!run.value?.stages.length);
const isC = computed(() => run.value?.kind === 'contractors');
const addName = (a: { code: string; note: string | null }) => (isC.value ? a.note || 'إضافة' : typeName(a.code));

// تعديل سطر الموظف
const edit = reactive({
  line: null as Line | null, units: 0, rate: 0, note: '', override: false, absentDays: 0, lateMinutes: 0, additions: [] as { code: string; amount: number; note: string }[], otherDeduction: 0, otherDeductionNote: '', reason: '',
});
function openLine(l: Line) {
  Object.assign(edit, {
    line: l, units: l.contract?.units ?? 0, rate: l.contract?.rate ?? 0, note: l.contract?.note ?? '', override: l.attendance.overridden, absentDays: l.attendance.absentDays, lateMinutes: l.attendance.lateMinutes,
    additions: l.additions.map((a) => ({ code: a.code, amount: a.amount, note: a.note ?? '' })), otherDeduction: l.otherDeduction, otherDeductionNote: l.otherDeductionNote ?? '', reason: '',
  });
}
async function saveLine() {
  if (!edit.line) return;
  busy.value = true;
  try {
    const l = edit.line;
    run.value = await api<Run>(`/hr/payroll-runs/${props.id}/lines/${l.employeeId}`, {
      method: 'PUT',
      json: {
        ...(l.contract ? {
          rate: Number(edit.rate) || 0, note: edit.note || null,
          ...(l.contract.basis !== 'monthly' && Number(edit.units) !== l.contract.units ? { units: Number(edit.units) || 0 } : {}),
        } : {}),
        overrideAttendance: l.attendance.tracked && (edit.override || l.attendance.overridden) ? edit.override : undefined,
        absentDays: edit.override ? Number(edit.absentDays) : undefined, lateMinutes: edit.override ? Number(edit.lateMinutes) : undefined,
        additions: edit.additions.filter((a) => (a.code || l.contract) && Number(a.amount) > 0).map((a) => ({ code: a.code, amount: Number(a.amount), note: a.note || null })),
        otherDeduction: Number(edit.otherDeduction) || 0, otherDeductionNote: edit.otherDeductionNote || null, reason: edit.reason.trim() || null,
      },
    });
    edit.line = null;
    toast.success('عُدّل السطر');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}

// القرارات
const dlg = reactive({ kind: '' as '' | 'approve' | 'return' | 'reopen' | 'vouchers', note: '', date: todayStr() });
async function confirmDlg() {
  const k = dlg.kind;
  let ok = false;
  if (k === 'approve' || k === 'return') ok = await act('decision', { decision: k, note: dlg.note || null }, k === 'approve' ? 'سُجلت الموافقة' : 'أُعيد الكشف للتعديل');
  else if (k === 'reopen') ok = await act('reopen', { note: dlg.note }, 'أُلغي الاعتماد وعُكس القيد');
  else if (k === 'vouchers') ok = await act('vouchers', { voucherDate: dlg.date }, 'أُنشئت سندات الصرف في النظام المالي');
  if (ok) {
    dlg.kind = '';
    dlg.note = '';
    if (k === 'vouchers') tab.value = 'pay';
  }
}
const lastStage = computed(() => {
  const s = run.value?.stages ?? [];
  const i = s.findIndex((x) => x.current);
  return i === s.length - 1;
});
async function cancelRun() {
  if (!confirm('إلغاء هذا الكشف؟ يمكنك بعدها إصدار كشف جديد للشهر نفسه.')) return;
  if (await act('cancel', {}, 'أُلغي الكشف')) router.push('/hr/payroll');
}

function csv(name: string, head: string[], rows: (string | number)[][]) {
  const text = '﻿' + [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name}.csv`;
  a.click();
}
function exportLines() {
  const r = run.value!;
  const codes = [...new Set(r.lines.flatMap((l) => l.items.map((i) => i.code)))];
  if (r.kind === 'contractors') {
    csv(`كشف-المتعاونين-${r.month}`, ['الرقم', 'المتعاون', 'الوحدة', 'طريقة الأجر', 'العدد', 'القيمة', 'الأتعاب', 'إضافات', 'المستحق', 'خصم الحضور', 'استقطاعات', 'الصافي', 'ملاحظة', 'الآيبان'],
      r.lines.map((l) => [l.employeeNo, l.fullName, l.unitName, r.payBasisLabels[l.contract?.basis ?? ''] ?? '', l.contract?.units ?? '', l.contract?.rate ?? '', l.items[0]?.earned ?? 0,
        l.additions.reduce((s, a) => s + a.amount, 0), l.earned, attDed(l), l.otherDeduction, l.net, l.contract?.note ?? '', l.iban ?? '']));
    return;
  }
  csv(`كشف-رواتب-${r.month}`, ['الرقم', 'الموظف', 'الوحدة', ...codes.map(typeName), 'إضافات', 'المستحق', 'خصم الحضور والإجازات', 'التأمينات', 'استقطاعات أخرى', 'أقساط السلف', 'الصافي', 'الآيبان'],
    r.lines.map((l) => [l.employeeNo, l.fullName, l.unitName, ...codes.map((c) => l.items.find((i) => i.code === c)?.earned ?? 0), l.additions.reduce((s, a) => s + a.amount, 0), l.earned,
      attDed(l), l.gosiEmployee, l.otherDeduction, l.advanceDeduction ?? 0, l.net, l.iban ?? '']));
}
function exportBank(b: Run['bankSheets'][number]) {
  csv(`تحويل-${b.cashAccountName}-${run.value!.month}`, ['الرقم', 'الموظف', 'الآيبان', 'المبلغ'], b.rows.map((x) => [x.employeeNo, x.fullName, x.iban ?? '', x.amount.toFixed(2)]));
}
const totalDebit = computed(() => run.value?.entryPreview.reduce((s, l) => s + l.debit, 0) ?? 0);
const totalCredit = computed(() => run.value?.entryPreview.reduce((s, l) => s + l.credit, 0) ?? 0);
</script>

<template>
  <div v-if="run">
    <section class="pm-hero hr-hero">
      <div>
        <p class="pm-kicker"><RouterLink to="/hr/payroll" class="pm-link">مسير الرواتب</RouterLink></p>
        <h1>{{ isC ? 'كشف المتعاونين' : 'كشف رواتب' }} {{ run.monthLabel }}</h1>
        <p class="pm-sub">
          <span class="pm-tag" :style="{ background: `${STATUS_COLOR[run.status]}22`, color: STATUS_COLOR[run.status] }">{{ run.statusLabel }}</span>
          <template v-if="run.stageName"> · بانتظار: {{ run.stageName }}</template>
          · أعده {{ run.createdByName }}<template v-if="run.approvedAt"> · اعتُمد {{ fmtDate(run.approvedAt) }}</template>
        </p>
      </div>
      <div class="pm-actions no-print">
        <button v-if="run.can.edit" class="btn hr-ghost" :disabled="busy" @click="act('recalc', {}, 'أُعيد احتساب الكشف من البيانات الحالية')">إعادة الاحتساب</button>
        <button v-if="run.can.submit" class="btn hr-glow" :disabled="busy || !!run.planError" @click="act('submit', {}, hasStages ? 'رُفع الكشف للاعتماد' : 'اعتُمد الكشف وصدر القيد')">{{ hasStages ? 'رفع للاعتماد' : 'اعتماد وإصدار القيد' }}</button>
        <template v-if="run.can.decide">
          <button class="btn hr-glow" :disabled="busy" @click="dlg.kind = 'approve'">{{ lastStage ? 'اعتماد نهائي' : 'موافقة' }}</button>
          <button class="btn hr-ghost" :disabled="busy" @click="dlg.kind = 'return'">إرجاع للتعديل</button>
        </template>
        <button v-if="run.can.vouchers" class="btn hr-glow" :disabled="busy" @click="dlg.kind = 'vouchers'">إنشاء سندات الصرف</button>
        <button v-if="run.can.reopen" class="btn hr-ghost" :disabled="busy" @click="dlg.kind = 'reopen'">إلغاء الاعتماد</button>
        <button v-if="run.can.cancel" class="btn btn-danger" :disabled="busy" @click="cancelRun">إلغاء الكشف</button>
      </div>
    </section>

    <div v-if="run.stages.length" class="hr-steps">
      <div class="done">الإعداد</div>
      <div v-for="s in run.stages" :key="s.name" :class="{ done: s.done, cur: s.current }">{{ s.name }}</div>
      <div :class="{ done: run.status === 'approved' }">القيد المحاسبي</div>
      <div :class="{ done: run.vouchers.some((v) => v.status !== 'cancelled' && v.status !== 'rejected') }">سندات الصرف</div>
    </div>

    <div v-if="run.planError" class="alert alert-error">
      {{ run.planError }}. أكمله من <RouterLink v-if="session.can(P.settings)" to="/hr/settings?tab=accounting" class="pm-link">الإعدادات ← الربط المحاسبي والبدلات</RouterLink><template v-else>الإعدادات</template> ثم اضغط «إعادة الاحتساب».
    </div>
    <div v-if="run.warnings.length" class="alert alert-warn"><b>تنبيهات:</b> {{ run.warnings.join(' · ') }}</div>

    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #a78bfa; --i: 0"><span>{{ isC ? 'المتعاونون' : 'الموظفون' }}</span><strong><CountUp :value="run.totals.employees" /></strong><small>{{ run.totals.missingIban ? `${run.totals.missingIban} بدون آيبان` : 'كل الحسابات البنكية مكتملة' }}</small></div>
      <div class="pm-kpi" style="--a: #0ea5e9; --i: 1"><span>إجمالي المستحق</span><strong><CountUp :value="run.totals.gross" :decimals="2" /></strong><small>إضافات {{ sar(run.totals.additions) }}</small></div>
      <div class="pm-kpi" style="--a: #ef4444; --i: 2"><span>خصم الغياب والتأخير</span><strong><CountUp :value="run.totals.absenceDeduction + run.totals.lateDeduction + run.totals.unpaidDeduction" :decimals="2" /></strong><small>بدون أجر {{ sar(run.totals.unpaidDeduction) }}</small></div>
      <div class="pm-kpi" style="--a: #f59e0b; --i: 3"><span>{{ isC ? 'الاستقطاعات' : 'التأمينات والاستقطاعات' }}</span><strong><CountUp :value="run.totals.gosiEmployee + run.totals.otherDeduction + (run.totals.advanceDeduction ?? 0)" :decimals="2" /></strong><small>استقطاعات أخرى {{ sar(run.totals.otherDeduction) }}<template v-if="run.totals.advanceDeduction"> · أقساط سلف {{ sar(run.totals.advanceDeduction) }}</template></small></div>
      <div class="pm-kpi" style="--a: #10b981; --i: 4"><span>{{ isC ? 'صافي الأتعاب' : 'صافي الرواتب' }}</span><strong><CountUp :value="run.totals.net" :decimals="2" /></strong><small>التكلفة الكاملة {{ sar(run.totals.employerCost) }}</small></div>
    </div>

    <div class="hr-tabs no-print">
      <button :class="['hr-tab', { on: tab === 'lines' }]" @click="tab = 'lines'">أسطر الكشف</button>
      <button :class="['hr-tab', { on: tab === 'entry' }]" @click="tab = 'entry'">القيد المحاسبي</button>
      <button :class="['hr-tab', { on: tab === 'pay' }]" @click="tab = 'pay'">الصرف والبنوك</button>
      <button :class="['hr-tab', { on: tab === 'edits' }]" @click="tab = 'edits'">التعديلات<template v-if="run.edits.length"> ({{ run.edits.length }})</template></button>
      <button :class="['hr-tab', { on: tab === 'history' }]" @click="tab = 'history'">سجل الاعتماد</button>
    </div>

    <section v-if="tab === 'lines'" class="card pm-panel">
      <div class="pm-row-head no-print">
        <input v-model="q" class="input" style="max-width: 240px" placeholder="بحث بالاسم أو الوحدة" />
        <div style="display: flex; gap: 6px"><button class="btn btn-sm" @click="exportLines">تصدير Excel (CSV)</button><button class="btn btn-sm" onclick="print()">طباعة</button></div>
      </div>
      <p v-if="editable && isC" class="pm-muted no-print">اضغط على سطر المتعاون لتعديل العدد أو القيمة أو إضافة مبلغ أو استقطاع، بحرية كاملة قبل الرفع للاعتماد.</p>
      <p v-else-if="editable" class="pm-muted no-print">اضغط على سطر الموظف لتعديل الحضور أو إضافة بدل أو استقطاع (سلفة أو جزاء) لهذا الشهر.</p>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>{{ isC ? 'المتعاون' : 'الموظف' }}</th><th>{{ isC ? 'الأتعاب' : 'بنود الراتب' }}</th><th>المستحق</th><th>الحضور</th><th>خصم الحضور والإجازات</th><th>{{ isC ? 'الاستقطاعات' : 'التأمينات والاستقطاعات' }}</th><th>الصافي</th></tr></thead>
          <tbody>
            <tr v-for="l in lines" :key="l.employeeId" :class="{ 'hr-edited': edited.has(l.employeeId) }" :style="{ cursor: editable ? 'pointer' : '' }" @click="editable && openLine(l)">
              <td><b>{{ l.fullName }}</b><button v-if="edited.has(l.employeeId)" type="button" class="pm-tag hr-edited-tag" title="عرض التعديلات" @click.stop="tab = 'edits'">عُدّل يدويًا</button><span class="pm-muted">{{ l.unitName }} · {{ l.jobTitle }}</span><span v-if="l.ratio < 1" class="hr-mini">عمل {{ l.workedDays }} يومًا من الشهر</span></td>
              <td>
                <template v-if="l.contract">
                  <span class="pm-tag hr-tag-contractor">{{ run.payBasisLabels[l.contract.basis] }}</span>
                  <span class="hr-mini">{{ l.contract.basis === 'monthly' ? `${num(l.contract.rate)} شهريًا` : `${num(l.contract.units)} ${run.unitLabels[l.contract.basis]} × ${num(l.contract.rate)}` }}</span>
                  <span v-if="l.contract.manualUnits" class="hr-mini">العدد مُدخل يدويًا</span>
                  <span v-if="l.contract.note" class="hr-mini">{{ l.contract.note }}</span>
                </template>
                <span v-else v-for="i in l.items" :key="i.code" class="hr-mini">{{ i.name }}: {{ num(i.earned) }}</span>
                <span v-for="(a, k) in l.additions" :key="k" class="hr-mini" style="color: var(--success)">+ {{ addName(a) }}: {{ num(a.amount) }}</span>
              </td>
              <td class="pm-money">{{ sar(l.earned) }}</td>
              <td>
                <template v-if="l.attendance.tracked">
                  <span class="hr-mini" :style="{ color: l.attendance.absentDays ? 'var(--danger)' : '' }">غياب {{ l.attendance.absentDays }} يوم</span>
                  <span class="hr-mini">تأخير {{ l.attendance.lateMinutes }} د</span>
                  <span v-if="l.attendance.overridden" class="pm-tag">معدّل يدويًا</span>
                </template>
                <span v-else-if="l.contract?.basis === 'daily' && !l.contract.manualUnits" class="hr-mini">الأيام من الحضور: {{ num(l.contract.units) }}</span>
                <span v-else class="pm-muted">غير خاضع</span>
              </td>
              <td class="hr-num" :style="{ color: attDed(l) ? 'var(--danger)' : '' }">
                {{ attDed(l) ? sar(attDed(l)) : '—' }}
                <span v-if="l.unpaidDays" class="hr-mini">بدون أجر {{ l.unpaidDays }} يوم</span>
              </td>
              <td class="hr-num">
                <span v-if="!isC" class="hr-mini">تأمينات: {{ num(l.gosiEmployee) }}</span>
                <span v-else-if="!l.otherDeduction" class="pm-muted">—</span>
                <span v-if="l.otherDeduction" class="hr-mini" style="color: var(--danger)">{{ l.otherDeductionNote ?? 'استقطاع' }}: {{ num(l.otherDeduction) }}</span>
                <span v-if="l.advanceDeduction" class="hr-mini" style="color: #7c3aed">قسط سلفة: {{ num(l.advanceDeduction) }}</span>
              </td>
              <td class="pm-money" style="color: var(--success)">{{ sar(l.net) }}<span v-if="!l.iban" class="hr-mini" style="color: var(--danger)">بدون آيبان</span></td>
            </tr>
          </tbody>
          <tfoot><tr class="hr-tot"><td colspan="2">الإجمالي</td><td class="pm-money">{{ sar(run.totals.gross) }}</td><td></td>
            <td class="hr-num">{{ sar(run.totals.absenceDeduction + run.totals.lateDeduction + run.totals.unpaidDeduction) }}</td><td class="hr-num">{{ sar(run.totals.gosiEmployee + run.totals.otherDeduction + (run.totals.advanceDeduction ?? 0)) }}</td><td class="pm-money">{{ sar(run.totals.net) }}</td></tr></tfoot>
        </table>
      </div>
    </section>

    <section v-if="tab === 'entry'" class="card pm-panel">
      <div class="pm-row-head">
        <h2>{{ isC ? 'قيد استحقاق أتعاب المتعاونين' : 'قيد استحقاق الرواتب' }}</h2>
        <RouterLink v-if="run.entry" :to="`/accounting/entries/${run.entry.id}`" class="btn btn-sm">فتح القيد {{ run.entry.entryNo }} في النظام المالي</RouterLink>
      </div>
      <p class="pm-muted">{{ run.entry ? 'صدر هذا القيد ورُحّل عند الاعتماد النهائي.' : 'معاينة: يصدر هذا القيد ويُرحّل تلقائيًا بتاريخ آخر يوم في الشهر عند الاعتماد النهائي.' }}
        المصروف محمّل على الحساب التحليلي للوحدة الإدارية لكل {{ isC ? 'متعاون' : 'موظف' }}.</p>
      <div v-if="run.entryPreview.length" class="table-wrap">
        <table class="table">
          <thead><tr><th>الحساب</th><th>البيان</th><th>الحساب التحليلي</th><th>مدين</th><th>دائن</th></tr></thead>
          <tbody>
            <tr v-for="(l, i) in run.entryPreview" :key="i">
              <td>{{ l.account }}</td><td>{{ l.label }}</td><td>{{ l.analytic || '—' }}</td>
              <td class="hr-num">{{ l.debit ? num(l.debit) : '' }}</td><td class="hr-num">{{ l.credit ? num(l.credit) : '' }}</td>
            </tr>
          </tbody>
          <tfoot><tr class="hr-tot"><td colspan="3">الإجمالي</td><td class="hr-num">{{ num(totalDebit) }}</td><td class="hr-num">{{ num(totalCredit) }}</td></tr></tfoot>
        </table>
      </div>
      <p v-else class="pm-empty">لا تتوفر معاينة القيد حتى يكتمل الربط المحاسبي.</p>
    </section>

    <template v-if="tab === 'pay'">
      <section class="card pm-panel">
        <h2>سندات الصرف</h2>
        <p class="pm-muted"><template v-if="isC">يصدر سند صرف مستقل لكل متعاون.</template><template v-else>يصدر سند صرف مستقل لكل بنك وحساب استحقاق، حسب البنك المحدد لكل بند في تبويب البدلات.</template> تمر السندات بعد إنشائها بمراحل اعتماد سندات الصرف في النظام المالي.</p>
        <div v-if="run.vouchers.length" class="table-wrap">
          <table class="table">
            <thead><tr><th>رقم السند</th><th>البنك</th><th>البيان</th><th>المبلغ</th><th>الحالة</th></tr></thead>
            <tbody>
              <tr v-for="v in run.vouchers" :key="v.id">
                <td><RouterLink :to="`/accounting/vouchers/${v.id}`" class="pm-link">{{ v.serial }}</RouterLink><span class="hr-mini">{{ fmtDate(v.voucherDate) }}</span></td>
                <td>{{ v.cashAccountName }}</td><td>{{ v.purpose }}</td><td class="pm-money">{{ sar(v.amount) }}</td>
                <td><span class="pm-tag" :style="{ background: `${STATUS_COLOR[v.status] ?? '#94a3b8'}22`, color: STATUS_COLOR[v.status] ?? '#64748b' }">{{ v.statusLabel }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <template v-else>
          <p v-if="run.status !== 'approved'" class="pm-muted"><b>بعد الاعتماد النهائي ستُنشأ هذه السندات:</b></p>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>البنك</th><th>حساب الاستحقاق</th><th>{{ isC ? 'المتعاون' : 'البنود' }}</th><th v-if="!isC">الموظفون</th><th>المبلغ</th></tr></thead>
              <tbody>
                <tr v-for="(v, i) in run.voucherPlan" :key="i"><td><b>{{ v.cashAccountName }}</b></td><td>{{ v.payableAccount }}</td><td>{{ v.partyName ?? v.items.join('، ') }}</td><td v-if="!isC" class="hr-num">{{ v.employees }}</td><td class="pm-money">{{ sar(v.amount) }}</td></tr>
                <tr v-if="!run.voucherPlan.length"><td colspan="5" class="pm-empty">لا تتوفر خطة الصرف حتى يكتمل الربط المحاسبي</td></tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>
      <section v-for="b in run.bankSheets" :key="b.cashAccountId" class="card pm-panel" style="margin-top: 16px">
        <div class="pm-row-head"><h2>كشف تحويل {{ b.cashAccountName }} · {{ sar(b.total) }}</h2><button class="btn btn-sm no-print" @click="exportBank(b)">تصدير ملف التحويل (CSV)</button></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>الرقم</th><th>{{ isC ? 'المتعاون' : 'الموظف' }}</th><th>الآيبان</th><th>المبلغ</th></tr></thead>
            <tbody>
              <tr v-for="x in b.rows" :key="x.employeeNo"><td class="hr-num">{{ x.employeeNo }}</td><td>{{ x.fullName }}</td>
                <td class="hr-code" :style="{ color: x.iban ? '' : 'var(--danger)' }">{{ x.iban ?? 'لا يوجد آيبان' }}</td><td class="pm-money">{{ sar(x.amount) }}</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <section v-if="tab === 'edits'" class="card pm-panel">
      <h2>التعديلات اليدوية على الأسطر</h2>
      <p class="pm-muted">كل تعديل يدوي على سطر في هذا الكشف، بسببه ومن عدّله ومتى، والقيم قبل التعديل وبعده. راجعها قبل الاعتماد.</p>
      <div v-if="run.edits.length" class="table-wrap">
        <table class="table">
          <thead><tr><th>{{ isC ? 'المتعاون' : 'الموظف' }}</th><th>السبب</th><th>القيمة قبل ← بعد</th><th>عدّله</th></tr></thead>
          <tbody>
            <tr v-for="(x, i) in run.edits" :key="i">
              <td><b>{{ x.employeeName ?? '—' }}</b></td>
              <td>{{ x.reason ?? '—' }}</td>
              <td>
                <span v-for="c in x.changes" :key="c.field" class="hr-mini">{{ c.label }}: <s style="color: var(--danger)">{{ showVal(c.field, c.before) }}</s> ← <b>{{ showVal(c.field, c.after) }}</b></span>
                <span v-if="!x.changes.length" class="pm-muted">بلا تغيير في القيم</span>
              </td>
              <td>{{ x.actorName }}<span class="hr-mini">{{ fmtAt(x.at) }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="pm-empty">لا توجد تعديلات يدوية على هذا الكشف.</p>
    </section>

    <section v-if="tab === 'history'" class="card pm-panel">
      <h2>سجل الكشف</h2>
      <div v-for="(h, i) in run.history.slice().reverse()" :key="i" style="padding: 8px 0; border-bottom: 1px solid var(--border)">
        <b>{{ h.label }}</b><template v-if="h.stageName"> · {{ h.stageName }}</template><template v-if="h.employeeName"> · {{ h.employeeName }}</template>
        <span class="hr-mini">{{ h.actorName }} · {{ new Date(h.at).toLocaleString('ar-SA-u-ca-gregory') }}</span>
        <p v-if="h.note" class="pm-muted" style="margin: 4px 0 0">{{ h.note }}</p>
        <ul v-if="h.changes?.length" class="pm-muted" style="margin: 4px 0 0; padding-inline-start: 18px">
          <li v-for="c in h.changes" :key="c.field">{{ c.label }}: {{ showVal(c.field, c.before) }} ← {{ showVal(c.field, c.after) }}</li>
        </ul>
      </div>
    </section>

    <div v-if="edit.line" class="modal-backdrop" @click.self="edit.line = null">
      <form class="card modal" style="max-width: 640px" @submit.prevent="saveLine">
        <h2>{{ edit.line.fullName }}</h2>
        <p class="pm-muted">المستحق {{ sar(edit.line.earned) }}<template v-if="edit.line.dailyWage"> · أجر اليوم {{ sar(edit.line.dailyWage) }}</template></p>
        <template v-if="edit.line.contract">
          <div class="hr-sec">الأتعاب ({{ run.payBasisLabels[edit.line.contract.basis] }})</div>
          <div class="pm-grid2">
            <label v-if="edit.line.contract.basis !== 'monthly'" class="field"><span>عدد {{ edit.line.contract.basis === 'daily' ? 'الأيام' : edit.line.contract.basis === 'hourly' ? 'الساعات' : 'المهام' }}</span>
              <input v-model.number="edit.units" type="number" min="0" step="0.25" class="input" /></label>
            <label class="field"><span>{{ edit.line.contract.basis === 'monthly' ? 'المبلغ الشهري' : `قيمة ${run.unitLabels[edit.line.contract.basis]}` }}</span>
              <input v-model.number="edit.rate" type="number" min="0" step="0.01" class="input" /></label>
          </div>
          <label class="field"><span>ملاحظة (اختياري)</span><input v-model="edit.note" class="input" maxlength="300" placeholder="مثل: تفاصيل المهام المنجزة" /></label>
        </template>
        <template v-if="edit.line.attendance.tracked && (!edit.line.contract || edit.line.contract.basis === 'monthly')">
          <div class="hr-sec">الحضور</div>
          <label class="field" style="flex-direction: row; gap: 8px; align-items: center"><input v-model="edit.override" type="checkbox" /> <span>تعديل الحضور يدويًا (بدلًا مما حُسب من البصمات)</span></label>
          <div v-if="edit.override" class="pm-grid2">
            <label class="field"><span>أيام الغياب</span><input v-model.number="edit.absentDays" type="number" min="0" max="31" step="0.5" class="input" /></label>
            <label class="field"><span>دقائق التأخير المخصومة</span><input v-model.number="edit.lateMinutes" type="number" min="0" class="input" /></label>
          </div>
        </template>
        <div class="hr-sec">إضافات هذا الشهر</div>
        <div v-for="(a, i) in edit.additions" :key="i" style="display: grid; grid-template-columns: 1fr 120px 1fr auto; gap: 6px; margin-bottom: 6px">
          <input v-if="isC" class="input" value="مبلغ إضافي" disabled />
          <select v-else v-model="a.code" class="input" required><option v-for="t in run.allowanceTypes" :key="t.code" :value="t.code">{{ t.name }}</option></select>
          <input v-model.number="a.amount" type="number" min="0.01" step="0.01" class="input" required placeholder="المبلغ" />
          <input v-model="a.note" class="input" placeholder="ملاحظة (اختياري)" />
          <button type="button" class="btn btn-sm" @click="edit.additions.splice(i, 1)">✕</button>
        </div>
        <button type="button" class="btn btn-sm" :disabled="edit.additions.length >= 10" @click="edit.additions.push({ code: run.allowanceTypes[0]?.code ?? '', amount: 0, note: '' })">+ إضافة</button>
        <div class="hr-sec">استقطاعات أخرى</div>
        <div class="pm-grid2">
          <label class="field"><span>المبلغ</span><input v-model.number="edit.otherDeduction" type="number" min="0" step="0.01" class="input" /></label>
          <label class="field"><span>السبب</span><input v-model="edit.otherDeductionNote" class="input" :required="!isC && edit.otherDeduction > 0" placeholder="مثل: قسط سلفة، جزاء" /></label>
        </div>
        <label v-if="!isC" class="field" style="margin-top: 10px"><span>سبب التعديل (إلزامي، يراه المعتمد)</span>
          <textarea v-model="edit.reason" class="input" rows="2" maxlength="500" required placeholder="مثل: غياب بعذر طبي، فرق بدل عن الشهر السابق"></textarea></label>
        <div class="modal-actions">
          <button class="btn btn-primary" :disabled="busy">حفظ</button>
          <button type="button" class="btn" @click="edit.line = null">إلغاء</button>
        </div>
      </form>
    </div>

    <div v-if="dlg.kind" class="modal-backdrop" @click.self="dlg.kind = ''">
      <form class="card modal" @submit.prevent="confirmDlg">
        <template v-if="dlg.kind === 'vouchers'">
          <h2>إنشاء سندات الصرف</h2>
          <p class="pm-muted">ستُنشأ {{ run.voucherPlan.length }} سندات صرف مسودة في النظام المالي بإجمالي {{ sar(run.voucherPlan.reduce((s, v) => s + v.amount, 0)) }}، ثم تمر بمراحل اعتماد سندات الصرف.</p>
          <label class="field"><span>تاريخ الصرف</span><input v-model="dlg.date" type="date" class="input" required /></label>
        </template>
        <template v-else>
          <h2>{{ dlg.kind === 'approve' ? (lastStage ? 'الاعتماد النهائي' : 'الموافقة على الكشف') : dlg.kind === 'return' ? 'إرجاع الكشف للتعديل' : 'إلغاء الاعتماد' }}</h2>
          <p v-if="dlg.kind === 'approve' && run.edits.length" class="alert alert-warn" style="margin: 0 0 8px">في الكشف {{ run.edits.length }} تعديل يدوي على الأسطر. راجعها في تبويب «التعديلات» قبل القرار.</p>
          <p v-if="dlg.kind === 'approve' && lastStage" class="pm-muted">سيصدر قيد استحقاق الرواتب في النظام المالي ويُرحّل بتاريخ آخر يوم في الشهر.</p>
          <p v-if="dlg.kind === 'reopen'" class="pm-muted">سيُعكس قيد الرواتب ويعود الكشف للتعديل.</p>
          <label class="field"><span>{{ dlg.kind === 'approve' ? 'ملاحظة (اختياري)' : 'السبب' }}</span><textarea v-model="dlg.note" class="input" rows="3" :required="dlg.kind !== 'approve'"></textarea></label>
        </template>
        <div class="modal-actions">
          <button :class="['btn', dlg.kind === 'return' || dlg.kind === 'reopen' ? 'btn-danger' : 'btn-primary']" :disabled="busy">تأكيد</button>
          <button type="button" class="btn" @click="dlg.kind = ''">إلغاء</button>
        </div>
      </form>
    </div>
  </div>
</template>
