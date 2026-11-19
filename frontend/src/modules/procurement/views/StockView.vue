<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { fmtDate, fmtQty, groupTree, indent, lookups, sar } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const lk = ref<any>(null);
const data = ref<any>(null);
const loading = ref(true);
const f = ref({ q: '', warehouse: String(route.query.warehouse ?? ''), group: '', alert: String(route.query.alert ?? '') });
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    data.value = await api(`/procurement/stock?${q}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  lk.value = await lookups().catch(() => null);
  await load();
});
let t: ReturnType<typeof setTimeout>;
watch(() => f.value.q, () => { clearTimeout(t); t = setTimeout(load, 300); });
watch(() => [f.value.warehouse, f.value.group, f.value.alert], load);
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>أرصدة المخزون</h1><p class="muted">الرصيد الحالي لكل صنف في كل مستودع وقيمته بالتكلفة، مع تنبيهات إعادة الطلب والأصناف المنتهية أو القريبة من الانتهاء.</p></div>
    </div>
    <div v-if="data" class="pc-cards" style="margin-bottom: 14px">
      <div class="pc-kpi"><small>قيمة المخزون</small><b>{{ sar(data.totals.value) }}</b><small>{{ data.totals.lines }} رصيد</small></div>
      <a class="pc-kpi" :class="{ hot: data.totals.reorder }" href="#" @click.prevent="f.alert = f.alert === 'reorder' ? '' : 'reorder'"><small>تحت حد الطلب</small><b>{{ data.totals.reorder }}</b><small>{{ f.alert === 'reorder' ? 'إظهار الكل' : 'عرضها' }}</small></a>
      <a class="pc-kpi" :class="{ hot: data.totals.expiry }" href="#" @click.prevent="f.alert = f.alert === 'expiry' ? '' : 'expiry'"><small>منتهية أو تنتهي خلال {{ data.expiryAlertDays }} يومًا</small><b>{{ data.totals.expiry }}</b><small>{{ f.alert === 'expiry' ? 'إظهار الكل' : 'عرضها' }}</small></a>
    </div>
    <div class="pc-toolbar">
      <input v-model="f.q" class="input grow" placeholder="بحث بالاسم أو الرمز أو الباركود" />
      <select v-model="f.warehouse" class="input"><option value="">كل المستودعات</option><option v-for="w in lk?.activeWarehouses ?? []" :key="w.id" :value="w.id">{{ w.code }} · {{ w.name }}</option></select>
      <select v-model="f.group" class="input"><option value="">كل المجموعات</option><option v-for="g in groupTree(lk?.groups ?? [])" :key="g.id" :value="g.id">{{ indent(g.depth) }}{{ g.name }}</option></select>
      <select v-model="f.alert" class="input"><option value="">كل الأرصدة</option><option value="reorder">تحت حد الطلب</option><option value="expiry">تنبيهات الصلاحية</option></select>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الصنف</th><th>المستودع</th><th>الكمية</th><th>متوسط التكلفة</th><th>القيمة</th><th>التنبيهات</th></tr></thead>
        <tbody>
          <tr v-for="r in data?.rows ?? []" :key="`${r.itemId}-${r.warehouseId}`" class="pc-row" @click="router.push(`/procurement/stock/items/${r.itemId}?warehouse=${r.warehouseId}`)">
            <td><b>{{ r.name }}</b> <span class="pc-code">{{ r.code }}</span><span class="pm-muted" style="display: block; font-size: .78rem">{{ r.groupName }}</span></td>
            <td>{{ r.warehouseName }}</td>
            <td class="pc-num">{{ fmtQty(r.qty) }} {{ r.uomName }}</td>
            <td class="pc-num">{{ sar(r.avgCost) }}</td>
            <td class="pc-num">{{ sar(r.value) }}</td>
            <td style="font-size: .8rem">
              <span v-if="r.expired" class="pc-flag" style="display: flex">منتهي: {{ fmtQty(r.expired) }}</span>
              <span v-if="r.expiring" class="pc-warn" style="display: flex">ينتهي قريبًا: {{ fmtQty(r.expiring) }} ({{ fmtDate(r.nextExpiry) }})</span>
              <span v-if="r.reorder || r.belowMin" class="pc-warn" style="display: flex">{{ r.belowMin ? 'تحت الحد الأدنى' : 'بلغ حد إعادة الطلب' }} (الإجمالي {{ fmtQty(r.totalQty) }})</span>
            </td>
          </tr>
          <tr v-if="!loading && !data?.rows.length"><td colspan="6" class="pc-empty">لا توجد أرصدة بهذه المواصفات.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
