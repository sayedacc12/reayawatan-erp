<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { useSession } from '../stores/session';
import '../modules/platform/platform.css';
import TaskForm from './TaskForm.vue';
import { PRIORITY, SUPPORT_MANAGE, TASK_STATUS, fmtDT, remaining, type SupportTask } from './support';

/** المهام والتكليفات: لوحة بأعمدة الحالة */
const session = useSession();
const manager = session.can(SUPPORT_MANAGE);
const rows = ref<SupportTask[]>([]);
const team = ref<{ id: string; fullName: string }[]>([]);
const scope = ref<'mine' | 'all'>(manager ? 'all' : 'mine');
const member = ref('');
const showCancelled = ref(false);
const creating = ref(false);
const error = ref('');

async function load() {
  try {
    const q = new URLSearchParams({ scope: scope.value });
    if (member.value && scope.value === 'all') q.set('assigneeId', member.value);
    [rows.value, team.value] = await Promise.all([
      api<SupportTask[]>(`/support-desk/tasks?${q}`),
      team.value.length ? Promise.resolve(team.value) : api<{ id: string; fullName: string }[]>('/support-desk/assignees'),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

const columns = computed(() => (showCancelled.value ? ['todo', 'in_progress', 'done', 'cancelled'] : ['todo', 'in_progress', 'done']));
const by = (s: string) => rows.value.filter((t) => t.status === s);
const overdue = computed(() => rows.value.filter((t) => t.overdue).length);
const hours = computed(() => Math.round(rows.value.reduce((s, t) => s + t.spentHours, 0) * 100) / 100);
</script>

<template>
  <div>
    <section class="p-hero">
      <div>
        <p class="p-kicker">الدعم الفني</p>
        <h1>المهام والتكليفات</h1>
        <p class="p-sub">كل مهمة مكلَّف بها عضو بموعد تسليم، ويسجّل عليها ساعات العمل. إنجاز المهام في موعدها يدخل في تقييم الأداء.</p>
      </div>
      <button class="btn btn-gold" @click="creating = true">+ مهمة جديدة</button>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="p-filters">
      <template v-if="manager">
        <button :class="['p-chip', { on: scope === 'all' }]" @click="scope = 'all'; load()">كل الفريق</button>
        <button :class="['p-chip', { on: scope === 'mine' }]" @click="scope = 'mine'; load()">مهامي</button>
        <select v-if="scope === 'all'" v-model="member" class="input sel" @change="load">
          <option value="">كل الأعضاء</option>
          <option v-for="u in team" :key="u.id" :value="u.id">{{ u.fullName }}</option>
        </select>
      </template>
      <label class="check"><input v-model="showCancelled" type="checkbox" /> إظهار الملغاة</label>
      <span class="sum">
        <span v-if="overdue" class="tone tone-bad">{{ overdue }} متأخرة</span>
        <span class="tone tone-muted">{{ hours }} ساعة عمل مسجلة</span>
      </span>
    </div>

    <div class="board" :style="{ '--cols': columns.length }">
      <section v-for="c in columns" :key="c" class="col">
        <header><span :class="['tone', `tone-${TASK_STATUS[c].tone}`]">{{ TASK_STATUS[c].label }}</span><b>{{ by(c).length }}</b></header>
        <RouterLink v-for="t in by(c)" :key="t.id" :to="`/support-desk/tasks/${t.id}`" :class="['tcard', { late: t.overdue }]" :style="{ '--c': PRIORITY[t.priority].color }">
          <div class="top"><b dir="ltr">{{ t.number }}</b><span class="prio">{{ PRIORITY[t.priority].label }}</span></div>
          <p class="title">{{ t.title }}</p>
          <p v-if="t.ticket" class="muted small">🎫 <span dir="ltr">{{ t.ticket.number }}</span> {{ t.ticket.subject }}</p>
          <div class="meta">
            <span>👤 {{ t.assigneeName }}</span>
            <span>⏱ {{ t.spentHours }}<template v-if="t.estimatedHours"> / {{ t.estimatedHours }}</template> س</span>
          </div>
          <div class="due">
            <template v-if="t.status === 'done'"><span :class="['tone', t.onTime ? 'tone-ok' : 'tone-warn']">{{ t.onTime ? 'في الموعد' : 'بعد الموعد' }}</span></template>
            <template v-else-if="t.status !== 'cancelled'"><span :class="['tone', t.overdue ? 'tone-bad' : 'tone-muted']">{{ remaining(t.dueAt) }}</span></template>
            <small class="muted">{{ fmtDT(t.dueAt) }}</small>
          </div>
        </RouterLink>
        <p v-if="!by(c).length" class="muted empty">لا توجد مهام</p>
      </section>
    </div>
    <TaskForm v-if="creating" :team="team" @close="creating = false" @saved="creating = false; load()" />
  </div>
</template>

<style scoped>
.sel { width: auto; min-width: 180px; padding-block: 4px; }
.sum { margin-inline-start: auto; display: flex; gap: 6px; }
.board { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 14px; align-items: start; }
@media (max-width: 900px) { .board { grid-template-columns: 1fr; } }
.col { background: var(--surface-2); border: 1px solid var(--border); border-radius: 16px; padding: 12px; min-height: 200px; }
.col header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.tcard { display: block; background: var(--surface); border: 1px solid var(--border); border-inline-start: 4px solid var(--c); border-radius: 12px; padding: 10px 12px; margin-bottom: 10px; color: var(--text); transition: transform .15s var(--ease), box-shadow .15s; animation: p-rise .4s var(--ease) both; }
.tcard:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
.tcard.late { background: color-mix(in srgb, #b91c1c 5%, var(--surface)); }
.top { display: flex; justify-content: space-between; font-size: .85rem; }
.prio { color: var(--c); font-weight: 700; }
.title { margin: 4px 0; font-weight: 600; }
.small { font-size: .82rem; margin: 0 0 4px; }
.meta { display: flex; justify-content: space-between; font-size: .82rem; color: var(--muted); margin: 6px 0; }
.due { display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap; }
.empty { text-align: center; padding: 20px 0; }
</style>
