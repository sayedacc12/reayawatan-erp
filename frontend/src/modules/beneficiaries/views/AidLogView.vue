<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import CountUp from '../components/CountUp.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { AID_TYPES, fmtDate, money, today } from '../labels';

interface LogRow {
  id: string; aidType: string; amount: number; description: string | null; disbursedOn: string; referenceNo: string | null;
  beneficiary: { id: string; fileNo: number; fullName: string };
}
interface Log { items: LogRow[]; total: number; totalAmount: number; beneficiaryCount: number; page: number; pageSize: number }

const monthStart = today().slice(0, 8) + '01';
const from = ref(monthStart);
const to = ref(today());
const aidType = ref('');
const page = ref(1);
const data = ref<Log | null>(null);
const error = ref('');
const loading = ref(false);

const presets = [
  { label: 'هذا الشهر', from: () => monthStart, to: today },
  { label: 'آخر 3 شهور', from: () => shift(-2), to: today },
  { label: 'هذا العام', from: () => today().slice(0, 4) + '-01-01', to: today },
  { label: 'الكل', from: () => '', to: () => '' },
];
function shift(months: number) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function applyPreset(p: (typeof presets)[number]) { from.value = p.from(); to.value = p.to(); }

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: '50' });
    if (from.value) q.set('from', from.value);
    if (to.value) q.set('to', to.value);
    if (aidType.value) q.set('aidType', aidType.value);
    data.value = await api<Log>(`/beneficiaries/aid-log?${q}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch([from, to, aidType], () => { page.value = 1; load(); });
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / 50)));
function go(p: number) { page.value = p; load(); }
</script>

<template>
  <div>
    <div class="page-head"><h1>سجل المساعدات</h1></div>

    <div class="card filters">
      <div class="presets">
        <button v-for="p in presets" :key="p.label" :class="['chip', { on: from === p.from() && to === p.to() }]" @click="applyPreset(p)">{{ p.label }}</button>
      </div>
      <label>من <input v-model="from" class="input" type="date" /></label>
      <label>إلى <input v-model="to" class="input" type="date" /></label>
      <select v-model="aidType" class="input type"><option value="">كل الأنواع</option><option v-for="t in AID_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option></select>
    </div>

    <div v-if="data" class="totals">
      <div class="tot" style="--a: #e8b04b"><span>إجمالي القيمة</span><strong><CountUp :value="data.totalAmount" :decimals="2" /></strong></div>
      <div class="tot" style="--a: #14b8a6"><span>عمليات الصرف</span><strong><CountUp :value="data.total" /></strong></div>
      <div class="tot" style="--a: #6366f1"><span>عدد المستفيدين</span><strong><CountUp :value="data.beneficiaryCount" /></strong></div>
    </div>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="card table-wrap" :class="{ dim: loading }">
      <table class="table">
        <thead><tr><th>التاريخ</th><th>المستفيد</th><th>النوع</th><th>البيان</th><th>القيمة</th><th>رقم الإيصال</th></tr></thead>
        <tbody>
          <tr v-for="a in data?.items ?? []" :key="a.id">
            <td>{{ fmtDate(a.disbursedOn) }}</td>
            <td><RouterLink :to="`/beneficiaries/files/${a.beneficiary.id}`"><span class="muted">#{{ a.beneficiary.fileNo }}</span> {{ a.beneficiary.fullName }}</RouterLink></td>
            <td><StatusBadge :value="a.aidType" kind="aid" /></td>
            <td>{{ a.description || '—' }}</td>
            <td><b class="amt">{{ money(a.amount) }}</b></td>
            <td class="muted">{{ a.referenceNo || '—' }}</td>
          </tr>
          <tr v-if="data && !data.items.length"><td colspan="6" class="empty">لا توجد مساعدات في هذه الفترة</td></tr>
        </tbody>
      </table>
    </div>
    <div v-if="pages > 1" class="pager">
      <button class="btn btn-sm" :disabled="page <= 1" @click="go(page - 1)">السابق</button>
      <span class="muted">صفحة {{ page.toLocaleString('ar-EG') }} من {{ pages.toLocaleString('ar-EG') }}</span>
      <button class="btn btn-sm" :disabled="page >= pages" @click="go(page + 1)">التالي</button>
    </div>
  </div>
</template>

<style scoped>
.filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 12px; margin-bottom: 14px; }
.filters label { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: .9rem; }
.filters .input { width: auto; }
.presets { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { font: inherit; font-size: .84rem; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; transition: all .2s; }
.chip.on { background: var(--primary-soft); border-color: var(--primary); color: var(--primary); font-weight: 600; }
.totals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 14px; }
.tot { position: relative; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 14px 18px; box-shadow: var(--shadow);
  display: flex; flex-direction: column; animation: rise .5s var(--ease) both; }
.tot::before { content: ''; position: absolute; inset-inline-start: 0; top: 0; bottom: 0; width: 4px; background: var(--a); box-shadow: 0 0 16px var(--a); }
.tot span { font-size: .82rem; color: var(--muted); }
.tot strong { font-size: 1.45rem; }
.amt { color: var(--primary); }
.dim { opacity: .55; transition: opacity .2s; }
.empty { text-align: center; color: var(--muted); padding: 30px !important; }
.pager { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 14px; }
@keyframes rise { from { opacity: 0; transform: translateY(12px); } }
@media (max-width: 700px) { .totals { grid-template-columns: 1fr; } .filters .input, .filters label { width: 100%; } }
</style>
