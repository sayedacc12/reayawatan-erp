<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { exportCsv, fmtDate, num, sar, todayStr } from '../lib';
import '../../projects/projects.css';
import '../volunteers.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const toast = useToast();
const from = ref(`${todayStr().slice(0, 4)}-01-01`);
const to = ref(todayStr());
const r = ref<any>(null);
const tab = ref('hours');
async function load() {
  try {
    r.value = await api(`/volunteers/reports?from=${from.value}&to=${to.value}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
const TABS = [
  { k: 'hours', l: 'ساعات المتطوعين' }, { k: 'events', l: 'الفعاليات وأثرها' }, { k: 'fields', l: 'المجالات والأنواع' },
  { k: 'satisfaction', l: 'الرضا والشهادات' }, { k: 'tickets', l: 'الشكاوى والمقترحات' },
];
const totals = computed(() => ({
  hours: (r.value?.volunteerHours ?? []).reduce((a: number, x: any) => a + x.hours, 0),
  beneficiaries: (r.value?.events ?? []).reduce((a: number, x: any) => a + (x.actualBeneficiaries ?? 0), 0),
  cost: (r.value?.events ?? []).reduce((a: number, x: any) => a + (x.actualCost ?? 0), 0),
}));
function exportTab() {
  const d = r.value;
  if (tab.value === 'hours') exportCsv('ساعات المتطوعين', ['الرقم', 'المتطوع', 'الجنس', 'النوع', 'الفعاليات', 'الساعات', 'متوسط التقييم'], d.volunteerHours.map((x: any) => [x.volunteerNo, x.fullName, x.gender, x.type, x.events, x.hours, x.rating]));
  else if (tab.value === 'events') exportCsv('الفعاليات', ['الرقم', 'الفعالية', 'النوع', 'التصنيف', 'من', 'إلى', 'الحالة', 'المستهدف', 'الفعلي', 'المتطوعون', 'الساعات', 'الميزانية', 'التكلفة', 'الرضا'],
    d.events.map((x: any) => [x.eventNo, x.title, x.kind, x.category, x.startDate, x.endDate, x.status, x.targetBeneficiaries, x.actualBeneficiaries, x.attended, x.hours, x.budget, x.actualCost, x.satisfaction]));
  else if (tab.value === 'fields') exportCsv('المجالات', ['المجال', 'المتطوعون', 'الفعاليات'], d.fields.map((x: any) => [x.name, x.volunteers, x.events]));
  else if (tab.value === 'satisfaction') exportCsv('الرضا', ['الفئة', 'الردود', 'نسبة الرضا'], d.satisfaction.map((x: any) => [x.audience, x.n, x.score]));
  else exportCsv('الشكاوى والمقترحات', ['النوع', 'الحالة', 'العدد'], d.tickets.map((x: any) => [x.kind, x.status, x.n]));
}
const printNow = () => window.print();
const maxField = computed(() => Math.max(1, ...(r.value?.fields ?? []).map((f: any) => f.volunteers)));
</script>

<template>
  <div>
    <section class="pm-hero vt-hero no-print">
      <div><p class="pm-kicker">التقارير</p><h1>تقارير التطوع</h1><p class="pm-sub">ساعات المتطوعين، الفعاليات وأثرها، المجالات، الرضا، والشكاوى، لأي فترة. كل تقرير يُطبع أو يُصدَّر إلى Excel.</p></div>
      <div class="pm-actions">
        <input v-model="from" type="date" class="input" style="width: auto" /><input v-model="to" type="date" class="input" style="width: auto" />
        <button class="btn vt-glow" @click="load">عرض</button>
      </div>
    </section>
    <template v-if="r">
      <div class="pm-kpis no-print">
        <div class="pm-kpi" style="--a: #facc15; --i: 0"><span>الساعات التطوعية</span><strong>{{ num(totals.hours) }}</strong><small>{{ r.volunteerHours.length }} متطوعًا</small></div>
        <div class="pm-kpi" style="--a: #10b981; --i: 1"><span>الفعاليات</span><strong>{{ r.events.length }}</strong><small>في الفترة</small></div>
        <div class="pm-kpi" style="--a: #0ea5e9; --i: 2"><span>المستفيدون الفعليون</span><strong>{{ num(totals.beneficiaries) }}</strong><small>من تقارير الإغلاق</small></div>
        <div class="pm-kpi" style="--a: #f472b6; --i: 3"><span>التكلفة الفعلية</span><strong>{{ num(totals.cost) }}</strong><small>ريال</small></div>
      </div>
      <div class="vt-toolbar no-print">
        <div class="vt-tabs" style="margin: 0"><button v-for="t in TABS" :key="t.k" :class="['vt-tab', { on: tab === t.k }]" @click="tab = t.k">{{ t.l }}</button></div>
        <span class="grow" />
        <button class="btn btn-sm" @click="exportTab">تصدير Excel</button>
        <button class="btn btn-sm" @click="printNow">طباعة</button>
      </div>
      <section class="card pm-panel vt-print">
        <h2>{{ TABS.find((t) => t.k === tab)?.l }} <span class="pm-muted">من {{ fmtDate(r.from) }} إلى {{ fmtDate(r.to) }}</span></h2>
        <div class="table-wrap">
          <table v-if="tab === 'hours'" class="table">
            <thead><tr><th>#</th><th>المتطوع</th><th>الجنس</th><th>النوع</th><th>الفعاليات</th><th>الساعات</th><th>تقييم المشرف</th></tr></thead>
            <tbody><tr v-for="(x, i) in r.volunteerHours" :key="i"><td>{{ x.volunteerNo }}</td><td>{{ x.fullName }}</td><td>{{ x.gender }}</td><td>{{ x.type }}</td><td>{{ x.events }}</td><td class="pm-money">{{ num(x.hours) }}</td><td>{{ x.rating ? `${num(x.rating)} / 5` : '—' }}</td></tr>
              <tr v-if="!r.volunteerHours.length"><td colspan="7" class="pm-empty">لا توجد ساعات في الفترة</td></tr></tbody>
          </table>
          <table v-else-if="tab === 'events'" class="table">
            <thead><tr><th>الفعالية</th><th>النوع</th><th>الموعد</th><th>الحالة</th><th>المستفيدون (مستهدف/فعلي)</th><th>المتطوعون</th><th>الساعات</th><th>الميزانية/التكلفة</th><th>الرضا</th></tr></thead>
            <tbody><tr v-for="(x, i) in r.events" :key="i"><td class="vt-wrap"><b>{{ x.title }}</b><span class="pm-muted" style="display: block">{{ x.eventNo }} · {{ x.category }}</span></td><td>{{ x.kind }}</td><td>{{ fmtDate(x.startDate) }}</td><td>{{ x.status }}</td>
              <td>{{ num(x.targetBeneficiaries) }} / {{ x.actualBeneficiaries ?? '—' }}</td><td>{{ x.attended }}</td><td>{{ num(x.hours) }}</td><td>{{ sar(x.budget) }} / {{ x.actualCost !== null ? sar(x.actualCost) : '—' }}</td><td>{{ x.satisfaction !== null ? `${num(x.satisfaction)}%` : '—' }}</td></tr>
              <tr v-if="!r.events.length"><td colspan="9" class="pm-empty">لا توجد فعاليات في الفترة</td></tr></tbody>
          </table>
          <div v-else-if="tab === 'fields'" class="vt-grid" style="grid-template-columns: 1fr 1fr">
            <div><div class="vt-sec">المتطوعون النشطون والفعاليات حسب المجال</div>
              <div class="vt-bars"><div v-for="f in r.fields" :key="f.name" class="r"><span>{{ f.name }}</span><span class="vt-bar"><i :style="{ width: (f.volunteers / maxField) * 100 + '%' }" /></span><b>{{ f.volunteers }}</b></div></div>
              <table class="table" style="margin-top: 10px"><thead><tr><th>المجال</th><th>المتطوعون</th><th>الفعاليات</th></tr></thead><tbody><tr v-for="f in r.fields" :key="f.name"><td>{{ f.name }}</td><td>{{ f.volunteers }}</td><td>{{ f.events }}</td></tr></tbody></table>
            </div>
            <div><div class="vt-sec">المتطوعون النشطون حسب نوع التطوع</div>
              <table class="table"><thead><tr><th>النوع</th><th>العدد</th></tr></thead><tbody><tr v-for="t in r.types" :key="t.name"><td>{{ t.name }}</td><td>{{ t.n }}</td></tr></tbody></table>
              <div class="vt-sec">المتطوعون حسب الحالة</div>
              <table class="table"><thead><tr><th>الحالة</th><th>العدد</th></tr></thead><tbody><tr v-for="t in r.statuses" :key="t.name"><td>{{ t.name }}</td><td>{{ t.n }}</td></tr></tbody></table>
            </div>
          </div>
          <div v-else-if="tab === 'satisfaction'" class="vt-grid" style="grid-template-columns: 1fr 1fr">
            <div><div class="vt-sec">نتائج استبانات الرضا</div>
              <table class="table"><thead><tr><th>الفئة</th><th>الردود</th><th>نسبة الرضا</th></tr></thead><tbody><tr v-for="s in r.satisfaction" :key="s.audience"><td>{{ s.audience }}</td><td>{{ s.n }}</td><td class="pm-money">{{ num(s.score) }}%</td></tr>
                <tr v-if="!r.satisfaction.length"><td colspan="3" class="pm-empty">لا توجد ردود</td></tr></tbody></table></div>
            <div><div class="vt-sec">الشهادات الصادرة</div>
              <table class="table"><thead><tr><th>النوع</th><th>العدد</th><th>الساعات</th></tr></thead><tbody><tr v-for="c in r.certificates" :key="c.kind"><td>{{ c.kind }}</td><td>{{ c.n }}</td><td>{{ num(c.hours) }}</td></tr>
                <tr v-if="!r.certificates.length"><td colspan="3" class="pm-empty">لا توجد شهادات</td></tr></tbody></table></div>
          </div>
          <table v-else class="table">
            <thead><tr><th>النوع</th><th>الحالة</th><th>العدد</th></tr></thead>
            <tbody><tr v-for="(t, i) in r.tickets" :key="i"><td>{{ t.kind }}</td><td>{{ t.status }}</td><td>{{ t.n }}</td></tr><tr v-if="!r.tickets.length"><td colspan="3" class="pm-empty">لا توجد طلبات في الفترة</td></tr></tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
