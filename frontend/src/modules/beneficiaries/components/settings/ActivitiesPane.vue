<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../../api';
import { useToast } from '../../../../stores/toast';
import { RECURRENCES, label, money } from '../../labels';
import type { ActivityRow, ProjectService, Recurrence, WorkflowRow } from '../../types';

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
const form = reactive({
  level: 'axis' as ActivityRow['level'], parentId: null as string | null, name: '', description: '', workflowId: null as string | null, portalVisible: true, isActive: true,
  services: [] as { name: string; cost: number | null | '' }[], multiServices: false, allowConcurrent: false, recurrence: 'once' as Recurrence,
});
const rules = (a?: ActivityRow) => ({
  services: (a?.services ?? []).map((x) => ({ name: x.name, cost: x.cost ?? null })),
  multiServices: a?.multiServices ?? false, allowConcurrent: a?.allowConcurrent ?? false, recurrence: a?.recurrence ?? 'once',
});
const cleanServices = (): ProjectService[] => form.services
  .filter((x) => x.name.trim())
  .map((x) => ({ name: x.name.trim(), cost: x.cost === '' || x.cost === null ? null : Number(x.cost) }));

function add(level: ActivityRow['level'], parentId: string | null) {
  editing.value = null;
  Object.assign(form, { level, parentId, name: '', description: '', workflowId: null, portalVisible: true, isActive: true, ...rules() });
  formError.value = '';
  open.value = true;
}
function edit(a: ActivityRow) {
  editing.value = a;
  Object.assign(form, { level: a.level, parentId: a.parentId, name: a.name, description: a.description ?? '', workflowId: a.workflowId, portalVisible: a.portalVisible, isActive: a.isActive, ...rules(a) });
  formError.value = '';
  open.value = true;
}
async function save() {
  try {
    const body = {
      name: form.name, description: form.description, workflowId: form.workflowId, portalVisible: form.portalVisible, isActive: form.isActive,
      ...(form.level === 'project'
        ? { services: cleanServices(), multiServices: form.multiServices, allowConcurrent: form.allowConcurrent, recurrence: form.recurrence }
        : {}),
    };
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
              <span class="rtags">
                <span class="rtag rec">🔁 {{ label('recurrence', project.recurrence) }}</span>
                <span v-if="project.services.length" class="rtag">🧾 {{ project.services.length }} خدمة<template v-if="project.multiServices"> (أكتر من خدمة في الطلب)</template></span>
                <span v-if="project.allowConcurrent" class="rtag">📑 أكتر من طلب مفتوح</span>
              </span>
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

          <p class="sec">قواعد الدعم</p>
          <div class="field"><label>تكرار الدعم للمستفيد</label>
            <select v-model="form.recurrence" class="input"><option v-for="r in RECURRENCES" :key="r.value" :value="r.value">{{ r.label }}</option></select>
            <small class="muted">بعد اعتماد طلب، المستفيد مايقدرش يقدم تاني على نفس المشروع غير بعد الفترة دي{{ form.recurrence === 'once' ? '، و"مرة واحدة" يعني مايقدرش يقدم تاني خالص' : '' }}</small>
          </div>
          <label class="check"><input v-model="form.allowConcurrent" type="checkbox" /> يسمح بأكتر من طلب مفتوح في نفس الوقت للمستفيد</label>

          <p class="sec">خدمات المشروع</p>
          <p class="muted small">لو ضفت خدمات، المستفيد بيختار منها وهو بيقدم، وتكلفتها بتتحسب كتكلفة تقديرية للطلب.</p>
          <div class="svcs">
            <div v-for="(x, i) in form.services" :key="i" class="svc">
              <input v-model="x.name" class="input" placeholder="اسم الخدمة" />
              <input v-model="x.cost" type="number" min="0" class="input cost" placeholder="التكلفة (اختياري)" />
              <button type="button" class="icon danger" @click="form.services.splice(i, 1)">✕</button>
            </div>
          </div>
          <button type="button" class="btn btn-sm" @click="form.services.push({ name: '', cost: null })">+ إضافة خدمة</button>
          <label v-if="form.services.length > 1" class="check" style="margin-top: 8px"><input v-model="form.multiServices" type="checkbox" /> يسمح باختيار أكتر من خدمة في نفس الطلب</label>
          <p v-if="cleanServices().some((x) => x.cost)" class="muted small">إجمالي الخدمات: {{ money(cleanServices().reduce((a, x) => a + (x.cost ?? 0), 0)) }} جنيه</p>
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
.sec { font-weight: 700; color: var(--primary); margin: 14px 0 6px; }
.small { font-size: .8rem; margin: 0 0 8px; }
.field small { display: block; margin-top: 4px; font-size: .78rem; }
.svcs { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.svc { display: grid; grid-template-columns: 1fr 140px 32px; gap: 6px; align-items: center; }
.rtags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.rtag { font-size: .7rem; padding: 1px 7px; border-radius: 99px; background: var(--surface-2); color: var(--muted); }
.rtag.rec { background: #ecfeff; color: #0e7490; }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } }
@media (max-width: 600px) { .portal-tag { display: none; } .branch, .lvl-project { margin-inline-start: 10px; } }
</style>
