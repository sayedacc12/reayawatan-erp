<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import TaskForm from './TaskForm.vue';
import '../modules/platform/platform.css';
import SlaBadge from './SlaBadge.vue';
import TicketThread from './TicketThread.vue';
import { CATEGORY, PRIORITY, STATUS, SUPPORT_MANAGE, TASK_STATUS, fmtDT, historyLabel, historyNote, hoursLabel, type TicketDetail } from './support';

/** معالجة طلب صيانة لدى مدير المنصة */
const route = useRoute();
const toast = useToast();
const session = useSession();
const manager = session.can(SUPPORT_MANAGE);
const myId = session.user?.id;
const taskOpen = ref(false);
const id = route.params.id as string;
const t = ref<TicketDetail | null>(null);
const team = ref<{ id: string; fullName: string }[]>([]);
const error = ref('');
const now = ref(Date.now());
const busy = ref(false);
const newPriority = ref('');
const priorityReason = ref('');
const escNote = ref('');
let timer: ReturnType<typeof setInterval>;

async function load() {
  try {
    [t.value, team.value] = await Promise.all([
      api<TicketDetail>(`/support-desk/tickets/${id}`),
      api<{ id: string; fullName: string }[]>('/support-desk/assignees'),
    ]);
    newPriority.value = t.value.priority;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => { load(); timer = setInterval(() => (now.value = Date.now()), 30_000); });
onUnmounted(() => clearInterval(timer));

async function run(fn: () => Promise<TicketDetail>, msg: string) {
  busy.value = true;
  try {
    t.value = await fn();
    newPriority.value = t.value.priority;
    toast.success(msg);
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  } finally {
    busy.value = false;
  }
}
const patch = (json: Record<string, unknown>, msg: string) => run(() => api<TicketDetail>(`/support-desk/tickets/${id}`, { method: 'PATCH', json }), msg);
const assign = (assigneeId: string) => assigneeId && patch({ assigneeId }, 'تم إسناد الطلب');
const setStatus = (status: string) => patch({ status }, 'تم تحديث الحالة');
async function changePriority() {
  if (await patch({ priority: newPriority.value, priorityReason: priorityReason.value }, 'تم تعديل مستوى الخدمة وإبلاغ الشركة')) priorityReason.value = '';
}
async function escalate() {
  if (await run(() => api<TicketDetail>(`/support-desk/tickets/${id}/escalate`, { method: 'POST', json: { note: escNote.value } }), 'تم تصعيد الطلب')) escNote.value = '';
}
const isOpen = () => t.value && !['resolved', 'closed'].includes(t.value.status);
</script>

<template>
  <div v-if="t">
    <section class="p-hero">
      <div>
        <p class="p-kicker"><RouterLink to="/support-desk/tickets" class="back">طلبات الصيانة</RouterLink> / <span dir="ltr">{{ t.number }}</span></p>
        <h1>{{ t.subject }}</h1>
        <p class="p-sub">
          <RouterLink v-if="t.organization && session.can('platform.organizations.manage')" :to="`/platform/organizations/${t.organization.id}`" class="back">{{ t.organization.name }}</RouterLink>
          <template v-else-if="t.organization">{{ t.organization.name }}</template>
          · {{ CATEGORY[t.category] }}<template v-if="t.screen"> · الشاشة: {{ t.screen }}</template>
          · {{ t.createdByName }}<template v-if="t.contactPhone"> · <span dir="ltr">{{ t.contactPhone }}</span></template>
        </p>
      </div>
      <div class="hero-tags">
        <span class="prio-big" :style="{ '--c': PRIORITY[t.priority].color }">{{ PRIORITY[t.priority].label }}</span>
        <span :class="['tone', `tone-${STATUS[t.status].tone}`]">{{ STATUS[t.status].label }}</span>
        <span v-if="t.escalatedAt" class="tone tone-bad">مُصعّد</span>
      </div>
    </section>

    <div v-if="t.sla.needsEscalation" class="alert alert-error banner">
      ⚠️ هذا الطلب يحتاج تصعيدًا: {{ t.level.escalation }}
    </div>

    <div class="layout">
      <div>
        <TicketThread :ticket="t" base="/support-desk" platform @updated="t = $event" />
        <section class="card p-panel">
          <h2>🧩 مهام العمل على هذا الطلب <button v-if="t.status !== 'closed' && t.status !== 'resolved'" class="btn btn-sm add" @click="taskOpen = true">+ مهمة</button></h2>
          <RouterLink v-for="k in t.tasks" :key="k.id" :to="`/support-desk/tasks/${k.id}`" class="task-row">
            <b dir="ltr">{{ k.number }}</b>
            <span class="grow">{{ k.title }}<small class="muted"> · {{ k.assigneeName }} · التسليم {{ fmtDT(k.dueAt) }}</small></span>
            <small class="muted">{{ k.spentHours }} س</small>
            <span :class="['tone', `tone-${TASK_STATUS[k.status].tone}`]">{{ TASK_STATUS[k.status].label }}</span>
          </RouterLink>
          <p v-if="!t.tasks?.length" class="muted">لا توجد مهام. قسّم العمل على الفريق بإضافة مهام بمواعيد تسليم.</p>
        </section>
        <TaskForm v-if="taskOpen" :ticket="{ id: t.id, number: t.number, priority: t.priority }" :team="team" @close="taskOpen = false" @saved="taskOpen = false; load()" />
      </div>
      <aside>
        <section class="card p-panel">
          <h2>⏱️ المهل</h2>
          <dl class="p-dl">
            <dt>أول رد</dt>
            <dd><SlaBadge :state="t.sla.response" :due="t.sla.responseDueAt" label="الرد" :now="now" /><small class="muted block">{{ hoursLabel(t.level.responseHours) }} · {{ fmtDT(t.sla.responseDueAt) }}</small></dd>
            <dt>الحل</dt>
            <dd><SlaBadge :state="t.sla.resolution" :due="t.sla.resolutionDueAt" label="الحل" :now="now" /><small class="muted block">{{ hoursLabel(t.level.resolutionHours) }} · {{ fmtDT(t.sla.resolutionDueAt) }}</small></dd>
            <template v-if="t.requestedPriority !== t.priority"><dt>طلبت الشركة</dt><dd>{{ PRIORITY[t.requestedPriority].label }}</dd></template>
            <template v-if="t.rating"><dt>تقييم الشركة</dt><dd class="gold">{{ '★'.repeat(t.rating) }}</dd></template>
          </dl>
        </section>

        <section v-if="t.status !== 'closed'" class="card p-panel">
          <h2>⚙️ الإجراءات</h2>
          <div v-if="!manager" class="field">
            <label>المسؤول عن الطلب</label>
            <p v-if="t.assigneeName" class="assignee">{{ t.assigneeName }}</p>
            <button v-else class="btn btn-primary btn-sm" :disabled="busy" @click="assign(myId!)">استلام الطلب</button>
          </div>
          <div v-else class="field">
            <label>المسؤول عن الطلب</label>
            <select class="input" :value="team.find((u) => u.fullName === t!.assigneeName)?.id ?? ''" :disabled="busy" @change="assign(($event.target as HTMLSelectElement).value)">
              <option value="" disabled>اختر من فريق المنصة</option>
              <option v-for="u in team" :key="u.id" :value="u.id">{{ u.fullName }}</option>
            </select>
          </div>
          <div class="field">
            <label>الحالة</label>
            <div class="btns">
              <button v-for="s in ['in_progress', 'waiting_customer', 'resolved']" :key="s" :class="['btn btn-sm', { 'btn-primary': t.status === s }]" :disabled="busy || t.status === s" @click="setStatus(s)">{{ STATUS[s].label }}</button>
            </div>
          </div>
          <form v-if="manager" class="field" @submit.prevent="changePriority">
            <label>تعديل مستوى الخدمة</label>
            <select v-model="newPriority" class="input"><option v-for="(p, k) in PRIORITY" :key="k" :value="k">{{ p.icon }} {{ p.label }}</option></select>
            <template v-if="newPriority !== t.priority">
              <input v-model="priorityReason" class="input mt" required minlength="3" placeholder="سبب التعديل (يظهر للشركة)" />
              <small class="muted">تُعاد حساب المهل من وقت تقديم الطلب.</small>
              <button class="btn btn-sm btn-primary mt" :disabled="busy">حفظ المستوى</button>
            </template>
          </form>
          <form v-if="isOpen()" class="field" @submit.prevent="escalate">
            <label>تصعيد الطلب</label>
            <input v-model="escNote" class="input" required minlength="3" placeholder="سبب التصعيد ولمن صُعّد" />
            <button class="btn btn-sm btn-danger mt" :disabled="busy">تصعيد</button>
          </form>
        </section>

        <section class="card p-panel">
          <h2>📘 آلية التعامل: {{ t.level.name }}</h2>
          <ol class="steps"><li v-for="h in t.level.handling" :key="h">{{ h }}</li></ol>
          <p class="muted small"><b>التصعيد:</b> {{ t.level.escalation }}</p>
        </section>

        <section class="card p-panel">
          <h2>سجل الطلب</h2>
          <ul class="p-timeline">
            <li v-for="(h, i) in t.history" :key="i">{{ historyLabel(h) }}<small>{{ h.by }} · {{ fmtDT(h.at) }}</small><small v-if="historyNote(h)">{{ historyNote(h) }}</small></li>
          </ul>
        </section>
      </aside>
    </div>
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
</template>

<style scoped>
.back { color: inherit; }
.hero-tags { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.prio-big { background: var(--c); color: #fff; padding: 5px 14px; border-radius: 999px; font-weight: 700; box-shadow: 0 0 18px color-mix(in srgb, var(--c) 60%, transparent); }
.banner { margin-bottom: 16px; }
.layout { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 960px) { .layout { grid-template-columns: 1fr; } }
.block { display: block; margin-top: 4px; }
.btns { display: flex; gap: 6px; flex-wrap: wrap; }
.mt { margin-top: 8px; }
.gold { color: #c7a27a; }
.small { font-size: .85rem; }
.assignee { margin: 0; font-weight: 600; }
.add { margin-inline-start: auto; }
.task-row { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-radius: 8px; color: var(--text); border-bottom: 1px solid var(--border); }
.task-row:hover { background: var(--surface-2); }
.grow { flex: 1; }
.steps { margin: 0; padding-inline-start: 20px; display: grid; gap: 4px; }
</style>
