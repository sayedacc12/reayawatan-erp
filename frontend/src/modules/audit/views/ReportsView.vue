<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import { LEVEL_COLOR, LEVELS, fmtDate, thisYear } from '../lib';
import '../../../shared/module.css';
import '../audit.css';

interface Reports {
  year: number;
  planExecution: { code: string; title: string; kind: string; scopeLabel: string; status: string; total: number; done: number; active: number; hours: number; actualHours: number; findings: number; progress: number; availableHours: number }[];
  engagements: { id: string; code: string; title: string; status: string; priority: string; scopeLabel: string; plannedStart: string; plannedEnd: string; actualStart: string | null; actualEnd: string | null; budgetHours: number; actualHours: number; leadName: string | null; reportNo: string | null; opinion: string | null; late: boolean }[];
  byUnit: { unit: string; total: number; closed: number; open: number; overdue: number; submitted: number; extended: number; closureRate: number }[];
  findingsByCategory: { category: string; critical: number; high: number; medium: number; low: number; total: number }[];
  findingsTotal: Record<string, number>;
  riskCoverage: {
    registerAvailable: boolean;
    risks: { code: string; title: string; level: string; levelLabel: string; score: number | null; unitName: string | null; engagements: string[] }[];
    areas: { code: string; name: string; levelLabel: string; level: string; score: number; priority: number; lastAuditDate: string | null; nextDue: string | null; isDue: boolean; plannedThisYear: boolean }[];
  };
  overdue: { id: string; code: string; title: string; engagement: string; unit: string; assignee: string | null; priority: string; due: string; daysLate: number; progress: number; status: string }[];
}
type Tab = 'plan' | 'units' | 'findings' | 'coverage' | 'overdue';
const year = ref(thisYear());
const data = ref<Reports | null>(null);
const error = ref('');
const tab = ref<Tab>('plan');
async function load() {
  try {
    data.value = await api<Reports>(`/audit/reports?year=${year.value}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(year, load);
const TABS: { v: Tab; l: string }[] = [
  { v: 'plan', l: 'تنفيذ الخطة' }, { v: 'units', l: 'التوصيات حسب الجهة' }, { v: 'findings', l: 'الملاحظات حسب المجال' }, { v: 'coverage', l: 'تغطية المخاطر' }, { v: 'overdue', l: 'التوصيات المتأخرة' },
];
/** تصدير الجدول الظاهر إلى ملف CSV يفتح في Excel */
function exportCsv() {
  const table = document.querySelector('.au-report-table table');
  if (!table) return;
  const rows = [...table.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((c) => `"${(c as HTMLElement).innerText.replace(/"/g, '""').replace(/\n/g, ' ')}"`).join(','));
  const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `تقرير-المراجعة-${TABS.find((t) => t.v === tab.value)!.l}-${year.value}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
</script>

<template>
  <div>
    <section class="pm-hero au-hero no-print">
      <div><p class="pm-kicker">التقارير</p><h1>تقارير المراجعة الداخلية {{ year }}</h1>
        <p class="pm-sub">تقارير لجنة المراجعة ومجلس الإدارة: تنفيذ الخطة، وحالة التوصيات لدى كل جهة، وتوزيع الملاحظات، وتغطية المخاطر، والمتأخرات.</p></div>
      <div class="pm-actions">
        <select v-model.number="year" class="input" style="width: auto"><option v-for="y in [thisYear() - 1, thisYear(), thisYear() + 1]" :key="y" :value="y">{{ y }}</option></select>
        <button class="btn au-ghost" @click="exportCsv">تصدير Excel</button>
        <button class="btn au-glow" onclick="window.print()">طباعة</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="pm-tabs no-print">
      <button v-for="t in TABS" :key="t.v" :class="['pm-tab', { on: tab === t.v }]" @click="tab = t.v">{{ t.l }}</button>
    </div>
    <section v-if="data" class="card pm-panel au-report-table">
      <template v-if="tab === 'plan'">
        <h2>تنفيذ خطط المراجعة</h2>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>الخطة</th><th>النطاق</th><th>الحالة</th><th>المهام</th><th>صدر تقريرها</th><th>جارية</th><th>نسبة التنفيذ</th><th>الساعات المتاحة</th><th>المقدرة</th><th>الفعلية</th><th>الملاحظات</th></tr></thead>
          <tbody><tr v-for="p in data.planExecution" :key="p.code">
            <td><b>{{ p.kind === 'sub' ? '↳ ' : '' }}{{ p.title }}</b><span class="pm-muted">{{ p.code }}</span></td><td>{{ p.scopeLabel }}</td><td>{{ p.status }}</td>
            <td class="au-num">{{ p.total }}</td><td class="au-num">{{ p.done }}</td><td class="au-num">{{ p.active }}</td>
            <td style="min-width: 110px"><div class="au-track"><i :style="{ width: p.progress + '%' }" /></div><span class="pm-muted">{{ p.progress }}%</span></td>
            <td class="au-num">{{ p.availableHours }}</td><td class="au-num">{{ p.hours }}</td><td class="au-num">{{ p.actualHours }}</td><td class="au-num">{{ p.findings }}</td>
          </tr></tbody>
        </table></div>
        <h2 style="margin-top: 18px">مهام السنة</h2>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>المهمة</th><th>الجهة</th><th>الأولوية</th><th>المخطط</th><th>الفعلي</th><th>الساعات الفعلية من المقدرة</th><th>القائد</th><th>التقرير</th><th>الحالة</th></tr></thead>
          <tbody><tr v-for="e in data.engagements" :key="e.id">
            <td><RouterLink :to="`/audit/engagements/${e.id}`" class="pm-link">{{ e.title }}</RouterLink><span class="pm-muted">{{ e.code }}</span></td><td>{{ e.scopeLabel }}</td><td>{{ e.priority }}</td>
            <td>{{ fmtDate(e.plannedStart) }} ← {{ fmtDate(e.plannedEnd) }}</td><td>{{ fmtDate(e.actualStart) }} ← {{ fmtDate(e.actualEnd) }}</td>
            <td class="au-num">{{ e.actualHours }} من {{ e.budgetHours }}</td><td>{{ e.leadName ?? '—' }}</td><td>{{ e.reportNo ?? '—' }}<span v-if="e.opinion" class="pm-muted">{{ e.opinion }}</span></td>
            <td :style="{ color: e.late ? 'var(--danger)' : '' }">{{ e.status }}{{ e.late ? ' · متأخرة' : '' }}</td>
          </tr></tbody>
        </table></div>
      </template>

      <template v-else-if="tab === 'units'">
        <h2>التوصيات حسب الجهة المسؤولة</h2>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>الجهة</th><th>الإجمالي</th><th>مغلقة</th><th>مفتوحة</th><th>بانتظار التحقق</th><th>متأخرة</th><th>مُدّدة</th><th>نسبة الإغلاق</th></tr></thead>
          <tbody>
            <tr v-for="u in data.byUnit" :key="u.unit">
              <td><b>{{ u.unit }}</b></td><td class="au-num">{{ u.total }}</td><td class="au-num">{{ u.closed }}</td><td class="au-num">{{ u.open }}</td><td class="au-num">{{ u.submitted }}</td>
              <td class="au-num" :style="{ color: u.overdue ? 'var(--danger)' : '', fontWeight: u.overdue ? 700 : 400 }">{{ u.overdue }}</td><td class="au-num">{{ u.extended }}</td>
              <td style="min-width: 110px"><div class="au-track ok"><i :style="{ width: u.closureRate + '%' }" /></div><span class="pm-muted">{{ u.closureRate }}%</span></td>
            </tr>
            <tr v-if="!data.byUnit.length"><td colspan="8" class="pm-empty">لا توجد توصيات لمهام هذه السنة</td></tr>
          </tbody>
        </table></div>
      </template>

      <template v-else-if="tab === 'findings'">
        <h2>الملاحظات حسب المجال والخطورة</h2>
        <div class="pm-legend" style="margin-bottom: 10px"><span v-for="l in LEVELS" :key="l.value" :style="{ '--c': LEVEL_COLOR[l.value] }">{{ l.label }} {{ data.findingsTotal[l.value] }}</span></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>المجال</th><th v-for="l in LEVELS" :key="l.value">{{ l.label }}</th><th>الإجمالي</th><th style="width: 30%">التوزيع</th></tr></thead>
          <tbody>
            <tr v-for="c in data.findingsByCategory" :key="c.category">
              <td><b>{{ c.category }}</b></td><td v-for="l in LEVELS" :key="l.value" class="au-num">{{ c[l.value] }}</td><td class="au-num"><b>{{ c.total }}</b></td>
              <td><div class="pm-bar"><i v-for="l in LEVELS" :key="l.value" :style="{ width: (c[l.value] / Math.max(1, c.total)) * 100 + '%', background: LEVEL_COLOR[l.value] }" /></div></td>
            </tr>
            <tr v-if="!data.findingsByCategory.length"><td colspan="7" class="pm-empty">لا توجد ملاحظات في تقارير صادرة لهذه السنة</td></tr>
          </tbody>
        </table></div>
      </template>

      <template v-else-if="tab === 'coverage'">
        <h2>تغطية مجالات المراجعة</h2>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>المجال</th><th>الدرجة</th><th>المستوى</th><th>الأولوية</th><th>آخر مراجعة</th><th>المراجعة القادمة</th><th>في خطة السنة</th></tr></thead>
          <tbody><tr v-for="a in data.riskCoverage.areas" :key="a.code">
            <td><b>{{ a.name }}</b><span class="pm-muted">{{ a.code }}</span></td><td><span class="au-score" :style="{ '--c': LEVEL_COLOR[a.level], minWidth: '28px', height: '28px' }">{{ a.score }}</span></td>
            <td>{{ a.levelLabel }}</td><td class="au-num">{{ a.priority }}</td><td>{{ fmtDate(a.lastAuditDate) }}</td><td :style="{ color: a.isDue ? 'var(--danger)' : '' }">{{ a.nextDue ? fmtDate(a.nextDue) : 'لم يُراجع' }}</td>
            <td>{{ a.plannedThisYear ? '✓ مخطط' : a.isDue ? '✕ مستحق وغير مخطط' : '—' }}</td>
          </tr></tbody>
        </table></div>
        <h2 style="margin-top: 18px">تغطية سجل المخاطر</h2>
        <p v-if="!data.riskCoverage.registerAvailable" class="pm-muted">يظهر هذا القسم عند تفعيل سجل المخاطر.</p>
        <div v-else class="table-wrap"><table class="table">
          <thead><tr><th>الخطر</th><th>الجهة</th><th>المستوى</th><th>الدرجة</th><th>مهام المراجعة التي تغطيه</th></tr></thead>
          <tbody><tr v-for="r in data.riskCoverage.risks" :key="r.code">
            <td><b>{{ r.title }}</b><span class="pm-muted">{{ r.code }}</span></td><td>{{ r.unitName ?? '—' }}</td>
            <td><span class="au-lvl" :style="{ '--c': LEVEL_COLOR[r.level] ?? '#94a3b8' }">{{ r.levelLabel }}</span></td><td class="au-num">{{ r.score ?? '—' }}</td>
            <td :style="{ color: !r.engagements.length && ['high', 'critical'].includes(r.level) ? 'var(--danger)' : '' }">{{ r.engagements.join('، ') || 'غير مغطى' }}</td>
          </tr></tbody>
        </table></div>
      </template>

      <template v-else>
        <h2>التوصيات المتأخرة (كل السنوات)</h2>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>التوصية</th><th>المهمة</th><th>الجهة</th><th>المسؤول</th><th>الخطورة</th><th>الموعد</th><th>التأخير</th><th>الإنجاز</th></tr></thead>
          <tbody>
            <tr v-for="a in data.overdue" :key="a.id">
              <td><RouterLink :to="`/audit/actions/${a.id}`" class="pm-link">{{ a.title }}</RouterLink><span class="pm-muted">{{ a.code }}</span></td><td>{{ a.engagement }}</td><td>{{ a.unit }}</td><td>{{ a.assignee ?? '—' }}</td>
              <td>{{ a.priority }}</td><td>{{ fmtDate(a.due) }}</td><td class="au-due late">{{ a.daysLate }} يوم</td><td class="au-num">{{ a.progress }}%</td>
            </tr>
            <tr v-if="!data.overdue.length"><td colspan="8" class="pm-empty">لا توجد توصيات متأخرة</td></tr>
          </tbody>
        </table></div>
      </template>
    </section>
  </div>
</template>
