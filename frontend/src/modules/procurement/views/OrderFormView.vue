<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { lookups, sar } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const props = defineProps<{ id?: string }>();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const lk = ref<any>(null);
const req = ref<any>(null);
const order = ref<any>(null);
const busy = ref(false);
const supQ = ref('');
const contracts = ref<any[]>([]);
const form = ref<any>({ contractId: '', supplierId: '', title: '', vatRate: 15, warehouseId: '', deliveryDate: '', deliveryPlace: '', terms: '', lines: [] as any[] });

onMounted(async () => {
  try {
    lk.value = await lookups();
    if (props.id) {
      order.value = await api<any>(`/procurement/orders/${props.id}`);
      req.value = await api<any>(`/procurement/requests/${order.value.requestId}`);
    } else {
      req.value = await api<any>(`/procurement/requests/${route.query.request}`);
    }
    const o = order.value;
    const mine = new Map<string, any>((o?.lines ?? []).map((l: any) => [l.lineId, l]));
    form.value = {
      contractId: o?.contractId ?? String(route.query.contract ?? ''), supplierId: o?.supplierId ?? '', title: o?.title ?? req.value.title, vatRate: o?.vatRate ?? 15, warehouseId: o?.warehouseId ?? '',
      deliveryDate: o?.deliveryDate ?? req.value.neededBy ?? '', deliveryPlace: o?.deliveryPlace ?? '', terms: o?.terms ?? lk.value.sourcing.orderTerms ?? '',
      lines: req.value.lines.map((l: any) => {
        const cur = mine.get(l.id);
        // المتبقي = الكمية - ما صدر به تعميد، مع إعادة كمية هذا التعميد نفسه عند التعديل
        const left = Math.max(0, +(l.qty - l.orderedQty + (cur?.qty ?? 0)).toFixed(3));
        return { lineId: l.id, description: l.description, uomName: l.uomName, left, on: o ? !!cur : left > 0, qty: cur?.qty ?? left, unitPrice: cur?.unitPrice ?? l.estPrice };
      }),
    };
  } catch (e) {
    toast.error((e as Error).message);
  }
});

const fromQuote = computed(() => !!order.value?.quoteId);
// العقود السارية للمورد المختار: التعميد يصدر عليها في حدود المتبقي من سقفها
watch(() => form.value.supplierId, async (sid) => {
  contracts.value = sid ? await api<any[]>(`/procurement/suppliers/${sid}/contracts`).catch(() => []) : [];
  if (form.value.contractId && !contracts.value.some((c) => c.id === form.value.contractId)) form.value.contractId = '';
});
const contract = computed(() => contracts.value.find((c) => c.id === form.value.contractId));
const suppliers = computed(() => {
  const q = supQ.value.trim();
  return (lk.value?.approvedSuppliers ?? []).filter((s: any) => s.id === form.value.supplierId || !q || s.name.includes(q) || s.code.includes(q));
});
const picked = computed(() => form.value.lines.filter((l: any) => l.on));
const subtotal = computed(() => picked.value.reduce((s: number, l: any) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0));
const vat = computed(() => Math.round(subtotal.value * Number(form.value.vatRate)) / 100);

async function save() {
  const f = form.value;
  if (!f.supplierId) return toast.error('اختر المورد');
  if (!picked.value.length) return toast.error('اختر بندًا واحدًا على الأقل');
  busy.value = true;
  const body = {
    requestId: props.id ? undefined : req.value.id, supplierId: f.supplierId, title: f.title, vatRate: Number(f.vatRate),
    contractId: f.contractId || null, warehouseId: f.warehouseId || null, deliveryDate: f.deliveryDate || null, deliveryPlace: f.deliveryPlace || null, terms: f.terms || null,
    lines: picked.value.map((l: any) => ({ lineId: l.lineId, qty: Number(l.qty), unitPrice: Number(l.unitPrice) })),
  };
  try {
    const o = props.id
      ? await api<any>(`/procurement/orders/${props.id}`, { method: 'PUT', json: body })
      : await api<any>('/procurement/orders', { method: 'POST', json: body });
    toast.success('حُفظ التعميد. أرسله للاعتماد عند اكتماله');
    router.push(`/procurement/orders/${o.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="lk && req">
    <div class="page-head">
      <div><h1>{{ id ? `تعديل التعميد ${order.code}` : 'إعداد تعميد' }}</h1><p class="muted">لطلب الشراء {{ req.code }} · {{ req.title }} · {{ req.methodLabel ?? req.suggestedMethodLabel }}</p></div>
    </div>
    <form class="pc-grid" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)" @submit.prevent="save">
      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2>البنود</h2>
          <div v-if="!form.lines.some((l: any) => l.left > 0)" class="alert alert-error">صدرت تعميدات بكل كميات هذا الطلب، فلا يوجد ما يُعمَّد.</div>
          <p class="pm-muted" style="font-size: .8rem">لا تتجاوز الكمية المتبقية من الطلب{{ fromQuote ? '، ولا يزيد السعر عن سعر العرض المرسى' : '' }}.</p>
          <div class="table-wrap">
            <table class="pc-lines">
              <thead><tr><th /><th>البند</th><th style="width: 90px">المتبقي</th><th style="width: 110px">الكمية</th><th style="width: 120px">سعر الوحدة</th><th style="width: 110px">الإجمالي</th></tr></thead>
              <tbody>
                <tr v-for="l in form.lines" :key="l.lineId" :style="l.on ? '' : 'opacity: .55'">
                  <td><input v-model="l.on" type="checkbox" :disabled="!l.left" /></td>
                  <td><b>{{ l.description }}</b></td>
                  <td class="pc-num">{{ l.left }} {{ l.uomName ?? '' }}</td>
                  <td><input v-model.number="l.qty" type="number" min="0.001" :max="l.left" step="any" class="input" :disabled="!l.on" /></td>
                  <td><input v-model.number="l.unitPrice" type="number" min="0.01" step="any" class="input" :disabled="!l.on" /></td>
                  <td class="pc-num">{{ l.on ? sar((Number(l.qty) || 0) * (Number(l.unitPrice) || 0)) : '—' }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr><td colspan="5">قبل الضريبة</td><td class="pc-num">{{ sar(subtotal) }}</td></tr>
                <tr><td colspan="5">ضريبة القيمة المضافة {{ form.vatRate }}%</td><td class="pc-num">{{ sar(vat) }}</td></tr>
                <tr><td colspan="5"><b>الإجمالي</b></td><td class="pc-num"><b>{{ sar(subtotal + vat) }}</b></td></tr>
              </tfoot>
            </table>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>التسليم والشروط</h2>
          <div class="pc-fields">
            <label class="field" style="grid-column: 1 / -1"><span>عنوان التعميد</span><input v-model="form.title" class="input" required /></label>
            <label class="field"><span>تاريخ التسليم أو التنفيذ</span><input v-model="form.deliveryDate" type="date" class="input" required /></label>
            <label class="field"><span>مستودع الاستلام</span><select v-model="form.warehouseId" class="input"><option value="">— (خدمات أو تسليم مباشر)</option><option v-for="w in lk.activeWarehouses" :key="w.id" :value="w.id">{{ w.code }} · {{ w.name }}</option></select></label>
            <label class="field" style="grid-column: 1 / -1"><span>مكان التسليم</span><input v-model="form.deliveryPlace" class="input" placeholder="إن كان غير المستودع" /></label>
            <label class="field" style="grid-column: 1 / -1"><span>الشروط</span><textarea v-model="form.terms" class="input" rows="5" /></label>
          </div>
        </section>
      </div>

      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2>المورد</h2>
          <template v-if="fromQuote">
            <p><b>{{ order.supplier.name }}</b> <span class="pc-code">{{ order.supplier.code }}</span></p>
            <p class="pm-muted" style="font-size: .8rem">المورد والضريبة من العرض المرسى في المنافسة {{ order.rfq?.code }}.</p>
          </template>
          <template v-else>
            <input v-model="supQ" class="input" placeholder="بحث بالاسم أو الرقم" style="margin-bottom: 6px" />
            <div style="max-height: 300px; overflow: auto; display: grid; gap: 4px">
              <label v-for="s in suppliers" :key="s.id" class="pc-inline" style="font-size: .88rem; padding: 4px 6px; border-radius: 8px" :style="form.supplierId === s.id ? 'background: #ecfdf5' : ''">
                <input v-model="form.supplierId" type="radio" :value="s.id" />
                <span><b>{{ s.name }}</b> <span class="pc-code">{{ s.code }}</span></span>
              </label>
              <p v-if="!suppliers.length" class="pm-muted">لا يوجد موردون معتمدون</p>
            </div>
            <label class="field" style="margin-top: 10px"><span>ضريبة القيمة المضافة</span><select v-model.number="form.vatRate" class="input"><option :value="15">15%</option><option :value="0">0% (غير مسجل أو معفى)</option></select></label>
          </template>
        </section>
        <section v-if="form.supplierId" class="card pm-panel">
          <h2>العقد</h2>
          <select v-model="form.contractId" class="input"><option value="">بلا عقد</option><option v-for="c in contracts" :key="c.id" :value="c.id">{{ c.code }} · {{ c.title }}</option></select>
          <p v-if="contract" class="pm-muted" style="font-size: .8rem; margin-top: 6px">المتبقي من سقف العقد {{ sar(contract.remaining) }}. لا يتجاوزه التعميد، ويُنبَّه إذا زادت الأسعار عن الأسعار التعاقدية.</p>
          <p v-else-if="!contracts.length" class="pm-muted" style="font-size: .8rem; margin-top: 6px">لا توجد عقود سارية مع هذا المورد.</p>
        </section>
        <section class="card pm-panel">
          <h2>مصدر الصرف</h2>
          <dl class="pc-dl" style="grid-template-columns: 1fr">
            <div><dt>مصدر التمويل</dt><dd>{{ req.funding?.label ?? '—' }}</dd></div>
            <div><dt>بند الموازنة</dt><dd>{{ req.budgetLine ? `${req.budgetLine.name} · ${req.budgetLine.budgetCode}` : '—' }}</dd></div>
          </dl>
          <p class="pm-muted" style="font-size: .78rem; margin-top: 6px">من طلب الشراء، ويُفحص ويُحجز عند الاعتماد.</p>
        </section>
        <div class="pc-inline">
          <button class="btn btn-primary" :disabled="busy">{{ busy ? 'جارٍ الحفظ...' : 'حفظ التعميد' }}</button>
          <button type="button" class="btn btn-ghost" @click="router.back()">إلغاء</button>
        </div>
      </div>
    </form>
  </div>
</template>
