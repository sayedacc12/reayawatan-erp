<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, STATUS_COLOR, thisYear } from '../lib';
import '../../projects/projects.css';
import '../hr.css';

interface Card { id: string; employeeId: string; employeeName: string; employeeNo: number | null; unitName: string; jobTitle: string; status: string; statusLabel: string; objectives: number; competencies: number; finalScore: number | null; rating: string | null }
const session = useSession();
const toast = useToast();
const router = useRouter();
const year = ref(thisYear());
const data = ref<{ cards: Card[]; withoutCard: { id: string; fullName: string }[] } | null>(null);
const error = ref('');
async function load() {
  try {
    data.value = await api(`/hr/performance?year=${year.value}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(year, load);
async function generate() {
  try {
    const r = await api<{ created: number }>(`/hr/performance/generate?year=${year.value}`, { method: 'POST' });
    toast.success(`أُنشئت ${r.created} بطاقة من مؤشرات الوظائف وجداراتها`);
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const stages = computed(() => {
  const c = data.value?.cards ?? [];
  return [
    { k: 'draft', l: 'إعداد الأهداف', n: c.filter((x) => x.status === 'draft').length },
    { k: 'agreed', l: 'بانتظار التقييم', n: c.filter((x) => x.status === 'agreed').length },
    { k: 'evaluated', l: 'بانتظار الاعتماد', n: c.filter((x) => x.status === 'evaluated').length },
    { k: 'approved', l: 'معتمدة', n: c.filter((x) => x.status === 'approved').length },
  ];
});
const filter = ref('all');
const shown = computed(() => (data.value?.cards ?? []).filter((c) => filter.value === 'all' || c.status === filter.value));
const scoreColor = (s: number | null) => (s === null ? '#94a3b8' : s >= 90 ? '#10b981' : s >= 80 ? '#14b8a6' : s >= 70 ? '#6366f1' : s >= 60 ? '#f59e0b' : '#ef4444');
</script>

<template>
  <div>
    <section class="pm-hero hr-hero">
      <div><p class="pm-kicker">الأداء</p><h1>بطاقات الأداء المستهدف والتقييم {{ year }}</h1>
        <p class="pm-sub">كل بطاقة تبدأ من مؤشرات وظيفة الموظف وجداراتها: اتفاق على الأهداف بأوزان مجموعها 100%، ثم تقييم الإنجاز والجدارات، ثم الاعتماد النهائي.</p></div>
      <div class="pm-actions">
        <select v-model.number="year" class="input" style="width: auto"><option v-for="y in [thisYear() - 1, thisYear(), thisYear() + 1]" :key="y" :value="y">{{ y }}</option></select>
        <button v-if="session.can(P.performance) && data?.withoutCard.length" class="btn hr-glow" @click="generate">إنشاء بطاقات لـ {{ data.withoutCard.length }} موظف</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="pm-kpis">
      <button v-for="(s, i) in stages" :key="s.k" class="pm-kpi" :style="{ '--a': STATUS_COLOR[s.k], '--i': i, cursor: 'pointer', textAlign: 'start', font: 'inherit', outline: filter === s.k ? '2px solid ' + STATUS_COLOR[s.k] : '' }" @click="filter = filter === s.k ? 'all' : s.k">
        <span>{{ s.l }}</span><strong>{{ s.n }}</strong>
      </button>
    </div>
    <section class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الموظف</th><th>الوظيفة</th><th>الأهداف</th><th>الجدارات</th><th>النتيجة</th><th>المرحلة</th></tr></thead>
          <tbody>
            <tr v-for="c in shown" :key="c.id" class="hr-row-click" @click="router.push(`/hr/performance/${c.id}`)">
              <td><b>{{ c.employeeName }}</b><span class="pm-muted">{{ c.unitName }}</span></td><td>{{ c.jobTitle }}</td><td>{{ c.objectives }}</td><td>{{ c.competencies }}</td>
              <td><b :style="{ color: scoreColor(c.finalScore) }">{{ c.finalScore ?? '—' }}</b><span v-if="c.rating" class="pm-muted">{{ c.rating }}</span></td>
              <td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[c.status] }">{{ c.statusLabel }}</span></td>
            </tr>
            <tr v-if="!shown.length"><td colspan="6" class="pm-empty">لا توجد بطاقات</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
