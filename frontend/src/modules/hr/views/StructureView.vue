<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import OrgNode from '../components/OrgNode.vue';
import { P, type EmpRow, type Unit } from '../lib';
import '../../projects/projects.css';
import '../hr.css';

const session = useSession();
const toast = useToast();
const levels = ref<string[]>([]);
const units = ref<Unit[]>([]);
const employees = ref<EmpRow[]>([]);
const analytics = ref<{ id: string; code: string; name: string }[]>([]);
const error = ref('');
const view = ref<'chart' | 'list'>('chart');
async function load() {
  try {
    const r = await api<{ levels: string[]; units: Unit[] }>('/hr/structure');
    levels.value = r.levels;
    units.value = r.units;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await load();
  employees.value = await api<EmpRow[]>('/hr/employees').catch(() => []);
  if (session.can(P.structure) || session.can(P.settings)) analytics.value = (await api<{ analytics: typeof analytics.value }>('/hr/payroll-config').catch(() => ({ analytics: [] }))).analytics;
});
const analyticName = (id: string | null) => analytics.value.find((a) => a.id === id)?.code ?? '';
const roots = computed(() => units.value.filter((u) => !u.parentId));
const editing = ref<Unit | null>(null);
const form = reactive({ show: false, name: '', code: '', level: 0, parentId: '' as string, managerEmployeeId: '', costCenter: '', analyticAccountId: '', description: '' });
function openNew(parent?: Unit) {
  editing.value = null;
  Object.assign(form, { show: true, name: '', code: '', level: parent ? Math.min(parent.level + 1, levels.value.length - 1) : 0, parentId: parent?.id ?? '', managerEmployeeId: '', costCenter: parent?.costCenter ?? '', analyticAccountId: '', description: '' });
}
function openEdit(u: Unit) {
  if (!session.can(P.structure)) return;
  editing.value = u;
  Object.assign(form, { show: true, name: u.name, code: u.code ?? '', level: u.level, parentId: u.parentId ?? '', managerEmployeeId: u.managerEmployeeId ?? '', costCenter: u.costCenter ?? '', analyticAccountId: u.analyticAccountId ?? '', description: u.description ?? '' });
}
const parents = computed(() => units.value.filter((u) => u.level < form.level && u.id !== editing.value?.id));
async function save() {
  try {
    const body = { name: form.name, code: form.code || null, level: form.level, parentId: form.parentId || null, managerEmployeeId: form.managerEmployeeId || null, costCenter: form.costCenter || null, analyticAccountId: form.analyticAccountId || null, description: form.description || null };
    if (editing.value) await api(`/hr/units/${editing.value.id}`, { method: 'PATCH', json: body });
    else await api('/hr/units', { method: 'POST', json: body });
    toast.success('تم الحفظ');
    form.show = false;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove() {
  if (!editing.value || !confirm(`حذف "${editing.value.name}"؟`)) return;
  try {
    await api(`/hr/units/${editing.value.id}`, { method: 'DELETE' });
    form.show = false;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const indent = (u: Unit) => {
  let d = 0;
  let p = units.value.find((x) => x.id === u.parentId);
  while (p) { d++; p = units.value.find((x) => x.id === p!.parentId); }
  return d;
};
const ordered = computed(() => {
  const out: Unit[] = [];
  const walk = (pid: string | null) => units.value.filter((u) => u.parentId === pid).forEach((u) => { out.push(u); walk(u.id); });
  walk(null);
  return out;
});
</script>

<template>
  <div>
    <section class="pm-hero hr-hero">
      <div><p class="pm-kicker">التنظيم والتخطيط</p><h1>الهيكل التنظيمي</h1>
        <p class="pm-sub">مستويات الهيكل مرنة وتُعرّف من الإعدادات ({{ levels.join(' ← ') }}). يمكن أن تتبع الوحدة أي مستوى أعلى منها مباشرة.</p></div>
      <div class="pm-actions">
        <button v-if="session.can(P.structure)" class="btn hr-glow" @click="openNew()">وحدة جديدة</button>
        <RouterLink v-if="session.can(P.settings)" to="/hr/settings" class="btn hr-ghost">مستويات الهيكل</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="hr-tabs">
      <button :class="['hr-tab', { on: view === 'chart' }]" @click="view = 'chart'">المخطط</button>
      <button :class="['hr-tab', { on: view === 'list' }]" @click="view = 'list'">القائمة</button>
    </div>
    <section class="card pm-panel">
      <p v-if="!units.length" class="pm-empty">ابدأ بإضافة الوحدة العليا، مثل "الإدارة التنفيذية".</p>
      <div v-if="view === 'chart'" class="hr-org">
        <ul><OrgNode v-for="r in roots" :key="r.id" :unit="r" :all="units" @pick="openEdit" /></ul>
      </div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead><tr><th>الوحدة</th><th>المستوى</th><th>المدير</th><th>مركز التكلفة</th><th>الوظائف</th><th>الموظفون</th><th></th></tr></thead>
          <tbody>
            <tr v-for="u in ordered" :key="u.id">
              <td :style="{ paddingInlineStart: 12 + indent(u) * 22 + 'px' }"><b>{{ u.name }}</b> <span v-if="u.code" class="hr-code pm-muted" style="display: inline">{{ u.code }}</span></td>
              <td><span class="pm-tag">{{ u.levelName }}</span></td><td>{{ u.managerName ?? '—' }}</td><td>{{ u.costCenter ?? '—' }}<span v-if="u.analyticAccountId" class="pm-muted hr-code">{{ analyticName(u.analyticAccountId) }}</span></td><td>{{ u.jobs }}</td><td>{{ u.employees }}</td>
              <td style="white-space: nowrap"><template v-if="session.can(P.structure)"><button class="btn btn-sm" @click="openNew(u)">+ فرعية</button> <button class="btn btn-sm" @click="openEdit(u)">تعديل</button></template></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" @submit.prevent="save">
        <h2>{{ editing ? `تعديل ${editing.name}` : 'وحدة تنظيمية جديدة' }}</h2>
        <div class="pm-grid2">
          <label class="field"><span>الاسم</span><input v-model="form.name" class="input" required /></label>
          <label class="field"><span>الرمز (اختياري)</span><input v-model="form.code" class="input" /></label>
          <label class="field"><span>المستوى</span><select v-model.number="form.level" class="input"><option v-for="(l, i) in levels" :key="i" :value="i">{{ i + 1 }}. {{ l }}</option></select></label>
          <label class="field"><span>تتبع</span>
            <select v-model="form.parentId" class="input"><option value="">— (الوحدة العليا)</option><option v-for="p in parents" :key="p.id" :value="p.id">{{ p.levelName }}: {{ p.name }}</option></select>
          </label>
          <label class="field"><span>مدير الوحدة</span>
            <select v-model="form.managerEmployeeId" class="input"><option value="">—</option><option v-for="e in employees" :key="e.id" :value="e.id">{{ e.fullName }}</option></select>
          </label>
          <label class="field"><span>مركز التكلفة (وصف)</span><input v-model="form.costCenter" class="input" placeholder="مثل: البرامج" /></label>
          <label class="field"><span>الحساب التحليلي للرواتب في النظام المالي</span>
            <select v-model="form.analyticAccountId" class="input"><option value="">حساب الوحدة الأعلى</option><option v-for="a in analytics" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select>
          </label>
        </div>
        <label class="field"><span>الوصف</span><textarea v-model="form.description" class="input" rows="2" /></label>
        <div class="modal-actions">
          <button class="btn btn-primary">حفظ</button>
          <button v-if="editing" type="button" class="btn" @click="openNew(editing)">+ وحدة فرعية</button>
          <button v-if="editing" type="button" class="btn btn-danger" @click="remove">حذف</button>
          <button type="button" class="btn" @click="form.show = false">إلغاء</button>
        </div>
      </form>
    </div>
  </div>
</template>
