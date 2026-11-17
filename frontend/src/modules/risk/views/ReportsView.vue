
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import HeatMap from '../components/HeatMap.vue';
import {
  CONTROL_TYPES, EFFECTIVENESS, fmtDate, fmtDateTime, hours, loadConfig, PHASES, RISK_STATES, SEVERITY, SOURCES, TREATMENTS, WF_STATUS, type RiskConfig,
} from '../lib';
import '../../projects/projects.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const r = ref<any>(null);
const cfg = ref<RiskConfig | null>(null);
const tab = ref<'risks' | 'compliance' | 'changes' | 'continuity'>('risks');
const error = ref('');
onMounted(async () => {
  try {
    [r.value, cfg.value] = await Promise.all([api('/risk/reports'), loadConfig().then((c) => c.config)]);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const CRIT = ['', '#10b981', '#f59e0b', '#f97316', '#ef4444'];
const max = (arr: { n: number }[]) => Math.max(1, ...arr.map((x) => x.n));
/** خط اتجاه متوسط الدرجة المتبقية خلال 12 شهرًا */
const trend = computed(() => {
  const t = (r.value?.risks.trend ?? []) as { month: string; avg: number | null }[];
  const vals = t.map((x) => x.avg).filter((x): x is number => x != null);
  if (!vals.length) return null;
  const hi = Math.max(25, ...vals);
  const W = 600, H = 150;
  const pts = t.map((x, i) => (x.avg == null ? null : [20 + (i * (W - 40)) / Math.max(1, t.length - 1), H - 20 - (x.avg / hi) * (H - 40)] as const));
  const line = pts.filter(Boolean).map((p, i) => `${i ? 'L' : 'M'}${p![0].toFixed(1)},${p![1].toFixed(1)}`).join(' ');
  const appetite = H - 20 - ((cfg.value?.appetite ?? 0) / hi) * (H - 40);
  return { W, H, line, pts, t, appetite };
});
function print() { window.print(); }
</script>

<template>
  <div>
    <section class="pm-hero rk-hero rk-noprint">
      <div><p class="pm-kicker">قسم التقارير</p><h1>تقارير المخاطر والتغيير والالتزام</h1>
        <p class="pm-sub">صورة شاملة لمجلس الإدارة ولجنة المراجعة: خريطة المخاطر قبل الضوابط وبعدها، والاتجاه خلال سنة، والفجوات النظامية، وحالة التغيير والاستمرارية.</p></div>
      <div class="pm-actions"><button class="btn rk-glow" @click="print">طباعة / PDF</button></div>
    </section>
    <p v-if="error" class="rk-danger">{{ error }}</p>
    <template v-if="r && cfg">
      <p class="pm-muted">أُعدّ في {{ fmtDateTime(r.generatedAt) }}</p>
      <div class="rk-tabs rk-noprint">
        <button :class="['rk-tab', { on: tab === 'risks' }]" @click="tab = 'risks'">المخاطر والضوابط</button>
        <button :class="['rk-tab', { on: tab === 'compliance' }]" @click="tab = 'compliance'">الالتزام</button>
        <button :class="['rk-tab', { on: tab === 'changes' }]" @click="tab = 'changes'">التغيير</button>
        <button :class="['rk-tab', { on: tab === 'continuity' }]" @click="tab = 'continuity'">الاستمرارية والأزمات</button>
      </div>

      <div v-if="tab === 'risks'" class="rk-grid" style="grid-template-columns: 1fr 1fr">
        <section class="card pm-panel"><h2>قبل الضوابط (الكامن)</h2><HeatMap :config="cfg" :grid="r.risks.heatInherent" /></section>
        <section class="card pm-panel"><h2>بعد الضوابط (المتبقي) <span class="pm-pill" style="--c: #10b981">خفض {{ r.risks.reduction }}%</span></h2><HeatMap :config="cfg" :grid="r.risks.heatResidual" /></section>
        <section class="card pm-panel wide">
          <h2>اتجاه متوسط الدرجة المتبقية (12 شهرًا)</h2>
          <svg v-if="trend" :viewBox="`0 0 ${trend.W} ${trend.H}`" style="width: 100%; height: auto">
            <line x1="20" :x2="trend.W - 20" :y1="trend.appetite" :y2="trend.appetite" stroke="#ef4444" stroke-dasharray="5 4" />
            <text :x="trend.W - 22" :y="trend.appetite - 4" font-size="10" fill="#ef4444" text-anchor="start">حد القابلية {{ cfg.appetite }}</text>
            <path :d="trend.line" fill="none" stroke="#be123c" stroke-width="2.5" />
            <template v-for="(p, i) in trend.pts" :key="i">
              <circle v-if="p" :cx="p[0]" :cy="p[1]" r="3.5" fill="#be123c"><title>{{ trend.t[i].month }}: {{ trend.t[i].avg }}</title></circle>
              <text :x="20 + (i * (trend.W - 40)) / Math.max(1, trend.t.length - 1)" :y="trend.H - 4" font-size="9" fill="#94a3b8" text-anchor="middle">{{ trend.t[i].month.slice(5) }}</text>
            </template>
          </svg>
          <p v-else class="pm-empty">لا توجد مراجعات دورية مسجلة بعد</p>
        </section>
        <section class="card pm-panel">
          <h2>حسب المستوى</h2>
          <table class="table"><thead><tr><th>المستوى</th><th>كامن</th><th>متبقٍ</th></tr></thead>
            <tbody><tr v-for="l in r.risks.byLevel" :key="l.name"><td><span class="pm-pill" :style="{ '--c': l.color }">{{ l.name }}</span></td><td>{{ l.inherent }}</td><td><b>{{ l.residual }}</b></td></tr></tbody></table>
          <div class="rk-sec">حسب المصدر</div>
          <div v-for="x in r.risks.bySource" :key="x.key" class="pm-bar-row" style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px">
            <span style="min-width: 90px">{{ SOURCES[x.key]?.label ?? x.key }}</span>
            <span style="flex: 1; height: 10px; border-radius: 6px; background: var(--surface-2)"><span :style="{ display: 'block', height: '100%', borderRadius: '6px', width: `${(x.n / max(r.risks.bySource)) * 100}%`, background: SOURCES[x.key]?.color }" /></span><b>{{ x.n }}</b>
          </div>
          <div class="rk-sec">حسب الحالة والمعالجة</div>
          <div class="rk-chips">
            <span v-for="x in r.risks.byState" :key="x.key" class="pm-pill" :style="{ '--c': RISK_STATES[x.key]?.color }">{{ RISK_STATES[x.key]?.label }}: {{ x.n }}</span>
            <span v-for="x in r.risks.byTreatment" :key="x.key" class="rk-chip">{{ TREATMENTS[x.key]?.label }}: {{ x.n }}</span>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>حسب التصنيف</h2>
          <table class="table"><thead><tr><th>التصنيف</th><th>العدد</th><th>متوسط الدرجة</th></tr></thead>
            <tbody><tr v-for="x in r.risks.byCategory" :key="x.key"><td>{{ x.name }}</td><td>{{ x.n }}</td><td>{{ x.avg }}</td></tr></tbody></table>
          <template v-if="r.risks.byUnit.length">
            <div class="rk-sec">حسب الجهة</div>
            <div class="rk-chips"><span v-for="x in r.risks.byUnit" :key="x.key" class="rk-chip">{{ x.key }}: {{ x.n }}</span></div>
          </template>
        </section>
        <section class="card pm-panel wide">
          <h2>أعلى 10 مخاطر متبقية</h2>
          <table class="table"><thead><tr><th>الرمز</th><th>الخطر</th><th>التصنيف</th><th>الجهة / المالك</th><th>كامن</th><th>متبقٍ</th></tr></thead>
            <tbody><tr v-for="x in r.risks.top10" :key="x.id"><td class="rk-code">{{ x.code }}</td><td style="white-space: normal"><RouterLink :to="`/risk/register/${x.id}`" class="pm-link">{{ x.title }}</RouterLink></td>
              <td>{{ x.category }}</td><td>{{ x.unitName ?? '' }} {{ x.ownerName ?? '' }}</td><td>{{ x.inherent }}</td><td><span class="rk-score" :style="{ '--c': x.level.color }">{{ x.residual }}</span></td></tr></tbody></table>
        </section>
        <section class="card pm-panel">
          <h2>فوق حد القابلية ({{ r.risks.aboveAppetite.length }})</h2>
          <p v-if="!r.risks.aboveAppetite.length" class="pm-empty">كل المخاطر ضمن حد القابلية</p>
          <ul class="rk-log"><li v-for="x in r.risks.aboveAppetite" :key="x.id"><b class="rk-code">{{ x.code }}</b><span>{{ x.title }} <span class="rk-score" :style="{ '--c': x.level.color }">{{ x.score }}</span> <span class="pm-muted">{{ TREATMENTS[x.treatment]?.label }}</span></span></li></ul>
        </section>
        <section class="card pm-panel">
          <h2>تنبيهات المتابعة</h2>
          <div class="rk-sec">مراجعات متأخرة ({{ r.risks.reviewOverdue.length }})</div>
          <ul class="rk-log"><li v-for="x in r.risks.reviewOverdue" :key="x.id"><b>{{ fmtDate(x.nextReviewDate) }}</b><span>{{ x.code }} {{ x.title }}</span></li></ul>
          <div class="rk-sec">إجراءات معالجة متأخرة ({{ r.risks.overdueActions.length }})</div>
          <ul class="rk-log"><li v-for="(x, i) in r.risks.overdueActions" :key="i"><b>{{ fmtDate(x.dueDate) }}</b><span>{{ x.code }} · {{ x.title }} <span class="pm-muted">{{ x.ownerName }}</span></span></li></ul>
          <div class="rk-sec">مؤشرات إنذار تجاوزت الحد ({{ r.risks.kriBreaches.length }})</div>
          <ul class="rk-log"><li v-for="(x, i) in r.risks.kriBreaches" :key="i"><b>{{ x.code }}</b><span>{{ x.kri }}: {{ x.current }} (الحد {{ x.threshold }})</span></li></ul>
        </section>
        <section class="card pm-panel wide">
          <h2>الضوابط ({{ r.controls.total }}) <span class="pm-muted" style="font-size: .85rem">{{ r.controls.untested }} لم تُختبر منذ سنة</span></h2>
          <div class="rk-chips">
            <span v-for="x in r.controls.byEffectiveness" :key="x.key" class="pm-pill" :style="{ '--c': EFFECTIVENESS[x.key]?.color }">{{ EFFECTIVENESS[x.key]?.label }}: {{ x.n }}</span>
            <span v-for="x in r.controls.byType" :key="x.key" class="rk-chip">{{ CONTROL_TYPES[x.key] }}: {{ x.n }}</span>
          </div>
        </section>
      </div>

      <div v-else-if="tab === 'compliance'" class="rk-grid" style="grid-template-columns: 1fr">
        <section class="card pm-panel">
          <h2>نسبة الالتزام حسب الجهة التنظيمية</h2>
          <table class="table"><thead><tr><th>الجهة / المرجع</th><th>الالتزامات</th><th>ممتثل</th><th>جزئي</th><th>غير ممتثل</th><th>لم يُقيّم</th><th>النسبة</th></tr></thead>
            <tbody><tr v-for="g in r.compliance.byAuthority" :key="g.authority"><td style="white-space: normal">{{ g.authority }}</td><td>{{ g.total }}</td><td>{{ g.compliant }}</td><td>{{ g.partial }}</td><td>{{ g.non }}</td><td>{{ g.notAssessed }}</td>
              <td><b :style="{ color: g.rate == null ? '' : g.rate >= 90 ? '#10b981' : g.rate >= 70 ? '#f59e0b' : '#ef4444' }">{{ g.rate == null ? '—' : `${g.rate}%` }}</b></td></tr></tbody></table>
        </section>
        <section class="card pm-panel">
          <h2>الفجوات المفتوحة ({{ r.compliance.openGaps.length }})</h2>
          <p v-if="!r.compliance.openGaps.length" class="pm-empty">لا توجد فجوات مفتوحة</p>
          <table v-else class="table"><thead><tr><th>الالتزام</th><th>الفجوة</th><th>المسؤول</th><th>موعد المعالجة</th></tr></thead>
            <tbody><tr v-for="(g, i) in r.compliance.openGaps" :key="i"><td><span class="rk-code">{{ g.code }}</span> {{ g.title }}</td><td style="white-space: normal">{{ g.gaps }}</td><td>{{ g.actionOwner ?? '—' }}</td>
              <td :style="{ color: g.overdue ? 'var(--danger)' : '' }">{{ fmtDate(g.actionDueDate) }}</td></tr></tbody></table>
        </section>
      </div>

      <div v-else-if="tab === 'changes'" class="rk-grid" style="grid-template-columns: 1fr 1fr">
        <section class="card pm-panel">
          <h2>طلبات التغيير</h2>
          <div class="rk-sec">حسب الاعتماد</div>
          <div class="rk-chips"><span v-for="x in r.changes.byStatus" :key="x.key" class="pm-pill" :style="{ '--c': WF_STATUS[x.key]?.color }">{{ WF_STATUS[x.key]?.label }}: {{ x.n }}</span></div>
          <div class="rk-sec">حسب مرحلة التنفيذ</div>
          <div class="rk-chips"><span v-for="x in r.changes.byPhase" :key="x.key" class="pm-pill" :style="{ '--c': PHASES[x.key]?.color }">{{ PHASES[x.key]?.label }}: {{ x.n }}</span></div>
          <div class="rk-sec">حسب النوع</div>
          <div class="rk-chips"><span v-for="x in r.changes.byType" :key="x.key" class="rk-chip">{{ cfg.changeTypes.find((c) => c.code === x.key)?.name ?? x.key }}: {{ x.n }}</span></div>
          <p style="margin-top: 14px">متوسط مدة الاعتماد: <b>{{ r.changes.avgApprovalDays == null ? '—' : `${r.changes.avgApprovalDays} يوم` }}</b></p>
        </section>
        <section class="card pm-panel">
          <h2>مهام المتابعة الناتجة عن التغيير</h2>
          <div class="pm-kpis" style="display: flex; gap: 20px; margin-bottom: 10px">
            <div><b style="font-size: 1.6rem">{{ r.changes.tasks.total }}</b><div class="pm-muted">الكل</div></div>
            <div><b style="font-size: 1.6rem; color: #10b981">{{ r.changes.tasks.done }}</b><div class="pm-muted">منجزة</div></div>
            <div><b style="font-size: 1.6rem; color: #ef4444">{{ r.changes.tasks.overdue }}</b><div class="pm-muted">متأخرة</div></div>
          </div>
          <div class="rk-sec">المهام المفتوحة حسب الجهة</div>
          <div class="rk-chips"><span v-for="x in r.changes.tasksByUnit" :key="x.key" class="rk-chip">{{ x.key }}: {{ x.n }}</span></div>
        </section>
      </div>

      <div v-else class="rk-grid" style="grid-template-columns: 1fr">
        <section class="card pm-panel">
          <h2>الأنشطة الحرجة وأهداف الاستعادة</h2>
          <table class="table"><thead><tr><th>الرمز</th><th>النشاط</th><th>الأهمية</th><th>MTPD</th><th>RTO</th><th>آخر اختبار</th><th>الاعتماد</th></tr></thead>
            <tbody><tr v-for="b in r.continuity.activities" :key="b.id"><td class="rk-code">{{ b.code }}</td><td><RouterLink :to="`/risk/continuity/${b.id}`" class="pm-link">{{ b.activity }}</RouterLink></td>
              <td><span class="pm-pill" :style="{ '--c': CRIT[b.criticality.value] }">{{ b.criticality.name }}</span></td><td>{{ hours(b.mtpdHours) }}</td><td>{{ hours(b.rtoHours) }}</td>
              <td :style="{ color: b.untested ? 'var(--danger)' : '' }">{{ b.lastTestDate ? fmtDate(b.lastTestDate) : 'لم تُختبر' }}</td>
              <td><span class="pm-pill" :style="{ '--c': WF_STATUS[b.status].color }">{{ WF_STATUS[b.status].label }}</span></td></tr></tbody></table>
        </section>
        <section class="card pm-panel">
          <h2>فرق الأزمات وسجل التفعيل</h2>
          <div class="rk-chips" style="margin-bottom: 10px"><span v-for="t in r.continuity.teams" :key="t.id" class="rk-chip"><span class="rk-code">{{ t.code }}</span>{{ t.name }} · {{ t.members }} أعضاء</span></div>
          <table class="table"><thead><tr><th>الرمز</th><th>الأزمة</th><th>الشدة</th><th>التفعيل</th><th>الانتهاء</th></tr></thead>
            <tbody><tr v-for="e in r.continuity.events" :key="e.id"><td class="rk-code">{{ e.code }}</td><td><RouterLink :to="`/risk/crisis/event/${e.id}`" class="pm-link">{{ e.title }}</RouterLink></td>
              <td><span class="pm-pill" :style="{ '--c': SEVERITY[e.severity].color }">{{ SEVERITY[e.severity].label }}</span></td><td>{{ fmtDateTime(e.activatedAt) }}</td><td>{{ e.closedAt ? fmtDateTime(e.closedAt) : 'مفعّلة' }}</td></tr>
              <tr v-if="!r.continuity.events.length"><td colspan="5" class="pm-empty">لم تُفعّل أي أزمة</td></tr></tbody></table>
        </section>
      </div>
    </template>
  </div>
</template>
