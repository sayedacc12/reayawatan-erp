<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import InvoiceEditor from '../components/InvoiceEditor.vue';
import { invoiceForm, invoicePayload, sar } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

/** تسجيل فاتورة ورقية وصلت من المورد (أو تعديلها وهي مسودة أو معادة) */
const props = defineProps<{ id?: string }>();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const INVOICEABLE = ['issued', 'acknowledged', 'accepted', 'clarification', 'partial', 'closed'];
const orders = ref<any[]>([]);
const orderId = ref(String(route.query.order ?? ''));
const billable = ref<any>(null);
const form = ref<any>(null);
const busy = ref(false);
const tolerance = ref(0);

async function loadBillable() {
  billable.value = null;
  form.value = null;
  if (!orderId.value) return;
  try {
    billable.value = await api(`/procurement/orders/${orderId.value}/billable`);
    form.value = invoiceForm(billable.value);
    if (route.query.kind === 'credit_note') form.value.kind = 'credit_note';
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(async () => {
  try {
    tolerance.value = (await api<any>('/procurement/invoice-lookups').catch(() => null))?.settings?.matchTolerancePct ?? 0;
    if (props.id) {
      const inv = await api<any>(`/procurement/invoices/${props.id}`);
      if (!inv.can.edit) throw new Error('لا تُعدل هذه الفاتورة');
      orderId.value = inv.orderId;
      billable.value = inv.billable;
      form.value = invoiceForm(inv.billable, inv);
      return;
    }
    orders.value = (await api<any[]>('/procurement/orders')).filter((o) => INVOICEABLE.includes(o.status));
    await loadBillable();
  } catch (e) {
    toast.error((e as Error).message);
  }
});
watch(orderId, () => { if (!props.id) loadBillable(); });

async function save(submit: boolean) {
  busy.value = true;
  try {
    const body = invoicePayload(form.value);
    let x = props.id
      ? await api<any>(`/procurement/invoices/${props.id}`, { method: 'PUT', json: body })
      : await api<any>('/procurement/invoices', { method: 'POST', json: body });
    if (submit) x = await api<any>(`/procurement/invoices/${x.id}/submit`, { method: 'POST', json: {} });
    toast.success(submit ? `أُرسلت ${x.code} للمراجعة والمطابقة` : `حُفظت ${x.code} مسودة`);
    router.push(`/procurement/invoices/${x.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>{{ id ? 'تعديل الفاتورة' : 'تسجيل فاتورة ورقية' }}</h1>
        <p class="muted">للفواتير التي تصل ورقيًا أو بالبريد. الأصل أن يرفع المورد فاتورته من البوابة. أرفق صورة الفاتورة بعد الحفظ، ولا يعتمد مطابقتها من سجلها.</p>
      </div>
    </div>
    <section v-if="!id" class="card pm-panel" style="margin-bottom: 14px">
      <label class="field"><span>التعميد</span>
        <select v-model="orderId" class="input"><option value="">اختر التعميد…</option><option v-for="o in orders" :key="o.id" :value="o.id">{{ o.code }} · {{ o.supplierName }} · {{ o.title }} ({{ sar(o.total) }})</option></select>
      </label>
    </section>
    <form v-if="form" @submit.prevent="save(false)">
      <InvoiceEditor :billable="billable" :form="form" :tolerance="tolerance" />
      <div class="pc-inline" style="margin-top: 14px">
        <button class="btn" :disabled="busy">حفظ مسودة</button>
        <button type="button" class="btn btn-primary" :disabled="busy" @click="save(true)">حفظ وإرسال للمطابقة</button>
        <button type="button" class="btn btn-ghost" @click="router.back()">رجوع</button>
      </div>
    </form>
  </div>
</template>
