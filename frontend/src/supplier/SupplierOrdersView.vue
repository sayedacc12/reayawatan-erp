<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ORDER_COLOR, fmtDate, sar } from '../modules/procurement/lib';
import { supplierApi } from './supplier';

const route = useRoute();
const slug = computed(() => route.params.slug as string);
const rows = ref<any[] | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    rows.value = await supplierApi('/orders');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>

<template>
  <div>
    <div class="page-head"><div><h1>التعميدات</h1><p class="muted">أوامر الشراء الصادرة لكم. أكدوا استلام كل تعميد، ثم اقبلوه أو اطلبوا توضيحًا.</p></div></div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="rows" class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>التعميد</th><th>القيمة</th><th>التسليم</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td class="pc-code">{{ r.code }}<small v-if="r.version > 1" class="pm-muted"> إصدار {{ r.version }}</small></td>
            <td><RouterLink class="pm-link" :to="`/supplier/${slug}/orders/${r.id}`"><b>{{ r.title }}</b></RouterLink><small class="pm-muted" style="display: block">{{ r.kindLabel }}</small></td>
            <td class="pc-num">{{ sar(r.total) }}</td>
            <td>{{ fmtDate(r.deliveryDate) }}</td>
            <td><span class="pm-pill" :style="{ '--c': ORDER_COLOR[r.status] }">{{ r.statusLabel }}</span></td>
          </tr>
          <tr v-if="!rows.length"><td colspan="5" class="pc-empty">لا توجد تعميدات حتى الآن</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
