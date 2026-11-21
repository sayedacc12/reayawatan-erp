<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { APPLICATION_STATUS, CONTRACT_STATUS, fmtDate, money, ORG_STATE } from '../labels';
import '../platform.css';


interface Item { id: string; name: string; slug: string; date: string | null; state?: string }
interface Report {
  totals: { organizations: number; annualRevenue: number; activeSubscriptions: number };
  states: Record<string, number>; applications: Record<string, number>; contracts: Record<string, number>;
  monthlyApplications: { month: string; n: number }[];
  trialsEnding: Item[]; expiring: Item[]; blocked: Item[];
  screens: { path: string; label: string; organizations: number }[];
}
const r = ref<Report | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    r.value = await api<Report>('/platform/reports/subscriptions');
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const COLORS: Record<string, string> = { ok: '#10b981', info: '#6366f1', warn: '#c7a27a', bad: '#ef4444', muted: '#94a3b8' };
const ring = computed(() => {
  if (!r.value) return [];
  const entries = Object.entries(r.value.states).filter(([, n]) => n > 0);
  const total = entries.reduce((s, [, n]) => s + n, 0) || 1;
  const C = 2 * Math.PI * 52;
  let off = 0;
  return entries.map(([k, n]) => {
    const len = (n / total) * C;
    const seg = { key: k, n, label: ORG_STATE[k]?.label ?? k, color: COLORS[ORG_STATE[k]?.tone ?? 'muted'], dash: `${len} ${C - len}`, offset: -off };
    off += len;
    return seg;
  });
});
const months = computed(() => {
  const out: { key: string; name: string; n: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ key, name: d.toLocaleDateString('ar-SA-u-ca-gregory', { month: 'short' }), n: r.value?.monthlyApplications.find((m) => m.month === key)?.n ?? 0 });
  }
  return out;
});
const monthMax = computed(() => Math.max(1, ...months.value.map((m) => m.n)));
const screenMax = computed(() => Math.max(1, r.value?.totals.organizations ?? 1));
const pending = computed(() => r.value?.applications.submitted ?? 0);
const daysLeft = (d: string | null) => (d ? Math.ceil((new Date(`${d}T23:59:59`).getTime() - Date.now()) / 86400000) : 0);
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="r">
      <div class="kpis">
        <div class="kpi" style="--a: #2f7a57; --i: 0"><span>إجمالي الجمعيات</span><strong>{{ r.totals.organizations }}</strong><small>{{ r.totals.activeSubscriptions }} باشتراك ساري</small></div>
        <div class="kpi" style="--a: #c7a27a; --i: 1"><span>الإيراد السنوي المتوقع</span><strong>{{ money(r.totals.annualRevenue) }}</strong><small>قبل الضريبة، للاشتراكات السارية</small></div>
        <div class="kpi" style="--a: #6366f1; --i: 2"><span>طلبات بانتظار المراجعة</span><strong>{{ pending }}</strong><small><RouterLink to="/platform/applications">فتح الطلبات ←</RouterLink></small></div>
        <div class="kpi" style="--a: #ef4444; --i: 3"><span>عقود بانتظار التوقيع</span><strong>{{ r.contracts.sent ?? 0 }}</strong><small>{{ r.contracts.changes_requested ?? 0 }} طلب تعديل</small></div>
      </div>

      <div class="p-grid">
        <section class="card p-panel">
          <h2>حالات الجمعيات</h2>
          <div class="ring-wrap">
            <svg viewBox="0 0 120 120" class="ring">
              <circle cx="60" cy="60" r="52" class="ring-bg" />
              <circle v-for="s in ring" :key="s.key" cx="60" cy="60" r="52" class="ring-seg" :stroke="s.color" :stroke-dasharray="s.dash" :stroke-dashoffset="s.offset" />
            </svg>
            <div class="ring-center"><strong>{{ r.totals.organizations }}</strong><span>جمعية</span></div>
          </div>
          <ul class="legend"><li v-for="s in ring" :key="s.key"><i :style="{ background: s.color }" />{{ s.label }}<b>{{ s.n }}</b></li></ul>
        </section>

        <section class="card p-panel">
          <h2>طلبات الاشتراك آخر 6 أشهر</h2>
          <div class="bars">
            <div v-for="(m, i) in months" :key="m.key" class="bar-col">
              <span class="bar-val">{{ m.n || '' }}</span>
              <div class="bar-track"><div class="bar" :style="{ height: (m.n / monthMax) * 100 + '%', animationDelay: i * 80 + 'ms' }" /></div>
              <span class="bar-name">{{ m.name }}</span>
            </div>
          </div>
          <div class="mini">
            <span v-for="(s, k) in APPLICATION_STATUS" :key="k" :class="['tone', `tone-${s.tone}`]">{{ s.label }}: {{ r.applications[k] ?? 0 }}</span>
          </div>
        </section>

        <section class="card p-panel">
          <h2>العقود</h2>
          <div v-for="(s, k) in CONTRACT_STATUS" :key="k" class="hbar">
            <span class="hbar-label">{{ s.label }}</span>
            <div class="hbar-track"><div class="hbar-fill" :style="{ width: ((r.contracts[k] ?? 0) / Math.max(1, ...Object.values(r.contracts))) * 100 + '%', background: COLORS[s.tone] }" /></div>
            <b>{{ r.contracts[k] ?? 0 }}</b>
          </div>
        </section>

        <section class="card p-panel">
          <h2>⏳ فترات تجريبية تنتهي خلال 14 يومًا</h2>
          <p v-if="!r.trialsEnding.length" class="muted empty">لا يوجد</p>
          <RouterLink v-for="o in r.trialsEnding" :key="o.id" :to="`/platform/organizations/${o.id}`" class="row-link">
            <span class="grow"><b>{{ o.name }}</b></span><span class="due">{{ fmtDate(o.date) }} · {{ daysLeft(o.date) }} يوم</span>
          </RouterLink>
        </section>

        <section class="card p-panel">
          <h2>🔁 اشتراكات تنتهي خلال 30 يومًا</h2>
          <p v-if="!r.expiring.length" class="muted empty">لا يوجد</p>
          <RouterLink v-for="o in r.expiring" :key="o.id" :to="`/platform/organizations/${o.id}`" class="row-link">
            <span class="grow"><b>{{ o.name }}</b></span><span class="due">{{ fmtDate(o.date) }}</span>
          </RouterLink>
        </section>

        <section class="card p-panel">
          <h2>⛔ جمعيات متوقف دخولها</h2>
          <p v-if="!r.blocked.length" class="muted empty">لا يوجد</p>
          <RouterLink v-for="o in r.blocked" :key="o.id" :to="`/platform/organizations/${o.id}`" class="row-link">
            <span class="grow"><b>{{ o.name }}</b></span><span :class="['tone', `tone-${ORG_STATE[o.state!]?.tone}`]">{{ ORG_STATE[o.state!]?.label }}</span>
          </RouterLink>
        </section>
      </div>

      <section class="card p-panel">
        <h2>انتشار الشاشات بين الجمعيات</h2>
        <div v-for="s in r.screens" :key="s.path" class="hbar">
          <span class="hbar-label wide">{{ s.label }}</span>
          <div class="hbar-track"><div class="hbar-fill" :style="{ width: (s.organizations / screenMax) * 100 + '%' }" /></div>
          <b>{{ s.organizations }}</b>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 16px; }
.kpi { position: relative; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 16px 18px; display: flex; flex-direction: column; gap: 2px;
  box-shadow: var(--shadow); animation: p-rise .5s var(--ease) both; animation-delay: calc(var(--i) * 80ms); }
.kpi::before { content: ''; position: absolute; inset-inline-start: 0; top: 0; bottom: 0; width: 4px; background: var(--a); }
.kpi::after { content: ''; position: absolute; width: 120px; height: 120px; border-radius: 50%; background: var(--a); opacity: .08; top: -40px; left: -40px; }
.kpi span { color: var(--muted); font-size: .88rem; }
.kpi strong { font-size: 1.5rem; }
.kpi small { color: var(--muted); font-size: .8rem; }
.ring-wrap { position: relative; width: 170px; margin: 0 auto 10px; }
.ring { width: 100%; transform: rotate(-90deg); }
.ring-bg { fill: none; stroke: var(--surface-2); stroke-width: 14; }
.ring-seg { fill: none; stroke-width: 14; animation: ring-in 1s var(--ease) both; }
@keyframes ring-in { from { stroke-dasharray: 0 400; } }
.ring-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.ring-center strong { font-size: 1.6rem; }
.ring-center span { color: var(--muted); font-size: .85rem; }
.legend { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
.legend li { display: flex; align-items: center; gap: 8px; font-size: .9rem; }
.legend i { width: 10px; height: 10px; border-radius: 3px; }
.legend b { margin-inline-start: auto; }
.bars { display: flex; align-items: flex-end; gap: 8px; height: 170px; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; }
.bar-track { flex: 1; width: 100%; display: flex; align-items: flex-end; background: var(--surface-2); border-radius: 8px; overflow: hidden; }
.bar { width: 100%; background: var(--grad); border-radius: 8px 8px 0 0; animation: grow .9s var(--ease) both; transform-origin: bottom; }
@keyframes grow { from { transform: scaleY(0); } }
.bar-val { font-size: .8rem; color: var(--primary); font-weight: 600; min-height: 1.2em; }
.bar-name { font-size: .78rem; color: var(--muted); }
.mini { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.hbar { display: grid; grid-template-columns: 150px 1fr 36px; gap: 10px; align-items: center; margin-bottom: 8px; font-size: .9rem; }
.hbar-label.wide { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hbar-track { height: 10px; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
.hbar-fill { height: 100%; background: var(--grad); border-radius: 999px; animation: fill 1s var(--ease) both; transform-origin: right; }
@keyframes fill { from { transform: scaleX(0); } }
.row-link { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-radius: 8px; color: var(--text); }
.row-link:hover { background: var(--surface-2); }
.grow { flex: 1; }
.due { color: #9a5b00; font-size: .85rem; }
.empty { text-align: center; padding: 14px 0; }
@media (max-width: 900px) { .kpis { grid-template-columns: 1fr 1fr; } .hbar { grid-template-columns: 110px 1fr 30px; } }
</style>
