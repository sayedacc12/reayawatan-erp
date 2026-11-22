<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { STATUS_COLOR, LEVEL_COLOR, fmtDate, num, thisYear, type DocRow } from '../lib';
import '../../../shared/module.css';
import '../quality.css';

type G = { label: string; count: number }[];
interface Ncr { id: string; code: string; title: string; sourceLabel: string; departmentName: string; severity: string; detectedDate: string; dueDate: string | null; status: string; statusLabel: string; daysOpen: number; overdue: boolean }
interface Audit { id: string; code: string; title: string; departmentName: string; leadAuditor: string; plannedDate: string; actualDate: string | null; status: string; statusLabel: string; findings: Record<string, number> }
interface Risk { id: string; code: string; title: string; kind: string; process: string; departmentName: string; score: number; level: string; levelLabel: string; treatmentLabel: string; ownerName: string; status: string; actionsOpen: number }
interface Obj { id: string; title: string; kpi: string; unit: string; target: number; current: number | null; direction: string; departmentName: string; ownerName: string; status: string; statusLabel: string; progress: number | null }
interface Report {
  organizationName: string; generatedAt: string; generatedBy: string; period: { from: string; to: string };
  context: { policy: { text: string; date: string | null }; scope: string };
  documents: { total: number; own: number; approved: number; pending: number; due: number; overdue: number; obsolete: number; external: number; maps: number; procedures: number; byType: G; changed: { code: string; title: string; revisionLabel: string }[]; pendingAck: number };
  ncr: { total: number; open: number; closed: number; major: number; overdue: number; overdueActions: number; closureRate: number | null; avgDays: number | null; bySource: G; byDepartment: G; list: Ncr[] };
  audits: { planned: number; completed: number; overdue: number; findings: Record<string, number>; list: Audit[] };
  risks: { total: number; risks: number; opportunities: number; high: number; openActions: number; reviewDue: number; top: Risk[] };
  objectives: { total: number; achieved: number; behind: number; list: Obj[] };
  complaints: { total: number; open: number; late: number; resolved: number; avgDays: number | null; targetDays: number; satisfaction: number | null; toNcr: number; byCategory: G; byChannel: G; byParty: G };
  satisfaction: { index: number | null; responses: number; surveys: { id: string; title: string; audienceLabel: string; responses: number; index: number | null; status: string }[] };
  reviews: { total: number; last: { title: string; meetingDate: string; status: string } | null; openOutputs: number };
  standard: { score: number; sections: { code: string; title: string; score: number; clauses: { code: string; title: string; status: string }[] }[] };
}
interface Complaint { id: string; code: string; subject: string; partyLabel: string; channelLabel: string; departmentName: string; receivedDate: string; days: number; late: boolean; status: string; statusLabel: string; satisfaction: number | null }

type Tab = 'report' | 'documents' | 'ncr' | 'risks' | 'complaints' | 'objectives' | 'audits';
const TABS: { key: Tab; label: string; code: string }[] = [
  { key: 'report', label: 'تقرير الجودة', code: 'QR-QMS-01' }, { key: 'documents', label: 'سجل الوثائق', code: 'QR-QMS-02' }, { key: 'ncr', label: 'سجل عدم المطابقة', code: 'QR-QMS-03' },
  { key: 'risks', label: 'سجل المخاطر والفرص', code: 'QR-QMS-04' }, { key: 'complaints', label: 'الشكاوى والرضا', code: 'QR-QMS-05' }, { key: 'objectives', label: 'متابعة الأهداف', code: 'QR-QMS-06' },
  { key: 'audits', label: 'برنامج المراجعة الداخلية', code: 'QR-QMS-07' },
];
const tab = ref<Tab>('report');
const y = thisYear();
const period = reactive({ from: `${y}-01-01`, to: `${y}-12-31` });
const r = ref<Report | null>(null);
const docs = ref<DocRow[]>([]);
const risks = ref<Risk[]>([]);
const complaints = ref<Complaint[]>([]);
const loading = ref(false);
async function load() {
  loading.value = true;
  try {
    const [rep, d, rk, c] = await Promise.all([
      api<Report>(`/quality/reports?from=${period.from}&to=${period.to}`), api<{ rows: DocRow[] }>('/quality/documents'), api<Risk[]>('/quality/risks'),
      api<{ rows: Complaint[] }>('/quality/complaints'),
    ]);
    r.value = rep;
    docs.value = d.rows;
    risks.value = rk;
    complaints.value = c.rows.filter((x) => x.receivedDate >= period.from && x.receivedDate <= period.to);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
const printPage = () => window.print();
const pc = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${num(v)}%`);
const cur = computed(() => TABS.find((t) => t.key === tab.value)!);
const maxOf = (g: G) => Math.max(1, ...g.map((x) => x.count));
const FINDING = { major: 'جسيمة', minor: 'بسيطة', observation: 'ملاحظات', ofi: 'فرص تحسين' } as const;

/** تصدير السجل الحالي إلى ملف CSV يفتح في Excel */
function exportCsv() {
  const table = document.querySelector<HTMLTableElement>('.q-register table');
  if (!table) return;
  const rows = [...table.rows].map((tr) => [...tr.cells].map((td) => `"${td.innerText.replace(/\s+/g, ' ').trim().replace(/"/g, '""')}"`).join(','));
  const blob = new Blob([`﻿${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${cur.value.code}-${cur.value.label}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
</script>

<template>
  <div>
    <section class="pm-hero q-hero no-print">
      <div><p class="pm-kicker">البند 9.1.3 · قسم التقارير</p><h1>تقارير الجودة</h1>
        <p class="pm-sub">تقرير الجودة الدوري للإدارة العليا، وسجلات النظام قابلة للطباعة والتصدير إلى Excel.</p></div>
      <div class="pm-actions">
        <input v-model="period.from" type="date" class="input" style="width: auto" /><input v-model="period.to" type="date" class="input" style="width: auto" />
        <button class="btn q-ghost" :disabled="loading" @click="load">عرض</button>
        <button v-if="tab !== 'report'" class="btn q-ghost" @click="exportCsv">تصدير Excel</button>
        <button class="btn q-glow" @click="printPage">طباعة</button>
      </div>
    </section>
    <div class="q-tabs no-print"><button v-for="t in TABS" :key="t.key" :class="['q-tab', { on: tab === t.key }]" @click="tab = t.key">{{ t.label }}</button></div>

    <div v-if="r" class="q-paper">
      <div class="q-paper-head">
        <div><b>{{ r.organizationName }}</b><br /><span class="pm-muted">نظام إدارة الجودة ISO 9001</span></div>
        <div class="t">{{ cur.label }}</div>
        <div><span class="q-code">{{ cur.code }}</span><br /><span class="pm-muted">الفترة {{ fmtDate(r.period.from) }} إلى {{ fmtDate(r.period.to) }}</span></div>
      </div>
      <div class="q-paper-body">
        <!-- تقرير الجودة -->
        <template v-if="tab === 'report'">
          <h3>1. الملخص التنفيذي</h3>
          <div class="pm-kpis">
            <div class="pm-kpi"><span>المطابقة للمواصفة</span><strong>{{ r.standard.score }}%</strong></div>
            <div class="pm-kpi"><span>مؤشر رضا المستفيدين</span><strong>{{ pc(r.satisfaction.index) }}</strong></div>
            <div class="pm-kpi"><span>إغلاق حالات عدم المطابقة</span><strong>{{ pc(r.ncr.closureRate) }}</strong></div>
            <div class="pm-kpi"><span>الأهداف المحققة</span><strong>{{ r.objectives.achieved }}/{{ r.objectives.total }}</strong></div>
            <div class="pm-kpi"><span>الشكاوى</span><strong>{{ r.complaints.total }}</strong></div>
            <div class="pm-kpi"><span>المراجعات الداخلية</span><strong>{{ r.audits.completed }}/{{ r.audits.planned }}</strong></div>
          </div>
          <p v-if="r.context.policy.text" class="q-pre pm-muted" style="margin-top: 10px">سياسة الجودة: {{ r.context.policy.text }}</p>

          <h3>2. المطابقة لبنود المواصفة</h3>
          <table class="table"><tbody>
            <tr v-for="s in r.standard.sections" :key="s.code">
              <td style="width: 34%"><b>{{ s.code }}. {{ s.title }}</b></td>
              <td><div class="q-progress"><i :style="{ width: s.score + '%', '--c': s.score >= 80 ? '#10b981' : s.score >= 50 ? '#f59e0b' : '#ef4444' }" /></div></td>
              <td class="q-num" style="width: 60px">{{ s.score }}%</td>
              <td class="pm-muted">{{ s.clauses.filter((c) => c.status !== 'met').map((c) => c.code).join('، ') || 'كل البنود مستوفاة' }}</td>
            </tr>
          </tbody></table>

          <h3>3. أهداف الجودة</h3>
          <table class="table">
            <thead><tr><th>الهدف</th><th>المؤشر</th><th>المستهدف</th><th>الفعلي</th><th>الحالة</th></tr></thead>
            <tbody><tr v-for="o in r.objectives.list" :key="o.id"><td>{{ o.title }}</td><td>{{ o.kpi }}</td><td class="q-num">{{ o.direction === 'increase' ? '≥' : '≤' }} {{ num(o.target) }} {{ o.unit }}</td><td class="q-num">{{ num(o.current) }} {{ o.unit }}</td><td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[o.status] }">{{ o.statusLabel }}</span></td></tr></tbody>
          </table>

          <h3>4. عدم المطابقة والإجراءات التصحيحية</h3>
          <p>سُجلت {{ r.ncr.total }} حالة في الفترة (جسيمة {{ r.ncr.major }})، أُغلق منها {{ r.ncr.closed }} بنسبة {{ pc(r.ncr.closureRate) }} ومتوسط {{ num(r.ncr.avgDays) }} يوم. المفتوح حاليًا {{ r.ncr.open }}، والمتأخر {{ r.ncr.overdue }}، وإجراءات متأخرة {{ r.ncr.overdueActions }}.</p>
          <div class="q-grid" style="grid-template-columns: 1fr 1fr">
            <div><b class="pm-muted">حسب المصدر</b><div class="q-dist"><div v-for="g in r.ncr.bySource" :key="g.label" class="r" style="grid-template-columns: 120px 1fr 30px"><span>{{ g.label }}</span><i :style="{ width: (g.count / maxOf(r.ncr.bySource)) * 100 + '%', '--c': '#f97316' }" /><span>{{ g.count }}</span></div></div></div>
            <div><b class="pm-muted">حسب الإدارة</b><div class="q-dist"><div v-for="g in r.ncr.byDepartment" :key="g.label" class="r" style="grid-template-columns: 120px 1fr 30px"><span>{{ g.label }}</span><i :style="{ width: (g.count / maxOf(r.ncr.byDepartment)) * 100 + '%', '--c': '#6366f1' }" /><span>{{ g.count }}</span></div></div></div>
          </div>

          <h3>5. رضا المستفيدين والشكاوى</h3>
          <p>مؤشر الرضا {{ pc(r.satisfaction.index) }} من {{ r.satisfaction.responses }} رد. الشكاوى {{ r.complaints.total }}: عولج منها {{ r.complaints.resolved }} بمتوسط {{ num(r.complaints.avgDays) }} يوم (المستهدف {{ r.complaints.targetDays }})، والمفتوح {{ r.complaints.open }}، وحُول لعدم مطابقة {{ r.complaints.toNcr }}.<template v-if="r.complaints.satisfaction"> رضا أصحاب الشكاوى عن المعالجة {{ num(r.complaints.satisfaction) }} من 5.</template></p>
          <div class="q-grid" style="grid-template-columns: 1fr 1fr">
            <table class="table"><thead><tr><th>الاستبانة</th><th>الردود</th><th>المؤشر</th></tr></thead><tbody><tr v-for="s in r.satisfaction.surveys" :key="s.id"><td>{{ s.title }}<span class="pm-muted">{{ s.audienceLabel }}</span></td><td class="q-num">{{ s.responses }}</td><td class="q-num">{{ pc(s.index) }}</td></tr></tbody></table>
            <div><b class="pm-muted">الشكاوى حسب التصنيف</b><div class="q-dist"><div v-for="g in r.complaints.byCategory" :key="g.label" class="r" style="grid-template-columns: 120px 1fr 30px"><span>{{ g.label }}</span><i :style="{ width: (g.count / maxOf(r.complaints.byCategory)) * 100 + '%', '--c': '#0ea5e9' }" /><span>{{ g.count }}</span></div></div></div>
          </div>

          <h3>6. المراجعة الداخلية</h3>
          <p>نُفذت {{ r.audits.completed }} من {{ r.audits.planned }} مراجعة مخططة<template v-if="r.audits.overdue">، ومتأخر {{ r.audits.overdue }}</template>. النتائج: <template v-for="(l, k) in FINDING" :key="k">{{ l }} {{ r.audits.findings[k] ?? 0 }}، </template>.</p>

          <h3>7. المخاطر والفرص</h3>
          <p>{{ r.risks.risks }} خطر و{{ r.risks.opportunities }} فرصة. المخاطر المرتفعة المفتوحة {{ r.risks.high }}، وإجراءات المعالجة المفتوحة {{ r.risks.openActions }}.</p>
          <table class="table"><thead><tr><th>الرقم</th><th>الخطر</th><th>الدرجة</th><th>المعالجة</th><th>المسؤول</th></tr></thead>
            <tbody><tr v-for="k in r.risks.top" :key="k.id"><td><span class="q-code">{{ k.code }}</span></td><td>{{ k.title }}</td><td><span class="pm-pill" :style="{ '--c': LEVEL_COLOR[k.level] }">{{ k.score }} · {{ k.levelLabel }}</span></td><td>{{ k.treatmentLabel }}</td><td>{{ k.ownerName }}</td></tr></tbody>
          </table>

          <h3>8. الوثائق والمعلومات الموثقة</h3>
          <p>{{ r.documents.total }} وثيقة ({{ r.documents.own }} في نظام الجودة و{{ r.documents.total - r.documents.own }} من الأنظمة الأخرى)، المعتمد منها {{ r.documents.approved }}، وبانتظار الاعتماد {{ r.documents.pending }}، والإجراءات الموثقة {{ r.documents.procedures }}، وخرائط الإجراءات {{ r.documents.maps }}. المستحق مراجعتها {{ r.documents.due }} (متأخر {{ r.documents.overdue }})، ونسخ لم يؤكَّد استلامها {{ r.documents.pendingAck }}.</p>
          <p v-if="r.documents.changed.length" class="pm-muted">الوثائق المعتمدة أو المعدلة في الفترة: {{ r.documents.changed.map((d) => `${d.code} ${d.revisionLabel}`).join('، ') }}</p>

          <h3>9. مراجعة الإدارة</h3>
          <p v-if="r.reviews.last">آخر مراجعة: {{ r.reviews.last.title }} بتاريخ {{ fmtDate(r.reviews.last.meetingDate) }} ({{ r.reviews.last.status === 'approved' ? 'معتمدة' : 'مسودة' }}). القرارات قيد التنفيذ: {{ r.reviews.openOutputs }}.</p>
          <p v-else>لم تُعقد مراجعة إدارة بعد.</p>
        </template>

        <!-- السجلات -->
        <div v-else class="q-register table-wrap">
          <table v-if="tab === 'documents'" class="table">
            <thead><tr><th>الرمز</th><th>العنوان</th><th>النوع</th><th>الإدارة</th><th>الإصدار</th><th>تاريخ السريان</th><th>المراجعة القادمة</th><th>المصدر</th><th>الحالة</th></tr></thead>
            <tbody><tr v-for="d in docs" :key="d.id"><td><span class="q-code">{{ d.code }}</span></td><td>{{ d.title }}</td><td>{{ d.typeLabel }}</td><td>{{ d.department }}</td><td class="q-rev">{{ d.revisionLabel }}</td><td class="q-num">{{ fmtDate(d.effectiveDate) }}</td><td class="q-num" :style="{ color: d.reviewOverdue ? 'var(--danger)' : '' }">{{ fmtDate(d.nextReviewDate) }}</td><td>{{ d.sourceLabel }}</td><td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[d.status] }">{{ d.statusLabel }}</span></td></tr></tbody>
          </table>
          <table v-else-if="tab === 'ncr'" class="table">
            <thead><tr><th>الرقم</th><th>الحالة</th><th>المصدر</th><th>الإدارة</th><th>الجسامة</th><th>الاكتشاف</th><th>الموعد</th><th>المدة</th><th>المرحلة</th></tr></thead>
            <tbody><tr v-for="n in r.ncr.list" :key="n.id"><td><span class="q-code">{{ n.code }}</span></td><td>{{ n.title }}</td><td>{{ n.sourceLabel }}</td><td>{{ n.departmentName }}</td><td>{{ n.severity === 'major' ? 'جسيمة' : 'بسيطة' }}</td><td class="q-num">{{ fmtDate(n.detectedDate) }}</td><td class="q-num" :style="{ color: n.overdue ? 'var(--danger)' : '' }">{{ fmtDate(n.dueDate) }}</td><td class="q-num">{{ n.daysOpen }} يوم</td><td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[n.status] }">{{ n.statusLabel }}</span></td></tr></tbody>
          </table>
          <table v-else-if="tab === 'risks'" class="table">
            <thead><tr><th>الرقم</th><th>النوع</th><th>العنوان</th><th>العملية</th><th>الإدارة</th><th>الدرجة</th><th>المعالجة</th><th>المسؤول</th><th>إجراءات مفتوحة</th></tr></thead>
            <tbody><tr v-for="k in risks" :key="k.id"><td><span class="q-code">{{ k.code }}</span></td><td>{{ k.kind === 'risk' ? 'خطر' : 'فرصة' }}</td><td>{{ k.title }}</td><td>{{ k.process }}</td><td>{{ k.departmentName }}</td><td><span class="pm-pill" :style="{ '--c': k.kind === 'risk' ? LEVEL_COLOR[k.level] : '#10b981' }">{{ k.score }} · {{ k.levelLabel }}</span></td><td>{{ k.treatmentLabel }}</td><td>{{ k.ownerName }}</td><td class="q-num">{{ k.actionsOpen }}</td></tr></tbody>
          </table>
          <table v-else-if="tab === 'complaints'" class="table">
            <thead><tr><th>الرقم</th><th>الموضوع</th><th>صاحب الشكوى</th><th>القناة</th><th>الإدارة</th><th>الاستلام</th><th>المدة</th><th>رضا المعالجة</th><th>الحالة</th></tr></thead>
            <tbody><tr v-for="c in complaints" :key="c.id"><td><span class="q-code">{{ c.code }}</span></td><td>{{ c.subject }}</td><td>{{ c.partyLabel }}</td><td>{{ c.channelLabel }}</td><td>{{ c.departmentName }}</td><td class="q-num">{{ fmtDate(c.receivedDate) }}</td><td class="q-num" :style="{ color: c.late ? 'var(--danger)' : '' }">{{ c.days }} يوم</td><td class="q-num">{{ c.satisfaction ? `${c.satisfaction} / 5` : '—' }}</td><td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[c.status] }">{{ c.statusLabel }}</span></td></tr></tbody>
          </table>
          <table v-else-if="tab === 'objectives'" class="table">
            <thead><tr><th>الهدف</th><th>المؤشر</th><th>الإدارة</th><th>المسؤول</th><th>المستهدف</th><th>الفعلي</th><th>نسبة التحقق</th><th>الحالة</th></tr></thead>
            <tbody><tr v-for="o in r.objectives.list" :key="o.id"><td>{{ o.title }}</td><td>{{ o.kpi }}</td><td>{{ o.departmentName }}</td><td>{{ o.ownerName }}</td><td class="q-num">{{ o.direction === 'increase' ? '≥' : '≤' }} {{ num(o.target) }} {{ o.unit }}</td><td class="q-num">{{ num(o.current) }} {{ o.unit }}</td><td class="q-num">{{ pc(o.progress) }}</td><td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[o.status] }">{{ o.statusLabel }}</span></td></tr></tbody>
          </table>
          <table v-else-if="tab === 'audits'" class="table">
            <thead><tr><th>الرقم</th><th>المراجعة</th><th>الإدارة</th><th>رئيس الفريق</th><th>المخطط</th><th>الفعلي</th><th>جسيمة</th><th>بسيطة</th><th>ملاحظات</th><th>فرص</th><th>الحالة</th></tr></thead>
            <tbody><tr v-for="a in r.audits.list" :key="a.id"><td><span class="q-code">{{ a.code }}</span></td><td>{{ a.title }}</td><td>{{ a.departmentName }}</td><td>{{ a.leadAuditor }}</td><td class="q-num">{{ fmtDate(a.plannedDate) }}</td><td class="q-num">{{ fmtDate(a.actualDate) }}</td><td class="q-num">{{ a.findings.major }}</td><td class="q-num">{{ a.findings.minor }}</td><td class="q-num">{{ a.findings.observation }}</td><td class="q-num">{{ a.findings.ofi }}</td><td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[a.status] }">{{ a.statusLabel }}</span></td></tr></tbody>
          </table>
        </div>
      </div>
      <div class="q-paper-foot">
        <div>أعده: {{ r.generatedBy }}</div>
        <div>تاريخ الإصدار: {{ fmtDate(r.generatedAt) }}</div>
        <div>الاعتماد: ..........................</div>
      </div>
    </div>
  </div>
</template>
