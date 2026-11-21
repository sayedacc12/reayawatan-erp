<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import CountUp from '../../../shared/CountUp.vue';
import { LEVEL_COLOR, P, STATUS_COLOR, fmtDate, num } from '../lib';
import '../../../shared/module.css';
import '../quality.css';

interface Dash {
  year: number;
  kpis: {
    documents: number; approvedDocs: number; openNcr: number; closureRate: number | null; satisfaction: number | null; complaintsOpen: number;
    objectivesAchieved: number; objectivesTotal: number; highRisks: number; auditsDone: number; auditsPlanned: number; compliance: number;
  };
  alerts: { level: 'danger' | 'warning' | 'info'; text: string; path: string }[];
  ncrByStatus: { label: string; count: number }[];
  objectives: { id: string; title: string; kpi: string; unit: string; target: number; current: number | null; progress: number | null; status: string; statusLabel: string }[];
  heat: number[][];
  sections: { code: string; title: string; score: number }[];
  lastReview: { id: string; title: string; meetingDate: string; status: string } | null;
}
const session = useSession();
const data = ref<Dash | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    data.value = await api<Dash>('/quality/dashboard');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const LEVEL = { danger: '#ef4444', warning: '#f59e0b', info: '#6366f1' };
const ringColor = (v: number) => (v >= 80 ? '#10b981' : v >= 50 ? '#f59e0b' : '#ef4444');
const heatColor = (l: number, i: number) => LEVEL_COLOR[l * i >= 15 ? 'high' : l * i >= 8 ? 'medium' : 'low'];
</script>

<template>
  <div>
    <section class="pm-hero q-hero">
      <div>
        <p class="pm-kicker">نظام إدارة الجودة · ISO 9001:2015</p>
        <h1>الجودة في لمحة</h1>
        <p class="pm-sub">الوثائق والإجراءات، المراجعات وحالات عدم المطابقة، المخاطر والأهداف، ورضا العملاء: كل متطلبات المواصفة من البند 4 إلى 10 في مكان واحد.</p>
      </div>
      <div class="pm-actions">
        <RouterLink v-if="session.can(P.ncr)" to="/quality/ncr?new=1" class="btn q-glow">تسجيل عدم مطابقة</RouterLink>
        <RouterLink v-if="session.can(P.feedback)" to="/quality/complaints?new=1" class="btn q-ghost">تسجيل شكوى</RouterLink>
        <RouterLink to="/quality/standard" class="btn q-ghost">متطلبات المواصفة</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="data">
      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #10b981; --i: 0"><span>نسبة تغطية متطلبات المواصفة</span><strong><CountUp :value="data.kpis.compliance" />%</strong><small>من أدلة النظام الفعلية</small></div>
        <div class="pm-kpi" style="--a: #0ea5e9; --i: 1"><span>الوثائق المضبوطة</span><strong><CountUp :value="data.kpis.documents" /></strong><small>{{ data.kpis.approvedDocs }} معتمدة سارية</small></div>
        <div class="pm-kpi" style="--a: #ef4444; --i: 2"><span>حالات عدم مطابقة مفتوحة</span><strong><CountUp :value="data.kpis.openNcr" /></strong><small>نسبة الإغلاق {{ num(data.kpis.closureRate) }}%</small></div>
        <div class="pm-kpi" style="--a: #c7a27a; --i: 3"><span>مؤشر رضا العملاء</span><strong>{{ data.kpis.satisfaction === null ? '—' : '' }}<CountUp v-if="data.kpis.satisfaction !== null" :value="data.kpis.satisfaction" :decimals="1" />{{ data.kpis.satisfaction === null ? '' : '%' }}</strong><small>من استبانات {{ data.year }}</small></div>
        <div class="pm-kpi" style="--a: #f97316; --i: 4"><span>شكاوى قيد المعالجة</span><strong><CountUp :value="data.kpis.complaintsOpen" /></strong><small>من كل القنوات</small></div>
        <div class="pm-kpi" style="--a: #8b5cf6; --i: 5"><span>أهداف الجودة المحققة</span><strong><CountUp :value="data.kpis.objectivesAchieved" /> / {{ data.kpis.objectivesTotal }}</strong><small>المراجعات المنفذة {{ data.kpis.auditsDone }} من {{ data.kpis.auditsPlanned }}</small></div>
      </div>

      <div class="q-grid">
        <section class="card pm-panel">
          <h2>تنبيهات تحتاج متابعة <span class="pm-tag">{{ data.alerts.length }}</span></h2>
          <p v-if="!data.alerts.length" class="pm-empty">لا توجد تنبيهات، النظام في وضع جيد</p>
          <div class="q-alerts">
            <RouterLink v-for="(a, i) in data.alerts" :key="i" :to="a.path" :class="['q-alert', a.level]" :style="{ '--c': LEVEL[a.level], '--i': i }">
              <span class="dot" /><span style="flex: 1">{{ a.text }}</span>
            </RouterLink>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>تغطية بنود المواصفة</h2>
          <div class="q-ring" :style="{ '--v': data.kpis.compliance, '--c': ringColor(data.kpis.compliance) }"><div><b>{{ data.kpis.compliance }}%</b><small>البنود 4 إلى 10</small></div></div>
          <div class="q-sections" style="margin-top: 12px">
            <RouterLink v-for="(s, i) in data.sections" :key="s.code" to="/quality/standard" class="q-secbox" :style="{ '--i': i }">
              <div class="q-ring sm" :style="{ '--v': s.score, '--c': ringColor(s.score) }"><b>{{ s.score }}%</b></div>
              <div class="t">{{ s.code }}. {{ s.title }}</div>
            </RouterLink>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>أهداف الجودة {{ data.year }} <RouterLink to="/quality/objectives" class="pm-link" style="font-size: .8rem">كل الأهداف</RouterLink></h2>
          <p v-if="!data.objectives.length" class="pm-empty">لا توجد أهداف لهذا العام</p>
          <div v-for="o in data.objectives" :key="o.id" style="margin-bottom: 12px">
            <div style="display: flex; justify-content: space-between; gap: 8px; font-size: .86rem">
              <b>{{ o.title }}</b><span class="pm-pill" :style="{ '--c': STATUS_COLOR[o.status] }">{{ o.statusLabel }}</span>
            </div>
            <div class="pm-muted">{{ o.kpi }}: {{ num(o.current) }} {{ o.unit }} من {{ num(o.target) }} {{ o.unit }}</div>
            <div class="q-progress"><i :style="{ width: (o.progress ?? 0) + '%', '--c': STATUS_COLOR[o.status] }" /></div>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>خريطة المخاطر <RouterLink to="/quality/risks" class="pm-link" style="font-size: .8rem">السجل</RouterLink></h2>
          <div class="q-heat">
            <template v-for="(row, r) in data.heat" :key="r">
              <span class="ax">{{ 5 - r }}</span>
              <span v-for="(n, c) in row" :key="c" :class="['cell', { zero: !n }]" :style="{ '--c': heatColor(5 - r, c + 1), '--i': r * 5 + c }">{{ n }}</span>
            </template>
            <span /><span v-for="i in 5" :key="'x' + i" class="ax">{{ i }}</span>
          </div>
          <div class="q-heat-cap"><span>↑ الاحتمال</span><span>الأثر ←</span></div>
          <h2 style="margin-top: 16px">عدم المطابقة حسب المرحلة</h2>
          <p v-if="!data.ncrByStatus.length" class="pm-muted">لا توجد حالات مفتوحة</p>
          <div class="q-chips"><RouterLink v-for="s in data.ncrByStatus" :key="s.label" to="/quality/ncr" class="q-chip">{{ s.label }} <b>{{ s.count }}</b></RouterLink></div>
          <p v-if="data.lastReview" class="pm-muted" style="margin-top: 14px">آخر مراجعة إدارة: <RouterLink :to="`/quality/reviews/${data.lastReview.id}`" class="pm-link">{{ data.lastReview.title }}</RouterLink> · {{ fmtDate(data.lastReview.meetingDate) }}</p>
        </section>
      </div>
    </template>
  </div>
</template>
