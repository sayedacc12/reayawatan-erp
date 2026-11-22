<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import FinancePicker from '../components/FinancePicker.vue';
import { lookups, sar } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

const props = defineProps<{ id?: string }>();
const router = useRouter();
const toast = useToast();
const lk = ref<any>(null);
const items = ref<any[]>([]);
const busy = ref(false);
const form = ref<any>({
  title: '', kind: 'goods', unitId: '', projectId: '', beneficiaryRef: '', neededBy: '', priority: 'normal', justification: '', method: '', methodReason: '',
  budgetLineId: '', fundingBatchId: '', lines: [] as any[],
});
const blank = () => ({ id: undefined, itemId: '', description: '', qty: 1, uomId: '', estPrice: 0, specs: '' });

onMounted(async () => {
  try {
    const [l, it] = await Promise.all([lookups(), api<any[]>('/procurement/items?status=active')]);
    lk.value = l;
    items.value = it;
    if (props.id) {
      const r = await api<any>(`/procurement/requests/${props.id}`);
      form.value = {
        title: r.title, kind: r.kind, unitId: r.unitId ?? '', projectId: r.projectId ?? '', beneficiaryRef: r.beneficiaryRef ?? '', neededBy: r.neededBy ?? '',
        priority: r.priority, justification: r.justification ?? '', method: r.method ?? '', methodReason: r.methodReason ?? '',
        budgetLineId: r.budgetLineId ?? '', fundingBatchId: r.fundingBatchId ?? '',
        lines: r.lines.map((x: any) => ({ id: x.id, itemId: x.itemId ?? '', description: x.description, qty: x.qty, uomId: x.uomId ?? '', estPrice: x.estPrice, specs: x.specs ?? '' })),
      };
    } else form.value.lines = [blank()];
  } catch (e) {
    toast.error((e as Error).message);
  }
});

function pickItem(l: any) {
  const it = items.value.find((x) => x.id === l.itemId);
  if (!it) return;
  l.description = it.name;
  l.uomId = it.uomId;
  if (!l.estPrice && it.refPrice) l.estPrice = it.refPrice;
}
const total = computed(() => form.value.lines.reduce((s: number, l: any) => s + (Number(l.qty) || 0) * (Number(l.estPrice) || 0), 0));
const suggested = computed(() => {
  const lim = lk.value?.sourcing.methodLimits;
  if (!lim) return 'direct';
  return total.value <= lim.direct ? 'direct' : total.value <= lim.quotes ? 'quotes' : 'tender';
});
const RANK: Record<string, number> = { emergency: 0, direct: 1, quotes: 2, tender: 3 };
const needsReason = computed(() => {
  const m = form.value.method || suggested.value;
  return m === 'emergency' || RANK[m] < RANK[suggested.value];
});

async function save(andSubmit = false) {
  busy.value = true;
  const f = form.value;
  const nul = (v: string) => (v ? v : null);
  const body = {
    title: f.title, kind: f.kind, unitId: nul(f.unitId), projectId: nul(f.projectId), beneficiaryRef: f.kind === 'beneficiary' ? nul(f.beneficiaryRef) : null,
    neededBy: nul(f.neededBy), priority: f.priority, justification: nul(f.justification), method: nul(f.method), methodReason: needsReason.value ? nul(f.methodReason) : null,
    budgetLineId: nul(f.budgetLineId), fundingBatchId: nul(f.fundingBatchId),
    lines: f.lines.filter((l: any) => l.description?.trim()).map((l: any) => ({
      id: l.id, itemId: nul(l.itemId), description: l.description, qty: Number(l.qty), uomId: nul(l.uomId), estPrice: Number(l.estPrice) || 0, specs: nul(l.specs),
    })),
  };
  try {
    const r = props.id
      ? await api<any>(`/procurement/requests/${props.id}`, { method: 'PUT', json: body })
      : await api<any>('/procurement/requests', { method: 'POST', json: body });
    toast.success(props.id ? 'حُفظ الطلب' : `أُنشئ الطلب ${r.code}`);
    router.push({ path: `/procurement/requests/${r.id}`, query: andSubmit ? { submit: '1' } : {} });
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
      <div><h1>{{ id ? 'تعديل طلب الشراء' : 'طلب شراء جديد' }}</h1><p class="muted">حدد الاحتياج بدقة، ومصدر الصرف الذي يُحمّل عليه. يقترح النظام أسلوب الشراء حسب القيمة.</p></div>
    </div>
    <form class="pc-grid" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)" @submit.prevent="save(false)">
      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2>بيانات الطلب</h2>
          <div class="pc-fields">
            <label class="field" style="grid-column: 1 / -1"><span>عنوان الطلب</span><input v-model="form.title" class="input" required placeholder="مثل: سلال غذائية لبرنامج رمضان" /></label>
            <label class="field"><span>النوع</span><select v-model="form.kind" class="input"><option v-for="(l, k) in lk.requestKinds" :key="k" :value="k">{{ l }}</option></select></label>
            <label class="field"><span>الأولوية</span><select v-model="form.priority" class="input"><option v-for="(l, k) in lk.priorities" :key="k" :value="k">{{ l }}</option></select></label>
            <label class="field"><span>الإدارة الطالبة</span><select v-model="form.unitId" class="input"><option value="">—</option><option v-for="u in lk.units" :key="u.id" :value="u.id">{{ u.name }}</option></select></label>
            <label class="field"><span>المشروع أو البرنامج</span><select v-model="form.projectId" class="input"><option value="">—</option><option v-for="p in lk.projects" :key="p.id" :value="p.id">{{ p.code }} · {{ p.name }}</option></select></label>
            <label class="field"><span>تاريخ الاحتياج</span><input v-model="form.neededBy" type="date" class="input" /></label>
            <label v-if="form.kind === 'beneficiary'" class="field"><span>مرجع العميل أو البرنامج</span><input v-model="form.beneficiaryRef" class="input" placeholder="رقم الملف أو الطلب فقط" /></label>
            <label class="field" style="grid-column: 1 / -1"><span>المبررات</span><textarea v-model="form.justification" class="input" rows="2" /></label>
          </div>
        </section>

        <section class="card pm-panel">
          <h2>البنود</h2>
          <div class="table-wrap">
            <table class="pc-lines">
              <thead><tr><th style="width: 26%">الصنف من الدليل</th><th>الوصف والمواصفات</th><th style="width: 90px">الكمية</th><th style="width: 100px">الوحدة</th><th style="width: 110px">السعر التقديري</th><th style="width: 100px">الإجمالي</th><th /></tr></thead>
              <tbody>
                <tr v-for="(l, i) in form.lines" :key="i">
                  <td><select v-model="l.itemId" class="input" @change="pickItem(l)"><option value="">بند حر</option><option v-for="it in items" :key="it.id" :value="it.id">{{ it.code }} · {{ it.name }}</option></select></td>
                  <td><input v-model="l.description" class="input" placeholder="الوصف" /><input v-model="l.specs" class="input" placeholder="المواصفات (اختياري)" style="margin-top: 4px; font-size: .82rem" /></td>
                  <td><input v-model.number="l.qty" type="number" min="0" step="any" class="input" /></td>
                  <td><select v-model="l.uomId" class="input"><option value="">—</option><option v-for="u in lk.uoms" :key="u.id" :value="u.id">{{ u.name }}</option></select></td>
                  <td><input v-model.number="l.estPrice" type="number" min="0" step="any" class="input" /></td>
                  <td class="pc-num">{{ sar((Number(l.qty) || 0) * (Number(l.estPrice) || 0)) }}</td>
                  <td><button type="button" class="btn btn-ghost" title="حذف البند" @click="form.lines.splice(i, 1)">✕</button></td>
                </tr>
              </tbody>
              <tfoot><tr><td colspan="5"><button type="button" class="btn" @click="form.lines.push(blank())">+ بند</button></td><td class="pc-num">{{ sar(total) }}</td><td /></tr></tfoot>
            </table>
          </div>
        </section>
      </div>

      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2>أسلوب الشراء</h2>
          <p class="pm-muted" style="font-size: .85rem">المقترح لقيمة {{ sar(total) }}: <b>{{ lk.purchaseMethods[suggested] }}</b></p>
          <label class="field"><span>الأسلوب</span>
            <select v-model="form.method" class="input"><option value="">حسب المقترح</option><option v-for="(l, k) in lk.purchaseMethods" :key="k" :value="k">{{ l }}</option></select>
          </label>
          <label v-if="needsReason" class="field"><span>مبرر الأسلوب</span><textarea v-model="form.methodReason" class="input" rows="2" placeholder="لماذا هذا الأسلوب بدل المقترح؟" /></label>
        </section>
        <section class="card pm-panel">
          <h2>مصدر الصرف</h2>
          <FinancePicker v-model:budget-line-id="form.budgetLineId" v-model:funding-batch-id="form.fundingBatchId" :amount="total" :project-id="form.projectId" :kind="form.kind" />
        </section>
        <div class="pc-inline">
          <button class="btn btn-primary" :disabled="busy">{{ busy ? 'جارٍ الحفظ...' : 'حفظ' }}</button>
          <button type="button" class="btn" :disabled="busy" @click="save(true)">حفظ وإرسال للاعتماد</button>
          <button type="button" class="btn btn-ghost" @click="router.back()">إلغاء</button>
        </div>
      </div>
    </form>
  </div>
</template>
