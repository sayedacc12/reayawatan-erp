<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import CountUp from '../../../shared/CountUp.vue';
import PerformanceTable from '../components/PerformanceTable.vue';
import ScoreRing from '../components/ScoreRing.vue';
import Trend from '../components/Trend.vue';
import { fmtDate, loadCatalog, money, num, todayStr, type FigureDef, type PerformanceResult } from '../lib';
import '../../../shared/module.css';
import '../gov.css';

interface Snapshot {
  year: { name: number; startDate: string; endDate: string }; from: string; to: string; elapsed: number;
  figures: Record<string, number>; annualized: Record<string, number>; actual: PerformanceResult; forecast: PerformanceResult;
  breakdown: Record<string, { code: string; name: string; amount: number }[]>;
}
interface Series { points: { month: string; score: number }[]; slope: number; projected: number | null; monthsLeft: number }
const data = ref<{ ready: { chart: boolean; years: number }; snapshot: Snapshot | null; series: Series | null } | null>(null);
const figures = ref<FigureDef[]>([]);
const to = ref(todayStr());
const open = ref<string | null>(null);
const error = ref('');
async function load() {
  try {
    data.value = await api(`/governance/finance?to=${to.value}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  figures.value = (await loadCatalog()).figures;
  await load();
});
</script>

<template>
  <div>
    <section class="pm-hero gv-hero">
      <div>
        <p class="pm-kicker">السلامة المالية</p>
        <h1>مؤشرات الأداء المالي من الدفاتر مباشرة</h1>
        <p class="pm-sub">تُحسب المؤشرات الخمسة ومؤشراتها التحليلية الأحد عشر بمعادلات دليل السلامة المالية، من القيود المرحّلة على دليل الحسابات الموحد، مع تقدير أداء السنة كاملة واتجاهه الشهري.</p>
      </div>
      <div class="pm-actions" style="align-items: center">
        <label style="color: #fff; font-size: .84rem">حتى تاريخ <input v-model="to" type="date" class="input" style="width: auto" @change="load" /></label>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="data && !data.snapshot" class="gv-warn">النظام المالي غير مهيأ أو لا توجد سنة مالية تغطي التاريخ. ثبّت دليل الحسابات الموحد وافتح السنة المالية من النظام المالي.</div>
    <template v-if="data?.snapshot">
      <div class="gv-grid">
        <section class="card pm-panel" style="display: flex; gap: 24px; align-items: center; flex-wrap: wrap">
          <ScoreRing :value="data.snapshot.forecast.score" :size="150" label="المتوقع لنهاية السنة" />
          <ScoreRing :value="data.snapshot.actual.score" :size="120" label="الفعلي حتى التاريخ" />
          <div class="pm-muted" style="flex: 1; min-width: 200px; line-height: 1.9">
            السنة المالية {{ data.snapshot.year.name }} · من {{ fmtDate(data.snapshot.from) }} إلى {{ fmtDate(data.snapshot.to) }} · مضى {{ num(data.snapshot.elapsed) }}% من السنة.
            <br />تُقدَّر الحركات (الإيرادات والمصروفات) لسنة كاملة بنسبة ما مضى، وتبقى الأرصدة كما هي في التاريخ.
            <br />الدرجة هنا قبل معامل رأي المحاسب القانوني الذي يُطبَّق في التقييم.
          </div>
        </section>
        <section class="card pm-panel">
          <h2>الاتجاه الشهري <span class="gv-pill" :style="{ '--c': (data.series?.slope ?? 0) >= 0 ? '#10b981' : '#ef4444' }">{{ (data.series?.slope ?? 0) >= 0 ? '+' : '' }}{{ num(data.series?.slope, 2) }} شهرياً</span></h2>
          <Trend v-if="data.series" :points="data.series.points" :projected="data.series.projected" :months-left="data.series.monthsLeft" />
          <p class="pm-muted">كل نقطة: الدرجة المتوقعة للسنة بناءً على الحركة حتى نهاية الشهر. الخط المنقط امتداد الاتجاه: {{ data.series?.projected == null ? '—' : `${num(data.series.projected)}%` }}.</p>
        </section>
      </div>
      <div class="pm-kpis" style="margin-top: 16px">
        <div v-for="(m, i) in data.snapshot.forecast.indicators" :key="m.code" class="pm-kpi" :style="{ '--a': m.score >= 80 ? '#10b981' : m.score >= 50 ? '#f59e0b' : '#ef4444', '--i': i }">
          <span>{{ m.title }}</span><strong><CountUp :value="m.score" :decimals="1" />%</strong><small>الوزن {{ m.weight }}% · الفعلي {{ num(data.snapshot.actual.indicators[i].score) }}%</small>
        </div>
      </div>
      <div class="gv-grid">
        <section class="card pm-panel">
          <h2>المؤشرات التحليلية (المتوقع لنهاية السنة)</h2>
          <PerformanceTable :actual="data.snapshot.forecast" :forecast="null" />
        </section>
        <section class="card pm-panel">
          <h2>الأرقام المستخرجة من الدفاتر <RouterLink to="/governance/settings" class="pm-link" style="font-size: .8rem">ربط الحسابات</RouterLink></h2>
          <table class="table">
            <thead><tr><th>الرقم</th><th>حتى التاريخ</th><th>المقدّر للسنة</th></tr></thead>
            <tbody>
              <template v-for="f in figures" :key="f.key">
                <tr class="gv-row" @click="open = open === f.key ? null : f.key">
                  <td style="white-space: normal">{{ f.label }}<div class="pm-muted">{{ f.kind === 'balance' ? 'رصيد' : 'حركة' }} · اضغط لعرض الحسابات</div></td>
                  <td class="pm-money">{{ money(data.snapshot.figures[f.key]) }}</td>
                  <td class="pm-money">{{ money(data.snapshot.annualized[f.key]) }}</td>
                </tr>
                <tr v-if="open === f.key"><td colspan="3">
                  <p v-if="!data.snapshot.breakdown[f.key]?.length" class="pm-muted">لا توجد أرصدة على الحسابات المربوطة.</p>
                  <div v-for="b in data.snapshot.breakdown[f.key]" :key="b.code" style="display: flex; justify-content: space-between; font-size: .82rem"><span><span class="gv-code">{{ b.code }}</span> {{ b.name }}</span><span class="pm-money">{{ money(b.amount) }}</span></div>
                </td></tr>
              </template>
            </tbody>
          </table>
        </section>
      </div>
    </template>
  </div>
</template>
