<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import CountUp from '../components/CountUp.vue';
import BeneficiaryForm from '../components/BeneficiaryForm.vue';
import { color, fmtDate, label, money, STATUSES, today } from '../labels';
import type { Beneficiary, Stats } from '../types';
import { useRouter } from 'vue-router';

const session = useSession();
const router = useRouter();
const stats = ref<Stats | null>(null);
const error = ref('');
const creating = ref(false);

onMounted(async () => {
  try {
    stats.value = await api<Stats>('/beneficiaries/stats');
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const eligible = computed(() => stats.value?.byStatus.eligible ?? 0);

// حلقة توزيع الحالات: كل حالة قوس بطول نسبتها
const ring = computed(() => {
  const s = stats.value;
  const total = s?.beneficiaries || 0;
  const C = 2 * Math.PI * 52;
  let offset = 0;
  return STATUSES.map((st) => {
    const count = s?.byStatus[st.value as keyof Stats['byStatus']] ?? 0;
    const len = total ? (count / total) * C : 0;
    const seg = { ...st, count, dash: `${len} ${C - len}`, offset: -offset };
    offset += len;
    return seg;
  });
});

const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const bars = computed(() => {
  const m = stats.value?.monthly ?? [];
  const max = Math.max(1, ...m.map((x) => x.amount));
  return m.map((x) => ({ ...x, h: Math.max(2, (x.amount / max) * 100), name: monthNames[Number(x.month.slice(5)) - 1] }));
});
const categoryMax = computed(() => Math.max(1, ...(stats.value?.byCategory ?? []).map((c) => c.count)));

function opened(b: Beneficiary) {
  creating.value = false;
  router.push(`/beneficiaries/files/${b.id}`);
}
</script>

<template>
  <div>
    <section class="hero">
      <div class="hero-glow" aria-hidden="true" />
      <div class="hero-text">
        <p class="kicker">وحدة المستفيدين</p>
        <h1>كل حالة لها قصة، وكل قصة لها ملف</h1>
        <p class="sub">تابع الأسر المستفيدة، نتائج البحث الاجتماعي، والمساعدات المصروفة من مكان واحد.</p>
      </div>
      <div class="hero-actions">
        <button v-if="session.can('beneficiaries.cases.manage')" class="btn btn-glow" @click="creating = true">+ ملف مستفيد جديد</button>
        <RouterLink to="/beneficiaries/files" class="btn btn-ghost">كل الملفات</RouterLink>
      </div>
    </section>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <template v-if="stats">
      <div class="kpis">
        <div class="kpi" style="--a: #14b8a6; --i: 0">
          <span class="kpi-label">إجمالي الملفات</span>
          <strong><CountUp :value="stats.beneficiaries" /></strong>
          <span class="kpi-foot">{{ (stats.beneficiaries + stats.familyMembers).toLocaleString('ar-EG') }} فرد مع الأسر</span>
        </div>
        <div class="kpi" style="--a: #10b981; --i: 1">
          <span class="kpi-label">حالات مستحقة</span>
          <strong><CountUp :value="eligible" /></strong>
          <span class="kpi-foot">{{ stats.byStatus.under_review ?? 0 }} تحت الدراسة · {{ stats.byStatus.new ?? 0 }} جديدة</span>
        </div>
        <div class="kpi" style="--a: #e8b04b; --i: 2">
          <span class="kpi-label">مساعدات هذا الشهر</span>
          <strong><CountUp :value="stats.aidThisMonth" :decimals="2" /></strong>
          <span class="kpi-foot">القيمة الإجمالية</span>
        </div>
        <div class="kpi" style="--a: #6366f1; --i: 3">
          <span class="kpi-label">مساعدات هذا العام</span>
          <strong><CountUp :value="stats.aidThisYear" :decimals="2" /></strong>
          <span class="kpi-foot">{{ stats.aidByType.reduce((s, t) => s + t.count, 0).toLocaleString('ar-EG') }} عملية صرف</span>
        </div>
      </div>

      <div class="grid">
        <section class="card panel chart-panel">
          <h2>المساعدات المصروفة آخر 6 شهور</h2>
          <div class="bars">
            <div v-for="(b, i) in bars" :key="b.month" class="bar-col" :title="`${money(b.amount)} · ${b.count} عملية`">
              <span class="bar-val">{{ b.amount ? money(b.amount) : '' }}</span>
              <div class="bar-track"><div class="bar" :style="{ height: b.h + '%', animationDelay: i * 80 + 'ms' }" /></div>
              <span class="bar-name">{{ b.name }}</span>
            </div>
          </div>
        </section>

        <section class="card panel">
          <h2>حالات الملفات</h2>
          <div class="ring-wrap">
            <svg viewBox="0 0 120 120" class="ring">
              <circle cx="60" cy="60" r="52" class="ring-bg" />
              <circle v-for="s in ring" :key="s.value" cx="60" cy="60" r="52" class="ring-seg"
                :stroke="s.color" :stroke-dasharray="s.dash" :stroke-dashoffset="s.offset" />
            </svg>
            <div class="ring-center"><strong>{{ stats.beneficiaries.toLocaleString('ar-EG') }}</strong><span>ملف</span></div>
          </div>
          <ul class="legend">
            <li v-for="s in ring" :key="s.value"><i :style="{ background: s.color }" />{{ s.label }}<b>{{ s.count.toLocaleString('ar-EG') }}</b></li>
          </ul>
        </section>

        <section class="card panel">
          <h2>الفئات</h2>
          <p v-if="!stats.byCategory.length" class="muted empty">لا توجد ملفات بعد</p>
          <div v-for="c in stats.byCategory" :key="c.category" class="hbar">
            <span class="hbar-label">{{ label('category', c.category) }}</span>
            <div class="hbar-track"><div class="hbar-fill" :style="{ width: (c.count / categoryMax) * 100 + '%', background: color('category', c.category) }" /></div>
            <b>{{ c.count.toLocaleString('ar-EG') }}</b>
          </div>
        </section>

        <section class="card panel">
          <h2>آخر المساعدات</h2>
          <p v-if="!stats.recentAids.length" class="muted empty">لم تُصرف مساعدات بعد</p>
          <RouterLink v-for="a in stats.recentAids" :key="a.id" :to="`/beneficiaries/files/${a.beneficiaryId}`" class="row-link">
            <span class="dot" :style="{ background: color('aid', a.aidType) }" />
            <span class="grow"><b>{{ a.fullName }}</b><small class="muted"> · {{ label('aid', a.aidType) }} · {{ fmtDate(a.disbursedOn) }}</small></span>
            <span class="amount">{{ money(a.amount) }}</span>
          </RouterLink>
        </section>

        <section class="card panel">
          <h2>مراجعات قريبة</h2>
          <p v-if="!stats.upcomingReviews.length" class="muted empty">لا توجد مراجعات خلال الأسبوعين القادمين</p>
          <RouterLink v-for="r in stats.upcomingReviews" :key="r.id" :to="`/beneficiaries/files/${r.id}`" class="row-link">
            <span class="file-no">#{{ r.fileNo }}</span>
            <span class="grow"><b>{{ r.fullName }}</b></span>
            <span :class="['due', { late: r.nextReviewDate < today() }]">{{ fmtDate(r.nextReviewDate) }}</span>
          </RouterLink>
        </section>
      </div>
    </template>
    <div v-else-if="!error" class="skeleton-grid"><div v-for="i in 4" :key="i" class="skeleton" /></div>

    <BeneficiaryForm v-if="creating" @close="creating = false" @saved="opened" />
  </div>
</template>

<style scoped>
.hero { position: relative; overflow: hidden; border-radius: 20px; padding: 28px 30px; margin-bottom: 22px; color: #fff; background: var(--grad-dark);
  display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; flex-wrap: wrap; box-shadow: 0 16px 40px rgba(6,20,26,.18); }
.hero-glow { position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(420px 200px at 85% 0%, rgba(232,176,75,.4), transparent 70%), radial-gradient(520px 260px at 10% 120%, rgba(45,212,191,.45), transparent 70%);
  animation: breathe 9s ease-in-out infinite; }
@keyframes breathe { 50% { opacity: .65; transform: scale(1.04); } }
.hero-text, .hero-actions { position: relative; animation: rise .6s var(--ease) both; }
.kicker { margin: 0 0 4px; color: #5eead4; font-weight: 600; font-size: .88rem; }
.hero h1 { font-size: 1.55rem; }
.sub { margin: 6px 0 0; color: rgba(255,255,255,.75); max-width: 560px; }
.hero-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.btn-glow { background: linear-gradient(135deg, #f5c66b, #e8b04b); color: #3b2a06; border: 0; font-weight: 700; box-shadow: 0 0 0 0 rgba(232,176,75,.6); animation: pulse 2.6s infinite; }
.btn-glow:hover { background: linear-gradient(135deg, #f8d48a, #eab558); transform: translateY(-1px); }
@keyframes pulse { 70% { box-shadow: 0 0 0 12px rgba(232,176,75,0); } 100% { box-shadow: 0 0 0 0 rgba(232,176,75,0); } }
.btn-ghost { background: rgba(255,255,255,.08); color: #fff; border-color: rgba(255,255,255,.2); }
.btn-ghost:hover { background: rgba(255,255,255,.16); }

.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 18px; }
.kpi { position: relative; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 18px 18px 16px;
  display: flex; flex-direction: column; gap: 2px; box-shadow: var(--shadow); animation: rise .5s calc(var(--i) * 80ms + 100ms) var(--ease) both; }
.kpi::before { content: ''; position: absolute; inset-inline-start: 0; top: 0; bottom: 0; width: 4px; background: var(--a); box-shadow: 0 0 18px var(--a); }
.kpi::after { content: ''; position: absolute; width: 140px; height: 140px; inset-inline-end: -50px; top: -60px; border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--a) 22%, transparent), transparent 70%); }
.kpi-label { color: var(--muted); font-size: .86rem; font-weight: 500; }
.kpi strong { font-size: 1.75rem; font-weight: 700; letter-spacing: -.5px; }
.kpi-foot { font-size: .8rem; color: var(--muted); }

.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.panel { padding: 18px; animation: rise .55s .25s var(--ease) both; min-width: 0; }
.panel h2 { font-size: .98rem; margin-bottom: 14px; }
.chart-panel { grid-column: span 2; }
.empty { text-align: center; padding: 18px 0; margin: 0; }

.bars { display: flex; align-items: flex-end; gap: 12px; height: 210px; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; height: 100%; min-width: 0; }
.bar-val { font-size: .72rem; color: var(--muted); height: 16px; white-space: nowrap; }
.bar-track { flex: 1; width: 100%; max-width: 54px; display: flex; align-items: flex-end; border-radius: 10px; background: var(--surface-2); }
.bar { width: 100%; border-radius: 10px; background: linear-gradient(180deg, #2dd4bf, #0f766e); box-shadow: 0 6px 18px rgba(20,184,166,.35);
  transform-origin: bottom; animation: grow .8s var(--ease) both; }
.bar-col:last-child .bar { background: linear-gradient(180deg, #f5c66b, #d99a2b); box-shadow: 0 6px 18px rgba(232,176,75,.4); }
@keyframes grow { from { transform: scaleY(0); } }
.bar-name { font-size: .8rem; color: var(--muted); }

.ring-wrap { position: relative; width: 170px; margin: 0 auto 10px; }
.ring { width: 100%; transform: rotate(-90deg); }
.ring-bg { fill: none; stroke: var(--surface-2); stroke-width: 14; }
.ring-seg { fill: none; stroke-width: 14; transition: stroke-dasharray .8s var(--ease); animation: draw 1s var(--ease) both; }
@keyframes draw { from { stroke-dasharray: 0 400; } }
.ring-center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; }
.ring-center strong { font-size: 1.6rem; line-height: 1; }
.ring-center span { color: var(--muted); font-size: .8rem; }
.legend { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; font-size: .84rem; }
.legend li { display: flex; align-items: center; gap: 6px; }
.legend i { width: 9px; height: 9px; border-radius: 3px; }
.legend b { margin-inline-start: auto; }

.hbar { display: grid; grid-template-columns: 90px 1fr 32px; align-items: center; gap: 10px; margin-bottom: 10px; font-size: .86rem; }
.hbar-track { height: 9px; border-radius: 9px; background: var(--surface-2); overflow: hidden; }
.hbar-fill { height: 100%; border-radius: 9px; animation: fill .9s var(--ease) both; transform-origin: right; }
@keyframes fill { from { transform: scaleX(0); } }
.hbar b { text-align: left; }

.row-link { display: flex; align-items: center; gap: 10px; padding: 9px 8px; border-radius: 10px; color: var(--text); transition: background .2s; font-size: .9rem; }
.row-link:hover { background: var(--surface-2); }
.grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.amount { font-weight: 700; color: var(--primary); }
.file-no { font-size: .78rem; color: var(--muted); background: var(--surface-2); padding: 1px 8px; border-radius: 6px; }
.due { font-size: .8rem; color: #b45309; background: #fef3c7; padding: 1px 8px; border-radius: 999px; }
.due.late { color: var(--danger); background: var(--danger-soft); }

.skeleton-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.skeleton { height: 110px; border-radius: 16px; background: linear-gradient(90deg, var(--surface-2), #eef3f5, var(--surface-2)); background-size: 200% 100%; animation: shimmer 1.2s infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
@keyframes rise { from { opacity: 0; transform: translateY(14px); } }

@media (max-width: 1100px) { .grid { grid-template-columns: 1fr 1fr; } .kpis { grid-template-columns: 1fr 1fr; } }
@media (max-width: 700px) {
  .grid, .kpis, .skeleton-grid { grid-template-columns: 1fr; }
  .chart-panel { grid-column: auto; }
  .hero { padding: 22px 18px; } .hero h1 { font-size: 1.25rem; }
  .bars { gap: 6px; }
}
</style>
