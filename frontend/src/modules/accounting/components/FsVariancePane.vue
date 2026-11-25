<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { amt, download, fetchHtml, printFrame, SPAN_LABEL, type Span } from '../statements';

/**
 * انحرافات الموازنة عن المخطط: الموازنة المعتمدة وأنشطة الخطط التشغيلية مقابل الفعلي من القيود المرحّلة،
 * لأي فترة، بعدة أشكال على الشاشة، وفي PDF (QF-FIN-09) وExcel.
 */
const toast = useToast();
type Status = 'favorable' | 'unfavorable' | 'within';
interface Group { key: string; label: string; section: string | null; kind: 'expense' | 'revenue'; planned: number; actual: number; variance: number; variancePct: number | null; current: number; usedPct: number | null; forecast: number; forecastVariance: number; status: Status; statusName: string; count: number; progress: number | null }
interface Month { month: number; name: string; expPlanned: number; expActual: number; expVariance: number; revPlanned: number; revActual: number; revVariance: number; net: number }
interface Report {
  budget: { code: string; title: string; fiscalYear: number }; period: { label: string }; threshold: number;
  totals: { expenses: Group; revenues: Group; netPlanned: number; netActual: number };
  views: Record<'section' | 'line' | 'unit' | 'costcenter' | 'account' | 'plan', Group[]>; months: Month[];
  outside: { accountId: string; code: string; name: string; nature: string; actual: number }[]; top: Group[]; notes: string[]; hrMasked: boolean;
}
const VIEWS = [
  { key: 'section', label: 'أقسام الموازنة' }, { key: 'line', label: 'البنود' }, { key: 'unit', label: 'الإدارات' }, { key: 'costcenter', label: 'مراكز التكلفة' },
  { key: 'account', label: 'الحسابات' }, { key: 'plan', label: 'الخطط والبرامج' }, { key: 'month', label: 'الأشهر' },
] as const;
type View = (typeof VIEWS)[number]['key'];
const COLOR: Record<Status, string> = { favorable: '#10b981', unfavorable: '#ef4444', within: '#64748b' };
const ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const budgets = ref<{ id: string; code: string; title: string; fiscalYear: number; version: number }[] | null>(null);
const pdfOk = ref(false);
const error = ref('');
const now = new Date();
const sel = reactive({ budgetId: '', span: 'Q' as Span, part: Math.ceil((now.getMonth() + 1) / 3), basis: 'period' as 'period' | 'ytd', threshold: 5 });
const view = ref<View>('section');
const data = ref<Report | null>(null);
const loading = ref(false);
const busy = ref('');
const html = ref('');
const frame = ref<HTMLIFrameElement | null>(null);

const parts = computed(() => (sel.span === 'Y' ? [] : sel.span === 'M' ? MONTHS.map((m, i) => ({ v: i + 1, l: m }))
  : Array.from({ length: sel.span === 'Q' ? 4 : 2 }, (_, i) => ({ v: i + 1, l: `${sel.span === 'Q' ? 'الربع' : 'النصف'} ${ORD[i]}` }))));
const qs = (format: string) => new URLSearchParams({ span: sel.span, part: String(sel.part), basis: sel.basis, threshold: String(sel.threshold), format }).toString();
const rows = computed(() => (view.value === 'month' ? [] : data.value?.views[view.value] ?? []));

watch(() => sel.span, (s) => { sel.part = s === 'M' ? now.getMonth() + 1 : s === 'Q' ? Math.ceil((now.getMonth() + 1) / 3) : s === 'H' ? (now.getMonth() < 6 ? 1 : 2) : 1; });
async function load() {
  if (!sel.budgetId) return;
  loading.value = true; html.value = '';
  try { data.value = await api<Report>(`/planning/variance/${sel.budgetId}?${qs('json')}`); error.value = ''; } catch (e) { data.value = null; error.value = (e as Error).message; } finally { loading.value = false; }
}
watch(() => [sel.budgetId, sel.span, sel.part, sel.basis, sel.threshold], load);

async function preview() {
  busy.value = 'html';
  try { html.value = await fetchHtml(`/planning/variance/${sel.budgetId}?${qs('html')}`); } catch (e) { toast.error((e as Error).message); } finally { busy.value = ''; }
}
async function print() {
  busy.value = 'print';
  try { if (!html.value) html.value = await fetchHtml(`/planning/variance/${sel.budgetId}?${qs('html')}`); await new Promise((r) => setTimeout(r, 60)); await printFrame(frame.value); } catch (e) { toast.error((e as Error).message); } finally { busy.value = ''; }
}
async function file(format: 'pdf' | 'xlsx') {
  busy.value = format;
  try { await download(`/planning/variance/${sel.budgetId}?${qs(format)}`, `budget-variance.${format}`); toast.success('تم تنزيل الملف'); } catch (e) { toast.error((e as Error).message); } finally { busy.value = ''; }
}
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 10) / 10}%`);

onMounted(async () => {
  try {
    const r = await api<{ budgets: NonNullable<typeof budgets.value>; pdf: boolean }>('/planning/variance/budgets');
    budgets.value = r.budgets; pdfOk.value = r.pdf;
    sel.budgetId = (r.budgets.find((b) => b.fiscalYear === now.getFullYear()) ?? r.budgets[0])?.id ?? '';
  } catch (e) { error.value = (e as Error).message; }
});
</script>

<template>
  <div>
    <section class="card pm-panel">
      <h2>انحرافات الموازنة عن المخطط <span class="pm-muted">الموازنة المعتمدة والخطط التشغيلية مقابل الفعلي من القيود المرحّلة</span></h2>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <p v-if="budgets && !budgets.length" class="pm-empty">لا توجد موازنات معتمدة بعد. تُعتمد الموازنة من نظام التخطيط والموازنات.</p>
      <div v-if="budgets?.length" class="vr-params">
        <label class="field vr-wide"><span>الموازنة</span>
          <select v-model="sel.budgetId" class="input"><option v-for="b in budgets" :key="b.id" :value="b.id">{{ b.code }} {{ b.title }} ({{ b.fiscalYear }}) · إصدار {{ b.version }}</option></select></label>
        <label class="field"><span>نوع الفترة</span>
          <select v-model="sel.span" class="input"><option v-for="(l, k) in SPAN_LABEL" :key="k" :value="k">{{ l }}</option></select></label>
        <label v-if="sel.span !== 'Y'" class="field"><span>الفترة</span>
          <select v-model.number="sel.part" class="input"><option v-for="p in parts" :key="p.v" :value="p.v">{{ p.l }}</option></select></label>
        <label v-if="sel.span !== 'Y'" class="field"><span>الأساس</span>
          <select v-model="sel.basis" class="input"><option value="period">الفترة وحدها</option><option value="ytd">من بداية السنة حتى نهاية الفترة</option></select></label>
        <label class="field"><span>حد الانحراف المقبول %</span><input v-model.number="sel.threshold" type="number" min="1" max="100" class="input" /></label>
      </div>
    </section>

    <p v-if="loading" class="pm-empty">جارٍ احتساب الانحرافات...</p>
    <template v-else-if="data">
      <div class="vr-kpis">
        <div class="card"><span>المصروفات: المخطط</span><b class="ac-num">{{ amt(data.totals.expenses.planned) }}</b></div>
        <div class="card"><span>المصروفات: الفعلي</span><b class="ac-num">{{ amt(data.totals.expenses.actual) }}</b></div>
        <div class="card" :style="{ '--c': COLOR[data.totals.expenses.status] }"><span>انحراف المصروفات</span><b class="ac-num vr-c">{{ amt(data.totals.expenses.variance) }} ({{ pct(data.totals.expenses.variancePct) }})</b></div>
        <div class="card"><span>الإيرادات: المخطط</span><b class="ac-num">{{ amt(data.totals.revenues.planned) }}</b></div>
        <div class="card"><span>الإيرادات: الفعلي</span><b class="ac-num">{{ amt(data.totals.revenues.actual) }}</b></div>
        <div class="card" :style="{ '--c': COLOR[data.totals.revenues.status] }"><span>انحراف الإيرادات</span><b class="ac-num vr-c">{{ amt(data.totals.revenues.variance) }} ({{ pct(data.totals.revenues.variancePct) }})</b></div>
      </div>

      <section class="card pm-panel">
        <h2>{{ data.period.label }}
          <span class="vr-actions">
            <button class="btn btn-sm" :disabled="!!busy" @click="preview">معاينة التقرير</button>
            <button class="btn btn-sm" :disabled="!!busy" @click="print">طباعة</button>
            <button class="btn btn-sm" :disabled="!!busy || !pdfOk" :title="pdfOk ? '' : 'محرك PDF غير متاح على الخادم'" @click="file('pdf')">PDF</button>
            <button class="btn btn-sm" :disabled="!!busy" @click="file('xlsx')">Excel</button>
          </span>
        </h2>
        <div class="pm-tabs vr-views">
          <button v-for="v in VIEWS" :key="v.key" :class="['pm-tab', { on: view === v.key }]" @click="view = v.key">{{ v.label }}</button>
        </div>

        <div v-if="view === 'month'" class="table-wrap"><table class="table">
          <thead><tr><th>الشهر</th><th class="ac-num">مصروفات مخططة</th><th class="ac-num">مصروفات فعلية</th><th class="ac-num">الانحراف</th><th class="ac-num">إيرادات مخططة</th><th class="ac-num">إيرادات فعلية</th><th class="ac-num">الانحراف</th><th class="ac-num">الصافي الفعلي</th></tr></thead>
          <tbody><tr v-for="m in data.months" :key="m.month">
            <td>{{ m.name }}</td><td class="ac-num">{{ amt(m.expPlanned) }}</td><td class="ac-num">{{ amt(m.expActual) }}</td><td class="ac-num" :class="{ bad: m.expVariance > 0 }">{{ amt(m.expVariance) }}</td>
            <td class="ac-num">{{ amt(m.revPlanned) }}</td><td class="ac-num">{{ amt(m.revActual) }}</td><td class="ac-num" :class="{ bad: m.revVariance < 0 }">{{ amt(m.revVariance) }}</td><td class="ac-num">{{ amt(m.net) }}</td>
          </tr></tbody>
        </table></div>
        <div v-else class="table-wrap"><table class="table">
          <thead><tr><th>البيان</th><th v-if="view === 'line'">القسم</th><th class="ac-num">المخطط</th><th class="ac-num">الفعلي</th><th class="ac-num">الانحراف</th><th class="ac-num">%</th>
            <th class="ac-num">المتوقع لنهاية السنة</th><th v-if="view === 'plan'" class="ac-num">الإنجاز</th><th>التقييم</th></tr></thead>
          <tbody><tr v-for="g in rows" :key="g.key">
            <td>{{ g.label }}<span v-if="g.kind === 'revenue' && view !== 'section'" class="pm-muted"> · إيراد</span></td><td v-if="view === 'line'" class="pm-muted">{{ g.section }}</td>
            <td class="ac-num">{{ amt(g.planned) }}</td><td class="ac-num">{{ amt(g.actual) }}</td><td class="ac-num">{{ amt(g.variance) }}</td><td class="ac-num">{{ pct(g.variancePct) }}</td>
            <td class="ac-num">{{ amt(g.forecast) }}</td><td v-if="view === 'plan'" class="ac-num">{{ pct(g.progress) }}</td>
            <td><span class="pm-pill" :style="{ '--c': COLOR[g.status] }">{{ g.statusName }}</span></td>
          </tr></tbody>
        </table></div>
        <p v-if="view !== 'month' && !rows.length" class="pm-empty">لا توجد بنود</p>
        <p class="pm-muted">الانحراف = الفعلي − المخطط. يكون إيجابيًا في المصروفات إذا قل الصرف، وفي الإيرادات إذا زاد التحصيل. ما دون {{ data.threshold }}% يُعد ضمن الحد.</p>
      </section>

      <div class="vr-two">
        <section class="card pm-panel">
          <h2>أكبر الانحرافات السلبية</h2>
          <p v-if="!data.top.length" class="pm-empty">لا توجد انحرافات سلبية تتجاوز الحد</p>
          <table v-else class="table"><tbody><tr v-for="g in data.top" :key="g.key"><td>{{ g.label }}</td><td class="ac-num bad">{{ amt(g.variance) }}</td><td class="ac-num">{{ pct(g.variancePct) }}</td></tr></tbody></table>
        </section>
        <section class="card pm-panel">
          <h2>فعلي خارج الموازنة <span class="pm-muted">حسابات عليها حركة لا يقابلها بند</span></h2>
          <p v-if="!data.outside.length" class="pm-empty">لا يوجد</p>
          <table v-else class="table"><tbody><tr v-for="o in data.outside" :key="o.accountId"><td><span class="ac-code">{{ o.code }}</span> {{ o.name }}</td><td class="ac-num">{{ amt(o.actual) }}</td></tr></tbody></table>
        </section>
      </div>
      <div v-if="data.notes.length" class="alert alert-info vr-notes"><ul><li v-for="n in data.notes" :key="n">{{ n }}</li></ul></div>
    </template>

    <section v-show="html" class="card vr-preview">
      <iframe ref="frame" title="معاينة تقرير الانحرافات" sandbox="allow-same-origin allow-modals" :srcdoc="html" />
    </section>
  </div>
</template>

<style scoped>
.vr-params { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.vr-params .field { flex: 0 1 180px; }
.vr-params .vr-wide { flex: 1 1 300px; }
.vr-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin: 14px 0; }
.vr-kpis .card { padding: 12px 14px; display: grid; gap: 4px; }
.vr-kpis span { color: var(--muted); font-size: .8rem; }
.vr-kpis b { font-size: 1.05rem; text-align: start; }
.vr-c { color: var(--c); }
.vr-actions { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.vr-views { margin-top: 4px; }
.vr-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 14px; margin-top: 14px; }
.vr-notes { margin-top: 14px; }
.vr-notes ul { margin: 0; padding-inline-start: 18px; }
.vr-preview { margin-top: 14px; padding: 0; overflow: hidden; }
.vr-preview iframe { width: 100%; height: 80vh; border: 0; background: #fff; display: block; }
.bad { color: #b91c1c; }
@media (max-width: 640px) { .vr-params .field { flex: 1 1 100%; } .vr-two { grid-template-columns: 1fr; } }
</style>
