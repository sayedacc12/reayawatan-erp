<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, openProtectedFile } from '../../../api';
import { useToast } from '../../../stores/toast';
import PersonPicker from '../../comms/components/PersonPicker.vue';
import { HIST_AR, STATUS_COLOR, STEPS, fmtDate, fmtDateTime, kindOf, loadLookups, timeText, todayStr, type Lookups } from '../lib';
import '../../../shared/module.css';
import '../../comms/comms.css';
import '../meetings.css';

interface Rec {
  id: string; seq: number; kind: 'recommendation' | 'decision'; text: string; ownerUserId: string | null; ownerName: string | null; supporters: { userId: string; name: string }[];
  dueDate: string | null; votesFor: number | null; votesAgainst: number | null; votesAbstain: number | null; taskId: string | null; taskRef: string | null;
  task: { status: string; progress: number; dueDate: string } | null;
}
interface Item { id: string; seq: number; title: string; description: string | null; presenterName: string | null; durationMinutes: number | null; discussion: string | null; status: string; recommendations: Rec[] }
interface Att {
  id: string; type: string; userId: string | null; memberId: string | null; name: string; role: string; roleLabel: string; title: string | null; mobile: string | null; voting: boolean; isGuest: boolean;
  rsvp: string; rsvpLabel: string; rsvpNote: string | null; attendance: string | null; attendanceLabel: string | null; checkedInAt: string | null;
  signStatus: string; signLabel: string; signedAt: string | null; signMethod: string | null; signReason: string | null; hasSignLink: boolean;
}
interface Meeting {
  id: string; refNo: string; title: string; kind: string; kindLabel: string; meetingType: string; typeLabel: string; mode: string; modeLabel: string; location: string | null; onlineLink: string | null;
  date: string; startTime: string; endTime: string | null; objectives: string | null; isConfidential: boolean; status: string; statusLabel: string; approverName: string | null;
  decisionNote: string | null; approvedAt: string | null; startedAt: string | null; endedAt: string | null; quorumMet: boolean | null; createdByName: string;
  body: { id: string; name: string; code: string; quorumPercent: number; secretaryName: string | null };
  quorum: { voting: number; present: number; required: number; percent: number };
  attendees: Att[]; agenda: Item[];
  minutes: { status: string; opening: string | null; closing: string | null; version: number; hash: string | null; issuedAt: string | null; signDeadline: string | null; adoptedAt: string | null;
    adoptionMethod: string | null; adoptionNote: string | null; verifyCode: string | null; wetCopy: { name: string; at: string; byName: string } | null };
  attachments: { id: string; name: string; size: number; byName: string; at: string }[];
  history: { at: string; by: string; action: string; note: string | null }[];
  me: { attendeeId: string; rsvp: string; attendance: string | null; signStatus: string; locked: boolean } | null;
  can: { manage: boolean; approve: boolean; editPlan: boolean; editAgenda: boolean; conduct: boolean; rsvp: boolean; checkIn: boolean; sign: boolean };
}

const props = defineProps<{ id: string }>();
const route = useRoute();
const toast = useToast();
const m = ref<Meeting | null>(null);
const L = ref<Lookups | null>(null);
const error = ref('');
const busy = ref(false);
const tab = ref(String(route.query.tab ?? ''));
const modal = ref<'' | 'plan' | 'decide' | 'cancel' | 'rsvp' | 'guest' | 'item' | 'rec' | 'recall' | 'finalize' | 'wet' | 'link'>('');
const f = reactive({
  note: '', decision: 'approve' as 'approve' | 'return', rsvp: 'accepted' as 'accepted' | 'declined' | 'tentative',
  plan: { title: '', meetingType: 'ordinary', mode: 'in_person', location: '', onlineLink: '', meetingDate: '', startTime: '', endTime: '', objectives: '', isConfidential: false },
  guest: { type: 'user' as 'user' | 'member' | 'external', userId: null as string | null, memberId: '', name: '', title: '', mobile: '' },
  item: { id: '', title: '', description: '', presenterName: '', durationMinutes: null as number | null },
  rec: { id: '', itemId: '', kind: 'recommendation' as 'recommendation' | 'decision', text: '', ownerUserId: null as string | null, supporterUserIds: [] as string[], dueDate: '',
    votesFor: null as number | null, votesAgainst: null as number | null, votesAbstain: null as number | null },
  sign: { decision: 'sign' as 'sign' | 'abstain', password: '', reason: '' },
  minutes: { opening: '', closing: '' },
});
const disc = reactive<Record<string, { discussion: string; status: string; dirty: boolean }>>({});
const att = reactive<Record<string, string>>({});
const link = ref<{ name: string; url: string; code: string; note: string } | null>(null);
const wetInput = ref<HTMLInputElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

async function load() {
  try {
    m.value = await api<Meeting>(`/meetings/m/${props.id}`);
    error.value = '';
    for (const i of m.value.agenda) if (!disc[i.id]?.dirty) disc[i.id] = { discussion: i.discussion ?? '', status: i.status, dirty: false };
    for (const a of m.value.attendees) att[a.id] = a.attendance ?? '';
    f.minutes.opening = m.value.minutes.opening ?? '';
    f.minutes.closing = m.value.minutes.closing ?? '';
    if (!tab.value) tab.value = ['in_progress', 'held'].includes(m.value.status) ? 'agenda' : ['signing', 'adopted'].includes(m.value.status) ? 'minutes' : 'plan';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await load();
  L.value = await loadLookups().catch(() => null);
});

async function call(path: string, json?: unknown, done = 'تم', method = 'POST') {
  busy.value = true;
  try {
    const r = await api<unknown>(`/meetings/m/${props.id}${path}`, { method, ...(json !== undefined ? { json } : {}) });
    toast.success(done);
    modal.value = '';
    await load();
    return r;
  } catch (e) {
    toast.error((e as Error).message);
    return null;
  } finally {
    busy.value = false;
  }
}

const stepIndex = computed(() => STEPS.findIndex((s) => s.s === m.value?.status));
const color = computed(() => kindOf(m.value?.kind ?? 'team').color);
const present = computed(() => m.value?.attendees.filter((a) => a.attendance === 'present' || a.attendance === 'remote') ?? []);
const signers = computed(() => m.value?.attendees.filter((a) => a.signStatus !== 'none') ?? []);
const signedCount = computed(() => signers.value.filter((a) => ['signed', 'abstained'].includes(a.signStatus)).length);
const quorumPct = computed(() => (m.value?.quorum.voting ? Math.round((m.value.quorum.present / m.value.quorum.voting) * 100) : 0));
const quorumOk = computed(() => !!m.value && m.value.quorum.present >= m.value.quorum.required && m.value.quorum.voting > 0);
const deadlinePassed = computed(() => !!m.value?.minutes.signDeadline && m.value.minutes.signDeadline < todayStr());
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join(' ');
const SIGN_COLOR: Record<string, string> = { signed: '#10b981', abstained: '#f59e0b', pending: '#6366f1', not_signed: '#94a3b8', none: '#cbd5e1' };
const RSVP_COLOR: Record<string, string> = { accepted: '#10b981', declined: '#e11d48', tentative: '#f59e0b', pending: '#94a3b8' };
const ITEM_AR: Record<string, string> = { pending: 'لم يناقش', discussed: 'نوقش', deferred: 'أُجّل' };
const TASK_AR: Record<string, string> = { open: 'لم تبدأ', in_progress: 'قيد التنفيذ', done: 'منجزة', cancelled: 'ملغاة' };
const METHOD_AR: Record<string, string> = { password: 'بكلمة المرور', code: 'برابط ورمز', wet: 'توقيع حي على الورق' };
const ADOPT_AR: Record<string, string> = { electronic: 'بالتوقيع الإلكتروني', wet: 'بالنسخة الموقعة يدويًا', mixed: 'بتوقيعات إلكترونية ويدوية' };

// ---- الخطة
function openPlan() {
  const x = m.value!;
  Object.assign(f.plan, { title: x.title, meetingType: x.meetingType, mode: x.mode, location: x.location ?? '', onlineLink: x.onlineLink ?? '', meetingDate: x.date,
    startTime: timeText(x.startTime), endTime: timeText(x.endTime), objectives: x.objectives ?? '', isConfidential: x.isConfidential });
  modal.value = 'plan';
}
const savePlan = () => call('', { bodyId: m.value!.body.id, ...f.plan, location: f.plan.location || null, onlineLink: f.plan.onlineLink || null, endTime: f.plan.endTime || null,
  objectives: f.plan.objectives || null }, 'حُفظت الخطة', 'PUT');
const addGuest = () => call('/guests', { type: f.guest.type, userId: f.guest.type === 'user' ? f.guest.userId : null, memberId: f.guest.type === 'member' ? f.guest.memberId || null : null,
  name: f.guest.name || undefined, title: f.guest.title || null, mobile: f.guest.mobile || null }, 'أُضيف المدعو');

// ---- جدول الأعمال
function openItem(i?: Item) {
  Object.assign(f.item, i ? { id: i.id, title: i.title, description: i.description ?? '', presenterName: i.presenterName ?? '', durationMinutes: i.durationMinutes } : { id: '', title: '', description: '', presenterName: '', durationMinutes: null });
  modal.value = 'item';
}
const saveItem = () => {
  const body = { title: f.item.title, description: f.item.description || null, presenterName: f.item.presenterName || null, durationMinutes: f.item.durationMinutes || null };
  return f.item.id ? call(`/items/${f.item.id}`, body, 'حُفظ البند', 'PUT') : call('/items', body, 'أُضيف البند');
};
async function saveDisc(i: Item) {
  const d = disc[i.id];
  const r = await call(`/items/${i.id}/discussion`, { discussion: d.discussion || null, status: d.status }, 'حُفظت المناقشة', 'PUT');
  if (r !== null) d.dirty = false;
}
function openRec(i: Item, r?: Rec) {
  Object.assign(f.rec, r
    ? { id: r.id, itemId: i.id, kind: r.kind, text: r.text, ownerUserId: r.ownerUserId, supporterUserIds: r.supporters.map((s) => s.userId), dueDate: r.dueDate ?? '',
        votesFor: r.votesFor, votesAgainst: r.votesAgainst, votesAbstain: r.votesAbstain }
    : { id: '', itemId: i.id, kind: m.value?.kind === 'team' ? 'recommendation' : 'decision', text: '', ownerUserId: null, supporterUserIds: [], dueDate: '', votesFor: null, votesAgainst: null, votesAbstain: null });
  modal.value = 'rec';
}
const saveRec = () => {
  const r = f.rec;
  const body = { kind: r.kind, text: r.text, ownerUserId: r.ownerUserId, supporterUserIds: r.supporterUserIds, dueDate: r.dueDate || null,
    votesFor: r.votesFor ?? null, votesAgainst: r.votesAgainst ?? null, votesAbstain: r.votesAbstain ?? null };
  return r.id ? call(`/recommendations/${r.id}`, body, 'حُفظت', 'PUT') : call(`/items/${r.itemId}/recommendations`, body, 'أُضيفت');
};
const saveAttendance = () => call('/attendance', { rows: Object.entries(att).map(([id, v]) => ({ id, attendance: v || null })) }, 'حُفظ الحضور', 'PUT');

// ---- المحضر والتوقيع
async function sign() {
  const r = await call('/minutes/sign', { decision: f.sign.decision, password: f.sign.password, reason: f.sign.reason || null }, f.sign.decision === 'sign' ? 'وُقّع المحضر' : 'سُجّل امتناعك');
  f.sign.password = '';
  if (r !== null) f.sign.reason = '';
}
async function makeLink(a: Att) {
  busy.value = true;
  try {
    link.value = await api(`/meetings/m/${props.id}/minutes/sign-link/${a.id}`, { method: 'POST' });
    modal.value = 'link';
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.success('نُسخ')).catch(() => {});
async function upload(path: string, file: File | undefined, done: string, note?: string) {
  if (!file) return;
  busy.value = true;
  try {
    const fd = new FormData();
    fd.append('file', file);
    if (note) fd.append('note', note);
    await api(`/meetings/m/${props.id}${path}`, { method: 'POST', body: fd });
    toast.success(done);
    modal.value = '';
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
    if (wetInput.value) wetInput.value.value = '';
    if (fileInput.value) fileInput.value.value = '';
  }
}
const openFile = (fid: string) => openProtectedFile(`/meetings/m/${props.id}/files/${fid}`).catch((e) => toast.error((e as Error).message));
const verifyUrl = computed(() => (m.value?.minutes.verifyCode ? `${location.origin}/minutes/verify/${m.value.minutes.verifyCode}` : ''));
const show = (x: typeof modal.value) => { f.note = ''; modal.value = x; };
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-error">{{ error }} <RouterLink to="/meetings">العودة إلى الاجتماعات</RouterLink></div>
    <template v-if="m">
      <section class="pm-hero mt-hero">
        <div style="display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: flex-end">
          <div>
            <p class="pm-kicker">{{ m.kindLabel }} · {{ m.body.name }} · <span class="cm-code" style="color: inherit">{{ m.refNo }}</span></p>
            <h1>{{ m.title }}</h1>
            <p class="pm-sub">{{ fmtDate(m.date) }} · {{ timeText(m.startTime) }}<template v-if="m.endTime"> - {{ timeText(m.endTime) }}</template> · {{ m.modeLabel }}<template v-if="m.location"> · {{ m.location }}</template> · اجتماع {{ m.typeLabel }}</p>
            <div style="display: flex; gap: 8px; flex-wrap: wrap">
              <span class="pm-pill" :style="{ '--c': STATUS_COLOR[m.status] }">{{ m.statusLabel }}</span>
              <span v-if="m.isConfidential" class="pm-pill" style="--c: #fbbf24">سري</span>
              <a v-if="m.onlineLink && ['scheduled', 'in_progress'].includes(m.status)" :href="m.onlineLink" target="_blank" rel="noopener" class="pm-pill" style="--c: #5eead4">رابط الاجتماع</a>
            </div>
          </div>
          <div class="pm-actions" style="flex-wrap: wrap">
            <template v-if="m.can.manage">
              <button v-if="m.status === 'draft'" class="btn mt-glow" :disabled="busy" @click="call('/submit', undefined, 'رُفعت الخطة')">رفع الخطة للاعتماد</button>
              <button v-if="m.status === 'scheduled'" class="btn mt-glow" :disabled="busy" @click="call('/start', undefined, 'بدأ الاجتماع')">بدء الاجتماع</button>
              <button v-if="m.status === 'in_progress'" class="btn mt-glow" :disabled="busy" @click="call('/end', undefined, 'انتهى الاجتماع')">إنهاء الاجتماع</button>
              <button v-if="m.status === 'held'" class="btn mt-glow" :disabled="busy" @click="call('/minutes/issue', undefined, 'أُصدر المحضر للتوقيع')">إصدار المحضر للتوقيع</button>
              <button v-if="['draft', 'pending_approval', 'scheduled'].includes(m.status)" class="btn cm-ghost" @click="show('cancel')">إلغاء الاجتماع</button>
            </template>
            <button v-if="m.can.approve" class="btn mt-glow" @click="show('decide')">اعتماد الخطة</button>
            <button v-if="m.can.rsvp" class="btn mt-glow" @click="f.rsvp = 'accepted'; show('rsvp')">{{ m.me?.rsvp === 'pending' ? 'الرد على الدعوة' : `ردك: ${m.attendees.find((a) => a.id === m!.me?.attendeeId)?.rsvpLabel}` }}</button>
            <button v-if="m.can.checkIn" class="btn mt-glow" :disabled="busy" @click="call('/check-in', undefined, 'سُجّل حضورك')">تسجيل حضوري</button>
            <RouterLink v-if="['held', 'signing', 'adopted'].includes(m.status)" :to="`/meetings/m/${m.id}/print`" class="btn cm-ghost">طباعة المحضر</RouterLink>
          </div>
        </div>
      </section>

      <ol v-if="m.status !== 'cancelled'" class="mt-steps">
        <li v-for="(s, i) in STEPS" :key="s.s" :class="{ done: i < stepIndex || m.status === 'adopted', now: i === stepIndex && m.status !== 'adopted' }">{{ s.l }}</li>
      </ol>
      <div v-if="m.decisionNote && m.status === 'draft'" class="alert" style="background: #fff7ed; color: #9a3412">أُعيدت الخطة للتعديل: {{ m.decisionNote }}</div>

      <!-- التوقيع الآمن للمحضر -->
      <section v-if="m.can.sign" class="mt-sign" style="margin-bottom: 16px">
        <h2 style="margin: 0 0 4px">المحضر بانتظار توقيعك</h2>
        <p style="margin: 0 0 12px">راجع نص المحضر في تبويب «المحضر والتوقيع» ثم أكّد هويتك بكلمة مرورك. يُربط توقيعك ببصمة المحضر، وأي تعديل لاحق يتطلب إعادة التوقيع.</p>
        <div v-if="m.me?.locked" class="alert alert-error">أُوقف التوقيع مؤقتًا بعد محاولات خاطئة متكررة. حاول بعد 15 دقيقة.</div>
        <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end">
          <div class="cm-seg" style="background: #fff"><button type="button" :class="{ on: f.sign.decision === 'sign' }" @click="f.sign.decision = 'sign'">أوقّع</button><button type="button" :class="{ on: f.sign.decision === 'abstain' }" @click="f.sign.decision = 'abstain'">أمتنع عن التوقيع</button></div>
          <input v-if="f.sign.decision === 'abstain'" v-model="f.sign.reason" class="input" style="flex: 1; min-width: 200px" placeholder="سبب الامتناع (إلزامي)" />
          <input v-model="f.sign.password" type="password" class="input" style="width: 220px" placeholder="كلمة المرور" autocomplete="current-password" @keyup.enter="sign" />
          <button class="btn mt-glow" :disabled="busy || !f.sign.password || (f.sign.decision === 'abstain' && f.sign.reason.trim().length < 3)" @click="sign">{{ f.sign.decision === 'sign' ? 'توقيع' : 'تسجيل الامتناع' }}</button>
        </div>
        <p class="mt-hash" style="margin: 10px 0 0; color: rgba(255,255,255,.7)">بصمة المحضر: {{ m.minutes.hash }}</p>
      </section>

      <div class="pm-tabs">
        <button :class="['pm-tab', { on: tab === 'plan' }]" @click="tab = 'plan'">الخطة</button>
        <button :class="['pm-tab', { on: tab === 'people' }]" @click="tab = 'people'">المدعوون والحضور <b>{{ m.attendees.length }}</b></button>
        <button :class="['pm-tab', { on: tab === 'agenda' }]" @click="tab = 'agenda'">جدول الأعمال والتوصيات <b>{{ m.agenda.length }}</b></button>
        <button :class="['pm-tab', { on: tab === 'minutes' }]" @click="tab = 'minutes'">المحضر والتوقيع</button>
        <button :class="['pm-tab', { on: tab === 'log' }]" @click="tab = 'log'">السجل</button>
      </div>

      <!-- الخطة -->
      <div v-if="tab === 'plan'" class="cm-grid">
        <section class="card pm-panel">
          <h2 style="display: flex; justify-content: space-between">خطة الاجتماع <button v-if="m.can.editPlan" class="btn btn-sm" @click="openPlan">تعديل</button></h2>
          <dl class="pm-dl">
            <div><dt>الجهة</dt><dd>{{ m.body.name }}</dd></div>
            <div><dt>التاريخ والوقت</dt><dd>{{ fmtDate(m.date) }} · {{ timeText(m.startTime) }}<template v-if="m.endTime"> - {{ timeText(m.endTime) }}</template></dd></div>
            <div><dt>طريقة الانعقاد</dt><dd>{{ m.modeLabel }}</dd></div>
            <div><dt>المكان</dt><dd>{{ m.location ?? '—' }}</dd></div>
            <div><dt>النصاب المطلوب</dt><dd>{{ m.quorum.percent }}% ({{ m.quorum.required }} من {{ m.quorum.voting }})</dd></div>
            <div><dt>أمين السر</dt><dd>{{ m.body.secretaryName ?? m.createdByName }}</dd></div>
            <div><dt>معتمد الخطة</dt><dd>{{ m.approverName ?? '—' }}<small v-if="m.approvedAt" class="pm-muted"> · {{ fmtDateTime(m.approvedAt) }}</small></dd></div>
          </dl>
          <template v-if="m.objectives"><p class="cm-sec">الأهداف</p><p class="cm-text">{{ m.objectives }}</p></template>
          <p class="cm-sec">جدول الأعمال</p>
          <ol style="margin: 0; padding-inline-start: 20px; line-height: 2"><li v-for="i in m.agenda" :key="i.id">{{ i.title }}<small v-if="i.presenterName" class="pm-muted"> · {{ i.presenterName }}</small></li></ol>
        </section>
        <section class="card pm-panel">
          <h2 style="display: flex; justify-content: space-between">المرفقات <button v-if="m.can.manage && m.status !== 'cancelled'" class="btn btn-sm" :disabled="busy" @click="fileInput?.click()">+ إرفاق</button></h2>
          <input ref="fileInput" type="file" hidden accept=".pdf,image/*" @change="upload('/attachments', ($event.target as HTMLInputElement).files?.[0], 'أُرفق الملف')" />
          <button v-for="a in m.attachments" :key="a.id" class="btn" style="display: flex; justify-content: space-between; width: 100%; margin-bottom: 6px" @click="openFile(a.id)">
            <span>📎 {{ a.name }}</span><small class="pm-muted">{{ a.byName }}</small></button>
          <p v-if="!m.attachments.length" class="pm-muted">لا توجد مرفقات. أرفق العروض والتقارير التي تُناقش.</p>
        </section>
      </div>

      <!-- المدعوون والحضور -->
      <section v-else-if="tab === 'people'" class="card pm-panel">
        <div v-if="['in_progress', 'held', 'signing', 'adopted'].includes(m.status)" class="mt-quorum" :style="{ '--a': quorumOk ? '#047857' : '#b91c1c' }">
          <div class="ringwrap"><div class="ring" :style="{ '--p': quorumPct }" /><span>{{ quorumPct }}%</span></div>
          <div><b>{{ quorumOk ? 'النصاب مكتمل' : 'النصاب غير مكتمل' }}</b><br /><small>حضر {{ m.quorum.present }} من {{ m.quorum.voting }} عضوًا لهم التصويت، والمطلوب {{ m.quorum.required }} ({{ m.quorum.percent }}%)</small></div>
        </div>
        <h2 style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px">المدعوون
          <span class="pm-actions">
            <button v-if="m.can.editPlan" class="btn btn-sm" @click="Object.assign(f.guest, { type: 'user', userId: null, memberId: '', name: '', title: '', mobile: '' }); show('guest')">+ مدعو</button>
            <button v-if="m.can.conduct" class="btn btn-sm btn-primary" :disabled="busy" @click="saveAttendance">حفظ الحضور</button>
          </span></h2>
        <div class="mt-people">
          <div v-for="a in m.attendees" :key="a.id" class="mt-person">
            <div class="av" :style="{ '--c': a.isGuest ? '#94a3b8' : color }">{{ initials(a.name) }}</div>
            <div class="who">
              <b>{{ a.name }}</b>
              <small>{{ a.isGuest ? 'مدعو' : a.roleLabel }}{{ a.title ? ` · ${a.title}` : '' }}{{ a.voting ? '' : ' · بلا تصويت' }}{{ a.type === 'external' ? ' · من الخارج' : a.type === 'member' ? ' · عضو عمومية' : '' }}</small>
              <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 3px">
                <span class="pm-pill" :style="{ '--c': RSVP_COLOR[a.rsvp] }" :title="a.rsvpNote ?? ''">{{ a.rsvpLabel }}</span>
                <span v-if="a.attendanceLabel && !m.can.conduct" class="pm-pill" :style="{ '--c': ['present', 'remote'].includes(a.attendance!) ? '#10b981' : '#94a3b8' }">{{ a.attendanceLabel }}</span>
                <span v-if="a.signStatus !== 'none'" class="pm-pill" :style="{ '--c': SIGN_COLOR[a.signStatus] }">{{ a.signLabel }}</span>
              </div>
            </div>
            <select v-if="m.can.conduct" v-model="att[a.id]" class="input" style="width: 120px">
              <option value="">—</option><option value="present">حاضر</option><option value="remote">عن بعد</option><option value="excused">غائب بعذر</option><option value="absent">غائب</option>
            </select>
            <button v-else-if="m.can.editPlan && a.isGuest" class="btn btn-sm" title="إزالة" @click="call(`/attendees/${a.id}`, undefined, 'أُزيل', 'DELETE')">×</button>
          </div>
        </div>
      </section>

      <!-- جدول الأعمال -->
      <section v-else-if="tab === 'agenda'">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 10px; flex-wrap: wrap">
          <p class="pm-muted" style="margin: 0">{{ m.can.conduct ? 'اكتب ملخص النقاش لكل بند وحدد حالته، ثم أضف التوصيات أو القرارات. ما له مسؤول يصبح مهمة عند اعتماد المحضر.' : 'البنود وما دار فيها من نقاش وتوصيات.' }}</p>
          <button v-if="m.can.editAgenda" class="btn btn-primary btn-sm" @click="openItem()">+ بند</button>
        </div>
        <article v-for="(i, idx) in m.agenda" :key="i.id" class="mt-item-card" :style="{ '--i': idx }">
          <header>
            <span class="mt-seq">{{ i.seq }}</span>
            <div style="flex: 1">
              <h3>{{ i.title }} <span class="pm-pill" :style="{ '--c': i.status === 'discussed' ? '#10b981' : i.status === 'deferred' ? '#f59e0b' : '#94a3b8' }">{{ ITEM_AR[i.status] }}</span></h3>
              <small class="pm-muted"><template v-if="i.presenterName">يعرضه {{ i.presenterName }}</template><template v-if="i.durationMinutes"> · {{ i.durationMinutes }} دقيقة</template></small>
              <p v-if="i.description" class="pm-muted" style="margin: 4px 0 0">{{ i.description }}</p>
            </div>
            <span v-if="m.can.editAgenda" class="pm-actions">
              <button class="btn btn-sm" title="أعلى" :disabled="idx === 0" @click="call(`/items/${i.id}/move/up`, undefined, 'تم')">↑</button>
              <button class="btn btn-sm" title="أسفل" :disabled="idx === m.agenda.length - 1" @click="call(`/items/${i.id}/move/down`, undefined, 'تم')">↓</button>
              <button class="btn btn-sm" @click="openItem(i)">تعديل</button>
              <button v-if="!i.recommendations.length" class="btn btn-sm" title="حذف" @click="call(`/items/${i.id}`, undefined, 'حُذف البند', 'DELETE')">×</button>
            </span>
          </header>
          <template v-if="m.can.conduct && disc[i.id]">
            <p class="cm-sec">النقاش</p>
            <textarea v-model="disc[i.id].discussion" class="input" rows="4" placeholder="ملخص ما دار في البند" @input="disc[i.id].dirty = true" />
            <div style="display: flex; gap: 8px; margin-top: 8px; align-items: center">
              <div class="cm-seg">
                <button v-for="s in ['discussed', 'deferred', 'pending']" :key="s" type="button" :class="{ on: disc[i.id].status === s }" @click="disc[i.id].status = s; disc[i.id].dirty = true">{{ ITEM_AR[s] }}</button>
              </div>
              <button class="btn btn-sm btn-primary" :disabled="busy || !disc[i.id].dirty" @click="saveDisc(i)">حفظ</button>
            </div>
          </template>
          <div v-else-if="i.discussion" class="mt-disc">{{ i.discussion }}</div>
          <p v-if="i.recommendations.length || m.can.conduct" class="cm-sec">التوصيات والقرارات</p>
          <div v-for="r in i.recommendations" :key="r.id" class="mt-rec" :style="{ '--c': r.kind === 'decision' ? '#e8b04b' : '#6366f1' }">
            <span class="tag">{{ r.kind === 'decision' ? 'قرار' : 'توصية' }} {{ i.seq }}.{{ r.seq }}</span>
            <div>
              <p>{{ r.text }}</p>
              <small>{{ r.ownerName ? `المسؤول: ${r.ownerName}` : 'بلا مسؤول (لا تصبح مهمة)' }}<template v-if="r.supporters.length"> · المساندون: {{ r.supporters.map((s) => s.name).join('، ') }}</template>
                <template v-if="r.dueDate"> · قبل {{ fmtDate(r.dueDate) }}</template>
                <template v-if="r.votesFor !== null"> · موافق {{ r.votesFor }}، معارض {{ r.votesAgainst ?? 0 }}، ممتنع {{ r.votesAbstain ?? 0 }}</template></small>
            </div>
            <div style="display: grid; gap: 4px; justify-items: end">
              <RouterLink v-if="r.taskId" :to="`/comms/tasks/${r.taskId}`" class="pm-pill" style="--c: #14b8a6">{{ r.taskRef }} · {{ TASK_AR[r.task?.status ?? 'open'] }} {{ r.task?.progress ?? 0 }}%</RouterLink>
              <span v-if="m.can.conduct && !r.taskId" class="pm-actions"><button class="btn btn-sm" @click="openRec(i, r)">تعديل</button><button class="btn btn-sm" @click="call(`/recommendations/${r.id}`, undefined, 'حُذفت', 'DELETE')">×</button></span>
            </div>
          </div>
          <button v-if="m.can.conduct" class="btn btn-sm" style="margin-top: 8px" @click="openRec(i)">+ توصية أو قرار</button>
        </article>
        <div v-if="!m.agenda.length" class="pm-empty card">لا توجد بنود بعد.</div>
      </section>

      <!-- المحضر -->
      <div v-else-if="tab === 'minutes'" class="cm-grid">
        <div>
          <section v-if="m.can.conduct && m.status === 'held'" class="card pm-panel">
            <h2>نص المحضر</h2>
            <p class="pm-muted" style="margin-top: -6px">المحضر يُبنى تلقائيًا من الحضور والنقاش والتوصيات. أضف هنا الافتتاحية والختام، ثم راجع المسودة وأصدره للتوقيع.</p>
            <label class="field"><span>الافتتاحية</span><textarea v-model="f.minutes.opening" class="input" rows="3" placeholder="افتتح الرئيس الاجتماع بالترحيب بالحضور..." /></label>
            <label class="field"><span>الختام</span><textarea v-model="f.minutes.closing" class="input" rows="3" placeholder="وانتهى الاجتماع الساعة..." /></label>
            <div class="pm-actions">
              <button class="btn btn-primary" :disabled="busy" @click="call('/minutes-text', { opening: f.minutes.opening || null, closing: f.minutes.closing || null }, 'حُفظ', 'PUT')">حفظ</button>
              <RouterLink :to="`/meetings/m/${m.id}/print`" class="btn">معاينة المسودة</RouterLink>
              <button class="btn mt-glow" :disabled="busy" @click="call('/minutes/issue', undefined, 'أُصدر المحضر للتوقيع')">إصدار للتوقيع</button>
            </div>
          </section>
          <section v-if="['signing', 'adopted'].includes(m.status)" class="card pm-panel">
            <h2>التوقيعات <small class="pm-muted">{{ signedCount }} من {{ signers.length }}</small></h2>
            <div class="cm-track ok" style="margin-bottom: 14px; height: 9px"><i :style="{ width: `${signers.length ? (signedCount / signers.length) * 100 : 0}%` }" /></div>
            <div class="mt-people">
              <div v-for="a in signers" :key="a.id" class="mt-person">
                <div class="av" :style="{ '--c': SIGN_COLOR[a.signStatus] }">{{ a.signStatus === 'signed' ? '✓' : a.signStatus === 'abstained' ? '!' : initials(a.name) }}</div>
                <div class="who">
                  <b>{{ a.name }}</b>
                  <small>{{ a.signLabel }}<template v-if="a.signMethod"> · {{ METHOD_AR[a.signMethod] }}</template><template v-if="a.signedAt"> · {{ fmtDateTime(a.signedAt) }}</template></small>
                  <small v-if="a.signReason" style="display: block">السبب: {{ a.signReason }}</small>
                </div>
                <button v-if="m.can.manage && m.status === 'signing' && a.signStatus === 'pending' && !a.userId" class="btn btn-sm" :disabled="busy" @click="makeLink(a)">{{ a.hasSignLink ? 'رابط جديد' : 'رابط توقيع' }}</button>
              </div>
            </div>
            <p class="pm-muted" style="font-size: .8rem; margin-top: 10px">مستخدمو النظام يوقّعون بكلمة مرورهم، ومن خارجه برابط شخصي ورمز من 6 أرقام. كل توقيع يُربط ببصمة المحضر، ويُعتمد المحضر تلقائيًا حين يوقّع أو يمتنع كل الحاضرين.</p>
          </section>
          <section v-if="m.can.manage && m.status === 'signing'" class="card pm-panel">
            <h2>طرق أخرى للاعتماد</h2>
            <div class="pm-actions" style="flex-wrap: wrap">
              <RouterLink :to="`/meetings/m/${m.id}/print`" class="btn">طباعة للتوقيع الحي</RouterLink>
              <button class="btn" @click="show('wet')">رفع النسخة الموقعة يدويًا</button>
              <button class="btn" :disabled="!deadlinePassed" :title="deadlinePassed ? '' : `متاح بعد انتهاء المهلة ${m.minutes.signDeadline}`" @click="show('finalize')">اعتماد بعد انتهاء المهلة</button>
              <button class="btn btn-danger" @click="show('recall')">سحب المحضر للتعديل</button>
            </div>
            <p class="pm-muted" style="font-size: .8rem">مهلة التوقيع حتى {{ fmtDate(m.minutes.signDeadline) }}. سحب المحضر يلغي التوقيعات السابقة ويعيده للتحرير.</p>
          </section>
        </div>
        <section class="card pm-panel">
          <h2>حالة المحضر</h2>
          <dl class="pm-dl" style="grid-template-columns: 1fr">
            <div><dt>الحالة</dt><dd>{{ { none: 'لم يصدر بعد', signing: 'بانتظار التوقيع', adopted: 'معتمد' }[m.minutes.status] ?? m.minutes.status }}</dd></div>
            <div v-if="m.minutes.issuedAt"><dt>أُصدر</dt><dd>{{ fmtDateTime(m.minutes.issuedAt) }} · الإصدار {{ m.minutes.version }}</dd></div>
            <div v-if="m.minutes.adoptedAt"><dt>اعتُمد</dt><dd>{{ fmtDateTime(m.minutes.adoptedAt) }} {{ ADOPT_AR[m.minutes.adoptionMethod ?? ''] ?? '' }}</dd></div>
            <div v-if="m.minutes.adoptionNote"><dt>ملاحظة الاعتماد</dt><dd>{{ m.minutes.adoptionNote }}</dd></div>
            <div v-if="m.minutes.wetCopy"><dt>النسخة الموقعة يدويًا</dt><dd><button class="btn btn-sm" @click="openFile('wet')">📎 {{ m.minutes.wetCopy.name }}</button></dd></div>
            <div v-if="m.minutes.hash"><dt>بصمة المحضر (SHA-256)</dt><dd class="mt-hash">{{ m.minutes.hash }}</dd></div>
            <div v-if="m.minutes.verifyCode"><dt>رمز التحقق العام</dt><dd><span class="cm-code" style="font-size: .95rem">{{ m.minutes.verifyCode }}</span> <button class="btn btn-sm" @click="copy(verifyUrl)">نسخ رابط التحقق</button></dd></div>
          </dl>
          <p v-if="m.minutes.status === 'none'" class="pm-muted">يُصدر المحضر بعد إنهاء الاجتماع، وتحديد حالة كل بند وكتابة ملخص ما نوقش.</p>
        </section>
      </div>

      <!-- السجل -->
      <section v-else-if="tab === 'log'" class="card pm-panel">
        <ol class="cm-flow">
          <li v-for="(h, i) in [...m.history].reverse()" :key="i" :style="{ '--i': i, '--c': color }">
            <b>{{ h.by }}</b> {{ HIST_AR[h.action] ?? h.action }} <span class="when">{{ fmtDateTime(h.at) }}</span>
            <p v-if="h.note">{{ h.note }}</p>
          </li>
        </ol>
      </section>
    </template>

    <!-- النوافذ -->
    <div v-if="modal && m" class="modal-backdrop" @click.self="modal = ''">
      <div class="modal card" style="max-width: 640px">
        <template v-if="modal === 'plan'">
          <h2>تعديل خطة الاجتماع</h2>
          <p v-if="m.status === 'scheduled'" class="pm-muted" style="margin-top: -6px">تغيير الموعد بعد إرسال الدعوات يعيد طلب تأكيد الحضور من المدعوين.</p>
          <label class="field"><span>العنوان</span><input v-model="f.plan.title" class="input" /></label>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0 12px">
            <label class="field"><span>نوعه</span><select v-model="f.plan.meetingType" class="input"><option value="ordinary">عادي</option><option value="extraordinary">غير عادي</option></select></label>
            <label class="field"><span>التاريخ</span><input v-model="f.plan.meetingDate" type="date" class="input" /></label>
            <label class="field"><span>من</span><input v-model="f.plan.startTime" type="time" class="input" /></label>
            <label class="field"><span>إلى</span><input v-model="f.plan.endTime" type="time" class="input" /></label>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 12px">
            <label class="field"><span>الانعقاد</span><select v-model="f.plan.mode" class="input"><option value="in_person">حضوري</option><option value="online">عن بعد</option><option value="hybrid">حضوري وعن بعد</option></select></label>
            <label class="field"><span>المكان</span><input v-model="f.plan.location" class="input" /></label>
            <label class="field"><span>الرابط</span><input v-model="f.plan.onlineLink" class="input" dir="ltr" /></label>
          </div>
          <label class="field"><span>الأهداف</span><textarea v-model="f.plan.objectives" class="input" rows="3" /></label>
          <label style="display: flex; gap: 8px; align-items: center"><input v-model="f.plan.isConfidential" type="checkbox" /> اجتماع سري</label>
          <div class="modal-actions"><button class="btn btn-primary" :disabled="busy" @click="savePlan">حفظ</button><button class="btn" @click="modal = ''">إلغاء</button></div>
        </template>

        <template v-else-if="modal === 'decide'">
          <h2>اعتماد خطة الاجتماع</h2>
          <p class="pm-muted" style="margin-top: -6px">عند الاعتماد تصل الدعوات للمدعوين ويطلب منهم تأكيد الحضور.</p>
          <div class="cm-seg" style="margin-bottom: 10px"><button type="button" :class="{ on: f.decision === 'approve' }" @click="f.decision = 'approve'">اعتماد</button><button type="button" :class="{ on: f.decision === 'return' }" @click="f.decision = 'return'">إعادة للتعديل</button></div>
          <label class="field"><span>{{ f.decision === 'return' ? 'سبب الإعادة' : 'ملاحظة (اختيارية)' }}</span><textarea v-model="f.note" class="input" rows="3" /></label>
          <div class="modal-actions"><button class="btn btn-primary" :disabled="busy || (f.decision === 'return' && f.note.trim().length < 3)" @click="call('/decide', { decision: f.decision, note: f.note || null }, f.decision === 'approve' ? 'اعتُمدت الخطة وأُرسلت الدعوات' : 'أُعيدت الخطة')">تأكيد</button><button class="btn" @click="modal = ''">إلغاء</button></div>
        </template>

        <template v-else-if="modal === 'rsvp'">
          <h2>الرد على الدعوة</h2>
          <div class="cm-seg" style="margin-bottom: 10px">
            <button type="button" :class="{ on: f.rsvp === 'accepted' }" @click="f.rsvp = 'accepted'">سأحضر</button>
            <button type="button" :class="{ on: f.rsvp === 'tentative' }" @click="f.rsvp = 'tentative'">مبدئيًا</button>
            <button type="button" :class="{ on: f.rsvp === 'declined' }" @click="f.rsvp = 'declined'">أعتذر</button>
          </div>
          <label class="field"><span>ملاحظة {{ f.rsvp === 'declined' ? '(سبب الاعتذار)' : '(اختيارية)' }}</span><textarea v-model="f.note" class="input" rows="2" /></label>
          <div class="modal-actions"><button class="btn btn-primary" :disabled="busy" @click="call('/rsvp', { rsvp: f.rsvp, note: f.note || null }, 'سُجّل ردك')">إرسال</button><button class="btn" @click="modal = ''">إلغاء</button></div>
        </template>

        <template v-else-if="modal === 'guest'">
          <h2>إضافة مدعو</h2>
          <p class="pm-muted" style="margin-top: -6px">المدعو يحضر بلا تصويت، ويوقّع المحضر إذا حضر.</p>
          <div class="cm-seg" style="margin-bottom: 10px">
            <button type="button" :class="{ on: f.guest.type === 'user' }" @click="f.guest.type = 'user'">موظف</button>
            <button type="button" :class="{ on: f.guest.type === 'member' }" @click="f.guest.type = 'member'">عضو عمومية</button>
            <button type="button" :class="{ on: f.guest.type === 'external' }" @click="f.guest.type = 'external'">من الخارج</button>
          </div>
          <div v-if="f.guest.type === 'user'" class="field"><PersonPicker v-model="f.guest.userId" :people="L?.people ?? []" /></div>
          <label v-else-if="f.guest.type === 'member'" class="field"><select v-model="f.guest.memberId" class="input"><option value="">اختر العضو</option><option v-for="a in L?.assembly ?? []" :key="a.id" :value="a.id">{{ a.memberNo }} - {{ a.fullName }}</option></select></label>
          <template v-else>
            <label class="field"><span>الاسم</span><input v-model="f.guest.name" class="input" /></label>
            <label class="field"><span>الجوال</span><input v-model="f.guest.mobile" class="input" dir="ltr" /></label>
          </template>
          <label class="field"><span>الصفة أو المسمى</span><input v-model="f.guest.title" class="input" placeholder="مثال: المدير المالي، مستشار قانوني" /></label>
          <div class="modal-actions"><button class="btn btn-primary" :disabled="busy" @click="addGuest">إضافة</button><button class="btn" @click="modal = ''">إلغاء</button></div>
        </template>

        <template v-else-if="modal === 'item'">
          <h2>{{ f.item.id ? 'تعديل البند' : 'بند جديد' }}</h2>
          <label class="field"><span>العنوان</span><input v-model="f.item.title" class="input" /></label>
          <label class="field"><span>الوصف</span><textarea v-model="f.item.description" class="input" rows="3" /></label>
          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 0 12px">
            <label class="field"><span>من يعرضه</span><input v-model="f.item.presenterName" class="input" /></label>
            <label class="field"><span>المدة (دقيقة)</span><input v-model.number="f.item.durationMinutes" type="number" min="1" class="input" /></label>
          </div>
          <div class="modal-actions"><button class="btn btn-primary" :disabled="busy || f.item.title.trim().length < 2" @click="saveItem">حفظ</button><button class="btn" @click="modal = ''">إلغاء</button></div>
        </template>

        <template v-else-if="modal === 'rec'">
          <h2>{{ f.rec.id ? 'تعديل' : 'إضافة' }} {{ f.rec.kind === 'decision' ? 'قرار' : 'توصية' }}</h2>
          <div class="cm-seg" style="margin-bottom: 10px"><button type="button" :class="{ on: f.rec.kind === 'decision' }" @click="f.rec.kind = 'decision'">قرار</button><button type="button" :class="{ on: f.rec.kind === 'recommendation' }" @click="f.rec.kind = 'recommendation'">توصية</button></div>
          <label class="field"><span>النص</span><textarea v-model="f.rec.text" class="input" rows="3" /></label>
          <div class="field"><span>المسؤول عن التنفيذ (تصبح مهمة له عند اعتماد المحضر)</span><PersonPicker v-model="f.rec.ownerUserId" :people="L?.people ?? []" /></div>
          <div class="field"><span>المساندون (للمتابعة فقط)</span><PersonPicker v-model="f.rec.supporterUserIds" :people="(L?.people ?? []).filter((p) => p.id !== f.rec.ownerUserId)" multiple placeholder="أضف مساندًا" /></div>
          <label class="field"><span>موعد التنفيذ</span><input v-model="f.rec.dueDate" type="date" class="input" /></label>
          <p class="cm-sec">التصويت (اختياري)</p>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0 12px">
            <label class="field"><span>موافق</span><input v-model.number="f.rec.votesFor" type="number" min="0" class="input" /></label>
            <label class="field"><span>معارض</span><input v-model.number="f.rec.votesAgainst" type="number" min="0" class="input" /></label>
            <label class="field"><span>ممتنع</span><input v-model.number="f.rec.votesAbstain" type="number" min="0" class="input" /></label>
          </div>
          <div class="modal-actions"><button class="btn btn-primary" :disabled="busy || f.rec.text.trim().length < 3" @click="saveRec">حفظ</button><button class="btn" @click="modal = ''">إلغاء</button></div>
        </template>

        <template v-else-if="modal === 'cancel' || modal === 'recall' || modal === 'finalize'">
          <h2>{{ { cancel: 'إلغاء الاجتماع', recall: 'سحب المحضر للتعديل', finalize: 'اعتماد المحضر بعد انتهاء المهلة' }[modal] }}</h2>
          <p class="pm-muted" style="margin-top: -6px">{{ { cancel: 'يُلغى الاجتماع ويُبلغ المدعوون.', recall: 'تُلغى التوقيعات الحالية، ويعود المحضر للتحرير ثم يُصدر بإصدار جديد.', finalize: 'يُعتمد المحضر بالتوقيعات الحالية، ومن لم يوقع يُسجل «لم يوقع».' }[modal] }}</p>
          <label class="field"><span>{{ modal === 'finalize' ? 'ملاحظة الاعتماد' : 'السبب' }}</span><textarea v-model="f.note" class="input" rows="3" /></label>
          <div class="modal-actions">
            <button :class="['btn', modal === 'finalize' ? 'btn-primary' : 'btn-danger']" :disabled="busy || f.note.trim().length < 3"
              @click="call(modal === 'cancel' ? '/cancel' : `/minutes/${modal}`, { note: f.note }, 'تم')">تأكيد</button>
            <button class="btn" @click="modal = ''">رجوع</button>
          </div>
        </template>

        <template v-else-if="modal === 'wet'">
          <h2>رفع النسخة الموقعة يدويًا</h2>
          <p class="pm-muted" style="margin-top: -6px">اطبع المحضر، واجمع التوقيعات الحية عليه، ثم ارفع صورته أو ملف PDF. يُعتمد المحضر، ويُعد من لم يوقع إلكترونيًا موقّعًا على الورق.</p>
          <label class="field"><span>ملاحظة (اختيارية)</span><input v-model="f.note" class="input" /></label>
          <input ref="wetInput" type="file" accept=".pdf,image/*" class="input" @change="upload('/minutes/wet-copy', ($event.target as HTMLInputElement).files?.[0], 'اعتُمد المحضر بالنسخة الموقعة', f.note)" />
          <div class="modal-actions"><button class="btn" @click="modal = ''">إلغاء</button></div>
        </template>

        <template v-else-if="modal === 'link' && link">
          <h2>رابط توقيع {{ link.name }}</h2>
          <p class="alert" style="background: #fff7ed; color: #9a3412">{{ link.note }}</p>
          <label class="field"><span>الرابط</span>
            <div style="display: flex; gap: 6px"><input :value="link.url" class="input" dir="ltr" readonly /><button class="btn" @click="copy(link.url)">نسخ</button></div></label>
          <label class="field"><span>رمز التحقق</span>
            <div style="display: flex; gap: 6px; align-items: center"><b class="cm-code" style="font-size: 1.6rem; letter-spacing: 6px; color: var(--text)">{{ link.code }}</b><button class="btn" @click="copy(link.code)">نسخ</button></div></label>
          <div class="modal-actions"><button class="btn btn-primary" @click="modal = ''; link = null">تم</button></div>
        </template>
      </div>
    </div>
  </div>
</template>
