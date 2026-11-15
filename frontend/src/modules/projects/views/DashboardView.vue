<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import CountUp from '../../beneficiaries/components/CountUp.vue';
import { APPROVAL, FUNDING_TYPES, color, label, links, pct, sar } from '../labels';
import type { ProjectRow } from '../types';
import '../projects.css';

interface Dash {
  projects: ProjectRow[];
  programFunds: { batchId: string; programId: string; programName: string; donorName: string | null; amount: number; net: number }[];
  monthly: { month: string; activityId: string; amount: number }[];
  pendingPayments: { count: number; amount: number };
}
const session = useSession();
const router = useRouter();
const data = ref<Dash | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    data.value = await api<Dash>('/projects/dashboard');
  } catch (e) {
    error.value = (e as Error).message;
  }
});

// ---------------- الفلتر الذكي: كل اختيار يفلتر كل البيانات ----------------
type Dim = 'axis' | 'program' | 'type' | 'status' | 'zakat' | 'donor' | 'month' | 'mode';
const DIM_AR: Record<Dim, string> = { axis: 'المحور', program: 'البرنامج', type: 'النوع', status: 'الاعتماد', zakat: 'الزكاة', donor: 'الداعم', month: 'الشهر', mode: 'طريقة الصرف' };
const filters = reactive<Record<Dim, string[]>>({ axis: [], program: [], type: [], status: [], zakat: [], donor: [], month: [], mode: [] });
const search = ref('');
const monthsBy = computed(() => {
  const m = new Map<string, Set<string>>();
  for (const x of data.value?.monthly ?? []) m.set(x.activityId, (m.get(x.activityId) ?? new Set()).add(x.month));
  return m;
});
const values: Record<Dim, (r: ProjectRow) => string[]> = {
  axis: (r) => [r.axisName], program: (r) => [r.programName], type: (r) => [r.fundingType], status: (r) => [r.approvalStatus],
  zakat: (r) => [r.zakatEligible ? 'yes' : 'no'], donor: (r) => r.donors.map((d) => d.name), month: (r) => [...(monthsBy.value.get(r.id) ?? [])],
  mode: (r) => [r.spendingMode],
};
const matchSearch = (r: ProjectRow) => {
  const t = search.value.trim();
  if (!t) return true;
  return [r.name, r.code, r.axisName, r.programName, r.managerName ?? '', ...r.donors.map((d) => d.name)].some((x) => x.includes(t) || x.includes(t.toUpperCase()));
};
const pass = (r: ProjectRow, except?: Dim) => matchSearch(r)
  && (Object.keys(filters) as Dim[]).every((d) => d === except || !filters[d].length || values[d](r).some((v) => filters[d].includes(v)));
const rowsFor = (except?: Dim) => (data.value?.projects ?? []).filter((r) => pass(r, except));
const rows = computed(() => rowsFor());
function toggle(d: Dim, v: string) {
  const i = filters[d].indexOf(v);
  if (i >= 0) filters[d].splice(i, 1);
  else filters[d].push(v);
}
const on = (d: Dim, v: string) => filters[d].includes(v);
const dimmed = (d: Dim, v: string) => filters[d].length > 0 && !filters[d].includes(v);
const active = computed(() => (Object.keys(filters) as Dim[]).flatMap((d) => filters[d].map((v) => ({ d, v }))));
function clearAll() {
  for (const d of Object.keys(filters) as Dim[]) filters[d] = [];
  search.value = '';
}
const chipText = (d: Dim, v: string) => {
  if (d === 'type') return label('funding', v);
  if (d === 'status') return label('approval', v);
  if (d === 'zakat') return v === 'yes' ? 'ضمن الزكاة' : 'خارج الزكاة';
  if (d === 'mode') return label('mode', v);
  if (d === 'month') return monthName(v);
  return v;
};

// ---------------- المؤشرات ----------------
const ids = computed(() => new Set(rows.value.map((r) => r.id)));
const monthSpent = computed(() => (data.value?.monthly ?? []).filter((m) => ids.value.has(m.activityId) && (!filters.month.length || filters.month.includes(m.month))).reduce((s, m) => s + m.amount, 0));
const kpi = computed(() => rows.value.reduce((t, r) => ({
  funds: t.funds + r.funds, reserved: t.reserved + r.reserved, spent: t.spent + r.spent, available: t.available + r.available,
  served: t.served + r.served, approved: t.approved + (r.approvalStatus === 'approved' ? 1 : 0), budget: t.budget + (r.budget ?? 0),
}), { funds: 0, reserved: 0, spent: 0, available: 0, served: 0, approved: 0, budget: 0 }));

// ---------------- تجميع لكل بُعد (يستثني فلتر البعد نفسه حتى تبقى بقية الخيارات ظاهرة) ----------------
function group(d: Dim, metric: (r: ProjectRow, v: string) => number) {
  const out = new Map<string, number>();
  for (const r of rowsFor(d)) for (const v of values[d](r)) out.set(v, (out.get(v) ?? 0) + metric(r, v));
  return [...out.entries()].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
}
const metric = ref<'funds' | 'spent' | 'count'>('funds');
const M = (r: ProjectRow) => (metric.value === 'count' ? 1 : r[metric.value]);
const byAxis = computed(() => group('axis', M));
const byProgram = computed(() => group('program', M).slice(0, 8));
const byDonor = computed(() => group('donor', (r, v) => (metric.value === 'count' ? 1 : r.donors.find((d) => d.name === v)?.amount ?? 0)).slice(0, 8));
const byType = computed(() => FUNDING_TYPES.map((t) => ({ ...t, v: rowsFor('type').filter((r) => r.fundingType === t.value).reduce((s, r) => s + M(r), 0), n: rowsFor('type').filter((r) => r.fundingType === t.value).length })));
const byZakat = computed(() => ['yes', 'no'].map((k) => ({ k, n: rowsFor('zakat').filter((r) => (r.zakatEligible ? 'yes' : 'no') === k).length })));
const max = (xs: { v: number }[]) => Math.max(1, ...xs.map((x) => x.v));
const fmtM = (v: number) => (metric.value === 'count' ? `${v.toLocaleString('ar-SA')} مشروع` : sar(v));

const ring = computed(() => {
  const list = rowsFor('status');
  const total = list.length || 1;
  const C = 2 * Math.PI * 52;
  let off = 0;
  return APPROVAL.map((s) => {
    const count = list.filter((r) => r.approvalStatus === s.value).length;
    const len = (count / total) * C;
    const seg = { ...s, count, dash: `${len} ${C - len}`, offset: -off };
    off += len;
    return seg;
  });
});

const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const monthName = (m: string) => `${monthNames[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const months = computed(() => {
  const now = new Date();
  const keys = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const allowed = new Set(rowsFor('month').map((r) => r.id));
  const sums = new Map<string, number>();
  for (const m of data.value?.monthly ?? []) if (allowed.has(m.activityId)) sums.set(m.month, (sums.get(m.month) ?? 0) + m.amount);
  const top = Math.max(1, ...sums.values());
  return keys.map((k) => ({ k, v: sums.get(k) ?? 0, h: Math.max(2, ((sums.get(k) ?? 0) / top) * 100), name: monthNames[Number(k.slice(5)) - 1] }));
});
const topProjects = computed(() => [...rows.value].sort((a, b) => b.funds - a.funds || a.name.localeCompare(b.name, 'ar')).slice(0, 10));
const programPool = computed(() => (data.value?.programFunds ?? []).filter((x) => !filters.program.length || filters.program.includes(x.programName)));
</script>

<template>
  <div>
    <section class="pm-hero">
      <div>
        <p class="pm-kicker">نظام إدارة المشاريع</p>
        <h1>كل ريال له أثر، وكل أثر له مشروع</h1>
        <p class="pm-sub">اضغط أو المس أي عنصر في اللوحة لتفلتر كل البيانات به، واجمع أكثر من اختيار للمقارنة.</p>
      </div>
      <div class="pm-actions">
        <RouterLink v-if="session.can('projects.support.manage')" to="/projects/support" class="btn btn-glow">إدارة الدعم</RouterLink>
        <RouterLink to="/projects/list" class="btn btn-ghost">إجمالي المشاريع</RouterLink>
        <RouterLink v-if="session.can('projects.reports.read')" to="/projects/reports" class="btn btn-ghost">التقارير</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <template v-if="data">
      <div class="smart card">
        <span class="spark" aria-hidden="true">✦</span>
        <input v-model="search" class="input" placeholder="فلتر ذكي: اكتب اسم مشروع أو برنامج أو داعم أو مدير مشروع..." />
        <div class="metric">
          <button v-for="m in [{ k: 'funds', l: 'الدعم' }, { k: 'spent', l: 'الصرف' }, { k: 'count', l: 'العدد' }] as const" :key="m.k" :class="{ on: metric === m.k }" @click="metric = m.k">{{ m.l }}</button>
        </div>
      </div>
      <TransitionGroup v-if="active.length || search" name="chip" tag="div" class="chips">
        <button v-for="c in active" :key="c.d + c.v" class="fchip" @click="toggle(c.d, c.v)"><small>{{ DIM_AR[c.d] }}:</small> {{ chipText(c.d, c.v) }} ✕</button>
        <button key="clear" class="fchip clear" @click="clearAll">مسح الكل</button>
      </TransitionGroup>

      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #6366f1; --i: 0"><span>المشاريع</span><strong><CountUp :value="rows.length" /></strong><small>{{ kpi.approved }} معتمد</small></div>
        <div class="pm-kpi" style="--a: #0d9488; --i: 1"><span>الدعم الوارد</span><strong><CountUp :value="kpi.funds" :decimals="2" /></strong><small>ريال<template v-if="kpi.budget"> · {{ pct(kpi.funds, kpi.budget) }}% من الميزانيات</template></small></div>
        <div class="pm-kpi" style="--a: #f59e0b; --i: 2"><span>محجوز</span><strong><CountUp :value="kpi.reserved" :decimals="2" /></strong><small>{{ data.pendingPayments.count }} طلب صرف ينتظر المالية</small></div>
        <div class="pm-kpi" style="--a: #10b981; --i: 3"><span>مخصوم</span><strong><CountUp :value="filters.month.length ? monthSpent : kpi.spent" :decimals="2" /></strong><small>{{ filters.month.length ? 'في الأشهر المختارة' : `${pct(kpi.spent, kpi.funds)}% من الوارد` }}</small></div>
        <div class="pm-kpi" style="--a: #0ea5e9; --i: 4"><span>المتاح للتحميل</span><strong><CountUp :value="kpi.available" :decimals="2" /></strong><small>صافي الدفعات</small></div>
        <div class="pm-kpi" style="--a: #ec4899; --i: 5"><span>المستفيدون</span><strong><CountUp :value="kpi.served" /></strong><small>حصلوا على دعم محمّل</small></div>
      </div>

      <div class="grid">
        <section class="card pm-panel span2">
          <h2>الصرف الشهري (آخر 12 شهرًا) <small class="pm-muted">اضغط على شهر</small></h2>
          <div class="bars">
            <button v-for="(m, i) in months" :key="m.k" :class="['bar-col', { on: on('month', m.k), dim: dimmed('month', m.k) }]" :title="`${monthName(m.k)}: ${sar(m.v)}`" @click="toggle('month', m.k)">
              <span class="bar-val">{{ m.v ? sar(m.v) : '' }}</span>
              <span class="bar-track"><span class="bar" :style="{ height: m.h + '%', animationDelay: i * 50 + 'ms' }" /></span>
              <span class="bar-name">{{ m.name }}</span>
            </button>
          </div>
        </section>

        <section class="card pm-panel">
          <h2>حالة الاعتماد</h2>
          <div class="ring-wrap">
            <svg viewBox="0 0 120 120" class="ring">
              <circle cx="60" cy="60" r="52" class="ring-bg" />
              <circle v-for="s in ring" :key="s.value" cx="60" cy="60" r="52" :class="['ring-seg', { dim: dimmed('status', s.value) }]"
                :stroke="s.color" :stroke-dasharray="s.dash" :stroke-dashoffset="s.offset" @click="toggle('status', s.value)" />
            </svg>
            <div class="ring-center"><strong>{{ rowsFor('status').length }}</strong><span>مشروع</span></div>
          </div>
          <ul class="legend">
            <li v-for="s in ring" :key="s.value" :class="{ on: on('status', s.value), dim: dimmed('status', s.value) }" @click="toggle('status', s.value)"><i :style="{ background: s.color }" />{{ s.label }}<b>{{ s.count }}</b></li>
          </ul>
        </section>

        <section class="card pm-panel">
          <h2>نوع المشروع</h2>
          <div class="tiles">
            <button v-for="t in byType" :key="t.value" :class="['tile', { on: on('type', t.value), dim: dimmed('type', t.value) }]" :style="{ '--c': t.color }" @click="toggle('type', t.value)">
              <b>{{ t.label }}</b><strong>{{ fmtM(t.v) }}</strong><small>{{ t.n }} مشروع</small>
            </button>
          </div>
          <div class="zakat">
            <button v-for="z in byZakat" :key="z.k" :class="['ztile', { on: on('zakat', z.k), dim: dimmed('zakat', z.k) }]" @click="toggle('zakat', z.k)">
              {{ z.k === 'yes' ? '🌙 ضمن الزكاة' : 'خارج الزكاة' }} <b>{{ z.n }}</b>
            </button>
          </div>
        </section>

        <section class="card pm-panel">
          <h2>حسب المحور</h2>
          <p v-if="!byAxis.length" class="pm-empty">لا توجد بيانات</p>
          <button v-for="a in byAxis" :key="a.k" :class="['hbar', { on: on('axis', a.k), dim: dimmed('axis', a.k) }]" @click="toggle('axis', a.k)">
            <span class="hl">{{ a.k }}</span><span class="ht"><i :style="{ width: (a.v / max(byAxis)) * 100 + '%' }" /></span><b>{{ fmtM(a.v) }}</b>
          </button>
        </section>

        <section class="card pm-panel">
          <h2>حسب البرنامج</h2>
          <p v-if="!byProgram.length" class="pm-empty">لا توجد بيانات</p>
          <button v-for="a in byProgram" :key="a.k" :class="['hbar', 'p', { on: on('program', a.k), dim: dimmed('program', a.k) }]" @click="toggle('program', a.k)">
            <span class="hl">{{ a.k }}</span><span class="ht"><i :style="{ width: (a.v / max(byProgram)) * 100 + '%' }" /></span><b>{{ fmtM(a.v) }}</b>
          </button>
        </section>

        <section class="card pm-panel">
          <h2>أكبر الداعمين</h2>
          <p v-if="!byDonor.length" class="pm-empty">لم يصل دعم بعد</p>
          <button v-for="a in byDonor" :key="a.k" :class="['hbar', 'd', { on: on('donor', a.k), dim: dimmed('donor', a.k) }]" @click="toggle('donor', a.k)">
            <span class="hl">{{ a.k }}</span><span class="ht"><i :style="{ width: (a.v / max(byDonor)) * 100 + '%' }" /></span><b>{{ fmtM(a.v) }}</b>
          </button>
        </section>

        <section class="card pm-panel span2">
          <h2>المشاريع <small class="pm-muted">{{ rows.length }} مشروع مطابق</small></h2>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>المشروع</th><th>البرنامج</th><th>الاعتماد</th><th>الدعم</th><th>الإنفاق</th><th>المتاح</th></tr></thead>
              <tbody>
                <tr v-for="r in topProjects" :key="r.id" class="click" @click="router.push(links.project(r.id))">
                  <td><b>{{ r.name }}</b><span class="pm-muted">{{ r.code }} · {{ label('funding', r.fundingType) }}<template v-if="r.zakatEligible"> · زكاة</template></span></td>
                  <td>{{ r.programName }}</td>
                  <td><span class="pm-pill" :style="{ '--c': color('approval', r.approvalStatus) }">{{ label('approval', r.approvalStatus) }}</span></td>
                  <td class="pm-money">{{ sar(r.funds) }}</td>
                  <td style="min-width: 130px"><div class="pm-bar"><i :style="{ width: pct(r.spent, r.funds || 1) + '%', background: '#10b981' }" /><i :style="{ width: pct(r.reserved, r.funds || 1) + '%', background: '#f59e0b' }" /></div><span class="pm-muted">{{ pct(r.spent, r.funds) }}% مصروف</span></td>
                  <td class="pm-money" style="color: var(--primary)">{{ sar(r.available) }}</td>
                </tr>
                <tr v-if="!topProjects.length"><td colspan="6" class="pm-empty">لا توجد مشاريع مطابقة للفلتر</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-if="programPool.length" class="card pm-panel">
          <h2>دعم على مستوى البرامج</h2>
          <p class="pm-muted" style="margin-top: -6px">دفعات مقيدة ببرنامج ويُحمَّل منها أي مشروع فيه</p>
          <div v-for="x in programPool" :key="x.batchId" class="pool">
            <span class="grow"><b>{{ x.programName }}</b><small class="pm-muted"> · {{ x.donorName }}</small></span>
            <span class="pm-money">{{ sar(x.net) }}</span>
          </div>
        </section>
      </div>
    </template>
    <div v-else-if="!error" class="skel"><div v-for="i in 6" :key="i" /></div>
  </div>
</template>

<style scoped>
.btn-glow { background: linear-gradient(135deg, #f5c66b, #e8b04b); color: #3b2a06; border: 0; font-weight: 700; animation: pulse 2.6s infinite; }
@keyframes pulse { 70% { box-shadow: 0 0 0 12px rgba(232,176,75,0); } 0% { box-shadow: 0 0 0 0 rgba(232,176,75,.6); } }
.smart { display: flex; align-items: center; gap: 10px; padding: 8px 12px; margin-bottom: 10px; position: relative; overflow: hidden; }
.smart::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(90deg, transparent, rgba(99,102,241,.08), transparent); background-size: 200% 100%; animation: sweep 4s linear infinite; }
@keyframes sweep { to { background-position: -200% 0; } }
.spark { color: #6366f1; font-size: 1.2rem; animation: spin 6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.smart .input { border: 0; background: transparent; }
.smart .input:focus { outline: none; }
.metric { display: flex; background: var(--surface-2); border-radius: 10px; padding: 3px; flex-shrink: 0; }
.metric button { border: 0; background: none; font: inherit; padding: 5px 12px; border-radius: 8px; cursor: pointer; color: var(--muted); }
.metric button.on { background: var(--surface); color: var(--primary); font-weight: 700; box-shadow: var(--shadow); }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.fchip { border: 0; font: inherit; font-size: .84rem; padding: 4px 12px; border-radius: 99px; background: linear-gradient(135deg, #6366f1, #4f46e5); color: #fff; cursor: pointer; box-shadow: 0 4px 12px rgba(79,70,229,.3); }
.fchip small { opacity: .75; }
.fchip.clear { background: var(--surface); color: var(--danger); border: 1px solid var(--border); box-shadow: none; }
.chip-enter-active, .chip-leave-active { transition: all .25s var(--ease); }
.chip-enter-from, .chip-leave-to { opacity: 0; transform: scale(.8); }

.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.span2 { grid-column: span 2; }
button.hbar, button.tile, button.ztile, button.bar-col { font: inherit; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.on { outline: 2px solid #6366f1; outline-offset: 2px; }
.dim { opacity: .35; }
.bars { display: flex; align-items: flex-end; gap: 8px; height: 200px; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; height: 100%; min-width: 0; background: none; border: 0; border-radius: 10px; padding: 0; transition: opacity .2s; }
.bar-col.on { outline-offset: 0; }
.bar-val { font-size: .66rem; color: var(--muted); height: 14px; white-space: nowrap; }
.bar-track { flex: 1; width: 100%; max-width: 46px; display: flex; align-items: flex-end; border-radius: 10px; background: var(--surface-2); }
.bar { display: block; width: 100%; border-radius: 10px; background: linear-gradient(180deg, #818cf8, #4f46e5); box-shadow: 0 6px 18px rgba(79,70,229,.3); transform-origin: bottom; animation: grow .8s var(--ease) both; transition: height .5s var(--ease); }
.bar-col:hover .bar { filter: brightness(1.15); }
@keyframes grow { from { transform: scaleY(0); } }
.bar-name { font-size: .74rem; color: var(--muted); }
.ring-wrap { position: relative; width: 170px; margin: 0 auto 10px; }
.ring { width: 100%; transform: rotate(-90deg); }
.ring-bg { fill: none; stroke: var(--surface-2); stroke-width: 14; }
.ring-seg { fill: none; stroke-width: 14; cursor: pointer; transition: stroke-dasharray .6s var(--ease), opacity .2s, stroke-width .2s; animation: draw 1s var(--ease) both; }
.ring-seg:hover { stroke-width: 18; }
@keyframes draw { from { stroke-dasharray: 0 400; } }
.ring-center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; pointer-events: none; }
.ring-center strong { font-size: 1.6rem; line-height: 1; }
.ring-center span { color: var(--muted); font-size: .8rem; }
.legend { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; font-size: .86rem; }
.legend li { display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 3px 6px; border-radius: 8px; }
.legend li:hover { background: var(--surface-2); }
.legend i { width: 9px; height: 9px; border-radius: 3px; }
.legend b { margin-inline-start: auto; }
.tiles { display: grid; gap: 8px; }
.tile { display: grid; grid-template-columns: 1fr auto; text-align: right; gap: 0 8px; border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; background: linear-gradient(90deg, color-mix(in srgb, var(--c) 12%, transparent), transparent); transition: transform .2s var(--ease), opacity .2s; }
.tile:hover { transform: translateY(-2px); }
.tile b { color: var(--c); } .tile strong { grid-row: span 2; align-self: center; font-size: .95rem; } .tile small { color: var(--muted); font-size: .76rem; }
.zakat { display: flex; gap: 6px; margin-top: 10px; }
.ztile { flex: 1; border: 1px dashed var(--border); background: var(--surface-2); border-radius: 10px; padding: 8px; }
.hbar { display: grid; grid-template-columns: 110px 1fr auto; align-items: center; gap: 8px; width: 100%; padding: 6px; margin-bottom: 4px; background: none; border: 0; border-radius: 10px; text-align: right; font-size: .86rem; transition: background .2s, opacity .2s; }
.hbar:hover { background: var(--surface-2); }
.hl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ht { height: 10px; border-radius: 10px; background: var(--surface-2); overflow: hidden; }
.ht i { display: block; height: 100%; border-radius: 10px; background: linear-gradient(90deg, #2dd4bf, #0d9488); transition: width .5s var(--ease); animation: pm-fill .9s var(--ease) both; transform-origin: right; }
.hbar.p .ht i { background: linear-gradient(90deg, #a5b4fc, #6366f1); }
.hbar.d .ht i { background: linear-gradient(90deg, #f5c66b, #d99a2b); }
.hbar b { font-size: .8rem; white-space: nowrap; }
tr.click { cursor: pointer; }
.pool { display: flex; gap: 8px; padding: 8px 4px; border-bottom: 1px solid var(--border); }
.grow { flex: 1; min-width: 0; }
.skel { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.skel div { height: 140px; border-radius: 16px; background: linear-gradient(90deg, var(--surface-2), #eef3f5, var(--surface-2)); background-size: 200% 100%; animation: shimmer 1.2s infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
@media (max-width: 1100px) { .grid { grid-template-columns: 1fr 1fr; } }
@media (max-width: 700px) {
  .grid, .skel { grid-template-columns: 1fr; } .span2 { grid-column: auto; }
  .smart { flex-wrap: wrap; } .bars { gap: 3px; height: 170px; } .bar-val { display: none; }
  .hbar { grid-template-columns: 90px 1fr auto; }
}
</style>
