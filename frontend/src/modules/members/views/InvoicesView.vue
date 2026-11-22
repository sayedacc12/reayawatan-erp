<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import StatusPill from '../components/StatusPill.vue';
import { INVOICE_STATUS, VOUCHER_STATUS, exportCsv, fmtDate, sar } from '../lib';
import '../../../shared/module.css';
import '../members.css';

interface Row {
  id: string; invoiceNo: string; kind: string; kindLabel: string; partyName: string; mobile: string; typeName: string; amount: number; dueDate: string; overdue: boolean;
  status: string; statusLabel: string; method: string | null; methodLabel: string | null; paidOn: string | null; memberId: string | null; applicationId: string | null;
  voucher: { id: string; serial: number; status: string } | null; voucherError: string | null; createdAt: string;
}
const route = useRoute();
const rows = ref<Row[]>([]);
const error = ref('');
const q = reactive({ status: (route.query.status as string) ?? '', kind: '', method: '', search: '' });

async function load() {
  try {
    const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    rows.value = await api<Row[]>(`/members/invoices?${params}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(() => ({ ...q }), () => {
  clearTimeout(timer);
  timer = setTimeout(load, 250);
});
const totals = computed(() => ({
  paid: rows.value.filter((r) => r.status === 'paid').reduce((a, r) => a + r.amount, 0),
  open: rows.value.filter((r) => r.status === 'unpaid' || r.status === 'review').reduce((a, r) => a + r.amount, 0),
  noVoucher: rows.value.filter((r) => r.status === 'paid' && !r.voucher).length,
}));
function exportRows() {
  exportCsv('مطالبات العضوية', ['رقم المطالبة', 'النوع', 'الاسم', 'الجوال', 'نوع العضوية', 'المبلغ', 'الاستحقاق', 'الحالة', 'طريقة السداد', 'تاريخ السداد', 'سند القبض'],
    rows.value.map((r) => [r.invoiceNo, r.kindLabel, r.partyName, r.mobile, r.typeName, r.amount, r.dueDate, r.statusLabel, r.methodLabel, r.paidOn, r.voucher?.serial]));
}
</script>

<template>
  <div>
    <section class="pm-hero mb-hero">
      <div><p class="pm-kicker">المالية</p><h1>المطالبات والمدفوعات</h1>
        <p class="pm-sub">مطالبات الاشتراك الجديدة والتجديد. يُسجل كل سداد تلقائيًا كسند قبض في النظام المالي، ويمر بمراحل اعتماد السندات المعتادة.</p></div>
      <div class="pm-actions"><button class="btn mb-ghost" @click="exportRows">تصدير Excel</button></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #10b981; --i: 0"><span>المسدد في القائمة</span><strong>{{ sar(totals.paid) }}</strong></div>
      <div class="pm-kpi" style="--a: #f59e0b; --i: 1"><span>بانتظار السداد</span><strong>{{ sar(totals.open) }}</strong></div>
      <div class="pm-kpi" style="--a: #ef4444; --i: 2"><span>مسددة بلا سند قبض</span><strong>{{ totals.noVoucher }}</strong><small>أكمل الربط المالي ثم أعد المحاولة</small></div>
    </div>
    <div class="mb-toolbar">
      <input v-model="q.search" class="input grow" placeholder="بحث بالاسم أو رقم المطالبة أو الهوية أو الجوال" />
      <select v-model="q.status" class="input"><option value="">كل الحالات</option><option v-for="s in INVOICE_STATUS" :key="s.value" :value="s.value">{{ s.label }}</option></select>
      <select v-model="q.kind" class="input"><option value="">جديدة وتجديد</option><option value="new">اشتراك جديد</option><option value="renewal">تجديد</option></select>
      <select v-model="q.method" class="input"><option value="">كل طرق السداد</option><option value="online">دفع إلكتروني</option><option value="transfer">تحويل بنكي</option><option value="cash">نقدًا</option></select>
    </div>
    <section class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>المطالبة</th><th>العضو أو المتقدم</th><th>المبلغ</th><th>السداد</th><th>سند القبض</th><th>الحالة</th></tr></thead>
          <TransitionGroup tag="tbody" name="page">
            <tr v-for="r in rows" :key="r.id" class="mb-row" @click="$router.push(`/members/invoices/${r.id}`)">
              <td class="mb-code">{{ r.invoiceNo }}<span class="pm-muted" style="display: block">{{ r.kindLabel }} · {{ fmtDate(r.createdAt) }}</span></td>
              <td><b>{{ r.partyName }}</b><span class="pm-muted" style="display: block">{{ r.typeName }} · <span class="mb-code">{{ r.mobile }}</span></span></td>
              <td><b>{{ sar(r.amount) }}</b></td>
              <td><template v-if="r.paidOn">{{ fmtDate(r.paidOn) }}<span class="pm-muted" style="display: block">{{ r.methodLabel }}</span></template>
                <span v-else :class="r.overdue ? 'pm-viol' : 'pm-muted'">يستحق {{ fmtDate(r.dueDate) }}</span></td>
              <td><span v-if="r.voucher" class="mb-code">#{{ r.voucher.serial }} · {{ VOUCHER_STATUS[r.voucher.status] ?? r.voucher.status }}</span>
                <span v-else-if="r.voucherError" class="pm-viol" :title="r.voucherError">لم يُنشأ</span><span v-else class="pm-muted">—</span></td>
              <td><StatusPill :status="r.status" :label="r.statusLabel" /></td>
            </tr>
            <tr v-if="!rows.length" key="empty"><td colspan="6" class="pm-empty">لا توجد مطالبات بهذه التصفية</td></tr>
          </TransitionGroup>
        </table>
      </div>
    </section>
  </div>
</template>
