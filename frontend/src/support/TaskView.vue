<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import '../modules/platform/platform.css';
import { PRIORITY, SUPPORT_MANAGE, TASK_STATUS, fmtDT, remaining, type SupportTask } from './support';

/** تفاصيل مهمة: تغيير الحالة، وتسجيل ساعات العمل، وإعادة التكليف */
const route = useRoute();
const toast = useToast();
const session = useSession();
const manager = session.can(SUPPORT_MANAGE);
const id = route.params.id as string;
const t = ref<SupportTask | null>(null);
const team = ref<{ id: string; fullName: string }[]>([]);
const error = ref('');
const busy = ref(false);
const hours = ref<number | ''>('');
const hoursNote = ref('');
const comment = ref('');
const due = ref('');

const local = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
async function load() {
  try {
    [t.value, team.value] = await Promise.all([api<SupportTask>(`/support-desk/tasks/${id}`), api<{ id: string; fullName: string }[]>('/support-desk/assignees')]);
    due.value = local(t.value.dueAt);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

async function run(fn: () => Promise<SupportTask>, msg: string) {
  busy.value = true;
  try {
    t.value = await fn();
    due.value = local(t.value.dueAt);
    toast.success(msg);
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  } finally {
    busy.value = false;
  }
}
const patch = (json: Record<string, unknown>, msg: string) => run(() => api<SupportTask>(`/support-desk/tasks/${id}`, { method: 'PATCH', json }), msg);
async function logHours() {
  if (await run(() => api<SupportTask>(`/support-desk/tasks/${id}/hours`, { method: 'POST', json: { hours: Number(hours.value), note: hoursNote.value || undefined } }), 'تم تسجيل ساعات العمل')) {
    hours.value = '';
    hoursNote.value = '';
  }
}
async function addComment() {
  if (await patch({ note: comment.value }, 'تمت إضافة الملاحظة')) comment.value = '';
}
const stepLabel = (h: SupportTask['history'][number]) => {
  switch (h.step) {
    case 'created': return 'إنشاء المهمة';
    case 'assigned': return `إعادة التكليف إلى ${h.note}`;
    case 'status': return `الحالة: ${TASK_STATUS[h.note ?? '']?.label ?? h.note}`;
    case 'hours': return `تسجيل ${h.hours} ساعة`;
    case 'due': return 'تعديل موعد التسليم';
    default: return 'ملاحظة';
  }
};
const stepNote = (h: SupportTask['history'][number]) => (h.step === 'status' || h.step === 'assigned' || h.step === 'due' ? '' : h.note ?? '');
</script>

<template>
  <div v-if="t">
    <section class="p-hero">
      <div>
        <p class="p-kicker"><RouterLink to="/support-desk/tasks" class="back">المهام والتكليفات</RouterLink> / <span dir="ltr">{{ t.number }}</span></p>
        <h1>{{ t.title }}</h1>
        <p class="p-sub">
          المكلَّف: {{ t.assigneeName }} · أنشأها {{ t.createdByName }}
          <template v-if="t.ticket"> · الطلب <RouterLink :to="`/support-desk/tickets/${t.ticket.id}`" class="back" dir="ltr">{{ t.ticket.number }}</RouterLink></template>
        </p>
      </div>
      <div class="tags">
        <span class="prio-big" :style="{ '--c': PRIORITY[t.priority].color }">{{ PRIORITY[t.priority].label }}</span>
        <span :class="['tone', `tone-${TASK_STATUS[t.status].tone}`]">{{ TASK_STATUS[t.status].label }}</span>
      </div>
    </section>

    <div class="layout">
      <div>
        <section class="card p-panel">
          <h2>📋 التفاصيل</h2>
          <p class="desc">{{ t.description || 'لا توجد تفاصيل.' }}</p>
          <div class="stats">
            <div><small>موعد التسليم</small><b>{{ fmtDT(t.dueAt) }}</b>
              <span v-if="t.status === 'done'" :class="['tone', t.onTime ? 'tone-ok' : 'tone-warn']">{{ t.onTime ? 'أُنجزت في الموعد' : 'أُنجزت بعد الموعد' }}</span>
              <span v-else-if="t.status !== 'cancelled'" :class="['tone', t.overdue ? 'tone-bad' : 'tone-muted']">{{ remaining(t.dueAt) }}</span>
            </div>
            <div><small>ساعات العمل</small><b>{{ t.spentHours }} س</b><span v-if="t.estimatedHours" class="muted">من {{ t.estimatedHours }} مقدّرة</span></div>
            <div><small>البدء</small><b>{{ fmtDT(t.startedAt) }}</b></div>
            <div><small>الإنجاز</small><b>{{ fmtDT(t.completedAt) }}</b></div>
          </div>
          <div v-if="t.estimatedHours" class="bar"><div :style="{ width: Math.min(100, (t.spentHours / t.estimatedHours) * 100) + '%' }" :class="{ over: t.spentHours > t.estimatedHours }" /></div>
        </section>

        <section v-if="t.status !== 'cancelled'" class="card p-panel">
          <h2>⏱️ تسجيل ساعات العمل</h2>
          <form class="inline" @submit.prevent="logHours">
            <input v-model="hours" class="input hrs" type="number" min="0.25" max="24" step="0.25" required placeholder="الساعات" />
            <input v-model="hoursNote" class="input" maxlength="1000" placeholder="ماذا أنجزت؟ (اختياري)" />
            <button class="btn btn-primary" :disabled="busy">تسجيل</button>
          </form>
        </section>

        <section class="card p-panel">
          <h2>💬 ملاحظة على المهمة</h2>
          <form class="inline" @submit.prevent="addComment">
            <input v-model="comment" class="input" required maxlength="1000" placeholder="اكتب ملاحظة أو تحديثًا" />
            <button class="btn" :disabled="busy">إضافة</button>
          </form>
        </section>
      </div>

      <aside>
        <section class="card p-panel">
          <h2>⚙️ الحالة</h2>
          <div class="btns">
            <button v-for="s in ['todo', 'in_progress', 'done']" :key="s" :class="['btn btn-sm', { 'btn-primary': t.status === s }]" :disabled="busy || t.status === s" @click="patch({ status: s }, 'تم تحديث الحالة')">{{ TASK_STATUS[s].label }}</button>
            <button v-if="manager && t.status !== 'cancelled'" class="btn btn-sm btn-danger" :disabled="busy" @click="patch({ status: 'cancelled' }, 'تم إلغاء المهمة')">إلغاء المهمة</button>
          </div>
        </section>
        <section v-if="manager" class="card p-panel">
          <h2>👥 التكليف</h2>
          <div class="field">
            <label>المكلَّف</label>
            <select class="input" :value="t.assigneeId" :disabled="busy" @change="patch({ assigneeId: ($event.target as HTMLSelectElement).value }, 'تمت إعادة التكليف')">
              <option v-for="u in team" :key="u.id" :value="u.id">{{ u.fullName }}</option>
            </select>
          </div>
          <form class="field" @submit.prevent="patch({ dueAt: new Date(due).toISOString() }, 'تم تعديل موعد التسليم')">
            <label>موعد التسليم</label>
            <div class="inline"><input v-model="due" class="input" type="datetime-local" required /><button class="btn btn-sm" :disabled="busy">حفظ</button></div>
          </form>
        </section>
        <section class="card p-panel">
          <h2>سجل المهمة</h2>
          <ul class="p-timeline">
            <li v-for="(h, i) in [...t.history].reverse()" :key="i">{{ stepLabel(h) }}<small>{{ h.by }} · {{ fmtDT(h.at) }}</small><small v-if="stepNote(h)">{{ stepNote(h) }}</small></li>
          </ul>
        </section>
      </aside>
    </div>
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
</template>

<style scoped>
.back { color: inherit; }
.tags { display: flex; gap: 8px; align-items: center; }
.prio-big { background: var(--c); color: #fff; padding: 5px 14px; border-radius: 999px; font-weight: 700; box-shadow: 0 0 18px color-mix(in srgb, var(--c) 60%, transparent); }
.layout { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 960px) { .layout { grid-template-columns: 1fr; } }
.desc { white-space: pre-wrap; margin: 0 0 14px; }
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 700px) { .stats { grid-template-columns: 1fr 1fr; } }
.stats div { background: var(--surface-2); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
.stats small { color: var(--muted); }
.bar { height: 8px; background: var(--surface-2); border-radius: 999px; overflow: hidden; margin-top: 12px; }
.bar div { height: 100%; background: var(--grad); border-radius: 999px; }
.bar div.over { background: #ea580c; }
.inline { display: flex; gap: 8px; align-items: center; }
.inline .input { flex: 1; }
.hrs { max-width: 110px; }
.btns { display: flex; gap: 6px; flex-wrap: wrap; }
</style>
