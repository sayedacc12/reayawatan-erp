<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { useSession } from '../../../stores/session';
import PersonPicker from '../components/PersonPicker.vue';
import { PRIORITIES, PRIORITY_COLOR, STATUS_COLOR, addDays, dueText, fmtDate, loadLookups, todayStr, type Lookups, type TaskRow } from '../lib';
import '../../projects/projects.css';
import '../comms.css';

/** مهامي: المسؤول عنها، وما أسانده، وما أسندته، والمسندة إلي من الأنظمة الأخرى. ومع all: كل المهام للمتابعة */
const props = defineProps<{ all?: boolean }>();
const router = useRouter();
const toast = useToast();
const session = useSession();
const L = ref<Lookups | null>(null);
const data = ref<{ items: TaskRow[]; counts: { mine: number; overdue: number; supporting: number; assigned: number; done: number } } | null>(null);
const external = ref<{ id: string; system: string; refNo: string | null; title: string; dueDate: string; progress: number; overdue: boolean; link: string }[]>([]);
const error = ref('');
const scope = ref(props.all ? 'all' : String(useRoute().query.scope ?? 'mine'));
const f = reactive({ status: 'active', source: '', q: '' });
const show = ref(false);
const busy = ref(false);
const n = reactive({ title: '', description: '', ownerUserId: null as string | null, supporterUserIds: [] as string[], priority: 'normal', startDate: todayStr(), dueDate: addDays(todayStr(), 7) });

const TABS = computed(() => props.all ? [] : [
  { v: 'mine', l: 'مسؤول عنها', n: data.value?.counts.mine },
  { v: 'supporting', l: 'أساند فيها', n: data.value?.counts.supporting },
  { v: 'assigned', l: 'أسندتها لغيري', n: data.value?.counts.assigned },
  { v: 'external', l: 'من الأنظمة الأخرى', n: external.value.length || undefined },
]);

async function load() {
  try {
    if (scope.value === 'external') {
      external.value = await api('/comms/tasks/external');
    } else {
      const qs = new URLSearchParams({ scope: scope.value });
      for (const k of ['status', 'source', 'q'] as const) if (f[k]) qs.set(k, f[k]);
      data.value = await api(`/comms/tasks?${qs}`);
    }
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await load();
  if (!props.all) api<typeof external.value>('/comms/tasks/external').then((r) => (external.value = r)).catch(() => {});
  L.value = await loadLookups().catch(() => null);
});
watch(() => [scope.value, f.status, f.source], load);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(() => f.q, () => { clearTimeout(timer); timer = setTimeout(load, 350); });

function openNew() {
  Object.assign(n, { title: '', description: '', ownerUserId: L.value?.can.tasks ? null : (session.user?.id ?? null), supporterUserIds: [], priority: 'normal', startDate: todayStr(), dueDate: addDays(todayStr(), 7) });
  show.value = true;
}
async function create() {
  busy.value = true;
  try {
    const r = await api<{ id: string; refNo: string }>('/comms/tasks', { method: 'POST', json: { ...n, description: n.description || null } });
    toast.success(`أُنشئت المهمة ${r.refNo}`);
    show.value = false;
    router.push(`/comms/tasks/${r.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const ROLE = { owner: { l: 'مسؤول', c: '#14b8a6' }, supporter: { l: 'مساند', c: '#8b5cf6' }, assigner: { l: 'أسندتها', c: '#0ea5e9' }, viewer: { l: 'متابعة', c: '#64748b' } } as const;
const trackClass = (t: TaskRow) => (t.status === 'done' ? 'ok' : t.overdue ? 'warn' : '');
const dueClass = (t: TaskRow) => (t.overdue ? 'late' : t.daysLeft !== null && t.daysLeft <= 2 ? 'soon' : '');
</script>

<template>
  <div>
    <section class="pm-hero cm-hero">
      <div style="display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: flex-end">
        <div>
          <p class="pm-kicker">المهام</p>
          <h1>{{ all ? 'كل المهام' : 'مهامي' }}</h1>
          <p class="pm-sub">لكل مهمة مسؤول واحد عن تنفيذها وموعد إغلاق. المساندون يطلعون عليها ويضيفون ملاحظاتهم للمتابعة فقط، ولا تُحسب عليهم.</p>
        </div>
        <div class="pm-actions"><button class="btn cm-glow" @click="openNew">+ مهمة جديدة</button></div>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="data && !all" class="pm-kpis">
      <div class="pm-kpi" style="--a: #14b8a6"><span>مفتوحة علي</span><strong>{{ data.counts.mine }}</strong><small>أنا المسؤول عنها</small></div>
      <div class="pm-kpi" style="--a: #e11d48"><span>متأخرة</span><strong>{{ data.counts.overdue }}</strong><small>تجاوزت موعد الإغلاق</small></div>
      <div class="pm-kpi" style="--a: #8b5cf6"><span>أساند فيها</span><strong>{{ data.counts.supporting }}</strong><small>للمتابعة فقط</small></div>
      <div class="pm-kpi" style="--a: #10b981"><span>أنجزتها</span><strong>{{ data.counts.done }}</strong><small>منذ البداية</small></div>
    </div>
    <div v-if="TABS.length" class="pm-tabs">
      <button v-for="t in TABS" :key="t.v" :class="['pm-tab', { on: scope === t.v }]" @click="scope = t.v">{{ t.l }} <b v-if="t.n">{{ t.n }}</b></button>
    </div>

    <template v-if="scope === 'external'">
      <p class="pm-muted">مهام مسندة إليك في نظامي المراجعة الداخلية والمخاطر. تُنجز من شاشاتها، وتظهر هنا لتجمع كل مهامك في مكان واحد.</p>
      <div class="cm-tasks">
        <RouterLink v-for="(x, i) in external" :key="x.id" :to="x.link" class="card cm-task" :style="{ '--i': i, '--c': x.overdue ? '#e11d48' : '#6366f1' }">
          <span class="cm-role" style="--c: #6366f1; justify-self: start">{{ x.system }}</span>
          <h3>{{ x.title }}</h3>
          <div class="cm-track" :class="{ warn: x.overdue }"><i :style="{ width: `${x.progress}%` }" /></div>
          <div style="display: flex; justify-content: space-between"><span class="cm-code">{{ x.refNo ?? '' }}</span><span :class="['cm-due', { late: x.overdue }]">{{ fmtDate(x.dueDate) }}</span></div>
        </RouterLink>
      </div>
      <div v-if="!external.length" class="pm-empty card">لا توجد مهام مسندة إليك في الأنظمة الأخرى.</div>
    </template>

    <template v-else>
      <div class="cm-toolbar">
        <input v-model="f.q" class="input grow" placeholder="ابحث بالعنوان أو الرقم أو المسؤول" />
        <select v-model="f.status" class="input">
          <option value="active">المفتوحة</option><option value="overdue">المتأخرة</option><option value="done">المنجزة</option><option value="cancelled">الملغاة</option><option value="">كل الحالات</option>
        </select>
        <select v-model="f.source" class="input"><option value="">كل المصادر</option><option value="manual">مباشرة</option><option value="meeting">توصيات الاجتماعات</option><option value="transaction">من المعاملات</option></select>
      </div>
      <div v-if="data" class="cm-tasks">
        <article v-for="(t, i) in data.items" :key="t.id" class="card cm-task" :style="{ '--i': i, '--c': t.overdue ? '#e11d48' : STATUS_COLOR[t.status] }" @click="router.push(`/comms/tasks/${t.id}`)">
          <div style="display: flex; justify-content: space-between; gap: 8px; align-items: center">
            <span class="cm-code">{{ t.refNo }}</span>
            <span style="display: flex; gap: 6px">
              <span v-if="t.isConfidential" class="cm-role" style="--c: #f59e0b">سرية</span>
              <span class="cm-role" :style="{ '--c': ROLE[t.myRole].c }">{{ ROLE[t.myRole].l }}</span>
            </span>
          </div>
          <h3>{{ t.title }}</h3>
          <div class="pm-muted" style="font-size: .8rem">{{ t.ownerName }}<template v-if="t.supporters.length"> · {{ t.supporters.length }} مساند</template> · {{ t.sourceLabel }}</div>
          <div class="cm-track" :class="trackClass(t)"><i :style="{ width: `${t.progress}%` }" /></div>
          <div style="display: flex; justify-content: space-between; align-items: center">
            <span class="pm-pill" :style="{ '--c': PRIORITY_COLOR[t.priority] }">{{ t.statusLabel }} · {{ t.progress }}%</span>
            <span :class="['cm-due', dueClass(t)]">{{ ['done', 'cancelled'].includes(t.status) ? fmtDate(t.dueDate) : dueText(t.daysLeft) }}{{ t.extended ? ' (مُمدَّدة)' : '' }}</span>
          </div>
        </article>
      </div>
      <div v-if="data && !data.items.length" class="pm-empty card">لا توجد مهام بهذا الفلتر.</div>
    </template>

    <div v-if="show && L" class="modal-backdrop" @click.self="show = false">
      <form class="modal card" style="max-width: 620px" @submit.prevent="create">
        <h2>مهمة جديدة</h2>
        <label class="field"><span>العنوان</span><input v-model="n.title" class="input" required minlength="3" /></label>
        <label class="field"><span>الوصف</span><textarea v-model="n.description" class="input" rows="3" /></label>
        <div class="field"><span>المسؤول عن التنفيذ (واحد فقط)</span><PersonPicker v-model="n.ownerUserId" :people="L.people" />
          <small v-if="!L.can.tasks" class="pm-muted">إسناد المهام لغيرك يحتاج صلاحية؛ يمكنك إنشاء مهمة لنفسك.</small></div>
        <div class="field"><span>المساندون (للمتابعة فقط، اختياري)</span><PersonPicker v-model="n.supporterUserIds" :people="L.people.filter((p) => p.id !== n.ownerUserId)" multiple placeholder="أضف مساندًا" /></div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0 12px">
          <label class="field"><span>الأهمية</span><select v-model="n.priority" class="input"><option v-for="p in PRIORITIES" :key="p.value" :value="p.value">{{ p.label }}</option></select></label>
          <label class="field"><span>البدء</span><input v-model="n.startDate" type="date" class="input" /></label>
          <label class="field"><span>موعد الإغلاق</span><input v-model="n.dueDate" type="date" class="input" required :min="n.startDate" /></label>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy || !n.ownerUserId">إنشاء</button><button type="button" class="btn" @click="show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
