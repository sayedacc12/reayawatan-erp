<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { INVOICE_COLOR, fmtDate, sar } from '../modules/procurement/lib';
import { canBanks, me, supplierApi } from './supplier';

/** فواتير المورد على تعميداته: رفعها ومتابعة مطابقتها وسدادها */
const route = useRoute();
const router = useRouter();
const slug = computed(() => route.params.slug as string);
const rows = ref<any[]>([]);
const error = ref('');
const loading = ref(true);
const canWrite = computed(() => canBanks(me.value?.user.role));
onMounted(async () => {
  try {
    rows.value = await supplierApi('/invoices');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>الفواتير</h1>
        <p class="muted">ارفع فاتورتك الضريبية على التعميد بعد استلام الشركة للمواد أو الخدمة. تُطابق آليًا مع التعميد (السعر) والكميات المستلمة، ثم تُحال للسداد.</p>
      </div>
      <div class="pc-inline">
        <button v-if="canWrite" class="btn" @click="router.push(`/supplier/${slug}/statement`)">كشف الحساب</button>
        <button v-if="canWrite" class="btn btn-primary" @click="router.push(`/supplier/${slug}/invoices/new`)">رفع فاتورة</button>
      </div>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>رقم فاتورتكم</th><th>التعميد</th><th>التاريخ</th><th>الإجمالي</th><th>المتبقي</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="pc-row" @click="router.push(`/supplier/${slug}/invoices/${r.id}`)">
            <td class="pc-code">{{ r.code }}<small class="pm-muted" style="display: block">{{ r.kindLabel }}</small></td>
            <td>{{ r.supplierInvoiceNo }}</td>
            <td class="pc-code">{{ r.orderCode }}</td>
            <td style="font-size: .85rem">{{ fmtDate(r.invoiceDate) }}<small v-if="r.dueDate" class="pm-muted" style="display: block">يستحق {{ fmtDate(r.dueDate) }}</small></td>
            <td class="pc-num">{{ sar(r.total) }}</td>
            <td class="pc-num">{{ r.kind === 'invoice' && ['posted', 'partial'].includes(r.status) ? sar(r.outstanding) : '—' }}</td>
            <td><span class="pm-pill" :style="{ '--c': INVOICE_COLOR[r.status] }">{{ r.statusLabel }}</span></td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="7" class="pc-empty">لا توجد فواتير بعد.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
