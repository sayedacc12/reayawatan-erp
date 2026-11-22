<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { BL, DOC_COLOR, TYPE_COLOR, billingLookups, fmtDate, sar } from '../lib';
import '../../../shared/module.css';
import '../../procurement/procurement.css';
import '../billing.css';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const session = useSession();
const rows = ref<any[]>([]);
const lk = ref<any>(null);
const loading = ref(true);
const f = ref({ q: '', status: '', kind: '', docType: '', view: String(route.query.view ?? '') });
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/billing/documents?${q}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  lk.value = await billingLookups().catch(() => null);
  await load();
});
let t: ReturnType<typeof setTimeout>;
watch(() => f.value.q, () => { clearTimeout(t); t = setTimeout(load, 300); });
watch(() => [f.value.status, f.value.kind, f.value.docType, f.value.view], load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>فواتير المبيعات والإشعارات</h1>
        <p class="muted">تُعدّ الفاتورة مسودة ثم تُرسل للإصدار، ويصدرها موظف آخر فيثبت رقمها وعدادها ورمز QR ويُنشأ قيدها. الفاتورة الصادرة لا تُعدّل ولا تُلغى، وتُصحح بإشعار دائن أو مدين.</p>
      </div>
      <div v-if="session.can(BL.invoices)"><button class="btn btn-primary" @click="router.push('/billing/invoices/new')">فاتورة جديدة</button></div>
    </div>
    <div class="pc-tabs" style="margin-bottom: 10px">
      <button :class="{ on: f.view === '' }" @click="f.view = ''">الكل</button>
      <button :class="{ on: f.view === 'drafts' }" @click="f.view = 'drafts'">المسودات</button>
      <button :class="{ on: f.view === 'pending' }" @click="f.view = 'pending'">بانتظار الإصدار</button>
      <button :class="{ on: f.view === 'open' }" @click="f.view = 'open'">غير محصلة</button>
      <button :class="{ on: f.view === 'overdue' }" @click="f.view = 'overdue'">متأخرة السداد</button>
    </div>
    <div class="pc-toolbar">
      <input v-model="f.q" class="input grow" placeholder="بحث برقم المستند أو اسم العميل" />
      <select v-model="f.kind" class="input"><option value="">فواتير وإشعارات</option><option v-for="(l, k) in lk?.docKinds ?? {}" :key="k" :value="k">{{ l }}</option></select>
      <select v-model="f.docType" class="input"><option value="">كل الأنواع</option><option v-for="(l, k) in lk?.docTypes ?? {}" :key="k" :value="k">{{ l }}</option></select>
      <select v-model="f.status" class="input"><option value="">كل الحالات</option><option v-for="(l, k) in lk?.docStatus ?? {}" :key="k" :value="k">{{ l }}</option></select>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>العميل</th><th>التاريخ</th><th>الصافي</th><th>الضريبة</th><th>الإجمالي</th><th>المتبقي</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="pc-row" :class="{ off: r.status === 'cancelled' }" @click="router.push(`/billing/invoices/${r.id}`)">
            <td class="pc-code">{{ r.code }}<small class="pm-muted" style="display: block; direction: rtl">{{ r.kind === 'invoice' ? '' : `${r.kindLabel} على ${r.refCode} · ` }}<span :style="{ color: TYPE_COLOR[r.docType] }">{{ r.typeLabel }}</span></small></td>
            <td>{{ r.customerName ?? 'عميل نقدي' }}</td>
            <td style="font-size: .85rem">{{ fmtDate(r.issueDate) }}<small v-if="r.dueDate && r.kind === 'invoice' && r.icv" :class="r.overdue ? 'pc-flag' : 'pm-muted'" style="display: block">يستحق {{ fmtDate(r.dueDate) }}</small></td>
            <td class="pc-num">{{ sar(r.taxable) }}</td>
            <td class="pc-num">{{ sar(r.vat) }}</td>
            <td class="pc-num"><b>{{ sar(r.total) }}</b></td>
            <td class="pc-num">{{ r.kind === 'invoice' && ['issued', 'partial'].includes(r.status) ? sar(r.outstanding) : '—' }}<small v-if="r.pendingCollect" class="pm-muted" style="display: block">{{ sar(r.pendingCollect) }} قيد الاعتماد</small></td>
            <td><span class="pm-pill" :style="{ '--c': DOC_COLOR[r.status] }">{{ r.statusLabel }}</span></td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="8" class="pc-empty">لا توجد مستندات.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
