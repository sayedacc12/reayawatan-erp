
<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { fmtDate, loadConfig, P, RISK_STATES, SOURCES, TREATMENTS, WF_STATUS, type RiskConfig } from '../lib';
import '../../../shared/module.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const route = useRoute();
const router = useRouter();
const rows = ref<any[] | null>(null);
const cfg = ref<RiskConfig | null>(null);
const f = reactive({ source: '', category: '', level: '', state: '', status: '', search: '' });
const cell = computed(() => (route.query.l ? { l: Number(route.query.l), i: Number(route.query.i), k: String(route.query.k ?? 'residual') } : null));
async function load() {
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
  rows.value = await api<any[]>(`/risk/risks?${q}`);
}
onMounted(async () => {
  cfg.value = (await loadConfig()).config;
  await load();
});
let t: ReturnType<typeof setTimeout>;
watch(f, () => { clearTimeout(t); t = setTimeout(load, 250); });
const shown = computed(() => (rows.value ?? []).filter((r) => !cell.value || (cell.value.k === 'inherent'
  ? r.inherentLikelihood === cell.value.l && r.inherentImpact === cell.value.i
  : r.residualLikelihood === cell.value.l && r.residualImpact === cell.value.i)));
const catName = (c: string) => cfg.value?.categories.find((x) => x.code === c)?.name ?? c;
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>سجل المخاطر المؤسسي</h1><p class="muted">المرجع الموحد لمخاطر الجمعية. الترتيب حسب الخطر المتبقي من الأعلى.</p></div>
      <RouterLink v-if="session.can(P.register)" to="/risk/register/new" class="btn btn-primary">تسجيل خطر</RouterLink>
    </div>
    <div class="pm-filters">
      <input v-model="f.search" class="input" placeholder="بحث بالعنوان أو الرمز أو المالك" />
      <select v-model="f.source" class="input"><option value="">كل المصادر</option><option v-for="(s, k) in SOURCES" :key="k" :value="k">{{ s.label }}</option></select>
      <select v-model="f.category" class="input"><option value="">كل التصنيفات</option><option v-for="c in cfg?.categories" :key="c.code" :value="c.code">{{ c.name }}</option></select>
      <select v-model="f.level" class="input"><option value="">كل المستويات</option><option v-for="l in cfg?.levels" :key="l.key" :value="l.key">{{ l.name }}</option></select>
      <select v-model="f.state" class="input"><option value="">كل الحالات</option><option v-for="(s, k) in RISK_STATES" :key="k" :value="k">{{ s.label }}</option></select>
      <select v-model="f.status" class="input"><option value="">كل حالات الاعتماد</option><option v-for="(s, k) in WF_STATUS" :key="k" :value="k">{{ s.label }}</option></select>
    </div>
    <div v-if="cell" class="rk-note" style="margin-bottom: 12px">معروض فقط: الاحتمالية {{ cell.l }} والأثر {{ cell.i }} ({{ cell.k === 'inherent' ? 'الكامن' : 'المتبقي' }}). <RouterLink to="/risk/register" class="pm-link">عرض الكل</RouterLink></div>
    <section class="card">
      <p v-if="rows && !shown.length" class="pm-empty">لا توجد مخاطر مطابقة</p>
      <div v-else class="table-wrap"><table class="table">
        <thead><tr><th>الرمز</th><th>الخطر</th><th>المصدر</th><th>الكامن</th><th>المتبقي</th><th>المعالجة</th><th>المالك</th><th>المراجعة القادمة</th><th>الحالة</th></tr></thead>
        <tbody><tr v-for="r in shown" :key="r.id" class="rk-row" @click="router.push(`/risk/register/${r.id}`)">
          <td class="rk-code">{{ r.code }}</td>
          <td style="white-space: normal; min-width: 220px"><b>{{ r.title }}</b><span class="pm-muted">{{ catName(r.category) }}{{ r.productName ? ` · ${r.productName}` : '' }}</span></td>
          <td><span class="pm-pill" :style="{ '--c': SOURCES[r.source].color }">{{ SOURCES[r.source].label }}</span></td>
          <td><span class="rk-score" :style="{ '--c': r.inherentLevel.color }">{{ r.inherentScore }}</span></td>
          <td><span class="rk-score" :style="{ '--c': r.residualLevel.color }">{{ r.residualScore }}</span><span v-if="r.aboveAppetite" class="pm-muted" style="color: var(--danger)">فوق حد الرغبة</span></td>
          <td>{{ TREATMENTS[r.treatment].label }}<span v-if="r.actionsProgress !== null" class="pm-muted">إنجاز {{ r.actionsProgress }}%{{ r.overdueActions ? ` · ${r.overdueActions} متأخر` : '' }}</span></td>
          <td>{{ r.ownerName ?? '—' }}<span class="pm-muted">{{ r.unitName }}</span></td>
          <td :style="{ color: r.reviewOverdue ? 'var(--danger)' : '' }">{{ fmtDate(r.nextReviewDate) }}</td>
          <td><span class="pm-pill" :style="{ '--c': RISK_STATES[r.riskState].color }">{{ RISK_STATES[r.riskState].label }}</span>
            <span class="pm-muted"><span class="pm-pill" :style="{ '--c': WF_STATUS[r.status].color }">{{ WF_STATUS[r.status].label }}</span></span></td>
        </tr></tbody>
      </table></div>
    </section>
  </div>
</template>
