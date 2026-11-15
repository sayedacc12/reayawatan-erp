<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { num, sar, todayStr, type EmpRow } from '../lib';
import '../../projects/projects.css';
import '../hr.css';

const toast = useToast();
const employees = ref<EmpRow[]>([]);
const reasons = ref<{ value: string; label: string; kind: string }[]>([]);
const form = reactive({ mode: 'employee', employeeId: '', wage: 10000, startDate: '', endDate: todayStr(), reason: 'contract_end' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const result = ref<any>(null);
onMounted(async () => {
  [employees.value, reasons.value] = await Promise.all([api<EmpRow[]>('/hr/employees'), api<{ value: string; label: string; kind: string }[]>('/hr/eos/reasons')]);
});
async function calc() {
  try {
    const body = form.mode === 'employee'
      ? { employeeId: form.employeeId, endDate: form.endDate, reason: form.reason }
      : { wage: Number(form.wage), startDate: form.startDate, endDate: form.endDate, reason: form.reason };
    result.value = await api('/hr/eos/calculate', { method: 'POST', json: body });
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const span = (s: { years: number; months: number; days: number }) => `${s.years} سنة و${s.months} شهر و${s.days} يوم`;
</script>

<template>
  <div>
    <section class="pm-hero hr-hero">
      <div><p class="pm-kicker">شؤون الموظفين</p><h1>حاسبة نهاية الخدمة</h1><p class="pm-sub">حسب نظام العمل السعودي ونسب لائحة الجمعية: لموظف مسجل (مع تعويض رصيد الإجازة) أو لأي أجر ومدة.</p></div>
    </section>
    <div class="hr-grid">
      <form class="card pm-panel" @submit.prevent="calc">
        <div class="hr-tabs">
          <button type="button" :class="['hr-tab', { on: form.mode === 'employee' }]" @click="form.mode = 'employee'">موظف مسجل</button>
          <button type="button" :class="['hr-tab', { on: form.mode === 'manual' }]" @click="form.mode = 'manual'">حساب حر</button>
        </div>
        <label v-if="form.mode === 'employee'" class="field"><span>الموظف</span>
          <select v-model="form.employeeId" class="input" required><option value="" disabled>اختر الموظف</option><option v-for="e in employees" :key="e.id" :value="e.id">{{ e.fullName }}</option></select>
        </label>
        <template v-else>
          <label class="field"><span>الأجر الشهري المعتمد للحساب</span><input v-model.number="form.wage" type="number" min="0" class="input" required /></label>
          <label class="field"><span>تاريخ المباشرة</span><input v-model="form.startDate" type="date" class="input" required /></label>
        </template>
        <label class="field"><span>تاريخ نهاية الخدمة</span><input v-model="form.endDate" type="date" class="input" required /></label>
        <label class="field"><span>سبب انتهاء الخدمة</span><select v-model="form.reason" class="input"><option v-for="r in reasons" :key="r.value" :value="r.value">{{ r.label }}</option></select></label>
        <button class="btn btn-primary">احسب</button>
      </form>
      <section class="card pm-panel">
        <h2>النتيجة</h2>
        <p v-if="!result" class="pm-empty">اختر البيانات ثم اضغط احسب</p>
        <template v-else>
          <p class="pm-muted">{{ result.employee ? result.employee.fullName + ' · ' : '' }}مدة الخدمة {{ span(result.eos.service) }} · الأجر {{ sar(result.eos.wage) }}</p>
          <dl class="pm-dl" style="grid-template-columns: 1fr">
            <div><dt>الشريحة الأولى (نصف شهر عن كل سنة)</dt><dd>{{ sar(result.eos.firstPart) }}</dd></div>
            <div><dt>ما بعدها (شهر عن كل سنة)</dt><dd>{{ sar(result.eos.secondPart) }}</dd></div>
            <div><dt>المكافأة الكاملة</dt><dd>{{ sar(result.eos.fullAmount) }}</dd></div>
            <div><dt>{{ result.eos.reasonLabel }}</dt><dd>{{ result.eos.explanation }} ({{ Math.round(result.eos.factor * 100) }}%)</dd></div>
            <div><dt>مكافأة نهاية الخدمة المستحقة</dt><dd class="pm-money" style="font-size: 1.4rem; color: var(--success)">{{ sar(result.eos.amount) }}</dd></div>
            <template v-if="result.employee">
              <div><dt>تعويض رصيد الإجازة السنوية ({{ num(result.leaveDays) }} يوم × {{ sar(result.dailyWage) }})</dt><dd>{{ sar(result.leaveEncashment) }}</dd></div>
              <div><dt>إجمالي المخالصة</dt><dd class="pm-money" style="font-size: 1.2rem">{{ sar(result.total) }}</dd></div>
            </template>
          </dl>
        </template>
      </section>
    </div>
  </div>
</template>
