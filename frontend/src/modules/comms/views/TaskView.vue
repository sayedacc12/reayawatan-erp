<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { useSession } from '../../../stores/session';
import PersonPicker from '../components/PersonPicker.vue';
import { P, PRIORITY_COLOR, STATUS_COLOR, TASK_LOG_AR, dueText, fmtDate, fmtDateTime, loadLookups, todayStr, type Lookups, type TaskRow } from '../lib';
import '../../projects/projects.css';
import '../comms.css';

interface Task extends TaskRow { log: { at: string; by: string; kind: string; text?: string | null; progress?: number | null; dueDate?: string | null }[] }
const props = defineProps<{ id: string }>();
const toast = useToast();
const session = useSession();
const t = ref<Task | null>(null);
const L = ref<Lookups | null>(null);
const error = ref('');
const busy = ref(false);
const modal = ref<'' | 'progress' | 'complete' | 'extend' | 'reassign' | 'supporters' | 'cancel' | 'reopen'>('');
const f = reactive({ text: '', progress: 0, dueDate: '', ownerUserId: null as string | null, supporters: [] as string[], note: '' });

async function load() {
  try {
    t.value = await api<Task>(`/comms/tasks/${props.id}`);
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await load();
  L.value = await loadLookups().catch(() => null);
});
const open = computed(() => ['open', 'in_progress'].includes(t.value?.status ?? ''));
const isOwner = computed(() => t.value?.myRole === 'owner');
const isAssigner = computed(() => t.value?.myRole === 'assigner' || (!!t.value && t.value.assignedById === session.user?.id)
  || (session.can(P.tasksAll) && session.can(P.tasks) && !t.value?.isConfidential));
const isSupporter = computed(() => t.value?.myRole === 'supporter');
const canNote = computed(() => isOwner.value || isSupporter.value || isAssigner.value);
const flow = computed(() => [...(t.value?.log ?? [])].reverse());

function show(m: typeof modal.value) {
  Object.assign(f, { text: '', progress: t.value?.progress ?? 0, dueDate: t.value?.dueDate ?? '', ownerUserId: null, supporters: (t.value?.supporters ?? []).map((s) => s.userId) });
  modal.value = m;
}
async function act(action: string, extra: Record<string, unknown> = {}, done = 'تم') {
  busy.value = true;
  try {
    t.value = await api<Task>(`/comms/tasks/${props.id}/update`, { method: 'POST', json: { action, text: f.text || null, ...extra } });
    toast.success(done);
    modal.value = '';
    f.note = '';
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function addNote() {
  f.text = f.note;
  await act('note', {}, 'أُضيفت الملاحظة');
  f.text = '';
}
const logColor = (k: string) => ({ complete: '#10b981', cancel: '#dc2626', extend: '#f59e0b', reassign: '#0ea5e9', progress: '#6366f1', support: '#8b5cf6', reopen: '#f97316' })[k] ?? '#14b8a6';
const TITLES = { progress: 'تحديث نسبة الإنجاز', complete: 'إنجاز المهمة', extend: 'تمديد موعد الإغلاق', reassign: 'إعادة الإسناد', supporters: 'المساندون', cancel: 'إلغاء المهمة', reopen: 'إعادة فتح المهمة' } as const;
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-error">{{ error }} <RouterLink to="/comms/tasks">العودة إلى مهامي</RouterLink></div>
    <template v-if="t">
      <section class="pm-hero cm-hero">
        <p class="pm-kicker">مهمة · <span class="cm-code" style="color: inherit">{{ t.refNo }}</span></p>
        <h1>{{ t.title }}</h1>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px">
          <span class="pm-pill" :style="{ '--c': t.overdue ? '#fda4af' : STATUS_COLOR[t.status] }">{{ t.overdue ? 'متأخرة' : t.statusLabel }}</span>
          <span class="pm-pill" :style="{ '--c': PRIORITY_COLOR[t.priority] }">{{ t.priorityLabel }}</span>
          <span v-if="t.isConfidential" class="pm-pill" style="--c: #fbbf24">سرية</span>
          <RouterLink v-if="t.sourceLink" :to="t.sourceLink" class="pm-pill" style="--c: #5eead4">{{ t.sourceLabel }}: {{ t.sourceRef }}</RouterLink>
        </div>
      </section>

      <div class="cm-grid">
        <div>
          <section class="card pm-panel">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap">
              <div><small class="pm-muted">نسبة الإنجاز</small><div style="font-size: 2rem; font-weight: 800">{{ t.progress }}%</div></div>
              <div style="text-align: left"><small class="pm-muted">موعد الإغلاق</small><div style="font-weight: 700">{{ fmtDate(t.dueDate) }}</div>
                <span v-if="open" :class="['cm-due', { late: t.overdue }]">{{ dueText(t.daysLeft) }}</span>
                <small v-if="t.extended" class="pm-muted"> (الأصلي {{ fmtDate(t.originalDueDate) }})</small></div>
            </div>
            <div class="cm-track" :class="{ warn: t.overdue, ok: t.status === 'done' }" style="margin: 10px 0 14px; height: 10px"><i :style="{ width: `${t.progress}%` }" /></div>
            <p v-if="t.description" class="cm-text">{{ t.description }}</p>
            <div v-if="t.completionNote" class="alert" style="background: #ecfdf5; color: #047857; margin-top: 12px">أُنجزت {{ fmtDateTime(t.completedAt) }}: {{ t.completionNote }}</div>
            <div class="pm-actions" style="margin-top: 14px; flex-wrap: wrap">
              <template v-if="isOwner && open">
                <button class="btn" @click="show('progress')">تحديث الإنجاز</button>
                <button class="btn cm-glow" @click="show('complete')">إنجاز المهمة</button>
              </template>
              <template v-if="isAssigner && open">
                <button class="btn" @click="show('extend')">تمديد الموعد</button>
                <button class="btn" @click="show('reassign')">إعادة الإسناد</button>
                <button class="btn btn-danger" @click="show('cancel')">إلغاء</button>
              </template>
              <button v-if="(isOwner || isAssigner) && open" class="btn" @click="show('supporters')">المساندون</button>
              <button v-if="isAssigner && !open" class="btn" @click="show('reopen')">إعادة فتح</button>
            </div>
            <p v-if="isSupporter" class="pm-muted" style="margin-top: 10px">أنت مساند في هذه المهمة: تطلع عليها وتضيف ملاحظاتك، والمسؤول عن تنفيذها وإنجازها {{ t.ownerName }}.</p>
          </section>

          <section class="card pm-panel">
            <h2>سجل المهمة</h2>
            <div v-if="canNote" style="display: flex; gap: 8px; margin-bottom: 14px">
              <input v-model="f.note" class="input" placeholder="أضف ملاحظة أو تحديثًا" @keyup.enter="f.note.trim() && addNote()" />
              <button class="btn btn-primary" :disabled="busy || !f.note.trim()" @click="addNote">إضافة</button>
            </div>
            <ol class="cm-flow">
              <li v-for="(l, i) in flow" :key="i" :style="{ '--i': i, '--c': logColor(l.kind) }">
                <b>{{ l.by }}</b> {{ TASK_LOG_AR[l.kind] ?? l.kind }}
                <span v-if="l.progress !== null && l.progress !== undefined && l.kind === 'progress'"> إلى {{ l.progress }}%</span>
                <span v-if="l.dueDate" class="pm-muted"> · الموعد {{ fmtDate(l.dueDate) }}</span>
                <span class="when">{{ fmtDateTime(l.at) }}</span>
                <p v-if="l.text">{{ l.text }}</p>
              </li>
            </ol>
          </section>
        </div>

        <section class="card pm-panel">
          <h2>الأطراف</h2>
          <p class="cm-sec" style="margin-top: 0">المسؤول عن التنفيذ</p>
          <div class="cm-chip" style="border-radius: 10px; padding: 8px 12px"><b>{{ t.ownerName }}</b> <span class="pm-muted">{{ t.ownerUnitName ?? '' }}</span></div>
          <p class="cm-sec">المساندون (للمتابعة فقط)</p>
          <div v-if="t.supporters.length" class="cm-chips"><span v-for="s in t.supporters" :key="s.userId" class="cm-chip">{{ s.name }}</span></div>
          <p v-else class="pm-muted">لا يوجد مساندون.</p>
          <p class="cm-sec">أسندها</p>
          <div>{{ t.assignedByName }} <span class="pm-muted">في {{ fmtDate(t.startDate) }}</span></div>
        </section>
      </div>
    </template>

    <div v-if="modal && t" class="modal-backdrop" @click.self="modal = ''">
      <div class="modal card" style="max-width: 560px">
        <h2>{{ TITLES[modal] }}</h2>
        <template v-if="modal === 'progress'">
          <label class="field"><span>النسبة: {{ f.progress }}%</span><input v-model.number="f.progress" type="range" min="0" max="95" step="5" style="width: 100%" /></label>
        </template>
        <label v-if="modal === 'extend' || modal === 'reopen'" class="field"><span>{{ modal === 'extend' ? 'الموعد الجديد' : 'موعد الإغلاق (اختياري)' }}</span><input v-model="f.dueDate" type="date" class="input" :min="todayStr()" /></label>
        <div v-if="modal === 'reassign'" class="field"><span>المسؤول الجديد</span><PersonPicker v-model="f.ownerUserId" :people="(L?.people ?? []).filter((p) => p.id !== t!.ownerUserId)" /></div>
        <div v-if="modal === 'supporters'" class="field"><span>المساندون يطلعون على المهمة ويضيفون ملاحظات، ولا تُحسب عليهم</span>
          <PersonPicker v-model="f.supporters" :people="(L?.people ?? []).filter((p) => p.id !== t!.ownerUserId)" multiple placeholder="أضف مساندًا" /></div>
        <label v-if="modal !== 'supporters'" class="field"><span>{{ { progress: 'ما تم (اختياري)', complete: 'ما تم إنجازه', extend: 'سبب التمديد', reassign: 'السبب (اختياري)', cancel: 'سبب الإلغاء', reopen: 'سبب إعادة الفتح' }[modal] }}</span>
          <textarea v-model="f.text" class="input" rows="3" /></label>
        <div class="modal-actions">
          <button :class="['btn', modal === 'cancel' ? 'btn-danger' : 'btn-primary']" :disabled="busy"
            @click="modal === 'progress' ? act('progress', { progress: f.progress }, 'حُدّثت النسبة')
              : modal === 'extend' ? act('extend', { dueDate: f.dueDate }, 'مُدد الموعد')
              : modal === 'reopen' ? act('reopen', { dueDate: f.dueDate !== t.dueDate ? f.dueDate : null }, 'أُعيد فتح المهمة')
              : modal === 'reassign' ? act('reassign', { ownerUserId: f.ownerUserId }, 'أُعيد الإسناد')
              : modal === 'supporters' ? act('supporters', { supporterUserIds: f.supporters }, 'حُدّث المساندون')
              : act(modal, {}, modal === 'complete' ? 'أُنجزت المهمة' : 'أُلغيت المهمة')">تأكيد</button>
          <button class="btn" @click="modal = ''">رجوع</button>
        </div>
      </div>
    </div>
  </div>
</template>
