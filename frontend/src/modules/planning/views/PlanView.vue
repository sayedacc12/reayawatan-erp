<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import ItemForm from '../components/ItemForm.vue';
import ItemPanel from '../components/ItemPanel.vue';
import KpiForm from '../components/KpiForm.vue';
import KpiReadings from '../components/KpiReadings.vue';
import MiniBar from '../components/MiniBar.vue';
import PlanForm from '../components/PlanForm.vue';
import PlanIntegrations from '../components/PlanIntegrations.vue';
import PlanWorkflow from '../components/PlanWorkflow.vue';
import ProgressRing from '../components/ProgressRing.vue';
import {
  BAND, DIRECTION, errMsg, EXEC, fmtDate, fmtDateTime, FUNDING, KIND, loadConfig, loadLookups, money, num, P, pct, PERIODICITY, WF_STATUS,
  type ConfigPayload, type Item, type Lookups,
} from '../lib';
import '../../../shared/module.css';
import '../../risk/risk.css';
import '../planning.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = 'structure' | 'kpis' | 'trace' | 'integrations' | 'timeline' | 'cost' | 'versions';
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const plan = ref<any>(null);
const cfg = ref<ConfigPayload | null>(null);
const lookups = ref<Lookups | null>(null);
const linkOptions = ref<any[]>([]);
const allPlans = ref<any[]>([]);
const strategicPlans = computed(() => allPlans.value.filter((p) => p.kind === 'strategic'));
const error = ref('');
const tab = ref<Tab>((['structure', 'kpis', 'trace', 'integrations', 'timeline', 'cost', 'versions'].includes(String(route.query.tab)) ? route.query.tab : 'structure') as Tab);
const selId = ref<string | null>((route.query.item as string) ?? null);
const collapsed = reactive(new Set<string>());

async function load() {
  try {
    plan.value = await api(`/planning/plans/${props.id}`);
    if (!selId.value || !plan.value.items.some((i: Item) => i.id === selId.value)) selId.value = plan.value.items.find((i: Item) => !i.parentId)?.id ?? null;
  } catch (e) {
    error.value = errMsg(e);
  }
}
onMounted(async () => {
  await load();
  [cfg.value, lookups.value, linkOptions.value, allPlans.value] = await Promise.all([loadConfig(), loadLookups(), api<any[]>('/planning/link-options'), api<any[]>('/planning/plans')]);
});
watch(() => props.id, () => { selId.value = (route.query.item as string) ?? null; load(); });
watch(() => route.query.item, (v) => { if (v) { selId.value = String(v); tab.value = 'structure'; } });
async function changed(v: any) {
  if (v?.id === props.id) plan.value = v;
  else await load();
  linkOptions.value = await api<any[]>('/planning/link-options');
}

const canManage = computed(() => !!plan.value && session.can(plan.value.kind === 'strategic' ? P.strategic : P.operational));
const editable = computed(() => canManage.value && ['draft', 'returned', 'approved'].includes(plan.value?.status));
const items = computed<Item[]>(() => plan.value?.items ?? []);
const byParent = computed(() => {
  const m = new Map<string | null, Item[]>();
  for (const i of items.value) m.set(i.parentId, [...(m.get(i.parentId) ?? []), i]);
  for (const l of m.values()) l.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  return m;
});
const tree = computed(() => {
  const out: Item[] = [];
  const walk = (pid: string | null) => { for (const i of byParent.value.get(pid) ?? []) { out.push(i); if (!collapsed.has(i.id)) walk(i.id); } };
  walk(null);
  return out;
});
const sel = computed(() => items.value.find((i) => i.id === selId.value) ?? null);
function select(id: string) {
  selId.value = id;
  router.replace({ query: { ...route.query, item: id } });
}
const toggle = (id: string) => (collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id));
const lvColor = ['#e0f2fe', '#dcfce7', '#fef9c3', '#fae8ff', '#ffe4e6', '#e2e8f0'];

const itemForm = ref<{ item: Item | null; parentId: string | null; level: number } | null>(null);
const kpiForm = ref<{ kpi: any | null; itemId: string | null } | null>(null);
const readings = ref<any>(null);
const editHeader = ref(false);
function savedItem(v: any) { itemForm.value = null; changed(v); }
function savedKpi(v: any) { kpiForm.value = null; changed(v); }
function savedReading(v: any) {
  changed(v);
  readings.value = v.kpis.find((k: any) => k.id === readings.value?.id) ?? null;
}
async function removeKpi(k: any) {
  if (!confirm(`حذف المؤشر ${k.code}؟`)) return;
  try { changed(await api(`/planning/kpis/${k.id}`, { method: 'DELETE' })); } catch (e) { toast.error(errMsg(e)); }
}
async function removePlan() {
  if (!confirm(`حذف الخطة ${plan.value.code} بكل عناصرها؟`)) return;
  try {
    await api(`/planning/plans/${props.id}`, { method: 'DELETE' });
    toast.success('حُذفت الخطة');
    router.push(`/planning/${plan.value.kind}`);
  } catch (e) { toast.error(errMsg(e)); }
}
const copy = reactive({ open: false, title: '', startYear: 0, endYear: 0 });
function openCopy() {
  const d = plan.value.endYear - plan.value.startYear + 1;
  Object.assign(copy, { open: true, title: `${plan.value.title} (نسخة)`, startYear: plan.value.endYear + 1, endYear: plan.value.endYear + d });
}
async function doCopy() {
  try {
    const res = await api<any>(`/planning/plans/${props.id}/copy`, { method: 'POST', json: { title: copy.title, startYear: copy.startYear, endYear: copy.endYear } });
    copy.open = false;
    toast.success(`أُنشئت ${res.code}`);
    router.push(`/planning/plans/${res.id}`);
  } catch (e) { toast.error(errMsg(e)); }
}

// ----- التتبع: من الخطة إلى الأنشطة المساهمة
const incoming = (id: string) => (plan.value?.links ?? []).filter((l: any) => l.toItemId === id);
const outgoing = (id: string) => (plan.value?.links ?? []).filter((l: any) => l.fromItemId === id);

// ----- الجدول الزمني
const ganttYear = ref<number>(new Date().getFullYear());
watch(plan, (p) => { if (p && (ganttYear.value < p.startYear || ganttYear.value > p.endYear)) ganttYear.value = p.startYear; }, { immediate: true });
const MONTHS = ['ينا', 'فبر', 'مار', 'أبر', 'ماي', 'يون', 'يول', 'أغس', 'سبت', 'أكت', 'نوف', 'ديس'];
const ganttRows = computed(() => {
  const y0 = Date.UTC(ganttYear.value, 0, 1), y1 = Date.UTC(ganttYear.value + 1, 0, 1), span = y1 - y0;
  const t = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
  return tree.value.filter((i) => i.startDate && i.endDate && t(i.startDate) < y1 && t(i.endDate) >= y0).map((i) => {
    const s = Math.max(t(i.startDate!), y0), e = Math.min(t(i.endDate!) + 86400000, y1);
    return { i, left: ((s - y0) / span) * 100, width: Math.max(1, ((e - s) / span) * 100) };
  });
});
const nowPos = computed(() => {
  const n = Date.now(), y0 = Date.UTC(ganttYear.value, 0, 1), y1 = Date.UTC(ganttYear.value + 1, 0, 1);
  return n >= y0 && n < y1 ? ((n - y0) / (y1 - y0)) * 100 : null;
});

// ----- التكلفة لكل سنة
const costRows = computed(() => tree.value.map((i) => ({ i, years: (plan.value.periods as number[]).map((y) => Number(i.rolledCostByYear?.[String(y)] ?? 0)) })));
const costTotals = computed(() => (plan.value?.periods ?? []).map((y: number) => items.value.filter((i) => !i.parentId && i.state !== 'cancelled').reduce((s, i) => s + Number(i.rolledCostByYear?.[String(y)] ?? 0), 0)));
const fundingSplit = computed(() => {
  const out: Record<string, number> = {};
  for (const i of items.value) if (i.state !== 'cancelled') out[i.fundingType ?? 'none'] = (out[i.fundingType ?? 'none'] ?? 0) + i.plannedCost;
  return out;
});

// ----- الإصدارات والمقارنة
const cmp = reactive({ from: 0, to: 0, data: null as any, busy: false });
watch(plan, (p) => {
  if (!p || cmp.from) return;
  if (p.versions.length) { cmp.from = p.versions[p.versions.length - 1].version; cmp.to = p.status === 'approved' ? p.versions[0].version : 0; }
}, { immediate: true });
async function compare() {
  if (!cmp.from) return;
  cmp.busy = true;
  try { cmp.data = await api(`/planning/plans/${props.id}/compare?from=${cmp.from}&to=${cmp.to}`); } catch (e) { toast.error(errMsg(e)); } finally { cmp.busy = false; }
}
watch(() => [tab.value, cmp.from, cmp.to], () => { if (tab.value === 'versions' && cmp.from) compare(); });
const CHANGE: Record<string, string> = { added: 'أُضيف', removed: 'حُذف', modified: 'عُدّل' };
const KIND_ROW: Record<string, string> = { plan: 'الخطة', item: 'عنصر', kpi: 'مؤشر', link: 'ربط' };
const show = (v: any) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'number' ? num(v) : typeof v === 'object' ? (Array.isArray(v) ? `${v.length} بند` : Object.entries(v).map(([k, x]) => `${k}: ${typeof x === 'number' ? num(x) : x}`).join('، ')) : String(v));
const summaryColor = computed(() => (plan.value?.summary.delayed ? EXEC.delayed.color : plan.value?.summary.atRisk ? EXEC.at_risk.color : '#38bdf8'));
</script>

<template>
  <div v-if="error" class="alert alert-error">{{ error }}</div>
  <div v-else-if="plan">
    <section class="pm-hero pl-hero">
      <div style="display: flex; gap: 18px; align-items: center">
        <ProgressRing :value="plan.summary.progress" :planned="plan.summary.planned" :color="summaryColor" :size="96" label="إنجاز" />
        <div>
          <p class="pm-kicker">{{ plan.code }} · خطة {{ KIND[plan.kind] }} · {{ plan.startYear }}{{ plan.endYear !== plan.startYear ? ` - ${plan.endYear}` : '' }}</p>
          <h1>{{ plan.title }}</h1>
          <p class="pm-sub">
            <span class="pm-pill" :style="{ '--c': WF_STATUS[plan.status]?.color }">{{ WF_STATUS[plan.status]?.label }}</span>
            <template v-if="plan.unitName"> · {{ plan.unitName }}</template><template v-if="plan.ownerName"> · {{ plan.ownerName }}</template>
            · متابعة {{ PERIODICITY[plan.periodicity] }}
            <template v-if="plan.parent"> · تتبع <RouterLink :to="`/planning/plans/${plan.parent.id}`" style="color: #7dd3fc">{{ plan.parent.code }} {{ plan.parent.title }}</RouterLink></template>
          </p>
        </div>
      </div>
      <div class="pm-actions">
        <button v-if="editable" class="btn rk-ghost" @click="editHeader = true">بيانات الخطة</button>
        <button v-if="canManage" class="btn rk-ghost" @click="openCopy">نسخ لفترة جديدة</button>
        <button v-if="canManage && !plan.version && plan.status !== 'in_review'" class="btn rk-ghost" @click="removePlan">حذف</button>
      </div>
    </section>

    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #0ea5e9; --i: 0"><span>الإنجاز الفعلي</span><strong>{{ pct(plan.summary.progress) }}</strong><small>المخطط حتى اليوم {{ pct(plan.summary.planned) }}</small></div>
      <div class="pm-kpi" style="--a: #10b981; --i: 1"><span>تحقق المؤشرات</span><strong>{{ pct(plan.summary.performance) }}</strong>
        <small><span v-for="(n, b) in plan.summary.kpiBands" :key="b"><template v-if="n">{{ n }} {{ BAND[b].label }} · </template></span>{{ plan.summary.kpis }} مؤشرًا</small></div>
      <div class="pm-kpi" style="--a: #ef4444; --i: 2"><span>متأخر / في خطر</span><strong>{{ plan.summary.delayed }} / {{ plan.summary.atRisk }}</strong><small>{{ plan.summary.completed }} منجز من {{ plan.summary.leaves }}</small></div>
      <div class="pm-kpi" style="--a: #a78bfa; --i: 3"><span>التكلفة التقديرية</span><strong style="font-size: 1.15rem">{{ money(plan.summary.totalCost) }}</strong><small>منها {{ money(plan.summary.yearCost) }} في {{ plan.summary.year }}</small></div>
      <div class="pm-kpi" style="--a: #f59e0b; --i: 4"><span>عناصر الخطة</span><strong>{{ plan.summary.items }}</strong><small>{{ plan.summary.unowned }} بلا مسؤول</small></div>
    </div>

    <div class="rk-tabs pl-tabs">
      <button :class="['rk-tab', { on: tab === 'structure' }]" @click="tab = 'structure'">هيكل الخطة</button>
      <button :class="['rk-tab', { on: tab === 'kpis' }]" @click="tab = 'kpis'">المؤشرات ({{ plan.kpis.length }})</button>
      <button :class="['rk-tab', { on: tab === 'trace' }]" @click="tab = 'trace'">الربط والتتبع ({{ plan.links.length }})</button>
      <button :class="['rk-tab', { on: tab === 'integrations' }]" @click="tab = 'integrations'">المخاطر والمراجعة والتحليل</button>
      <button :class="['rk-tab', { on: tab === 'timeline' }]" @click="tab = 'timeline'">الجدول الزمني</button>
      <button :class="['rk-tab', { on: tab === 'cost' }]" @click="tab = 'cost'">التكلفة</button>
      <button :class="['rk-tab', { on: tab === 'versions' }]" @click="tab = 'versions'">الاعتماد والإصدارات ({{ plan.versions.length }})</button>
    </div>

    <!-- الهيكل -->
    <div v-if="tab === 'structure'" class="pl-layout">
      <div>
        <div v-if="plan.vision || plan.mission" class="pl-vision">
          <div v-if="plan.vision" class="pl-vm" style="--c: #0ea5e9"><b>الرؤية</b><p>{{ plan.vision }}</p></div>
          <div v-if="plan.mission" class="pl-vm" style="--c: #10b981"><b>الرسالة</b><p>{{ plan.mission }}</p>
            <div v-if="plan.values.length" class="pl-values"><span v-for="v in plan.values" :key="v">{{ v }}</span></div></div>
        </div>
        <section class="card pm-panel">
          <h2><span>الهيكل <span class="pm-muted">{{ plan.levels.map((l: any) => l.name).join(' ← ') }}</span></span>
            <span class="pl-flex"><button class="btn btn-sm" @click="collapsed.clear()">فتح الكل</button>
              <button class="btn btn-sm" @click="items.filter((i) => i.hasChildren).forEach((i) => collapsed.add(i.id))">طي الكل</button></span></h2>
          <p v-if="!items.length" class="pm-empty">لا توجد عناصر بعد.</p>
          <div class="pl-tree">
            <template v-for="i in tree" :key="i.id">
              <div :class="['pl-node', { sel: i.id === selId }]" :data-lv="i.level" :style="{ '--lv': i.level, '--branch': i.level ? 'block' : 'none', opacity: ['cancelled', 'carried_over'].includes(i.state) ? 0.55 : 1 }" @click="select(i.id)">
                <span class="t">
                  <button v-if="i.hasChildren" class="btn btn-sm" style="padding: 0 6px" @click.stop="toggle(i.id)">{{ collapsed.has(i.id) ? '+' : '−' }}</button>
                  <span class="pl-lvl" :style="{ '--c': lvColor[i.level] }">{{ plan.levels[i.level]?.name }}</span>
                  <span class="rk-code">{{ i.code }}</span><span class="title">{{ i.title }}</span>
                  <span v-if="i.progressSource === 'links'" class="pm-tag" title="إنجازه من العناصر المرتبطة">↤ مرتبط</span>
                </span>
                <span class="m">
                  <span v-if="i.ownerName">{{ i.ownerName }}</span>
                  <MiniBar :value="i.rolledProgress" :planned="i.plannedProgress" :color="EXEC[i.execStatus]?.color" />
                  <b :style="{ color: EXEC[i.execStatus]?.color, minWidth: '42px' }">{{ pct(i.rolledProgress) }}</b>
                </span>
              </div>
            </template>
            <button v-if="editable" class="pl-add" @click="itemForm = { item: null, parentId: null, level: 0 }">+ إضافة {{ plan.levels[0]?.name }}</button>
          </div>
        </section>
        <section v-if="plan.children.length" class="card pm-panel" style="margin-top: 16px">
          <h2>الخطط التشغيلية التابعة ({{ plan.children.length }})</h2>
          <table class="table"><tbody>
            <tr v-for="c in plan.children" :key="c.id" class="rk-row" @click="router.push(`/planning/plans/${c.id}`)">
              <td><span class="rk-code">{{ c.code }}</span> {{ c.title }}<span class="pm-muted">{{ c.unitName }} · {{ c.startYear }}</span></td>
              <td><span class="pm-pill" :style="{ '--c': WF_STATUS[c.status]?.color }">{{ WF_STATUS[c.status]?.label }}</span></td>
              <td style="width: 160px"><MiniBar :value="c.progress" :planned="c.planned" /> {{ pct(c.progress) }}</td>
            </tr>
          </tbody></table>
        </section>
      </div>
      <div class="pl-side">
        <ItemPanel v-if="sel && cfg && lookups" :plan="plan" :item="sel" :lookups="lookups" :config="cfg.config" :can-manage="canManage" :link-options="linkOptions" :plans="allPlans"
          @changed="changed" @select="select" @edit="itemForm = { item: sel, parentId: sel.parentId, level: sel.level }"
          @add-child="itemForm = { item: null, parentId: sel.id, level: sel.level + 1 }" @add-kpi="kpiForm = { kpi: null, itemId: sel.id }" @kpi="(k: any) => (readings = k)" />
        <section v-else class="card pm-panel"><p class="pm-empty">اختر عنصرًا من الهيكل لعرض تفاصيله</p></section>
      </div>
    </div>

    <!-- المؤشرات -->
    <section v-if="tab === 'kpis' && cfg" class="card pm-panel">
      <h2>مؤشرات الأداء <button v-if="editable || (session.can(P.kpis) && plan.status !== 'in_review')" class="btn btn-sm btn-primary" @click="kpiForm = { kpi: null, itemId: null }">+ مؤشر</button></h2>
      <p v-if="!plan.kpis.length" class="pm-empty">لا توجد مؤشرات بعد.</p>
      <div v-else class="table-wrap"><table class="table">
        <thead><tr><th /><th>المؤشر</th><th>العنصر</th><th>الدورية</th><th>خط الأساس</th><th>مستهدف السنة</th><th>الفعلي</th><th>التحقق</th><th>المسار</th><th /></tr></thead>
        <tbody>
          <tr v-for="k in plan.kpis" :key="k.id" class="pl-kpi-row">
            <td><span class="pl-band" :style="{ '--c': BAND[k.stat?.band ?? 'none'].color }" :title="BAND[k.stat?.band ?? 'none'].label" /></td>
            <td style="white-space: normal"><span class="rk-code">{{ k.code }}</span> {{ k.name }}<span class="pm-muted">{{ k.unit }} · {{ DIRECTION[k.direction] }}<template v-if="k.ownerName"> · {{ k.ownerName }}</template></span></td>
            <td>{{ items.find((i) => i.id === k.itemId)?.code ?? 'الخطة' }}</td>
            <td>{{ PERIODICITY[k.frequency] }}</td>
            <td>{{ num(k.baseline) }}</td>
            <td>{{ num(k.stat?.target) }}</td>
            <td>{{ num(k.stat?.actual) }}</td>
            <td><b :style="{ color: BAND[k.stat?.band ?? 'none'].color }">{{ k.stat?.ach === null || k.stat?.ach === undefined ? '—' : `${num(k.stat.ach)}%` }}</b>
              <span v-if="k.stat?.missing.length" class="pm-muted">{{ k.stat.missing.length }} فترة بلا قراءة</span></td>
            <td><div class="pl-spark">
              <span v-for="s in k.stat?.series ?? []" :key="s.year" :title="`${s.year}: ${num(s.actual)} من ${num(s.target)}`"
                :style="{ height: `${Math.max(8, Math.min(100, s.ach ?? 0))}%`, '--c': BAND[s.ach === null ? 'none' : s.ach >= cfg!.config.thresholds.green ? 'green' : s.ach >= cfg!.config.thresholds.amber ? 'amber' : 'red'].color }"
                :class="{ t: s.ach === null }" /></div></td>
            <td style="white-space: nowrap">
              <button class="btn btn-sm" @click="readings = k">القراءات</button>
              <button v-if="editable || session.can(P.kpis)" class="btn btn-sm" @click="kpiForm = { kpi: k, itemId: k.itemId }">تعديل</button>
              <button v-if="editable || session.can(P.kpis)" class="btn btn-sm" @click="removeKpi(k)">✕</button>
            </td>
          </tr>
        </tbody>
      </table></div>
    </section>

    <!-- التتبع -->
    <section v-if="tab === 'trace'" class="card pm-panel">
      <h2>{{ plan.kind === 'strategic' ? 'من الأهداف الاستراتيجية إلى الأنشطة المساهمة' : 'إسهام أنشطة الخطة في الخطة الاستراتيجية' }}</h2>
      <p class="pm-muted" style="margin-top: -6px">كل عنصر يعرض العناصر التي تسهم فيه من الخطط الأخرى ونسبة مساهمتها، فيُحسب إنجازه منها تلقائيًا.</p>
      <div class="pl-trace">
        <template v-for="i in tree" :key="i.id">
          <div v-if="incoming(i.id).length || outgoing(i.id).length || !i.parentId" class="pl-trace-node" :style="{ '--lv': i.level }">
            <header>
              <span class="pl-flex"><span class="pl-lvl" :style="{ '--c': lvColor[i.level] }">{{ plan.levels[i.level]?.name }}</span><span class="rk-code">{{ i.code }}</span> <b>{{ i.title }}</b></span>
              <span class="pl-flex"><MiniBar :value="i.rolledProgress" :planned="i.plannedProgress" :color="EXEC[i.execStatus]?.color" /><b>{{ pct(i.rolledProgress) }}</b></span>
            </header>
            <div v-if="incoming(i.id).length" class="pl-contrib">
              <RouterLink v-for="l in incoming(i.id)" :key="l.id" :to="`/planning/plans/${l.from?.planId}?item=${l.fromItemId}`">
                <span>↤ <span class="rk-code">{{ l.from?.planCode }} · {{ l.from?.code }}</span> {{ l.from?.title }} <span class="pm-muted" style="display: inline">{{ l.from?.unitName }}{{ l.from?.ownerName ? ` · ${l.from.ownerName}` : '' }}</span></span>
                <span class="pl-flex"><span class="pm-pill" :style="{ '--c': EXEC[l.from?.status]?.color ?? '#94a3b8' }">{{ pct(l.from?.progress) }}</span><span class="pm-tag">{{ l.contribution === null ? 'بالتساوي' : `${num(l.contribution)}%` }}</span></span>
              </RouterLink>
            </div>
            <div v-if="outgoing(i.id).length" class="pl-contrib" style="border-color: #86efac">
              <RouterLink v-for="l in outgoing(i.id)" :key="l.id" :to="`/planning/plans/${l.to?.planId}?item=${l.toItemId}`" style="background: #f0fdf4">
                <span>↦ يسهم في <span class="rk-code">{{ l.to?.planCode }} · {{ l.to?.code }}</span> {{ l.to?.title }}</span>
                <span class="pm-tag">{{ l.contribution === null ? 'بالتساوي' : `${num(l.contribution)}%` }}</span>
              </RouterLink>
            </div>
            <p v-if="!i.parentId && !incoming(i.id).length && !outgoing(i.id).length && !i.hasChildren" class="pm-muted" style="margin: 6px 0 0">لا يوجد ربط بعد</p>
          </div>
        </template>
      </div>
    </section>

    <PlanIntegrations v-if="tab === 'integrations'" :key="plan.id" :plan="plan" :editable="!!editable" @changed="changed" @select="(id: string) => { select(id); tab = 'structure'; }" />

    <!-- الجدول الزمني -->
    <section v-if="tab === 'timeline'" class="card pm-panel">
      <h2>الجدول الزمني
        <span class="rk-tabs" style="margin: 0"><button v-for="y in plan.periods" :key="y" :class="['rk-tab', { on: ganttYear === y }]" @click="ganttYear = y">{{ y }}</button></span></h2>
      <p v-if="!ganttRows.length" class="pm-empty">لا توجد عناصر بتواريخ في {{ ganttYear }}</p>
      <div v-else class="pl-gantt">
        <div class="pl-grow"><span /><div class="pl-months"><span v-for="m in MONTHS" :key="m">{{ m }}</span></div></div>
        <div v-for="r in ganttRows" :key="r.i.id" class="pl-grow" style="cursor: pointer" @click="select(r.i.id); tab = 'structure'">
          <span class="lbl" :style="{ paddingInlineStart: `${r.i.level * 12}px`, fontWeight: r.i.level ? 400 : 700 }"><span class="rk-code">{{ r.i.code }}</span> {{ r.i.title }}</span>
          <div class="pl-track">
            <span class="bar" :style="{ insetInlineStart: `${r.left}%`, width: `${r.width}%`, '--c': EXEC[r.i.execStatus]?.color }" :title="`${fmtDate(r.i.startDate)} ← ${fmtDate(r.i.endDate)} · ${pct(r.i.rolledProgress)}`">
              <i :style="{ width: `${r.i.rolledProgress}%` }" /></span>
            <span v-if="nowPos !== null" class="now" :style="{ insetInlineStart: `${nowPos}%` }" />
          </div>
        </div>
        <div class="pm-legend" style="margin-top: 8px"><span v-for="s in ['on_track', 'at_risk', 'delayed', 'completed', 'not_started']" :key="s" :style="{ '--c': EXEC[s].color }">{{ EXEC[s].label }}</span></div>
      </div>
    </section>

    <!-- التكلفة -->
    <section v-if="tab === 'cost'" class="card pm-panel">
      <h2>التكلفة التقديرية لكل سنة <span class="pl-flex"><span v-for="(v, k) in fundingSplit" :key="k" class="pm-tag">{{ k === 'none' ? 'تمويل غير محدد' : FUNDING[k] }}: {{ money(v) }}</span></span></h2>
      <p class="pm-muted" style="margin-top: -6px">تكلفة كل عنصر تشمل فروعه. هذه أرقام تخطيطية تُبنى عليها الموازنة التقديرية في المرحلة القادمة.</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>العنصر</th><th v-for="y in plan.periods" :key="y">{{ y }}</th><th>الإجمالي</th></tr></thead>
        <tbody>
          <tr v-for="r in costRows" :key="r.i.id" :style="{ fontWeight: r.i.level ? 400 : 700 }">
            <td :style="{ paddingInlineStart: `${10 + r.i.level * 16}px`, whiteSpace: 'normal' }"><span class="rk-code">{{ r.i.code }}</span> {{ r.i.title }}</td>
            <td v-for="(v, x) in r.years" :key="x" class="pm-money">{{ v ? money(v) : '—' }}</td>
            <td class="pm-money">{{ money(r.i.rolledCost) }}</td>
          </tr>
        </tbody>
        <tfoot><tr style="font-weight: 700"><td>إجمالي الخطة</td><td v-for="(v, x) in costTotals" :key="x" class="pm-money">{{ money(v) }}</td><td class="pm-money">{{ money(plan.summary.totalCost) }}</td></tr></tfoot>
      </table></div>
    </section>

    <!-- الاعتماد والإصدارات -->
    <div v-if="tab === 'versions'" class="rk-grid">
      <PlanWorkflow :plan="plan" :can-manage="canManage" @changed="changed" />
      <section class="card pm-panel">
        <h2>الإصدارات المعتمدة</h2>
        <p v-if="!plan.versions.length" class="pm-empty">لم تُعتمد الخطة بعد</p>
        <ul v-else class="rk-log">
          <li v-for="v in plan.versions" :key="v.id"><b>الإصدار {{ v.version }}</b>
            <span>{{ v.approvedByName }} · {{ fmtDateTime(v.approvedAt) }}<span v-if="v.note" class="pm-muted"> — {{ v.note }}</span></span></li>
        </ul>
      </section>
      <section v-if="plan.versions.length" class="card pm-panel wide">
        <h2>مقارنة الأصل بالمعدل
          <span class="pl-flex">
            <select v-model.number="cmp.from" class="input" style="width: auto"><option v-for="v in plan.versions" :key="v.version" :value="v.version">الإصدار {{ v.version }}</option></select>
            <span>←</span>
            <select v-model.number="cmp.to" class="input" style="width: auto">
              <option v-if="plan.status !== 'approved'" :value="0">المسودة الحالية</option>
              <option v-for="v in plan.versions" :key="v.version" :value="v.version">الإصدار {{ v.version }}</option></select>
          </span></h2>
        <template v-if="cmp.data">
          <div class="pl-flex" style="margin-bottom: 10px">
            <span class="pm-tag">التكلفة: {{ money(cmp.data.totals.fromCost) }} ← {{ money(cmp.data.totals.toCost) }}</span>
            <span class="pm-tag">العناصر: {{ cmp.data.totals.fromItems }} ← {{ cmp.data.totals.toItems }}</span>
            <span class="pm-tag">المؤشرات: {{ cmp.data.totals.fromKpis }} ← {{ cmp.data.totals.toKpis }}</span>
          </div>
          <p v-if="!cmp.data.rows.length" class="pm-empty">لا توجد فروق</p>
          <div v-else class="table-wrap"><table class="table pl-diff">
            <thead><tr><th>النوع</th><th>التغيير</th><th>العنصر</th><th>التفاصيل</th></tr></thead>
            <tbody><tr v-for="(r, x) in cmp.data.rows" :key="x">
              <td>{{ KIND_ROW[r.kind] }}</td><td :class="r.change"><b>{{ CHANGE[r.change] }}</b></td>
              <td :class="r.change" style="white-space: normal"><span class="rk-code">{{ r.code }}</span> {{ r.title }}</td>
              <td><div v-for="c in r.changes" :key="c.field" class="pl-chg"><b>{{ c.label }}</b><span><del>{{ show(c.before) }}</del> ← <ins>{{ show(c.after) }}</ins></span></div></td>
            </tr></tbody>
          </table></div>
        </template>
      </section>
    </div>

    <ItemForm v-if="itemForm && lookups && cfg" :plan="plan" :item="itemForm.item" :parent-id="itemForm.parentId" :level="itemForm.level" :lookups="lookups" :custom-fields="cfg.config.customFields"
      @close="itemForm = null" @saved="savedItem" />
    <KpiForm v-if="kpiForm && cfg" :plan="plan" :kpi="kpiForm.kpi" :item-id="kpiForm.itemId" :items="items" :units="cfg.config.kpiUnits" @close="kpiForm = null" @saved="savedKpi" />
    <KpiReadings v-if="readings" :kpi="readings" :plan="plan" @close="readings = null" @saved="savedReading" />
    <PlanForm v-if="editHeader && cfg && lookups" :kind="plan.kind" :plan="plan" :cfg="cfg" :lookups="lookups" :strategic-plans="strategicPlans"
      @close="editHeader = false" @saved="(v: any) => { editHeader = false; changed(v); }" />
    <div v-if="copy.open" class="modal-backdrop" @click.self="copy.open = false">
      <form class="card modal" @submit.prevent="doCopy">
        <h2>نسخ الخطة لفترة جديدة</h2>
        <p class="pm-muted">ينسخ الهيكل والمؤشرات والتكاليف بلا إنجاز أو قراءات، كمسودة جديدة.</p>
        <label class="field"><span>عنوان الخطة الجديدة</span><input v-model="copy.title" class="input" required /></label>
        <div class="rk-fields">
          <label class="field"><span>سنة البداية</span><input v-model.number="copy.startYear" type="number" class="input" /></label>
          <label class="field"><span>سنة النهاية</span><input v-model.number="copy.endYear" type="number" class="input" /></label>
        </div>
        <div class="modal-actions"><button class="btn btn-primary">نسخ</button><button type="button" class="btn" @click="copy.open = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
