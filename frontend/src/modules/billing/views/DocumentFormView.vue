<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { billingLookups, latinNum, money, num, sar, today } from '../lib';
import '../../../shared/module.css';
import '../../procurement/procurement.css';
import '../billing.css';

const props = defineProps<{ id?: string }>();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const lk = ref<any>(null);
const customers = ref<any[]>([]);
const items = ref<any[]>([]);
const ref0 = ref<any>(null);
const busy = ref(false);
const blank = () => ({ itemId: '', refLineId: null as string | null, description: '', unit: '', qty: 1, unitPrice: 0, discount: 0, category: '', reasonCode: '', left: null as number | null });
const f = ref<any>({ kind: 'invoice', docType: '', customerId: '', buyerName: '', refId: '', reason: '', supplyDate: '', dueDate: '', analyticId: '', notes: '', lines: [blank()] });

onMounted(async () => {
  try {
    const [l, c, i] = await Promise.all([billingLookups(true), api<any[]>('/billing/customers?status=active'), api<any[]>('/billing/items')]);
    lk.value = l;
    customers.value = c;
    items.value = i.filter((x: any) => x.isActive);
    if (props.id) {
      const d = await api<any>(`/billing/documents/${props.id}`);
      f.value = {
        kind: d.kind, docType: d.docType, customerId: d.customerId ?? '', buyerName: d.customerId ? '' : d.buyer?.name ?? '', refId: d.refId ?? '', reason: d.reason ?? '',
        supplyDate: d.supplyDate ?? '', dueDate: d.dueDate ?? '', analyticId: d.analyticId ?? '', notes: d.notes ?? '',
        lines: d.lines.map((x: any) => ({ ...blank(), ...x, itemId: x.itemId ?? '', unit: x.unit ?? '', reasonCode: x.reasonCode ?? '' })),
      };
      if (d.refId) await loadRef(d.refId, false);
    } else if (route.query.ref) {
      f.value.kind = String(route.query.kind ?? 'credit_note');
      f.value.refId = String(route.query.ref);
      await loadRef(f.value.refId, true);
    } else if (route.query.customer) {
      f.value.customerId = String(route.query.customer);
    }
  } catch (e) {
    toast.error((e as Error).message);
  }
});

async function loadRef(id: string, fill: boolean) {
  ref0.value = await api<any>(`/billing/documents/${id}`);
  if (f.value.kind === 'credit_note') {
    const mine = new Map(f.value.lines.map((l: any) => [l.refLineId, l]));
    f.value.lines = ref0.value.creditable.map((c: any) => {
      const x: any = mine.get(c.lineId);
      return { ...blank(), refLineId: c.lineId, description: c.description, qty: fill ? 0 : x?.qty ?? 0, unitPrice: x?.unitPrice ?? c.unitPrice, discount: x?.discount ?? 0, left: c.left + (x?.net ?? 0) };
    });
  } else if (fill) {
    f.value.lines = [blank()];
  }
}

const isNote = computed(() => f.value.kind !== 'invoice');
/** الوضع الفعلي اليوم: الشركة المسجلة قبل نفاذ تسجيلها تصدر فواتير عادية بلا ضريبة */
const effMode = computed(() => {
  const s = lk.value?.settings;
  if (!s) return 'off';
  const eff = s.vatEffectiveFrom;
  const point = f.value.supplyDate && f.value.supplyDate < today() ? f.value.supplyDate : today();
  return (s.mode === 'registered' || s.mode === 'integrated') && eff && point < eff ? 'unregistered' : s.mode;
});
const taxable = computed(() => (isNote.value ? ref0.value?.docType !== 'nontax' : effMode.value !== 'unregistered'));
const customer = computed(() => customers.value.find((c) => c.id === f.value.customerId) ?? null);
const autoType = computed(() => (isNote.value ? ref0.value?.docType : f.value.docType || (effMode.value === 'unregistered' ? 'nontax' : customer.value?.kind === 'business' ? 'standard' : 'simplified')));
function pickItem(l: any) {
  const it = items.value.find((x) => x.id === l.itemId);
  if (!it) return;
  l.description = it.name;
  l.unit = it.unit ?? '';
  l.unitPrice = it.price;
  l.category = '';
  l.reasonCode = '';
}
const itemOf = (l: any) => items.value.find((x) => x.id === l.itemId);
const catOf = (l: any) => (!taxable.value ? 'O' : l.category || itemOf(l)?.vatCategory || (isNote.value && ref0.value ? ref0.value.lines.find((x: any) => x.id === l.refLineId)?.category : null) || 'S');
const reasonsFor = (cat: string) => (lk.value?.vatReasons ?? []).filter((r: any) => r.category === cat);
const h = (n: unknown) => Math.round((num(n) || 0) * 100);
const calc = computed(() => {
  const rate = Number(lk.value?.settings?.vatRate ?? 15);
  let gross = 0; let disc = 0; let vat = 0;
  for (const l of f.value.lines) {
    if (!(num(l.qty) > 0)) continue;
    const g = Math.round(num(l.qty) * (num(l.unitPrice) || 0) * 100);
    const d = Math.min(h(l.discount), g);
    gross += g; disc += d;
    if (catOf(l) === 'S') vat += Math.round(((g - d) * rate) / 100);
  }
  return { gross: gross / 100, discount: disc / 100, taxable: (gross - disc) / 100, vat: vat / 100, total: (gross - disc + vat) / 100, rate };
});
const lineNet = (l: any) => Math.max(0, h((num(l.qty) || 0) * (num(l.unitPrice) || 0)) - h(l.discount)) / 100;

/**
 * السطور المرسلة: في الإشعار الدائن ما له كمية فقط (سطور الفاتورة الأصلية تظهر كلها)،
 * وفي الفاتورة والإشعار المدين كل سطر فيه صنف أو وصف أو سعر أو كمية، فلا يُحذف سطر مكتمل بصمت.
 */
const usedLines = () => f.value.lines.filter((l: any) => (f.value.kind === 'credit_note'
  ? num(l.qty) > 0
  : !!(l.itemId || String(l.description ?? '').trim() || num(l.unitPrice) > 0 || num(l.qty) > 0)));
/** خطأ واضح برقم السطر قبل الإرسال */
function lineProblem(): string | null {
  const used = usedLines();
  if (!used.length) return 'أضف سطرًا واحدًا على الأقل: اختر الصنف أو اكتب الوصف والكمية والسعر';
  for (const l of used) {
    const n = f.value.lines.indexOf(l) + 1;
    if (!(num(l.qty) > 0)) return `السطر ${n}: اكتب الكمية رقمًا أكبر من صفر`;
    if (Number.isNaN(num(l.unitPrice))) return `السطر ${n}: اكتب السعر رقمًا`;
  }
  return null;
}
const fixNum = (l: any, k: 'qty' | 'unitPrice' | 'discount') => { l[k] = latinNum(l[k]); };
function payload() {
  const x = f.value;
  return {
    kind: x.kind, docType: isNote.value || !x.docType ? undefined : x.docType, customerId: isNote.value ? null : x.customerId || null,
    buyerName: isNote.value || x.customerId ? null : x.buyerName || null, refId: isNote.value ? x.refId : null, reason: isNote.value ? x.reason || null : null,
    supplyDate: x.supplyDate || null, dueDate: x.kind === 'credit_note' ? null : x.dueDate || null, analyticId: x.analyticId || null, notes: x.notes || null,
    lines: usedLines().map((l: any) => ({
      itemId: isNote.value && x.kind === 'credit_note' ? null : l.itemId || null, refLineId: x.kind === 'credit_note' ? l.refLineId : null,
      description: l.description || null, unit: l.unit || null, qty: num(l.qty), unitPrice: num(l.unitPrice) || 0, discount: num(l.discount) || 0,
      category: x.kind === 'credit_note' ? undefined : l.category || undefined, reasonCode: x.kind === 'credit_note' ? null : l.reasonCode || null,
    })),
  };
}
async function save(submit: boolean) {
  const problem = lineProblem();
  if (problem) { toast.error(problem); return; }
  busy.value = true;
  try {
    let d = props.id
      ? await api<any>(`/billing/documents/${props.id}`, { method: 'PUT', json: payload() })
      : await api<any>('/billing/documents', { method: 'POST', json: payload() });
    if (submit) d = await api<any>(`/billing/documents/${d.id}/submit`, { method: 'POST', json: {} });
    toast.success(submit ? 'حُفظ المستند وأُرسل للإصدار' : 'حُفظت المسودة');
    router.push(`/billing/invoices/${d.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const title = computed(() => `${props.id ? 'تعديل' : 'إعداد'} ${lk.value?.docKinds?.[f.value.kind] ?? 'فاتورة'}`);
</script>

<template>
  <div v-if="lk">
    <div class="page-head">
      <div>
        <h1>{{ title }}</h1>
        <p class="muted">
          <template v-if="!isNote">يُحدد نوع الفاتورة من العميل: ضريبية للمنشآت المسجلة، ومبسطة للأفراد. السعر قبل الضريبة، والخصم على السطر.</template>
          <template v-else-if="ref0">على {{ ref0.typeLabel }} {{ ref0.code }} للعميل {{ ref0.buyer?.name ?? 'عميل نقدي' }} بإجمالي {{ sar(ref0.total) }}.</template>
        </p>
      </div>
    </div>
    <div v-if="!isNote && effMode === 'unregistered' && lk.settings.mode !== 'unregistered'" class="alert alert-info">التسجيل في ضريبة القيمة المضافة ينفذ في {{ lk.settings.vatEffectiveFrom }}، فهذه فاتورة عادية بلا ضريبة. الفواتير من هذا التاريخ تصدر ضريبية برمز QR.</div>
    <div v-if="lk.settings.mode === 'off'" class="alert alert-error">فعّل نظام الفوترة واختر وضع الشركة الضريبي من الإعدادات أولًا.</div>

    <form class="card pm-panel" @submit.prevent="save(false)">
      <div class="pc-fields">
        <template v-if="!isNote">
          <label class="field"><span>العميل</span>
            <select v-model="f.customerId" class="input"><option value="">عميل نقدي بلا ملف (فاتورة مبسطة)</option><option v-for="c in customers" :key="c.id" :value="c.id">{{ c.code }} · {{ c.name }}</option></select>
          </label>
          <label v-if="!f.customerId" class="field"><span>اسم المشتري (اختياري)</span><input v-model="f.buyerName" class="input" maxlength="250" /></label>
          <label class="field"><span>نوع الفاتورة</span>
            <select v-model="f.docType" class="input">
              <option value="">تلقائي ({{ lk.docTypes[autoType] }})</option>
              <template v-if="effMode !== 'unregistered'"><option value="standard">{{ lk.docTypes.standard }}</option><option value="simplified">{{ lk.docTypes.simplified }}</option></template>
            </select>
          </label>
          <label class="field"><span>تاريخ الاستحقاق</span><input v-model="f.dueDate" type="date" class="input" /><small class="pm-muted">افتراضيًا بعد {{ lk.settings.paymentDays }} يومًا</small></label>
        </template>
        <template v-else>
          <label class="field wide"><span>سبب الإشعار</span>
            <input v-model="f.reason" class="input" list="note-reasons" maxlength="500" required />
            <datalist id="note-reasons"><option v-for="r in lk.noteReasons" :key="r" :value="r" /></datalist>
          </label>
        </template>
        <label class="field"><span>تاريخ التوريد (اختياري)</span><input v-model="f.supplyDate" type="date" class="input" /></label>
        <label v-if="lk.analytics.length" class="field"><span>مركز التكلفة</span>
          <select v-model="f.analyticId" class="input"><option value="">الافتراضي من الإعدادات</option><option v-for="a in lk.analytics" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select>
        </label>
      </div>
      <p v-if="customer && autoType === 'standard' && (!customer.vatNumber || !customer.address?.buildingNo)" class="alert" style="background: #fffbeb; font-size: .85rem">
        الفاتورة الضريبية تحتاج العنوان الوطني الكامل للعميل ورقمه الضريبي أو سجله التجاري. <RouterLink class="pm-link" :to="`/billing/customers/${customer.id}`">إكمال ملف العميل</RouterLink>
      </p>

      <p class="pc-sec">البنود</p>
      <div class="table-wrap">
        <table class="bl-lines">
          <thead><tr><th style="min-width: 220px">الصنف أو الوصف</th><th>الكمية</th><th>السعر</th><th>الخصم</th><th v-if="taxable && f.kind !== 'credit_note'">الفئة الضريبية</th><th>الصافي</th><th /></tr></thead>
          <tbody>
            <tr v-for="(l, i) in f.lines" :key="i">
              <td>
                <template v-if="f.kind === 'credit_note'">{{ l.description }}<small class="pm-muted" style="display: block">المتبقي للإشعار {{ sar(l.left) }}</small></template>
                <template v-else>
                  <select v-model="l.itemId" class="input" @change="pickItem(l)"><option value="">وصف حر</option><option v-for="it in items" :key="it.id" :value="it.id">{{ it.code }} · {{ it.name }}</option></select>
                  <input v-model="l.description" class="input" maxlength="500" placeholder="الوصف" style="margin-top: 4px" />
                </template>
              </td>
              <td><input v-model="l.qty" type="text" inputmode="decimal" dir="ltr" class="input" style="width: 80px" @input="fixNum(l, 'qty')" /></td>
              <td><input v-model="l.unitPrice" type="text" inputmode="decimal" dir="ltr" class="input" style="width: 100px" @input="fixNum(l, 'unitPrice')" /></td>
              <td><input v-model="l.discount" type="text" inputmode="decimal" dir="ltr" class="input" style="width: 80px" @input="fixNum(l, 'discount')" /></td>
              <td v-if="taxable && f.kind !== 'credit_note'">
                <select v-model="l.category" class="input"><option value="">{{ itemOf(l) ? `من الصنف (${lk.vatCategories[itemOf(l).vatCategory]})` : lk.vatCategories.S }}</option><option v-for="(c, k) in lk.vatCategories" :key="k" :value="k">{{ c }}</option></select>
                <select v-if="l.category && l.category !== 'S'" v-model="l.reasonCode" class="input" style="margin-top: 4px" required><option value="">سبب الإعفاء أو الصفر…</option><option v-for="r in reasonsFor(l.category)" :key="r.code" :value="r.code">{{ r.label }}</option></select>
              </td>
              <td class="pc-num">{{ money(lineNet(l)) }}</td>
              <td><button v-if="f.kind !== 'credit_note' && f.lines.length > 1" type="button" class="btn btn-ghost" @click="f.lines.splice(i, 1)">✕</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <button v-if="f.kind !== 'credit_note'" type="button" class="btn" style="margin-top: 8px" @click="f.lines.push(blank())">+ سطر</button>

      <div class="bl-totals" style="margin-top: 14px">
        <div><span>الإجمالي قبل الخصم</span><span class="pc-num">{{ sar(calc.gross) }}</span></div>
        <div v-if="calc.discount"><span>الخصم</span><span class="pc-num">− {{ sar(calc.discount) }}</span></div>
        <div><span>الصافي قبل الضريبة</span><span class="pc-num">{{ sar(calc.taxable) }}</span></div>
        <div v-if="taxable"><span>ضريبة القيمة المضافة {{ calc.rate }}%</span><span class="pc-num">{{ sar(calc.vat) }}</span></div>
        <div class="grand"><span>الإجمالي</span><span class="pc-num">{{ sar(calc.total) }}</span></div>
        <small class="pm-muted">تقدير للمراجعة، ويُحسب المبلغ النهائي عند الحفظ لكل فئة ضريبية.</small>
      </div>
      <label class="field" style="margin-top: 12px"><span>ملاحظات تظهر في الفاتورة</span><textarea v-model="f.notes" class="input" rows="2" maxlength="2000" /></label>
      <div class="modal-actions" style="justify-content: flex-start">
        <button class="btn" :disabled="busy">حفظ مسودة</button>
        <button type="button" class="btn btn-primary" :disabled="busy" @click="save(true)">حفظ وإرسال للإصدار</button>
        <button type="button" class="btn btn-ghost" @click="router.back()">رجوع</button>
      </div>
    </form>
  </div>
</template>
