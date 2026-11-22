<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { api, openProtectedFile } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { LEVEL_COLOR, P, STATUS_COLOR, fmtDate, fmtDateTime, loadLookups, todayStr, type ActionRow, type Lookups } from '../lib';
import '../../../shared/module.css';
import '../audit.css';

interface Detail extends ActionRow {
  log: { at: string; by: string; kind: string; text?: string | null; progress?: number | null; dueDate?: string | null }[];
  canRespond: boolean; reportNo: string | null; leadName: string | null;
  finding: { seq: number; observation: string; cause: string | null; effect: string; rating: string; ratingLabel: string; managementResponse: string | null } | null;
  documents: { id: string; kind: string; title: string; fileName: string; uploadedByName: string; createdAt: string }[];
}
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const a = ref<Detail | null>(null);
const lookups = ref<Lookups | null>(null);
const error = ref('');
async function load() {
  try {
    a.value = await api<Detail>(`/audit/actions/${props.id}`);
    upd.progress = a.value.progress;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await load();
  if (session.can(P.verify) || session.can(P.engagements)) lookups.value = await loadLookups().catch(() => null);
});
watch(() => props.id, load);
async function call(path: string, json: unknown, msg: string) {
  try {
    a.value = await api<Detail>(`/audit/actions/${props.id}/${path}`, { method: 'POST', json });
    toast.success(msg);
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  }
}
const upd = reactive({ text: '', progress: 0 });
async function update() {
  if (await call('update', { text: upd.text || null, progress: Number(upd.progress) }, 'سُجلت المتابعة')) upd.text = '';
}
const closure = reactive({ show: false, title: '', refNo: '', date: todayStr(), summary: '' });
async function submitClosure() {
  if (await call('closure', { title: closure.title, refNo: closure.refNo || null, date: closure.date, summary: closure.summary }, 'قُدم تقرير الإغلاق للتحقق')) closure.show = false;
}
async function verify(decision: 'close' | 'return') {
  const note = decision === 'return' ? prompt('ما الذي ينقص تقرير الإغلاق؟') : prompt('ملاحظة التحقق (اختياري)') ?? '';
  if (decision === 'return' && !note) return;
  if (note === null) return;
  await call('verify', { decision, note: note || null }, decision === 'close' ? 'أُغلقت التوصية' : 'أُعيد التقرير للجهة');
}
const ext = reactive({ show: false, dueDate: '', reason: '' });
async function extend() {
  if (await call('extend', { dueDate: ext.dueDate, reason: ext.reason }, 'مُدّد الموعد')) ext.show = false;
}
async function assign(userId: string) {
  await call('assign', { assigneeUserId: userId || null }, 'حُدّث الإسناد');
}
const doc = reactive({ title: '', file: null as File | null });
async function upload() {
  if (!doc.file) return toast.error('اختر الملف');
  const fd = new FormData();
  fd.append('title', doc.title);
  fd.append('kind', 'closure');
  fd.append('file', doc.file);
  try {
    await api(`/audit/actions/${props.id}/documents`, { method: 'POST', body: fd });
    Object.assign(doc, { title: '', file: null });
    toast.success('أُرفق المستند');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function removeDoc(id: string) {
  if (!confirm('حذف المستند؟')) return;
  try {
    await api(`/audit/actions/${props.id}/documents/${id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const LOG_COLOR: Record<string, string> = { create: '#6366f1', progress: '#0ea5e9', submit: '#f59e0b', close: '#10b981', return: '#e11d48', extend: '#a855f7', assign: '#64748b' };
</script>

<template>
  <div v-if="a">
    <section class="pm-hero au-hero">
      <div>
        <p class="pm-kicker"><span class="au-code" style="color: #fdba74">{{ a.code }}</span> · توصية من <RouterLink v-if="session.can(P.read)" :to="`/audit/engagements/${a.engagementId}`" style="color: #fdba74">{{ a.engagementCode }} {{ a.engagementTitle }}</RouterLink><span v-else>{{ a.engagementCode }}</span></p>
        <h1>{{ a.title }}</h1>
        <p class="pm-sub">{{ a.responsibleUnitName }} · {{ a.assigneeName ?? 'الجهة كلها' }} · الموعد {{ fmtDate(a.dueDate) }}{{ a.extended ? ` (الأصلي ${fmtDate(a.originalDueDate)})` : '' }}</p>
      </div>
      <div class="pm-actions">
        <span class="au-lvl" :style="{ '--c': LEVEL_COLOR[a.priority], background: 'rgba(255,255,255,.9)' }">{{ a.priorityLabel }}</span>
        <span class="pm-pill" :style="{ '--c': a.overdue ? '#e11d48' : STATUS_COLOR[a.status], background: 'rgba(255,255,255,.9)' }">{{ a.statusLabel }}</span>
        <button v-if="a.canRespond && ['open', 'in_progress'].includes(a.status)" class="btn au-glow" @click="closure.show = true">تقديم تقرير الإغلاق</button>
        <template v-if="session.can(P.verify) && a.status === 'submitted'">
          <button class="btn au-glow" @click="verify('close')">التحقق والإغلاق</button>
          <button class="btn au-ghost" @click="verify('return')">إعادة للجهة</button>
        </template>
        <button v-if="session.can(P.verify) && ['open', 'in_progress', 'submitted'].includes(a.status)" class="btn au-ghost" @click="ext.show = true; ext.dueDate = a.dueDate">تمديد الموعد</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="au-grid">
      <div>
        <section class="card pm-panel" style="margin-bottom: 16px">
          <h2>من الملاحظة إلى التوصية</h2>
          <div class="au-chain" style="grid-template-columns: repeat(3, 1fr)">
            <div style="--c: #6366f1"><span>الملاحظة {{ a.finding?.seq }}</span><p>{{ a.finding?.observation }}</p><p v-if="a.finding?.cause" class="pm-muted">السبب: {{ a.finding.cause }}</p></div>
            <div style="--c: #e11d48"><span>الأثر والنتائج</span><p>{{ a.finding?.effect }}</p></div>
            <div style="--c: #10b981"><span>التوصية بالعلاج</span><p>{{ a.description }}</p></div>
          </div>
          <p v-if="a.finding?.managementResponse" class="pm-muted" style="margin-top: 8px">رد الإدارة: {{ a.finding.managementResponse }}</p>
        </section>

        <section v-if="a.closureReport" class="card pm-panel" style="margin-bottom: 16px; border-inline-start: 4px solid #10b981">
          <h2>تقرير الإغلاق</h2>
          <dl class="pm-dl">
            <div><dt>العنوان</dt><dd>{{ a.closureReport.title }}</dd></div>
            <div><dt>المرجع</dt><dd>{{ a.closureReport.refNo ?? '—' }}</dd></div>
            <div><dt>التاريخ</dt><dd>{{ fmtDate(a.closureReport.date) }}</dd></div>
            <div><dt>قدّمه</dt><dd>{{ a.closureReport.submittedByName }}</dd></div>
          </dl>
          <p class="au-text" style="margin-top: 10px">{{ a.closureReport.summary }}</p>
          <p v-if="a.verifiedByName" class="pm-ok" style="margin-top: 8px">✓ تحقق منه {{ a.verifiedByName }} وأُغلقت في {{ fmtDateTime(a.closedAt) }}</p>
        </section>

        <section class="card pm-panel">
          <h2>المستندات المؤيدة للإغلاق</h2>
          <div v-for="d in a.documents" :key="d.id" style="display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border)">
            <a href="#" class="pm-link" style="flex: 1" @click.prevent="openProtectedFile(`/audit/actions/${a.id}/documents/${d.id}`)">{{ d.title }}</a>
            <span class="pm-muted">{{ d.uploadedByName }} · {{ fmtDateTime(d.createdAt) }}</span>
            <button v-if="a.canRespond && ['open', 'in_progress'].includes(a.status)" class="btn btn-sm btn-danger" @click="removeDoc(d.id)">✕</button>
          </div>
          <p v-if="!a.documents.length" class="pm-muted">لا توجد مستندات. أرفق ما يثبت علاج الملاحظة (محضر، تعميم، صورة من النظام...).</p>
          <form v-if="a.canRespond && ['open', 'in_progress', 'submitted'].includes(a.status)" class="au-toolbar" style="margin-top: 10px" @submit.prevent="upload">
            <input v-model="doc.title" class="input grow" placeholder="عنوان المستند" required />
            <input type="file" accept=".pdf,image/*" class="input" @change="doc.file = ($event.target as HTMLInputElement).files?.[0] ?? null" />
            <button class="btn btn-primary">إرفاق</button>
          </form>
        </section>
      </div>

      <div>
        <section class="card pm-panel" style="margin-bottom: 16px">
          <h2>الإنجاز</h2>
          <div class="au-ring" :style="{ '--v': a.progress, '--c': a.overdue ? '#e11d48' : a.status === 'closed' ? '#10b981' : '#0ea5e9' }"><b>{{ a.progress }}%</b></div>
          <p class="pm-muted" style="text-align: center; margin-top: 8px">{{ a.daysLeft === null ? 'مغلقة' : a.daysLeft < 0 ? `متأخرة ${-a.daysLeft} يوم` : `باقي ${a.daysLeft} يوم` }}</p>
          <form v-if="a.canRespond && ['open', 'in_progress'].includes(a.status)" @submit.prevent="update">
            <label class="field"><span>نسبة الإنجاز: {{ upd.progress }}%</span><input v-model.number="upd.progress" type="range" min="0" max="90" step="10" /></label>
            <label class="field"><span>ملاحظة المتابعة</span><textarea v-model="upd.text" class="input" rows="2" placeholder="ما الذي تم تنفيذه" /></label>
            <button class="btn btn-primary">تسجيل المتابعة</button>
          </form>
          <label v-if="(session.can(P.verify) || session.can(P.engagements)) && lookups && a.status !== 'closed'" class="field" style="margin-top: 12px"><span>المسؤول المباشر</span>
            <select class="input" :value="a.assigneeUserId ?? ''" @change="assign(($event.target as HTMLSelectElement).value)"><option value="">الجهة كلها</option><option v-for="u in lookups.users" :key="u.id" :value="u.id">{{ u.fullName }}</option></select>
          </label>
        </section>
        <section class="card pm-panel">
          <h2>سجل المتابعة</h2>
          <ul class="au-timeline">
            <li v-for="(l, k) in a.log" :key="k" :style="{ '--c': LOG_COLOR[l.kind] ?? '#6366f1' }">
              <b>{{ l.text || (l.progress !== null && l.progress !== undefined ? `الإنجاز ${l.progress}%` : '') }}</b>
              <span class="pm-muted">{{ l.by }} · {{ fmtDateTime(l.at) }}<template v-if="l.progress !== null && l.progress !== undefined && l.text"> · {{ l.progress }}%</template><template v-if="l.dueDate"> · الموعد الجديد {{ fmtDate(l.dueDate) }}</template></span>
            </li>
          </ul>
        </section>
      </div>
    </div>

    <div v-if="closure.show" class="modal-backdrop" @click.self="closure.show = false">
      <form class="card modal" @submit.prevent="submitClosure">
        <h2>تقرير الإغلاق</h2>
        <p class="pm-muted">هذا هو التقرير الذي تُغلق على أساسه المهمة بعد تحقق المراجع. أرفق المستندات المؤيدة من قسم المستندات.</p>
        <label class="field"><span>عنوان التقرير</span><input v-model="closure.title" class="input" required /></label>
        <div class="pm-grid2">
          <label class="field"><span>رقم المرجع (خطاب أو محضر)</span><input v-model="closure.refNo" class="input" /></label>
          <label class="field"><span>تاريخ التقرير</span><input v-model="closure.date" type="date" class="input" :max="todayStr()" required /></label>
        </div>
        <label class="field"><span>ما الذي نُفذ لعلاج الملاحظة</span><textarea v-model="closure.summary" class="input" rows="5" required /></label>
        <div class="modal-actions"><button class="btn btn-primary">تقديم للتحقق</button><button type="button" class="btn" @click="closure.show = false">إلغاء</button></div>
      </form>
    </div>
    <div v-if="ext.show" class="modal-backdrop" @click.self="ext.show = false">
      <form class="card modal" @submit.prevent="extend">
        <h2>تمديد موعد التوصية</h2>
        <label class="field"><span>الموعد الجديد</span><input v-model="ext.dueDate" type="date" class="input" :min="todayStr()" required /></label>
        <label class="field"><span>سبب التمديد</span><textarea v-model="ext.reason" class="input" rows="3" required /></label>
        <div class="modal-actions"><button class="btn btn-primary">تمديد</button><button type="button" class="btn" @click="ext.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
</template>
