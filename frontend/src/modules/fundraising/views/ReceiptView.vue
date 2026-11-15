<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import BrandMark from '../../../components/BrandMark.vue';
import { fmtDate, fmtNo, hijri, label, money, tafqeet } from '../labels';
import '../fr.css';

interface Receipt {
  organizationName: string; receiptNo: number; date: string; amount: number; opportunityNo: number; bankName: string | null; transferReference: string | null;
  purpose: string; isZakat: boolean; donor: { name: string; identifier: string | null; phone: string | null } | null;
  batches: { batchNo: number; targetKind: string; targetName: string; amount: number }[];
}
const route = useRoute();
const r = ref<Receipt | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    const c = route.query.collection as string | undefined;
    r.value = await api<Receipt>(`/fundraising/opportunities/${route.params.id}/receipt${c ? `?collection=${c}` : ''}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const print = () => window.print();
</script>

<template>
  <div>
    <div class="page-head no-print">
      <RouterLink :to="`/fundraising/opportunities/${route.params.id}`" class="btn">رجوع للفرصة</RouterLink>
      <button class="btn btn-primary" @click="print">طباعة السند</button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <article v-if="r" class="receipt">
      <div class="watermark">سند قبض</div>
      <header>
        <div class="org"><BrandMark :size="44" /><div><b>{{ r.organizationName }}</b><small>المملكة العربية السعودية</small></div></div>
        <div class="title"><h1>سند قبض</h1><span>Receipt Voucher</span></div>
        <div class="no"><span>رقم السند</span><b>{{ fmtNo('R', r.receiptNo) }}</b></div>
      </header>
      <div class="dates"><span>التاريخ: <b>{{ fmtDate(r.date) }}</b></span><span>الموافق: <b>{{ hijri(r.date) }}</b></span><span>فرصة التبرع: <b>{{ fmtNo('FR', r.opportunityNo) }}</b></span></div>
      <div class="amount-box"><span>المبلغ</span><b>{{ money(r.amount) }} <small>ريال سعودي</small></b></div>
      <dl>
        <div><dt>استلمنا من</dt><dd>{{ r.donor?.name }}<small v-if="r.donor?.identifier"> · {{ r.donor.identifier }}</small></dd></div>
        <div><dt>مبلغًا وقدره</dt><dd>{{ tafqeet(r.amount) }}</dd></div>
        <div><dt>وذلك عن</dt><dd>{{ r.purpose }}{{ r.isZakat ? ' (تُصرف في مصارف الزكاة الشرعية)' : '' }}</dd></div>
        <div><dt>طريقة الدفع</dt><dd>تحويل بنكي{{ r.bankName ? ` إلى ${r.bankName}` : '' }}{{ r.transferReference ? ` · مرجع ${r.transferReference}` : '' }}</dd></div>
      </dl>
      <table class="alloc">
        <thead><tr><th>الدفعة</th><th>التوجيه</th><th>المبلغ</th></tr></thead>
        <tbody><tr v-for="b in r.batches" :key="b.batchNo"><td>{{ fmtNo('B', b.batchNo) }}</td><td>{{ label('target', b.targetKind) }} · {{ b.targetName }}</td><td>{{ money(b.amount) }}</td></tr></tbody>
      </table>
      <footer>
        <div><span>المستلم</span><i /></div>
        <div><span>المدير المالي</span><i /></div>
        <div><span>الختم</span><i class="seal" /></div>
      </footer>
      <p class="thanks">جزاكم الله خيرًا وبارك في مالكم</p>
    </article>
  </div>
</template>

<style scoped>
.receipt { position: relative; overflow: hidden; max-width: 820px; margin: 0 auto; background: #fff; border-radius: 18px; padding: 30px 34px; border: 1px solid var(--border);
  box-shadow: 0 20px 50px rgba(6,20,26,.12); background-image: radial-gradient(500px 220px at 100% 0%, rgba(232,176,75,.12), transparent 70%), radial-gradient(500px 220px at 0% 100%, rgba(20,184,166,.1), transparent 70%); }
.receipt::before { content: ''; position: absolute; inset: 10px; border: 2px solid rgba(15,118,110,.25); border-radius: 12px; pointer-events: none; }
.watermark { position: absolute; inset: 0; display: grid; place-items: center; font-size: 7rem; font-weight: 800; color: rgba(15,118,110,.04); transform: rotate(-18deg); pointer-events: none; }
header { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; padding-bottom: 16px; border-bottom: 2px solid #0f766e; position: relative; }
.org { display: flex; align-items: center; gap: 10px; }
.org small { display: block; color: var(--muted); font-size: .8rem; }
.title { text-align: center; }
.title h1 { font-size: 1.7rem; color: #0f766e; }
.title span { color: var(--muted); font-size: .8rem; letter-spacing: 2px; }
.no { justify-self: end; text-align: center; padding: 6px 14px; border-radius: 10px; background: linear-gradient(135deg, #fef3c7, #fde68a); }
.no span { display: block; font-size: .75rem; color: #92400e; }
.no b { font-family: ui-monospace, Menlo, monospace; font-size: 1.1rem; color: #7c4a03; direction: ltr; display: block; }
.dates { display: flex; gap: 22px; flex-wrap: wrap; margin: 16px 0; font-size: .9rem; color: var(--muted); position: relative; }
.dates b { color: var(--text); }
.amount-box { position: relative; display: inline-flex; flex-direction: column; padding: 10px 22px; border-radius: 12px; background: var(--grad-dark); color: #fff; margin-bottom: 16px; }
.amount-box span { font-size: .8rem; color: #5eead4; }
.amount-box b { font-size: 1.6rem; }
.amount-box small { font-size: .85rem; font-weight: 500; }
dl { margin: 0; display: flex; flex-direction: column; gap: 0; position: relative; }
dl div { display: grid; grid-template-columns: 130px 1fr; gap: 10px; padding: 10px 0; border-bottom: 1px dashed var(--border); }
dt { color: var(--muted); }
dd { margin: 0; font-weight: 600; }
.alloc { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: .86rem; position: relative; }
.alloc th, .alloc td { padding: 6px 10px; border: 1px solid var(--border); text-align: right; }
.alloc th { background: var(--surface-2); color: var(--muted); font-weight: 500; }
footer { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 34px; position: relative; }
footer div { text-align: center; }
footer span { color: var(--muted); font-size: .86rem; }
footer i { display: block; height: 46px; border-bottom: 1px solid #94a3b8; margin-top: 8px; }
footer i.seal { width: 80px; height: 80px; border: 2px dashed #cbd5e1; border-radius: 50%; margin: 6px auto 0; }
.thanks { text-align: center; margin: 20px 0 0; color: #0f766e; font-weight: 600; position: relative; }
@media print {
  :global(.topbar), :global(header.app-header), :global(nav) { display: none !important; }
  .receipt { box-shadow: none; border: 0; max-width: none; }
}
@media (max-width: 640px) { header { grid-template-columns: 1fr; text-align: center; } .no { justify-self: center; } dl div { grid-template-columns: 1fr; gap: 2px; } .receipt { padding: 22px 18px; } }
</style>
