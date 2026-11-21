<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import CountUp from '../../../shared/CountUp.vue';
import { LEVEL_COLOR, LEVELS, P, STATUS_COLOR, fmtDate, levelOf, thisYear } from '../lib';
import '../../../shared/module.css';
import '../audit.css';

interface Dash {
  year: number;
  plans: { status: string; statusLabel: string; kind: string; code: string; title: string }[];
  engagements: {
    total: number; byStatus: Record<string, number>; completed: number; late: number; hours: { budget: number; actual: number };
    upcoming: { id: string; code: string; title: string; status: string; statusLabel: string; priority: string; priorityLabel: string; plannedStart: string; plannedEnd: string; leadName: string | null; late: boolean }[];
  };
  actions: {
    total: number; open: number; overdue: number; submitted: number; closed: number; closureRate: number; onTimeRate: number | null; avgDaysToClose: number | null; extended: number;
    aging: { label: string; n: number }[];
    dueSoon: { id: string; code: string; title: string; due: string; unit: string; priority: string; priorityLabel: string; daysLeft: number }[];
    overdueList: { id: string; code: string; title: string; due: string; unit: string; priority: string; priorityLabel: string; daysLate: number }[];
    byUnit: { unit: string; open: number; overdue: number; closed: number }[];
  };
  findings: Record<string, number>;
  risk: {
    heat: { likelihood: number; impact: number; areas: { code: string; name: string }[] }[]; registerAvailable: boolean;
    areas: { total: number; due: number; byLevel: Record<string, number> };
    topAreas: { id: string; code: string; name: string; level: string; levelLabel: string; score: number; priority: number; isDue: boolean; nextDue: string | null }[];
    keyRisks: number; keyRisksCovered: number;
    uncovered: { id: string; code: string; title: string; level: string; levelLabel: string; unitName: string | null }[];
  };
}
const session = useSession();
const year = ref(thisYear());
const data = ref<Dash | null>(null);
const error = ref('');
async function load() {
  try {
    data.value = await api<Dash>(`/audit/dashboard?year=${year.value}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(year, load);
const progress = computed(() => (data.value?.engagements.total ? Math.round((data.value.engagements.completed / data.value.engagements.total) * 100) : 0));
const findingsMax = computed(() => Math.max(1, ...Object.values(data.value?.findings ?? { x: 1 })));
const agingMax = computed(() => Math.max(1, ...(data.value?.actions.aging.map((a) => a.n) ?? [1])));
const unitMax = computed(() => Math.max(1, ...(data.value?.actions.byUnit.map((u) => u.open + u.closed) ?? [1])));
const STATUS_AR: Record<string, string> = { planned: 'مخططة', fieldwork: 'قيد التنفيذ', review: 'مراجعة التقرير', issued: 'متابعة التوصيات', closed: 'مغلقة' };
const master = computed(() => data.value?.plans.find((p) => p.kind === 'master'));
const cellColor = (l: number, i: number) => LEVEL_COLOR[levelOf(undefined, l * i)];
</script>

<template>
  <div>
    <section class="pm-hero au-hero">
      <div>
        <p class="pm-kicker">المراجعة الداخلية المبنية على المخاطر</p>
        <h1>الرقابة في لمحة · {{ year }}</h1>
        <p class="pm-sub">تنفيذ خطة المراجعة، والتوصيات المفتوحة والمتأخرة لدى الجهات، وخريطة المخاطر التي توجّه أولويات المراجعة.</p>
      </div>
      <div class="pm-actions">
        <select v-model.number="year" class="input" style="width: auto"><option v-for="y in [thisYear() - 1, thisYear(), thisYear() + 1]" :key="y" :value="y">{{ y }}</option></select>
        <RouterLink to="/audit/plans" class="btn au-glow">خطط المراجعة</RouterLink>
        <RouterLink to="/audit/actions?status=overdue" class="btn au-ghost">التوصيات المتأخرة</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="data">
      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #6366f1; --i: 0"><span>تنفيذ الخطة</span><strong><CountUp :value="progress" />%</strong><small>{{ data.engagements.completed }} من {{ data.engagements.total }} مهمة · {{ data.engagements.late }} متأخرة</small></div>
        <div class="pm-kpi" style="--a: #0ea5e9; --i: 1"><span>توصيات مفتوحة</span><strong><CountUp :value="data.actions.open" /></strong><small>{{ data.actions.submitted }} بانتظار التحقق من الإغلاق</small></div>
        <div class="pm-kpi" style="--a: #e11d48; --i: 2"><span>توصيات متأخرة</span><strong><CountUp :value="data.actions.overdue" /></strong><small>{{ data.actions.extended }} مُدّد موعدها</small></div>
        <div class="pm-kpi" style="--a: #10b981; --i: 3"><span>نسبة الإغلاق</span><strong><CountUp :value="data.actions.closureRate" />%</strong><small>في الموعد {{ data.actions.onTimeRate ?? '—' }}% · متوسط {{ data.actions.avgDaysToClose ?? '—' }} يوم</small></div>
        <div class="pm-kpi" style="--a: #f97316; --i: 4"><span>مجالات مستحقة المراجعة</span><strong><CountUp :value="data.risk.areas.due" /></strong><small>من {{ data.risk.areas.total }} مجالًا في خريطة المراجعة</small></div>
        <div class="pm-kpi" style="--a: #a855f7; --i: 5"><span>تغطية المخاطر العالية</span><strong v-if="data.risk.registerAvailable"><CountUp :value="data.risk.keyRisksCovered" /> من {{ data.risk.keyRisks }}</strong><strong v-else>—</strong><small>{{ data.risk.registerAvailable ? 'مخاطر مرتفعة وحرجة في سجل المخاطر تغطيها مهام السنة' : 'يظهر عند تفعيل سجل المخاطر' }}</small></div>
      </div>

      <div class="au-grid">
        <section class="card pm-panel">
          <h2>خريطة حرارة مجالات المراجعة <RouterLink to="/audit/universe" class="pm-link" style="font-size: .8rem">التفاصيل</RouterLink></h2>
          <div class="au-heat">
            <template v-for="l in [5, 4, 3, 2, 1]" :key="l">
              <span class="ax">{{ l }}</span>
              <div v-for="i in [1, 2, 3, 4, 5]" :key="i" :class="['cell', { on: data.risk.heat.find((h) => h.likelihood === l && h.impact === i)!.areas.length }]"
                :style="{ '--c': cellColor(l, i), '--i': (5 - l) * 5 + i }" :title="data.risk.heat.find((h) => h.likelihood === l && h.impact === i)!.areas.map((a) => `${a.code} ${a.name}`).join('\n')">
                {{ data.risk.heat.find((h) => h.likelihood === l && h.impact === i)!.areas.length || '' }}
              </div>
            </template>
          </div>
          <div class="au-heat-x"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>
          <div class="au-heat-cap"><span>↑ الاحتمال</span><span>الأثر ←</span></div>
          <div class="pm-legend" style="margin-top: 10px"><span v-for="l in LEVELS" :key="l.value" :style="{ '--c': LEVEL_COLOR[l.value] }">{{ l.label }} {{ data.risk.areas.byLevel[l.value] }}</span></div>
        </section>
        <section class="card pm-panel">
          <h2>الأعلى أولوية للمراجعة</h2>
          <p v-if="!data.risk.topAreas.length" class="pm-empty">لم تُسجَّل مجالات مراجعة بعد</p>
          <div v-for="a in data.risk.topAreas" :key="a.id" style="display: flex; gap: 10px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--border)">
            <span class="au-score" :style="{ '--c': LEVEL_COLOR[a.level] }">{{ a.score }}</span>
            <span style="flex: 1"><b>{{ a.name }}</b><span class="pm-muted">{{ a.code }} · أولوية {{ a.priority }} · {{ a.nextDue ? `المراجعة القادمة ${fmtDate(a.nextDue)}` : 'لم يُراجع من قبل' }}</span></span>
            <span v-if="a.isDue" class="pm-pill" style="--c: #e11d48">مستحق</span>
          </div>
          <template v-if="data.risk.uncovered.length">
            <h2 style="margin-top: 16px">مخاطر عالية غير مغطاة هذه السنة</h2>
            <div v-for="r in data.risk.uncovered" :key="r.id" class="au-risk" :style="{ '--c': LEVEL_COLOR[r.level] ?? '#94a3b8' }"><span class="au-code">{{ r.code }}</span>{{ r.title }}</div>
          </template>
        </section>
      </div>

      <div class="au-grid3">
        <section class="card pm-panel">
          <h2>مهام الخطة حسب المرحلة</h2>
          <div class="au-bars">
            <div v-for="(n, st) in data.engagements.byStatus" :key="st" class="r"><span>{{ STATUS_AR[st] }}</span><i :style="{ width: (n / Math.max(1, data.engagements.total)) * 100 + '%', '--c': STATUS_COLOR[st] }" /><b class="au-num">{{ n }}</b></div>
          </div>
          <p class="pm-muted" style="margin-top: 12px">الساعات: المقدرة {{ data.engagements.hours.budget }} · الفعلية {{ data.engagements.hours.actual }}</p>
          <p v-if="master" class="pm-muted">الخطة الرئيسية {{ master.code }}: <span class="pm-pill" :style="{ '--c': STATUS_COLOR[master.status] }">{{ master.statusLabel }}</span></p>
          <p v-else class="pm-muted">لا توجد خطة رئيسية لهذه السنة. <RouterLink v-if="session.can(P.plans)" to="/audit/plans?new=1" class="pm-link">أنشئها</RouterLink></p>
        </section>
        <section class="card pm-panel">
          <h2>الملاحظات حسب الخطورة</h2>
          <div class="au-bars">
            <div v-for="l in LEVELS" :key="l.value" class="r"><span>{{ l.label }}</span><i :style="{ width: (data.findings[l.value] / findingsMax) * 100 + '%', '--c': LEVEL_COLOR[l.value] }" /><b class="au-num">{{ data.findings[l.value] }}</b></div>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>أعمار التوصيات المتأخرة</h2>
          <div class="au-bars">
            <div v-for="(a, k) in data.actions.aging" :key="a.label" class="r"><span>{{ a.label }}</span><i :style="{ width: (a.n / agingMax) * 100 + '%', '--c': ['#f59e0b', '#f97316', '#ef4444', '#991b1b'][k] }" /><b class="au-num">{{ a.n }}</b></div>
          </div>
        </section>
      </div>

      <div class="au-grid">
        <section class="card pm-panel">
          <h2>التوصيات المتأخرة <RouterLink to="/audit/actions?status=overdue" class="pm-link" style="font-size: .8rem">الكل</RouterLink></h2>
          <p v-if="!data.actions.overdueList.length" class="pm-empty">لا توجد توصيات متأخرة</p>
          <div class="table-wrap" v-else>
            <table class="table">
              <thead><tr><th>التوصية</th><th>الجهة</th><th>الخطورة</th><th>التأخير</th></tr></thead>
              <tbody>
                <tr v-for="a in data.actions.overdueList" :key="a.id" class="au-row" @click="$router.push(`/audit/actions/${a.id}`)">
                  <td><b>{{ a.title }}</b><span class="pm-muted">{{ a.code }} · كان موعدها {{ fmtDate(a.due) }}</span></td>
                  <td>{{ a.unit }}</td>
                  <td><span class="au-lvl" :style="{ '--c': LEVEL_COLOR[a.priority] }">{{ a.priorityLabel }}</span></td>
                  <td class="au-due late">{{ a.daysLate }} يوم</td>
                </tr>
              </tbody>
            </table>
          </div>
          <template v-if="data.actions.dueSoon.length">
            <h2 style="margin-top: 14px">يحين موعدها قريبًا</h2>
            <RouterLink v-for="a in data.actions.dueSoon" :key="a.id" :to="`/audit/actions/${a.id}`" class="au-risk" :style="{ '--c': LEVEL_COLOR[a.priority] }">
              {{ a.title }} <span class="au-due soon">بعد {{ a.daysLeft }} يوم</span>
            </RouterLink>
          </template>
        </section>
        <section class="card pm-panel">
          <h2>التوصيات حسب الجهة المسؤولة</h2>
          <p v-if="!data.actions.byUnit.length" class="pm-empty">لا توجد توصيات بعد</p>
          <div v-for="u in data.actions.byUnit" :key="u.unit" style="margin-bottom: 10px">
            <div style="display: flex; justify-content: space-between; font-size: .86rem"><b>{{ u.unit }}</b><span class="pm-muted">مفتوحة {{ u.open }} · متأخرة {{ u.overdue }} · مغلقة {{ u.closed }}</span></div>
            <div class="pm-bar" :style="{ width: ((u.open + u.closed) / unitMax) * 100 + '%' }">
              <i :style="{ width: (u.closed / Math.max(1, u.open + u.closed)) * 100 + '%', background: '#10b981' }" />
              <i :style="{ width: ((u.open - u.overdue) / Math.max(1, u.open + u.closed)) * 100 + '%', background: '#0ea5e9' }" />
              <i :style="{ width: (u.overdue / Math.max(1, u.open + u.closed)) * 100 + '%', background: '#e11d48' }" />
            </div>
          </div>
          <div class="pm-legend"><span style="--c: #10b981">مغلقة</span><span style="--c: #0ea5e9">مفتوحة</span><span style="--c: #e11d48">متأخرة</span></div>
        </section>
      </div>

      <section class="card pm-panel">
        <h2>مهام المراجعة الجارية والقادمة <RouterLink to="/audit/engagements" class="pm-link" style="font-size: .8rem">كل المهام</RouterLink></h2>
        <p v-if="!data.engagements.upcoming.length" class="pm-empty">لا توجد مهام جارية</p>
        <div class="au-cards">
          <div v-for="(e, k) in data.engagements.upcoming" :key="e.id" class="card au-card" :style="{ '--c': LEVEL_COLOR[e.priority], '--i': k }" @click="$router.push(`/audit/engagements/${e.id}`)">
            <span class="au-code">{{ e.code }}</span>
            <h3>{{ e.title }}</h3>
            <div style="display: flex; gap: 6px; flex-wrap: wrap"><span class="pm-pill" :style="{ '--c': STATUS_COLOR[e.status] }">{{ e.statusLabel }}</span><span class="au-lvl" :style="{ '--c': LEVEL_COLOR[e.priority] }">{{ e.priorityLabel }}</span></div>
            <span class="pm-muted">{{ fmtDate(e.plannedStart) }} ← {{ fmtDate(e.plannedEnd) }} · {{ e.leadName ?? 'بدون قائد' }}</span>
            <span v-if="e.late" class="au-due late">تجاوزت موعدها المخطط</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
