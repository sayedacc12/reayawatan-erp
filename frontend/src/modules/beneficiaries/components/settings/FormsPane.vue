<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../../../api';
import { useToast } from '../../../../stores/toast';
import { FIELD_TYPES, label } from '../../labels';
import type { DynamicForm, FormField } from '../../types';
import DynamicFields from '../DynamicFields.vue';

const toast = useToast();
const forms = ref<DynamicForm[]>([]);
const error = ref('');

async function load() {
  try {
    forms.value = await api<DynamicForm[]>('/beneficiaries/settings/forms');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

type EditField = FormField & { optionsText: string };
const open = ref(false);
const editing = ref<DynamicForm | null>(null);
const formError = ref('');
const form = reactive({ name: '', description: '', fields: [] as EditField[] });
const preview = ref<Record<string, unknown>>({});

const toEdit = (f: FormField): EditField => ({ ...f, optionsText: (f.options ?? []).join('\n') });
function openForm(f?: DynamicForm) {
  editing.value = f ?? null;
  formError.value = '';
  preview.value = {};
  Object.assign(form, {
    name: f?.name ?? '', description: f?.description ?? '',
    fields: f ? f.fields.map(toEdit) : [toEdit({ key: '', label: '', type: 'text', required: false })],
  });
  open.value = true;
}
function addField() { form.fields.push(toEdit({ key: '', label: '', type: 'text', required: false })); }
function move(i: number, d: number) { const s = form.fields; [s[i], s[i + d]] = [s[i + d], s[i]]; }
const cleanFields = () => form.fields.map((f, i): FormField => ({
  key: f.key || `f${i + 1}`, label: f.label, type: f.type, required: f.required, placeholder: f.placeholder,
  options: f.type === 'select' ? f.optionsText.split('\n').map((o) => o.trim()).filter(Boolean) : undefined,
}));

async function save() {
  formError.value = '';
  try {
    const body = { name: form.name, description: form.description, fields: cleanFields() };
    if (editing.value) await api(`/beneficiaries/settings/forms/${editing.value.id}`, { method: 'PUT', json: body });
    else await api('/beneficiaries/settings/forms', { method: 'POST', json: body });
    open.value = false;
    toast.success('تم حفظ النموذج');
    await load();
  } catch (e) {
    formError.value = (e as Error).message;
  }
}
async function remove(f: DynamicForm) {
  if (!confirm(`حذف النموذج "${f.name}"؟`)) return;
  try {
    await api(`/beneficiaries/settings/forms/${f.id}`, { method: 'DELETE' });
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
      <p class="muted">النماذج بتتربط بمراحل سير العمل (زي نموذج البحث الاجتماعي) أو بتقديم الطلب. ضيف الحقول اللي محتاجها وغيّرها في أي وقت.</p>
      <button class="btn btn-primary btn-sm" @click="openForm()">+ نموذج جديد</button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <p v-if="!forms.length && !error" class="card empty">لا توجد نماذج بعد.</p>
    <div class="grid">
      <article v-for="(f, i) in forms" :key="f.id" class="card fcard" :style="{ '--i': i }">
        <h3>{{ f.name }}</h3>
        <p v-if="f.description" class="muted small">{{ f.description }}</p>
        <ul class="fields"><li v-for="x in f.fields" :key="x.key">{{ x.label }}<span class="muted"> · {{ label('field', x.type) }}</span><b v-if="x.required" class="req">*</b></li></ul>
        <div class="acts"><button class="btn btn-sm" @click="openForm(f)">تعديل</button><button class="btn btn-sm btn-danger" @click="remove(f)">حذف</button></div>
      </article>
    </div>

    <div v-if="open" class="modal-backdrop" @click.self="open = false">
      <form class="card modal builder" @submit.prevent="save">
        <h2 class="mt">{{ editing ? 'تعديل النموذج' : 'نموذج جديد' }}</h2>
        <div v-if="formError" class="alert alert-error">{{ formError }}</div>
        <div class="cols">
          <div>
            <div class="field"><label>اسم النموذج *</label><input v-model="form.name" class="input" required placeholder="مثال: نموذج البحث الاجتماعي" /></div>
            <div class="field"><label>الوصف</label><input v-model="form.description" class="input" /></div>
            <p class="sec">الحقول</p>
            <TransitionGroup name="list" tag="div" class="flist">
              <div v-for="(f, i) in form.fields" :key="f.key || `n${i}`" class="frow">
                <div class="r1">
                  <input v-model="f.label" class="input" placeholder="اسم الحقل" required />
                  <select v-model="f.type" class="input type"><option v-for="t in FIELD_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option></select>
                </div>
                <textarea v-if="f.type === 'select'" v-model="f.optionsText" class="input" rows="2" placeholder="الخيارات: كل خيار في سطر" required />
                <div class="r2">
                  <label class="check"><input v-model="f.required" type="checkbox" /> مطلوب</label>
                  <span class="mv">
                    <button type="button" class="icon" :disabled="i === 0" @click="move(i, -1)">▲</button>
                    <button type="button" class="icon" :disabled="i === form.fields.length - 1" @click="move(i, 1)">▼</button>
                    <button type="button" class="icon danger" @click="form.fields.splice(i, 1)">✕</button>
                  </span>
                </div>
              </div>
            </TransitionGroup>
            <button type="button" class="btn btn-sm" @click="addField">+ إضافة حقل</button>
          </div>
          <div class="preview">
            <p class="sec">معاينة</p>
            <div class="pv card">
              <p class="pv-title">{{ form.name || 'اسم النموذج' }}</p>
              <DynamicFields v-model="preview" :fields="cleanFields().filter((f) => f.label)" />
            </div>
          </div>
        </div>
        <div class="modal-actions"><button class="btn btn-primary">حفظ النموذج</button><button type="button" class="btn" @click="open = false">إلغاء</button></div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.pane-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.pane-head p { margin: 0; max-width: 720px; }
.empty { padding: 26px; text-align: center; color: var(--muted); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.fcard { padding: 16px; display: flex; flex-direction: column; animation: rise .45s calc(var(--i) * 60ms) var(--ease) both; border-top: 3px solid #818cf8; }
.fcard h3 { font-size: 1rem; }
.small { font-size: .82rem; margin: 4px 0 0; }
.fields { margin: 10px 0; padding-inline-start: 18px; font-size: .88rem; flex: 1; }
.req { color: var(--danger); margin-inline-start: 4px; }
.acts { display: flex; gap: 6px; }
.builder { max-width: 1000px; }
.mt { margin-bottom: 14px; }
.cols { display: grid; grid-template-columns: 1.1fr 1fr; gap: 18px; }
.sec { font-weight: 700; color: var(--primary); margin: 6px 0 10px; }
.flist { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.frow { padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); display: flex; flex-direction: column; gap: 8px; }
.r1 { display: grid; grid-template-columns: 1fr 160px; gap: 8px; }
.r2 { display: flex; justify-content: space-between; align-items: center; font-size: .88rem; }
.mv { display: flex; gap: 2px; }
.icon { background: var(--surface); border: 1px solid var(--border); cursor: pointer; width: 30px; height: 30px; border-radius: 8px; color: var(--muted); }
.icon:disabled { opacity: .35; }
.icon.danger:hover { background: var(--danger-soft); color: var(--danger); }
.preview { position: sticky; top: 0; align-self: start; }
.pv { padding: 16px; border-style: dashed; }
.pv-title { font-weight: 700; margin: 0 0 12px; }
textarea.input { resize: vertical; }
.list-move, .list-enter-active, .list-leave-active { transition: all .3s var(--ease); }
.list-enter-from, .list-leave-to { opacity: 0; transform: translateX(-16px); }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } }
@media (max-width: 800px) { .cols { grid-template-columns: 1fr; } .r1 { grid-template-columns: 1fr; } }
</style>
