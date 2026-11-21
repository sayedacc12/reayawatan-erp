<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import CustomerForm from '../components/CustomerForm.vue';
import { BL, addressText, billingLookups, fmtDate, money, sar } from '../lib';
import '../../../shared/module.css';
import '../../procurement/procurement.css';
import '../billing.css';

const props = defineProps<{ id: string }>();
const router = useRouter();
const toast = useToast();
const session = useSession();
const c = ref<any>(null);
const st = ref<any>(null);
const lk = ref<any>(null);
const editing = ref(false);
const period = ref({ from: '', to: '' });
async function loadStatement() {
  const q = new URLSearchParams(Object.entries(period.value).filter(([, v]) => v) as [string, string][]);
  st.value = await api(`/billing/customers/${props.id}/statement?${q}`);
}
async function load() {
  try {
    c.value = await api(`/billing/customers/${props.id}`);
    await loadStatement();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(async () => {
  lk.value = await billingLookups().catch(() => null);
  await load();
});
watch(() => props.id, load);
const saved = (x: any) => {
  editing.value = false;
  c.value = x;
};
const printPage = () => window.print();
</script>

<template>
  <div v-if="c">
    <div class="page-head">
      <div>
        <h1>{{ c.name }}</h1>
        <p class="muted"><span class="pc-code">{{ c.code }}</span> · {{ c.kindLabel }} <span v-if="!c.isActive" class="pm-pill" style="--c: #94a3b8">موقوف</span></p>
      </div>
      <div class="pc-inline pc-noprint">
        <button v-if="session.can(BL.invoices) && c.isActive" class="btn btn-primary" @click="router.push(`/billing/invoices/new?customer=${c.id}`)">فاتورة جديدة</button>
        <button v-if="session.can(BL.customers)" class="btn" @click="editing = true">تعديل</button>
        <button class="btn" @click="printPage">طباعة الكشف</button>
      </div>
    </div>
    <section class="card pm-panel" style="margin-bottom: 16px">
      <dl class="pc-dl">
        <div><dt>الرقم الضريبي</dt><dd class="pc-code">{{ c.vatNumber ?? '—' }}</dd></div>
        <div v-if="c.idNumber"><dt>{{ c.idTypeLabel }}</dt><dd class="pc-code">{{ c.idNumber }}</dd></div>
        <div><dt>العنوان الوطني</dt><dd>{{ addressText(c.address) }}</dd></div>
        <div><dt>الجوال</dt><dd class="pc-code">{{ c.phone ?? '—' }}</dd></div>
        <div><dt>البريد</dt><dd class="pc-code">{{ c.email ?? '—' }}</dd></div>
        <div><dt>حساب الشريك في المالي</dt><dd>{{ c.partnerId ? 'مرتبط' : 'يُنشأ عند أول فاتورة' }}</dd></div>
      </dl>
      <p v-if="c.notes" class="pm-muted" style="white-space: pre-line; margin: 8px 0 0">{{ c.notes }}</p>
    </section>
    <section v-if="st" class="card pm-panel">
      <h2>كشف حساب العميل</h2>
      <div class="pc-toolbar pc-noprint">
        <label class="field"><span>من</span><input v-model="period.from" type="date" class="input" /></label>
        <label class="field"><span>إلى</span><input v-model="period.to" type="date" class="input" /></label>
        <button class="btn" style="align-self: end" @click="loadStatement">عرض</button>
      </div>
      <div class="table-wrap">
        <table class="bl-lines">
          <thead><tr><th>التاريخ</th><th>البيان</th><th>المستند</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
          <tbody>
            <tr v-if="st.from"><td colspan="5">رصيد أول المدة</td><td class="pc-num">{{ money(st.opening) }}</td></tr>
            <tr v-for="(l, i) in st.lines" :key="i">
              <td>{{ fmtDate(l.date) }}</td>
              <td>{{ l.kindLabel }}</td>
              <td><RouterLink class="pm-link" :to="`/billing/invoices/${l.docId}`">{{ l.doc }}</RouterLink><small v-if="l.kind === 'receipt'" class="pm-muted" style="display: block">{{ l.docCode }}</small></td>
              <td class="pc-num">{{ l.debit ? money(l.debit) : '' }}</td>
              <td class="pc-num">{{ l.credit ? money(l.credit) : '' }}</td>
              <td class="pc-num">{{ money(l.balance) }}</td>
            </tr>
            <tr v-if="!st.lines.length"><td colspan="6" class="pc-empty">لا توجد حركات في الفترة.</td></tr>
          </tbody>
          <tfoot><tr><td colspan="3">الإجمالي</td><td class="pc-num">{{ money(st.totals.debit) }}</td><td class="pc-num">{{ money(st.totals.credit) }}</td><td class="pc-num">{{ sar(st.closing) }}</td></tr></tfoot>
        </table>
      </div>
      <small class="pm-muted">التحصيلات من سندات القبض المعتمدة فقط.</small>
    </section>
    <CustomerForm v-if="editing && lk" :lk="lk" :customer="c" @saved="saved" @close="editing = false" />
  </div>
</template>
