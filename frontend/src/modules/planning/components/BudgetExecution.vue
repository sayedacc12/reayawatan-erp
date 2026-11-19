<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { errMsg, fmtDateTime, money, MONTHS, num, P, SECTIONS, short, WF_STATUS } from '../lib';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** متابعة الموازنة أثناء التنفيذ: المخطط مقابل الفعلي من النظام المالي، والانحرافات، والتوقع، والمناقلات، وتتبع القيود */
const props = defineProps<{ budget: any; lookups: any }>();
const session = useSession();
const toast = useToast();
const canManage = computed(() => session.can(P.budgets));
const q = reactive({ month: 0, method: 'plan', threshold: 10 });
const d = ref<any>(null);
const busy = ref(false);
const filter = ref('all');

async function load(first = false) {
  busy.value = true;
  try {
    const qs = first ? '' : `?month=${q.month}&method=${q.method}&threshold=${q.threshold}`;
    d.value = await api<any>(`/planning/budgets/${props.budget.id}/execution${qs}`);
    q.month = d.value.month;
  } catch (e) { toast.error(errMsg(e)); } finally { busy.value = false; }
}
onMounted(() => load(true));

const STATUS: Record<string, { label: string; color: string }> = { over: { label: 'متجاوز', color: '#dc2626' }, warn: { label: 'انتبه', color: '#f59e0b' }, ok: { label: 'ضمن الموازنة', color: '#10b981' } };
const LEVEL: Record<string, string> = { danger: '#ef4444', warning: '#f59e0b', info: '#0ea5e9' };
const rows = (sec: 'exp' | 'rev') => (d.value?.rows ?? []).filter((r: any) => (sec === 'rev') === (r.section === 'revenue') && (filter.value === 'all' || r.status === filter.value));
const pct = (a: number, b: number) => (b ? Math.min(150, Math.max(0, (a / b) * 100)) : 0);
const cum = (a: number[]) => a.reduce((o: number[], x, i) => [...o, (o[i - 1] ?? 0) + x], []);
const chart = computed(() => {
  if (!d.value) return null;
  const p = cum(d.value.byMonth.planned), a = cum(d.value.byMonth.actual).map((x, i) => (i < d.value.month ? x : null));
  const max = Math.max(1, ...p, ...a.filter((x): x is number => x !== null), d.value.totals.expenses.current);
  return { p, a, max };
});

// التتبع والربط
const sel = ref<any>(null);
const tr = ref<any>(null);
const map = reactive<any>({ accountIds: [] as string[], costCenterId: '' });
async function open(r: any) {
  sel.value = r;
  tr.value = null;
  const line = props.budget.lines.find((l: any) => l.id === r.lineId);
  Object.assign(map, { accountIds: [...(line?.actualMap?.accountIds ?? (line?.accountId ? [line.accountId] : []))], costCenterId: line?.actualMap?.costCenterId ?? '' });
  try { tr.value = await api<any>(`/planning/budgets/${props.budget.id}/execution/trace?key=${r.key}&month=${q.month}`); } catch (e) { toast.error(errMsg(e)); }
}
const accOptions = computed(() => (props.lookups?.accounts ?? []).filter((a: any) => (sel.value?.section === 'revenue' ? a.nature === 'revenue' : a.nature === 'expenses')));
async function saveMap() {
  try {
    await api(`/planning/budget-lines/${sel.value.lineId}/mapping`, { method: 'PATCH', json: { accountIds: map.accountIds, costCenterId: map.costCenterId || null } });
    toast.success('رُبط البند بحسابات الفعلي');
    const key = sel.value.key;
    await load();
    const r = d.value.rows.find((x: any) => x.key === key);
    if (r) await open(r);
  } catch (e) { toast.error(errMsg(e)); }
}

// المناقلات
const KIND: Record<string, string> = { transfer: 'مناقلة بين بندين', increase: 'زيادة بند', decrease: 'تخفيض بند' };
const t = reactive<any>({ open: false, kind: 'transfer', fromLineId: '', toLineId: '', amount: null, fromMonth: 1, reason: '', preview: null, busy: false });
const expLines = computed(() => (d.value?.rows ?? []).filter((r: any) => r.section !== 'revenue').flatMap((r: any) => (r.lineId ? [{ id: r.lineId, name: r.name, available: r.available }] : r.lineIds.slice(0, 1).map((id: string) => ({ id, name: r.name, available: r.available })))));
function newTransfer(to?: any) {
  Object.assign(t, { open: true, kind: to ? 'transfer' : 'transfer', fromLineId: '', toLineId: to?.lineId ?? to?.lineIds?.[0] ?? '', amount: to && to.available < 0 ? Math.ceil(-to.available / 1000) * 1000 : null, fromMonth: Math.max(1, q.month || 1), reason: '', preview: null });
  sel.value = null;
}
const body = () => ({ kind: t.kind, fromLineId: t.kind === 'increase' ? null : t.fromLineId || null, toLineId: t.kind === 'decrease' ? null : t.toLineId || null, amount: Number(t.amount), fromMonth: t.fromMonth, reason: t.reason || 'دراسة' });
async function preview() {
  if (!t.amount) return;
  try { t.preview = await api<any>(`/planning/budgets/${props.budget.id}/transfers/preview`, { method: 'POST', json: body() }); } catch (e) { t.preview = { error: errMsg(e) }; }
}
async function submitTransfer() {
  t.busy = true;
  try {
    const r = await api<any>(`/planning/budgets/${props.budget.id}/transfers`, { method: 'POST', json: body() });
    toast.success(r.status === 'approved' ? 'اعتُمد الطلب مباشرة (لا يوجد مسار اعتماد)' : `رُفع الطلب ${r.code} للاعتماد`);
    t.open = false;
    await load();
  } catch (e) { toast.error(errMsg(e)); } finally { t.busy = false; }
}
const note = ref<Record<string, string>>({});
async function decide(x: any, decision: string) {
  try { await api(`/planning/budget-transfers/${x.id}/decision`, { method: 'POST', json: { decision, note: note.value[x.id] || null } }); toast.success('سُجل القرار'); await load(); } catch (e) { toast.error(errMsg(e)); }
}
async function cancel(x: any) {
  if (!confirm(`إلغاء الطلب ${x.code}؟`)) return;
  try { await api(`/planning/budget-transfers/${x.id}`, { method: 'DELETE' }); await load(); } catch (e) { toast.error(errMsg(e)); }
}
const sign = (v: number) => `${v > 0 ? '+' : ''}${num(v, 0)}`;
</script>

<template>
  <div v-if="d" class="ex-wrap">
    <section class="card pm-panel ex-bar">
      <div class="pl-flex">
        <label class="pl-flex">حتى شهر <select v-model.number="q.month" class="input" style="width: auto" @change="load()"><option :value="0">بداية السنة</option><option v-for="(m, i) in MONTHS" :key="i" :value="i + 1">{{ m }}</option></select></label>
        <label class="pl-flex">التوقع لنهاية السنة <select v-model="q.method" class="input" style="width: auto" @change="load()"><option value="plan">الفعلي + المتبقي من الخطة</option><option value="run_rate">بمعدل الصرف الشهري</option></select></label>
        <label class="pl-flex">حد التنبيه <select v-model.number="q.threshold" class="input" style="width: auto" @change="load()"><option :value="5">5%</option><option :value="10">10%</option><option :value="20">20%</option></select></label>
        <span class="pm-muted" style="margin-inline-start: auto">الفعلي من القيود المرحّلة في النظام المالي بتاريخ المستند · الإصدار المعتمد {{ d.budget.version }}</span>
        <span v-if="busy" class="pm-muted">جارٍ التحديث…</span>
      </div>
    </section>

    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #64748b; --i: 0"><span>الموازنة المعدلة</span><strong style="font-size: 1.1rem">{{ money(d.totals.expenses.current) }}</strong><small>الأصلية {{ short(d.totals.expenses.original) }} · مناقلات {{ sign(d.totals.expenses.transfers) }}</small></div>
      <div class="pm-kpi" style="--a: #0ea5e9; --i: 1"><span>المخطط حتى {{ d.monthName ?? 'الآن' }}</span><strong style="font-size: 1.1rem">{{ money(d.totals.expenses.plannedToDate) }}</strong><small>من التوزيع الشهري المعتمد</small></div>
      <div class="pm-kpi" :style="{ '--a': d.totals.expenses.actual > d.totals.expenses.plannedToDate ? '#dc2626' : '#10b981', '--i': 2 }"><span>الصرف الفعلي</span><strong style="font-size: 1.1rem">{{ money(d.totals.expenses.actual) }}</strong>
        <small>{{ d.totals.expenses.plannedToDate ? `${num((d.totals.expenses.actual / d.totals.expenses.plannedToDate) * 100, 0)}% من المخطط` : '' }}</small></div>
      <div class="pm-kpi" style="--a: #a78bfa; --i: 3"><span>المحجوز والمتاح</span><strong style="font-size: 1.1rem">{{ money(d.totals.expenses.available) }}</strong><small>محجوز {{ short(d.totals.expenses.reserved) }}</small></div>
      <div class="pm-kpi" :style="{ '--a': d.totals.expenses.forecast > d.totals.expenses.current ? '#dc2626' : '#10b981', '--i': 4 }"><span>المتوقع لنهاية السنة</span><strong style="font-size: 1.1rem">{{ money(d.totals.expenses.forecast) }}</strong>
        <small>{{ d.totals.expenses.forecast > d.totals.expenses.current ? 'تجاوز' : 'وفر' }} {{ short(Math.abs(d.totals.expenses.forecast - d.totals.expenses.current)) }}</small></div>
      <div class="pm-kpi" :style="{ '--a': d.totals.revenues.actual < d.totals.revenues.plannedToDate ? '#f59e0b' : '#10b981', '--i': 5 }"><span>الإيرادات المحصلة</span><strong style="font-size: 1.1rem">{{ money(d.totals.revenues.actual) }}</strong>
        <small>المخطط {{ short(d.totals.revenues.plannedToDate) }}</small></div>
    </div>

    <div class="pl-layout" style="grid-template-columns: 1.3fr 1fr">
      <section class="card pm-panel">
        <h2>المصروفات التراكمية: المخطط مقابل الفعلي</h2>
        <svg v-if="chart" viewBox="0 0 600 220" class="ex-chart" preserveAspectRatio="none">
          <line v-for="g in 4" :key="g" x1="0" x2="600" :y1="200 - g * 45" :y2="200 - g * 45" class="grid" />
          <line x1="0" x2="600" :y1="200 - (d.totals.expenses.current / chart.max) * 180" :y2="200 - (d.totals.expenses.current / chart.max) * 180" class="cap" />
          <polyline :points="chart.p.map((v, i) => `${25 + i * 50},${200 - (v / chart!.max) * 180}`).join(' ')" class="plan" />
          <polyline :points="chart.a.map((v, i) => (v === null ? '' : `${25 + i * 50},${200 - (v / chart!.max) * 180}`)).filter(Boolean).join(' ')" class="act" />
          <circle v-for="(v, i) in chart.a" v-show="v !== null" :key="i" :cx="25 + i * 50" :cy="200 - ((v ?? 0) / chart.max) * 180" r="4" class="dot"><title>{{ MONTHS[i] }}: {{ money(v) }}</title></circle>
          <text v-for="(m, i) in MONTHS" :key="m" :x="25 + i * 50" y="216" text-anchor="middle" class="lbl">{{ m.slice(0, 3) }}</text>
        </svg>
        <div class="pl-flex" style="justify-content: center"><span class="ex-key plan">المخطط</span><span class="ex-key act">الفعلي</span><span class="ex-key cap">سقف الموازنة المعدلة</span></div>
      </section>
      <section class="card pm-panel">
        <h2>التنبيهات ({{ d.alerts.length }})</h2>
        <div v-for="(a, i) in d.alerts" :key="i" class="bg-check" :style="{ '--c': LEVEL[a.level] }" @click="d.rows.find((r: any) => r.key === a.key) && open(d.rows.find((r: any) => r.key === a.key))">{{ a.text }}</div>
        <p v-if="!d.alerts.length" class="pm-empty">لا تنبيهات: الصرف ضمن الموازنة.</p>
      </section>
    </div>

    <section class="card pm-panel">
      <h2><span>البنود</span>
        <span class="pl-flex"><select v-model="filter" class="input" style="width: auto"><option value="all">كل البنود</option><option value="over">المتجاوزة</option><option value="warn">التي تحتاج انتباهًا</option></select>
          <button v-if="canManage" class="btn btn-sm pl-glow" @click="newTransfer()">+ مناقلة أو تعديل</button></span></h2>
      <div class="table-wrap">
        <table class="table ex-table">
          <thead><tr><th>البند</th><th>الأصلية</th><th>المعدلة</th><th>المخطط حتى الشهر</th><th>الفعلي</th><th>الانحراف</th><th>المحجوز</th><th>المتاح</th><th>المتوقع</th><th /></tr></thead>
          <tbody>
            <tr class="ex-sec"><td colspan="10">المصروفات</td></tr>
            <tr v-for="r in rows('exp')" :key="r.key" :class="{ sel: sel?.key === r.key }" @click="open(r)">
              <td><b>{{ r.name }}</b><small class="pm-muted"> · {{ SECTIONS[r.section]?.label }}{{ r.actualSource === 'commitments' ? ' · الفعلي من الحجوزات' : r.actualSource === 'payroll' ? ' · من حسابات الرواتب' : '' }}</small>
                <div class="ex-prog"><i :style="{ width: `${pct(r.actual, r.current)}%`, '--c': STATUS[r.status].color }" /><em :style="{ insetInlineStart: `${Math.min(100, pct(r.plannedToDate, r.current))}%` }" /></div></td>
              <td class="num">{{ num(r.original, 0) }}</td>
              <td class="num">{{ num(r.current, 0) }}<small v-if="r.transfers" class="ex-tr">{{ sign(r.transfers) }}</small></td>
              <td class="num">{{ num(r.plannedToDate, 0) }}</td>
              <td class="num"><b>{{ num(r.actual, 0) }}</b></td>
              <td class="num" :style="{ color: r.variance > 0 ? '#dc2626' : '#059669' }">{{ sign(r.variance) }}<small v-if="r.variancePct !== null"> ({{ r.variancePct }}%)</small></td>
              <td class="num">{{ num(r.reserved, 0) }}</td>
              <td class="num" :style="{ color: (r.available ?? 0) < 0 ? '#dc2626' : undefined }"><b>{{ num(r.available, 0) }}</b></td>
              <td class="num">{{ num(r.forecast, 0) }}</td>
              <td><span class="pm-pill" :style="{ '--c': STATUS[r.status].color }">{{ STATUS[r.status].label }}</span></td>
            </tr>
            <tr class="ex-sec"><td colspan="10">الإيرادات</td></tr>
            <tr v-for="r in rows('rev')" :key="r.key" :class="{ sel: sel?.key === r.key }" @click="open(r)">
              <td><b>{{ r.name }}</b><div class="ex-prog"><i :style="{ width: `${pct(r.actual, r.current)}%`, '--c': r.status === 'warn' ? '#f59e0b' : '#a78bfa' }" /></div></td>
              <td class="num">{{ num(r.original, 0) }}</td><td class="num">{{ num(r.current, 0) }}</td><td class="num">{{ num(r.plannedToDate, 0) }}</td>
              <td class="num"><b>{{ num(r.actual, 0) }}</b></td>
              <td class="num" :style="{ color: r.variance < 0 ? '#dc2626' : '#059669' }">{{ sign(r.variance) }}<small v-if="r.variancePct !== null"> ({{ r.variancePct }}%)</small></td>
              <td /><td /><td class="num">{{ num(r.forecast, 0) }}</td>
              <td><span class="pm-pill" :style="{ '--c': r.status === 'warn' ? '#f59e0b' : '#10b981' }">{{ r.status === 'warn' ? 'تحصيل أقل' : 'جيد' }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <details v-if="d.outside.length" class="ex-out">
        <summary>حركة على حسابات لا يقابلها بند في الموازنة ({{ d.outside.length }})</summary>
        <table class="table"><tbody><tr v-for="o in d.outside" :key="o.accountId"><td>{{ o.code }}</td><td>{{ o.name }}</td><td>{{ o.nature === 'revenue' ? 'إيراد' : 'مصروف' }}</td><td class="num">{{ num(o.actual, 0) }}</td></tr></tbody></table>
        <p class="pm-muted">اربطها ببند مناسب من تفاصيل البند، أو أضف لها بندًا في تعديل الموازنة.</p>
      </details>
    </section>

    <section class="card pm-panel">
      <h2>المناقلات والتعديلات ({{ d.transfers.length }})</h2>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الرقم</th><th>النوع</th><th>من</th><th>إلى</th><th>المبلغ</th><th>السبب</th><th>الحالة</th><th>الطالب</th><th /></tr></thead>
          <tbody>
            <tr v-for="x in d.transfers" :key="x.id">
              <td class="rk-code">{{ x.code }}</td><td>{{ x.kindName }}</td><td>{{ x.fromName ?? '—' }}</td><td>{{ x.toName ?? '—' }}</td><td class="num"><b>{{ num(x.amount, 0) }}</b></td>
              <td>{{ x.reason }}</td>
              <td><span class="pm-pill" :style="{ '--c': WF_STATUS[x.status]?.color }">{{ WF_STATUS[x.status]?.label }}</span><small v-if="x.stageName" class="pm-muted"> {{ x.stageName }}</small></td>
              <td>{{ x.createdByName }}<small class="pm-muted"> {{ fmtDateTime(x.createdAt) }}</small></td>
              <td>
                <div v-if="x.canDecide" class="pl-flex" style="flex-wrap: nowrap">
                  <input v-model="note[x.id]" class="input" placeholder="ملاحظة" style="width: 110px" />
                  <button class="btn btn-sm btn-primary" @click="decide(x, 'approve')">اعتماد</button><button class="btn btn-sm" @click="decide(x, 'return')">إرجاع</button><button class="btn btn-sm btn-danger" @click="decide(x, 'reject')">رفض</button>
                </div>
                <button v-else-if="canManage && x.status !== 'approved'" class="btn btn-sm" @click="cancel(x)">إلغاء</button>
              </td>
            </tr>
            <tr v-if="!d.transfers.length"><td colspan="9" class="pm-empty">لا توجد مناقلات. المناقلة تنقل مبلغًا من وفر بند إلى بند يحتاجه، وتمر بمسار اعتماد المناقلات.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- تفاصيل البند: التتبع والربط -->
    <div v-if="sel" class="modal-backdrop" @click.self="sel = null">
      <div class="card modal modal-wide">
        <h2>{{ sel.name }}</h2>
        <div class="bg-vars"><span><i>المعدلة</i>{{ num(sel.current, 0) }}</span><span><i>الفعلي</i>{{ num(sel.actual, 0) }}</span><span><i>المحجوز</i>{{ num(sel.reserved, 0) }}</span><span v-if="sel.available !== null"><i>المتاح</i>{{ num(sel.available, 0) }}</span><span><i>المتوقع</i>{{ num(sel.forecast, 0) }}</span></div>
        <div class="ex-months">
          <div v-for="(m, i) in MONTHS" :key="i" class="col"><div class="bars"><i class="p" :style="{ height: `${pct(sel.planned[i], Math.max(...sel.planned, ...sel.actualByMonth, 1)) / 1.5}%` }" :title="`المخطط ${money(sel.planned[i])}`" /><i class="a" :style="{ height: `${pct(sel.actualByMonth[i], Math.max(...sel.planned, ...sel.actualByMonth, 1)) / 1.5}%` }" :title="`الفعلي ${money(sel.actualByMonth[i])}`" /></div><small>{{ m.slice(0, 3) }}</small></div>
        </div>
        <template v-if="tr">
          <p class="pm-muted">مصدر الفعلي: {{ tr.source }}</p>
          <h3 class="rk-sec">القيود ({{ tr.entries.length }})</h3>
          <div class="table-wrap" style="max-height: 260px">
            <table class="table"><thead><tr><th>القيد</th><th>التاريخ</th><th>البيان</th><th>الحساب</th><th>المبلغ</th></tr></thead>
              <tbody><tr v-for="e in tr.entries" :key="e.id"><td><router-link :to="`/accounting/entries/${e.id}`" class="rk-code">{{ e.entryNo }}</router-link></td><td style="white-space: nowrap">{{ e.date }}</td><td style="max-width: 260px">{{ e.description }}</td><td>{{ e.accountCode }}</td><td class="num">{{ num(e.amount, 2) }}</td></tr>
                <tr v-if="!tr.entries.length"><td colspan="5" class="pm-empty">لا قيود حتى الشهر المختار.</td></tr></tbody></table>
          </div>
          <h3 class="rk-sec">الحجوزات من الأنظمة الأخرى ({{ tr.commitments.length }})</h3>
          <table v-if="tr.commitments.length" class="table"><tbody><tr v-for="c in tr.commitments" :key="c.id"><td>{{ c.sourceModule === 'procurement' ? 'المشتريات' : c.sourceModule }}</td><td>{{ c.sourceRef }}</td><td class="num">{{ num(c.amount, 0) }}</td>
            <td>{{ c.status === 'reserved' ? 'محجوز' : c.status === 'consumed' ? 'مصروف' : 'ملغى' }}</td><td>{{ c.createdByName }}</td></tr></tbody></table>
          <p v-else class="pm-muted">لا حجوزات.</p>
        </template>
        <template v-if="canManage && sel.lineId">
          <h3 class="rk-sec">ربط البند بحسابات الفعلي</h3>
          <p class="pm-muted">يحدد من أين يُقرأ الفعلي لهذا البند. لا يغيّر الموازنة المعتمدة.</p>
          <div class="pl-flex">
            <select v-model="map.accountIds" multiple class="input" style="min-height: 90px; flex: 2"><option v-for="a in accOptions" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select>
            <select v-model="map.costCenterId" class="input" style="flex: 1"><option value="">كل مراكز التكلفة</option><option v-for="c in lookups.costCenters" :key="c.id" :value="c.id">{{ c.name }}</option></select>
            <button class="btn btn-sm" @click="saveMap">حفظ الربط</button>
          </div>
        </template>
        <div class="modal-actions">
          <button v-if="canManage && sel.section !== 'revenue'" class="btn btn-primary" @click="newTransfer(sel)">مناقلة إلى هذا البند</button>
          <button class="btn" @click="sel = null">إغلاق</button>
        </div>
      </div>
    </div>

    <!-- طلب مناقلة مع دراسة الأثر -->
    <div v-if="t.open" class="modal-backdrop" @click.self="t.open = false">
      <form class="card modal" @submit.prevent="submitTransfer">
        <h2>طلب مناقلة أو تعديل</h2>
        <label class="field"><span>النوع</span><select v-model="t.kind" class="input" @change="preview"><option v-for="(l, k) in KIND" :key="k" :value="k">{{ l }}</option></select></label>
        <label v-if="t.kind !== 'increase'" class="field"><span>{{ t.kind === 'decrease' ? 'البند المراد تخفيضه' : 'من بند' }}</span>
          <select v-model="t.fromLineId" class="input" required @change="preview"><option v-for="l in expLines" :key="l.id" :value="l.id" :disabled="l.id === t.toLineId">{{ l.name }} (المتاح {{ num(l.available, 0) }})</option></select></label>
        <label v-if="t.kind !== 'decrease'" class="field"><span>{{ t.kind === 'increase' ? 'البند المراد زيادته' : 'إلى بند' }}</span>
          <select v-model="t.toLineId" class="input" required @change="preview"><option v-for="l in expLines" :key="l.id" :value="l.id" :disabled="l.id === t.fromLineId">{{ l.name }}</option></select></label>
        <div class="rk-fields">
          <label class="field"><span>المبلغ</span><input v-model="t.amount" type="number" min="1" class="input" required @change="preview" /></label>
          <label class="field"><span>يسري من</span><select v-model.number="t.fromMonth" class="input"><option v-for="(m, i) in MONTHS" :key="i" :value="i + 1">{{ m }}</option></select></label>
        </div>
        <label class="field"><span>السبب</span><textarea v-model="t.reason" class="input" rows="2" required minlength="3" /></label>
        <div v-if="t.preview" class="ex-impact">
          <p v-if="t.preview.error" class="bg-err">{{ t.preview.error }}</p>
          <template v-else>
            <b>دراسة الأثر</b>
            <div v-if="t.preview.from">«{{ t.preview.from.name }}»: {{ num(t.preview.from.current, 0) }} ← {{ num(t.preview.from.after, 0) }} · المتاح بعده {{ num(t.preview.from.availableAfter, 0) }}</div>
            <div v-if="t.preview.to">«{{ t.preview.to.name }}»: {{ num(t.preview.to.current, 0) }} ← {{ num(t.preview.to.after, 0) }} · المتاح بعده {{ num(t.preview.to.availableAfter, 0) }}</div>
            <div>إجمالي المصروفات: {{ num(t.preview.totalBefore, 0) }} ← {{ num(t.preview.totalAfter, 0) }} · الصافي {{ num(t.preview.balanceAfter, 0) }}</div>
            <p v-if="!t.preview.allowed" class="bg-err">{{ t.preview.message }}</p>
          </template>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="t.busy || (t.preview && !t.preview.allowed)">رفع للاعتماد</button><button type="button" class="btn" @click="preview">دراسة الأثر</button><button type="button" class="btn" @click="t.open = false">إلغاء</button></div>
      </form>
    </div>
  </div>
  <p v-else class="pm-muted">جارٍ تحميل المتابعة…</p>
</template>
