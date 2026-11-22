<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, fmtDate, todayStr } from '../lib';
import '../../../shared/module.css';
import '../hr.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const toast = useToast();
const data = ref<any>(null);
const policy = ref<any>(null);
const tab = ref<'work' | 'gosi' | 'eos' | 'leaves' | 'performance' | 'history'>('work');
const effectiveDate = ref(todayStr());
const note = ref('');
const canEdit = computed(() => session.can(P.policy));
async function load() {
  data.value = await api('/hr/policy');
  policy.value = JSON.parse(JSON.stringify(data.value.policy));
}
onMounted(() => load().catch((e) => toast.error((e as Error).message)));
async function save() {
  try {
    data.value = await api('/hr/policy', { method: 'PUT', json: { policy: policy.value, effectiveDate: effectiveDate.value, note: note.value || null } });
    policy.value = JSON.parse(JSON.stringify(data.value.policy));
    note.value = '';
    toast.success(`اعتُمد الإصدار ${data.value.current.version} من اللائحة`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function resetSection(k: string) {
  if (!confirm('استعادة القيم الافتراضية لهذا القسم حسب نظام العمل؟')) return;
  policy.value[k] = JSON.parse(JSON.stringify(data.value.defaults[k]));
}
function addLeave() {
  policy.value.leaveTypes.push({ code: `custom${policy.value.leaveTypes.length + 1}`, name: '', days: 0, daysAfter: null, accrual: 'per_request', pay: 'full', gender: null, minServiceMonths: 0, maxCarryover: null, note: null });
}
const tabs = [
  { k: 'work', l: 'ساعات العمل والعقود' }, { k: 'gosi', l: 'التأمينات الاجتماعية' }, { k: 'eos', l: 'نهاية الخدمة' },
  { k: 'leaves', l: 'الإجازات وأرصدتها' }, { k: 'performance', l: 'تقييم الأداء' }, { k: 'history', l: 'سجل الإصدارات' },
] as const;
const factorLabel = (f: number) => (f === 0 ? 'لا شيء' : Math.abs(f - 1 / 3) < 0.01 ? 'الثلث' : Math.abs(f - 2 / 3) < 0.01 ? 'الثلثان' : f === 1 ? 'كاملة' : `${Math.round(f * 100)}%`);
</script>

<template>
  <div v-if="policy">
    <section class="pm-hero hr-hero">
      <div><p class="pm-kicker">لائحة الموارد البشرية{{ data.current ? ` · الإصدار ${data.current.version}` : ' · القيم الافتراضية' }}</p>
        <h1>لائحة مستقلة لكل قواعد الموارد البشرية</h1>
        <p class="pm-sub">تأتي بقيم نظام العمل السعودي ونظام التأمينات جاهزة، وتعدّلها الجمعية حسب لائحتها المعتمدة. كل حفظ إصدار جديد بتاريخ اعتماده، والحسابات كلها تأخذ من الإصدار الساري.</p></div>
      <div v-if="data.current" class="pm-actions"><span class="pm-pill" style="--c: #10b981; background: rgba(255,255,255,.9)">سارية من {{ fmtDate(data.current.effectiveDate) }}</span></div>
    </section>
    <div class="hr-tabs"><button v-for="t in tabs" :key="t.k" :class="['hr-tab', { on: tab === t.k }]" @click="tab = t.k">{{ t.l }}</button></div>
    <fieldset :disabled="!canEdit" style="border: 0; padding: 0; margin: 0">
      <Transition name="page" mode="out-in">
        <section v-if="tab === 'work'" key="w" class="card pm-panel">
          <h2>ساعات العمل والعقود <button v-if="canEdit" type="button" class="btn btn-sm" @click="resetSection('work')">القيم الافتراضية</button></h2>
          <div class="hr-fields">
            <label class="field"><span>ساعات العمل اليومية</span><input v-model.number="policy.work.dailyHours" type="number" class="input" /></label>
            <label class="field"><span>ساعات العمل الأسبوعية</span><input v-model.number="policy.work.weeklyHours" type="number" class="input" /></label>
            <label class="field"><span>ساعات العمل اليومية في رمضان (للمسلمين)</span><input v-model.number="policy.work.ramadanHours" type="number" class="input" /></label>
            <label class="field"><span>أجر الساعة الإضافية (مضاعف الأجر)</span><input v-model.number="policy.work.overtimeRate" type="number" step="0.05" class="input" /></label>
            <label class="field"><span>فترة التجربة الافتراضية (يوم)</span><input v-model.number="policy.work.probationDays" type="number" class="input" /></label>
            <label class="field"><span>الحد الأعلى لفترة التجربة مع التمديد</span><input v-model.number="policy.work.maxProbationDays" type="number" class="input" /></label>
            <label class="field"><span>مهلة الإشعار من الجمعية (يوم)</span><input v-model.number="policy.work.noticeDaysEmployer" type="number" class="input" /></label>
            <label class="field"><span>مهلة الإشعار من الموظف (يوم)</span><input v-model.number="policy.work.noticeDaysEmployee" type="number" class="input" /></label>
            <label class="field"><span>أيام الشهر في احتساب الأجر اليومي</span><input v-model.number="policy.payroll.dayBasis" type="number" class="input" /></label>
          </div>
          <div class="hr-sec">خصم الغياب والتأخير (من بصمات الحضور)</div>
          <div class="hr-fields">
            <label class="field" style="flex-direction: row; gap: 8px; align-items: center"><input v-model="policy.payroll.deductAbsence" type="checkbox" /><span>خصم أيام الغياب بدون عذر</span></label>
            <label class="field"><span>أيام الخصم عن كل يوم غياب</span><input v-model.number="policy.payroll.absenceFactor" type="number" step="0.5" min="0" class="input" /></label>
            <label class="field" style="flex-direction: row; gap: 8px; align-items: center"><input v-model="policy.payroll.deductLate" type="checkbox" /><span>خصم دقائق التأخير والخروج المبكر</span></label>
            <label class="field"><span>دقائق السماح في اليوم</span><input v-model.number="policy.payroll.lateGraceMinutes" type="number" min="0" class="input" /></label>
            <label class="field"><span>معامل خصم دقيقة التأخير (1 = بأجرها)</span><input v-model.number="policy.payroll.lateFactor" type="number" step="0.25" min="0" class="input" /></label>
          </div>
          <p class="pm-muted">أجر الدقيقة = الأجر اليومي ÷ (ساعات العمل اليومية × 60). التأخير الذي لا يتجاوز دقائق السماح لا يُخصم.</p>
        </section>

        <section v-else-if="tab === 'gosi'" key="g" class="card pm-panel">
          <h2>التأمينات الاجتماعية <button v-if="canEdit" type="button" class="btn btn-sm" @click="resetSection('gosi')">القيم الافتراضية</button></h2>
          <div class="hr-fields">
            <label class="field"><span>الأجر الخاضع</span><select v-model="policy.gosi.wageBase" class="input"><option value="basic_housing">الأساسي + بدل السكن</option><option value="basic">الأساسي فقط</option></select></label>
            <label class="field"><span>الحد الأدنى للأجر الخاضع</span><input v-model.number="policy.gosi.minWage" type="number" class="input" /></label>
            <label class="field"><span>الحد الأعلى للأجر الخاضع</span><input v-model.number="policy.gosi.maxWage" type="number" class="input" /></label>
          </div>
          <div class="hr-sec">السعوديون (النظام السابق) %</div>
          <div class="hr-fields">
            <label class="field"><span>المعاشات على الموظف</span><input v-model.number="policy.gosi.saudi.pensionEmployee" type="number" step="0.25" class="input" /></label>
            <label class="field"><span>المعاشات على الجمعية</span><input v-model.number="policy.gosi.saudi.pensionEmployer" type="number" step="0.25" class="input" /></label>
            <label class="field"><span>ساند على الموظف</span><input v-model.number="policy.gosi.saudi.sanedEmployee" type="number" step="0.25" class="input" /></label>
            <label class="field"><span>ساند على الجمعية</span><input v-model.number="policy.gosi.saudi.sanedEmployer" type="number" step="0.25" class="input" /></label>
            <label class="field"><span>الأخطار المهنية</span><input v-model.number="policy.gosi.saudi.hazardsEmployer" type="number" step="0.25" class="input" /></label>
            <label class="field"><span>الأخطار المهنية لغير السعوديين</span><input v-model.number="policy.gosi.nonSaudi.hazardsEmployer" type="number" step="0.25" class="input" /></label>
          </div>
          <div class="hr-sec">النظام الجديد للمشتركين لأول مرة</div>
          <label class="field" style="max-width: 260px"><span>تاريخ النفاذ</span><input v-model="policy.gosi.newLaw.effectiveFrom" type="date" class="input" /></label>
          <table class="table" style="max-width: 520px">
            <thead><tr><th>من تاريخ</th><th>نسبة المعاشات لكل طرف %</th><th /></tr></thead>
            <tbody><tr v-for="(s, i) in policy.gosi.newLaw.schedule" :key="i"><td><input v-model="s.from" type="date" class="input" /></td><td><input v-model.number="s.rate" type="number" step="0.25" class="input" /></td>
              <td><button v-if="canEdit" type="button" class="btn btn-sm" @click="policy.gosi.newLaw.schedule.splice(i, 1)">✕</button></td></tr></tbody>
          </table>
          <button v-if="canEdit" type="button" class="btn btn-sm" @click="policy.gosi.newLaw.schedule.push({ from: todayStr(), rate: 11 })">+ سطر</button>
        </section>

        <section v-else-if="tab === 'eos'" key="e" class="card pm-panel">
          <h2>مكافأة نهاية الخدمة <button v-if="canEdit" type="button" class="btn btn-sm" @click="resetSection('eos')">القيم الافتراضية</button></h2>
          <div class="hr-fields">
            <label class="field"><span>سنوات الشريحة الأولى</span><input v-model.number="policy.eos.firstYears" type="number" class="input" /></label>
            <label class="field"><span>أجر كل سنة في الشريحة الأولى (بالأشهر)</span><input v-model.number="policy.eos.firstRate" type="number" step="0.25" class="input" /></label>
            <label class="field"><span>أجر كل سنة بعدها (بالأشهر)</span><input v-model.number="policy.eos.afterRate" type="number" step="0.25" class="input" /></label>
            <label class="field"><span>الأجر المعتمد في الحساب</span><select v-model="policy.eos.wageBase" class="input"><option value="total">الأجر الفعلي (الأساسي وكل البدلات)</option><option value="basic_housing">الأساسي + السكن</option><option value="basic">الأساسي فقط</option></select></label>
          </div>
          <div class="hr-sec">نسبة الاستحقاق عند الاستقالة</div>
          <table class="table" style="max-width: 520px">
            <thead><tr><th>من سنوات الخدمة</th><th>النسبة (0 إلى 1)</th><th /></tr></thead>
            <tbody><tr v-for="(r, i) in policy.eos.resignation" :key="i"><td><input v-model.number="r.minYears" type="number" class="input" /></td>
              <td><input v-model.number="r.factor" type="number" step="0.0001" min="0" max="1" class="input" /><small class="pm-muted">{{ factorLabel(r.factor) }}</small></td>
              <td><button v-if="canEdit && i > 0" type="button" class="btn btn-sm" @click="policy.eos.resignation.splice(i, 1)">✕</button></td></tr></tbody>
          </table>
          <button v-if="canEdit" type="button" class="btn btn-sm" @click="policy.eos.resignation.push({ minYears: 15, factor: 1 })">+ شريحة</button>
        </section>

        <section v-else-if="tab === 'leaves'" key="l" class="card pm-panel">
          <h2>أنواع الإجازات وأرصدتها <button v-if="canEdit" type="button" class="btn btn-sm" @click="resetSection('leaveTypes')">القيم الافتراضية</button></h2>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>الاسم</th><th>الرمز</th><th>الأيام</th><th>بعد سنوات</th><th>الاستحقاق</th><th>الأجر</th><th>لـ</th><th>خدمة لازمة (شهر)</th><th>حد الترحيل</th><th>ملاحظة</th><th /></tr></thead>
              <tbody>
                <tr v-for="(t, i) in policy.leaveTypes" :key="i">
                  <td><input v-model="t.name" class="input" style="min-width: 130px" /></td>
                  <td><input v-model="t.code" class="input hr-code" style="width: 100px" :disabled="t.code === 'annual'" /></td>
                  <td><input v-model.number="t.days" type="number" class="input" style="width: 70px" /></td>
                  <td style="white-space: nowrap">
                    <template v-if="t.daysAfter"><input v-model.number="t.daysAfter.years" type="number" class="input" style="width: 55px" title="سنوات" /> ← <input v-model.number="t.daysAfter.days" type="number" class="input" style="width: 60px" title="أيام" /></template>
                    <button v-else-if="canEdit" type="button" class="btn btn-sm" @click="t.daysAfter = { years: 5, days: 30 }">+</button>
                  </td>
                  <td><select v-model="t.accrual" class="input"><option value="monthly">شهريًا</option><option value="yearly">سنوي</option><option value="per_request">لكل مناسبة</option><option value="once">مرة واحدة</option></select></td>
                  <td><select v-model="t.pay" class="input"><option value="full">بأجر</option><option value="partial">بأجر جزئي</option><option value="unpaid">بدون أجر</option></select></td>
                  <td><select v-model="t.gender" class="input"><option :value="null">الجميع</option><option value="female">الموظفات</option><option value="male">الموظفين</option></select></td>
                  <td><input v-model.number="t.minServiceMonths" type="number" class="input" style="width: 70px" /></td>
                  <td><input v-model.number="t.maxCarryover" type="number" class="input" style="width: 70px" placeholder="—" /></td>
                  <td><input v-model="t.note" class="input" style="min-width: 160px" /></td>
                  <td><button v-if="canEdit && t.code !== 'annual'" type="button" class="btn btn-sm" @click="policy.leaveTypes.splice(i, 1)">✕</button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <button v-if="canEdit" type="button" class="btn btn-sm" @click="addLeave">+ نوع إجازة</button>
          <p class="pm-muted">الإجازة بدون أجر تُخصم أيامها في مسير الرواتب تلقائيًا.</p>
        </section>

        <section v-else-if="tab === 'performance'" key="p" class="card pm-panel">
          <h2>تقييم الأداء <button v-if="canEdit" type="button" class="btn btn-sm" @click="resetSection('performance')">القيم الافتراضية</button></h2>
          <div class="hr-fields">
            <label class="field"><span>وزن الأهداف من النتيجة %</span><input v-model.number="policy.performance.objectivesWeight" type="number" class="input" /><small class="pm-muted">والباقي {{ 100 - policy.performance.objectivesWeight }}% للجدارات</small></label>
            <label class="field"><span>أعلى نسبة إنجاز تُحسب %</span><input v-model.number="policy.performance.maxAchievement" type="number" class="input" /></label>
          </div>
          <div class="hr-sec">التقديرات</div>
          <table class="table" style="max-width: 480px">
            <thead><tr><th>التقدير</th><th>من درجة</th><th /></tr></thead>
            <tbody><tr v-for="(b, i) in policy.performance.bands" :key="i"><td><input v-model="b.label" class="input" /></td><td><input v-model.number="b.min" type="number" class="input" /></td>
              <td><button v-if="canEdit" type="button" class="btn btn-sm" @click="policy.performance.bands.splice(i, 1)">✕</button></td></tr></tbody>
          </table>
          <button v-if="canEdit" type="button" class="btn btn-sm" @click="policy.performance.bands.push({ label: '', min: 50 })">+ تقدير</button>
        </section>

        <section v-else key="h" class="card pm-panel">
          <h2>سجل إصدارات اللائحة</h2>
          <table class="table">
            <thead><tr><th>الإصدار</th><th>تاريخ الاعتماد</th><th>اعتمدها</th><th>ملاحظة</th><th>تاريخ الحفظ</th></tr></thead>
            <tbody>
              <tr v-for="h in data.history" :key="h.version"><td><b>{{ h.version }}</b></td><td>{{ fmtDate(h.effectiveDate) }}</td><td>{{ h.approvedByName }}</td><td>{{ h.note ?? '—' }}</td><td>{{ fmtDate(h.createdAt) }}</td></tr>
              <tr v-if="!data.history.length"><td colspan="5" class="pm-empty">لم تُعتمد لائحة بعد، والنظام يعمل بالقيم الافتراضية لنظام العمل</td></tr>
            </tbody>
          </table>
        </section>
      </Transition>
    </fieldset>
    <section v-if="canEdit && tab !== 'history'" class="card pm-panel" style="margin-top: 16px; display: flex; gap: 10px; align-items: end; flex-wrap: wrap">
      <label class="field" style="margin: 0"><span>تاريخ اعتماد هذا الإصدار</span><input v-model="effectiveDate" type="date" class="input" /></label>
      <label class="field" style="margin: 0; flex: 1"><span>ملاحظة (مثل رقم قرار مجلس الإدارة)</span><input v-model="note" class="input" /></label>
      <button class="btn btn-primary" @click="save">حفظ كإصدار جديد</button>
    </section>
  </div>
</template>
