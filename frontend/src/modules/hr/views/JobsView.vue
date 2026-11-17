<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { P, STATUS_COLOR, type JobRow } from '../lib';
import '../../projects/projects.css';
import '../hr.css';

const session = useSession();
const router = useRouter();
const rows = ref<JobRow[]>([]);
const error = ref('');
const search = ref('');
const status = ref('all');
onMounted(async () => {
  try {
    rows.value = await api<JobRow[]>('/hr/jobs');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const shown = computed(() => rows.value.filter((r) => (status.value === 'all' || r.status === status.value) && (!search.value || r.title.includes(search.value) || r.unitName.includes(search.value) || r.code.includes(search.value.toUpperCase()))));
const totals = computed(() => ({ headcount: rows.value.reduce((s, r) => s + r.headcount, 0), filled: rows.value.reduce((s, r) => s + r.filled, 0) }));
</script>

<template>
  <div>
    <section class="pm-hero hr-hero">
      <div><p class="pm-kicker">التنظيم والتخطيط</p><h1>الوظائف والأوصاف الوظيفية</h1>
        <p class="pm-sub">لكل وظيفة وصف معتمد بكود جودة ورقم إصدار: المهام والمؤهلات والجدارات المطلوبة ومؤشرات الأداء التي تبدأ منها بطاقة الأداء.</p></div>
      <div class="pm-actions"><RouterLink v-if="session.can(P.jobs)" to="/hr/jobs/new" class="btn hr-glow">وظيفة جديدة</RouterLink></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #a78bfa; --i: 0"><span>الوظائف</span><strong>{{ rows.length }}</strong><small>{{ rows.filter((r) => r.status === 'approved').length }} معتمدة</small></div>
      <div class="pm-kpi" style="--a: #14b8a6; --i: 1"><span>الشواغر المعتمدة</span><strong>{{ totals.headcount }}</strong><small>{{ totals.filled }} مشغولة</small></div>
      <div class="pm-kpi" style="--a: #f472b6; --i: 2"><span>الشواغر المتاحة</span><strong>{{ Math.max(totals.headcount - totals.filled, 0) }}</strong><small>تُخطط من خطط التعيين</small></div>
    </div>
    <section class="card pm-panel">
      <div class="hr-toolbar">
        <div class="hr-tabs" style="margin: 0">
          <button v-for="t in [{ v: 'all', l: 'الكل' }, { v: 'approved', l: 'معتمدة' }, { v: 'draft', l: 'مسودة' }]" :key="t.v" :class="['hr-tab', { on: status === t.v }]" @click="status = t.v">{{ t.l }}</button>
        </div>
        <span class="grow" /><input v-model="search" class="input" placeholder="ابحث بالمسمى أو الوحدة" />
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الكود</th><th>المسمى</th><th>الوحدة</th><th>المرتبة</th><th>ترتبط بـ</th><th>تحميل الراتب</th><th>الشواغر</th><th>الجودة</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="r in shown" :key="r.id" class="hr-row-click" :style="{ opacity: r.isActive ? 1 : .55 }" @click="router.push(`/hr/jobs/${r.id}`)">
              <td class="hr-code">{{ r.code }}</td><td><b>{{ r.title }}</b><span class="pm-muted">{{ r.kpis }} مؤشرات · {{ r.competencies }} جدارات</span></td>
              <td>{{ r.unitName }}</td><td>{{ r.gradeName ?? '—' }}</td><td>{{ r.reportsToTitle ?? '—' }}</td><td>{{ r.expenseProfileName ?? '—' }}</td>
              <td class="hr-num">{{ r.filled }} / {{ r.headcount }}<span v-if="r.vacancies" class="pm-muted">{{ r.vacancies }} شاغر</span></td>
              <td><span class="hr-code">{{ r.qualityCode }}</span><span class="pm-muted">Rev.{{ String(r.revision).padStart(2, '0') }}</span></td>
              <td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[r.status] }">{{ r.status === 'approved' ? 'معتمد' : 'مسودة' }}</span></td>
            </tr>
            <tr v-if="!shown.length"><td colspan="9" class="pm-empty">لا توجد وظائف</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
