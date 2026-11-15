<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../../../api';
import { useToast } from '../../../../stores/toast';
import type { DynamicForm, StageRow, WorkflowRow } from '../../types';

const toast = useToast();
const workflows = ref<WorkflowRow[]>([]);
const forms = ref<DynamicForm[]>([]);
const roles = ref<{ id: string; name: string }[]>([]);
const error = ref('');

async function load() {
  try {
    [workflows.value, forms.value, roles.value] = await Promise.all([
      api<WorkflowRow[]>('/beneficiaries/settings/workflows'),
      api<DynamicForm[]>('/beneficiaries/settings/forms'),
      api<{ id: string; name: string }[]>('/beneficiaries/settings/roles'),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

const open = ref(false);
const editing = ref<WorkflowRow | null>(null);
const formError = ref('');
const saving = ref(false);
const blankStage = (): StageRow => ({ name: '', instructions: '', formId: null, roleId: null, canReject: true, canReturn: true });
const form = reactive({ name: '', description: '', isDefault: false, applicationFormId: null as string | null, stages: [] as StageRow[] });

function openForm(w?: WorkflowRow) {
  editing.value = w ?? null;
  formError.value = '';
  Object.assign(form, {
    name: w?.name ?? '', description: w?.description ?? '', isDefault: w?.isDefault ?? !workflows.value.length,
    applicationFormId: w?.applicationFormId ?? null,
    stages: w ? w.stages.map((s) => ({ ...s })) : [
      { ...blankStage(), name: 'مراجعة الطلب' }, { ...blankStage(), name: 'البحث الاجتماعي' }, { ...blankStage(), name: 'الاعتماد النهائي' },
    ],
  });
  open.value = true;
}
function move(i: number, d: number) {
  const s = form.stages;
  [s[i], s[i + d]] = [s[i + d], s[i]];
}
async function save() {
  saving.value = true;
  formError.value = '';
  try {
    const body = {
      name: form.name, description: form.description, isDefault: form.isDefault, applicationFormId: form.applicationFormId,
      stages: form.stages.map((s) => ({ id: s.id, name: s.name, instructions: s.instructions, formId: s.formId, roleId: s.roleId, canReject: s.canReject, canReturn: s.canReturn })),
    };
    if (editing.value) await api(`/beneficiaries/settings/workflows/${editing.value.id}`, { method: 'PUT', json: body });
    else await api('/beneficiaries/settings/workflows', { method: 'POST', json: body });
    open.value = false;
    toast.success('تم حفظ سير العمل');
    await load();
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
async function remove(w: WorkflowRow) {
  if (!confirm(`حذف سير العمل "${w.name}"؟`)) return;
  try {
    await api(`/beneficiaries/settings/workflows/${w.id}`, { method: 'DELETE' });
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
      <p class="muted">كل مرحلة فيها قرار: قبول وتحويل للي بعدها، أو رفض، أو إرجاع للمرحلة السابقة مع السبب. آخر مرحلة = الاعتماد النهائي.</p>
      <button class="btn btn-primary btn-sm" @click="openForm()">+ سير عمل جديد</button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <p v-if="!workflows.length && !error" class="card empty">لسه مفيش سير عمل. أضف واحد علشان الطلبات تقدر تتقدم.</p>

    <article v-for="(w, wi) in workflows" :key="w.id" class="card wf" :style="{ '--i': wi }">
      <header>
        <div>
          <h3>{{ w.name }} <span v-if="w.isDefault" class="def">الافتراضي</span></h3>
          <p class="muted small">نموذج التقديم: {{ w.applicationFormName ?? 'بدون' }}<template v-if="w.description"> · {{ w.description }}</template></p>
        </div>
        <span class="acts"><button class="btn btn-sm" @click="openForm(w)">تعديل</button><button class="btn btn-sm btn-danger" @click="remove(w)">حذف</button></span>
      </header>
      <ol class="flow">
        <li class="start"><span class="dot">⬤</span><b>تقديم الطلب</b></li>
        <li v-for="(s, i) in w.stages" :key="s.id" :style="{ '--j': i }">
          <span class="dot">{{ i + 1 }}</span>
          <b>{{ s.name }}</b>
          <small v-if="s.formName" class="chip form">📝 {{ s.formName }}</small>
          <small v-if="s.roleName" class="chip role">👤 {{ s.roleName }}</small>
          <small v-if="s.activeRequests" class="chip count">{{ s.activeRequests }} طلب الآن</small>
        </li>
        <li class="end"><span class="dot">★</span><b>اعتماد نهائي</b></li>
      </ol>
    </article>

    <div v-if="open" class="modal-backdrop" @click.self="open = false">
      <form class="card modal modal-wide" @submit.prevent="save">
        <h2 class="mt">{{ editing ? 'تعديل سير العمل' : 'سير عمل جديد' }}</h2>
        <div v-if="formError" class="alert alert-error">{{ formError }}</div>
        <div class="two">
          <div class="field"><label>الاسم *</label><input v-model="form.name" class="input" required /></div>
          <div class="field"><label>نموذج بيانات الطلب (يعبّيه مقدم الطلب)</label>
            <select v-model="form.applicationFormId" class="input"><option :value="null">بدون نموذج</option><option v-for="f in forms" :key="f.id" :value="f.id">{{ f.name }}</option></select>
          </div>
        </div>
        <div class="field"><label>الوصف</label><input v-model="form.description" class="input" /></div>
        <label class="check"><input v-model="form.isDefault" type="checkbox" /> سير العمل الافتراضي لكل المشاريع اللي مش محدد لها سير عمل</label>

        <p class="stages-title">المراحل بالترتيب</p>
        <TransitionGroup name="list" tag="div" class="stages">
          <div v-for="(s, i) in form.stages" :key="s.id ?? `new-${i}`" class="stage">
            <div class="stage-no">{{ i + 1 }}</div>
            <div class="stage-body">
              <div class="row">
                <input v-model="s.name" class="input" placeholder="اسم المرحلة" required />
                <div class="mv">
                  <button type="button" class="icon" :disabled="i === 0" title="لأعلى" @click="move(i, -1)">▲</button>
                  <button type="button" class="icon" :disabled="i === form.stages.length - 1" title="لأسفل" @click="move(i, 1)">▼</button>
                  <button type="button" class="icon danger" :disabled="form.stages.length === 1" title="حذف" @click="form.stages.splice(i, 1)">✕</button>
                </div>
              </div>
              <div class="row3">
                <select v-model="s.formId" class="input"><option :value="null">بدون نموذج (قرار فقط)</option><option v-for="f in forms" :key="f.id" :value="f.id">نموذج: {{ f.name }}</option></select>
                <select v-model="s.roleId" class="input"><option :value="null">أي موظف معه صلاحية المعالجة</option><option v-for="r in roles" :key="r.id" :value="r.id">المسؤول: {{ r.name }}</option></select>
              </div>
              <input v-model="s.instructions" class="input" placeholder="تعليمات للمسؤول (اختياري)" />
              <div class="flags">
                <label class="check"><input v-model="s.canReturn" type="checkbox" /> يسمح بالإرجاع</label>
                <label class="check"><input v-model="s.canReject" type="checkbox" /> يسمح بالرفض</label>
                <span v-if="i === form.stages.length - 1" class="final">★ قبول هذه المرحلة = اعتماد نهائي</span>
              </div>
            </div>
          </div>
        </TransitionGroup>
        <button type="button" class="btn btn-sm add" @click="form.stages.push(blankStage())">+ إضافة مرحلة</button>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="saving">حفظ</button><button type="button" class="btn" @click="open = false">إلغاء</button></div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.pane-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.pane-head p { margin: 0; max-width: 720px; }
.empty { padding: 26px; text-align: center; color: var(--muted); }
.wf { padding: 18px; margin-bottom: 14px; animation: rise .45s calc(var(--i) * 70ms) var(--ease) both; }
.wf header { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.wf h3 { font-size: 1.02rem; display: flex; gap: 8px; align-items: center; }
.def { font-size: .72rem; padding: 1px 8px; border-radius: 999px; background: var(--primary-soft); color: var(--primary); }
.small { font-size: .82rem; margin: 2px 0 0; }
.acts { display: flex; gap: 6px; }
.flow { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: stretch; }
.flow li { display: flex; flex-direction: column; gap: 4px; padding: 10px 14px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); min-width: 130px; position: relative; animation: rise .4s calc(var(--j, 0) * 60ms + 100ms) var(--ease) both; }
.flow li:not(:last-child)::after { content: '←'; position: absolute; inset-inline-end: -14px; top: 50%; transform: translateY(-50%); color: var(--primary); font-weight: 700; z-index: 1; }
.dot { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: .75rem; font-weight: 700; color: #fff; background: var(--grad); box-shadow: 0 0 10px rgba(20,184,166,.5); }
.start .dot { background: #6366f1; font-size: .5rem; box-shadow: 0 0 10px rgba(99,102,241,.5); }
.end { background: linear-gradient(135deg, #fffbeb, #fef3c7) !important; border-color: #fcd34d !important; }
.end .dot { background: linear-gradient(135deg, #f5c66b, #d99a2b); box-shadow: 0 0 12px rgba(232,176,75,.7); }
.chip { font-size: .72rem; padding: 1px 8px; border-radius: 999px; align-self: flex-start; }
.chip.form { background: #eef2ff; color: #4338ca; } .chip.role { background: #ecfeff; color: #0e7490; } .chip.count { background: #fef3c7; color: #92400e; }
.mt { margin-bottom: 14px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.stages-title { font-weight: 700; color: var(--primary); margin: 18px 0 10px; }
.stages { display: flex; flex-direction: column; gap: 10px; }
.stage { display: flex; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); }
.stage-no { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 700; background: var(--grad); flex-shrink: 0; }
.stage-body { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.row { display: flex; gap: 8px; }
.row3 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.mv { display: flex; gap: 2px; }
.icon { background: var(--surface); border: 1px solid var(--border); cursor: pointer; width: 34px; height: 40px; border-radius: 8px; color: var(--muted); }
.icon:disabled { opacity: .35; cursor: default; }
.icon.danger:hover:not(:disabled) { background: var(--danger-soft); color: var(--danger); }
.flags { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; font-size: .88rem; }
.final { color: #b7791f; font-weight: 600; font-size: .82rem; }
.add { margin: 10px 0 6px; }
.list-move, .list-enter-active, .list-leave-active { transition: all .3s var(--ease); }
.list-enter-from, .list-leave-to { opacity: 0; transform: translateX(-16px); }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } }
@media (max-width: 640px) { .two, .row3 { grid-template-columns: 1fr; } .flow li:not(:last-child)::after { display: none; } }
</style>
