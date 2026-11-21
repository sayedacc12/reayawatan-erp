<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { INVOICE_COLOR, PR, fmtDate, sar } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const session = useSession();
const rows = ref<any[]>([]);
const lk = ref<any>(null);
const loading = ref(true);
const f = ref({ q: '', status: '', kind: '', view: String(route.query.view ?? '') });
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/procurement/invoices?${q}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  lk.value = await api('/procurement/invoice-lookups').catch(() => null);
  await load();
});
let t: ReturnType<typeof setTimeout>;
watch(() => f.value.q, () => { clearTimeout(t); t = setTimeout(load, 300); });
watch(() => [f.value.status, f.value.kind, f.value.view], load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>فواتير الموردين</h1>
        <p class="muted">يرفع المورد فاتورته من البوابة على تعميده، فتُطابق آليًا مع التعميد (السعر) والاستلام المعتمد (الكمية): المطابقة الثلاثية. تُعتمد المطابقة هنا وتُحال للنظام المالي ليسجل المستحق ويسدده.</p>
      </div>
      <div v-if="session.can(PR.invoices)"><button class="btn btn-primary" @click="router.push('/procurement/invoices/new')">تسجيل فاتورة ورقية</button></div>
    </div>
    <div class="pc-tabs" style="margin-bottom: 10px">
      <button :class="{ on: f.view === '' }" @click="f.view = ''">الكل</button>
      <button :class="{ on: f.view === 'review' }" @click="f.view = 'review'">بانتظار المطابقة</button>
      <button :class="{ on: f.view === 'open' }" @click="f.view = 'open'">محالة وغير مسددة</button>
      <button :class="{ on: f.view === 'overdue' }" @click="f.view = 'overdue'">متأخرة السداد</button>
    </div>
    <div class="pc-toolbar">
      <input v-model="f.q" class="input grow" placeholder="بحث برقم الفاتورة أو المورد أو التعميد" />
      <select v-model="f.kind" class="input"><option value="">فواتير وإشعارات</option><option v-for="(l, k) in lk?.kinds ?? {}" :key="k" :value="k">{{ l }}</option></select>
      <select v-model="f.status" class="input"><option value="">كل الحالات</option><option v-for="(l, k) in lk?.status ?? {}" :key="k" :value="k">{{ l }}</option></select>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>المورد</th><th>التعميد</th><th>التاريخ</th><th>الإجمالي</th><th>المتبقي</th><th>المطابقة</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="pc-row" @click="router.push(`/procurement/invoices/${r.id}`)">
            <td class="pc-code">{{ r.code }}<small class="pm-muted" style="display: block">{{ r.kindLabel }} · {{ r.supplierInvoiceNo }}</small></td>
            <td>{{ r.supplierName }}<small v-if="r.via === 'staff'" class="pm-muted" style="display: block">سُجلت ورقيًا</small></td>
            <td class="pc-code">{{ r.orderCode }}</td>
            <td style="font-size: .85rem">{{ fmtDate(r.invoiceDate) }}<small v-if="r.dueDate" :class="r.overdue ? 'pc-flag' : 'pm-muted'" style="display: block">يستحق {{ fmtDate(r.dueDate) }}</small></td>
            <td class="pc-num">{{ sar(r.total) }}</td>
            <td class="pc-num">{{ r.kind === 'invoice' && ['posted', 'partial', 'approved'].includes(r.status) ? sar(r.outstanding) : '—' }}</td>
            <td>
              <span v-if="r.matchOk === null || r.status === 'draft'" class="pm-muted">—</span>
              <span v-else-if="r.matchOk" class="pm-pill" style="--c: #059669">مطابقة</span>
              <span v-else class="pm-pill" :style="{ '--c': r.overridden ? '#7c3aed' : '#dc2626' }">{{ r.overridden ? 'معتمدة بتجاوز' : `${r.issues} استثناء` }}</span>
            </td>
            <td><span class="pm-pill" :style="{ '--c': INVOICE_COLOR[r.status] }">{{ r.statusLabel }}</span></td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="8" class="pc-empty">لا توجد فواتير.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
