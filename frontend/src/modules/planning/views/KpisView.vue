<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import KpiReadings from '../components/KpiReadings.vue';
import { BAND, DIRECTION, errMsg, KIND, loadConfig, num, PERIODICITY, periodLabel, type PlanningConfig } from '../lib';
import '../../projects/projects.css';
import '../../risk/risk.css';
import '../planning.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const route = useRoute();
const rows = ref<any[] | null>(null);
const plans = ref<any[]>([]);
const cfg = ref<PlanningConfig | null>(null);
const error = ref('');
const planId = ref('');
const band = ref('');
const q = ref('');
const open = ref<any>(null);
async function load() {
  try {
    const p = new URLSearchParams({ ...(planId.value ? { planId: planId.value } : {}), ...(band.value ? { band: band.value } : {}) });
    rows.value = await api<any[]>(`/planning/kpis?${p}`);
    const id = route.query.kpi;
    if (id && !open.value) open.value = rows.value.find((k) => k.id === id) ?? null;
  } catch (e) {
    error.value = errMsg(e);
  }
}
onMounted(async () => {
  [plans.value, cfg.value] = await Promise.all([api<any[]>('/planning/plans'), loadConfig().then((c) => c.config)]);
  load();
});
watch([planId, band], load);
const list = computed(() => (rows.value ?? []).filter((k) => !q.value || `${k.code} ${k.name} ${k.ownerName ?? ''}`.includes(q.value)));
async function saved() {
  const id = open.value?.id;
  await load();
  open.value = rows.value?.find((k) => k.id === id) ?? null;
}
const bandOf = (ach: number | null) => (ach === null ? 'none' : ach >= (cfg.value?.thresholds.green ?? 90) ? 'green' : ach >= (cfg.value?.thresholds.amber ?? 70) ? 'amber' : 'red');
</script>

<template>
  <div>
    <div class="page-head"><div><h1>مؤشرات الأداء</h1><p class="muted">كل مؤشرات الخطط بمستهدفاتها وقراءاتها الفعلية. اللون يحدده حد التحقق في الإعدادات (أخضر من {{ cfg?.thresholds.green ?? 90 }}%، أصفر من {{ cfg?.thresholds.amber ?? 70 }}%).</p></div></div>
    <div class="pm-filters">
      <select v-model="planId" class="input"><option value="">كل الخطط</option><option v-for="p in plans" :key="p.id" :value="p.id">{{ p.code }} {{ p.title }}</option></select>
      <select v-model="band" class="input"><option value="">كل الحالات</option><option v-for="(b, k) in BAND" :key="k" :value="k">{{ b.label }}</option></select>
      <input v-model="q" class="input" placeholder="بحث" />
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <section v-if="rows" class="card pm-panel">
      <p v-if="!list.length" class="pm-empty">لا توجد مؤشرات</p>
      <div v-else class="table-wrap"><table class="table">
        <thead><tr><th /><th>المؤشر</th><th>الخطة / العنصر</th><th>الدورية</th><th>مستهدف السنة</th><th>الفعلي</th><th>التحقق</th><th>عبر السنوات</th><th>فترات بلا قراءة</th></tr></thead>
        <tbody><tr v-for="k in list" :key="k.id" class="rk-row pl-kpi-row" @click="open = k">
          <td><span class="pl-band" :style="{ '--c': BAND[k.stat?.band ?? 'none'].color }" /></td>
          <td style="white-space: normal; max-width: 320px"><span class="rk-code">{{ k.code }}</span> {{ k.name }}<span class="pm-muted">{{ k.unit }} · {{ DIRECTION[k.direction] }}<template v-if="k.ownerName"> · {{ k.ownerName }}</template></span></td>
          <td><span class="rk-code">{{ k.plan.code }}</span> <span class="pm-muted" style="display: inline">{{ KIND[k.plan.kind] }}</span><span class="pm-muted">{{ k.item ? `${k.item.code} ${k.item.title}` : 'الخطة كلها' }}</span></td>
          <td>{{ PERIODICITY[k.frequency] }}</td>
          <td>{{ num(k.stat?.target) }}<span class="pm-muted">{{ k.stat?.year }}</span></td>
          <td>{{ num(k.stat?.actual) }}</td>
          <td><b :style="{ color: BAND[k.stat?.band ?? 'none'].color }">{{ k.stat?.ach === null || k.stat?.ach === undefined ? '—' : `${num(k.stat.ach)}%` }}</b></td>
          <td><div class="pl-spark"><span v-for="s in k.stat?.series ?? []" :key="s.year" :title="`${s.year}: ${num(s.actual)} من ${num(s.target)}`" :class="{ t: s.ach === null }"
            :style="{ height: `${Math.max(8, Math.min(100, s.ach ?? 0))}%`, '--c': BAND[bandOf(s.ach)].color }" /></div></td>
          <td><span v-if="k.stat?.missing.length" class="pm-pill" style="--c: #6366f1">{{ periodLabel(k.stat.missing[k.stat.missing.length - 1]) }}<template v-if="k.stat.missing.length > 1"> +{{ k.stat.missing.length - 1 }}</template></span><template v-else>—</template></td>
        </tr></tbody>
      </table></div>
    </section>
    <KpiReadings v-if="open" :kpi="open" :plan="open.plan" @close="open = null" @saved="saved" />
  </div>
</template>
