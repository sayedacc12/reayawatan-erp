<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { sar } from '../lib';
import '../../projects/projects.css';
import '../../procurement/procurement.css';
import '../acc.css';

/**
 * مستحقات الموردين في النظام المالي: الفواتير التي اعتمدت المشتريات مطابقتها بانتظار تسجيل قيدها،
 * والفواتير المسجلة غير المسددة مع أعمارها. التسجيل والسداد من شاشة الفاتورة.
 */
const router = useRouter();
const toast = useToast();
const d = ref<any>(null);
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('ar-SA-u-ca-gregory', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const AGES: [string, string][] = [['current', 'غير مستحقة بعد'], ['d30', '1 - 30 يومًا'], ['d60', '31 - 60 يومًا'], ['d90', '61 - 90 يومًا'], ['over', 'أكثر من 90 يومًا']];
onMounted(async () => {
  try {
    d.value = await api('/procurement/payables');
  } catch (e) {
    toast.error((e as Error).message);
  }
});
const open = (id: string) => router.push(`/procurement/invoices/${id}`);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>مستحقات الموردين</h1>
        <p class="muted">تعتمد المشتريات مطابقة الفاتورة مع التعميد والاستلام، ثم يسجل النظام المالي قيدها (مستحق للمورد) ويسددها بسند صرف. القيد آلي يملكه هذا المسار، ويُعدل أو يُلغى من شاشة الفاتورة فقط.</p>
      </div>
    </div>
    <template v-if="d">
      <div class="pc-cards" style="margin-bottom: 14px">
        <div class="card pm-panel"><small class="pm-muted">بانتظار التسجيل</small><b style="display: block; font-size: 1.2rem">{{ sar(d.totals.toPost) }}</b><small class="pm-muted">{{ d.toPost.length }} مستند</small></div>
        <div class="card pm-panel"><small class="pm-muted">المستحق غير المسدد</small><b style="display: block; font-size: 1.2rem">{{ sar(d.totals.outstanding) }}</b><small class="pm-muted">{{ d.open.length }} فاتورة</small></div>
        <div class="card pm-panel"><small class="pm-muted">متأخر السداد</small><b style="display: block; font-size: 1.2rem" :class="{ 'pc-flag': d.totals.overdue > 0 }">{{ sar(d.totals.overdue) }}</b></div>
      </div>

      <section class="card pm-panel" style="margin-bottom: 14px">
        <h2 style="margin-top: 0">أعمار المستحقات</h2>
        <dl class="pc-dl" style="grid-template-columns: repeat(5, minmax(0, 1fr))">
          <div v-for="[k, l] in AGES" :key="k"><dt>{{ l }}</dt><dd :class="{ 'pc-flag': k !== 'current' && d.aging[k] > 0 }">{{ sar(d.aging[k]) }}</dd></div>
        </dl>
      </section>

      <h2>بانتظار تسجيل القيد</h2>
      <div class="card table-wrap" style="margin-bottom: 14px">
        <table class="table">
          <thead><tr><th>الرقم</th><th>المورد</th><th>التعميد</th><th>التاريخ</th><th>الإجمالي</th><th>المطابقة</th></tr></thead>
          <tbody>
            <tr v-for="r in d.toPost" :key="r.id" class="pc-row" @click="open(r.id)">
              <td class="pc-code">{{ r.code }}<small class="pm-muted" style="display: block">{{ r.kindLabel }} · {{ r.supplierInvoiceNo }}</small></td>
              <td>{{ r.supplierName }}</td>
              <td class="pc-code">{{ r.orderCode }}</td>
              <td style="font-size: .85rem">{{ fmtDate(r.invoiceDate) }}</td>
              <td class="pc-num">{{ sar(r.total) }}</td>
              <td>{{ r.matchOk ? 'مطابقة' : 'معتمدة بتجاوز' }}</td>
            </tr>
            <tr v-if="!d.toPost.length"><td colspan="6" class="pc-empty">لا توجد مستندات بانتظار التسجيل.</td></tr>
          </tbody>
        </table>
      </div>

      <h2>مسجلة وغير مسددة</h2>
      <div class="card table-wrap">
        <table class="table">
          <thead><tr><th>الرقم</th><th>المورد</th><th>التعميد</th><th>الاستحقاق</th><th>الإجمالي</th><th>المسدد والمخصوم</th><th>المتبقي</th></tr></thead>
          <tbody>
            <tr v-for="r in d.open" :key="r.id" class="pc-row" @click="open(r.id)">
              <td class="pc-code">{{ r.code }}<small class="pm-muted" style="display: block">{{ r.supplierInvoiceNo }}</small></td>
              <td>{{ r.supplierName }}</td>
              <td class="pc-code">{{ r.orderCode }}</td>
              <td style="font-size: .85rem" :class="{ 'pc-flag': r.overdue }">{{ fmtDate(r.dueDate) }}</td>
              <td class="pc-num">{{ sar(r.total) }}</td>
              <td class="pc-num">{{ sar(r.total - r.outstanding) }}</td>
              <td class="pc-num"><b>{{ sar(r.outstanding) }}</b></td>
            </tr>
            <tr v-if="!d.open.length"><td colspan="7" class="pc-empty">لا توجد مستحقات مفتوحة.</td></tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
