<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fmtDate, sar } from '../lib';

/** جدول كشف حساب المورد (مشترك بين شاشة الموظف وبوابة المورد) */
defineProps<{ st: any; linkBase?: string }>();
</script>

<template>
  <div class="card table-wrap">
    <table class="table">
      <thead><tr><th>التاريخ</th><th>البيان</th><th>المستند</th><th>التعميد</th><th>مدين (سداد وخصم)</th><th>دائن (فواتير)</th><th>الرصيد المستحق</th></tr></thead>
      <tbody>
        <tr><td colspan="6"><b>الرصيد الافتتاحي</b></td><td class="pc-num"><b>{{ sar(st.opening) }}</b></td></tr>
        <tr v-for="(l, i) in st.lines" :key="i">
          <td style="font-size: .85rem">{{ fmtDate(l.date) }}</td>
          <td>{{ l.kindLabel }}<small class="pm-muted" style="display: block">فاتورة المورد {{ l.supplierInvoiceNo }}</small></td>
          <td class="pc-code"><RouterLink v-if="linkBase" class="pm-link" :to="`${linkBase}/${l.invoiceId}`">{{ l.doc }}</RouterLink><span v-else>{{ l.doc }}</span></td>
          <td class="pc-code">{{ l.orderCode }}</td>
          <td class="pc-num">{{ l.debit ? sar(l.debit) : '' }}</td>
          <td class="pc-num">{{ l.credit ? sar(l.credit) : '' }}</td>
          <td class="pc-num">{{ sar(l.balance) }}</td>
        </tr>
        <tr v-if="!st.lines.length"><td colspan="7" class="pc-empty">لا توجد حركات في الفترة.</td></tr>
      </tbody>
      <tfoot><tr><td colspan="4"><b>الإجمالي والرصيد الختامي</b></td><td class="pc-num"><b>{{ sar(st.totals.debit) }}</b></td><td class="pc-num"><b>{{ sar(st.totals.credit) }}</b></td><td class="pc-num"><b>{{ sar(st.closing) }}</b></td></tr></tfoot>
    </table>
  </div>
</template>
