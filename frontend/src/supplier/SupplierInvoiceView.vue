<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import InvoiceEditor from '../modules/procurement/components/InvoiceEditor.vue';
import { INVOICE_COLOR, fmtDate, fmtDateTime, fmtQty, fmtSize, invoiceForm, invoicePayload, sar } from '../modules/procurement/lib';
import { openSupplierFile, supplierApi, supplierUpload } from './supplier';

/** رفع فاتورة جديدة على تعميد، أو متابعة فاتورة: تعديلها وهي مسودة أو معادة، والمرفقات والاستفسارات والسداد */
const route = useRoute();
const router = useRouter();
const slug = computed(() => route.params.slug as string);
const id = computed(() => (route.params.id as string | undefined) ?? null);
const orders = ref<any[]>([]);
const orderId = ref(String(route.query.order ?? ''));
const billable = ref<any>(null);
const form = ref<any>(null);
const d = ref<any>(null);
const busy = ref(false);
const error = ref('');
const ok = ref('');
const msg = ref('');

async function loadBillable() {
  billable.value = null;
  form.value = null;
  if (!orderId.value) return;
  try {
    billable.value = await supplierApi(`/billable/${orderId.value}`);
    form.value = invoiceForm(billable.value);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function show(v: any) {
  d.value = v;
  billable.value = v.billable;
  form.value = v.can.edit && v.billable ? invoiceForm(v.billable, v) : null;
}
async function load() {
  error.value = '';
  try {
    if (id.value) show(await supplierApi(`/invoices/${id.value}`));
    else {
      orders.value = await supplierApi('/billable');
      await loadBillable();
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(orderId, () => { if (!id.value) loadBillable(); });
watch(id, load);

async function run(fn: () => Promise<any>, done: string) {
  busy.value = true;
  error.value = '';
  ok.value = '';
  try {
    const v = await fn();
    if (v) show(v);
    ok.value = done;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function save(submit: boolean) {
  busy.value = true;
  error.value = '';
  ok.value = '';
  try {
    const body = invoicePayload(form.value);
    let v = id.value
      ? await supplierApi(`/invoices/${id.value}`, { method: 'PUT', json: body })
      : await supplierApi('/invoices', { method: 'POST', json: body });
    if (submit) v = await supplierApi(`/invoices/${v.id}/submit`, { method: 'POST', json: {} });
    if (!id.value) await router.replace(`/supplier/${slug.value}/invoices/${v.id}`);
    show(v);
    ok.value = submit ? 'أُرسلت الفاتورة للجمعية للمطابقة ✓' : 'حُفظت المسودة. أرفق صورة الفاتورة ثم أرسلها.';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const cancel = () => run(() => supplierApi(`/invoices/${id.value}/cancel`, { method: 'POST', json: {} }), 'أُلغيت المسودة');
const send = () => run(async () => {
  const v = await supplierApi(`/invoices/${id.value}/messages`, { method: 'POST', json: { text: msg.value } });
  msg.value = '';
  return v;
}, 'أُرسل الاستفسار');
async function addFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) await run(() => supplierUpload(`/invoices/${id.value}/files`, file, {}), 'أُرفق الملف');
}
const removeFile = (key: string) => run(() => supplierApi(`/invoices/${id.value}/files/${key}`, { method: 'DELETE' }), 'حُذف المرفق');
const openFile = (key: string) => openSupplierFile(`/invoices/${id.value}/files/${key}`).catch((e) => (error.value = (e as Error).message));
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="ok" class="alert alert-success">{{ ok }}</div>

    <template v-if="!id">
      <div class="page-head"><div><h1>رفع فاتورة</h1><p class="muted">اختر التعميد، ثم أدخل الكميات المفوترة بحسب ما استلمته الجمعية وقبلته.</p></div></div>
      <section class="card pm-panel" style="margin-bottom: 14px">
        <label class="field"><span>التعميد</span>
          <select v-model="orderId" class="input"><option value="">اختر التعميد…</option><option v-for="o in orders" :key="o.id" :value="o.id">{{ o.code }} · {{ o.title }} ({{ sar(o.total) }})</option></select>
        </label>
        <p v-if="!orders.length" class="pm-muted" style="margin: 6px 0 0">لا توجد تعميدات قابلة للفوترة حاليًا.</p>
      </section>
    </template>

    <template v-else-if="d">
      <div class="page-head">
        <div>
          <h1>{{ d.kindLabel }} {{ d.supplierInvoiceNo }}</h1>
          <p class="muted"><span class="pc-code">{{ d.code }}</span> · التعميد {{ d.order.code }} · <span class="pm-pill" :style="{ '--c': INVOICE_COLOR[d.status] }">{{ d.statusLabel }}</span></p>
        </div>
        <div class="pc-inline">
          <button v-if="d.can.cancel" class="btn btn-ghost" :disabled="busy" @click="cancel">إلغاء المسودة</button>
          <button class="btn btn-ghost" @click="router.push(`/supplier/${slug}/invoices`)">الفواتير</button>
        </div>
      </div>
      <div v-if="d.returnReason && ['returned', 'rejected'].includes(d.status)" class="alert alert-error">{{ d.statusLabel }}: {{ d.returnReason }}</div>
      <div v-if="d.match && !d.match.ok && ['draft', 'returned'].includes(d.status)" class="alert" style="background: #fffbeb">
        <b>ملاحظات المطابقة:</b>
        <ul style="margin: 4px 0 0"><li v-for="(x, i) in d.match.issues" :key="i">{{ x.message }}</li></ul>
      </div>
    </template>

    <form v-if="form" @submit.prevent="save(false)">
      <InvoiceEditor :billable="billable" :form="form" />
      <div class="pc-inline" style="margin-top: 14px">
        <button class="btn" :disabled="busy">حفظ مسودة</button>
        <button type="button" class="btn btn-primary" :disabled="busy" @click="save(true)">حفظ وإرسال للجمعية</button>
      </div>
    </form>

    <div v-if="d" class="pc-grid" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); margin-top: 16px">
      <div style="display: grid; gap: 16px; align-content: start">
        <section v-if="!form" class="card pm-panel">
          <h2>البنود</h2>
          <table class="pc-lines">
            <thead><tr><th>البند</th><th>الكمية</th><th>سعر الوحدة</th><th>المبلغ</th></tr></thead>
            <tbody>
              <tr v-for="(l, i) in d.lines" :key="i"><td>{{ l.description }}</td><td class="pc-num">{{ fmtQty(l.qty) }}</td><td class="pc-num">{{ l.unitPrice }}</td><td class="pc-num">{{ sar(l.amount) }}</td></tr>
              <tr v-if="d.extraAmount"><td colspan="3">مصاريف نقل وتخليص</td><td class="pc-num">{{ sar(d.extraAmount) }}</td></tr>
              <tr><td colspan="3">قبل الضريبة</td><td class="pc-num">{{ sar(d.subtotal) }}</td></tr>
              <tr><td colspan="3">الضريبة {{ d.vatRate }}%</td><td class="pc-num">{{ sar(d.vat) }}</td></tr>
              <tr><td colspan="3"><b>الإجمالي</b></td><td class="pc-num"><b>{{ sar(d.total) }}</b></td></tr>
            </tbody>
          </table>
        </section>
        <section class="card pm-panel">
          <h2>الاستفسارات</h2>
          <ul class="pc-log">
            <li v-for="(m, i) in d.messages" :key="i"><span><b>{{ m.from === 'supplier' ? 'أنتم' : 'الجمعية' }}: {{ m.byName }}</b> <small class="pm-muted">{{ fmtDateTime(m.at) }}</small><div style="white-space: pre-line">{{ m.text }}</div></span></li>
            <li v-if="!d.messages.length" class="pm-muted">لا توجد استفسارات.</li>
          </ul>
          <form class="pc-inline" style="margin-top: 8px" @submit.prevent="send">
            <input v-model="msg" class="input grow" maxlength="2000" minlength="2" required placeholder="اكتب استفسارك للجمعية" />
            <button class="btn" :disabled="busy">إرسال</button>
          </form>
        </section>
      </div>
      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2>المرفقات</h2>
          <ul class="pc-log">
            <li v-for="f in d.attachments" :key="f.key"><span><a class="pm-link" href="#" @click.prevent="openFile(f.key)">{{ f.name }}</a> <small class="pm-muted">{{ fmtSize(f.size) }}</small></span>
              <button v-if="d.can.edit" class="btn btn-sm btn-ghost" :disabled="busy" @click="removeFile(f.key)">حذف</button></li>
            <li v-if="!d.attachments.length" class="pm-muted">أرفق صورة الفاتورة الضريبية (PDF أو صورة).</li>
          </ul>
          <label v-if="d.can.edit" class="btn btn-sm" style="margin-top: 8px">إرفاق ملف<input type="file" accept=".pdf,.png,.jpg,.jpeg" hidden @change="addFile" /></label>
        </section>
        <section v-if="d.kind === 'invoice' && ['posted', 'partial', 'paid'].includes(d.status)" class="card pm-panel">
          <h2>السداد</h2>
          <dl class="pc-dl">
            <div><dt>المسدد</dt><dd>{{ sar(d.paidAmount) }}</dd></div>
            <div v-if="d.creditedAmount"><dt>المخصوم بإشعارات</dt><dd>{{ sar(d.creditedAmount) }}</dd></div>
            <div><dt>المتبقي</dt><dd><b>{{ sar(d.outstanding) }}</b></dd></div>
            <div><dt>الاستحقاق</dt><dd>{{ fmtDate(d.dueDate) }}</dd></div>
          </dl>
          <ul class="pc-log" style="margin-top: 8px"><li v-for="(p, i) in d.payments" :key="i">سند صرف {{ p.serial }} · {{ fmtDate(p.voucherDate) }} · {{ sar(p.amount) }}</li></ul>
        </section>
        <section class="card pm-panel">
          <h2>السجل</h2>
          <ul class="pc-log"><li v-for="(x, i) in d.log" :key="i"><span>{{ x.action }} <small class="pm-muted">{{ fmtDateTime(x.at) }}</small><div v-if="x.note" class="pm-muted">{{ x.note }}</div></span></li></ul>
        </section>
      </div>
    </div>
  </div>
</template>
