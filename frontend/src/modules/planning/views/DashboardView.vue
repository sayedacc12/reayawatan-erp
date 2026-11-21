<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import MiniBar from '../components/MiniBar.vue';
import ProgressRing from '../components/ProgressRing.vue';
import { BAND, errMsg, EXEC, fmtDate, money, P, pct, WF_STATUS } from '../lib';
import '../../../shared/module.css';
import '../../risk/risk.css';
import '../planning.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const router = useRouter();
const data = ref<any>(null);
const error = ref('');
const year = ref<number | null>(null);
async function load() {
  try {
    data.value = await api(`/planning/dashboard${year.value ? `?year=${year.value}` : ''}`);
    year.value = data.value.year;
  } catch (e) {
    error.value = errMsg(e);
  }
}
onMounted(load);
watch(year, (y, o) => { if (o !== null && y !== data.value?.year) load(); });
const years = computed(() => { const y = new Date().getFullYear(); return Array.from({ length: 7 }, (_, i) => y - 2 + i); });
const PILLAR_COLORS = ['#0ea5e9', '#10b981', '#a78bfa', '#f59e0b', '#f43f5e', '#2f7a57'];
const LEVEL = { danger: '#ef4444', warning: '#f59e0b', info: '#6366f1' } as const;
const KINDS: Record<string, string> = { delay: 'تأخر', milestone: 'معلم', reading: 'قراءة', returned: 'إعادة', owner: 'مسؤول' };
const execTotal = computed(() => Math.max(1, data.value?.execution.total ?? 1));
const kpiTotal = computed(() => Math.max(1, data.value?.kpis.total ?? 1));
</script>

<template>
  <div>
    <section class="pm-hero pl-hero">
      <div>
        <p class="pm-kicker">التخطيط الاستراتيجي والتشغيلي والموازنات</p>
        <h1>من الرؤية إلى النشاط اليومي، في صورة واحدة</h1>
        <p class="pm-sub">خطة استراتيجية متعددة السنوات، وخطط تشغيلية لكل إدارة ترتبط بها، ومؤشرات أداء بمستهدفات، وإنجاز يُحسب تلقائيًا من الأنشطة حتى الأهداف.</p>
      </div>
      <div class="pm-actions">
        <select v-model.number="year" class="input" style="width: auto; background: rgba(255,255,255,.1); color: #fff; border-color: rgba(255,255,255,.25)">
          <option v-for="y in years" :key="y" :value="y" style="color: #000">{{ y }}</option></select>
        <RouterLink v-if="session.can(P.strategic)" to="/planning/strategic" class="btn pl-glow">الخطة الاستراتيجية</RouterLink>
        <RouterLink v-if="session.can(P.operational)" to="/planning/operational" class="btn rk-ghost">الخطط التشغيلية</RouterLink>
        <RouterLink to="/planning/approvals" class="btn rk-ghost">بانتظار اعتمادي <b v-if="data?.counts.pendingMine">({{ data.counts.pendingMine }})</b></RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="data">
      <template v-if="data.strategic">
        <div class="pl-vision">
          <div class="pl-vm" style="--c: #0ea5e9"><b>الرؤية · {{ data.strategic.code }} {{ data.strategic.title }}</b><p>{{ data.strategic.vision ?? '—' }}</p></div>
          <div class="pl-vm" style="--c: #10b981"><b>الرسالة</b><p>{{ data.strategic.mission ?? '—' }}</p>
            <div v-if="data.strategic.values?.length" class="pl-values"><span v-for="v in data.strategic.values" :key="v">{{ v }}</span></div></div>
        </div>
        <div class="pl-pillars">
          <div v-for="(p, i) in data.strategic.pillars" :key="p.id" class="pl-pillar" :style="{ '--i': i, '--c': PILLAR_COLORS[i % PILLAR_COLORS.length] }"
            @click="router.push(`/planning/plans/${data.strategic.id}?item=${p.id}`)">
            <ProgressRing :value="p.progress" :planned="p.planned" :color="PILLAR_COLORS[i % PILLAR_COLORS.length]" :size="76" />
            <div>
              <h3>{{ p.title }}</h3>
              <small>{{ data.strategic.levels[0]?.name }} {{ p.code }} · {{ p.children }} {{ data.strategic.levels[1]?.name ?? 'فرع' }}</small>
              <small>المخطط {{ pct(p.planned) }} · تحقق المؤشرات {{ pct(p.performance) }}</small>
              <span class="pm-pill" :style="{ '--c': EXEC[p.status]?.color, marginTop: '4px' }">{{ EXEC[p.status]?.label }}</span>
            </div>
          </div>
        </div>
      </template>
      <section v-else class="card pm-panel" style="margin-bottom: 18px; text-align: center">
        <p class="pm-empty">لا توجد خطة استراتيجية تغطي {{ data.year }}.</p>
        <RouterLink v-if="session.can(P.strategic)" to="/planning/strategic" class="btn btn-primary">إنشاء خطة استراتيجية من قالب جاهز</RouterLink>
      </section>

      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #0ea5e9; --i: 0"><span>إنجاز الخطة الاستراتيجية</span><strong>{{ pct(data.strategic?.summary.progress) }}</strong><small>المخطط حتى اليوم {{ pct(data.strategic?.summary.planned) }}</small></div>
        <div class="pm-kpi" style="--a: #10b981; --i: 1"><span>الأنشطة المنجزة</span><strong>{{ data.execution.completed }}</strong><small>من {{ data.execution.total }} نشاطًا وعنصرًا تنفيذيًا</small></div>
        <div class="pm-kpi" style="--a: #ef4444; --i: 2"><span>متأخر</span><strong>{{ data.execution.delayed }}</strong><small>{{ data.execution.atRisk }} في خطر</small></div>
        <div class="pm-kpi" style="--a: #a78bfa; --i: 3"><span>مؤشرات محققة</span><strong>{{ data.kpis.green }} / {{ data.kpis.total }}</strong><small>{{ data.kpis.red }} دون المستهدف · {{ data.kpis.none }} بلا قراءة</small></div>
        <div class="pm-kpi" style="--a: #f59e0b; --i: 4"><span>تكلفة {{ data.year }} التقديرية</span><strong style="font-size: 1.15rem">{{ money(data.cost.operational || data.cost.strategic) }}</strong><small>{{ data.cost.operational ? 'من الخطط التشغيلية' : 'من الخطة الاستراتيجية' }}</small></div>
        <div class="pm-kpi" style="--a: #64748b; --i: 5"><span>الخطط</span><strong>{{ data.counts.strategic + data.counts.operational }}</strong><small>{{ data.counts.inReview }} قيد الاعتماد · {{ data.counts.drafts }} مسودة</small></div>
      </div>

      <div class="rk-grid">
        <section class="card pm-panel">
          <h2>الخطط التشغيلية في {{ data.year }} <RouterLink to="/planning/execution" class="btn btn-sm">متابعة التنفيذ</RouterLink></h2>
          <p v-if="!data.operational.length" class="pm-empty">لا توجد خطط تشغيلية معتمدة لهذه السنة</p>
          <table v-else class="table"><tbody>
            <tr v-for="p in data.operational" :key="p.id" class="rk-row" @click="router.push(`/planning/plans/${p.id}`)">
              <td style="white-space: normal"><span class="rk-code">{{ p.code }}</span> {{ p.title }}<span class="pm-muted">{{ p.unitName ?? '—' }}<template v-if="p.status !== 'approved'"> · {{ WF_STATUS[p.status]?.label }}</template></span></td>
              <td style="width: 150px"><MiniBar :value="p.summary.progress" :planned="p.summary.planned" :color="p.summary.delayed ? EXEC.delayed.color : EXEC.on_track.color" style="width: 100%" /></td>
              <td><b>{{ pct(p.summary.progress) }}</b><span class="pm-muted">مخطط {{ pct(p.summary.planned) }}</span></td>
              <td><span v-if="p.summary.delayed" class="pm-pill" :style="{ '--c': EXEC.delayed.color }">{{ p.summary.delayed }} متأخر</span></td>
            </tr>
          </tbody></table>
        </section>
        <section class="card pm-panel">
          <h2>التنبيهات <span class="pm-tag">{{ data.alertsTotal }}</span></h2>
          <p v-if="!data.alerts.length" class="pm-empty">لا توجد تنبيهات</p>
          <div style="display: grid; gap: 8px; max-height: 380px; overflow: auto">
            <RouterLink v-for="(a, i) in data.alerts" :key="i" :to="a.link" class="rk-chip" :style="{ borderInlineStart: `4px solid ${LEVEL[a.level as keyof typeof LEVEL]}`, borderRadius: '10px', padding: '8px 10px', justifyContent: 'space-between' }">
              <span>{{ a.text }}<span v-if="a.date" class="pm-muted" style="display: inline"> · {{ fmtDate(a.date) }}</span></span><span class="pm-tag">{{ KINDS[a.kind] }}</span>
            </RouterLink>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>حالة التنفيذ</h2>
          <div class="rk-bars">
            <div v-for="s in [['completed', data.execution.completed], ['on_track', data.execution.onTrack], ['at_risk', data.execution.atRisk], ['delayed', data.execution.delayed], ['not_started', data.execution.notStarted]]" :key="s[0]" class="r">
              <span>{{ EXEC[s[0]].label }}</span><i :style="{ width: `${(Number(s[1]) / execTotal) * 100}%`, '--c': EXEC[s[0]].color }" /><b>{{ s[1] }}</b></div>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>مؤشرات الأداء <RouterLink to="/planning/kpis" class="btn btn-sm">سجل المؤشرات</RouterLink></h2>
          <div class="rk-bars">
            <div v-for="b in ['green', 'amber', 'red', 'none']" :key="b" class="r">
              <span>{{ BAND[b].label }}</span><i :style="{ width: `${(data.kpis[b] / kpiTotal) * 100}%`, '--c': BAND[b].color }" /><b>{{ data.kpis[b] }}</b></div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
