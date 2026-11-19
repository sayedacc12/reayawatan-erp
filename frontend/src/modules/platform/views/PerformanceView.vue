<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { fmtDateTime } from '../labels';
import '../platform.css';

interface VolumeRow { code: string; name: string; rows: number; bytes: number }
interface OrgVolume { id: string; name: string; slug: string; rows: number; modules: Record<string, number> }
interface EndpointPerf { method: string; route: string; count: number; avgMs: number; p95Ms: number; maxMs: number; slow: number }
interface Totals { dbBytes: number; rows: number; organizations: number; users: number; avgMs: number; p95Ms: number; requests: number; slowPercent: number }
interface Snapshot {
  id: string; takenAt: string; kind: 'daily' | 'manual'; label: string | null; isBaseline: boolean; takenBy: string | null; durationMs: number;
  totals: Totals; modules?: VolumeRow[]; tables?: VolumeRow[]; orgs?: OrgVolume[]; endpoints?: EndpointPerf[];
}
interface Overview {
  latest: Snapshot | null; baseline: Snapshot | null; history: Snapshot[];
  live: { endpoints: EndpointPerf[]; totals: Pick<Totals, 'avgMs' | 'p95Ms' | 'requests' | 'slowPercent'> };
  windowDays: number; slowMs: number;
}

const toast = useToast();
const data = ref<Overview | null>(null);
const current = ref<Snapshot | null>(null);
const error = ref('');
const busy = ref(false);
const label = ref('');
const perfTab = ref<'live' | 'snapshot'>('live');

async function load() {
  try {
    data.value = await api<Overview>('/platform/performance');
    current.value = data.value.latest;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

async function takeNow() {
  busy.value = true;
  try {
    await api('/platform/performance/snapshots', { method: 'POST', json: { label: label.value || undefined } });
    label.value = '';
    await load();
    toast.success('تم أخذ القياس وحفظه في السجل');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}

async function pick(id: string) {
  try {
    current.value = await api<Snapshot>(`/platform/performance/snapshots/${id}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    toast.error((e as Error).message);
  }
}

async function makeBaseline(s: Snapshot) {
  if (!confirm(`اعتماد قياس ${fmtDateTime(s.takenAt)} خطَّ أساس جديدًا؟ ستُقارن كل القياسات القادمة به بدل خط الأساس الحالي.`)) return;
  try {
    data.value = await api<Overview>(`/platform/performance/snapshots/${s.id}/baseline`, { method: 'POST' });
    current.value = data.value.latest;
    toast.success('تم اعتماد خط الأساس الجديد');
  } catch (e) {
    toast.error((e as Error).message);
  }
}

// ---- تنسيق الأرقام ----
const num = (n: number) => Math.round(n).toLocaleString('ar-SA-u-nu-latn');
function bytes(n: number) {
  const u = ['بايت', 'ك.ب', 'م.ب', 'ج.ب', 'ت.ب'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
}
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} ث` : `${num(n)} م.ث`);
/** نسبة التغير عن خط الأساس؛ higherIsBad للأزمنة (الارتفاع سيئ) */
function delta(now: number | undefined, base: number | undefined, higherIsBad = false) {
  if (now === undefined || base === undefined || !base) return null;
  const pct = ((now - base) / base) * 100;
  if (Math.abs(pct) < 0.5) return { text: 'بلا تغيير', tone: 'muted' };
  const up = pct > 0;
  return { text: `${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`, tone: higherIsBad ? (up ? 'bad' : 'ok') : 'info' };
}
const speedTone = (n: number) => (n > 1000 ? 'bad' : n > 300 ? 'warn' : 'ok');

const base = computed(() => data.value?.baseline ?? null);
const isBaselineView = computed(() => !!current.value && current.value.id === base.value?.id);

// ---- أسماء الشاشات من المسار ----
const AREA: Record<string, string> = {
  beneficiaries: 'المساعدات الاجتماعية', portal: 'بوابة المستفيدين', fundraising: 'الموارد المالية', projects: 'إدارة المشاريع', 'projects-ops': 'إدارة المشاريع',
  accounting: 'النظام المالي', hr: 'الموارد البشرية', risk: 'المخاطر', governance: 'الحوكمة', volunteers: 'التطوع', quality: 'الجودة', audit: 'المراجعة الداخلية',
  members: 'العضوية', partnerships: 'الشراكات', knowledge: 'أرشيف المعرفة', website: 'الموقع الإلكتروني', comms: 'الاتصالات الإدارية', meetings: 'الاجتماعات',
  reports: 'التقارير', platform: 'إدارة المنصة', 'support-desk': 'الدعم الفني', support: 'الدعم الفني', tasks: 'المهام', auth: 'الدخول', users: 'المستخدمون', roles: 'الأدوار', public: 'الصفحات العامة',
};
function area(route: string) {
  const seg = route.split('/')[2] ?? '';
  if (route.startsWith('/api/accounting/assets')) return 'الأصول الثابتة';
  return AREA[seg] ?? seg;
}
const shortRoute = (r: string) => r.replace(/^\/api/, '');

const endpoints = computed(() => {
  const list = perfTab.value === 'live' ? data.value?.live.endpoints : current.value?.endpoints;
  return (list ?? []).slice(0, 40);
});
const baseEndpoint = computed(() => new Map((base.value?.endpoints ?? []).map((e) => [`${e.method} ${e.route}`, e])));

// ---- الأنظمة والجمعيات مقارنة بخط الأساس ----
const modules = computed(() => {
  const b = new Map((base.value?.modules ?? []).map((m) => [m.code, m]));
  const list = current.value?.modules ?? [];
  const max = Math.max(1, ...list.map((m) => m.rows));
  return list.map((m) => ({ ...m, base: b.get(m.code), width: (m.rows / max) * 100 }));
});
const moduleName = computed(() => Object.fromEntries((current.value?.modules ?? []).map((m) => [m.code, m.name])));
const orgs = computed(() => {
  const b = new Map((base.value?.orgs ?? []).map((o) => [o.id, o]));
  return (current.value?.orgs ?? []).slice(0, 15).map((o) => {
    const top = Object.entries(o.modules).sort((x, y) => y[1] - x[1])[0];
    return { ...o, base: b.get(o.id), top: top ? `${moduleName.value[top[0]] ?? top[0]} (${num(top[1])})` : '—' };
  });
});
const orgCount = computed(() => current.value?.orgs?.length ?? 0);

// ---- منحنى النمو عبر القياسات ----
const chart = computed(() => {
  const h = [...(data.value?.history ?? [])].reverse();
  if (h.length < 2) return null;
  const W = 640, H = 170, P = 8;
  const maxRows = Math.max(...h.map((s) => s.totals.rows), 1);
  const maxMs = Math.max(...h.map((s) => s.totals.avgMs), 1);
  const x = (i: number) => P + (i / (h.length - 1)) * (W - 2 * P);
  const line = (v: (s: Snapshot) => number, max: number) => h.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${(H - P - (v(s) / max) * (H - 2 * P)).toFixed(1)}`).join(' ');
  const bi = h.findIndex((s) => s.isBaseline);
  return { W, H, rows: line((s) => s.totals.rows, maxRows), speed: line((s) => s.totals.avgMs, maxMs), baseX: bi >= 0 ? x(bi) : null, from: h[0].takenAt, to: h[h.length - 1].takenAt };
});
</script>

<template>
  <div>
    <section class="p-hero">
      <div>
        <p class="p-kicker">مراقبة المنصة</p>
        <h1>الأداء وحجم البيانات</h1>
        <p class="p-sub">قياس يومي تلقائي لحجم بيانات كل جمعية وكل نظام، وسرعة استجابة كل شاشة. أول قياس هو خط الأساس الرسمي، وكل قياس بعده يُقارن به.</p>
      </div>
      <div class="take">
        <input v-model="label" class="input" maxlength="200" placeholder="وصف القياس (اختياري): مثل بعد التحديث" />
        <button class="btn btn-gold" :disabled="busy" @click="takeNow">{{ busy ? 'جارٍ القياس...' : 'أخذ قياس الآن' }}</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <template v-if="data">
      <section v-if="!current" class="card p-panel empty-state">
        <h2>لا يوجد قياس بعد</h2>
        <p class="muted">يؤخذ أول قياس تلقائيًا بعد دقائق من تشغيل الخادم، أو اضغط «أخذ قياس الآن». أول قياس يصبح خط الأساس الرسمي للمقارنة.</p>
      </section>

      <template v-else>
        <div class="base-bar">
          <span v-if="isBaselineView" class="tone tone-info">تعرض الآن قياس خط الأساس نفسه</span>
          <span v-else>
            مقارنة قياس <b>{{ fmtDateTime(current.takenAt) }}</b>
            <template v-if="base"> بخط الأساس <b>{{ fmtDateTime(base.takenAt) }}</b></template>
          </span>
          <button v-if="current.id !== data.latest?.id" class="btn btn-sm" @click="current = data.latest">العودة لآخر قياس</button>
        </div>

        <div class="kpis">
          <div class="kpi" style="--a: #14b8a6; --i: 0">
            <span>إجمالي السجلات</span><strong>{{ num(current.totals.rows) }}</strong>
            <small v-if="delta(current.totals.rows, base?.totals.rows)" :class="`d-${delta(current.totals.rows, base?.totals.rows)!.tone}`">{{ delta(current.totals.rows, base?.totals.rows)!.text }} عن خط الأساس</small>
          </div>
          <div class="kpi" style="--a: #6366f1; --i: 1">
            <span>حجم قاعدة البيانات</span><strong>{{ bytes(current.totals.dbBytes) }}</strong>
            <small v-if="delta(current.totals.dbBytes, base?.totals.dbBytes)" :class="`d-${delta(current.totals.dbBytes, base?.totals.dbBytes)!.tone}`">{{ delta(current.totals.dbBytes, base?.totals.dbBytes)!.text }} عن خط الأساس</small>
          </div>
          <div class="kpi" style="--a: #e8b04b; --i: 2">
            <span>الجمعيات / المستخدمون</span><strong>{{ num(current.totals.organizations) }} / {{ num(current.totals.users) }}</strong>
            <small v-if="delta(current.totals.organizations, base?.totals.organizations)">{{ delta(current.totals.organizations, base?.totals.organizations)!.text }} في عدد الجمعيات</small>
          </div>
          <div class="kpi" style="--a: #10b981; --i: 3">
            <span>متوسط زمن الاستجابة ({{ data.windowDays }} أيام)</span><strong>{{ current.totals.requests ? ms(current.totals.avgMs) : '—' }}</strong>
            <small v-if="delta(current.totals.avgMs, base?.totals.avgMs, true)" :class="`d-${delta(current.totals.avgMs, base?.totals.avgMs, true)!.tone}`">{{ delta(current.totals.avgMs, base?.totals.avgMs, true)!.text }} عن خط الأساس</small>
            <small v-else>{{ num(current.totals.requests) }} طلب</small>
          </div>
          <div class="kpi" style="--a: #ef4444; --i: 4">
            <span>طلبات تجاوزت ثانية</span><strong>{{ current.totals.slowPercent }}%</strong>
            <small>95% من الطلبات خلال {{ ms(current.totals.p95Ms) }}</small>
          </div>
        </div>

        <section v-if="chart" class="card p-panel">
          <h2>النمو عبر القياسات</h2>
          <svg :viewBox="`0 0 ${chart.W} ${chart.H}`" class="growth" preserveAspectRatio="none" role="img" aria-label="منحنى عدد السجلات ومتوسط زمن الاستجابة">
            <line v-if="chart.baseX !== null" :x1="chart.baseX" :x2="chart.baseX" y1="0" :y2="chart.H" class="g-base" />
            <path :d="chart.rows" class="g-rows" />
            <path :d="chart.speed" class="g-speed" />
          </svg>
          <ul class="legend-row">
            <li><i class="l-rows" />عدد السجلات</li><li><i class="l-speed" />متوسط زمن الاستجابة</li><li><i class="l-base" />خط الأساس</li>
            <li class="muted">{{ fmtDateTime(chart.from) }} ← {{ fmtDateTime(chart.to) }}</li>
          </ul>
        </section>

        <section class="card p-panel">
          <div class="head-row">
            <h2>سرعة الشاشات (الأبطأ أولًا)</h2>
            <div class="p-tabs mini-tabs">
              <button :class="['p-tab', { on: perfTab === 'live' }]" @click="perfTab = 'live'">آخر 24 ساعة</button>
              <button :class="['p-tab', { on: perfTab === 'snapshot' }]" @click="perfTab = 'snapshot'">فترة القياس ({{ data.windowDays }} أيام)</button>
            </div>
          </div>
          <p class="muted hint">الأخضر أقل من 0.3 ثانية، والأصفر حتى ثانية، والأحمر أبطأ من ثانية ويحتاج تحسينًا. «95%» تعني أن 95% من فتحات الشاشة كانت أسرع من هذا الزمن.</p>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>النظام</th><th>الشاشة (المسار)</th><th>عدد الطلبات</th><th>المتوسط</th><th>95%</th><th>الأقصى</th><th>المتوسط في خط الأساس</th></tr></thead>
              <tbody>
                <tr v-for="e in endpoints" :key="e.method + e.route">
                  <td>{{ area(e.route) }}</td>
                  <td><code dir="ltr">{{ e.method === 'GET' ? '' : e.method + ' ' }}{{ shortRoute(e.route) }}</code></td>
                  <td>{{ num(e.count) }}</td>
                  <td><span :class="['tone', `tone-${speedTone(e.avgMs)}`]">{{ ms(e.avgMs) }}</span></td>
                  <td>{{ ms(e.p95Ms) }}</td>
                  <td>{{ ms(e.maxMs) }}</td>
                  <td>
                    <template v-if="baseEndpoint.get(e.method + ' ' + e.route)">
                      {{ ms(baseEndpoint.get(e.method + ' ' + e.route)!.avgMs) }}
                      <small :class="`d-${delta(e.avgMs, baseEndpoint.get(e.method + ' ' + e.route)!.avgMs, true)?.tone}`">{{ delta(e.avgMs, baseEndpoint.get(e.method + ' ' + e.route)!.avgMs, true)?.text }}</small>
                    </template>
                    <span v-else class="muted">—</span>
                  </td>
                </tr>
                <tr v-if="!endpoints.length"><td colspan="7" class="muted center">لا توجد طلبات مسجلة في هذه الفترة بعد</td></tr>
              </tbody>
            </table>
          </div>
        </section>

          <section class="card p-panel">
            <h2>حجم البيانات لكل نظام</h2>
            <div v-for="m in modules" :key="m.code" class="hbar">
              <span class="hbar-label wide">{{ m.name }}</span>
              <div class="hbar-track"><div class="hbar-fill" :style="{ width: m.width + '%' }" /></div>
              <b>{{ num(m.rows) }}</b>
              <small class="size">{{ bytes(m.bytes) }}</small>
              <small v-if="delta(m.rows, m.base?.rows)" :class="['chg', `d-${delta(m.rows, m.base?.rows)!.tone}`]">{{ delta(m.rows, m.base?.rows)!.text }}</small>
            </div>
          </section>

          <section class="card p-panel">
            <h2>أكبر الجمعيات حجمًا <small class="muted">(من {{ num(orgCount) }})</small></h2>
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>الجمعية</th><th>السجلات</th><th>عن خط الأساس</th><th>أكبر نظام فيها</th></tr></thead>
                <tbody>
                  <tr v-for="o in orgs" :key="o.id">
                    <td><RouterLink :to="`/platform/organizations/${o.id}`">{{ o.name }}</RouterLink></td>
                    <td>{{ num(o.rows) }}</td>
                    <td>
                      <small v-if="!o.base" class="tone tone-info">جديدة</small>
                      <small v-else-if="delta(o.rows, o.base.rows)" :class="`d-${delta(o.rows, o.base.rows)!.tone}`">{{ delta(o.rows, o.base.rows)!.text }}</small>
                    </td>
                    <td class="muted">{{ o.top }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

        <details class="card p-panel">
          <summary><b>أكبر الجداول (للفريق التقني)</b></summary>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>الجدول</th><th>النظام</th><th>السجلات</th><th>الحجم مع الفهارس</th></tr></thead>
              <tbody>
                <tr v-for="t in (current.tables ?? []).slice(0, 30)" :key="t.code"><td><code dir="ltr">{{ t.code }}</code></td><td>{{ t.name }}</td><td>{{ num(t.rows) }}</td><td>{{ bytes(t.bytes) }}</td></tr>
              </tbody>
            </table>
          </div>
        </details>
      </template>

      <section v-if="data.history.length" class="card p-panel">
        <h2>سجل القياسات</h2>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>التاريخ</th><th>النوع</th><th>السجلات</th><th>حجم القاعدة</th><th>متوسط الاستجابة</th><th>أبطأ من ثانية</th><th></th></tr></thead>
            <tbody>
              <tr v-for="s in data.history" :key="s.id" :class="{ sel: current?.id === s.id }">
                <td>
                  {{ fmtDateTime(s.takenAt) }}
                  <span v-if="s.isBaseline" class="tone tone-info">خط الأساس</span>
                  <small v-if="s.label" class="muted d-block">{{ s.label }}</small>
                </td>
                <td>{{ s.kind === 'daily' ? 'تلقائي يومي' : `يدوي${s.takenBy ? ' · ' + s.takenBy : ''}` }}</td>
                <td>{{ num(s.totals.rows) }}</td>
                <td>{{ bytes(s.totals.dbBytes) }}</td>
                <td>{{ s.totals.requests ? ms(s.totals.avgMs) : '—' }}</td>
                <td>{{ s.totals.slowPercent }}%</td>
                <td class="actions">
                  <button class="btn btn-sm" @click="pick(s.id)">عرض ومقارنة</button>
                  <button v-if="!s.isBaseline" class="btn btn-sm" @click="makeBaseline(s)">اعتماده خط أساس</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.take { display: flex; gap: 8px; flex-wrap: wrap; }
.take .input { min-width: 240px; background: rgba(255,255,255,.95); }
.base-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; color: var(--muted); }
.kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; margin-bottom: 16px; }
.kpi { position: relative; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 16px 18px; display: flex; flex-direction: column; gap: 2px;
  box-shadow: var(--shadow); animation: p-rise .5s var(--ease) both; animation-delay: calc(var(--i) * 80ms); }
.kpi::before { content: ''; position: absolute; inset-inline-start: 0; top: 0; bottom: 0; width: 4px; background: var(--a); }
.kpi::after { content: ''; position: absolute; width: 120px; height: 120px; border-radius: 50%; background: var(--a); opacity: .08; top: -40px; left: -40px; }
.kpi span { color: var(--muted); font-size: .86rem; }
.kpi strong { font-size: 1.4rem; }
.kpi small { color: var(--muted); font-size: .8rem; }
.d-ok { color: var(--success) !important; font-weight: 600; }
.d-bad { color: var(--danger) !important; font-weight: 600; }
.d-info { color: #2952cc !important; }
.d-muted { color: var(--muted); }
.growth { width: 100%; height: 170px; display: block; }
.g-rows, .g-speed { fill: none; stroke-width: 2.5; vector-effect: non-scaling-stroke; }
.g-rows { stroke: #14b8a6; }
.g-speed { stroke: #e8b04b; stroke-dasharray: 6 4; }
.g-base { stroke: #6366f1; stroke-width: 1.5; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
.legend-row { list-style: none; display: flex; gap: 16px; flex-wrap: wrap; padding: 0; margin: 8px 0 0; font-size: .85rem; }
.legend-row i { display: inline-block; width: 14px; height: 3px; margin-inline-end: 6px; vertical-align: middle; }
.l-rows { background: #14b8a6; } .l-speed { background: #e8b04b; } .l-base { background: #6366f1; }
.head-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.mini-tabs { margin-bottom: 0; border: 0; }
.hint { font-size: .84rem; margin: 4px 0 10px; }
.hbar { display: grid; grid-template-columns: 190px 1fr 90px 70px 64px; align-items: center; gap: 8px; margin-bottom: 8px; font-size: .9rem; }
.hbar-track { height: 9px; background: var(--surface-2); border-radius: 99px; overflow: hidden; }
.hbar-fill { height: 100%; background: linear-gradient(90deg, #14b8a6, #6366f1); border-radius: 99px; }
.size { color: var(--muted); min-width: 60px; text-align: left; }
.chg { min-width: 56px; }
.center { text-align: center; padding: 24px; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
tr.sel td { background: var(--primary-soft); }
.empty-state { text-align: center; padding: 36px; }
.d-block { display: block; }
details > summary { cursor: pointer; margin-bottom: 10px; }
@media (max-width: 1100px) { .kpis { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 640px) { .kpis { grid-template-columns: 1fr; } .hbar { grid-template-columns: 110px 1fr auto; } .size, .chg { display: none; } .take .input { min-width: 0; flex: 1; } }
</style>
