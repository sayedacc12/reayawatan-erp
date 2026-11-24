<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import PlanForm from '../components/PlanForm.vue';
import ExcelImportDialog from '../../../components/ExcelImportDialog.vue';
import ProgressRing from '../components/ProgressRing.vue';
import MiniBar from '../components/MiniBar.vue';
import { errMsg, EXEC, loadConfig, loadLookups, money, P, pct, PERIODICITY, WF_STATUS, type ConfigPayload, type Lookups } from '../lib';
import '../../../shared/module.css';
import '../../risk/risk.css';
import '../planning.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ kind: 'strategic' | 'operational' }>();
const session = useSession();
const router = useRouter();
const plans = ref<any[] | null>(null);
const strategicPlans = ref<any[]>([]);
const cfg = ref<ConfigPayload | null>(null);
const lookups = ref<Lookups | null>(null);
const error = ref('');
const year = ref('');
const status = ref('');
const unitId = ref('');
const showForm = ref(false);
const importing = ref(false);
const canManage = computed(() => session.can(props.kind === 'strategic' ? P.strategic : P.operational));
async function load() {
  try {
    const q = new URLSearchParams({ kind: props.kind, ...(year.value ? { year: year.value } : {}), ...(status.value ? { status: status.value } : {}), ...(unitId.value ? { unitId: unitId.value } : {}) });
    plans.value = await api<any[]>(`/planning/plans?${q}`);
  } catch (e) {
    error.value = errMsg(e);
  }
}
onMounted(async () => {
  [cfg.value, lookups.value] = await Promise.all([loadConfig(), loadLookups()]);
  if (props.kind === 'operational') strategicPlans.value = await api<any[]>('/planning/plans?kind=strategic');
  load();
});
watch(() => props.kind, () => { plans.value = null; load(); });
watch([year, status, unitId], load);
const years = computed(() => { const y = new Date().getFullYear(); return Array.from({ length: 8 }, (_, i) => y - 3 + i); });
const ringColor = (s: any) => (s.delayed ? EXEC.delayed.color : s.atRisk ? EXEC.at_risk.color : EXEC.on_track.color);
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>{{ kind === 'strategic' ? 'الخطط الاستراتيجية' : 'الخطط التشغيلية' }}</h1>
        <p class="muted">{{ kind === 'strategic'
          ? 'خطط متعددة السنوات بهيكل مرن: محاور وأهداف ومبادرات ومؤشرات، بإصدارات معتمدة ومقارنة بين الأصل والمعدل.'
          : 'خطة سنوية لكل إدارة: أنشطة بمسؤولين وجداول زمنية ومعالم وموارد وتكلفة، ترتبط بأهداف الخطة الاستراتيجية.' }}</p></div>
      <button v-if="canManage && cfg && lookups" class="btn pl-glow" @click="showForm = true">+ خطة {{ kind === 'strategic' ? 'استراتيجية' : 'تشغيلية' }}</button>
      <button v-if="canManage" class="btn rk-ghost" @click="importing = true">استيراد من Excel</button>
    </div>
    <div class="pm-filters">
      <select v-model="year" class="input"><option value="">كل السنوات</option><option v-for="y in years" :key="y" :value="String(y)">{{ y }}</option></select>
      <select v-model="status" class="input"><option value="">كل الحالات</option><option v-for="(s, k) in WF_STATUS" :key="k" :value="k">{{ s.label }}</option></select>
      <select v-if="lookups" v-model="unitId" class="input"><option value="">كل الإدارات</option><option v-for="u in lookups.units" :key="u.id" :value="u.id">{{ u.name }}</option></select>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <p v-if="plans && !plans.length" class="card pm-empty" style="padding: 40px">لا توجد خطط بعد.{{ canManage ? ' ابدأ بإنشاء خطة من قالب جاهز أو خطة فارغة.' : '' }}</p>
    <div v-if="plans" class="pl-cards">
      <div v-for="(p, i) in plans" :key="p.id" class="card pl-card-plan" :style="{ '--i': i }" @click="router.push(`/planning/plans/${p.id}`)">
        <div style="display: flex; gap: 12px; align-items: center">
          <ProgressRing :value="p.summary.progress" :planned="p.summary.planned" :color="ringColor(p.summary)" :size="68" />
          <div style="min-width: 0">
            <div class="pl-flex"><span class="rk-code">{{ p.code }}</span><span class="pm-pill" :style="{ '--c': WF_STATUS[p.status]?.color }">{{ WF_STATUS[p.status]?.label }}</span>
              <span v-if="p.version" class="pm-tag">إصدار {{ p.version }}</span></div>
            <b style="display: block; margin-top: 4px">{{ p.title }}</b>
            <small class="pm-muted">{{ p.startYear }}{{ p.endYear !== p.startYear ? ` - ${p.endYear}` : '' }} · {{ PERIODICITY[p.periodicity] }}<template v-if="p.unitName"> · {{ p.unitName }}</template></small>
          </div>
        </div>
        <p v-if="p.parent" class="pm-muted" style="margin: 0">تتبع {{ p.parent.code }} {{ p.parent.title }}</p>
        <p v-if="p.stageName" class="pm-muted" style="margin: 0">بانتظار «{{ p.stageName }}»<b v-if="p.canDecide" style="color: #f59e0b"> · قرارك</b></p>
        <MiniBar :value="p.summary.progress" :planned="p.summary.planned" :color="ringColor(p.summary)" style="width: 100%" />
        <div class="pl-stat3">
          <div><b>{{ p.summary.items }}</b><small>عنصرًا</small></div>
          <div><b>{{ p.summary.kpis }}</b><small>مؤشرًا · {{ pct(p.summary.performance) }}</small></div>
          <div><b style="font-size: .9rem">{{ money(p.summary.yearCost) }}</b><small>تكلفة {{ p.summary.year }}</small></div>
        </div>
        <div v-if="p.summary.delayed || p.summary.atRisk" class="pl-flex">
          <span v-if="p.summary.delayed" class="pm-pill" :style="{ '--c': EXEC.delayed.color }">{{ p.summary.delayed }} متأخر</span>
          <span v-if="p.summary.atRisk" class="pm-pill" :style="{ '--c': EXEC.at_risk.color }">{{ p.summary.atRisk }} في خطر</span>
        </div>
      </div>
    </div>
    <PlanForm v-if="showForm && cfg && lookups" :kind="kind" :plan="null" :cfg="cfg" :lookups="lookups" :strategic-plans="strategicPlans"
      @close="showForm = false" @saved="(p: any) => router.push(`/planning/plans/${p.id}`)" />
    <ExcelImportDialog v-if="importing" title="استيراد خطة من Excel"
      intro="الخطة بعناصرها ومستوياتها ومؤشراتها ومستهدفاتها السنوية وروابطها بسجل المخاطر وتحليلات PESTEL وSWOT المعتمدة. يُفحص الملف أولًا دون حفظ، ثم تُنشأ الخطة مسودة كاملة أو لا شيء."
      template-url="/planning/plans/import/template" template-name="نموذج استيراد خطة.xlsx" upload-url="/planning/plans/import"
      @close="importing = false" @done="(r: any) => r.plan?.id && router.push(`/planning/plans/${r.plan.id}`)">
      <template #summary="{ report }">
        <ul v-if="report.plan" class="pm-sub" style="margin: 0">
          <li>{{ (report.plan as any).kind === 'strategic' ? 'خطة استراتيجية' : 'خطة تشغيلية' }}: {{ (report.plan as any).title }} ({{ (report.plan as any).startYear }} - {{ (report.plan as any).endYear }})</li>
          <li>{{ (report.items as any[]).length }} عنصرًا · {{ report.kpis }} مؤشرًا · {{ (report.links as any[]).filter((l) => l.resolved).length }} ربطًا من {{ (report.links as any[]).length }}</li>
          <li v-if="report.issues || report.stakeholders">{{ report.issues ?? 0 }} قضية جوهرية · {{ report.stakeholders ?? 0 }} معنيًا</li>
        </ul>
      </template>
    </ExcelImportDialog>
  </div>
</template>
