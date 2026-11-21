<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { RECEIPT_COLOR, RECEIPT_KIND_COLOR, STOCK_DOC_COLOR, fmtDate, fmtDateTime, fmtQty, sar, today } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

const props = defineProps<{ id: string }>();
const router = useRouter();
const toast = useToast();
const r = ref<any>(null);
const busy = ref(false);
const modal = ref<'' | 'cancel' | 'return'>('');
const note = ref('');
const ret = ref<any>({ date: today(), lines: [] as any[] });

async function load() {
  try {
    r.value = await api(`/procurement/receipts/${props.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
watch(() => props.id, load);

function openReturn() {
  ret.value = {
    date: today(),
    lines: r.value.lines.filter((l: any) => l.treatment === 'stock' && l.acceptedQty > l.returnedQty).map((l: any) => ({ ...l, max: l.acceptedQty - l.returnedQty, back: 0 })),
  };
  note.value = '';
  modal.value = 'return';
}
async function confirm() {
  busy.value = true;
  try {
    if (modal.value === 'cancel') {
      r.value = await api(`/procurement/receipts/${props.id}/cancel`, { method: 'POST', json: { reason: note.value } });
      toast.success('أُلغي الاستلام وعُكست حركاته وقيده');
    } else {
      const lines = ret.value.lines.filter((l: any) => Number(l.back) > 0).map((l: any) => ({ itemId: l.itemId, qty: Number(l.back), refLineId: l.id, lot: l.lot }));
      if (!lines.length) throw new Error('اكتب الكمية المرتجعة لبند واحد على الأقل');
      const d = await api<any>('/procurement/stock-docs/return-supplier', { method: 'POST', json: { refId: props.id, date: ret.value.date, notes: note.value, lines } });
      toast.success(`صدر مرتجع المورد ${d.code}`);
      router.push(`/procurement/stock-docs/${d.id}`);
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
  <div v-if="r">
    <div class="page-head">
      <div>
        <h1>محضر استلام {{ r.code }}</h1>
        <p class="muted">
          <span class="pm-pill" :style="{ '--c': RECEIPT_KIND_COLOR[r.kind] }">{{ r.kindLabel }}</span> ·
          <span class="pm-pill" :style="{ '--c': RECEIPT_COLOR[r.status] }">{{ r.statusLabel }}</span> · {{ fmtDate(r.date) }}
        </p>
      </div>
      <div class="pc-inline pc-noprint">
        <button v-if="r.can.returnToSupplier" class="btn" @click="openReturn">إرجاع للمورد</button>
        <button class="btn" @click="printPage">طباعة</button>
        <button v-if="r.can.cancel" class="btn btn-ghost" @click="note = ''; modal = 'cancel'">إلغاء الاستلام</button>
      </div>
    </div>
    <div v-if="r.status === 'cancelled'" class="alert alert-error">أُلغي الاستلام: {{ r.cancelReason }}</div>

    <div class="pc-grid" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)">
      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <dl class="pc-dl">
            <div v-if="r.order"><dt>التعميد</dt><dd><RouterLink class="pm-link" :to="`/procurement/orders/${r.order.id}`">{{ r.order.code }}</RouterLink> {{ r.order.title }}</dd></div>
            <div v-if="r.supplier"><dt>المورد</dt><dd><RouterLink class="pm-link" :to="`/procurement/suppliers/${r.supplier.id}`">{{ r.supplier.name }}</RouterLink></dd></div>
            <div v-if="r.donorName"><dt>المتبرع</dt><dd>{{ r.donorName }}</dd></div>
            <div><dt>المستودع</dt><dd>{{ r.warehouse ? `${r.warehouse.code} · ${r.warehouse.name}` : 'تسليم مباشر' }}</dd></div>
            <div v-if="r.deliveryRef"><dt>{{ r.kind === 'donation' ? 'مرجع التبرع' : 'إشعار التسليم' }}</dt><dd class="pc-code">{{ r.deliveryRef }}</dd></div>
            <div><dt>المستلم</dt><dd>{{ r.createdByName }}</dd></div>
            <div v-if="r.extraCost"><dt>مصاريف النقل والتخليص</dt><dd>{{ sar(r.extraCost) }}<small v-if="r.extraNote" class="pm-muted"> · {{ r.extraNote }}</small></dd></div>
          </dl>
        </section>
        <section class="card pm-panel">
          <h2>البنود</h2>
          <div class="table-wrap">
            <table class="pc-lines">
              <thead><tr><th>البند</th><th>المعالجة</th><th>المسلّم</th><th>المقبول</th><th>المرفوض</th><th>التشغيلة والصلاحية</th><th>التكلفة</th></tr></thead>
              <tbody>
                <tr v-for="l in r.lines" :key="l.id">
                  <td>
                    <b>{{ l.description }}</b> <span class="pc-code">{{ l.itemCode ?? '' }}</span>
                    <span v-if="l.account" class="pm-muted" style="display: block; font-size: .76rem">{{ l.account.code }} · {{ l.account.name }}</span>
                    <span v-for="x in l.assets" :key="x.id" class="pc-okflag" style="margin-inline-end: 4px">أصل {{ x.code }}</span>
                  </td>
                  <td style="font-size: .82rem">{{ l.treatmentLabel }}</td>
                  <td class="pc-num">{{ fmtQty(l.qty) }} {{ l.uomName ?? '' }}</td>
                  <td class="pc-num">{{ fmtQty(l.acceptedQty) }}<small v-if="l.returnedQty" class="pc-warn" style="display: flex">أُرجع {{ fmtQty(l.returnedQty) }}</small></td>
                  <td class="pc-num">{{ l.rejectedQty ? fmtQty(l.rejectedQty) : '—' }}<small v-if="l.rejectReason" class="pm-muted" style="display: block">{{ l.rejectReason }}</small></td>
                  <td style="font-size: .82rem">{{ l.lot ?? '' }} {{ l.expiryDate ? fmtDate(l.expiryDate) : '' }}<span v-if="l.locationName" class="pm-muted" style="display: block">{{ l.locationName }}</span></td>
                  <td class="pc-num">{{ sar(l.value) }}<small class="pm-muted" style="display: block">{{ sar(l.unitPrice + l.extraUnit) }} للوحدة</small></td>
                </tr>
              </tbody>
              <tfoot><tr><td colspan="6"><b>الإجمالي</b></td><td class="pc-num"><b>{{ sar(r.total) }}</b></td></tr></tfoot>
            </table>
          </div>
        </section>
        <section v-if="r.inspection" class="card pm-panel">
          <h2>محضر لجنة الاستلام والفحص</h2>
          <dl class="pc-dl">
            <div><dt>النتيجة</dt><dd><b>{{ r.inspectionLabel }}</b></dd></div>
            <div><dt>أعضاء اللجنة</dt><dd>{{ r.inspection.committee.join('، ') }}</dd></div>
            <div><dt>سُجل بواسطة</dt><dd>{{ r.inspection.byName }} · {{ fmtDateTime(r.inspection.at) }}</dd></div>
          </dl>
          <p v-if="r.inspection.note" style="white-space: pre-line; font-size: .9rem; margin-top: 8px">{{ r.inspection.note }}</p>
        </section>
        <section v-if="r.notes" class="card pm-panel"><h2>ملاحظات</h2><p style="white-space: pre-line; font-size: .9rem">{{ r.notes }}</p></section>
      </div>

      <div style="display: grid; gap: 16px; align-content: start" class="pc-noprint">
        <section class="card pm-panel">
          <h2>الأثر المالي</h2>
          <dl class="pc-dl" style="grid-template-columns: 1fr">
            <div><dt>سند المخازن</dt><dd><RouterLink v-if="r.entry" class="pm-link" :to="`/accounting/entries/${r.entry.id}`">قيد {{ r.entry.entryNo }} · سند {{ r.entry.voucherNo }}</RouterLink><span v-else>—</span></dd></div>
            <div v-if="r.consumed"><dt>المستهلك من حجز الموازنة</dt><dd>{{ sar(r.consumed) }}</dd></div>
            <div v-if="r.fundingSpent"><dt>المصروف من مصدر التمويل</dt><dd>{{ sar(r.fundingSpent) }}</dd></div>
          </dl>
          <p class="pm-muted" style="font-size: .78rem; margin-top: 8px">القيد يصدر من المستودعات ويظهر في النظام المالي للاطلاع، ولا يُعدل أو يُلغى إلا بإلغاء الاستلام من هنا.</p>
        </section>
        <section v-if="r.returns.length" class="card pm-panel">
          <h2>المرتجعات للمورد</h2>
          <ul class="pc-log">
            <li v-for="d in r.returns" :key="d.id"><span><RouterLink class="pm-link" :to="`/procurement/stock-docs/${d.id}`">{{ d.code }}</RouterLink> · {{ fmtDate(d.date) }} · {{ sar(d.total) }} <span class="pm-pill" :style="{ '--c': STOCK_DOC_COLOR[d.status] }">{{ d.status === 'posted' ? 'مرحّل' : 'ملغى' }}</span></span></li>
          </ul>
        </section>
        <section class="card pm-panel">
          <h2>السجل</h2>
          <ul class="pc-log">
            <li v-for="(x, i) in [...r.log].reverse()" :key="i"><span><b>{{ x.action }}</b> · {{ x.byName }} <small class="pm-muted">{{ fmtDateTime(x.at) }}</small><div v-if="x.note" class="pm-muted" style="font-size: .8rem">{{ x.note }}</div></span></li>
          </ul>
        </section>
      </div>
    </div>

    <div v-if="modal" class="modal-backdrop" @click.self="modal = ''">
      <form class="card modal" :style="modal === 'return' ? 'max-width: 680px' : ''" @submit.prevent="confirm">
        <h2>{{ modal === 'cancel' ? 'إلغاء الاستلام' : 'إرجاع للمورد' }}</h2>
        <p v-if="modal === 'cancel'" class="pm-muted" style="font-size: .85rem">يُلغى الاستلام إذا لم يُصرف شيء من كمياته، وتُعكس حركات المستودع وسند المخازن والأصول المنشأة، ويعود المبلغ لحجز الموازنة ومصدر التمويل.</p>
        <template v-else>
          <p class="pm-muted" style="font-size: .85rem">تخرج الكمية من المستودع بتكلفة الاستلام، ويُعاد مبلغها لحجز الموازنة ومصدر التمويل، ويعود التعميد لحالة «مستلم جزئيًا».</p>
          <label class="field"><span>تاريخ الإرجاع</span><input v-model="ret.date" type="date" class="input" :max="today()" required /></label>
          <table class="pc-lines">
            <thead><tr><th>البند</th><th>المتاح للإرجاع</th><th style="width: 120px">الكمية المرتجعة</th></tr></thead>
            <tbody><tr v-for="l in ret.lines" :key="l.id"><td>{{ l.description }} <small class="pm-muted">{{ l.lot ?? '' }}</small></td><td class="pc-num">{{ fmtQty(l.max) }}</td><td><input v-model.number="l.back" type="number" min="0" :max="l.max" step="any" class="input" /></td></tr></tbody>
          </table>
        </template>
        <label class="field"><span>السبب</span><textarea v-model="note" class="input" rows="3" required minlength="3" /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">تأكيد</button><button type="button" class="btn" @click="modal = ''">رجوع</button></div>
      </form>
    </div>
  </div>
</template>
