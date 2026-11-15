<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../../api';
import { useToast } from '../../../../stores/toast';
import type { ActivityRow, WorkflowRow } from '../../types';

const toast = useToast();
const rows = ref<ActivityRow[]>([]);
const workflows = ref<WorkflowRow[]>([]);
const error = ref('');

async function load() {
  try {
    [rows.value, workflows.value] = await Promise.all([
      api<ActivityRow[]>('/beneficiaries/settings/activities'),
      api<WorkflowRow[]>('/beneficiaries/settings/workflows'),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

const children = (id: string | null) => rows.value.filter((r) => r.parentId === id);
const axes = computed(() => rows.value.filter((r) => r.level === 'axis'));
const levelName = { axis: 'محور', program: 'برنامج', project: 'مشروع' } as const;
const childLevel = { axis: 'program', program: 'project' } as const;

const open = ref(false);
const editing = ref<ActivityRow | null>(null);
const formError = ref('');
const form = reactive({ level: 'axis' as ActivityRow['level'], parentId: null as string | null, name: '', description: '', workflowId: null as string | null, portalVisible: true, isActive: true });

function add(level: ActivityRow['level'], parentId: string | null) {
  editing.value = null;
  Object.assign(form, { level, parentId, name: '', description: '', workflowId: null, portalVisible: true, isActive: true });
  formError.value = '';
  open.value = true;
}
function edit(a: ActivityRow) {
  editing.value = a;
  Object.assign(form, { level: a.level, parentId: a.parentId, name: a.name, description: a.description ?? '', workflowId: a.workflowId, portalVisible: a.portalVisible, isActive: a.isActive });
  formError.value = '';
  open.value = true;
}
async function save() {
  try {
    const body = { name: form.name, description: form.description, workflowId: form.workflowId, portalVisible: form.portalVisible, isActive: form.isActive };
    if (editing.value) await api(`/beneficiaries/settings/activities/${editing.value.id}`, { method: 'PATCH', json: body });
    else await api('/beneficiaries/settings/activities', { method: 'POST', json: { ...body, level: form.level, parentId: form.parentId } });
    open.value = false;
    toast.success(editing.value ? 'تم الحفظ' : `تمت إضافة ال${levelName[form.level]}`);
    await load();
  } catch (e) {
    formError.value = (e as Error).message;
  }
}
async function remove(a: ActivityRow) {
  if (!confirm(`حذف ${levelName[a.level]} "${a.name}"؟`)) return;
  try {
    await api(`/beneficiaries/settings/activities/${a.id}`, { method: 'DELETE' });
    toast.success('تم الحذف');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <section>
    <div class="pane-head">
      <p class="muted">الطلبات بتتقدم على المشاريع. كل مشروع تابع لبرنامج، وكل برنامج تابع لمحور.</p>
      <button class="btn btn-primary btn-sm" @click="add('axis', null)">+ محور جديد</button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <p v-if="!axes.length && !error" class="card empty">ابدأ بإضافة أول محور، مثل "الرعاية الاجتماعية".</p>

    <div class="tree">
      <article v-for="(axis, i) in axes" :key="axis.id" class="card axis" :style="{ '--i': i }">
        <header class="node lvl-axis">
          <span class="tag">محور</span><b>{{ axis.name }}</b>
          <span v-if="!axis.isActive" class="off">موقوف</span>
          <span class="acts">
            <button class="btn btn-sm" @click="add('program', axis.id)">+ برنامج</button>
            <button class="icon" title="تعديل" @click="edit(axis)">✎</button>
            <button class="icon danger" title="حذف" @click="remove(axis)">✕</button>
          </span>
        </header>
        <div v-for="program in children(axis.id)" :key="program.id" class="branch">
          <div class="node lvl-program">
            <span class="tag">برنامج</span><b>{{ program.name }}</b>
            <span v-if="!program.isActive" class="off">موقوف</span>
            <span class="acts">
              <button class="btn btn-sm" @click="add('project', program.id)">+ مشروع</button>
              <button class="icon" title="تعديل" @click="edit(program)">✎</button>
              <button class="icon danger" title="حذف" @click="remove(program)">✕</button>
            </span>
          </div>
          <div v-for="project in children(program.id)" :key="project.id" class="node lvl-project">
            <span class="tag">مشروع</span>
            <span class="grow">
              <b>{{ project.name }}</b>
              <small class="muted">{{ project.workflowName ?? 'سير العمل الافتراضي' }} · {{ project.requestCount }} طلب</small>
            </span>
            <span v-if="project.portalVisible && project.isActive" class="portal-tag">يظهر في البوابة</span>
            <span v-if="!project.isActive" class="off">موقوف</span>
            <span class="acts">
              <button class="icon" title="تعديل" @click="edit(project)">✎</button>
              <button class="icon danger" title="حذف" @click="remove(project)">✕</button>
            </span>
          </div>
        </div>
      </article>
    </div>

    <div v-if="open" class="modal-backdrop" @click.self="open = false">
      <form class="card modal" @submit.prevent="save">
        <h2 class="mt">{{ editing ? `تعديل ${levelName[form.level]}` : `${levelName[form.level]} جديد` }}</h2>
        <div v-if="formError" class="alert alert-error">{{ formError }}</div>
        <div class="field"><label>الاسم *</label><input v-model="form.name" class="input" required autofocus /></div>
        <div class="field"><label>الوصف</label><textarea v-model="form.description" class="input" rows="2" /></div>
        <template v-if="form.level === 'project'">
          <div class="field"><label>سير العمل للطلبات</label>
            <select v-model="form.workflowId" class="input"><option :value="null">الافتراضي ({{ workflows.find((w) => w.isDefault)?.name ?? 'غير محدد' }})</option><option v-for="w in workflows" :key="w.id" :value="w.id">{{ w.name }}</option></select>
          </div>
          <label class="check"><input v-model="form.portalVisible" type="checkbox" /> يظهر في بوابة المستفيدين ويمكن التقديم عليه</label>
        </template>
        <label class="check" style="margin-top: 10px"><input v-model="form.isActive" type="checkbox" /> نشط</label>
        <div class="modal-actions" style="margin-top: 16px"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="open = false">إلغاء</button></div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.pane-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.pane-head p { margin: 0; }
.empty { padding: 26px; text-align: center; color: var(--muted); }
.tree { display: flex; flex-direction: column; gap: 14px; }
.axis { padding: 6px; animation: rise .45s calc(var(--i) * 70ms) var(--ease) both; }
.node { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; }
.node:hover { background: var(--surface-2); }
.lvl-axis { background: linear-gradient(90deg, var(--primary-soft), transparent); }
.branch { margin-inline-start: 22px; border-inline-start: 2px solid var(--primary-soft); padding-inline-start: 10px; margin-top: 4px; }
.lvl-project { margin-inline-start: 22px; position: relative; }
.lvl-project::before { content: ''; position: absolute; inset-inline-start: -22px; top: 50%; width: 16px; height: 2px; background: var(--primary-soft); }
.tag { font-size: .7rem; font-weight: 700; padding: 2px 8px; border-radius: 6px; color: #fff; flex-shrink: 0; }
.lvl-axis .tag { background: linear-gradient(135deg, #14b8a6, #0f766e); }
.lvl-program .tag { background: linear-gradient(135deg, #818cf8, #4f46e5); }
.lvl-project .tag { background: linear-gradient(135deg, #f5c66b, #d99a2b); color: #3b2a06; }
.grow { flex: 1; min-width: 0; }
.grow small { display: block; font-size: .76rem; }
.acts { margin-inline-start: auto; display: flex; gap: 4px; align-items: center; }
.icon { background: none; border: 0; cursor: pointer; width: 30px; height: 30px; border-radius: 8px; color: var(--muted); }
.icon:hover { background: var(--surface); color: var(--text); }
.icon.danger:hover { background: var(--danger-soft); color: var(--danger); }
.portal-tag { font-size: .72rem; padding: 1px 8px; border-radius: 999px; background: #fdf4ff; color: #a21caf; white-space: nowrap; }
.off { font-size: .72rem; padding: 1px 8px; border-radius: 999px; background: var(--surface-2); color: var(--muted); }
.mt { margin-bottom: 14px; }
textarea.input { resize: vertical; }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } }
@media (max-width: 600px) { .portal-tag { display: none; } .branch, .lvl-project { margin-inline-start: 10px; } }
</style>
