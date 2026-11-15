<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { APPROVAL, FUNDING_TYPES, color, label, links, pct, sar } from '../labels';
import type { ProjectRow } from '../types';
import '../projects.css';

const rows = ref<ProjectRow[]>([]);
const error = ref('');
const loading = ref(true);
const q = ref('');
const status = ref('');
const type = ref('');
const axis = ref('');
const sort = ref<'name' | 'funds' | 'spent' | 'available'>('name');

onMounted(async () => {
  try {
    rows.value = await api<ProjectRow[]>('/projects/list');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});

const axes = computed(() => [...new Set(rows.value.map((r) => r.axisName))]);
const filtered = computed(() => {
  const t = q.value.trim();
  const list = rows.value.filter((r) => (!t || r.name.includes(t) || r.code.includes(t.toUpperCase()) || r.programName.includes(t) || (r.managerName ?? '').includes(t))
    && (!status.value || r.approvalStatus === status.value) && (!type.value || r.fundingType === type.value) && (!axis.value || r.axisName === axis.value));
  return [...list].sort((a, b) => (sort.value === 'name' ? a.name.localeCompare(b.name, 'ar') : b[sort.value] - a[sort.value]));
});
const totals = computed(() => filtered.value.reduce((t, r) => ({
  funds: t.funds + r.funds, reserved: t.reserved + r.reserved, spent: t.spent + r.spent, available: t.available + r.available, served: t.served + r.served,
}), { funds: 0, reserved: 0, spent: 0, available: 0, served: 0 }));
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>إجمالي المشاريع</h1><p class="muted">ملخص مختصر لكل مشروع: الاعتماد والدعم والصرف والمستفيدون</p></div>
      <RouterLink to="/projects" class="btn">لوحة المعلومات</RouterLink>
    </div>
    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #6366f1; --i: 0"><span>عدد المشاريع</span><strong>{{ filtered.length }}</strong><small>{{ filtered.filter((r) => r.approvalStatus === 'approved').length }} معتمد</small></div>
      <div class="pm-kpi" style="--a: #0d9488; --i: 1"><span>الدعم الوارد</span><strong>{{ sar(totals.funds) }}</strong></div>
      <div class="pm-kpi" style="--a: #f59e0b; --i: 2"><span>محجوز</span><strong>{{ sar(totals.reserved) }}</strong></div>
      <div class="pm-kpi" style="--a: #10b981; --i: 3"><span>مخصوم</span><strong>{{ sar(totals.spent) }}</strong><small>{{ pct(totals.spent, totals.funds) }}% من الوارد</small></div>
      <div class="pm-kpi" style="--a: #0ea5e9; --i: 4"><span>المتاح</span><strong>{{ sar(totals.available) }}</strong></div>
    </div>
    <div class="pm-filters">
      <input v-model="q" class="input" placeholder="ابحث بالاسم أو الرقم أو البرنامج أو المدير" />
      <select v-model="axis" class="input"><option value="">كل المحاور</option><option v-for="a in axes" :key="a">{{ a }}</option></select>
      <select v-model="type" class="input"><option value="">كل الأنواع</option><option v-for="t in FUNDING_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option></select>
      <select v-model="status" class="input"><option value="">كل حالات الاعتماد</option><option v-for="s in APPROVAL" :key="s.value" :value="s.value">{{ s.label }}</option></select>
      <select v-model="sort" class="input"><option value="name">ترتيب: الاسم</option><option value="funds">الأعلى دعمًا</option><option value="spent">الأعلى صرفًا</option><option value="available">الأعلى رصيدًا متاحًا</option></select>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>المشروع</th><th>المحور ← البرنامج</th><th>النوع</th><th>الاعتماد</th><th>الدعم الوارد</th><th>الصرف</th><th>المتاح</th><th>المستفيدون</th><th>الداعمون</th></tr></thead>
        <tbody>
          <tr v-for="r in filtered" :key="r.id">
            <td><RouterLink :to="links.project(r.id)" class="pm-link">{{ r.name }}</RouterLink><span class="pm-muted">{{ r.code }}<template v-if="r.managerName"> · {{ r.managerName }}</template></span></td>
            <td>{{ r.axisName }} ← {{ r.programName }}</td>
            <td><span class="pm-pill" :style="{ '--c': color('funding', r.fundingType) }">{{ label('funding', r.fundingType) }}</span><span v-if="r.zakatEligible" class="pm-tag zakat">زكاة</span></td>
            <td><span class="pm-pill" :style="{ '--c': color('approval', r.approvalStatus) }">{{ label('approval', r.approvalStatus) }}</span><span v-if="r.currentStage" class="pm-muted">{{ r.currentStage.name }}</span></td>
            <td class="pm-money">{{ sar(r.funds) }}</td>
            <td style="min-width: 150px">
              <div class="pm-bar"><i :style="{ width: pct(r.spent, r.funds || 1) + '%', background: '#10b981' }" /><i :style="{ width: pct(r.reserved, r.funds || 1) + '%', background: '#f59e0b' }" /></div>
              <span class="pm-muted">مخصوم {{ sar(r.spent) }} · محجوز {{ sar(r.reserved) }}</span>
            </td>
            <td class="pm-money" style="color: var(--primary)">{{ sar(r.available) }}</td>
            <td>{{ r.served }}<span class="pm-muted">{{ r.requests.total }} طلب</span></td>
            <td><span v-for="d in r.donors.slice(0, 2)" :key="d.id" class="pm-tag">{{ d.name }}</span><span v-if="r.donors.length > 2" class="pm-muted">+{{ r.donors.length - 2 }}</span></td>
          </tr>
          <tr v-if="!loading && !filtered.length"><td colspan="9" class="pm-empty">لا توجد مشاريع مطابقة</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
