<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { errMsg, money, MONTHS } from '../lib';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** الافتراضات (متغيرات عامة أو خاصة بإدارة وبقيم مرحلية)، وقواعد العلاوات، وسقوف الإدارات، ومعادلات الموارد البشرية */
const props = defineProps<{ budget: any; lookups: any; editable: boolean }>();
const emit = defineEmits<{ (e: 'saved', v: any): void }>();
const toast = useToast();
const busy = ref(false);
const s = reactive<any>({ variables: [], raiseRules: [], ceilings: [], hrSetup: { monthlyFormula: 'HR_MONTHLY', annualFormula: 'HR_ANNUAL' } });
function reset() {
  const b = JSON.parse(JSON.stringify(props.budget));
  Object.assign(s, { variables: b.variables, raiseRules: b.raiseRules, ceilings: b.ceilings, hrSetup: { monthlyFormula: b.hrSetup?.monthlyFormula || 'HR_MONTHLY', annualFormula: b.hrSetup?.annualFormula ?? 'HR_ANNUAL' } });
}
watch(() => props.budget, reset, { immediate: true });
const fx = (t: string) => (props.lookups?.formulas ?? []).filter((f: any) => f.target === t || f.target === 'any');
const ceilingTotal = computed(() => s.ceilings.reduce((t: number, c: any) => t + (Number(c.amount) || 0), 0));

async function save() {
  busy.value = true;
  try {
    const clean = (v: any) => ({ ...v, unitId: v.unitId || null, value: Number(v.value), steps: (v.steps ?? []).map((x: any) => ({ fromMonth: Number(x.fromMonth), value: Number(x.value) })) });
    const body = {
      variables: s.variables.map(clean),
      raiseRules: s.raiseRules.map((r: any) => ({ ...r, pct: Number(r.pct), match: Object.fromEntries(Object.entries(r.match).map(([k, v]) => [k, v || null])) })),
      ceilings: s.ceilings.map((c: any) => ({ unitId: c.unitId, amount: Number(c.amount) })),
      hrSetup: s.hrSetup,
    };
    emit('saved', await api(`/planning/budgets/${props.budget.id}`, { method: 'PATCH', json: body }));
    toast.success('حُفظت الافتراضات وأُعيد احتساب الموازنة');
  } catch (e) {
    toast.error(errMsg(e));
  } finally {
    busy.value = false;
  }
}
const addVar = () => s.variables.push({ key: '', name: '', value: 0, unit: '', steps: [], unitId: null, note: '' });
const addRule = () => s.raiseRules.push({ key: `r${Date.now()}`, name: '', pct: 0, fromMonth: 1, appliesToNew: false, match: { unitId: null, gradeName: null, jobTitle: null, rating: null, nationality: null } });
</script>

<template>
  <div class="bg-assume">
    <section class="card pm-panel">
      <h2><span>الافتراضات والمتغيرات</span><button v-if="editable" class="btn btn-sm" @click="addVar">+ متغير</button></h2>
      <p class="pm-muted">تُستخدم في المعادلات برمزها. المتغير الخاص بإدارة يغلب العام لبنودها، والقيمة المرحلية تسري من شهرها (مثل تجديد التأمين الطبي في يوليو).</p>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الرمز</th><th>الاسم</th><th>القيمة</th><th>الوحدة</th><th>قيم مرحلية</th><th>خاص بإدارة</th><th /></tr></thead>
          <tbody>
            <tr v-for="(v, i) in s.variables" :key="i">
              <td><input v-model="v.key" class="input bg-code" :disabled="!editable" dir="ltr" /></td>
              <td><input v-model="v.name" class="input" :disabled="!editable" /><small v-if="v.note" class="pm-muted">{{ v.note }}</small></td>
              <td><input v-model="v.value" type="number" step="any" class="input" style="width: 100px" :disabled="!editable" /></td>
              <td><input v-model="v.unit" class="input" style="width: 70px" :disabled="!editable" /></td>
              <td>
                <div v-for="(st, k) in v.steps" :key="k" class="pl-flex" style="flex-wrap: nowrap">
                  <select v-model.number="st.fromMonth" class="input" :disabled="!editable"><option v-for="(m, j) in MONTHS" :key="j" :value="j + 1">من {{ m }}</option></select>
                  <input v-model="st.value" type="number" step="any" class="input" style="width: 90px" :disabled="!editable" />
                  <button v-if="editable" class="btn btn-sm" @click="v.steps.splice(k, 1)">✕</button>
                </div>
                <button v-if="editable" class="btn btn-sm" @click="v.steps.push({ fromMonth: 7, value: v.value })">+ قيمة من شهر</button>
              </td>
              <td><select v-model="v.unitId" class="input" :disabled="!editable"><option :value="null">عام</option><option v-for="u in lookups.units" :key="u.id" :value="u.id">{{ u.name }}</option></select></td>
              <td><button v-if="editable" class="btn btn-sm" @click="s.variables.splice(i, 1)">✕</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card pm-panel">
      <h2><span>قواعد العلاوات</span><button v-if="editable" class="btn btn-sm" @click="addRule">+ قاعدة</button></h2>
      <p class="pm-muted">تُطبّق على كل موظف أدق قاعدة تنطبق عليه (الأكثر شروطًا)، وإلا العلاوة العامة من الافتراضات (general_raise).</p>
      <div v-for="(r, i) in s.raiseRules" :key="r.key" class="bg-rule">
        <div class="rk-fields">
          <label class="field"><span>اسم القاعدة</span><input v-model="r.name" class="input" :disabled="!editable" /></label>
          <label class="field"><span>النسبة %</span><input v-model="r.pct" type="number" step="any" class="input" :disabled="!editable" /></label>
          <label class="field"><span>من شهر</span><select v-model.number="r.fromMonth" class="input" :disabled="!editable"><option v-for="(m, j) in MONTHS" :key="j" :value="j + 1">{{ m }}</option></select></label>
          <label class="field"><span>الإدارة</span><select v-model="r.match.unitId" class="input" :disabled="!editable"><option :value="null">الكل</option><option v-for="u in lookups.units" :key="u.id" :value="u.id">{{ u.name }}</option></select></label>
          <label class="field"><span>الدرجة</span><select v-model="r.match.gradeName" class="input" :disabled="!editable"><option :value="null">الكل</option><option v-for="g in lookups.grades" :key="g" :value="g">{{ g }}</option></select></label>
          <label class="field"><span>الوظيفة</span><select v-model="r.match.jobTitle" class="input" :disabled="!editable"><option :value="null">الكل</option><option v-for="j in lookups.jobs" :key="j" :value="j">{{ j }}</option></select></label>
          <label class="field"><span>تقييم الأداء</span><select v-model="r.match.rating" class="input" :disabled="!editable"><option :value="null">الكل</option><option v-for="x in lookups.ratings" :key="x" :value="x">{{ x }}</option></select></label>
          <label class="field"><span>الجنسية</span><select v-model="r.match.nationality" class="input" :disabled="!editable"><option :value="null">الكل</option><option value="saudi">سعودي</option><option value="non_saudi">غير سعودي</option></select></label>
        </div>
        <div class="pl-flex"><label class="pl-flex"><input v-model="r.appliesToNew" type="checkbox" :disabled="!editable" /> تشمل الوظائف الجديدة</label>
          <button v-if="editable" class="btn btn-sm" style="margin-inline-start: auto" @click="s.raiseRules.splice(i, 1)">حذف القاعدة</button></div>
      </div>
      <p v-if="!s.raiseRules.length" class="pm-muted">لا توجد قواعد خاصة؛ تُطبّق العلاوة العامة على الجميع.</p>
    </section>

    <div class="pl-layout" style="grid-template-columns: 1fr 1fr">
      <section class="card pm-panel">
        <h2><span>سقوف الإدارات (من الأعلى)</span><button v-if="editable" class="btn btn-sm" @click="s.ceilings.push({ unitId: lookups.units[0]?.id, amount: 0 })">+ سقف</button></h2>
        <div v-for="(c, i) in s.ceilings" :key="i" class="pl-flex" style="margin-bottom: 6px; flex-wrap: nowrap">
          <select v-model="c.unitId" class="input" :disabled="!editable"><option v-for="u in lookups.units" :key="u.id" :value="u.id">{{ u.name }}</option></select>
          <input v-model="c.amount" type="number" class="input" style="width: 140px" :disabled="!editable" />
          <button v-if="editable" class="btn btn-sm" @click="s.ceilings.splice(i, 1)">✕</button>
        </div>
        <p class="pm-muted">مجموع السقوف {{ money(ceilingTotal) }}. تُقارن بطلبات كل إدارة في الملخص.</p>
      </section>
      <section class="card pm-panel">
        <h2>معادلات الموارد البشرية</h2>
        <label class="field"><span>التكلفة الشهرية للموظف</span><select v-model="s.hrSetup.monthlyFormula" class="input" :disabled="!editable"><option v-for="f in fx('hr_monthly')" :key="f.code" :value="f.code">{{ f.name }} ({{ f.code }})</option></select></label>
        <label class="field"><span>التكاليف السنوية الإضافية</span><select v-model="s.hrSetup.annualFormula" class="input" :disabled="!editable"><option value="">لا يوجد</option><option v-for="f in fx('hr_annual')" :key="f.code" :value="f.code">{{ f.name }} ({{ f.code }})</option></select></label>
        <p class="pm-muted">التأمينات ومكافأة نهاية الخدمة تُحسب من لائحة الموارد البشرية لكل شهر بعد العلاوة. المعادلات تُعدّل من «المعادلات والافتراضات».</p>
      </section>
    </div>
    <div v-if="editable" class="pm-actions" style="margin-top: 12px">
      <button class="btn btn-primary" :disabled="busy" @click="save">حفظ وإعادة احتساب الموازنة</button>
      <button class="btn" :disabled="busy" @click="reset">تراجع</button>
    </div>
  </div>
</template>
