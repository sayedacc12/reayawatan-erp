<script setup lang="ts">
/**
 * تبويب «التقارير» الموحد لكل الأنظمة.
 * الاستخدام: <ReportsHub module="hr" system="الموارد البشرية" />
 * يقرأ قائمة التقارير وتعريفاتها من الخادم (/api/reports)، ويعرض الفلاتر والمعاينة،
 * ويصدّر إلى PDF وExcel وCSV ويطبع بنفس التصميم.
 */
import { computed, onMounted, reactive, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError } from '../../api';
import { useToast } from '../../stores/toast';
import SearchSelect from '../../shared/SearchSelect.vue';
import {
  downloadReport, fillTemplate, formatCell, isNumeric, printReport, queryString,
  type CatalogItem, type ReportColumn, type ReportDef, type ReportOutput, type Row,
} from './reports';

const props = defineProps<{
  module: string; system: string; intro?: string;
  /** لوحة مؤشرات اختيارية تظهر في تبويب مستقل بجانب التقارير (مثل لوحة الاشتراكات) */
  overview?: Component; overviewLabel?: string;
}>();
const route = useRoute();
const router = useRouter();
const toast = useToast();

const catalog = ref<CatalogItem[]>([]);
const pdfReady = ref(true);
const search = ref('');
const def = ref<ReportDef | null>(null);
const values = reactive<Record<string, string | null>>({});
const out = ref<ReportOutput | null>(null);
const loading = ref(false);
const loadingDef = ref(false);
const error = ref('');
const busy = ref<string | null>(null);
const listOpen = ref(false);

const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
const groups = computed(() => {
  const q = norm(search.value.trim());
  const map = new Map<string, CatalogItem[]>();
  for (const r of catalog.value) {
    if (q && !norm(`${r.title} ${r.description} ${r.category ?? ''}`).includes(q)) continue;
    const k = r.category ?? 'عام';
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return [...map.entries()];
});
const current = computed(() => String(route.query.r ?? ''));
const tab = computed(() => (props.overview && route.query.tab === 'overview' ? 'overview' : 'reports'));
const setTab = (t: 'reports' | 'overview') => router.replace({ query: t === 'overview' ? { tab: 'overview' } : current.value ? { r: current.value } : {} });

onMounted(async () => {
  try {
    const res = await api<{ reports: CatalogItem[]; pdf: boolean }>(`/reports/catalog/${props.module}`);
    catalog.value = res.reports;
    pdfReady.value = res.pdf;
    if (!current.value && res.reports.length && tab.value === 'reports') router.replace({ query: { r: res.reports[0].code } });
    else if (current.value) await open(current.value);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
watch(current, (c, old) => { if (c && c !== old) void open(c); });
watch(tab, (t) => { if (t === 'reports' && !current.value && catalog.value.length) router.replace({ query: { r: catalog.value[0].code } }); });

/** فتح تقرير: تحميل تعريفه، ضبط الفلاتر من الرابط أو القيم الافتراضية، ثم التشغيل */
async function open(code: string) {
  loadingDef.value = true;
  out.value = null;
  error.value = '';
  listOpen.value = false;
  try {
    const d = await api<ReportDef>(`/reports/def/${encodeURIComponent(code)}`);
    def.value = d;
    for (const k of Object.keys(values)) delete values[k];
    for (const f of d.filters) {
      const fromUrl = route.query[`f_${f.key}`];
      values[f.key] = typeof fromUrl === 'string' ? fromUrl || null : f.default;
    }
    if (ready.value) await run();
  } catch (e) {
    def.value = null;
    error.value = (e as Error).message;
  } finally {
    loadingDef.value = false;
  }
}

const ready = computed(() => !!def.value && def.value.filters.every((f) => !f.required || !!values[f.key]));
const missing = computed(() => def.value?.filters.filter((f) => f.required && !values[f.key]).map((f) => f.label) ?? []);
const filterValues = () => Object.fromEntries((def.value?.filters ?? []).map((f) => [f.key, values[f.key] ?? '']));

async function run() {
  if (!def.value || !ready.value) return;
  loading.value = true;
  error.value = '';
  try {
    const fv = filterValues();
    out.value = await api<ReportOutput>(`/reports/run/${encodeURIComponent(def.value.code)}?${queryString(fv)}`);
    const q: Record<string, string> = { r: def.value.code };
    for (const [k, v] of Object.entries(fv)) if (v) q[`f_${k}`] = v;
    router.replace({ query: q });
  } catch (e) {
    out.value = null;
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

function pick(code: string) {
  if (code === current.value) { listOpen.value = false; return; }
  // الفترة المختارة تنتقل مع التقرير الجديد
  const q: Record<string, string> = { r: code };
  for (const k of ['from', 'to']) if (values[k]) q[`f_${k}`] = values[k]!;
  router.push({ query: q });
}

async function exportAs(format: 'pdf' | 'xlsx' | 'csv' | 'print') {
  if (!def.value || !ready.value) return;
  busy.value = format;
  try {
    if (format === 'print') await printReport(def.value.code, filterValues());
    else await downloadReport(def.value.code, format, filterValues());
    if (format !== 'print') toast.success('تم تنزيل الملف');
  } catch (e) {
    if (format === 'pdf' && e instanceof ApiError && e.status === 503) {
      toast.error('ملف PDF غير متاح الآن، ستفتح نافذة الطباعة: اختر «حفظ كملف PDF»');
      await printReport(def.value.code, filterValues()).catch(() => undefined);
    } else toast.error((e as Error).message);
  } finally {
    busy.value = null;
  }
}

const rowLink = (r: Row) => (def.value?.link ? fillTemplate(def.value.link, r) : null);
function openRow(r: Row) {
  const d = def.value;
  if (!d) return;
  if (d.drill) {
    const q: Record<string, string> = { r: d.drill.report };
    for (const [k, tpl] of Object.entries(d.drill.filters)) q[`f_${k}`] = decodeURIComponent(fillTemplate(tpl, r));
    // نحمل الفترة نفسها للتقرير التفصيلي
    for (const k of ['from', 'to']) if (values[k] && !q[`f_${k}`]) q[`f_${k}`] = values[k]!;
    router.push({ query: q });
  } else {
    const link = rowLink(r);
    if (link) router.push(link);
  }
}
const clickable = computed(() => !!def.value?.drill || !!def.value?.link);
const cols = computed<ReportColumn[]>(() => out.value?.columns ?? def.value?.columns ?? []);
/** الأعمدة النصية الطويلة تلتف، وباقي الأعمدة في سطر واحد */
const wrapCols = computed(() => new Set(cols.value.filter((c) => !isNumeric(c.type) && (out.value?.rows ?? []).slice(0, 300)
  .some((r) => String(r[c.key] ?? '').length > 38)).map((c) => c.key)));
const indentKey = computed(() => out.value?.indentColumn ?? cols.value[0]?.key);
const selectOptions = (f: ReportDef['filters'][number]) => (f.options ?? []).map((o) => ({ id: o.value, label: o.label }));
</script>

<template>
  <div class="rh">
    <section class="rh-hero">
      <div class="rh-glow" aria-hidden="true" />
      <div class="rh-hero-text">
        <p class="rh-kicker">{{ system }}</p>
        <h1>التقارير</h1>
        <p class="rh-sub">{{ intro ?? 'اختر التقرير وحدد الفلاتر، ثم صدّره إلى PDF أو Excel أو اطبعه مباشرة.' }}</p>
      </div>
      <div class="rh-count"><b>{{ catalog.length.toLocaleString('ar-SA') }}</b><span>تقريرًا متاحًا</span></div>
    </section>

    <div v-if="overview" class="rh-tabs" role="tablist">
      <button type="button" role="tab" :class="{ on: tab === 'reports' }" @click="setTab('reports')">التقارير القابلة للتصدير</button>
      <button type="button" role="tab" :class="{ on: tab === 'overview' }" @click="setTab('overview')">{{ overviewLabel ?? 'لوحة المؤشرات' }}</button>
    </div>
    <component :is="overview" v-if="overview && tab === 'overview'" />

    <div v-else class="rh-layout">
      <aside :class="['rh-list', { open: listOpen }]">
        <button class="rh-list-toggle" type="button" @click="listOpen = !listOpen">
          <span>{{ def?.title ?? 'اختر تقريرًا' }}</span><span class="chev">▾</span>
        </button>
        <div class="rh-list-body">
          <input v-model="search" class="input rh-search" placeholder="ابحث في التقارير..." />
          <div v-for="([cat, items], gi) in groups" :key="cat" class="rh-group">
            <h3>{{ cat }}</h3>
            <button v-for="(r, i) in items" :key="r.code" type="button" :class="['rh-item', { on: r.code === current }]"
              :style="{ '--d': `${(gi * 3 + i) * 35}ms` }" @click="pick(r.code)">
              <b>{{ r.title }}</b><small>{{ r.description }}</small>
            </button>
          </div>
          <p v-if="!groups.length && catalog.length" class="muted rh-none">لا يوجد تقرير بهذا الاسم</p>
          <p v-if="!catalog.length && !error" class="muted rh-none">لا توجد تقارير متاحة لصلاحياتك</p>
        </div>
      </aside>

      <section class="rh-main">
        <div v-if="loadingDef" class="rh-skel big" />
        <template v-else-if="def">
          <header class="rh-head">
            <div>
              <h2>{{ def.title }}</h2>
              <p class="muted">{{ def.description }}</p>
            </div>
            <div class="rh-exports">
              <button class="btn rh-pdf" :disabled="!ready || !!busy" :title="pdfReady ? '' : 'سيفتح نافذة الطباعة لحفظ PDF'" @click="exportAs('pdf')">
                <span class="spin" v-if="busy === 'pdf'" />PDF
              </button>
              <button class="btn" :disabled="!ready || !!busy" @click="exportAs('xlsx')"><span class="spin" v-if="busy === 'xlsx'" />Excel</button>
              <button class="btn" :disabled="!ready || !!busy" @click="exportAs('csv')"><span class="spin" v-if="busy === 'csv'" />CSV</button>
              <button class="btn" :disabled="!ready || !!busy" @click="exportAs('print')"><span class="spin" v-if="busy === 'print'" />طباعة</button>
            </div>
          </header>

          <form v-if="def.filters.length" class="rh-filters" @submit.prevent="run">
            <label v-for="f in def.filters" :key="f.key" :class="['rh-f', `t-${f.type}`]">
              <span>{{ f.label }}<i v-if="f.required">*</i></span>
              <input v-if="f.type === 'date'" v-model="values[f.key]" type="date" class="input" />
              <input v-else-if="f.type === 'month'" v-model="values[f.key]" type="month" class="input" />
              <input v-else-if="f.type === 'text'" v-model="values[f.key]" type="text" class="input" :placeholder="f.placeholder ?? ''" />
              <SearchSelect v-else-if="(f.options?.length ?? 0) > 12" :model-value="values[f.key] ?? null" :options="selectOptions(f)"
                :placeholder="f.placeholder ?? 'اختر...'" @update:model-value="values[f.key] = $event" />
              <select v-else v-model="values[f.key]" class="input">
                <option v-if="!f.required" :value="null">{{ f.placeholder ?? 'الكل' }}</option>
                <option v-else :value="null" disabled>اختر...</option>
                <option v-for="o in f.options ?? []" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>
            <button class="btn btn-primary rh-run" type="submit" :disabled="!ready || loading">{{ loading ? 'جارٍ التحميل...' : 'عرض التقرير' }}</button>
          </form>
          <p v-if="missing.length" class="rh-hint">اختر {{ missing.join(' و') }} لعرض التقرير</p>

          <div v-if="error" class="alert alert-error">{{ error }}</div>

          <div v-if="loading" class="rh-skel" />
          <template v-else-if="out">
            <p v-if="out.subtitle" class="rh-subtitle">{{ out.subtitle }}</p>
            <div v-if="out.summary.length" class="rh-kpis">
              <div v-for="(s, i) in out.summary" :key="s.label" class="rh-kpi" :style="{ '--d': `${i * 50}ms` }">
                <span>{{ s.label }}</span><b>{{ formatCell(s.value, s.type) }}</b>
              </div>
            </div>
            <div class="rh-meta">
              <span v-for="a in out.appliedFilters" :key="a.label" class="rh-chip"><i>{{ a.label }}:</i> {{ a.value }}</span>
              <span class="rh-chip"><i>عدد السطور:</i> {{ out.rows.length.toLocaleString('ar-SA') }}</span>
            </div>
            <div v-if="out.rows.length" class="rh-table-wrap">
              <table class="rh-table">
                <thead><tr><th v-for="c in cols" :key="c.key" :class="{ n: isNumeric(c.type) }">{{ c.label }}</th></tr></thead>
                <tbody>
                  <tr v-for="(r, i) in out.rows" :key="i" :class="[r._style ? `s-${r._style}` : '', { link: clickable && (!!def.drill || !!rowLink(r)) }]" @click="clickable && openRow(r)">
                    <td v-for="c in cols" :key="c.key" :class="{ n: isNumeric(c.type), neg: isNumeric(c.type) && Number(r[c.key]) < 0, wrap: wrapCols.has(c.key) }"
                      :style="c.key === indentKey && r._level ? { paddingInlineStart: `${10 + (r._level - 1) * 14}px` } : undefined">{{ formatCell(r[c.key], c.type) }}</td>
                  </tr>
                </tbody>
                <tfoot v-if="out.totals">
                  <tr><td v-for="(c, i) in cols" :key="c.key" :class="{ n: isNumeric(c.type) }">{{ out.totals[c.key] !== undefined ? formatCell(out.totals[c.key], c.type) : i === 0 ? 'الإجمالي' : '' }}</td></tr>
                </tfoot>
              </table>
            </div>
            <div v-else class="rh-empty">
              <span class="ic">∅</span>
              <p>لا توجد بيانات تطابق الفلاتر المختارة</p>
            </div>
            <ul v-if="out.notes.length" class="rh-notes"><li v-for="n in out.notes" :key="n">{{ n }}</li></ul>
            <p v-if="clickable && out.rows.length" class="rh-tip muted">اضغط على أي سطر لفتح {{ def.drill ? 'التفاصيل' : 'السجل' }}</p>
          </template>
        </template>
        <div v-else-if="error" class="alert alert-error">{{ error }}</div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.rh-hero { position: relative; overflow: hidden; border-radius: 20px; padding: 24px 28px; margin-bottom: 18px; color: #fff; background: var(--grad-dark);
  display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; box-shadow: 0 18px 40px rgba(6, 20, 26, .18); }
.rh-glow { position: absolute; inset: -40%; pointer-events: none;
  background: radial-gradient(circle at 20% 30%, rgba(20, 184, 166, .35), transparent 40%), radial-gradient(circle at 85% 70%, rgba(232, 176, 75, .28), transparent 38%);
  animation: rh-drift 14s ease-in-out infinite alternate; }
.rh-hero-text { position: relative; animation: rh-rise .5s var(--ease) both; }
.rh-hero h1 { font-size: 1.55rem; margin: 0; }
.rh-kicker { margin: 0 0 4px; color: #5eead4; font-weight: 600; font-size: .86rem; }
.rh-sub { margin: 6px 0 0; opacity: .8; font-size: .9rem; max-width: 620px; }
.rh-count { position: relative; text-align: center; padding: 10px 18px; border-radius: 16px; background: rgba(255, 255, 255, .08); border: 1px solid rgba(255, 255, 255, .14);
  backdrop-filter: blur(6px); animation: rh-rise .6s .1s var(--ease) both; }
.rh-count b { display: block; font-size: 1.6rem; color: var(--gold); line-height: 1.2; }
.rh-count span { font-size: .78rem; opacity: .8; }

.rh-tabs { display: inline-flex; gap: 4px; padding: 4px; margin-bottom: 16px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); }
.rh-tabs button { border: 0; background: transparent; font: inherit; padding: 8px 16px; border-radius: 10px; cursor: pointer; color: var(--muted); font-weight: 500; transition: all .2s var(--ease); }
.rh-tabs button.on { background: var(--primary); color: #fff; box-shadow: 0 6px 14px rgba(15, 118, 110, .25); }
.rh-layout { display: grid; grid-template-columns: 290px minmax(0, 1fr); gap: 16px; align-items: start; }
.rh-list { position: sticky; top: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 12px; box-shadow: var(--shadow);
  max-height: calc(100vh - 24px); overflow: auto; }
.rh-list-toggle { display: none; }
.rh-search { width: 100%; margin-bottom: 8px; }
.rh-group h3 { font-size: .76rem; color: var(--muted); font-weight: 600; margin: 12px 6px 6px; letter-spacing: .2px; }
.rh-item { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: right; padding: 9px 12px; margin-bottom: 4px; border-radius: 12px; border: 1px solid transparent;
  background: transparent; cursor: pointer; font: inherit; color: inherit; transition: background .2s, border-color .2s, transform .2s var(--ease);
  animation: rh-rise .35s var(--d) var(--ease) both; position: relative; }
.rh-item b { font-weight: 600; font-size: .92rem; }
.rh-item small { color: var(--muted); font-size: .76rem; line-height: 1.5; }
.rh-item:hover { background: var(--surface-2); transform: translateX(-2px); }
.rh-item.on { background: linear-gradient(160deg, #ecfdf9, #fffbeb); border-color: #99f6e4; box-shadow: 0 8px 20px rgba(15, 118, 110, .12); }
.rh-item.on::before { content: ''; position: absolute; inset-inline-start: 0; top: 10px; bottom: 10px; width: 3px; border-radius: 3px; background: var(--gold); }
.rh-none { padding: 10px; font-size: .86rem; }

.rh-main { min-width: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 18px 20px; box-shadow: var(--shadow); min-height: 320px; }
.rh-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
.rh-head h2 { font-size: 1.2rem; margin: 0; }
.rh-head p { margin: 4px 0 0; font-size: .88rem; }
.rh-exports { display: flex; gap: 6px; flex-wrap: wrap; }
.rh-exports .btn { min-width: 64px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.rh-pdf { background: linear-gradient(135deg, #e8b04b, #d4932a); color: #fff; border-color: #d4932a; font-weight: 600; box-shadow: 0 6px 16px rgba(232, 176, 75, .35); }
.rh-pdf:hover:not(:disabled) { filter: brightness(1.05); transform: translateY(-1px); }
.spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid currentColor; border-top-color: transparent; animation: rh-spin .7s linear infinite; }

.rh-filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; padding: 12px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); }
.rh-f { display: flex; flex-direction: column; gap: 4px; min-width: 150px; flex: 1 1 160px; max-width: 280px; }
.rh-f.t-select { flex-basis: 200px; }
.rh-f span { font-size: .8rem; color: var(--muted); font-weight: 500; }
.rh-f i { color: var(--danger); font-style: normal; margin-inline-start: 2px; }
.rh-run { min-height: 40px; }
.rh-hint { color: #b45309; font-size: .86rem; margin: 8px 2px 0; }

.rh-subtitle { margin: 14px 2px 0; font-weight: 600; color: var(--primary); }
.rh-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 14px; }
.rh-kpi { padding: 12px 14px; border-radius: 14px; border: 1px solid var(--border); background: linear-gradient(170deg, #fff, var(--surface-2)); border-top: 3px solid var(--gold);
  animation: rh-rise .4s var(--d) var(--ease) both; }
.rh-kpi span { display: block; color: var(--muted); font-size: .8rem; }
.rh-kpi b { font-size: 1.15rem; font-variant-numeric: tabular-nums; }
.rh-meta { display: flex; flex-wrap: wrap; gap: 6px; margin: 14px 0 10px; }
.rh-chip { background: var(--primary-soft); color: var(--primary); border-radius: 999px; padding: 3px 12px; font-size: .78rem; }
.rh-chip i { font-style: normal; opacity: .75; }

.rh-table-wrap { overflow: auto; max-height: 68vh; border: 1px solid var(--border); border-radius: 12px; animation: rh-rise .35s var(--ease) both; }
.rh-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: .88rem; }
.rh-table th { position: sticky; top: 0; z-index: 1; background: #0f766e; color: #fff; font-weight: 600; padding: 9px 10px; text-align: right; white-space: nowrap; }
.rh-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
.rh-table td.wrap { white-space: normal; min-width: 220px; max-width: 420px; }
.rh-table tbody tr:nth-child(even) td { background: #fafcfc; }
.rh-table tbody tr.link { cursor: pointer; }
.rh-table tbody tr.link:hover td { background: #ecfdf9; }
.rh-table .n { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
.rh-table th.n { text-align: center; }
.rh-table td.neg { color: var(--danger); }
.rh-table tr.s-strong td { font-weight: 700; background: #eef6f5; }
.rh-table tr.s-group td { font-weight: 700; background: #fdf6e7; color: #8a5a00; }
.rh-table tr.s-muted td { color: var(--muted); }
.rh-table tfoot td { position: sticky; bottom: 0; font-weight: 700; background: #fdf3dc; border-top: 2px solid var(--gold); }
.rh-empty { text-align: center; padding: 40px 10px; color: var(--muted); border: 1px dashed var(--border); border-radius: 14px; }
.rh-empty .ic { font-size: 2rem; opacity: .4; }
.rh-notes { color: var(--muted); font-size: .84rem; margin: 10px 0 0; }
.rh-tip { font-size: .78rem; margin: 8px 2px 0; }

.rh-skel { height: 220px; margin-top: 14px; border-radius: 14px; background: linear-gradient(90deg, var(--surface-2), #eef2f4, var(--surface-2)); background-size: 200% 100%;
  animation: rh-shimmer 1.2s linear infinite; }
.rh-skel.big { height: 320px; margin: 0; }

@keyframes rh-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes rh-drift { from { transform: translate(0, 0) rotate(0deg); } to { transform: translate(4%, -3%) rotate(6deg); } }
@keyframes rh-shimmer { to { background-position: -200% 0; } }
@keyframes rh-spin { to { transform: rotate(360deg); } }

@media (max-width: 960px) {
  .rh-layout { grid-template-columns: minmax(0, 1fr); }
  .rh-list { position: static; max-height: none; padding: 0; overflow: hidden; }
  .rh-list-toggle { display: flex; width: 100%; justify-content: space-between; align-items: center; padding: 12px 14px; border: 0; background: transparent; font: inherit;
    font-weight: 600; cursor: pointer; color: inherit; }
  .rh-list-body { display: none; padding: 0 12px 12px; }
  .rh-list.open .rh-list-body { display: block; }
  .rh-list.open .chev { transform: rotate(180deg); }
  .chev { transition: transform .2s; }
  .rh-hero { padding: 18px; flex-direction: column; align-items: flex-start; }
  .rh-main { padding: 14px; }
  .rh-f { max-width: none; flex-basis: 100%; }
  .rh-exports { width: 100%; }
  .rh-exports .btn { flex: 1; }
}
@media (prefers-reduced-motion: reduce) { .rh-glow, .rh-item, .rh-kpi, .rh-hero-text, .rh-count, .rh-table-wrap { animation: none; } }
</style>
