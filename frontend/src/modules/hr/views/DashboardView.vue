<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import CountUp from '../../../shared/CountUp.vue';
import { P, fmtDate, hijri, sar } from '../lib';
import '../../../shared/module.css';
import '../hr.css';

interface Alert { kind: string; level: 'danger' | 'warning' | 'info'; text: string; employeeId?: string; date?: string | null }
interface Dash {
  headcount: number; saudi: number; nonSaudi: number; saudization: number; female: number; male: number; byUnit: { unit: string; n: number }[];
  vacancies: number; pendingLeaves: number; onLeave: number; draftJobs: number; pendingPlans: number; newHires: number;
  performance: { year: number; cards: number; approved: number; awaitingApproval: number; average: number | null };
  payroll: { gross: number; gosiEmployer: number; employerCost: number } | null; alerts: Alert[]; alertsTotal: number;
}
const session = useSession();
const data = ref<Dash | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    data.value = await api<Dash>('/hr/dashboard');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const topUnit = computed(() => Math.max(1, ...(data.value?.byUnit.map((u) => u.n) ?? [1])));
const LEVEL = { danger: '#ef4444', warning: '#f59e0b', info: '#6366f1' };
const ICON: Record<string, string> = { contract: 'العقد', probation: 'التجربة', id: 'الهوية', passport: 'الجواز', qiwa: 'قوى', gosi: 'التأمينات' };
</script>

<template>
  <div>
    <section class="pm-hero hr-hero">
      <div>
        <p class="pm-kicker">الموارد البشرية</p>
        <h1>فريق الجمعية في لمحة</h1>
        <p class="pm-sub">الهيكل والوظائف والرواتب والإجازات والأداء في مكان واحد، وفق لائحة الجمعية ونظام العمل السعودي.</p>
      </div>
      <div class="pm-actions">
        <RouterLink v-if="session.can(P.employees)" to="/hr/employees?new=1" class="btn hr-glow">موظف جديد</RouterLink>
        <RouterLink v-if="session.can(P.leaves)" to="/hr/leaves?new=1" class="btn hr-ghost">طلب إجازة</RouterLink>
        <RouterLink to="/hr/structure" class="btn hr-ghost">الهيكل التنظيمي</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="data">
      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #a78bfa; --i: 0"><span>الموظفون</span><strong><CountUp :value="data.headcount" /></strong><small>{{ data.newHires }} تعيين خلال 90 يومًا</small></div>
        <div class="pm-kpi" style="--a: #14b8a6; --i: 1"><span>نسبة التوطين (تقريبية)</span><strong><CountUp :value="data.saudization" :decimals="1" />%</strong><small>{{ data.saudi }} سعودي · {{ data.nonSaudi }} غير سعودي</small></div>
        <div class="pm-kpi" style="--a: #f472b6; --i: 2"><span>الشواغر المعتمدة</span><strong><CountUp :value="data.vacancies" /></strong><small>حسب الأوصاف الوظيفية</small></div>
        <div class="pm-kpi" style="--a: #f59e0b; --i: 3"><span>إجازات بانتظار الاعتماد</span><strong><CountUp :value="data.pendingLeaves" /></strong><small>{{ data.onLeave }} في إجازة اليوم</small></div>
        <div v-if="data.payroll" class="pm-kpi" style="--a: #0ea5e9; --i: 4"><span>إجمالي الرواتب الشهرية</span><strong><CountUp :value="data.payroll.gross" /></strong><small>ريال · قبل الاستقطاعات</small></div>
        <div v-if="data.payroll" class="pm-kpi" style="--a: #ef4444; --i: 5"><span>التكلفة الشهرية الكاملة</span><strong><CountUp :value="data.payroll.employerCost" /></strong><small>مع التأمينات ومخصص نهاية الخدمة</small></div>
      </div>

      <div class="hr-grid">
        <section class="card pm-panel">
          <h2>التنبيهات <span class="pm-tag">{{ data.alertsTotal }}</span></h2>
          <p v-if="!data.alerts.length" class="pm-empty">لا توجد تنبيهات، كل شيء على ما يرام</p>
          <div class="hr-alerts">
            <RouterLink v-for="(a, i) in data.alerts" :key="i" :to="a.employeeId ? `/hr/employees/${a.employeeId}` : '/hr'" :class="['hr-alert', a.level]" :style="{ '--c': LEVEL[a.level], '--i': i }">
              <span class="dot" />
              <span style="flex: 1">{{ a.text }}<span v-if="a.date" class="pm-muted">{{ fmtDate(a.date) }} · {{ hijri(a.date) }}</span></span>
              <span class="pm-tag">{{ ICON[a.kind] ?? a.kind }}</span>
            </RouterLink>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>التوطين والتنوع</h2>
          <div class="hr-donut" :style="{ '--v': data.saudization }"><b>{{ Math.round(data.saudization) }}%</b></div>
          <div class="pm-legend" style="justify-content: center"><span style="--c: #14b8a6">سعوديون {{ data.saudi }}</span><span style="--c: #f472b6">غير سعوديين {{ data.nonSaudi }}</span></div>
          <p class="pm-muted" style="text-align: center; margin-top: 10px">رجال {{ data.male }} · نساء {{ data.female }}</p>
          <p class="pm-muted" style="text-align: center">نطاقات تحسب بعض الفئات بنسب مختلفة، فهذه النسبة للاسترشاد فقط.</p>
        </section>
        <section class="card pm-panel">
          <h2>الموظفون حسب الوحدة</h2>
          <p v-if="!data.byUnit.length" class="pm-empty">لا يوجد موظفون بعد</p>
          <div class="hr-bars">
            <div v-for="(u, i) in data.byUnit" :key="u.unit" class="r"><span>{{ u.unit }}</span><i :style="{ width: (u.n / topUnit) * 100 + '%', animationDelay: i * 60 + 'ms' }" /><b class="hr-num">{{ u.n }}</b></div>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>الأداء {{ data.performance.year }}</h2>
          <dl class="pm-dl">
            <div><dt>بطاقات الأداء</dt><dd>{{ data.performance.cards }}</dd></div>
            <div><dt>معتمدة</dt><dd>{{ data.performance.approved }}</dd></div>
            <div><dt>بانتظار الاعتماد</dt><dd>{{ data.performance.awaitingApproval }}</dd></div>
            <div><dt>متوسط النتيجة</dt><dd>{{ data.performance.average ?? '—' }}</dd></div>
          </dl>
          <h2 style="margin-top: 16px">بانتظار إجراء</h2>
          <div class="hr-chips">
            <RouterLink to="/hr/jobs" class="hr-chip">أوصاف وظيفية مسودة <b>{{ data.draftJobs }}</b></RouterLink>
            <RouterLink to="/hr/plans" class="hr-chip">خطط تعيين للاعتماد <b>{{ data.pendingPlans }}</b></RouterLink>
            <RouterLink to="/hr/leaves" class="hr-chip">إجازات للاعتماد <b>{{ data.pendingLeaves }}</b></RouterLink>
          </div>
          <p v-if="data.payroll" class="pm-muted" style="margin-top: 14px">حصة الجمعية في التأمينات شهريًا: <b>{{ sar(data.payroll.gosiEmployer) }}</b></p>
        </section>
      </div>
    </template>
  </div>
</template>
