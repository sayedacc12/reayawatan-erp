
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import CountUp from '../../../shared/CountUp.vue';
import HeatMap from '../components/HeatMap.vue';
import { fmtDate, loadConfig, P, SOURCES, type Level, type RiskConfig } from '../lib';
import '../../../shared/module.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const router = useRouter();
const data = ref<any>(null);
const cfg = ref<RiskConfig | null>(null);
const error = ref('');
const heat = ref<'residual' | 'inherent'>('residual');
onMounted(async () => {
  try {
    [data.value, cfg.value] = await Promise.all([api('/risk/dashboard'), loadConfig().then((c) => c.config)]);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const LEVEL = { danger: '#ef4444', warning: '#f59e0b', info: '#6366f1' } as const;
const KIND: Record<string, string> = { crisis: 'أزمة', critical: 'حرج', kri: 'مؤشر', review: 'مراجعة', compliance: 'التزام', task: 'مهمة' };
const maxLevel = () => Math.max(1, ...(data.value?.risks.byLevel.map((l: Level & { n: number }) => l.n) ?? [1]));
</script>

<template>
  <div>
    <section class="pm-hero rk-hero">
      <div>
        <p class="pm-kicker">المخاطر والتغيير والالتزام</p>
        <h1>خريطة المخاطر المؤسسية في لمحة</h1>
        <p class="pm-sub">سجل واحد لكل مخاطر الشركة الداخلية والخارجية ومخاطر الخدمات، مع التغيير والالتزام واستمرارية الأعمال، وفق منهجيات معتمدة ومراحل اعتماد تضبطها الشركة.</p>
      </div>
      <div class="pm-actions">
        <RouterLink v-if="session.can(P.register)" to="/risk/register/new" class="btn rk-glow">تسجيل خطر</RouterLink>
        <RouterLink v-if="session.can(P.change)" to="/risk/changes/new" class="btn rk-ghost">طلب تغيير</RouterLink>
        <RouterLink to="/risk/approvals" class="btn rk-ghost">بانتظار اعتمادي <b v-if="data?.pendingMine">({{ data.pendingMine }})</b></RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="data && cfg">
      <RouterLink v-if="data.continuity.activeCrises" to="/risk/crisis" class="rk-alarm">
        <span><span class="siren" /><b>حالة أزمة قائمة</b> — فريق الأزمة مفعّل بصلاحيات الطوارئ</span><span class="btn btn-sm rk-ghost">متابعة الأزمة</span>
      </RouterLink>
      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #fb7185; --i: 0"><span>المخاطر القائمة</span><strong><CountUp :value="data.risks.total" /></strong><small>{{ data.risks.aboveAppetite }} فوق حد الرغبة ({{ data.risks.appetite }})</small></div>
        <div class="pm-kpi" style="--a: #f59e0b; --i: 1"><span>مراجعات متأخرة</span><strong><CountUp :value="data.risks.reviewOverdue" /></strong><small>{{ data.risks.overdueActions }} إجراء معالجة متأخر</small></div>
        <div class="pm-kpi" style="--a: #10b981; --i: 2"><span>نسبة الامتثال</span><strong><template v-if="data.compliance.rate !== null"><CountUp :value="data.compliance.rate" :decimals="1" />%</template><template v-else>—</template></strong><small>{{ data.compliance.obligations }} متطلبًا · {{ data.compliance.due }} حان تقييمها</small></div>
        <div class="pm-kpi" style="--a: #0ea5e9; --i: 3"><span>طلبات التغيير المفتوحة</span><strong><CountUp :value="data.changes.open" /></strong><small>{{ data.changes.inReview }} قيد الاعتماد · {{ data.changes.implementing }} قيد التنفيذ</small></div>
        <div class="pm-kpi" style="--a: #a78bfa; --i: 4"><span>مهام المتابعة</span><strong><CountUp :value="data.tasks.open" /></strong><small>{{ data.tasks.overdue }} متأخرة · {{ data.tasks.mine }} مسندة لك</small></div>
        <div class="pm-kpi" style="--a: #ef4444; --i: 5"><span>أنشطة حرجة (BIA)</span><strong><CountUp :value="data.continuity.critical" /></strong><small>{{ data.continuity.activities }} نشاطًا · {{ data.continuity.teams }} فرق أزمات</small></div>
      </div>

      <div class="rk-grid">
        <section class="card pm-panel">
          <h2>خريطة المخاطر
            <span class="rk-tabs" style="margin: 0"><button :class="['rk-tab', { on: heat === 'residual' }]" @click="heat = 'residual'">المتبقي</button><button :class="['rk-tab', { on: heat === 'inherent' }]" @click="heat = 'inherent'">الكامن</button></span>
          </h2>
          <HeatMap :config="cfg" :grid="heat === 'residual' ? data.risks.heatResidual : data.risks.heatInherent" @cell="(v) => router.push(`/risk/register?l=${v.likelihood}&i=${v.impact}&k=${heat}`)" />
          <div class="pm-legend" style="justify-content: center; margin-top: 10px"><span v-for="l in cfg.levels" :key="l.key" :style="{ '--c': l.color }">{{ l.name }}</span></div>
        </section>
        <section class="card pm-panel">
          <h2>التنبيهات <span class="pm-tag">{{ data.alertsTotal }}</span></h2>
          <p v-if="!data.alerts.length" class="pm-empty">لا توجد تنبيهات</p>
          <div class="hr-alerts" style="display: grid; gap: 8px; max-height: 360px; overflow: auto">
            <RouterLink v-for="(a, i) in data.alerts" :key="i" :to="a.link" class="rk-chip" :style="{ borderInlineStart: `4px solid ${LEVEL[a.level as keyof typeof LEVEL]}`, borderRadius: '10px', padding: '8px 10px', justifyContent: 'space-between' }">
              <span>{{ a.text }}<span v-if="a.date" class="pm-muted"> · {{ fmtDate(a.date) }}</span></span><span class="pm-tag">{{ KIND[a.kind] }}</span>
            </RouterLink>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>أعلى المخاطر المتبقية</h2>
          <p v-if="!data.risks.top.length" class="pm-empty">لا توجد مخاطر مسجلة بعد</p>
          <table v-else class="table">
            <tbody><tr v-for="r in data.risks.top" :key="r.id" class="rk-row" @click="router.push(`/risk/register/${r.id}`)">
              <td><span class="rk-score" :style="{ '--c': r.level.color }">{{ r.score }}</span></td>
              <td style="white-space: normal"><span class="rk-code">{{ r.code }}</span> {{ r.title }}<span class="pm-muted">{{ r.ownerName ?? 'بلا مالك' }}</span></td>
            </tr></tbody>
          </table>
        </section>
        <section class="card pm-panel">
          <h2>توزيع المخاطر</h2>
          <div class="rk-bars">
            <div v-for="l in data.risks.byLevel" :key="l.key" class="r"><span>{{ l.name }}</span><i :style="{ width: (l.n / maxLevel()) * 100 + '%', '--c': l.color }" /><b>{{ l.n }}</b></div>
          </div>
          <div class="rk-sec">حسب المصدر</div>
          <div class="rk-chips"><span v-for="s in data.risks.bySource" :key="s.key" class="pm-pill" :style="{ '--c': SOURCES[s.key]?.color }">{{ SOURCES[s.key]?.label }} {{ s.n }}</span></div>
          <div class="rk-sec">الضوابط الرقابية</div>
          <p class="pm-muted">{{ data.controls.total }} ضابطًا نشطًا، منها {{ data.controls.ineffective }} غير فعّال.</p>
        </section>
      </div>
    </template>
  </div>
</template>
