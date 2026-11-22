<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import BudgetExecution from '../components/BudgetExecution.vue';
import ExcelImportDialog from '../../../components/ExcelImportDialog.vue';
import BudgetAssumptions from '../components/BudgetAssumptions.vue';
import BudgetLinePanel from '../components/BudgetLinePanel.vue';
import PlanWorkflow from '../components/PlanWorkflow.vue';
import ScenarioLevers from '../components/ScenarioLevers.vue';
import ScenariosPanel from '../components/ScenariosPanel.vue';
import { errMsg, fmtDateTime, FUNDING, IMPORTS, LINE_KIND, money, MONTHS, num, P, SECTIONS, short, WF_STATUS } from '../lib';
import '../../../shared/module.css';
import '../../risk/risk.css';
import '../planning.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id: string }>();
const session = useSession();
const router = useRouter();
const route = useRoute();
const toast = useToast();
const b = ref<any>(null);
const lk = ref<any>(null);
const error = ref('');
const tab = ref(typeof route.query.tab === 'string' ? route.query.tab : 'summary');
const selId = ref<string | null>(null);
const q = ref('');
const busy = ref('');
const canManage = computed(() => session.can(P.budgets));
const editable = computed(() => canManage.value && b.value && ['draft', 'returned', 'approved'].includes(b.value.status));
const isSc = computed(() => !!b.value?.isScenario);
const importingLines = ref(false);
const LEVEL: Record<string, string> = { danger: '#ef4444', warning: '#f59e0b', info: '#0ea5e9' };

async function load() {
  try {
    b.value = await api<any>(`/planning/budgets/${props.id}`);
  } catch (e) {
    error.value = errMsg(e);
  }
}
onMounted(async () => {
  [lk.value] = await Promise.all([api<any>('/planning/budget-lookups'), load()]);
});
watch(() => props.id, () => { tab.value = 'summary'; selId.value = null; load(); });

const flow = computed(() => b.value && { ...b.value, stages: (b.value.wfStages ?? []).map((s: any) => s.name) });
const lines = (section: string) => (b.value?.lines ?? []).filter((l: any) => l.section === section && (!q.value || `${l.name} ${l.unitName ?? ''} ${l.accountCode ?? ''}`.includes(q.value)));
const sel = computed(() => b.value?.lines.find((l: any) => l.id === selId.value) ?? null);
const secTotal = (s: string) => b.value?.summary.sections[s] ?? 0;
const maxMonth = computed(() => Math.max(1, ...(b.value?.summary.byMonth.expenses ?? []), ...(b.value?.summary.byMonth.revenues ?? [])));
const unitMax = computed(() => Math.max(1, ...(b.value?.summary.byUnit ?? []).map((u: any) => Math.max(u.total, u.ceiling ?? 0))));
const fundingTotal = computed(() => Object.values(b.value?.summary.byFunding ?? {}).reduce((s: number, v: any) => s + v, 0) as number);
const highlight = ref<Set<string>>(new Set());

async function doImport(key: string) {
  busy.value = key;
  try {
    const r = await api<any>(`/planning/budgets/${props.id}/import`, { method: 'POST', json: { source: key } });
    b.value = r.budget;
    toast.success(`أُضيف ${r.added} بندًا${r.updated ? ` وحُدّث ${r.updated}` : ''}${r.skipped ? ` (${r.skipped} موجود مسبقًا أو بلا حركة)` : ''}`);
  } catch (e) {
    toast.error(errMsg(e));
  } finally {
    busy.value = '';
  }
}
async function recalc() {
  busy.value = 'recalc';
  try {
    b.value = await api<any>(`/planning/budgets/${props.id}/recalculate`, { method: 'POST', json: {} });
    toast.success('أُعيد احتساب كل البنود بالمعادلات والافتراضات الحالية');
  } catch (e) { toast.error(errMsg(e)); } finally { busy.value = ''; }
}
async function toggle(l: any) {
  try {
    await api(`/planning/budget-lines/${l.id}`, { method: 'PATCH', json: { included: !l.included } });
    await load();
  } catch (e) { toast.error(errMsg(e)); }
}
async function removeBudget() {
  if (!confirm('حذف الموازنة وكل بنودها؟')) return;
  try { await api(`/planning/budgets/${props.id}`, { method: 'DELETE' }); router.push(isSc.value ? `/planning/budgets/${b.value.base.id}` : '/planning/budgets'); } catch (e) { toast.error(errMsg(e)); }
}
// تحويل السيناريو إلى مشروع موازنة على الأساسية
const promo = reactive<any>({ open: false, note: '', busy: false });
async function promote() {
  promo.busy = true;
  try {
    const r = await api<any>(`/planning/scenarios/${props.id}/promote`, { method: 'POST', json: { note: promo.note } });
    promo.open = false;
    toast.success('نُقل السيناريو إلى الموازنة الأساسية كمسودة. راجعها ثم ارفعها للاعتماد');
    router.push(`/planning/budgets/${r.id}`);
  } catch (e) { toast.error(errMsg(e)); } finally { promo.busy = false; }
}
function showCheck(c: any) {
  highlight.value = new Set(c.lineIds ?? []);
  const first = b.value.lines.find((l: any) => highlight.value.has(l.id));
  if (first) tab.value = first.section;
}

// إضافة بند
const KINDS: Record<string, [string, string][]> = {
  hr: [['new_position', 'وظيفة جديدة'], ['hr_other', 'مصروف موارد بشرية آخر']], opex: [['account', 'حساب من المحاسبة (بتاريخه)'], ['manual', 'بند يدوي']],
  activity: [['manual', 'بند يدوي']], revenue: [['account', 'حساب إيراد (بتاريخه)'], ['manual', 'إيراد متوقع جديد']],
};
const add = reactive<any>({ open: false, section: 'opex', kind: 'account', name: '', accountId: '', unitId: '', amount: null, basic: null, housing: null, transport: null, count: 1, startMonth: 1, isSaudi: true, jobTitle: '' });
function openAdd(section: string) {
  Object.assign(add, { open: true, section, kind: KINDS[section][0][0], name: '', accountId: '', unitId: '', amount: null, basic: null, housing: null, transport: null, count: 1, startMonth: 1, isSaudi: true, jobTitle: '' });
}
const accounts = computed(() => (lk.value?.accounts ?? []).filter((a: any) => (add.section === 'revenue' ? a.nature === 'revenue' : a.nature === 'expenses')));
async function saveAdd() {
  const params: any = {};
  if (add.kind === 'manual' || add.kind === 'hr_other') params.manualAmount = Number(add.amount) || 0;
  if (add.kind === 'manual' && add.section === 'activity') { params.cost = Number(add.amount) || 0; }
  if (add.kind === 'new_position') Object.assign(params, { jobTitle: add.jobTitle || add.name, basic: add.basic, housing: add.housing, transport: add.transport, count: add.count, startMonth: add.startMonth, endMonth: 12, isSaudi: add.isSaudi });
  const acc = accounts.value.find((a: any) => a.id === add.accountId);
  try {
    const l = await api<any>(`/planning/budgets/${props.id}/lines`, {
      method: 'POST', json: { section: add.section, kind: add.kind, name: add.name || acc?.name || '', accountId: add.accountId || null, unitId: add.unitId || null, params },
    });
    add.open = false;
    await load();
    selId.value = l.id;
    toast.success('أُضيف البند');
  } catch (e) { toast.error(errMsg(e)); }
}

// المقارنة بين الإصدارات
const cmp = reactive<any>({ from: 0, to: 0, data: null });
async function compare() {
  try { cmp.data = await api<any>(`/planning/budgets/${props.id}/compare?from=${cmp.from}${cmp.to ? `&to=${cmp.to}` : ''}`); } catch (e) { toast.error(errMsg(e)); }
}
watch(() => b.value?.versions, (v) => { if (v?.length && !cmp.from) { cmp.from = v[v.length - 1].version; cmp.to = v.length > 1 ? v[0].version : 0; } });
const CHANGE: Record<string, string> = { added: 'إضافة', removed: 'حذف', modified: 'تعديل' };
</script>

<template>
  <div v-if="error" class="alert alert-error">{{ error }}</div>
  <div v-else-if="b">
    <section class="pm-hero pl-hero bg-hero">
      <div>
        <p v-if="isSc" class="pm-kicker">{{ b.code }} · سيناريو مبني على <router-link :to="`/planning/budgets/${b.base?.id}`" class="sc-link">{{ b.base?.code }} {{ b.base?.title }}</router-link> · السنة المالية {{ b.fiscalYear }}</p>
        <p v-else class="pm-kicker">{{ b.code }} · الموازنة التقديرية · السنة المالية {{ b.fiscalYear }}</p>
        <h1>{{ b.title }}</h1>
        <p v-if="isSc" class="pm-sub">
          <span class="pm-pill" style="--c: #a78bfa">سيناريو للدراسة</span> · لا يؤثر على الموازنة حتى يُحوَّل إليها · آخر احتساب {{ fmtDateTime(b.calculatedAt) }}
          <template v-if="b.promotedAt"> · <span class="pm-pill" style="--c: #10b981">حُوّل إلى الموازنة {{ fmtDateTime(b.promotedAt) }}</span></template>
        </p>
        <p v-else class="pm-sub">
          <span class="pm-pill" :style="{ '--c': WF_STATUS[b.status]?.color }">{{ WF_STATUS[b.status]?.label }}</span>
          <template v-if="b.version"> · الإصدار المعتمد {{ b.version }}</template> · منهجية {{ b.methodologyName }} · آخر احتساب {{ fmtDateTime(b.calculatedAt) }}
        </p>
      </div>
      <div class="pm-actions">
        <RouterLink v-if="!isSc && (session.can(P.reports) || session.can(P.budgets))" class="btn rk-ghost" :to="`/planning/board-reports?type=${b.version ? 'budget-performance' : 'budget-approval'}&budgetId=${b.id}`">تقارير المجلس</RouterLink>
        <button v-if="editable && !isSc" class="btn rk-ghost" @click="importingLines = true">استيراد بنود من Excel</button>
        <button v-if="editable" class="btn rk-ghost" :disabled="!!busy" @click="recalc">{{ busy === 'recalc' ? 'جارٍ الاحتساب…' : 'إعادة الاحتساب' }}</button>
        <button v-if="isSc && canManage" class="btn pl-glow" @click="promo.open = true">تحويل إلى مشروع موازنة</button>
        <button v-if="canManage && !b.version && b.status !== 'in_review'" class="btn rk-ghost" @click="removeBudget">حذف</button>
      </div>
    </section>

    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #ef4444; --i: 0"><span>إجمالي المصروفات</span><strong style="font-size: 1.2rem">{{ money(b.summary.expenses) }}</strong><small>{{ b.summary.lines }} بندًا · {{ b.summary.overrides }} معدّل يدويًا</small></div>
      <div class="pm-kpi" style="--a: #a78bfa; --i: 1"><span>الإيرادات المتوقعة</span><strong style="font-size: 1.2rem">{{ money(b.summary.revenues) }}</strong><small>الإيرادات والتمويل</small></div>
      <div class="pm-kpi" :style="{ '--a': b.summary.balance < 0 ? '#dc2626' : '#10b981', '--i': 2 }"><span>{{ b.summary.balance < 0 ? 'العجز المتوقع' : 'الفائض المتوقع' }}</span>
        <strong style="font-size: 1.2rem">{{ money(Math.abs(b.summary.balance)) }}</strong><small>الإيرادات ناقص المصروفات</small></div>
      <div class="pm-kpi" style="--a: #0ea5e9; --i: 3"><span>القوى العاملة</span><strong>{{ b.summary.headcount.current }} + {{ b.summary.headcount.new }}</strong><small>حالي + وظائف جديدة</small></div>
      <div class="pm-kpi" style="--a: #64748b; --i: 4"><span>الموازنة الرأسمالية</span><strong style="font-size: 1.1rem">{{ money(b.summary.capital) }}</strong><small>من نظام الأصول (للعرض)</small></div>
    </div>

    <div class="rk-tabs pl-tabs">
      <button :class="['rk-tab', { on: tab === 'summary' }]" @click="tab = 'summary'">الملخص{{ b.checks.length ? ` (${b.checks.length} تنبيه)` : '' }}</button>
      <button :class="['rk-tab', { on: tab === 'assumptions' }]" @click="tab = 'assumptions'">الافتراضات والعلاوات</button>
      <button v-for="(s, k) in SECTIONS" :key="k" :class="['rk-tab', { on: tab === k }]" @click="tab = String(k); selId = null">{{ s.label }} <small>{{ short(secTotal(String(k))) }}</small></button>
      <button :class="['rk-tab', { on: tab === 'monthly' }]" @click="tab = 'monthly'">التوزيع الشهري</button>
      <button v-if="isSc" :class="['rk-tab', { on: tab === 'levers' }]" @click="tab = 'levers'">مؤثرات السيناريو ({{ (b.levers ?? []).length }})</button>
      <template v-else>
        <button v-if="b.version" :class="['rk-tab', { on: tab === 'execution' }]" @click="tab = 'execution'">التنفيذ والمناقلات</button>
        <button :class="['rk-tab', { on: tab === 'scenarios' }]" @click="tab = 'scenarios'">السيناريوهات والحساسية ({{ b.scenarios }})</button>
        <button :class="['rk-tab', { on: tab === 'approval' }]" @click="tab = 'approval'">الاعتماد والإصدارات ({{ b.versions.length }})</button>
      </template>
    </div>

    <!-- الملخص -->
    <template v-if="tab === 'summary'">
      <div class="bg-sections">
        <button v-for="(s, k, i) in SECTIONS" :key="k" class="bg-sec" :style="{ '--c': s.color, '--i': i }" @click="tab = String(k)">
          <span class="ic">{{ s.icon }}</span><small>{{ s.label }}</small><b>{{ money(secTotal(String(k))) }}</b>
          <i v-if="k !== 'revenue' && b.summary.expenses" class="bar"><u :style="{ width: `${(secTotal(String(k)) / b.summary.expenses) * 100}%` }" /></i>
          <em v-if="k !== 'revenue' && b.summary.expenses">{{ num((secTotal(String(k)) / b.summary.expenses) * 100) }}% من المصروفات</em>
        </button>
      </div>
      <div class="pl-layout">
        <div>
          <section v-if="b.checks.length" class="card pm-panel">
            <h2>فحوص السلامة</h2>
            <div v-for="(c, i) in b.checks" :key="i" class="bg-check" :style="{ '--c': LEVEL[c.level] }">
              <span>{{ c.text }}</span><button v-if="c.lineIds?.length" class="btn btn-sm" @click="showCheck(c)">عرض البنود</button>
            </div>
          </section>
          <section class="card pm-panel">
            <h2>الإدارات: الطلبات مقابل السقوف</h2>
            <div v-for="u in b.summary.byUnit" :key="u.unitId ?? 'none'" class="bg-unit">
              <div class="pl-flex" style="justify-content: space-between"><b>{{ u.unitName }}</b>
                <span>{{ money(u.total) }}<template v-if="u.ceiling !== null"> / سقف {{ money(u.ceiling) }}</template>
                  <b v-if="u.over > 0" style="color: #dc2626"> · تجاوز {{ money(u.over) }}</b></span></div>
              <div class="bg-ubar">
                <i :style="{ width: `${(u.hr / unitMax) * 100}%`, background: SECTIONS.hr.color }" /><i :style="{ width: `${(u.opex / unitMax) * 100}%`, background: SECTIONS.opex.color }" />
                <i :style="{ width: `${(u.activity / unitMax) * 100}%`, background: SECTIONS.activity.color }" />
                <u v-if="u.ceiling !== null" :style="{ insetInlineStart: `${(u.ceiling / unitMax) * 100}%` }" />
              </div>
            </div>
          </section>
        </div>
        <div>
          <section v-if="editable" class="card pm-panel">
            <h2>سحب البيانات من الأنظمة الأخرى</h2>
            <p class="pm-muted">كل استيراد يضيف الجديد فقط ولا يكرر الموجود، ويحفظ مصدر كل رقم.</p>
            <div class="bg-imports">
              <button v-for="im in IMPORTS.filter((x) => !x.hr || b.canHr)" :key="im.key" class="bg-import" :disabled="!!busy" @click="doImport(im.key)">
                <b>{{ busy === im.key ? 'جارٍ السحب…' : im.label }}</b><small>{{ im.hint }}</small>
              </button>
            </div>
          </section>
          <section class="card pm-panel">
            <h2>حسب نوع التمويل</h2>
            <div v-for="(v, k) in b.summary.byFunding" :key="k" v-show="v" class="bg-fund">
              <span>{{ FUNDING[k] ?? 'غير محدد' }}</span><i><u :style="{ width: `${fundingTotal ? ((v as number) / fundingTotal) * 100 : 0}%` }" /></i><b>{{ short(v as number) }}</b>
            </div>
            <h2 style="margin-top: 14px">حسب المنهجية</h2>
            <div v-for="m in b.summary.byMethodology" :key="m.key" class="bg-fund"><span>{{ m.name }}</span><i><u :style="{ width: `${(m.amount / b.summary.expenses) * 100}%` }" /></i><b>{{ short(m.amount) }}</b></div>
          </section>
          <section v-if="b.capital.length" class="card pm-panel">
            <h2>الموازنة الرأسمالية للسنة (من نظام الأصول)</h2>
            <div v-for="c in b.capital" :key="c.id" class="pl-flex" style="justify-content: space-between"><span>{{ c.description }}</span><b>{{ money(c.amount) }}</b></div>
          </section>
        </div>
      </div>
    </template>

    <BudgetAssumptions v-else-if="tab === 'assumptions' && lk" :budget="b" :lookups="lk" :editable="editable" @saved="(v: any) => (b = v)" />

    <!-- الأقسام -->
    <template v-else-if="SECTIONS[tab]">
      <div class="pm-filters">
        <input v-model="q" class="input" placeholder="بحث بالاسم أو الإدارة أو الحساب" />
        <button v-if="editable && lk" class="btn" @click="openAdd(tab)">+ بند</button>
        <span v-if="highlight.size" class="pm-tag" style="cursor: pointer" @click="highlight = new Set()">إلغاء التمييز ✕</span>
      </div>
      <div :class="sel ? 'pl-layout bg-split' : ''">
        <section class="card pm-panel" style="padding: 0; overflow: auto">
          <table class="table bg-lines">
            <thead><tr><th>البند</th><th>الإدارة / الحساب</th><th v-if="!sel">التقدير الآلي</th><th>في الموازنة</th><th v-if="!sel">الأشهر</th><th v-if="editable" /></tr></thead>
            <tbody>
              <tr v-for="l in lines(tab)" :key="l.id" :class="{ sel: selId === l.id, off: !l.included, hl: highlight.has(l.id) }" @click="!l.masked && (selId = l.id)">
                <td><b>{{ l.name }}</b><small class="pm-muted" style="display: block">{{ LINE_KIND[l.kind] }}</small>
                  <span v-if="l.note" class="pm-pill" style="--c: #64748b" :title="l.note">{{ l.included ? 'ملاحظة' : 'سبب الاستبعاد' }}</span>
                  <span v-if="l.warnings?.length" class="pm-pill" style="--c: #f59e0b" :title="l.warnings.join(' · ')">تنبيه</span>
                  <span v-if="l.overrideAmount !== null && l.overrideAmount !== undefined" class="pm-pill" style="--c: #b45309">معدّل</span></td>
                <td>{{ l.unitName ?? 'الشركة' }}<small v-if="l.accountCode" class="pm-muted" style="display: block">{{ l.accountCode }}</small></td>
                <td v-if="!sel" class="num">{{ num(l.auto, 0) }}</td>
                <td class="num"><b>{{ num(l.amount, 0) }}</b></td>
                <td v-if="!sel"><span class="bg-spark"><i v-for="(m, i) in l.monthly" :key="i" :style="{ height: `${Math.max(1, (Math.abs(m) / Math.max(1, ...l.monthly.map(Math.abs))) * 18)}px`, '--c': SECTIONS[tab].color }" /></span></td>
                <td v-if="editable" @click.stop><label v-if="!l.masked" class="bg-switch" :title="l.included ? 'يدخل في الإجمالي' : 'مستبعد'"><input type="checkbox" :checked="l.included" @change="toggle(l)" /><i /></label></td>
              </tr>
              <tr v-if="!lines(tab).length"><td colspan="6" class="pm-empty">لا توجد بنود.{{ editable ? ' استورد من الأنظمة الأخرى من «الملخص» أو أضف بندًا.' : '' }}</td></tr>
            </tbody>
            <tfoot><tr><td :colspan="sel ? 2 : 3">الإجمالي (البنود الداخلة)</td><td class="num"><b>{{ money(secTotal(tab)) }}</b></td><td colspan="2" /></tr></tfoot>
          </table>
        </section>
        <div v-if="sel && lk" class="pl-side">
          <BudgetLinePanel :line="sel" :budget="b" :lookups="lk" :editable="editable && (tab !== 'hr' || b.canHr)" @close="selId = null" @saved="load" />
        </div>
      </div>
    </template>

    <!-- التوزيع الشهري -->
    <section v-else-if="tab === 'monthly'" class="card pm-panel">
      <h2>التدفق الشهري المتوقع</h2>
      <div class="bg-chart">
        <div v-for="(m, i) in MONTHS" :key="i" class="col">
          <div class="bars">
            <i class="e" :style="{ height: `${(b.summary.byMonth.expenses[i] / maxMonth) * 100}%` }" :title="`المصروفات ${money(b.summary.byMonth.expenses[i])}`" />
            <i class="r" :style="{ height: `${(b.summary.byMonth.revenues[i] / maxMonth) * 100}%` }" :title="`الإيرادات ${money(b.summary.byMonth.revenues[i])}`" />
          </div>
          <small>{{ m }}</small>
        </div>
      </div>
      <div class="pl-flex" style="justify-content: center; margin: 8px 0 14px"><span class="bg-key e">المصروفات</span><span class="bg-key r">الإيرادات</span></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>القسم</th><th v-for="m in MONTHS" :key="m">{{ m }}</th></tr></thead>
          <tbody>
            <tr v-for="(s, k) in SECTIONS" :key="k"><td><b>{{ s.label }}</b></td>
              <td v-for="(_, i) in MONTHS" :key="i" class="num">{{ short(b.lines.filter((l: any) => l.section === k && l.included).reduce((t: number, l: any) => t + (l.monthly[i] ?? 0), 0)) }}</td></tr>
            <tr><td><b>الصافي</b></td><td v-for="(_, i) in MONTHS" :key="i" class="num" :style="{ color: b.summary.byMonth.revenues[i] - b.summary.byMonth.expenses[i] < 0 ? '#dc2626' : '#059669' }">
              {{ short(b.summary.byMonth.revenues[i] - b.summary.byMonth.expenses[i]) }}</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <ScenarioLevers v-else-if="tab === 'levers' && lk" :budget="b" :lookups="lk" :editable="!!editable" @saved="(v: any) => (b = v)" />
    <BudgetExecution v-else-if="tab === 'execution' && lk" :key="b.id" :budget="b" :lookups="lk" />
    <ScenariosPanel v-else-if="tab === 'scenarios'" :key="b.id" :budget="b" :can-manage="canManage" />

    <!-- الاعتماد والإصدارات -->
    <template v-else-if="tab === 'approval'">
      <PlanWorkflow :plan="flow" :can-manage="canManage" base="/planning/budgets" noun="الموازنة" @changed="(v: any) => (b = v)" />
      <section v-if="b.versions.length" class="card pm-panel">
        <h2>الإصدارات المعتمدة</h2>
        <table class="table">
          <thead><tr><th>الإصدار</th><th>المصروفات</th><th>الإيرادات</th><th>السبب</th><th>اعتمدها</th><th>التاريخ</th></tr></thead>
          <tbody><tr v-for="v in b.versions" :key="v.id"><td><b>{{ v.version }}</b></td><td class="num">{{ money(v.expenses) }}</td><td class="num">{{ money(v.revenues) }}</td><td>{{ v.note }}</td><td>{{ v.approvedByName }}</td><td>{{ fmtDateTime(v.approvedAt) }}</td></tr></tbody>
        </table>
        <div class="pl-flex" style="margin-top: 12px">
          <span>قارن الإصدار</span><select v-model.number="cmp.from" class="input" style="width: auto"><option v-for="v in b.versions" :key="v.id" :value="v.version">{{ v.version }}</option></select>
          <span>مع</span><select v-model.number="cmp.to" class="input" style="width: auto"><option :value="0">المسودة الحالية</option><option v-for="v in b.versions" :key="v.id" :value="v.version">الإصدار {{ v.version }}</option></select>
          <button class="btn btn-sm" @click="compare">مقارنة</button>
        </div>
        <template v-if="cmp.data">
          <div class="bg-sections" style="margin-top: 12px">
            <div v-for="(s, k) in SECTIONS" :key="k" class="bg-sec" :style="{ '--c': s.color }"><small>{{ s.label }}</small>
              <b>{{ short(cmp.data.totals.after[k]) }}</b><em :style="{ color: cmp.data.totals.after[k] - cmp.data.totals.before[k] > 0 ? '#b45309' : '#047857' }">
                {{ Math.round(cmp.data.totals.after[k] - cmp.data.totals.before[k]) === 0 ? 'بلا تغيير' : `${cmp.data.totals.after[k] - cmp.data.totals.before[k] > 0 ? '+' : ''}${short(cmp.data.totals.after[k] - cmp.data.totals.before[k])}` }}</em></div>
          </div>
          <p v-if="cmp.data.variables.length" class="pm-muted">الافتراضات المتغيرة: <span v-for="v in cmp.data.variables" :key="v.key">{{ v.name }} من {{ v.before ?? '—' }} إلى {{ v.after ?? '—' }}، </span></p>
          <p v-if="cmp.data.rulesChanged" class="pm-muted">تغيرت قواعد العلاوات.</p>
          <table class="table pl-diff">
            <thead><tr><th>التغيير</th><th>القسم</th><th>البند</th><th>قبل</th><th>بعد</th><th>الفرق</th></tr></thead>
            <tbody><tr v-for="(r, i) in cmp.data.rows.slice(0, 80)" :key="i"><td :class="r.change">{{ CHANGE[r.change] }}</td><td>{{ SECTIONS[r.section]?.label }}</td><td>{{ r.name }}</td>
              <td class="num">{{ num(r.before, 0) }}</td><td class="num">{{ num(r.after, 0) }}</td><td class="num" :class="r.diff > 0 ? 'modified' : 'added'">{{ num(r.diff, 0) }}</td></tr>
              <tr v-if="!cmp.data.rows.length"><td colspan="6" class="pm-empty">لا فروق في البنود.</td></tr></tbody>
          </table>
        </template>
      </section>
    </template>

    <div v-if="promo.open" class="modal-backdrop" @click.self="promo.open = false">
      <form class="card modal" @submit.prevent="promote">
        <h2>تحويل السيناريو إلى مشروع موازنة</h2>
        <p>تُنقل افتراضات هذا السيناريو وبنوده ومؤثراته إلى «{{ b.base?.title }}»، فتصبح مسودة{{ b.base?.version ? ' تعديل على الإصدار المعتمد' : '' }} تُرفع للاعتماد بمسارها المعتاد.
          {{ b.base?.version ? 'الإصدار المعتمد الحالي يبقى ساريًا حتى يُعتمد التعديل، ويمكن إلغاء التعديل والعودة إليه.' : '' }}</p>
        <label class="field"><span>سبب اختيار هذا السيناريو</span><textarea v-model="promo.note" class="input" rows="3" required minlength="3" /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="promo.busy">تحويل</button><button type="button" class="btn" @click="promo.open = false">إلغاء</button></div>
      </form>
    </div>

    <div v-if="add.open" class="modal-backdrop" @click.self="add.open = false">
      <form class="card modal" @submit.prevent="saveAdd">
        <h2>بند جديد في {{ SECTIONS[add.section].label }}</h2>
        <label class="field"><span>النوع</span><select v-model="add.kind" class="input"><option v-for="[k, l] in KINDS[add.section]" :key="k" :value="k">{{ l }}</option></select></label>
        <label v-if="add.kind === 'account'" class="field"><span>الحساب</span><select v-model="add.accountId" class="input" required>
          <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}{{ a.payroll ? ' (حساب رواتب)' : '' }}</option></select></label>
        <label class="field"><span>{{ add.kind === 'new_position' ? 'المسمى الوظيفي' : 'اسم البند' }}</span><input v-model="add.name" class="input" :required="add.kind !== 'account'" :placeholder="add.kind === 'account' ? 'اسم الحساب افتراضيًا' : ''" /></label>
        <label class="field"><span>الإدارة</span><select v-model="add.unitId" class="input"><option value="">الشركة</option><option v-for="u in lk.units" :key="u.id" :value="u.id">{{ u.name }}</option></select></label>
        <label v-if="['manual', 'hr_other'].includes(add.kind)" class="field"><span>المبلغ السنوي</span><input v-model="add.amount" type="number" step="any" class="input" required /></label>
        <div v-if="add.kind === 'new_position'" class="rk-fields">
          <label class="field"><span>الأساسي</span><input v-model.number="add.basic" type="number" class="input" required /></label>
          <label class="field"><span>السكن</span><input v-model.number="add.housing" type="number" class="input" /></label>
          <label class="field"><span>النقل</span><input v-model.number="add.transport" type="number" class="input" /></label>
          <label class="field"><span>العدد</span><input v-model.number="add.count" type="number" min="1" class="input" /></label>
          <label class="field"><span>شهر التعيين</span><select v-model.number="add.startMonth" class="input"><option v-for="(m, i) in MONTHS" :key="i" :value="i + 1">{{ m }}</option></select></label>
          <label class="field pl-flex"><input v-model="add.isSaudi" type="checkbox" /> سعودي</label>
        </div>
        <p v-if="add.kind === 'account'" class="pm-muted">يُجلب الفعلي الشهري للحساب من المحاسبة، ويُقدّر بالمعادلة الافتراضية، ويمكن تغييرها من تفاصيل البند.</p>
        <div class="modal-actions"><button class="btn btn-primary">إضافة</button><button type="button" class="btn" @click="add.open = false">إلغاء</button></div>
      </form>
    </div>
    <ExcelImportDialog v-if="importingLines && b" title="استيراد بنود الموازنة من Excel"
      intro="إيرادات ومصروفات ومبالغ للموارد البشرية ووظائف تُحتسب بمعادلات النظام. أنشطة الخطط التشغيلية المعتمدة تُستورد من «الأنشطة» لا من هذا الملف. يُفحص الملف أولًا دون حفظ، ولا يتكرر بند موجود بالقسم والاسم نفسيهما."
      template-url="/planning/budget-lines/import/template" template-name="نموذج استيراد بنود الموازنة.xlsx" :upload-url="`/planning/budgets/${b.id}/lines/import`"
      @close="importingLines = false" @done="load">
      <template #summary="{ report }">
        <ul class="pm-sub" style="margin: 0">
          <li>{{ (report.lines as any[]).filter((l) => l.status === 'new').length }} بندًا جديدًا من {{ (report.lines as any[]).length }}</li>
          <li>الإيرادات {{ money((report.totals as any).revenue) }} · الموارد البشرية {{ money((report.totals as any).hr) }} · المصروفات التشغيلية {{ money((report.totals as any).opex) }} · الأنشطة {{ money((report.totals as any).activity) }}</li>
        </ul>
      </template>
    </ExcelImportDialog>
  </div>
</template>
