<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { fmtQty, lookups, sar, stockLookups, today } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const kind = ref<'order' | 'opening'>((['order', 'opening'].includes(String(route.query.kind)) ? route.query.kind : 'order') as any);
const lk = ref<any>(null);
const slk = ref<any>(null);
const items = ref<any[]>([]);
const orders = ref<any[]>([]);
const orderId = ref(String(route.query.order ?? ''));
const rec = ref<any>(null);
const busy = ref(false);
const form = ref<any>({ warehouseId: '', date: today(), deliveryRef: '', analyticId: '', projectId: '', extraCost: 0, extraNote: '', notes: '', lines: [] as any[] });
const insp = ref({ on: false, committee: '', result: 'accepted', note: '' });
const RECEIVABLE = ['issued', 'acknowledged', 'accepted', 'clarification', 'partial'];

onMounted(async () => {
  try {
    const [l, s, it] = await Promise.all([lookups(), stockLookups(), api<any[]>('/procurement/items?status=active')]);
    lk.value = l;
    slk.value = s;
    items.value = it.filter((x) => x.kind !== 'service');
    if (kind.value === 'order') {
      orders.value = (await api<any[]>('/procurement/orders')).filter((o) => RECEIVABLE.includes(o.status));
      if (orderId.value) await loadOrder();
    } else form.value.lines = [blank()];
  } catch (e) {
    toast.error((e as Error).message);
  }
});
const blank = () => ({ itemId: '', qty: 1, unitPrice: 0, lot: '', expiryDate: '', locationId: '', rejectedQty: 0, rejectReason: '' });
async function loadOrder() {
  rec.value = null;
  if (!orderId.value) return;
  try {
    rec.value = await api(`/procurement/receipts/receivable/${orderId.value}`);
    form.value.warehouseId = rec.value.order.warehouseId ?? '';
    form.value.lines = rec.value.lines.map((l: any) => ({ ...l, qty: l.remaining, rejectedQty: 0, rejectReason: '', lot: '', expiryDate: '', locationId: '' }));
    if (rec.value.settings.requireInspection) insp.value.on = true;
  } catch (e) {
    toast.error((e as Error).message);
  }
}
watch(orderId, loadOrder);

const locations = computed(() => (slk.value?.locations ?? []).filter((x: any) => x.warehouseId === form.value.warehouseId));
const itemOf = (id: string) => items.value.find((x) => x.id === id);
function lineInfo(l: any) {
  if (kind.value === 'order') return { trackBatch: l.trackBatch, trackExpiry: l.trackExpiry, stock: l.treatment === 'stock' };
  const it = itemOf(l.itemId);
  return { trackBatch: !!it?.trackBatch, trackExpiry: !!it?.trackExpiry, stock: !!it && it.kind !== 'asset' && it.kind !== 'service' };
}
const anyRejected = computed(() => form.value.lines.some((l: any) => Number(l.rejectedQty) > 0));
watch(anyRejected, (v) => { if (v) insp.value.on = true; });
const value = computed(() => form.value.lines.reduce((s: number, l: any) => {
  const acc = Math.max(0, (Number(l.qty) || 0) - (Number(l.rejectedQty) || 0));
  return s + acc * (kind.value === 'order' ? Number(l.unitCost) || 0 : Number(l.unitPrice) || 0);
}, 0) + (Number(form.value.extraCost) || 0));

async function save() {
  busy.value = true;
  const f = form.value;
  const nul = (v: string) => (v ? v : null);
  const body: any = {
    kind: kind.value, orderId: kind.value === 'order' ? orderId.value : null, warehouseId: nul(f.warehouseId), date: f.date, deliveryRef: nul(f.deliveryRef),
    analyticId: nul(f.analyticId), projectId: nul(f.projectId),
    extraCost: Number(f.extraCost) || 0, extraNote: nul(f.extraNote), notes: nul(f.notes),
    inspection: insp.value.on ? { committee: insp.value.committee.split(/[،,\n]/).map((x) => x.trim()).filter(Boolean), result: insp.value.result, note: nul(insp.value.note) } : null,
    lines: f.lines.filter((l: any) => Number(l.qty) > 0).map((l: any) => ({
      orderLineId: kind.value === 'order' ? l.orderLineId : null, itemId: kind.value === 'order' ? null : nul(l.itemId), qty: Number(l.qty),
      rejectedQty: Number(l.rejectedQty) || 0, rejectReason: nul(l.rejectReason), unitPrice: kind.value === 'order' ? undefined : Number(l.unitPrice) || 0,
      lot: nul(l.lot), expiryDate: nul(l.expiryDate), locationId: nul(l.locationId),
    })),
  };
  try {
    const r = await api<any>('/procurement/receipts', { method: 'POST', json: body });
    toast.success(`سُجل محضر الاستلام ${r.code}`);
    router.push(`/procurement/receipts/${r.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const TITLE = { order: 'استلام تعميد وفحصه', opening: 'رصيد افتتاحي للمستودع' };
const HINT = {
  order: 'سجّل الكمية المسلّمة لكل بند، والمرفوض بعد الفحص بسببه. المقبول يدخل المستودع بتكلفته شاملة الضريبة غير المستردة ونصيبه من مصاريف النقل والتخليص، والأصناف الأصول تُنشأ أصولًا ثابتة تلقائيًا.',
  opening: 'لإدخال أرصدة المستودع عند بدء العمل بالنظام. تُقيد مقابل الحساب المحدد للأرصدة الافتتاحية في الإعدادات.',
};
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>{{ TITLE[kind] }}</h1><p class="muted">{{ HINT[kind] }}</p></div>
    </div>
    <form class="pc-grid" style="grid-template-columns: minmax(0, 1fr)" @submit.prevent="save">
      <section class="card pm-panel">
        <div class="pc-fields">
          <label v-if="kind === 'order'" class="field" style="grid-column: span 2">
            <span>التعميد</span>
            <select v-model="orderId" class="input" required>
              <option value="">اختر التعميد…</option>
              <option v-for="o in orders" :key="o.id" :value="o.id">{{ o.code }} · {{ o.title }} · {{ o.supplierName }} ({{ o.statusLabel }})</option>
            </select>
          </label>
          <label class="field">
            <span>المستودع</span>
            <select v-model="form.warehouseId" class="input" :required="kind !== 'order'">
              <option value="">{{ kind === 'order' ? 'تسليم مباشر (بدون مستودع)' : 'اختر…' }}</option>
              <option v-for="w in lk?.activeWarehouses ?? []" :key="w.id" :value="w.id">{{ w.code }} · {{ w.name }}</option>
            </select>
          </label>
          <label class="field"><span>تاريخ الاستلام</span><input v-model="form.date" type="date" class="input" :max="today()" required /></label>
          <label class="field"><span>رقم إشعار التسليم</span><input v-model="form.deliveryRef" class="input" maxlength="80" /></label>
          <label v-if="kind !== 'opening'" class="field">
            <span>مركز التكلفة (للبنود المصروفة مباشرة)</span>
            <select v-model="form.analyticId" class="input"><option value="">—</option><option v-for="x in slk?.analytics ?? []" :key="x.id" :value="x.id">{{ x.code }} · {{ x.name }}</option></select>
          </label>
        </div>
        <p v-if="rec && !rec.receivable" class="alert alert-error" style="margin-top: 10px">لا يُستلم على هذا التعميد في حالته الحالية ({{ rec.order.statusLabel }}).</p>
      </section>

      <section v-if="kind !== 'order' || rec" class="card pm-panel">
        <h2>البنود</h2>
        <div class="table-wrap">
          <table class="pc-lines">
            <thead>
              <tr>
                <th>البند</th>
                <th v-if="kind === 'order'">المتبقي</th>
                <th style="width: 100px">المسلّم</th>
                <th v-if="kind !== 'opening'" style="width: 100px">المرفوض</th>
                <th style="width: 120px">تكلفة الوحدة</th>
                <th style="width: 120px">التشغيلة</th>
                <th style="width: 140px">الصلاحية</th>
                <th v-if="locations.length" style="width: 130px">الموقع</th>
                <th v-if="kind !== 'order'" />
              </tr>
            </thead>
            <tbody>
              <template v-for="(l, i) in form.lines" :key="i">
                <tr>
                  <td>
                    <template v-if="kind === 'order'">
                      <b>{{ l.description }}</b> <span class="pc-code">{{ l.itemCode ?? '' }}</span>
                      <span class="pm-muted" style="display: block; font-size: .78rem">{{ rec.lines[i].treatment === 'stock' ? 'يدخل المخزون' : rec.lines[i].treatment === 'asset' ? 'يُنشأ أصلًا ثابتًا' : 'مصروف مباشر' }} · مطلوب {{ fmtQty(l.ordered) }} · مستلم {{ fmtQty(l.received) }}</span>
                    </template>
                    <select v-else v-model="l.itemId" class="input" required>
                      <option value="">اختر الصنف…</option>
                      <option v-for="it in items.filter((x) => kind !== 'opening' || x.kind !== 'asset')" :key="it.id" :value="it.id">{{ it.code }} · {{ it.name }} ({{ it.uom }})</option>
                    </select>
                  </td>
                  <td v-if="kind === 'order'" class="pc-num">{{ fmtQty(l.remaining) }}</td>
                  <td><input v-model.number="l.qty" type="number" min="0" step="any" class="input" /></td>
                  <td v-if="kind !== 'opening'"><input v-model.number="l.rejectedQty" type="number" min="0" step="any" class="input" /></td>
                  <td>
                    <span v-if="kind === 'order'" class="pc-num">{{ sar(l.unitCost) }}</span>
                    <input v-else v-model.number="l.unitPrice" type="number" min="0.01" step="any" class="input" required />
                  </td>
                  <td><input v-if="lineInfo(l).stock" v-model="l.lot" class="input" :required="lineInfo(l).trackBatch && Number(l.qty) > Number(l.rejectedQty || 0)" maxlength="60" :placeholder="lineInfo(l).trackBatch ? 'إلزامي' : ''" /></td>
                  <td><input v-if="lineInfo(l).stock" v-model="l.expiryDate" type="date" class="input" :required="lineInfo(l).trackExpiry && Number(l.qty) > Number(l.rejectedQty || 0)" /></td>
                  <td v-if="locations.length">
                    <select v-if="lineInfo(l).stock" v-model="l.locationId" class="input"><option value="">—</option><option v-for="x in locations" :key="x.id" :value="x.id">{{ x.code }} · {{ x.name }}</option></select>
                  </td>
                  <td v-if="kind !== 'order'"><button type="button" class="btn btn-ghost" @click="form.lines.splice(i, 1)">✕</button></td>
                </tr>
                <tr v-if="Number(l.rejectedQty) > 0">
                  <td :colspan="9"><input v-model="l.rejectReason" class="input" required maxlength="500" placeholder="سبب رفض الكمية (عيب، مخالفة للمواصفات، تلف أثناء النقل…)" /></td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <button v-if="kind !== 'order'" type="button" class="btn" style="margin-top: 8px" @click="form.lines.push(blank())">+ صنف</button>
        <div v-if="kind === 'order'" class="pc-fields" style="margin-top: 12px">
          <label class="field"><span>مصاريف النقل والتخليص (تُوزع على البنود)</span><input v-model.number="form.extraCost" type="number" min="0" step="any" class="input" /></label>
          <label class="field" style="grid-column: span 2"><span>بيان المصاريف</span><input v-model="form.extraNote" class="input" maxlength="500" /></label>
        </div>
        <p class="pc-total" style="margin-top: 10px">قيمة المقبول: <b>{{ sar(value) }}</b></p>
      </section>

      <section v-if="kind !== 'opening' && (kind !== 'order' || rec)" class="card pm-panel">
        <label class="pc-inline"><input v-model="insp.on" type="checkbox" :disabled="anyRejected || !!rec?.settings.requireInspection" /> <b>محضر لجنة الاستلام والفحص</b></label>
        <div v-if="insp.on" class="pc-fields" style="margin-top: 10px">
          <label class="field" style="grid-column: span 2"><span>أعضاء اللجنة (افصل بينهم بفاصلة)</span><input v-model="insp.committee" class="input" required /></label>
          <label class="field">
            <span>نتيجة الفحص</span>
            <select v-model="insp.result" class="input"><option v-for="(t, k) in slk?.inspectionResults ?? {}" :key="k" :value="k">{{ t }}</option></select>
          </label>
          <label class="field" style="grid-column: 1 / -1"><span>ملاحظات اللجنة</span><textarea v-model="insp.note" class="input" rows="2" /></label>
        </div>
      </section>

      <section class="card pm-panel">
        <label class="field"><span>ملاحظات</span><textarea v-model="form.notes" class="input" rows="2" /></label>
        <div class="pc-inline" style="margin-top: 12px">
          <button class="btn btn-primary" :disabled="busy || (kind === 'order' && (!rec || !rec.receivable))">اعتماد الاستلام</button>
          <button type="button" class="btn" @click="router.back()">رجوع</button>
        </div>
      </section>
    </form>
  </div>
</template>
