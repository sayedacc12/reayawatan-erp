<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ORDER_COLOR, fmtDate, fmtDateTime, sar } from '../modules/procurement/lib';
import { supplierApi } from './supplier';

const route = useRoute();
const id = computed(() => route.params.id as string);
const o = ref<any>(null);
const busy = ref(false);
const error = ref('');
const ok = ref('');
const action = ref<'' | 'clarify' | 'decline'>('');
const note = ref('');
onMounted(async () => {
  try {
    o.value = await supplierApi(`/orders/${id.value}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const MSG: Record<string, string> = { acknowledge: 'أُكد استلام التعميد', accept: 'قُبل التعميد ✓', clarify: 'أُرسل طلب التوضيح للجمعية', decline: 'أُبلغت الجمعية باعتذاركم' };
async function respond(a: string, n: string | null = null) {
  busy.value = true;
  error.value = '';
  ok.value = '';
  try {
    o.value = await supplierApi(`/orders/${id.value}/respond`, { method: 'POST', json: { action: a, note: n } });
    ok.value = MSG[a];
    action.value = '';
    note.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const RESP: Record<string, string> = { acknowledge: 'تأكيد الاستلام', accept: 'قبول التعميد', clarify: 'طلب توضيح', decline: 'اعتذار', reply: 'رد الجمعية' };
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="ok" class="alert alert-success">{{ ok }}</div>
    <template v-if="o">
      <div class="page-head">
        <div><h1>{{ o.title }}</h1><p class="muted"><span class="pc-code">{{ o.code }}</span><span v-if="o.version > 1"> (إصدار {{ o.version }})</span> · {{ o.organizationName }} · صدر {{ fmtDateTime(o.issuedAt) }} · <span class="pm-pill" :style="{ '--c': ORDER_COLOR[o.status] }">{{ o.statusLabel }}</span></p></div>
        <div class="pc-inline">
          <button v-if="o.can.acknowledge" class="btn" :disabled="busy" @click="respond('acknowledge')">تأكيد الاستلام</button>
          <button v-if="o.can.accept" class="btn btn-primary" :disabled="busy" @click="respond('accept')">قبول التعميد</button>
          <button v-if="o.can.clarify" class="btn" @click="action = 'clarify'">طلب توضيح</button>
          <button v-if="o.can.decline" class="btn btn-ghost" @click="action = 'decline'">اعتذار</button>
        </div>
      </div>
      <div v-if="o.cancelReason" class="alert alert-error">أُلغي التعميد: {{ o.cancelReason }}</div>
      <div class="pc-grid" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)">
        <div style="display: grid; gap: 16px; align-content: start">
          <section class="card pm-panel">
            <div class="table-wrap">
              <table class="pc-lines">
                <thead><tr><th>#</th><th>البند</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
                <tbody><tr v-for="(l, i) in o.lines" :key="i"><td>{{ i + 1 }}</td><td><b>{{ l.description }}</b></td><td class="pc-num">{{ l.qty }} {{ l.uomName ?? '' }}</td><td class="pc-num">{{ sar(l.unitPrice) }}</td><td class="pc-num">{{ sar(l.total) }}</td></tr></tbody>
                <tfoot>
                  <tr><td colspan="4">قبل الضريبة</td><td class="pc-num">{{ sar(o.subtotal) }}</td></tr>
                  <tr><td colspan="4">ضريبة القيمة المضافة {{ o.vatRate }}%</td><td class="pc-num">{{ sar(o.vat) }}</td></tr>
                  <tr><td colspan="4"><b>الإجمالي</b></td><td class="pc-num"><b>{{ sar(o.total) }}</b></td></tr>
                </tfoot>
              </table>
            </div>
          </section>
          <section v-if="o.terms" class="card pm-panel"><h2>الشروط</h2><p style="white-space: pre-line; font-size: .9rem">{{ o.terms }}</p></section>
        </div>
        <div style="display: grid; gap: 16px; align-content: start">
          <section class="card pm-panel">
            <h2>التسليم</h2>
            <dl class="pc-dl" style="grid-template-columns: 1fr">
              <div><dt>التاريخ</dt><dd>{{ fmtDate(o.deliveryDate) }}</dd></div>
              <div><dt>المكان</dt><dd>{{ o.warehouse ? `${o.warehouse.name}${o.warehouse.city ? ` · ${o.warehouse.city}` : ''}${o.warehouse.address ? ` · ${o.warehouse.address}` : ''}` : '' }} {{ o.deliveryPlace ?? '' }}</dd></div>
              <div v-if="o.beneficiaryRef"><dt>مرجع المستفيد</dt><dd class="pc-code">{{ o.beneficiaryRef }}</dd></div>
            </dl>
          </section>
          <section class="card pm-panel">
            <h2>المراسلات</h2>
            <ul class="pc-log">
              <li v-for="(x, i) in o.responses" :key="i"><span><b>{{ RESP[x.action] }}</b> · {{ x.byName }} <small class="pm-muted">{{ fmtDateTime(x.at) }}</small><div v-if="x.note" style="font-size: .85rem">{{ x.note }}</div></span></li>
              <li v-if="!o.responses.length" class="pm-muted">لا توجد ردود بعد</li>
            </ul>
          </section>
        </div>
      </div>
      <div v-if="action" class="modal-backdrop" @click.self="action = ''">
        <form class="card modal" @submit.prevent="respond(action, note)">
          <h2>{{ action === 'clarify' ? 'طلب توضيح' : 'الاعتذار عن التنفيذ' }}</h2>
          <label class="field"><span>{{ action === 'clarify' ? 'ما الذي تحتاجون توضيحه؟' : 'سبب الاعتذار' }}</span><textarea v-model="note" class="input" rows="3" required minlength="3" /></label>
          <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">إرسال</button><button type="button" class="btn" @click="action = ''">رجوع</button></div>
        </form>
      </div>
    </template>
  </div>
</template>
