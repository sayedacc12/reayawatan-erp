<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import CountUp from '../../beneficiaries/components/CountUp.vue';
import { sar, todayStr } from '../lib';
import '../../projects/projects.css';
import '../hr.css';

interface Line {
  id: string; employeeNo: number; fullName: string; isSaudi: boolean; unitName: string; jobTitle: string; items: { code: string; name: string; amount: number }[];
  gross: number; workedDays: number; earned: number; unpaidDays: number; unpaidDeduction: number; gosiEmployee: number; gosiEmployer: number; net: number; eosProvision: number; employerCost: number; iban: string | null;
}
interface Payroll { month: string; lines: Line[]; byUnit: { unit: string; employees: number; net: number; employerCost: number }[]; totals: Record<string, number> }
const month = ref(todayStr().slice(0, 7));
const data = ref<Payroll | null>(null);
const error = ref('');
async function load() {
  try {
    error.value = '';
    data.value = await api<Payroll>(`/hr/payroll?month=${month.value}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(month, load);
const item = (l: Line, code: string) => l.items.find((i) => i.code === code)?.amount ?? 0;
const others = (l: Line) => l.items.filter((i) => !['basic', 'housing', 'transport'].includes(i.code)).reduce((s, i) => s + i.amount, 0);
function exportCsv() {
  if (!data.value) return;
  const head = ['الرقم', 'الموظف', 'الوحدة', 'الأساسي', 'السكن', 'النقل', 'بدلات أخرى', 'المستحق', 'خصم بدون أجر', 'التأمينات على الموظف', 'الصافي', 'الآيبان'];
  const rows = data.value.lines.map((l) => [l.employeeNo, l.fullName, l.unitName, item(l, 'basic'), item(l, 'housing'), item(l, 'transport'), others(l), l.earned, l.unpaidDeduction, l.gosiEmployee, l.net, l.iban ?? '']);
  const csv = '﻿' + [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `مسير-رواتب-${month.value}.csv`;
  a.click();
}
</script>

<template>
  <div>
    <section class="pm-hero hr-hero">
      <div><p class="pm-kicker">شؤون الموظفين</p><h1>مسير الرواتب</h1><p class="pm-sub">معاينة مسير الشهر: الاستحقاق الجزئي لمن باشر أو انتهت خدمته خلال الشهر، وخصم الإجازات بدون أجر، والتأمينات بحصتيها. الاعتماد والصرف والقيد المحاسبي في المرحلة القادمة.</p></div>
      <div class="pm-actions">
        <input v-model="month" type="month" class="input" style="width: auto" />
        <button class="btn hr-ghost" :disabled="!data?.lines.length" @click="exportCsv">تصدير Excel (CSV)</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="data">
      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #a78bfa; --i: 0"><span>الموظفون في المسير</span><strong><CountUp :value="data.totals.employees" /></strong><small>{{ data.totals.missingIban ? `${data.totals.missingIban} بدون آيبان` : 'كل الحسابات البنكية مكتملة' }}</small></div>
        <div class="pm-kpi" style="--a: #0ea5e9; --i: 1"><span>إجمالي المستحق</span><strong><CountUp :value="data.totals.gross" :decimals="2" /></strong><small>ريال</small></div>
        <div class="pm-kpi" style="--a: #f59e0b; --i: 2"><span>الاستقطاعات</span><strong><CountUp :value="data.totals.gosiEmployee + data.totals.unpaidDeduction" :decimals="2" /></strong><small>تأمينات {{ sar(data.totals.gosiEmployee) }}</small></div>
        <div class="pm-kpi" style="--a: #10b981; --i: 3"><span>صافي الرواتب</span><strong><CountUp :value="data.totals.net" :decimals="2" /></strong><small>يُحوَّل للبنوك</small></div>
        <div class="pm-kpi" style="--a: #f472b6; --i: 4"><span>التكلفة الكاملة</span><strong><CountUp :value="data.totals.employerCost" :decimals="2" /></strong><small>تأمينات الجمعية {{ sar(data.totals.gosiEmployer) }}</small></div>
      </div>
      <section class="card pm-panel">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>الموظف</th><th>الأساسي</th><th>السكن</th><th>النقل</th><th>أخرى</th><th>أيام العمل</th><th>المستحق</th><th>بدون أجر</th><th>التأمينات</th><th>الصافي</th><th>تأمينات الجمعية</th><th>التكلفة</th></tr></thead>
            <tbody>
              <tr v-for="l in data.lines" :key="l.id">
                <td><RouterLink :to="`/hr/employees/${l.id}`" class="pm-link">{{ l.fullName }}</RouterLink><span class="pm-muted">{{ l.unitName }}</span></td>
                <td class="hr-num">{{ sar(item(l, 'basic')) }}</td><td class="hr-num">{{ sar(item(l, 'housing')) }}</td><td class="hr-num">{{ sar(item(l, 'transport')) }}</td><td class="hr-num">{{ sar(others(l)) }}</td>
                <td class="hr-num">{{ l.workedDays }}</td><td class="pm-money">{{ sar(l.earned) }}</td>
                <td class="hr-num" :style="{ color: l.unpaidDeduction ? 'var(--danger)' : '' }">{{ l.unpaidDays ? `${l.unpaidDays} يوم · ${sar(l.unpaidDeduction)}` : '—' }}</td>
                <td class="hr-num">{{ sar(l.gosiEmployee) }}</td><td class="pm-money" style="color: var(--success)">{{ sar(l.net) }}</td>
                <td class="hr-num">{{ sar(l.gosiEmployer) }}</td><td class="pm-money">{{ sar(l.employerCost) }}</td>
              </tr>
              <tr v-if="!data.lines.length"><td colspan="12" class="pm-empty">لا يوجد موظفون في هذا الشهر</td></tr>
            </tbody>
            <tfoot v-if="data.lines.length"><tr><td colspan="6"><b>الإجمالي</b></td><td class="pm-money">{{ sar(data.totals.gross) }}</td><td class="hr-num">{{ sar(data.totals.unpaidDeduction) }}</td>
              <td class="hr-num">{{ sar(data.totals.gosiEmployee) }}</td><td class="pm-money">{{ sar(data.totals.net) }}</td><td class="hr-num">{{ sar(data.totals.gosiEmployer) }}</td><td class="pm-money">{{ sar(data.totals.employerCost) }}</td></tr></tfoot>
          </table>
        </div>
      </section>
      <section class="card pm-panel" style="margin-top: 16px">
        <h2>التكلفة حسب الوحدة التنظيمية</h2>
        <table class="table">
          <thead><tr><th>الوحدة</th><th>الموظفون</th><th>صافي الرواتب</th><th>التكلفة الكاملة</th></tr></thead>
          <tbody><tr v-for="u in data.byUnit" :key="u.unit"><td>{{ u.unit }}</td><td>{{ u.employees }}</td><td class="pm-money">{{ sar(u.net) }}</td><td class="pm-money">{{ sar(u.employerCost) }}</td></tr></tbody>
        </table>
      </section>
    </template>
  </div>
</template>
