<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { BATCH_STATUSES, color, fmtNo, label, sar, TARGETS } from '../labels';
import type { Batch } from '../types';
import '../fr.css';

const router = useRouter();
const rows = ref<Batch[] | null>(null);
const error = ref('');
const f = reactive({ search: '', status: 'active', targetKind: '', zakat: '' });
let timer: ReturnType<typeof setTimeout> | undefined;
async function load() {
  try {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== ''));
    rows.value = await api<Batch[]>(`/fundraising/batches?${q}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(() => [f.status, f.targetKind, f.zakat], load);
watch(() => f.search, () => { clearTimeout(timer); timer = setTimeout(load, 300); });
const totals = computed(() => {
  const r = rows.value ?? [];
  const s = (k: 'amount' | 'reservedAmount' | 'spentAmount' | 'transferredAmount' | 'net') => r.reduce((a, b) => a + b[k], 0);
  return { amount: s('amount'), reserved: s('reservedAmount'), spent: s('spentAmount'), transferred: s('transferredAmount'), net: s('net') };
});
const w = (x: number, total: number) => (total ? `${(x / total) * 100}%` : '0%');
</script>

<template>
  <div>
    <section class="fr-hero">
      <div>
        <p class="kicker">سجل الدفعات</p>
        <h1>أرصدة الدعم جاهزة للتحميل</h1>
        <p class="sub">كل دفعة بند من فرصة تبرع برقم مستقل، ويتابع منها نظام المشاريع المحجوز والمخصوم والمناقلات.</p>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="fr-kpis">
      <div class="fr-kpi" style="--a: #14b8a6; --i: 0"><span class="k-label">إجمالي الدفعات</span><strong>{{ sar(totals.amount) }}</strong><span class="k-foot">{{ (rows?.length ?? 0).toLocaleString('ar-SA') }} دفعة</span></div>
      <div class="fr-kpi" style="--a: #f59e0b; --i: 1"><span class="k-label">محجوز</span><strong>{{ sar(totals.reserved) }}</strong></div>
      <div class="fr-kpi" style="--a: #0f766e; --i: 2"><span class="k-label">مخصوم</span><strong>{{ sar(totals.spent) }}</strong></div>
      <div class="fr-kpi" style="--a: #8b5cf6; --i: 3"><span class="k-label">مناقلات</span><strong>{{ sar(totals.transferred) }}</strong></div>
      <div class="fr-kpi" style="--a: #10b981; --i: 4"><span class="k-label">صافي متاح</span><strong>{{ sar(totals.net) }}</strong></div>
    </div>

    <div class="fr-filters">
      <input v-model="f.search" class="input grow" placeholder="رقم الدفعة أو الفرصة أو اسم الداعم أو الجهة" />
      <select v-model="f.status" class="input"><option value="">كل الحالات</option><option v-for="s in BATCH_STATUSES" :key="s.value" :value="s.value">{{ s.label }}</option></select>
      <select v-model="f.targetKind" class="input"><option value="">كل التصنيفات</option><option v-for="t in TARGETS.filter((x) => x.value !== 'zakat')" :key="t.value" :value="t.value">{{ t.label }}</option></select>
      <select v-model="f.zakat" class="input"><option value="">زكاة وغيرها</option><option value="true">الزكاة فقط</option><option value="false">غير الزكاة</option></select>
    </div>

    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الدفعة</th><th>الفرصة</th><th>الداعم</th><th>الجهة</th><th>المبلغ</th><th>الاستخدام</th><th>صافي</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="b in rows ?? []" :key="b.id" class="fr-row-link" @click="router.push(`/fundraising/batches/${b.id}`)">
            <td><span class="fr-no">{{ fmtNo('B', b.batchNo) }}</span></td>
            <td>{{ fmtNo('FR', b.opportunityNo) }}</td>
            <td>{{ b.donorName }}</td>
            <td class="wrap"><span class="fr-badge" :style="{ '--c': color('target', b.isZakat ? 'zakat' : b.targetKind) }">{{ b.isZakat ? 'زكاة' : label('target', b.targetKind) }}</span> {{ b.targetName }}</td>
            <td class="fr-amount">{{ sar(b.amount) }}</td>
            <td class="use"><div class="fr-progress"><i :style="{ width: w(b.spentAmount, b.amount), background: '#0f766e' }" /><i :style="{ width: w(b.reservedAmount, b.amount), background: '#f59e0b' }" /><i :style="{ width: w(b.transferredAmount, b.amount), background: '#8b5cf6' }" /></div></td>
            <td><b>{{ sar(b.net) }}</b></td>
            <td><span class="fr-badge" :style="{ '--c': color('batch', b.status) }">{{ label('batch', b.status) }}</span><span v-if="b.isPromised" class="muted"> · موعود</span></td>
          </tr>
        </tbody>
      </table>
      <p v-if="rows && !rows.length" class="fr-empty">لا توجد دفعات مطابقة</p>
    </div>
  </div>
</template>

<style scoped>
.wrap { white-space: normal; min-width: 220px; }
.use { min-width: 120px; }
</style>
