<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { fmtDate, fmtQty, lookups, sar } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

const props = defineProps<{ id: string }>();
const route = useRoute();
const toast = useToast();
const lk = ref<any>(null);
const c = ref<any>(null);
const f = ref({ warehouse: String(route.query.warehouse ?? ''), from: '', to: '' });
async function load() {
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    c.value = await api(`/procurement/stock/items/${props.id}?${q}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(async () => {
  lk.value = await lookups().catch(() => null);
  await load();
});
watch(() => [props.id, f.value.warehouse, f.value.from, f.value.to], load);
const docLink = (m: any) => (m.docType === 'receipt' ? `/procurement/receipts/${m.docId}` : m.docType === 'count' ? `/procurement/counts/${m.docId}` : `/procurement/stock-docs/${m.docId}`);
</script>

<template>
  <div v-if="c">
    <div class="page-head">
      <div><h1>بطاقة حركة الصنف: {{ c.item.name }}</h1><p class="muted"><span class="pc-code">{{ c.item.code }}</span> · كل حركة دخول وخروج بالرصيد والقيمة بعدها.</p></div>
      <div class="pc-inline"><RouterLink class="btn" :to="`/procurement/items/${c.item.id}`">بطاقة الصنف في الدليل</RouterLink></div>
    </div>
    <div class="pc-grid" style="grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); margin-bottom: 16px">
      <section class="card pm-panel">
        <h2>الرصيد في المستودعات</h2>
        <table class="pc-lines">
          <thead><tr><th>المستودع</th><th>الكمية</th><th>القيمة</th></tr></thead>
          <tbody><tr v-for="b in c.balances" :key="b.warehouseId"><td>{{ b.warehouseName }}</td><td class="pc-num">{{ fmtQty(b.qty) }}</td><td class="pc-num">{{ sar(b.value) }}</td></tr></tbody>
        </table>
        <p v-if="!c.balances.length" class="pc-empty">لا يوجد رصيد.</p>
      </section>
      <section class="card pm-panel">
        <h2>التشغيلات والصلاحية</h2>
        <table class="pc-lines">
          <thead><tr><th>المستودع</th><th>التشغيلة</th><th>الصلاحية</th><th>الكمية</th></tr></thead>
          <tbody>
            <tr v-for="(l, i) in c.lots" :key="i">
              <td>{{ l.warehouseName }}<small v-if="l.locationName" class="pm-muted" style="display: block">{{ l.locationName }}</small></td>
              <td class="pc-code">{{ l.lot ?? '—' }}</td>
              <td>{{ fmtDate(l.expiryDate) }}<span v-if="l.expired" class="pc-flag" style="margin-inline-start: 4px">منتهي</span></td>
              <td class="pc-num">{{ fmtQty(l.qty) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!c.lots.length" class="pc-empty">لا توجد كميات متاحة.</p>
      </section>
    </div>
    <div class="pc-toolbar">
      <select v-model="f.warehouse" class="input"><option value="">كل المستودعات</option><option v-for="w in lk?.activeWarehouses ?? []" :key="w.id" :value="w.id">{{ w.code }} · {{ w.name }}</option></select>
      <label class="pc-inline">من <input v-model="f.from" type="date" class="input" /></label>
      <label class="pc-inline">إلى <input v-model="f.to" type="date" class="input" /></label>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>التاريخ</th><th>الحركة</th><th>المستند</th><th>المستودع</th><th>التشغيلة</th><th>الكمية</th><th>القيمة</th><th>الرصيد بعدها</th></tr></thead>
        <tbody>
          <tr v-for="m in c.moves" :key="m.id" :style="m.cancelled ? 'opacity: .5; text-decoration: line-through' : ''">
            <td style="font-size: .85rem">{{ fmtDate(m.date) }}</td>
            <td>{{ m.kindLabel }}<small class="pm-muted" style="display: block">{{ m.byName }}</small></td>
            <td><RouterLink class="pm-link pc-code" :to="docLink(m)">{{ m.docCode }}</RouterLink></td>
            <td>{{ m.warehouseName }}<small v-if="m.locationName" class="pm-muted" style="display: block">{{ m.locationName }}</small></td>
            <td style="font-size: .82rem">{{ m.lot ?? '' }} {{ m.expiryDate ? fmtDate(m.expiryDate) : '' }}</td>
            <td class="pc-num" :style="{ color: m.qty < 0 ? '#b91c1c' : '#047857' }">{{ m.qty > 0 ? '+' : '' }}{{ fmtQty(m.qty) }}</td>
            <td class="pc-num">{{ sar(m.value) }}</td>
            <td class="pc-num">{{ fmtQty(m.balanceQty) }}<small class="pm-muted" style="display: block">{{ sar(m.balanceValue) }}</small></td>
          </tr>
          <tr v-if="!c.moves.length"><td colspan="8" class="pc-empty">لا توجد حركات.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
