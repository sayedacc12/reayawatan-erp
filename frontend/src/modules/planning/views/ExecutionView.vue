<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import MiniBar from '../components/MiniBar.vue';
import { errMsg, EXEC, fmtDate, KIND, loadLookups, money, pct, todayStr, type Lookups } from '../lib';
import '../../../shared/module.css';
import '../../risk/risk.css';
import '../planning.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const route = useRoute();
const router = useRouter();
const data = ref<any>(null);
const lookups = ref<Lookups | null>(null);
const error = ref('');
const f = ref({ year: String(route.query.year ?? ''), planId: String(route.query.planId ?? ''), unitId: String(route.query.unitId ?? ''), status: String(route.query.status ?? ''), owner: String(route.query.owner ?? ''), kind: String(route.query.kind ?? '') });
const q = ref('');
async function load() {
  try {
    const params = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    data.value = await api(`/planning/execution?${params}`);
    if (!f.value.year) f.value.year = String(data.value.year);
  } catch (e) {
    error.value = errMsg(e);
  }
}
onMounted(async () => { lookups.value = await loadLookups(); load(); });
watch(f, load, { deep: true });
const years = computed(() => { const y = new Date().getFullYear(); return Array.from({ length: 7 }, (_, i) => String(y - 3 + i)); });
const rows = computed(() => (data.value?.rows ?? []).filter((r: any) => !q.value || `${r.code} ${r.title} ${r.ownerName ?? ''} ${r.planTitle}`.includes(q.value)));
const counts = computed(() => {
  const c: Record<string, number> = {};
  for (const r of data.value?.rows ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
  return c;
});
const nextMilestone = (r: any) => r.milestones.filter((m: any) => !m.done).sort((a: any, b: any) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'))[0];
</script>

<template>
  <div>
    <div class="page-head"><div><h1>متابعة التنفيذ</h1><p class="muted">كل الأنشطة والعناصر التنفيذية في الخطط الفعالة: الإنجاز الفعلي مقابل المخطط، والمعالم القادمة، والإجراءات التصحيحية.</p></div></div>
    <div class="pm-filters">
      <select v-model="f.year" class="input"><option v-for="y in years" :key="y" :value="y">{{ y }}</option></select>
      <select v-model="f.kind" class="input"><option value="">كل الخطط</option><option value="strategic">الاستراتيجية</option><option value="operational">التشغيلية</option></select>
      <select v-if="data" v-model="f.planId" class="input"><option value="">كل الخطط الفعالة</option><option v-for="p in data.plans" :key="p.id" :value="p.id">{{ p.code }} {{ p.title }}</option></select>
      <select v-if="lookups" v-model="f.unitId" class="input"><option value="">كل الإدارات</option><option v-for="u in lookups.units" :key="u.id" :value="u.id">{{ u.name }}</option></select>
      <select v-model="f.owner" class="input"><option value="">كل المسؤولين</option><option value="none">بلا مسؤول</option></select>
      <input v-model="q" class="input" placeholder="بحث" />
    </div>
    <div class="pl-flex" style="margin-bottom: 12px">
      <button :class="['btn btn-sm', { 'btn-primary': !f.status }]" @click="f.status = ''">الكل</button>
      <button v-for="s in ['delayed', 'at_risk', 'on_track', 'not_started', 'no_schedule', 'completed', 'cancelled']" :key="s" :class="['btn btn-sm', { 'btn-primary': f.status === s }]" @click="f.status = s">
        <span class="pl-band" :style="{ '--c': EXEC[s].color }" /> {{ EXEC[s].label }} <b v-if="!f.status">{{ counts[s] ?? 0 }}</b></button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <section v-if="data" class="card pm-panel">
      <p v-if="!rows.length" class="pm-empty">لا توجد عناصر بهذه الشروط</p>
      <div v-else class="table-wrap"><table class="table">
        <thead><tr><th>العنصر</th><th>الخطة</th><th>المسؤول</th><th>المدة</th><th>الإنجاز</th><th>الحالة</th><th>المعلم القادم</th><th>تكلفة {{ data.year }}</th></tr></thead>
        <tbody><tr v-for="r in rows" :key="r.id" class="rk-row" @click="router.push(`/planning/plans/${r.planId}?item=${r.id}`)">
          <td style="white-space: normal; max-width: 340px"><span class="rk-code">{{ r.code }}</span> {{ r.title }}<span class="pm-muted">{{ r.levelName }}<template v-if="r.parent"> · ضمن {{ r.parent }}</template></span>
            <span v-if="r.contributesTo.length" class="pm-muted">↦ {{ r.contributesTo.join('، ') }}</span>
            <span v-if="r.correctiveAction && ['delayed', 'at_risk'].includes(r.status)" class="pm-muted" style="color: #b45309">تصحيح: {{ r.correctiveAction }}</span></td>
          <td><span class="rk-code">{{ r.planCode }}</span><span class="pm-muted">{{ KIND[r.planKind] }}</span></td>
          <td>{{ r.ownerName ?? '—' }}<span class="pm-muted">{{ r.unitName }}</span></td>
          <td>{{ fmtDate(r.startDate) }}<span class="pm-muted">{{ fmtDate(r.endDate) }}</span></td>
          <td style="min-width: 130px"><MiniBar :value="r.progress" :planned="r.planned" :color="EXEC[r.status]?.color" /> <b>{{ pct(r.progress) }}</b><span class="pm-muted">مخطط {{ pct(r.planned) }}</span></td>
          <td><span class="pm-pill" :style="{ '--c': EXEC[r.status]?.color }">{{ EXEC[r.status]?.label }}</span></td>
          <td><template v-if="nextMilestone(r)">{{ nextMilestone(r).title }}<span class="pm-muted" :style="{ color: nextMilestone(r).dueDate && nextMilestone(r).dueDate < todayStr() ? '#ef4444' : undefined }">{{ fmtDate(nextMilestone(r).dueDate) }}</span></template><template v-else>—</template></td>
          <td class="pm-money">{{ r.yearCost ? money(r.yearCost) : '—' }}</td>
        </tr></tbody>
      </table></div>
    </section>
  </div>
</template>
