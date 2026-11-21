<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import CountUp from '../../../shared/CountUp.vue';
import ScoreRing from '../components/ScoreRing.vue';
import Trend from '../components/Trend.vue';
import { EFFORT, fmtDate, gradeOf, LEVELS, num, OBL_STATE, P, scoreColor, STATUS, type Axis, type Opportunity } from '../lib';
import '../../../shared/module.css';
import '../gov.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const router = useRouter();
const d = ref<any>(null);
const error = ref('');
onMounted(async () => {
  try {
    d.value = await api('/governance/dashboard');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const axisColor = (a: Axis) => scoreColor(a.score);
</script>

<template>
  <div>
    <section class="pm-hero gv-hero">
      <div>
        <p class="pm-kicker">الحوكمة</p>
        <h1>وضع الشركة قبل التقييم الرسمي</h1>
        <p class="pm-sub">تقييم ذاتي دوري وفق أدلة حوكمة الجمعيات الأهلية الصادرة عن المركز الوطني لتنمية القطاع غير الربحي، مع مؤشرات السلامة المالية من الدفاتر مباشرة، وإنذار مبكر قبل المواعيد والمخالفات.</p>
      </div>
      <div class="pm-actions">
        <RouterLink v-if="d?.current" :to="`/governance/assessments/${d.current.id}`" class="btn gv-glow">متابعة التقييم الحالي</RouterLink>
        <RouterLink v-else-if="session.can(P.assess)" to="/governance/assessments" class="btn gv-glow">ابدأ أول تقييم</RouterLink>
        <RouterLink to="/governance/alerts" class="btn gv-ghost">الإنذار المبكر <b v-if="d?.alerts.counts.critical">({{ d.alerts.counts.critical }})</b></RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="d">
      <div v-if="!d.accounting.years" class="gv-warn" style="margin-bottom: 14px">النظام المالي غير مهيأ بعد، لذا لن تُحسب مؤشرات الأداء المالي آلياً. ثبّت دليل الحسابات الموحد وافتح السنة المالية، أو أدخل الأرقام يدوياً في التقييم.</div>

      <div class="gv-grid">
        <section class="card pm-panel" style="display: grid; grid-template-columns: auto 1fr; gap: 20px; align-items: center">
          <div style="text-align: center">
            <ScoreRing :value="d.score?.overall ?? null" :predicted="d.score?.predicted ?? null" :size="170" label="الدرجة الحالية" :sub="d.score ? gradeOf(d.score.overall).label : 'لا يوجد تقييم'" />
            <div v-if="d.current" class="pm-muted" style="margin-top: 6px"><span class="gv-code">{{ d.current.code }}</span> · <span class="gv-pill" :style="{ '--c': STATUS[d.current.status].color }">{{ d.current.statusLabel }}</span></div>
          </div>
          <div>
            <h2 style="margin-bottom: 4px">الدرجة الكلية والمتوقعة</h2>
            <p v-if="d.score" class="pm-muted" style="margin: 0 0 14px">
              المتوقع عند التقييم الفعلي <b class="gv-num" :style="{ color: scoreColor(d.score.predicted) }">{{ num(d.score.predicted) }}%</b> ({{ d.score.predictedGrade }})،
              والمستهدف {{ d.target }}%. اكتمال الإجابة {{ num(d.score.coverage) }}%.
            </p>
            <div v-if="d.score" class="gv-axes">
              <div v-for="a in d.score.axes" :key="a.code" class="gv-axis" :style="{ '--c': axisColor(a) }">
                <span>{{ a.title }} <span class="pm-muted">({{ a.weight }}%)</span></span>
                <div class="bar"><i class="p" :style="{ width: `${a.predicted}%` }" /><i :style="{ width: `${a.score}%` }" /><span class="t" :style="{ insetInlineStart: `${d.target}%` }" /></div>
                <b>{{ num(a.score) }}%</b>
              </div>
            </div>
            <p v-else class="pm-empty">ابدأ تقييماً ذاتياً لتظهر درجة الشركة.</p>
          </div>
        </section>

        <section class="card pm-panel">
          <h2>الإنذار المبكر
            <span><span class="gv-pill" :style="{ '--c': LEVELS.critical.color }">{{ d.alerts.counts.critical }} حرج</span> <span class="gv-pill" :style="{ '--c': LEVELS.warning.color }">{{ d.alerts.counts.warning }} تحذير</span></span>
          </h2>
          <p v-if="!d.alerts.top.length" class="pm-empty">لا توجد إنذارات قائمة</p>
          <div class="gv-alerts">
            <RouterLink v-for="(a, i) in d.alerts.top" :key="a.key" :to="a.link ?? '/governance/alerts'" :class="['gv-alert', a.level]" :style="{ '--c': LEVELS[a.level].color, '--i': i }">
              <span class="dot" /><div><h4>{{ a.title }}</h4><p v-if="a.due">{{ fmtDate(a.due) }}</p></div><span class="gv-code">{{ a.ref }}</span>
            </RouterLink>
          </div>
          <RouterLink to="/governance/alerts" class="pm-link" style="display: inline-block; margin-top: 10px">كل الإنذارات</RouterLink>
        </section>
      </div>

      <div class="pm-kpis" style="margin-top: 16px">
        <div class="pm-kpi" style="--a: #10b981; --i: 0"><span>الأداء المالي (المتوقع للسنة)</span><strong><template v-if="d.finance"><CountUp :value="d.finance.forecast" :decimals="1" />%</template><template v-else>—</template></strong><small v-if="d.finance">الفعلي حتى اليوم {{ num(d.finance.actual) }}% · مضى {{ num(d.finance.elapsed) }}% من السنة</small></div>
        <div class="pm-kpi" style="--a: #eab308; --i: 1"><span>فرص التحسين</span><strong><CountUp :value="d.opportunitiesCount" /></strong><small>أعلاها أثراً {{ d.opportunities[0] ? `+${num(d.opportunities[0].impact, 2)}` : '—' }} درجة</small></div>
        <div class="pm-kpi" style="--a: #0ea5e9; --i: 2"><span>إجراءات التحسين المفتوحة</span><strong><CountUp :value="d.actions.open" /></strong><small>{{ d.actions.done }} منجز · {{ d.actions.overdue }} متأخر · أثر متوقع +{{ num(d.actions.expectedGain, 2) }}</small></div>
        <div class="pm-kpi" style="--a: #a78bfa; --i: 3"><span>التزامات قادمة</span><strong><CountUp :value="d.upcoming.length" /></strong><small>{{ d.upcoming[0] ? `أقربها ${fmtDate(d.upcoming[0].dueDate)}` : 'لا توجد' }}</small></div>
      </div>

      <div class="gv-grid">
        <section class="card pm-panel">
          <h2>أعلى فرص التحسين أثراً <RouterLink to="/governance/actions" class="pm-link" style="font-size: .8rem">خطة التحسين</RouterLink></h2>
          <p v-if="!d.opportunities.length" class="pm-empty">لا توجد فرص تحسين: كل البنود متحققة</p>
          <table v-else class="table">
            <tbody><tr v-for="o in (d.opportunities as Opportunity[])" :key="o.code">
              <td><span class="gv-num" style="color: #059669">+{{ num(o.impact, 2) }}</span></td>
              <td style="white-space: normal"><span class="gv-code">{{ o.code }}</span> {{ o.title }}<div class="pm-muted">{{ o.practice ?? o.indicator }} · {{ EFFORT[o.effort] }}</div></td>
            </tr></tbody>
          </table>
        </section>
        <section class="card pm-panel">
          <h2>مسار الأداء المالي <RouterLink to="/governance/finance" class="pm-link" style="font-size: .8rem">التفاصيل</RouterLink></h2>
          <template v-if="d.finance">
            <Trend :points="d.finance.series" :projected="d.finance.projected" :months-left="d.finance.monthsLeft" />
            <p class="pm-muted">الخط المنقط امتداد الاتجاه الحالي لنهاية السنة: {{ d.finance.projected == null ? '—' : `${num(d.finance.projected)}%` }}.</p>
            <div class="gv-sec">المؤشرات الرئيسية</div>
            <div class="gv-axes">
              <div v-for="i in d.finance.indicators" :key="i.code" class="gv-axis" :style="{ '--c': scoreColor(i.score) }">
                <span><span class="gv-code">{{ i.code }}</span> {{ i.title.replace('مؤشر ', '') }}</span>
                <div class="bar"><i :style="{ width: `${i.score}%` }" /></div><b>{{ num(i.score) }}%</b>
              </div>
            </div>
          </template>
          <p v-else class="pm-empty">لا توجد بيانات مالية</p>
        </section>
        <section class="card pm-panel">
          <h2>تطور التقييمات</h2>
          <p v-if="!d.history.length" class="pm-empty">لا توجد تقييمات سابقة</p>
          <table v-else class="table">
            <thead><tr><th>التقييم</th><th>نهاية الفترة</th><th>الامتثال</th><th>الشفافية</th><th>السلامة المالية</th><th>الكلية</th></tr></thead>
            <tbody><tr v-for="h in d.history" :key="h.id" class="gv-row" @click="router.push(`/governance/assessments/${h.id}`)">
              <td><span class="gv-code">{{ h.code }}</span> <span class="pm-muted">{{ h.kindLabel }}</span></td><td>{{ fmtDate(h.periodTo) }}</td>
              <td v-for="a in h.axes" :key="a.code" class="gv-num" :style="{ color: scoreColor(a.score) }">{{ num(a.score) }}</td>
              <td class="gv-num" :style="{ color: scoreColor(h.overall) }">{{ num(h.overall) }}</td>
            </tr></tbody>
          </table>
        </section>
        <section class="card pm-panel">
          <h2>الالتزامات القادمة <RouterLink to="/governance/calendar" class="pm-link" style="font-size: .8rem">التقويم</RouterLink></h2>
          <p v-if="!d.upcoming.length" class="pm-empty">لا توجد التزامات قادمة</p>
          <table v-else class="table">
            <tbody><tr v-for="o in d.upcoming" :key="o.id">
              <td><span class="gv-pill" :style="{ '--c': OBL_STATE[o.state].color }">{{ OBL_STATE[o.state].label }}</span></td>
              <td style="white-space: normal">{{ o.title }}<div class="pm-muted">{{ fmtDate(o.dueDate) }} · {{ o.daysLeft >= 0 ? `بعد ${o.daysLeft} يوماً` : `متأخر ${-o.daysLeft} يوماً` }}</div></td>
            </tr></tbody>
          </table>
        </section>
      </div>
    </template>
  </div>
</template>
