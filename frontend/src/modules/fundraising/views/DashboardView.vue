<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import CountUp from '../../beneficiaries/components/CountUp.vue';
import { color, fmtDate, fmtNo, label, money, sar, today } from '../labels';
import '../fr.css';

interface Kpis { total: number; count: number; average: number; donors: number; zakat: number; cash: number; inKind: number; pledge: number; newDonors: number }
interface Dash {
  range: { from: string; to: string }; compareRange: { from: string; to: string }; bucket: 'day' | 'month';
  current: Kpis; previous: Kpis;
  series: { period: string; amount: number; count: number; zakat: number }[];
  byTarget: { key: string; amount: number; count: number }[];
  byKind: { key: string; amount: number; count: number }[];
  byLevel: { name: string; color: string | null; amount: number; donors: number }[];
  topDonors: { id: string; name: string; donorNo: number; amount: number; count: number }[];
  byManager: { name: string; amount: number; count: number }[];
  recent: { id: string; opportunityNo: number; kind: string; status: string; date: string; totalAmount: number; isZakat: boolean; donorName: string }[];
  batches: { amount: number; reserved: number; spent: number; transferred: number; active: number };
  pipeline: { inProgress: number; returned: number; pendingAmount: number; pledgeOutstanding: number };
}

const session = useSession();
const d = ref<Dash | null>(null);
const error = ref('');
const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
const now = new Date();
const presets = [
  { key: 'month', label: 'هذا الشهر', from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: today() },
  { key: 'quarter', label: 'هذا الربع', from: iso(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)), to: today() },
  { key: 'year', label: 'هذا العام', from: `${now.getFullYear()}-01-01`, to: today() },
  { key: 'last30', label: 'آخر 30 يومًا', from: iso(new Date(Date.now() - 29 * 86400000)), to: today() },
  { key: 'lastYear', label: 'العام الماضي', from: `${now.getFullYear() - 1}-01-01`, to: `${now.getFullYear() - 1}-12-31` },
];
const f = reactive({ preset: 'year', from: presets[2].from, to: presets[2].to, compare: 'previous' as 'previous' | 'last_year' });
function pick(p: (typeof presets)[number]) {
  f.preset = p.key;
  f.from = p.from;
  f.to = p.to;
}
async function load() {
  try {
    d.value = await api<Dash>(`/fundraising/dashboard?from=${f.from}&to=${f.to}&compare=${f.compare}`);
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(() => [f.from, f.to, f.compare], load);

const delta = (cur: number, prev: number) => {
  if (!prev) return cur ? { cls: 'up', text: 'جديد' } : { cls: 'flat', text: '—' };
  const p = ((cur - prev) / prev) * 100;
  return { cls: p > 0.5 ? 'up' : p < -0.5 ? 'down' : 'flat', text: `${p > 0 ? '▲' : p < 0 ? '▼' : ''} ${Math.abs(p).toLocaleString('ar-SA', { maximumFractionDigits: 1 })}%` };
};
const compareLabel = computed(() => (f.compare === 'last_year' ? 'مقارنة بنفس الفترة من العام الماضي' : 'مقارنة بالفترة السابقة'));

const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const chart = computed(() => {
  const s = d.value?.series ?? [];
  const W = 640, H = 220, P = 26;
  const max = Math.max(1, ...s.map((x) => x.amount));
  const step = s.length > 1 ? (W - P * 2) / (s.length - 1) : 0;
  const pts = s.map((x, i) => ({ ...x, x: s.length > 1 ? P + i * step : W / 2, y: H - P - (x.amount / max) * (H - P * 2),
    name: d.value!.bucket === 'month' ? months[Number(x.period.slice(5, 7)) - 1] : `${Number(x.period.slice(8))}/${Number(x.period.slice(5, 7))}` }));
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  const area = pts.length ? `${line} L${pts.at(-1)!.x},${H - P} L${pts[0].x},${H - P} Z` : '';
  return { W, H, P, pts, line, area };
});

const C = 2 * Math.PI * 52;
const donut = computed(() => {
  const items = d.value?.byTarget ?? [];
  const total = items.reduce((s, x) => s + x.amount, 0);
  let off = 0;
  return items.map((x) => {
    const len = total ? (x.amount / total) * C : 0;
    const seg = { ...x, dash: `${len} ${C - len}`, offset: -off, pct: total ? (x.amount / total) * 100 : 0 };
    off += len;
    return seg;
  });
});
const donutTotal = computed(() => (d.value?.byTarget ?? []).reduce((s, x) => s + x.amount, 0));
const topMax = computed(() => Math.max(1, ...(d.value?.topDonors ?? []).map((x) => x.amount)));
const levelMax = computed(() => Math.max(1, ...(d.value?.byLevel ?? []).map((x) => x.amount)));
const util = computed(() => {
  const b = d.value?.batches;
  if (!b || !b.amount) return [];
  const net = b.amount - b.reserved - b.spent - b.transferred;
  return [
    { label: 'مخصوم', v: b.spent, c: '#0f766e' }, { label: 'محجوز', v: b.reserved, c: '#f59e0b' },
    { label: 'مناقلات', v: b.transferred, c: '#8b5cf6' }, { label: 'صافي متاح', v: net, c: '#34d399' },
  ].map((x) => ({ ...x, w: (x.v / b.amount) * 100 }));
});
</script>

<template>
  <div>
    <section class="fr-hero">
      <div>
        <p class="kicker">الموارد المالية</p>
        <h1>نبض التبرعات لحظة بلحظة</h1>
        <p class="sub">تحليل الفرص المعتمدة حسب الفترة، مع المقارنة وتوزيع التبرعات على البرامج والأوقاف والزكاة.</p>
      </div>
      <div class="fr-hero-actions">
        <RouterLink v-if="session.can('fundraising.opportunities.create')" to="/fundraising/opportunities/new" class="btn btn-gold">+ فرصة تبرع</RouterLink>
        <RouterLink to="/fundraising/reports" class="btn btn-ghost-light">التقارير</RouterLink>
      </div>
    </section>

    <div class="time-bar">
      <div class="fr-pills">
        <button v-for="p in presets" :key="p.key" :class="['fr-pill', { on: f.preset === p.key }]" @click="pick(p)">{{ p.label }}</button>
        <button :class="['fr-pill', { on: f.preset === 'custom' }]" @click="f.preset = 'custom'">فترة مخصصة</button>
      </div>
      <div v-if="f.preset === 'custom'" class="custom"><input v-model="f.from" type="date" class="input" /><span>إلى</span><input v-model="f.to" type="date" class="input" /></div>
      <select v-model="f.compare" class="input cmp"><option value="previous">قارن بالفترة السابقة</option><option value="last_year">قارن بنفس الفترة من العام الماضي</option></select>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <template v-if="d">
      <p class="muted range">من {{ fmtDate(d.range.from) }} إلى {{ fmtDate(d.range.to) }} · {{ compareLabel }} ({{ fmtDate(d.compareRange.from) }} – {{ fmtDate(d.compareRange.to) }})</p>
      <div class="fr-kpis">
        <div class="fr-kpi" style="--a: #e8b04b; --i: 0"><span class="k-label">إجمالي التبرعات المعتمدة</span><strong><CountUp :value="d.current.total" /> <small class="cur">ر.س</small></strong>
          <span class="k-foot"><span :class="['fr-delta', delta(d.current.total, d.previous.total).cls]">{{ delta(d.current.total, d.previous.total).text }}</span> السابق {{ sar(d.previous.total) }}</span></div>
        <div class="fr-kpi" style="--a: #14b8a6; --i: 1"><span class="k-label">عدد الفرص</span><strong><CountUp :value="d.current.count" /></strong>
          <span class="k-foot"><span :class="['fr-delta', delta(d.current.count, d.previous.count).cls]">{{ delta(d.current.count, d.previous.count).text }}</span> متوسط الفرصة {{ sar(d.current.average) }}</span></div>
        <div class="fr-kpi" style="--a: #6366f1; --i: 2"><span class="k-label">الداعمون المساهمون</span><strong><CountUp :value="d.current.donors" /></strong>
          <span class="k-foot"><span :class="['fr-delta', delta(d.current.donors, d.previous.donors).cls]">{{ delta(d.current.donors, d.previous.donors).text }}</span> {{ d.current.newDonors }} داعم جديد</span></div>
        <div class="fr-kpi" style="--a: #d99a2b; --i: 3"><span class="k-label">الزكاة</span><strong><CountUp :value="d.current.zakat" /> <small class="cur">ر.س</small></strong>
          <span class="k-foot"><span :class="['fr-delta', delta(d.current.zakat, d.previous.zakat).cls]">{{ delta(d.current.zakat, d.previous.zakat).text }}</span> من إجمالي الفترة</span></div>
        <div class="fr-kpi" style="--a: #8b5cf6; --i: 4"><span class="k-label">وعود لم تُسدَّد</span><strong><CountUp :value="d.pipeline.pledgeOutstanding" /> <small class="cur">ر.س</small></strong>
          <span class="k-foot">{{ d.pipeline.inProgress }} فرصة قيد الاعتماد · {{ d.pipeline.returned }} مُعادة</span></div>
      </div>

      <div class="fr-grid">
        <section class="fr-panel fr-span2">
          <h2>تطور التبرعات <span class="muted">· {{ d.bucket === 'day' ? 'يومي' : 'شهري' }}</span></h2>
          <p v-if="!chart.pts.length" class="fr-empty">لا توجد تبرعات معتمدة في هذه الفترة</p>
          <svg v-else :viewBox="`0 0 ${chart.W} ${chart.H}`" class="area-chart">
            <defs>
              <linearGradient id="frArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2dd4bf" stop-opacity=".45" /><stop offset="100%" stop-color="#2dd4bf" stop-opacity="0" /></linearGradient>
              <filter id="frGlow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>
            <line v-for="g in 4" :key="g" :x1="chart.P" :x2="chart.W - chart.P" :y1="chart.P + ((chart.H - chart.P * 2) / 4) * (g - 1)" :y2="chart.P + ((chart.H - chart.P * 2) / 4) * (g - 1)" class="grid-l" />
            <path :d="chart.area" fill="url(#frArea)" class="area" />
            <path :d="chart.line" class="line" filter="url(#frGlow)" />
            <g v-for="(p, i) in chart.pts" :key="p.period" class="pt" :style="{ animationDelay: i * 40 + 'ms' }">
              <circle :cx="p.x" :cy="p.y" r="4.5" />
              <title>{{ p.period }}: {{ sar(p.amount) }} · {{ p.count }} فرصة</title>
              <text v-if="chart.pts.length <= 14 || i % Math.ceil(chart.pts.length / 12) === 0" :x="p.x" :y="chart.H - 6" class="xl">{{ p.name }}</text>
            </g>
          </svg>
        </section>

        <section class="fr-panel">
          <h2>توجيه التبرعات</h2>
          <div class="ring-wrap">
            <svg viewBox="0 0 120 120" class="ring">
              <circle cx="60" cy="60" r="52" class="ring-bg" />
              <circle v-for="s in donut" :key="s.key" cx="60" cy="60" r="52" class="ring-seg" :stroke="color('target', s.key)" :stroke-dasharray="s.dash" :stroke-dashoffset="s.offset" />
            </svg>
            <div class="ring-center"><strong>{{ money(donutTotal, 0) }}</strong><span>ر.س</span></div>
          </div>
          <ul class="legend">
            <li v-for="s in donut" :key="s.key"><i :style="{ background: color('target', s.key) }" />{{ label('target', s.key) }}<small class="muted">{{ s.pct.toFixed(0) }}%</small><b>{{ sar(s.amount) }}</b></li>
          </ul>
          <p v-if="!donut.length" class="fr-empty">—</p>
        </section>

        <section class="fr-panel">
          <h2>كبار الداعمين</h2>
          <RouterLink v-for="(t, i) in d.topDonors" :key="t.id" :to="`/fundraising/donors/${t.id}`" class="top">
            <span class="rank" :class="{ gold: i === 0 }">{{ i + 1 }}</span>
            <span class="grow"><b>{{ t.name }}</b><span class="hb"><i :style="{ width: (t.amount / topMax) * 100 + '%' }" /></span></span>
            <span class="fr-amount">{{ sar(t.amount) }}</span>
          </RouterLink>
          <p v-if="!d.topDonors.length" class="fr-empty">—</p>
        </section>

        <section class="fr-panel">
          <h2>حسب نوع الفرصة</h2>
          <div v-for="k in d.byKind" :key="k.key" class="kind-row">
            <span class="fr-badge" :style="{ '--c': color('kind', k.key) }">{{ label('kind', k.key) }}</span>
            <span class="grow" /><small class="muted">{{ k.count }} فرصة</small><b>{{ sar(k.amount) }}</b>
          </div>
          <p v-if="!d.byKind.length" class="fr-empty">—</p>
          <h2 class="mt">حسب مستوى الداعم</h2>
          <div v-for="l in d.byLevel" :key="l.name" class="hbar">
            <span>{{ l.name }}</span><div class="track"><i :style="{ width: (l.amount / levelMax) * 100 + '%', background: l.color ?? '#94a3b8' }" /></div><b>{{ money(l.amount, 0) }}</b>
          </div>
        </section>

        <section class="fr-panel">
          <h2>استخدام الدفعات <span class="muted">· {{ d.batches.active }} دفعة متاحة</span></h2>
          <div class="fr-progress util"><i v-for="u in util" :key="u.label" :style="{ width: u.w + '%', background: u.c }" /></div>
          <ul class="legend">
            <li v-for="u in util" :key="u.label"><i :style="{ background: u.c }" />{{ u.label }}<b>{{ sar(u.v) }}</b></li>
          </ul>
          <p v-if="!util.length" class="fr-empty">لا توجد دفعات معتمدة بعد</p>
          <h2 class="mt">مدراء الدعم</h2>
          <div v-for="m in d.byManager" :key="m.name" class="kind-row"><span>{{ m.name }}</span><span class="grow" /><small class="muted">{{ m.count }}</small><b>{{ sar(m.amount) }}</b></div>
        </section>

        <section class="fr-panel fr-span2">
          <h2>أحدث الفرص <RouterLink to="/fundraising/opportunities" class="more">عرض الكل ←</RouterLink></h2>
          <RouterLink v-for="o in d.recent" :key="o.id" :to="`/fundraising/opportunities/${o.id}`" class="recent">
            <span class="fr-no">{{ fmtNo('FR', o.opportunityNo) }}</span>
            <span class="grow"><b>{{ o.donorName }}</b><small class="muted"> · {{ label('kind', o.kind) }} · {{ fmtDate(o.date) }}</small> <span v-if="o.isZakat" class="fr-zakat">زكاة</span></span>
            <span class="fr-badge" :style="{ '--c': color('status', o.status) }">{{ label('status', o.status) }}</span>
            <span class="fr-amount">{{ sar(o.totalAmount) }}</span>
          </RouterLink>
          <p v-if="!d.recent.length" class="fr-empty">لا توجد فرص بعد. ابدأ بتسجيل أول فرصة تبرع.</p>
        </section>
      </div>
    </template>
    <div v-else-if="!error" class="skel"><div v-for="i in 5" :key="i" class="fr-skeleton" /></div>
  </div>
</template>

<style scoped>
.time-bar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
.custom { display: flex; gap: 6px; align-items: center; }
.custom .input { width: auto; }
.cmp { width: auto; margin-inline-start: auto; }
.range { font-size: .82rem; margin: 0 0 12px; }
.cur { font-size: .8rem; color: var(--muted); font-weight: 500; }
.area-chart { width: 100%; height: auto; overflow: visible; }
.grid-l { stroke: var(--border); stroke-dasharray: 3 5; }
.area { animation: fr-rise .9s var(--ease) both; }
.line { fill: none; stroke: #0d9488; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 2000; stroke-dashoffset: 2000; animation: dash 1.6s var(--ease) forwards; }
@keyframes dash { to { stroke-dashoffset: 0; } }
.pt { animation: fr-rise .4s var(--ease) both; }
.pt circle { fill: #fff; stroke: #e8b04b; stroke-width: 2.5; transition: r .2s; }
.pt:hover circle { r: 7; }
.xl { font-size: 10px; fill: var(--muted); text-anchor: middle; }
.ring-wrap { position: relative; width: 170px; margin: 0 auto 10px; }
.ring { width: 100%; transform: rotate(-90deg); }
.ring-bg { fill: none; stroke: var(--surface-2); stroke-width: 14; }
.ring-seg { fill: none; stroke-width: 14; animation: draw 1s var(--ease) both; filter: drop-shadow(0 0 4px rgba(0,0,0,.08)); }
@keyframes draw { from { stroke-dasharray: 0 400; } }
.ring-center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; }
.ring-center strong { font-size: 1.05rem; }
.ring-center span { color: var(--muted); font-size: .76rem; }
.legend { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; font-size: .86rem; }
.legend li { display: flex; align-items: center; gap: 6px; }
.legend i { width: 10px; height: 10px; border-radius: 3px; }
.legend b { margin-inline-start: auto; }
.top { display: flex; align-items: center; gap: 10px; padding: 7px 4px; color: var(--text); border-radius: 10px; }
.top:hover { background: var(--surface-2); }
.rank { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; font-weight: 700; font-size: .8rem; background: var(--surface-2); color: var(--muted); }
.rank.gold { background: linear-gradient(135deg, #f5c66b, #d99a2b); color: #3b2a06; box-shadow: 0 0 12px rgba(232,176,75,.6); }
.grow { flex: 1; min-width: 0; }
.hb { display: block; height: 5px; border-radius: 5px; background: var(--surface-2); margin-top: 4px; overflow: hidden; }
.hb i { display: block; height: 100%; background: linear-gradient(90deg, #2dd4bf, #0f766e); border-radius: 5px; animation: fr-fill .9s var(--ease) both; transform-origin: right; }
.kind-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: .9rem; }
.mt { margin-top: 18px !important; }
.hbar { display: grid; grid-template-columns: 80px 1fr 70px; gap: 8px; align-items: center; font-size: .85rem; margin-bottom: 8px; }
.hbar .track { height: 8px; border-radius: 8px; background: var(--surface-2); overflow: hidden; }
.hbar .track i { display: block; height: 100%; border-radius: 8px; animation: fr-fill .9s var(--ease) both; transform-origin: right; }
.hbar b { text-align: left; }
.util { height: 14px; margin-bottom: 12px; }
.recent { display: flex; align-items: center; gap: 10px; padding: 9px 6px; border-radius: 10px; color: var(--text); font-size: .9rem; }
.recent:hover { background: var(--surface-2); }
.more { margin-inline-start: auto; font-size: .82rem; font-weight: 500; }
.skel { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; }
@media (max-width: 720px) { .cmp { margin-inline-start: 0; width: 100%; } .skel { grid-template-columns: 1fr 1fr; } }
</style>
