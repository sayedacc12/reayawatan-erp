<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import DynFields from '../components/DynFields.vue';
import StatusPill from '../components/StatusPill.vue';
import { DECISION_LABEL, P, PART_STATUS, copy, fmtDate, fmtDateTime, num, publicUrl, sar, todayStr, type FormField, type VolunteerRow } from '../lib';
import '../../projects/projects.css';
import '../volunteers.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const router = useRouter();
const e = ref<any>(null);
const error = ref('');
const tab = ref<'details' | 'team' | 'closure' | 'survey'>('details');
async function load() {
  try {
    e.value = await api(`/volunteers/events/${props.id}`);
    rows.value = e.value.participants.map((p: any) => ({ ...p }));
  } catch (err) {
    error.value = (err as Error).message;
  }
}
onMounted(load);
const run = async (fn: () => Promise<any>, ok: string) => {
  try {
    const r = await fn();
    if (r && r.id) {
      e.value = r;
      rows.value = r.participants.map((p: any) => ({ ...p }));
    }
    toast.success(ok);
  } catch (err) {
    toast.error((err as Error).message);
  }
};
const post = (path: string, json?: unknown) => api(`/volunteers/events/${props.id}${path}`, { method: 'POST', json });
const submit = () => run(() => post('/submit'), 'أُرسلت الفعالية للاعتماد');
function decide(decision: 'approve' | 'return' | 'reject') {
  let note: string | null = null;
  if (decision !== 'approve') {
    note = prompt(decision === 'return' ? 'سبب الإرجاع للتعديل' : 'سبب الرفض');
    if (!note) return;
  } else if (!confirm('اعتماد الفعالية في هذه المرحلة؟')) return;
  run(() => post('/decision', { decision, note }), decision === 'approve' ? 'اعتُمدت المرحلة' : 'حُفظ القرار');
}
function cancel() {
  const note = prompt('سبب إلغاء الفعالية');
  if (note) run(() => post('/cancel', { note }), 'أُلغيت الفعالية');
}
async function remove() {
  if (!confirm('حذف المسودة نهائيًا؟')) return;
  try {
    await api(`/volunteers/events/${props.id}`, { method: 'DELETE' });
    router.push('/volunteers/events');
  } catch (err) {
    toast.error((err as Error).message);
  }
}
const answerText = (f: FormField, src: Record<string, unknown>) => {
  const a = src?.[f.key];
  if (a === undefined || a === null || a === '') return '—';
  if (f.type === 'checkbox') return a ? 'نعم' : 'لا';
  if (f.type === 'date') return fmtDate(a as string);
  return String(a);
};
const canEdit = computed(() => session.can(P.events) && e.value && ['draft', 'returned'].includes(e.value.status));
const canTeam = computed(() => session.can(P.events) && e.value && ['draft', 'returned', 'in_review', 'approved'].includes(e.value.status));
const canAttend = computed(() => session.can(P.events) && e.value?.status === 'approved' && e.value.startDate <= todayStr());
const canClose = computed(() => session.can(P.events) && e.value?.status === 'approved' && e.value.endDate <= todayStr());

// ---- الترشيح والتحضير
const pick = reactive({ show: false, search: '', list: [] as VolunteerRow[], chosen: new Set<string>(), role: '' });
async function openPick() {
  pick.show = true;
  pick.chosen.clear();
  pick.list = await api<VolunteerRow[]>('/volunteers/volunteers?status=active');
}
const already = computed(() => new Set((e.value?.participants ?? []).map((p: any) => p.volunteerId)));
const pickList = computed(() => pick.list.filter((v) => !already.value.has(v.id) && (!pick.search || v.fullName.includes(pick.search) || v.mobile.includes(pick.search))));
const togglePick = (id: string) => (pick.chosen.has(id) ? pick.chosen.delete(id) : pick.chosen.add(id));
async function addPicked() {
  await run(() => post('/participants', { volunteerIds: [...pick.chosen], role: pick.role || null }), `رُشح ${pick.chosen.size} متطوع`);
  pick.show = false;
}
const removePart = (pid: string) => run(() => api(`/volunteers/events/${props.id}/participants/${pid}`, { method: 'DELETE' }), 'أُزيل المتطوع من الفعالية');
const rows = ref<any[]>([]);
function markAll() {
  rows.value.forEach((r) => {
    r.status = 'attended';
    if (!r.hours) r.hours = e.value.plannedHours;
  });
}
function setStatus(r: any, s: string) {
  r.status = s;
  if (s === 'attended' && !r.hours) r.hours = e.value.plannedHours;
  if (s !== 'attended') { r.hours = 0; r.rating = null; }
}
const saveAttendance = () => run(() => api(`/volunteers/events/${props.id}/attendance`, {
  method: 'PUT', json: { rows: rows.value.map((r) => ({ id: r.id, status: r.status, hours: Number(r.hours) || 0, rating: r.rating || null, role: r.role || null, note: r.note || null })) },
}), 'حُفظ التحضير والساعات');
const attendedHours = computed(() => rows.value.filter((r) => r.status === 'attended').reduce((a, r) => a + (Number(r.hours) || 0), 0));

// ---- الإغلاق
const closure = reactive({ actualBeneficiaries: 0, closureSummary: '', achievements: '', challenges: '', recommendations: '', actualCost: null as number | null, closureAnswers: {} as Record<string, unknown>, openSurvey: true });
async function close() {
  await run(() => post('/close', {
    ...closure, achievements: closure.achievements || null, challenges: closure.challenges || null, recommendations: closure.recommendations || null,
  }), 'أُغلقت الفعالية بتقريرها، وصدرت استبانة الرضا');
  if (e.value?.status === 'closed') tab.value = 'survey';
}

// ---- الاستبانة
const surveyLink = (a: 'volunteer' | 'beneficiary') => publicUrl(`/v/survey/${e.value.survey.token}?a=${a}`);
async function copyLink(a: 'volunteer' | 'beneficiary') {
  if (await copy(surveyLink(a))) toast.success(a === 'volunteer' ? 'نُسخ رابط استبانة المتطوعين' : 'نُسخ رابط استبانة المستفيدين');
}
const setSurvey = (open: boolean) => run(() => post('/survey', { open }), open ? 'الاستبانة تستقبل الردود' : 'أُوقف استقبال الردود');
const printNow = () => window.print();
const stars = (n: number | null) => (n ? '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n)) : '');
</script>

<template>
  <div v-if="e">
    <section class="pm-hero vt-hero">
      <div><p class="pm-kicker"><span class="vt-code">{{ e.eventNo }}</span> · فعالية {{ e.kindLabel }}{{ e.categoryName ? ` · ${e.categoryName}` : '' }}</p>
        <h1>{{ e.title }}</h1>
        <p class="pm-sub">{{ fmtDate(e.startDate) }}{{ e.endDate !== e.startDate ? ` إلى ${fmtDate(e.endDate)}` : '' }}{{ e.startTime ? ` · ${e.startTime} – ${e.endTime ?? ''}` : '' }} ·
          {{ e.kind === 'field' ? e.location : `${e.platform ?? ''} ${e.onlineLink ?? ''}` }}</p></div>
      <div class="pm-actions">
        <StatusPill :status="e.status" :label="e.statusLabel" style="background: rgba(255,255,255,.9)" />
        <RouterLink v-if="canEdit" :to="`/volunteers/events/${e.id}/edit`" class="btn vt-ghost">تعديل</RouterLink>
        <button v-if="canEdit" class="btn vt-glow" @click="submit">إرسال للاعتماد</button>
        <template v-if="e.canDecide">
          <button class="btn vt-glow" @click="decide('approve')">اعتماد</button>
          <button class="btn vt-ghost" @click="decide('return')">إرجاع للتعديل</button>
          <button class="btn vt-ghost" @click="decide('reject')">رفض</button>
        </template>
        <button v-if="session.can(P.events) && e.status === 'draft' && !e.approvalLog.length" class="btn vt-ghost" @click="remove">حذف</button>
        <button v-else-if="session.can(P.events) && ['draft', 'returned', 'in_review', 'approved'].includes(e.status)" class="btn vt-ghost" @click="cancel">إلغاء الفعالية</button>
      </div>
    </section>

    <section class="card pm-panel" style="margin-bottom: 16px">
      <h2>مسار الاعتماد</h2>
      <div class="vt-steps">
        <div class="vt-step done"><i />الإنشاء</div>
        <div v-for="(s, i) in (e.stages.length ? e.stages : [])" :key="i"
          :class="['vt-step', { done: ['approved', 'closed'].includes(e.status) || (e.status === 'in_review' && i < e.stageIndex), cur: e.status === 'in_review' && i === e.stageIndex }]"><i />{{ s.name }}</div>
        <div :class="['vt-step', { done: ['approved', 'closed'].includes(e.status) }]"><i />التنفيذ والتحضير</div>
        <div :class="['vt-step', { done: e.status === 'closed' }]"><i />تقرير الإغلاق والاستبانة</div>
      </div>
      <p v-if="e.status === 'returned' || e.status === 'rejected'" class="alert alert-error" style="margin: 10px 0 0">{{ e.status === 'returned' ? 'أُعيدت للتعديل' : 'رُفضت' }}: {{ e.approvalLog.at(-1)?.note }}</p>
    </section>

    <div class="vt-tabs">
      <button :class="['vt-tab', { on: tab === 'details' }]" @click="tab = 'details'">بيانات الفعالية</button>
      <button :class="['vt-tab', { on: tab === 'team' }]" @click="tab = 'team'">المتطوعون والتحضير ({{ e.participants.length }})</button>
      <button :class="['vt-tab', { on: tab === 'closure' }]" @click="tab = 'closure'">تقرير الإغلاق</button>
      <button v-if="e.survey" :class="['vt-tab', { on: tab === 'survey' }]" @click="tab = 'survey'">استبانة الرضا</button>
    </div>

    <Transition name="page" mode="out-in">
      <div v-if="tab === 'details'" key="d" class="vt-grid">
        <section class="card pm-panel">
          <h2>الوصف والأهداف</h2>
          <p class="vt-pre">{{ e.description ?? 'لا يوجد وصف' }}</p>
          <div v-if="e.objectives" class="vt-sec">الأهداف</div>
          <p v-if="e.objectives" class="vt-pre">{{ e.objectives }}</p>
          <div v-if="e.eventFields.length" class="vt-sec">بيانات إضافية</div>
          <dl class="pm-dl"><div v-for="f in e.eventFields" :key="f.key"><dt>{{ f.label }}</dt><dd>{{ answerText(f, e.answers) }}</dd></div></dl>
        </section>
        <section class="card pm-panel">
          <h2>المستهدفات</h2>
          <dl class="pm-dl">
            <div><dt>النوع</dt><dd><span :class="['vt-kind', e.kind]">{{ e.kindLabel }}</span></dd></div>
            <div><dt>مجالات التطوع</dt><dd>{{ e.fields.join('، ') || '—' }}</dd></div>
            <div><dt>المتطوعون المطلوبون</dt><dd>{{ e.volunteersNeeded }}</dd></div>
            <div><dt>المستفيدون المستهدفون</dt><dd>{{ num(e.targetBeneficiaries) }}</dd></div>
            <div><dt>الساعات لكل متطوع</dt><dd>{{ num(e.plannedHours) }}</dd></div>
            <div><dt>الميزانية</dt><dd>{{ sar(e.budget) }}</dd></div>
            <div><dt>المشرف</dt><dd>{{ e.supervisorName ?? '—' }}</dd></div>
            <div><dt>أنشأها</dt><dd>{{ e.createdByName ?? '—' }}</dd></div>
          </dl>
          <div class="vt-sec">سجل القرارات</div>
          <ul class="vt-log">
            <li v-for="(l, i) in e.approvalLog" :key="i" :style="{ '--c': l.decision === 'approve' || l.decision === 'close' ? '#10b981' : l.decision === 'submit' ? '#0ea5e9' : '#ef4444' }">
              <b>{{ DECISION_LABEL[l.decision] }}</b> · {{ l.stage }}<span class="pm-muted" style="display: block">{{ l.byName }} · {{ fmtDateTime(l.at) }}</span>
              <span v-if="l.note" style="display: block">{{ l.note }}</span>
            </li>
            <li v-if="!e.approvalLog.length" class="pm-muted">لم تُرسل للاعتماد بعد</li>
          </ul>
        </section>
      </div>

      <section v-else-if="tab === 'team'" key="t" class="card pm-panel">
        <h2>المتطوعون في الفعالية
          <span style="display: flex; gap: 6px">
            <button v-if="canAttend" class="btn btn-sm" @click="markAll">تحضير الكل</button>
            <button v-if="canTeam" class="btn btn-sm btn-primary" @click="openPick">ترشيح متطوعين</button>
          </span>
        </h2>
        <p v-if="!canAttend && e.status === 'approved'" class="pm-muted">يبدأ التحضير وتسجيل الساعات من يوم بداية الفعالية ({{ fmtDate(e.startDate) }}).</p>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>المتطوع</th><th>الدور</th><th>الحضور</th><th>الساعات</th><th>تقييم المشرف</th><th>ملاحظة</th><th /></tr></thead>
            <tbody>
              <tr v-for="r in rows" :key="r.id">
                <td><RouterLink :to="`/volunteers/list/${r.volunteerId}`" class="pm-link">{{ r.volunteerName }}</RouterLink><span class="pm-muted" style="display: block"><span class="vt-code">{{ r.mobile }}</span></span></td>
                <td><input v-if="canAttend" v-model="r.role" class="input" style="min-width: 110px" /><span v-else>{{ r.role ?? '—' }}</span></td>
                <td>
                  <div v-if="canAttend" class="vt-chips">
                    <button v-for="s in ['attended', 'absent']" :key="s" type="button" :class="['vt-chip', { on: r.status === s }]" @click="setStatus(r, s)">{{ PART_STATUS[s] }}</button>
                  </div>
                  <StatusPill v-else :status="r.status" :label="PART_STATUS[r.status]" />
                </td>
                <td><input v-if="canAttend" v-model.number="r.hours" type="number" min="0" step="0.5" class="input" style="width: 80px" :disabled="r.status !== 'attended'" /><span v-else class="vt-num">{{ num(r.hours) }}</span></td>
                <td>
                  <select v-if="canAttend" v-model.number="r.rating" class="input" style="width: 90px" :disabled="r.status !== 'attended'"><option :value="null">—</option><option v-for="n in 5" :key="n" :value="n">{{ n }} / 5</option></select>
                  <span v-else class="vt-stars">{{ stars(r.rating) || '—' }}</span>
                </td>
                <td><input v-if="canAttend" v-model="r.note" class="input" style="min-width: 120px" /><span v-else>{{ r.note ?? '' }}</span></td>
                <td><button v-if="canTeam && e.status !== 'closed'" class="btn btn-sm btn-danger" title="إزالة" @click="removePart(r.id)">✕</button></td>
              </tr>
              <tr v-if="!rows.length"><td colspan="7" class="pm-empty">لم يُرشح متطوعون بعد</td></tr>
            </tbody>
          </table>
        </div>
        <div v-if="canAttend && rows.length" class="modal-actions" style="align-items: center">
          <button class="btn btn-primary" @click="saveAttendance">حفظ التحضير</button>
          <span class="pm-muted">الحاضرون {{ rows.filter((r) => r.status === 'attended').length }} · مجموع الساعات {{ num(attendedHours) }}</span>
        </div>
      </section>

      <section v-else-if="tab === 'closure'" key="c" class="card pm-panel">
        <template v-if="e.status === 'closed'">
          <div class="vt-print">
            <h2>تقرير إغلاق الفعالية <button class="btn btn-sm no-print" @click="printNow">طباعة</button></h2>
            <dl class="pm-dl">
              <div><dt>الفعالية</dt><dd>{{ e.title }} ({{ e.eventNo }})</dd></div>
              <div><dt>التاريخ</dt><dd>{{ fmtDate(e.startDate) }} إلى {{ fmtDate(e.endDate) }}</dd></div>
              <div><dt>المستفيدون: المستهدف / الفعلي</dt><dd>{{ num(e.targetBeneficiaries) }} / <b>{{ num(e.actualBeneficiaries) }}</b></dd></div>
              <div><dt>المتطوعون الحاضرون</dt><dd>{{ e.participants.filter((p: any) => p.status === 'attended').length }} من {{ e.participants.length }}</dd></div>
              <div><dt>مجموع الساعات التطوعية</dt><dd>{{ num(e.participants.reduce((a: number, p: any) => a + p.hours, 0)) }}</dd></div>
              <div><dt>الميزانية / التكلفة الفعلية</dt><dd>{{ sar(e.budget) }} / {{ e.actualCost !== null ? sar(e.actualCost) : '—' }}</dd></div>
              <div v-for="f in e.closureFields" :key="f.key"><dt>{{ f.label }}</dt><dd>{{ answerText(f, e.closureAnswers) }}</dd></div>
              <div><dt>أغلقها</dt><dd>{{ e.closedByName }} · {{ fmtDateTime(e.closedAt) }}</dd></div>
            </dl>
            <div class="vt-sec">ملخص التنفيذ</div><p class="vt-pre">{{ e.closureSummary }}</p>
            <template v-if="e.achievements"><div class="vt-sec">الإنجازات</div><p class="vt-pre">{{ e.achievements }}</p></template>
            <template v-if="e.challenges"><div class="vt-sec">التحديات</div><p class="vt-pre">{{ e.challenges }}</p></template>
            <template v-if="e.recommendations"><div class="vt-sec">التوصيات</div><p class="vt-pre">{{ e.recommendations }}</p></template>
            <template v-if="e.survey">
              <div class="vt-sec">نتائج استبانة الرضا</div>
              <p>المتطوعون: {{ e.survey.volunteer.satisfaction ?? '—' }}% ({{ e.survey.volunteer.responses }} ردًا) · المستفيدون: {{ e.survey.beneficiary.satisfaction ?? '—' }}% ({{ e.survey.beneficiary.responses }} ردًا)</p>
            </template>
          </div>
        </template>
        <form v-else-if="canClose" @submit.prevent="close">
          <h2>تقرير إغلاق الفعالية</h2>
          <p class="pm-muted">حضّر المتطوعين أولًا من تبويب «المتطوعون والتحضير». بعد الإغلاق تُعتمد الساعات، وتصدر استبانة الرضا للمتطوعين والمستفيدين المشاركين.</p>
          <div class="pm-grid2">
            <label class="field"><span>عدد المستفيدين الفعلي *</span><input v-model.number="closure.actualBeneficiaries" type="number" min="0" class="input" required /></label>
            <label class="field"><span>التكلفة الفعلية (ريال)</span><input v-model.number="closure.actualCost" type="number" min="0" class="input" /></label>
          </div>
          <label class="field"><span>ملخص التنفيذ *</span><textarea v-model="closure.closureSummary" class="input" rows="3" required /></label>
          <label class="field"><span>الإنجازات</span><textarea v-model="closure.achievements" class="input" rows="2" /></label>
          <label class="field"><span>التحديات</span><textarea v-model="closure.challenges" class="input" rows="2" /></label>
          <label class="field"><span>التوصيات</span><textarea v-model="closure.recommendations" class="input" rows="2" /></label>
          <DynFields v-if="e.closureFields.length" v-model="closure.closureAnswers" :fields="e.closureFields" />
          <label class="check" style="margin: 8px 0"><input v-model="closure.openSurvey" type="checkbox" /> إصدار استبانة الرضا للمتطوعين والمستفيدين</label>
          <div class="modal-actions"><button class="btn btn-primary">إغلاق الفعالية</button></div>
        </form>
        <p v-else class="vt-empty">يُكتب تقرير الإغلاق بعد اعتماد الفعالية وانتهاء موعدها ({{ fmtDate(e.endDate) }}).</p>
      </section>

      <section v-else-if="tab === 'survey' && e.survey" key="s" class="card pm-panel">
        <h2>استبانة الرضا
          <span style="display: flex; gap: 6px">
            <span class="pm-pill" :style="{ '--c': e.survey.open ? '#10b981' : '#94a3b8' }">{{ e.survey.open ? 'تستقبل الردود' : 'متوقفة' }}</span>
            <button v-if="session.can(P.events)" class="btn btn-sm" @click="setSurvey(!e.survey.open)">{{ e.survey.open ? 'إيقاف الردود' : 'فتح الردود' }}</button>
          </span>
        </h2>
        <div class="vt-grid" style="grid-template-columns: 1fr 1fr">
          <div v-for="a in (['volunteer', 'beneficiary'] as const)" :key="a" class="card" style="padding: 14px">
            <h3 style="margin: 0 0 6px">{{ a === 'volunteer' ? 'المتطوعون المشاركون' : 'المستفيدون المشاركون' }}</h3>
            <div class="vt-gauge" :style="{ '--v': e.survey[a].satisfaction ?? 0, '--c': a === 'volunteer' ? '#10b981' : '#0ea5e9' }"><b>{{ e.survey[a].satisfaction ?? '—' }}{{ e.survey[a].satisfaction !== null ? '%' : '' }}</b></div>
            <p class="pm-muted" style="text-align: center">{{ e.survey[a].responses }} ردًا</p>
            <div style="display: flex; gap: 6px; justify-content: center; margin-bottom: 10px">
              <button class="btn btn-sm" @click="copyLink(a)">نسخ رابط الاستبانة</button>
              <a :href="surveyLink(a)" target="_blank" class="btn btn-sm">فتح</a>
            </div>
            <div v-for="q in e.survey[a].questions" :key="q.key" style="margin-bottom: 10px">
              <div style="font-size: .86rem; font-weight: 600">{{ q.text }}</div>
              <template v-if="q.type === 'rating'"><span class="vt-stars">{{ stars(q.average) }}</span> <span class="pm-muted">{{ q.average ?? '—' }} من 5 ({{ q.count }})</span></template>
              <template v-else-if="q.type === 'yesno'"><span class="pm-muted">نعم {{ q.yes }} · لا {{ q.no }}</span></template>
              <ul v-else class="pm-muted" style="margin: 4px 0; padding-inline-start: 18px"><li v-for="(t, i) in q.texts" :key="i">{{ t }}</li><li v-if="!q.texts.length">لا توجد ملاحظات</li></ul>
            </div>
          </div>
        </div>
      </section>
    </Transition>

    <div v-if="pick.show" class="modal-backdrop" @click.self="pick.show = false">
      <div class="card modal modal-wide">
        <h2>ترشيح متطوعين للفعالية</h2>
        <div class="pm-grid2">
          <input v-model="pick.search" class="input" placeholder="بحث بالاسم أو الجوال" />
          <input v-model="pick.role" class="input" placeholder="الدور في الفعالية (اختياري)" />
        </div>
        <p class="pm-muted">المتطوعون النشطون فقط. مجالات الفعالية: {{ e.fields.join('، ') || '—' }}</p>
        <div style="max-height: 50vh; overflow: auto; display: grid; gap: 6px">
          <label v-for="v in pickList" :key="v.id" class="vt-chip" :class="{ on: pick.chosen.has(v.id) }" style="border-radius: 10px; padding: 8px 10px; cursor: pointer">
            <input type="checkbox" :checked="pick.chosen.has(v.id)" @change="togglePick(v.id)" />
            <b>{{ v.fullName }}</b><span class="pm-muted">{{ v.typeName ?? '' }} · {{ v.fields.join('، ') }} · {{ num(v.hours) }} ساعة</span>
          </label>
          <p v-if="!pickList.length" class="vt-empty">لا يوجد متطوعون متاحون</p>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="!pick.chosen.size" @click="addPicked">ترشيح {{ pick.chosen.size || '' }}</button><button class="btn" @click="pick.show = false">إلغاء</button></div>
      </div>
    </div>
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
</template>
