<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, openProtectedFile } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import EngagementForm from '../components/EngagementForm.vue';
import RiskChips from '../components/RiskChips.vue';
import RiskPicker from '../components/RiskPicker.vue';
import {
  ENG_STEPS, LEVEL_COLOR, LEVELS, OPINIONS, P, STATUS_COLOR, addDays, fmtDate, fmtDateTime, loadLookups, todayStr, unitOptions, type Lookups, type RiskRef,
} from '../lib';
import '../../projects/projects.css';
import '../audit.css';

interface Finding {
  id: string; itemId: string; seq: number; title: string; observation: string; cause: string | null; effect: string; rating: string; ratingLabel: string; recommendation: string;
  responsibleUnitId: string; responsibleUnitName: string; responsibleUserId: string | null; responsibleUserName: string | null; dueDate: string; managementResponse: string | null;
  riskRefs: RiskRef[]; createdByName: string;
  action: { id: string; code: string; status: string; statusLabel: string; dueDate: string; progress: number; overdue: boolean } | null;
}
interface Item {
  id: string; seq: number; title: string; criteria: string | null; procedure: string | null; controlRef: { id: string; code: string; name: string } | null; result: string; resultLabel: string;
  conclusion: string | null; testedByName: string | null; testedAt: string | null; findings: Finding[];
}
interface Eng {
  id: string; code: string; title: string; objective: string | null; scope: string | null; scopeType: string; unitId: string | null; outsideLabel: string | null; scopeLabel: string;
  plan: { id: string; code: string; title: string; kind: string; status: string; statusLabel: string; year: number }; area: { id: string; code: string; name: string } | null; areaId: string | null;
  riskRefs: RiskRef[]; priority: string; priorityLabel: string; status: string; statusLabel: string; plannedStart: string; plannedEnd: string; actualStart: string | null; actualEnd: string | null;
  budgetHours: number; actualHours: number; leadUserId: string | null; leadName: string | null; team: { userId: string; name: string; role: string }[]; reviewNote: string | null;
  report: { no: string; summary: string; opinion: string; opinionLabel: string; issuedAt: string; issuedByName: string } | null; closedAt: string | null; closureNote: string | null;
  history: { at: string; by: string; action: string; note?: string | null }[]; progress: { items: number; tested: number; percent: number }; items: Item[]; findingsCount: number;
  ratings: Record<string, number>; actions: { total: number; closed: number; overdue: number };
  documents: { id: string; kind: string; title: string; fileName: string; uploadedByName: string; createdAt: string }[];
}
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const router = useRouter();
const e = ref<Eng | null>(null);
const lookups = ref<Lookups | null>(null);
const error = ref('');
const tab = ref<'program' | 'info' | 'report' | 'docs' | 'log'>('program');
const editForm = ref(false);
const ask = (m: string) => window.confirm(m);
async function load() {
  try {
    e.value = await api<Eng>(`/audit/engagements/${props.id}`);
  } catch (err) {
    error.value = (err as Error).message;
  }
}
onMounted(async () => {
  await load();
  lookups.value = await loadLookups().catch(() => null);
});
watch(() => props.id, load);
const units = computed(() => unitOptions(lookups.value));
const stepIndex = computed(() => ENG_STEPS.findIndex((s) => s.value === e.value?.status));
const fieldwork = computed(() => e.value?.status === 'fieldwork' && session.can(P.fieldwork));
const programEditable = computed(() => ['planned', 'fieldwork'].includes(e.value?.status ?? '') && session.can(P.fieldwork));
const DOC_KIND: Record<string, string> = { report: 'تقرير المراجعة', evidence: 'دليل إثبات', closure: 'تقرير إغلاق' };

async function run(fn: () => Promise<unknown>, msg = 'تم') {
  try {
    await fn();
    toast.success(msg);
    await load();
    return true;
  } catch (err) {
    toast.error((err as Error).message);
    return false;
  }
}
async function stage(action: 'start' | 'submit' | 'return' | 'cancel') {
  let note: string | null = null;
  let actualHours: number | undefined;
  if (action === 'submit') {
    const h = prompt('الساعات الفعلية التي استغرقتها المهمة', String(e.value!.actualHours || e.value!.budgetHours));
    if (h === null) return;
    actualHours = Number(h) || 0;
  }
  if (action === 'return' || action === 'cancel') {
    note = prompt(action === 'return' ? 'ما الذي يحتاج تعديلًا في التقرير؟' : 'سبب إلغاء المهمة');
    if (!note) return;
  }
  await run(() => api(`/audit/engagements/${props.id}/stage`, { method: 'POST', json: { action, note, actualHours } }),
    { start: 'بدأ العمل الميداني', submit: 'رُفع التقرير للمراجعة والاعتماد', return: 'أُعيدت المهمة للفريق', cancel: 'أُلغيت المهمة' }[action]);
}
async function removeEng() {
  if (!confirm('حذف المهمة؟')) return;
  if (await run(() => api(`/audit/engagements/${props.id}`, { method: 'DELETE' }))) router.push(`/audit/plans/${e.value?.plan.id}`);
}

// ---- بنود البرنامج
const itemForm = reactive({ show: false, id: '', title: '', criteria: '', procedure: '', controlId: '' });
function openItem(i?: Item) {
  Object.assign(itemForm, { show: true, id: i?.id ?? '', title: i?.title ?? '', criteria: i?.criteria ?? '', procedure: i?.procedure ?? '', controlId: i?.controlRef?.id ?? '' });
}
async function saveItem() {
  const c = lookups.value?.controls.find((x) => x.id === itemForm.controlId);
  const body = { title: itemForm.title, criteria: itemForm.criteria || null, procedure: itemForm.procedure || null, controlRef: c ? { id: c.id, code: c.code, name: c.name } : null };
  if (await run(() => itemForm.id ? api(`/audit/engagements/${props.id}/items/${itemForm.id}`, { method: 'PATCH', json: body }) : api(`/audit/engagements/${props.id}/items`, { method: 'POST', json: body }), 'حُفظ البند')) itemForm.show = false;
}
const resultForm = reactive({ show: false, item: null as Item | null, result: 'satisfactory', conclusion: '' });
function openResult(i: Item) {
  Object.assign(resultForm, { show: true, item: i, result: i.result === 'pending' ? 'satisfactory' : i.result, conclusion: i.conclusion ?? '' });
}
async function saveResult() {
  if (resultForm.result === 'finding' && !resultForm.item!.findings.length) {
    resultForm.show = false;
    return openFinding(resultForm.item!);
  }
  if (await run(() => api(`/audit/engagements/${props.id}/items/${resultForm.item!.id}/result`, { method: 'POST', json: { result: resultForm.result, conclusion: resultForm.conclusion || null } }), 'سُجلت النتيجة')) resultForm.show = false;
}

// ---- الملاحظات
const fForm = reactive({
  show: false, id: '', itemId: '', title: '', observation: '', cause: '', effect: '', rating: 'medium', recommendation: '', responsibleUnitId: '', responsibleUserId: '',
  dueDate: '', managementResponse: '', riskRefs: [] as RiskRef[],
});
function openFinding(i: Item, f?: Finding) {
  Object.assign(fForm, {
    show: true, id: f?.id ?? '', itemId: i.id, title: f?.title ?? '', observation: f?.observation ?? '', cause: f?.cause ?? '', effect: f?.effect ?? '', rating: f?.rating ?? 'medium',
    recommendation: f?.recommendation ?? '', responsibleUnitId: f?.responsibleUnitId ?? (e.value?.scopeType === 'unit' ? e.value.unitId ?? '' : ''),
    responsibleUserId: f?.responsibleUserId ?? '', dueDate: f?.dueDate ?? addDays(todayStr(), lookups.value?.dueDays.medium ?? 60), managementResponse: f?.managementResponse ?? '',
    riskRefs: (f?.riskRefs ?? e.value?.riskRefs ?? []).map((r) => ({ id: r.id, code: r.code, title: r.title, level: r.level, score: r.score })),
  });
}
function ratingChanged() {
  if (!fForm.id) fForm.dueDate = addDays(todayStr(), lookups.value?.dueDays[fForm.rating] ?? 60);
}
async function saveFinding() {
  const body = {
    itemId: fForm.itemId, title: fForm.title, observation: fForm.observation, cause: fForm.cause || null, effect: fForm.effect, rating: fForm.rating, recommendation: fForm.recommendation,
    responsibleUnitId: fForm.responsibleUnitId, responsibleUserId: fForm.responsibleUserId || null, dueDate: fForm.dueDate || null, managementResponse: fForm.managementResponse || null,
    riskRefs: fForm.riskRefs,
  };
  if (await run(() => fForm.id ? api(`/audit/engagements/${props.id}/findings/${fForm.id}`, { method: 'PATCH', json: body }) : api(`/audit/engagements/${props.id}/findings`, { method: 'POST', json: body }), 'حُفظت الملاحظة')) fForm.show = false;
}

// ---- التقرير
const issueForm = reactive({ show: false, summary: '', opinion: 'needs_improvement' });
async function issue() {
  if (await run(() => api(`/audit/engagements/${props.id}/issue`, { method: 'POST', json: { summary: issueForm.summary, opinion: issueForm.opinion } }), 'صدر التقرير وتحولت التوصيات إلى مهام متابعة')) {
    issueForm.show = false;
    tab.value = 'report';
  }
}
async function closeEng() {
  const note = prompt('ملاحظة الإغلاق (اختياري)');
  if (note === null) return;
  await run(() => api(`/audit/engagements/${props.id}/close`, { method: 'POST', json: { note: note || null } }), 'أُغلقت المهمة');
}

// ---- المستندات
const docForm = reactive({ title: '', kind: 'evidence', file: null as File | null });
async function upload() {
  if (!docForm.file) return toast.error('اختر الملف');
  const fd = new FormData();
  fd.append('title', docForm.title);
  fd.append('kind', docForm.kind);
  fd.append('file', docForm.file);
  if (await run(() => api(`/audit/engagements/${props.id}/documents`, { method: 'POST', body: fd }), 'رُفع المستند')) Object.assign(docForm, { title: '', file: null });
}
</script>

<template>
  <div v-if="e">
    <section class="pm-hero au-hero">
      <div>
        <p class="pm-kicker"><span class="au-code" style="color: #fdba74">{{ e.code }}</span> · <RouterLink :to="`/audit/plans/${e.plan.id}`" style="color: #fdba74">{{ e.plan.code }} {{ e.plan.title }}</RouterLink></p>
        <h1>{{ e.title }}</h1>
        <p class="pm-sub">{{ e.scopeType === 'outside' ? 'خارج الهيكل: ' : '' }}{{ e.scopeLabel }} · {{ fmtDate(e.plannedStart) }} ← {{ fmtDate(e.plannedEnd) }} · القائد: {{ e.leadName ?? 'لم يُحدد' }}</p>
      </div>
      <div class="pm-actions">
        <span class="au-lvl" :style="{ '--c': LEVEL_COLOR[e.priority], background: 'rgba(255,255,255,.9)' }">أولوية {{ e.priorityLabel }}</span>
        <template v-if="e.status === 'planned'">
          <button v-if="session.can(P.fieldwork)" class="btn au-glow" @click="stage('start')">بدء العمل الميداني</button>
          <button v-if="session.can(P.engagements)" class="btn au-ghost" @click="stage('cancel')">إلغاء</button>
          <button v-if="session.can(P.engagements)" class="btn au-ghost" @click="removeEng">حذف</button>
        </template>
        <template v-if="e.status === 'fieldwork'">
          <button v-if="session.can(P.fieldwork)" class="btn au-glow" @click="stage('submit')">رفع التقرير للاعتماد</button>
          <button v-if="session.can(P.engagements)" class="btn au-ghost" @click="stage('cancel')">إلغاء</button>
        </template>
        <template v-if="e.status === 'review' && session.can(P.issue)">
          <button class="btn au-glow" @click="issueForm.show = true">اعتماد التقرير وإصداره</button>
          <button class="btn au-ghost" @click="stage('return')">إعادة للفريق</button>
        </template>
        <button v-if="e.status === 'issued' && session.can(P.issue)" class="btn au-glow" :disabled="e.actions.closed < e.actions.total" :title="e.actions.closed < e.actions.total ? 'تُغلق بعد إغلاق كل التوصيات' : ''" @click="closeEng">إغلاق المهمة</button>
        <RouterLink :to="`/audit/engagements/${e.id}/report`" class="btn au-ghost">{{ e.report ? 'التقرير للطباعة' : 'معاينة مسودة التقرير' }}</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="e.reviewNote && e.status === 'fieldwork'" class="alert alert-error">أُعيد التقرير للفريق: {{ e.reviewNote }}</div>

    <div v-if="e.status !== 'cancelled'" class="au-steps">
      <div v-for="(s, k) in ENG_STEPS" :key="s.value" :data-n="k + 1" :class="['au-step', { done: k < stepIndex || e.status === 'closed', cur: k === stepIndex && e.status !== 'closed' }]">{{ s.label }}</div>
    </div>
    <div v-else class="alert alert-error">المهمة ملغاة</div>

    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #6366f1; --i: 0"><span>إنجاز برنامج العمل</span><strong>{{ e.progress.percent }}%</strong><small>{{ e.progress.tested }} من {{ e.progress.items }} بند</small></div>
      <div class="pm-kpi" style="--a: #f97316; --i: 1"><span>الملاحظات</span><strong>{{ e.findingsCount }}</strong><small>حرج {{ e.ratings.critical }} · مرتفع {{ e.ratings.high }} · متوسط {{ e.ratings.medium }} · منخفض {{ e.ratings.low }}</small></div>
      <div class="pm-kpi" style="--a: #10b981; --i: 2"><span>التوصيات المغلقة</span><strong>{{ e.actions.closed }} من {{ e.actions.total }}</strong><small>{{ e.actions.overdue }} متأخرة</small></div>
      <div class="pm-kpi" style="--a: #0ea5e9; --i: 3"><span>الساعات</span><strong>{{ e.actualHours }} من {{ e.budgetHours }}</strong><small>الفعلية من المقدرة</small></div>
    </div>

    <div class="pm-tabs">
      <button :class="['pm-tab', { on: tab === 'program' }]" @click="tab = 'program'">برنامج العمل والملاحظات <b>{{ e.items.length }}</b></button>
      <button :class="['pm-tab', { on: tab === 'info' }]" @click="tab = 'info'">البيانات والفريق والمخاطر</button>
      <button :class="['pm-tab', { on: tab === 'report' }]" @click="tab = 'report'">التقرير</button>
      <button :class="['pm-tab', { on: tab === 'docs' }]" @click="tab = 'docs'">المستندات <b>{{ e.documents.length }}</b></button>
      <button :class="['pm-tab', { on: tab === 'log' }]" @click="tab = 'log'">السجل</button>
    </div>

    <section v-if="tab === 'program'">
      <div class="au-toolbar">
        <p class="pm-muted grow" style="margin: 0">لكل بند: المعيار وإجراء الفحص ثم النتيجة. البند الذي عليه ملاحظة يُسجَّل بسلسلة: الملاحظة ← الأثر ← التوصية ← الجهة المسؤولة ← الموعد.</p>
        <button v-if="programEditable" class="btn btn-primary" @click="openItem()">+ بند مراجعة</button>
      </div>
      <p v-if="!e.items.length" class="card pm-panel pm-empty">لم تُضف بنود لبرنامج المراجعة بعد</p>
      <div v-for="(i, k) in e.items" :key="i.id" class="au-item" :style="{ '--i': k }">
        <div class="au-item-head">
          <div style="display: flex; gap: 10px; flex: 1; min-width: 240px">
            <span class="n">{{ i.seq }}</span>
            <div>
              <b>{{ i.title }}</b>
              <span v-if="i.criteria" class="pm-muted" style="display: block">المعيار: {{ i.criteria }}</span>
              <span v-if="i.procedure" class="pm-muted" style="display: block">الإجراء: {{ i.procedure }}</span>
              <span v-if="i.controlRef" class="au-risk" style="--c: #6366f1"><span class="au-code">{{ i.controlRef.code }}</span>{{ i.controlRef.name }}</span>
            </div>
          </div>
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap">
            <span class="pm-pill" :style="{ '--c': STATUS_COLOR[i.result] }">{{ i.resultLabel }}</span>
            <template v-if="fieldwork">
              <button class="btn btn-sm" @click="openResult(i)">النتيجة</button>
              <button class="btn btn-sm" @click="openFinding(i)">+ ملاحظة</button>
            </template>
            <button v-if="programEditable" class="btn btn-sm" @click="openItem(i)">تعديل</button>
            <button v-if="programEditable && !i.findings.length" class="btn btn-sm btn-danger" @click="run(() => api(`/audit/engagements/${e!.id}/items/${i.id}`, { method: 'DELETE' }), 'حُذف البند')">✕</button>
          </div>
        </div>
        <p v-if="i.conclusion" class="pm-muted" style="margin: 8px 38px 0 0">الخلاصة: {{ i.conclusion }}<template v-if="i.testedByName"> · {{ i.testedByName }}</template></p>
        <div v-for="f in i.findings" :key="f.id" class="au-finding">
          <div style="display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; align-items: center">
            <b>ملاحظة {{ f.seq }}: {{ f.title }}</b>
            <div style="display: flex; gap: 6px; align-items: center">
              <span class="au-lvl" :style="{ '--c': LEVEL_COLOR[f.rating] }">{{ f.ratingLabel }}</span>
              <RouterLink v-if="f.action" :to="`/audit/actions/${f.action.id}`" class="pm-pill" :style="{ '--c': f.action.overdue ? '#e11d48' : STATUS_COLOR[f.action.status] }">{{ f.action.code }} · {{ f.action.statusLabel }}{{ f.action.overdue ? ' · متأخرة' : '' }}</RouterLink>
              <button v-if="(e.status === 'fieldwork' && session.can(P.fieldwork)) || (e.status === 'review' && session.can(P.issue))" class="btn btn-sm" @click="openFinding(i, f)">تعديل</button>
              <button v-if="fieldwork" class="btn btn-sm btn-danger" @click="ask('حذف الملاحظة؟') && run(() => api(`/audit/engagements/${e!.id}/findings/${f.id}`, { method: 'DELETE' }), 'حُذفت الملاحظة')">✕</button>
            </div>
          </div>
          <div class="au-chain">
            <div style="--c: #6366f1"><span>الملاحظة</span><p>{{ f.observation }}</p><p v-if="f.cause" class="pm-muted">السبب: {{ f.cause }}</p></div>
            <div style="--c: #e11d48"><span>الأثر والنتائج</span><p>{{ f.effect }}</p></div>
            <div style="--c: #10b981"><span>التوصية بالعلاج</span><p>{{ f.recommendation }}</p></div>
            <div style="--c: #f97316"><span>الجهة المسؤولة</span><p><b>{{ f.responsibleUnitName }}</b></p><p v-if="f.responsibleUserName" class="pm-muted">{{ f.responsibleUserName }}</p></div>
            <div style="--c: #0ea5e9"><span>موعد التنفيذ</span><p>{{ fmtDate(f.action?.dueDate ?? f.dueDate) }}</p><p v-if="f.action" class="pm-muted">إنجاز {{ f.action.progress }}%</p></div>
          </div>
          <p v-if="f.managementResponse" class="pm-muted" style="margin: 8px 0 0">رد الإدارة: {{ f.managementResponse }}</p>
          <RiskChips v-if="f.riskRefs.length" :risks="f.riskRefs" style="margin-top: 6px" />
        </div>
      </div>
    </section>

    <section v-else-if="tab === 'info'" class="au-grid">
      <div class="card pm-panel">
        <h2>بيانات المهمة <button v-if="session.can(P.engagements) && ['planned', 'fieldwork'].includes(e.status)" class="btn btn-sm" @click="editForm = true">تعديل وتوزيع</button></h2>
        <dl class="pm-dl">
          <div><dt>مجال المراجعة</dt><dd>{{ e.area ? `${e.area.code} ${e.area.name}` : '—' }}</dd></div>
          <div><dt>البداية الفعلية</dt><dd>{{ fmtDate(e.actualStart) }}</dd></div>
          <div><dt>النهاية الفعلية</dt><dd>{{ fmtDate(e.actualEnd) }}</dd></div>
          <div><dt>حالة الخطة</dt><dd>{{ e.plan.statusLabel }}</dd></div>
        </dl>
        <p class="au-sec">الهدف</p><p class="au-text">{{ e.objective || '—' }}</p>
        <p class="au-sec">النطاق</p><p class="au-text">{{ e.scope || '—' }}</p>
        <p class="au-sec">المخاطر المرتبطة</p><RiskChips :risks="e.riskRefs" />
      </div>
      <div class="card pm-panel">
        <h2>فريق المهمة</h2>
        <div style="display: flex; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border)"><span class="au-score" style="--c: #e11d48">ق</span><span><b>{{ e.leadName ?? 'لم يُحدد' }}</b><span class="pm-muted">قائد المهمة</span></span></div>
        <div v-for="t in e.team" :key="t.userId" style="display: flex; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border)"><span class="au-score" style="--c: #6366f1">{{ t.name.slice(0, 1) }}</span><span><b>{{ t.name }}</b><span class="pm-muted">{{ t.role }}</span></span></div>
      </div>
    </section>

    <section v-else-if="tab === 'report'" class="card pm-panel">
      <template v-if="e.report">
        <h2>تقرير المراجعة {{ e.report.no }} <RouterLink :to="`/audit/engagements/${e.id}/report`" class="btn btn-sm">طباعة</RouterLink></h2>
        <dl class="pm-dl">
          <div><dt>الرأي العام</dt><dd>{{ e.report.opinionLabel }}</dd></div>
          <div><dt>تاريخ الإصدار</dt><dd>{{ fmtDateTime(e.report.issuedAt) }}</dd></div>
          <div><dt>اعتمده</dt><dd>{{ e.report.issuedByName }}</dd></div>
          <div><dt>التوصيات</dt><dd>{{ e.actions.total }} مهمة متابعة</dd></div>
        </dl>
        <p class="au-sec">ملخص التقرير</p><p class="au-text">{{ e.report.summary }}</p>
        <template v-if="e.closedAt"><p class="au-sec">الإغلاق</p><p class="au-text">أُغلقت في {{ fmtDateTime(e.closedAt) }}{{ e.closureNote ? ` · ${e.closureNote}` : '' }}</p></template>
      </template>
      <p v-else class="pm-empty">لم يصدر التقرير بعد. بعد رفع التقرير يعتمده صاحب صلاحية إصدار التقارير، فتتحول كل توصية إلى مهمة متابعة مزمنة للجهة المسؤولة.</p>
    </section>

    <section v-else-if="tab === 'docs'" class="card pm-panel">
      <h2>المستندات وأدلة الإثبات</h2>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>المستند</th><th>النوع</th><th>رفعه</th><th></th></tr></thead>
          <tbody>
            <tr v-for="d in e.documents" :key="d.id">
              <td><a href="#" class="pm-link" @click.prevent="openProtectedFile(`/audit/engagements/${e.id}/documents/${d.id}`)">{{ d.title }}</a><span class="pm-muted">{{ d.fileName }}</span></td>
              <td>{{ DOC_KIND[d.kind] }}</td>
              <td>{{ d.uploadedByName }}<span class="pm-muted">{{ fmtDateTime(d.createdAt) }}</span></td>
              <td><button v-if="e.status !== 'closed' && (session.can(P.fieldwork) || session.can(P.issue))" class="btn btn-sm btn-danger" @click="ask('حذف المستند؟') && run(() => api(`/audit/engagements/${e!.id}/documents/${d.id}`, { method: 'DELETE' }), 'حُذف المستند')">✕</button></td>
            </tr>
            <tr v-if="!e.documents.length"><td colspan="4" class="pm-empty">لا توجد مستندات</td></tr>
          </tbody>
        </table>
      </div>
      <form v-if="!['closed', 'cancelled'].includes(e.status) && (session.can(P.fieldwork) || session.can(P.issue))" class="au-toolbar" style="margin-top: 14px" @submit.prevent="upload">
        <input v-model="docForm.title" class="input grow" placeholder="عنوان المستند" required />
        <select v-model="docForm.kind" class="input"><option value="evidence">دليل إثبات</option><option value="report">تقرير المراجعة الموقّع</option></select>
        <input type="file" accept=".pdf,image/*" class="input" @change="docForm.file = ($event.target as HTMLInputElement).files?.[0] ?? null" />
        <button class="btn btn-primary">رفع</button>
      </form>
    </section>

    <section v-else class="card pm-panel">
      <ul class="au-timeline">
        <li v-for="(h, k) in [...e.history].reverse()" :key="k"><b>{{ h.action }}</b><span class="pm-muted">{{ h.by }} · {{ fmtDateTime(h.at) }}</span><span v-if="h.note" class="pm-muted">{{ h.note }}</span></li>
      </ul>
    </section>

    <EngagementForm v-if="editForm" :plans="[{ id: e.plan.id, code: e.plan.code, title: e.plan.title, periodFrom: `${e.plan.year}-01-01`, periodTo: `${e.plan.year}-12-31` }]" :initial="{ ...e, planId: e.plan.id }" @close="editForm = false" @saved="editForm = false; load()" />

    <div v-if="itemForm.show" class="modal-backdrop" @click.self="itemForm.show = false">
      <form class="card modal" @submit.prevent="saveItem">
        <h2>{{ itemForm.id ? 'تعديل بند المراجعة' : 'بند مراجعة جديد' }}</h2>
        <label class="field"><span>بند المراجعة</span><input v-model="itemForm.title" class="input" required /></label>
        <label class="field"><span>المعيار أو المرجع</span><textarea v-model="itemForm.criteria" class="input" rows="2" placeholder="اللائحة أو السياسة أو النظام الذي يُقاس عليه" /></label>
        <label class="field"><span>إجراء المراجعة</span><textarea v-model="itemForm.procedure" class="input" rows="2" placeholder="ما الذي سيُفحص وكيف وحجم العينة" /></label>
        <label v-if="lookups?.controls.length" class="field"><span>الضابط الرقابي المختبر (من سجل المخاطر)</span>
          <select v-model="itemForm.controlId" class="input"><option value="">بدون</option><option v-for="c in lookups.controls" :key="c.id" :value="c.id">{{ c.code }} · {{ c.name }}</option></select>
        </label>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="itemForm.show = false">إلغاء</button></div>
      </form>
    </div>

    <div v-if="resultForm.show" class="modal-backdrop" @click.self="resultForm.show = false">
      <form class="card modal" @submit.prevent="saveResult">
        <h2>نتيجة البند: {{ resultForm.item?.title }}</h2>
        <div class="au-seg" style="margin-bottom: 14px">
          <button v-for="r in [{ v: 'satisfactory', l: 'مرضٍ' }, { v: 'finding', l: 'عليه ملاحظة' }, { v: 'na', l: 'لا ينطبق' }, { v: 'pending', l: 'لم يُختبر' }]" :key="r.v" type="button" :class="{ on: resultForm.result === r.v }" @click="resultForm.result = r.v">{{ r.l }}</button>
        </div>
        <label class="field"><span>خلاصة الاختبار</span><textarea v-model="resultForm.conclusion" class="input" rows="3" placeholder="ما الذي فُحص وما النتيجة" /></label>
        <div class="modal-actions"><button class="btn btn-primary">{{ resultForm.result === 'finding' && !resultForm.item?.findings.length ? 'تسجيل الملاحظة' : 'حفظ' }}</button><button type="button" class="btn" @click="resultForm.show = false">إلغاء</button></div>
      </form>
    </div>

    <div v-if="fForm.show" class="modal-backdrop" @click.self="fForm.show = false">
      <form class="card modal modal-wide" @submit.prevent="saveFinding">
        <h2>{{ fForm.id ? 'تعديل الملاحظة' : 'ملاحظة جديدة' }}</h2>
        <label class="field"><span>بند المراجعة</span><select v-model="fForm.itemId" class="input"><option v-for="i in e.items" :key="i.id" :value="i.id">{{ i.seq }}. {{ i.title }}</option></select></label>
        <label class="field"><span>عنوان الملاحظة</span><input v-model="fForm.title" class="input" required /></label>
        <label class="field"><span>الملاحظة (ما الذي وُجد)</span><textarea v-model="fForm.observation" class="input" rows="3" required /></label>
        <div class="pm-grid2">
          <label class="field"><span>السبب</span><textarea v-model="fForm.cause" class="input" rows="2" /></label>
          <label class="field"><span>الأثر أو النتائج المترتبة</span><textarea v-model="fForm.effect" class="input" rows="2" required /></label>
        </div>
        <label class="field"><span>التوصية الخاصة بالعلاج</span><textarea v-model="fForm.recommendation" class="input" rows="2" required /></label>
        <div class="pm-grid2">
          <label class="field"><span>الخطورة</span><select v-model="fForm.rating" class="input" @change="ratingChanged"><option v-for="l in LEVELS" :key="l.value" :value="l.value">{{ l.label }}</option></select></label>
          <label class="field"><span>موعد التنفيذ</span><input v-model="fForm.dueDate" type="date" class="input" :min="todayStr()" /></label>
          <label class="field"><span>الجهة المسؤولة (من الهيكل التنظيمي)</span><select v-model="fForm.responsibleUnitId" class="input" required><option value="" disabled>اختر الجهة</option><option v-for="u in units" :key="u.id" :value="u.id">{{ u.label }}</option></select></label>
          <label class="field"><span>المسؤول المباشر (اختياري)</span><select v-model="fForm.responsibleUserId" class="input"><option value="">الجهة كلها</option><option v-for="u in lookups?.users ?? []" :key="u.id" :value="u.id">{{ u.fullName }}</option></select></label>
        </div>
        <label class="field"><span>رد الإدارة</span><textarea v-model="fForm.managementResponse" class="input" rows="2" /></label>
        <p class="au-sec">المخاطر المرتبطة</p>
        <RiskPicker v-model="fForm.riskRefs" :lookups="lookups" />
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="fForm.show = false">إلغاء</button></div>
      </form>
    </div>

    <div v-if="issueForm.show" class="modal-backdrop" @click.self="issueForm.show = false">
      <form class="card modal" @submit.prevent="issue">
        <h2>اعتماد تقرير المراجعة وإصداره</h2>
        <p class="pm-muted">عند الإصدار تتحول كل توصية ({{ e.findingsCount }}) إلى مهمة متابعة مزمنة للجهة المسؤولة عنها، ويُحدَّث تاريخ آخر مراجعة لمجال المراجعة.</p>
        <label class="field"><span>الرأي العام</span><select v-model="issueForm.opinion" class="input"><option v-for="o in OPINIONS" :key="o.value" :value="o.value">{{ o.label }}</option></select></label>
        <label class="field"><span>ملخص التقرير</span><textarea v-model="issueForm.summary" class="input" rows="5" required /></label>
        <div class="modal-actions"><button class="btn btn-primary">إصدار التقرير</button><button type="button" class="btn" @click="issueForm.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
</template>
