<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import FinancePicker from '../components/FinancePicker.vue';
import { sar, today } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

/** إعداد عقد مع مورد معتمد أو تعديله وهو مسودة أو معاد */
const props = defineProps<{ id?: string }>();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const lk = ref<any>(null);
const busy = ref(false);
const nul = (v: any) => (v === '' || v === undefined ? null : v);
const form = ref<any>({
  kind: 'supply', supplierId: String(route.query.supplier ?? ''), reference: '', title: '', scope: '', terms: '', startsOn: today(), endsOn: '', value: 0,
  alertPct: 80, alertDays: 30, projectId: '', budgetLineId: '', fundingBatchId: '', ptContractId: '', riskIds: [] as string[],
  prices: [] as any[], guarantees: [] as any[], slas: [] as any[], penaltyRules: [] as any[], requiredDocs: [] as string[], shareWithSupplier: true,
});
const docsText = computed({
  get: () => form.value.requiredDocs.join('\n'),
  set: (v: string) => (form.value.requiredDocs = v.split('\n').map((x) => x.trim()).filter(Boolean)),
});

onMounted(async () => {
  try {
    lk.value = await api('/procurement/contract-lookups');
    if (props.id) {
      const c = await api<any>(`/procurement/contracts/${props.id}`);
      if (!c.can.edit) throw new Error('لا يُعدل هذا العقد');
      Object.assign(form.value, {
        kind: c.kind, supplierId: c.supplierId, reference: c.reference ?? '', title: c.title, scope: c.scope ?? '', terms: c.terms ?? '', startsOn: c.startsOn, endsOn: c.endsOn,
        value: c.value, alertPct: c.alertPct, alertDays: c.alertDays, projectId: c.projectId ?? '', budgetLineId: c.budgetLineId ?? '', fundingBatchId: c.fundingBatchId ?? '',
        ptContractId: c.ptContractId ?? '', riskIds: [...c.riskIds], requiredDocs: [...c.requiredDocs], shareWithSupplier: c.shareWithSupplier,
        prices: c.prices.map((p: any) => ({ ...p, itemId: p.itemId ?? '', unit: p.unit ?? '', maxQty: p.maxQty ?? '' })),
        guarantees: c.guarantees.map((g: any) => ({ ...g, ref: g.ref ?? '', issuer: g.issuer ?? '', expiresOn: g.expiresOn ?? '' })),
        slas: c.slas.map((x: any) => ({ ...x })), penaltyRules: c.penaltyRules.map((x: any) => ({ ...x, capPct: x.capPct ?? '' })),
      });
    }
  } catch (e) {
    toast.error((e as Error).message);
  }
});

const add = {
  price: () => form.value.prices.push({ itemId: '', description: '', unit: '', unitPrice: 0, maxQty: '' }),
  guarantee: () => form.value.guarantees.push({ kind: 'final', amount: 0, ref: '', issuer: '', expiresOn: '', released: false }),
  sla: () => form.value.slas.push({ name: '', target: 95, unit: '%', direction: 'min' }),
  rule: () => form.value.penaltyRules.push({ name: 'غرامة التأخير', basis: 'per_day', rate: 0, capPct: 10 }),
};
function pickItem(p: any) {
  const it = lk.value?.items?.find((x: any) => x.id === p.itemId);
  if (it && !p.description) p.description = it.name;
}

function payload() {
  const f = form.value;
  return {
    kind: f.kind, supplierId: f.supplierId, reference: nul(f.reference), title: f.title, scope: nul(f.scope), terms: nul(f.terms), startsOn: f.startsOn, endsOn: f.endsOn,
    value: Number(f.value), alertPct: Number(f.alertPct), alertDays: Number(f.alertDays), projectId: nul(f.projectId), budgetLineId: nul(f.budgetLineId),
    fundingBatchId: nul(f.fundingBatchId), ptContractId: nul(f.ptContractId), riskIds: f.riskIds, requiredDocs: f.requiredDocs, shareWithSupplier: f.shareWithSupplier,
    prices: f.prices.filter((p: any) => p.description.trim()).map((p: any) => ({
      ...(p.key ? { key: p.key } : {}), itemId: nul(p.itemId), description: p.description, unit: nul(p.unit), unitPrice: Number(p.unitPrice), maxQty: p.maxQty === '' ? null : Number(p.maxQty),
    })),
    guarantees: f.guarantees.map((g: any) => ({
      ...(g.key ? { key: g.key } : {}), kind: g.kind, amount: Number(g.amount), ref: nul(g.ref), issuer: nul(g.issuer), expiresOn: nul(g.expiresOn), released: !!g.released,
    })),
    slas: f.slas.filter((x: any) => x.name.trim()).map((x: any) => ({ ...(x.key ? { key: x.key } : {}), name: x.name, target: Number(x.target), unit: x.unit, direction: x.direction })),
    penaltyRules: f.penaltyRules.filter((x: any) => x.name.trim()).map((x: any) => ({
      ...(x.key ? { key: x.key } : {}), name: x.name, basis: x.basis, rate: Number(x.rate), capPct: x.capPct === '' ? null : Number(x.capPct),
    })),
  };
}

async function save(submit: boolean) {
  busy.value = true;
  try {
    let c = props.id
      ? await api<any>(`/procurement/contracts/${props.id}`, { method: 'PUT', json: payload() })
      : await api<any>('/procurement/contracts', { method: 'POST', json: payload() });
    if (submit) c = await api<any>(`/procurement/contracts/${c.id}/submit`, { method: 'POST', json: {} });
    toast.success(submit ? `أُرسل ${c.code} للاعتماد` : `حُفظ ${c.code} مسودة`);
    router.push(`/procurement/contracts/${c.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="lk">
    <div class="page-head">
      <div>
        <h1>{{ id ? 'تعديل العقد' : 'عقد جديد' }}</h1>
        <p class="muted">يُبرم العقد مع مورد معتمد، ويعتمده موظف غير الذي أعدّه. إذا كانت الجهة شريكًا للجمعية أيضًا فاربط العقد بعقد الشراكة ليظهر في نظام الشراكات.</p>
      </div>
    </div>
    <form style="display: grid; gap: 16px" @submit.prevent="save(false)">
      <section class="card pm-panel">
        <h2>بيانات العقد</h2>
        <div class="pc-fields">
          <label class="field"><span>النوع</span><select v-model="form.kind" class="input"><option v-for="(l, k) in lk.kinds" :key="k" :value="k">{{ l }}</option></select></label>
          <label class="field"><span>المورد</span><select v-model="form.supplierId" class="input" required><option value="">اختر…</option><option v-for="s in lk.suppliers" :key="s.id" :value="s.id">{{ s.code }} · {{ s.name }}</option></select></label>
          <label class="field wide"><span>عنوان العقد</span><input v-model="form.title" class="input" required minlength="3" maxlength="250" /></label>
          <label class="field"><span>المرجع (رقم العقد لدى الطرفين)</span><input v-model="form.reference" class="input" maxlength="60" /></label>
          <label class="field"><span>القيمة (السقف) شاملة الضريبة</span><input v-model.number="form.value" type="number" min="1" step="any" class="input" required /></label>
          <label class="field"><span>تاريخ البداية</span><input v-model="form.startsOn" type="date" class="input" required /></label>
          <label class="field"><span>تاريخ النهاية</span><input v-model="form.endsOn" type="date" class="input" :min="form.startsOn" required /></label>
          <label class="field"><span>تنبيه عند استخدام (%) من السقف</span><input v-model.number="form.alertPct" type="number" min="1" max="100" class="input" /></label>
          <label class="field"><span>تنبيه قبل الانتهاء بـ (يوم)</span><input v-model.number="form.alertDays" type="number" min="0" max="365" class="input" /></label>
          <label class="field wide"><span>النطاق</span><textarea v-model="form.scope" class="input" rows="3" maxlength="8000" /></label>
          <label class="field wide"><span>الشروط</span><textarea v-model="form.terms" class="input" rows="4" maxlength="20000" /></label>
        </div>
      </section>

      <section class="card pm-panel">
        <h2>الربط</h2>
        <div class="pc-fields">
          <label class="field"><span>المشروع (اختياري)</span><select v-model="form.projectId" class="input"><option value="">—</option><option v-for="p in lk.projects" :key="p.id" :value="p.id">{{ p.code }} · {{ p.name }}</option></select></label>
          <label class="field"><span>عقد الشراكة (للعقود المشتركة)</span><select v-model="form.ptContractId" class="input"><option value="">—</option><option v-for="p in lk.ptContracts" :key="p.id" :value="p.id">{{ p.number }} · {{ p.title }}{{ p.partnerName ? ` (${p.partnerName})` : '' }}</option></select></label>
        </div>
        <FinancePicker v-model:budget-line-id="form.budgetLineId" v-model:funding-batch-id="form.fundingBatchId" :amount="Number(form.value) || 0" :project-id="form.projectId || null" />
        <div v-if="lk.risks.length" style="margin-top: 10px">
          <span class="pm-muted" style="font-size: .85rem">المخاطر المرتبطة من سجل المخاطر</span>
          <div class="pc-chips" style="margin-top: 6px">
            <label v-for="r in lk.risks" :key="r.id" class="pc-chip"><input v-model="form.riskIds" type="checkbox" :value="r.id" /> {{ r.code }} · {{ r.title }}<small v-if="r.level" class="pm-muted"> ({{ r.level }})</small></label>
          </div>
        </div>
      </section>

      <section class="card pm-panel">
        <h2>الأسعار التعاقدية</h2>
        <table class="pc-lines">
          <thead><tr><th>الصنف</th><th>الوصف</th><th>الوحدة</th><th>سعر الوحدة</th><th>الحد الأعلى للكمية</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(p, i) in form.prices" :key="i">
              <td><select v-model="p.itemId" class="input" @change="pickItem(p)"><option value="">بلا صنف</option><option v-for="it in lk.items" :key="it.id" :value="it.id">{{ it.code }} · {{ it.name }}</option></select></td>
              <td><input v-model="p.description" class="input" maxlength="300" /></td>
              <td><input v-model="p.unit" class="input" maxlength="40" style="width: 80px" /></td>
              <td><input v-model.number="p.unitPrice" type="number" min="0" step="any" class="input" style="width: 110px" /></td>
              <td><input v-model="p.maxQty" type="number" min="0" step="any" class="input" style="width: 110px" /></td>
              <td><button type="button" class="btn btn-ghost" @click="form.prices.splice(i, 1)">✕</button></td>
            </tr>
          </tbody>
        </table>
        <button type="button" class="btn" style="margin-top: 8px" @click="add.price">إضافة سعر</button>
      </section>

      <div class="pc-grid" style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))">
        <section class="card pm-panel">
          <h2>الضمانات</h2>
          <div v-for="(g, i) in form.guarantees" :key="i" class="pc-fields" style="border-bottom: 1px dashed var(--border, #e2e8f0); padding-bottom: 8px; margin-bottom: 8px">
            <label class="field"><span>النوع</span><select v-model="g.kind" class="input"><option v-for="(l, k) in lk.guaranteeKinds" :key="k" :value="k">{{ l }}</option></select></label>
            <label class="field"><span>المبلغ</span><input v-model.number="g.amount" type="number" min="0" step="any" class="input" /></label>
            <label class="field"><span>رقم الضمان</span><input v-model="g.ref" class="input" maxlength="60" /></label>
            <label class="field"><span>الجهة المصدرة</span><input v-model="g.issuer" class="input" maxlength="200" /></label>
            <label class="field"><span>ينتهي في</span><input v-model="g.expiresOn" type="date" class="input" /></label>
            <div style="align-self: end"><button type="button" class="btn btn-ghost" @click="form.guarantees.splice(i, 1)">حذف</button></div>
          </div>
          <button type="button" class="btn" @click="add.guarantee">إضافة ضمان</button>
        </section>
        <section class="card pm-panel">
          <h2>مستويات الخدمة (المؤشرات)</h2>
          <div v-for="(x, i) in form.slas" :key="i" class="pc-inline" style="margin-bottom: 6px">
            <input v-model="x.name" class="input grow" placeholder="اسم المؤشر" maxlength="200" />
            <select v-model="x.direction" class="input"><option value="min">لا يقل عن</option><option value="max">لا يزيد عن</option></select>
            <input v-model.number="x.target" type="number" min="0" step="any" class="input" style="width: 80px" />
            <input v-model="x.unit" class="input" style="width: 60px" maxlength="30" />
            <button type="button" class="btn btn-ghost" @click="form.slas.splice(i, 1)">✕</button>
          </div>
          <button type="button" class="btn" @click="add.sla">إضافة مؤشر</button>
          <h2 style="margin-top: 16px">قواعد الجزاءات</h2>
          <div v-for="(x, i) in form.penaltyRules" :key="i" class="pc-inline" style="margin-bottom: 6px">
            <input v-model="x.name" class="input grow" placeholder="اسم الجزاء" maxlength="200" />
            <select v-model="x.basis" class="input"><option v-for="(l, k) in lk.penaltyBasis" :key="k" :value="k">{{ l }}</option></select>
            <input v-model.number="x.rate" type="number" min="0" step="any" class="input" style="width: 90px" :title="x.basis === 'percent' ? 'النسبة %' : 'المبلغ'" />
            <input v-model="x.capPct" type="number" min="0" max="100" step="any" class="input" style="width: 80px" placeholder="سقف %" title="سقف الجزاءات % من قيمة العقد" />
            <button type="button" class="btn btn-ghost" @click="form.penaltyRules.splice(i, 1)">✕</button>
          </div>
          <button type="button" class="btn" @click="add.rule">إضافة قاعدة</button>
        </section>
      </div>

      <section class="card pm-panel">
        <h2>المستندات المطلوبة ومشاركة المورد</h2>
        <label class="field"><span>المستندات المطلوبة من المورد (سطر لكل مستند)</span><textarea v-model="docsText" class="input" rows="3" /></label>
        <label class="pc-inline" style="margin-top: 8px"><input v-model="form.shareWithSupplier" type="checkbox" /> يظهر العقد للمورد في بوابته بعد اعتماده</label>
      </section>

      <div class="pc-inline">
        <span class="pm-muted">القيمة: {{ sar(Number(form.value) || 0) }}</span>
        <button class="btn" :disabled="busy">حفظ مسودة</button>
        <button type="button" class="btn btn-primary" :disabled="busy" @click="save(true)">حفظ وإرسال للاعتماد</button>
        <button type="button" class="btn btn-ghost" @click="router.back()">رجوع</button>
      </div>
    </form>
  </div>
</template>
