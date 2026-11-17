<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { fmtDate, fmtDateTime, type RiskRef } from '../lib';
import '../audit.css';

/** تقرير المراجعة بصيغة رسمية للطباعة أو الحفظ PDF */
interface Finding { seq: number; title: string; observation: string; cause: string | null; effect: string; ratingLabel: string; recommendation: string; responsibleUnitName: string; dueDate: string; managementResponse: string | null; action: { code: string; dueDate: string } | null }
interface Eng {
  code: string; title: string; objective: string | null; scope: string | null; scopeLabel: string; plan: { code: string; title: string }; riskRefs: RiskRef[]; status: string;
  actualStart: string | null; actualEnd: string | null; plannedStart: string; plannedEnd: string; leadName: string | null; team: { name: string; role: string }[];
  report: { no: string; summary: string; opinionLabel: string; issuedAt: string; issuedByName: string } | null;
  items: { seq: number; title: string; criteria: string | null; resultLabel: string; conclusion: string | null; findings: Finding[] }[];
}
const props = defineProps<{ id: string }>();
const session = useSession();
const e = ref<Eng | null>(null);
onMounted(async () => {
  e.value = await api<Eng>(`/audit/engagements/${props.id}`);
});
</script>

<template>
  <div v-if="e">
    <div class="no-print" style="display: flex; gap: 8px; margin-bottom: 12px">
      <RouterLink :to="`/audit/engagements/${props.id}`" class="btn">رجوع للمهمة</RouterLink>
      <button class="btn btn-primary" onclick="window.print()">طباعة أو حفظ PDF</button>
    </div>
    <article class="au-report card">
      <p style="margin: 0; color: #64748b">{{ session.user?.organizationName }} · إدارة المراجعة الداخلية</p>
      <h1>تقرير المراجعة الداخلية: {{ e.title }}</h1>
      <p style="margin: 0 0 12px">رقم التقرير: <b>{{ e.report?.no ?? 'مسودة لم تصدر' }}</b> · المهمة {{ e.code }} · الخطة {{ e.plan.code }}</p>
      <table>
        <tbody>
          <tr><th>الجهة محل المراجعة</th><td>{{ e.scopeLabel }}</td><th>فترة التنفيذ</th><td>{{ fmtDate(e.actualStart ?? e.plannedStart) }} ← {{ fmtDate(e.actualEnd ?? e.plannedEnd) }}</td></tr>
          <tr><th>قائد المهمة</th><td>{{ e.leadName ?? '—' }}</td><th>الفريق</th><td>{{ e.team.map((t) => `${t.name} (${t.role})`).join('، ') || '—' }}</td></tr>
          <tr v-if="e.report"><th>الرأي العام</th><td><b>{{ e.report.opinionLabel }}</b></td><th>تاريخ الإصدار</th><td>{{ fmtDateTime(e.report.issuedAt) }}</td></tr>
        </tbody>
      </table>
      <h3>الهدف والنطاق</h3>
      <p class="au-text">{{ e.objective || '—' }}</p>
      <p class="au-text">{{ e.scope }}</p>
      <template v-if="e.riskRefs.length">
        <h3>المخاطر المرتبطة</h3>
        <p>{{ e.riskRefs.map((r) => `${r.code} ${r.title} (${r.levelLabel ?? r.level})`).join('، ') }}</p>
      </template>
      <h3>الملخص التنفيذي</h3>
      <p class="au-text">{{ e.report?.summary ?? 'يُكتب عند اعتماد التقرير' }}</p>
      <h3>نتائج بنود المراجعة</h3>
      <table>
        <thead><tr><th>#</th><th>بند المراجعة</th><th>المعيار</th><th>النتيجة</th><th>الخلاصة</th></tr></thead>
        <tbody><tr v-for="i in e.items" :key="i.seq"><td>{{ i.seq }}</td><td>{{ i.title }}</td><td>{{ i.criteria ?? '—' }}</td><td>{{ i.resultLabel }}</td><td>{{ i.conclusion ?? '—' }}</td></tr></tbody>
      </table>
      <h3>الملاحظات والتوصيات</h3>
      <template v-for="i in e.items" :key="`f${i.seq}`">
        <table v-for="f in i.findings" :key="f.seq">
          <tbody>
            <tr><th style="width: 22%">الملاحظة {{ f.seq }} (البند {{ i.seq }})</th><td><b>{{ f.title }}</b> · الخطورة: {{ f.ratingLabel }}</td></tr>
            <tr><th>الملاحظة</th><td class="au-text">{{ f.observation }}</td></tr>
            <tr v-if="f.cause"><th>السبب</th><td class="au-text">{{ f.cause }}</td></tr>
            <tr><th>الأثر والنتائج</th><td class="au-text">{{ f.effect }}</td></tr>
            <tr><th>التوصية بالعلاج</th><td class="au-text">{{ f.recommendation }}</td></tr>
            <tr><th>الجهة المسؤولة والموعد</th><td>{{ f.responsibleUnitName }} · {{ fmtDate(f.action?.dueDate ?? f.dueDate) }}{{ f.action ? ` · مهمة المتابعة ${f.action.code}` : '' }}</td></tr>
            <tr v-if="f.managementResponse"><th>رد الإدارة</th><td class="au-text">{{ f.managementResponse }}</td></tr>
          </tbody>
        </table>
      </template>
      <p v-if="!e.items.some((i) => i.findings.length)">لا توجد ملاحظات.</p>
      <div class="sign"><div>قائد المهمة<br />{{ e.leadName ?? '' }}</div><div>اعتمد التقرير<br />{{ e.report?.issuedByName ?? '' }}</div></div>
    </article>
  </div>
</template>
