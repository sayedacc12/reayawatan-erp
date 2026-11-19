<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { DOC_KIND_COLOR, STOCK_DOC_COLOR, fmtDate, fmtDateTime, fmtQty, sar, today } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const props = defineProps<{ id: string }>();
const router = useRouter();
const toast = useToast();
const d = ref<any>(null);
const busy = ref(false);
const modal = ref<'' | 'approve' | 'reject' | 'returnIn'>('');
const note = ref('');
const ret = ref<any>({ date: today(), lines: [] as any[] });
const base = () => `/procurement/stock-docs/${props.id}`;

async function load() {
  try {
    d.value = await api(base());
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
watch(() => props.id, load);

function openReturn() {
  ret.value = { date: today(), lines: d.value.lines.filter((l: any) => l.qty > l.returnedQty).map((l: any) => ({ ...l, max: l.qty - l.returnedQty, back: 0 })) };
  note.value = '';
  modal.value = 'returnIn';
}
async function confirm() {
  busy.value = true;
  try {
    if (modal.value === 'returnIn') {
      const lines = ret.value.lines.filter((l: any) => Number(l.back) > 0).map((l: any) => ({ itemId: l.itemId, qty: Number(l.back), refLineId: l.id }));
      if (!lines.length) throw new Error('اكتب الكمية المرتجعة لبند واحد على الأقل');
      const x = await api<any>('/procurement/stock-docs/return-in', { method: 'POST', json: { refId: props.id, date: ret.value.date, notes: note.value, lines } });
      toast.success(`سُجل المرتجع ${x.code} وعاد للمستودع`);
      modal.value = '';
      router.push(`/procurement/stock-docs/${x.id}`);
      return;
    }
    if (modal.value === 'approve') {
      d.value = await api(`${base()}/approve`, { method: 'POST', json: { note: note.value || null } });
      toast.success('اعتُمد الإتلاف وخرجت الكميات من الرصيد');
    } else {
      d.value = await api(`${base()}/reject`, { method: 'POST', json: { reason: note.value } });
      toast.success('رُفض محضر الإتلاف');
    }
    modal.value = '';
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const printPage = () => window.print();
</script>

<template>
  <div v-if="d">
    <div class="page-head">
      <div>
        <h1>{{ d.kindLabel }} {{ d.code }}</h1>
        <p class="muted">
          <span class="pm-pill" :style="{ '--c': DOC_KIND_COLOR[d.kind] }">{{ d.kindLabel }}</span> ·
          <span class="pm-pill" :style="{ '--c': STOCK_DOC_COLOR[d.status] }">{{ d.statusLabel }}</span> · {{ fmtDate(d.date) }}
        </p>
      </div>
      <div class="pc-inline pc-noprint">
        <template v-if="d.can.approve"><button class="btn btn-primary" @click="note = ''; modal = 'approve'">اعتماد الإتلاف</button></template>
        <button v-if="d.can.reject" class="btn btn-ghost" @click="note = ''; modal = 'reject'">{{ d.can.approve ? 'رفض' : 'سحب المحضر' }}</button>
        <button v-if="d.can.returnIn" class="btn" @click="openReturn">مرتجع من الجهة</button>
        <button class="btn" @click="printPage">طباعة</button>
      </div>
    </div>
    <div v-if="d.status === 'pending' && !d.can.approve" class="alert" style="background: #fffbeb">بانتظار اعتماد مسؤول لديه صلاحية اعتماد الإتلاف، غير من أعد المحضر.</div>
    <div v-if="d.cancelReason" class="alert alert-error">{{ d.cancelReason }}</div>

    <div class="pc-grid" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)">
      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <dl class="pc-dl">
            <div><dt>{{ d.toWarehouse ? 'من المستودع' : 'المستودع' }}</dt><dd>{{ d.warehouse.code }} · {{ d.warehouse.name }}</dd></div>
            <div v-if="d.toWarehouse"><dt>إلى المستودع</dt><dd>{{ d.toWarehouse.code }} · {{ d.toWarehouse.name }}</dd></div>
            <div v-if="d.issueRequest"><dt>طلب الصرف</dt><dd><RouterLink class="pm-link" :to="`/procurement/issue-requests/${d.issueRequest.id}`">{{ d.issueRequest.code }}</RouterLink> {{ d.issueRequest.purpose }}</dd></div>
            <div v-if="d.ref"><dt>المستند الأصلي</dt><dd><RouterLink class="pm-link" :to="d.ref.kind === 'receipt' ? `/procurement/receipts/${d.ref.id}` : `/procurement/stock-docs/${d.ref.id}`">{{ d.ref.code }}</RouterLink></dd></div>
            <div v-if="d.supplier"><dt>المورد</dt><dd>{{ d.supplier.name }}</dd></div>
            <div v-if="d.receiverName"><dt>المستلم</dt><dd>{{ d.receiverName }}</dd></div>
            <div v-if="d.unitName"><dt>الإدارة</dt><dd>{{ d.unitName }}</dd></div>
            <div v-if="d.projectName"><dt>المشروع</dt><dd>{{ d.projectName }}</dd></div>
            <div v-if="d.reasonLabel"><dt>سبب الإتلاف</dt><dd>{{ d.reasonLabel }}</dd></div>
            <div><dt>أعده</dt><dd>{{ d.createdByName }}</dd></div>
            <div v-if="d.approvedByName"><dt>اعتمده</dt><dd>{{ d.approvedByName }}</dd></div>
          </dl>
        </section>
        <section class="card pm-panel">
          <h2>البنود</h2>
          <table class="pc-lines">
            <thead><tr><th>الصنف</th><th>التشغيلة والصلاحية</th><th>الموقع</th><th>الكمية</th><th>القيمة</th></tr></thead>
            <tbody>
              <tr v-for="l in d.lines" :key="l.id">
                <td><b>{{ l.itemName }}</b> <span class="pc-code">{{ l.itemCode }}</span><small v-if="l.returnedQty" class="pc-warn" style="display: flex">أُرجع {{ fmtQty(l.returnedQty) }}</small></td>
                <td style="font-size: .82rem">{{ l.lot ?? '' }} {{ l.expiryDate ? fmtDate(l.expiryDate) : '' }}</td>
                <td style="font-size: .82rem">{{ l.locationName ?? '' }}<template v-if="l.toLocationName"> ← {{ l.toLocationName }}</template></td>
                <td class="pc-num">{{ fmtQty(l.qty) }}</td>
                <td class="pc-num">{{ d.status === 'pending' ? '—' : sar(l.value) }}</td>
              </tr>
            </tbody>
            <tfoot v-if="d.status !== 'pending'"><tr><td colspan="4"><b>الإجمالي</b></td><td class="pc-num"><b>{{ sar(d.total) }}</b></td></tr></tfoot>
          </table>
        </section>
        <section v-if="d.notes" class="card pm-panel"><h2>{{ d.kind === 'writeoff' ? 'تفاصيل الإتلاف' : 'ملاحظات' }}</h2><p style="white-space: pre-line; font-size: .9rem">{{ d.notes }}</p></section>
      </div>
      <div style="display: grid; gap: 16px; align-content: start" class="pc-noprint">
        <section class="card pm-panel">
          <h2>الأثر المالي</h2>
          <dl class="pc-dl" style="grid-template-columns: 1fr">
            <div><dt>سند المخازن</dt><dd><RouterLink v-if="d.entry" class="pm-link" :to="`/accounting/entries/${d.entry.id}`">قيد {{ d.entry.entryNo }} · سند {{ d.entry.voucherNo }}</RouterLink><span v-else>{{ d.status === 'pending' ? 'يصدر عند الاعتماد' : 'لا يلزم قيد (الحساب نفسه)' }}</span></dd></div>
            <div v-if="d.budgetBack"><dt>أُعيد لحجز الموازنة</dt><dd>{{ sar(d.budgetBack) }}</dd></div>
            <div v-if="d.fundingBack"><dt>أُعيد لمصدر التمويل</dt><dd>{{ sar(d.fundingBack) }}</dd></div>
          </dl>
        </section>
        <section v-if="d.returns.length" class="card pm-panel">
          <h2>المرتجعات</h2>
          <ul class="pc-log"><li v-for="x in d.returns" :key="x.id"><span><RouterLink class="pm-link" :to="`/procurement/stock-docs/${x.id}`">{{ x.code }}</RouterLink> · {{ fmtDate(x.date) }} · {{ sar(x.total) }}</span></li></ul>
        </section>
        <section class="card pm-panel">
          <h2>السجل</h2>
          <ul class="pc-log">
            <li v-for="(x, i) in [...d.log].reverse()" :key="i"><span><b>{{ x.action }}</b> · {{ x.byName }} <small class="pm-muted">{{ fmtDateTime(x.at) }}</small><div v-if="x.note" class="pm-muted" style="font-size: .8rem">{{ x.note }}</div></span></li>
          </ul>
        </section>
      </div>
    </div>

    <div v-if="modal" class="modal-backdrop" @click.self="modal = ''">
      <form class="card modal" :style="modal === 'returnIn' ? 'max-width: 640px' : ''" @submit.prevent="confirm">
        <h2>{{ { approve: 'اعتماد الإتلاف', reject: 'رفض محضر الإتلاف', returnIn: 'مرتجع من الجهة' }[modal] }}</h2>
        <p v-if="modal === 'approve'" class="pm-muted" style="font-size: .85rem">تخرج الكميات من الرصيد بتكلفتها، ويُحمّل المبلغ على حساب فروقات المخزون بسند مخازن.</p>
        <template v-if="modal === 'returnIn'">
          <p class="pm-muted" style="font-size: .85rem">تعود الكمية للمستودع بتكلفة صرفها، ويُعكس المصروف على مركز التكلفة نفسه.</p>
          <label class="field"><span>التاريخ</span><input v-model="ret.date" type="date" class="input" :max="today()" required /></label>
          <table class="pc-lines">
            <thead><tr><th>الصنف</th><th>المتاح للإرجاع</th><th style="width: 120px">المرتجع</th></tr></thead>
            <tbody><tr v-for="l in ret.lines" :key="l.id"><td>{{ l.itemName }} <small class="pm-muted">{{ l.lot ?? '' }}</small></td><td class="pc-num">{{ fmtQty(l.max) }}</td><td><input v-model.number="l.back" type="number" min="0" :max="l.max" step="any" class="input" /></td></tr></tbody>
          </table>
        </template>
        <label class="field"><span>{{ modal === 'approve' ? 'ملاحظة (اختياري)' : 'السبب' }}</span><textarea v-model="note" class="input" rows="3" :required="modal !== 'approve'" /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">تأكيد</button><button type="button" class="btn" @click="modal = ''">رجوع</button></div>
      </form>
    </div>
  </div>
</template>
