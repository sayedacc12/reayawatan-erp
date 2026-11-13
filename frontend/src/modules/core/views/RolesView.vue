<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import type { ModuleInfo, RoleRow } from '../types';

const session = useSession();
const canManage = computed(() => session.can('core.roles.manage'));
const roles = ref<RoleRow[]>([]);
const modules = ref<ModuleInfo[]>([]);
const selectedId = ref<string | null>(null);
const isNew = ref(false);
const error = ref('');
const saved = ref(false);
const saving = ref(false);
const form = reactive({ name: '', description: '', permissions: new Set<string>() });

async function load() {
  try {
    [roles.value, modules.value] = await Promise.all([api<RoleRow[]>('/roles'), api<ModuleInfo[]>('/modules')]);
    if (!selectedId.value && !isNew.value && roles.value.length) select(roles.value[0]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

function select(r: RoleRow) {
  isNew.value = false;
  selectedId.value = r.id;
  error.value = '';
  saved.value = false;
  form.name = r.name;
  form.description = r.description ?? '';
  form.permissions = new Set(r.permissions);
}

function startNew() {
  isNew.value = true;
  selectedId.value = null;
  error.value = '';
  saved.value = false;
  form.name = '';
  form.description = '';
  form.permissions = new Set();
}

const showEditor = computed(() => isNew.value || selectedId.value !== null);
const selectedRole = computed(() => roles.value.find((r) => r.id === selectedId.value));

function toggle(code: string) {
  if (!canManage.value) return;
  form.permissions.has(code) ? form.permissions.delete(code) : form.permissions.add(code);
}
function moduleState(m: ModuleInfo) {
  const n = m.permissions.filter((p) => form.permissions.has(p.code)).length;
  return n === 0 ? 'none' : n === m.permissions.length ? 'all' : 'some';
}
function toggleModule(m: ModuleInfo) {
  const all = moduleState(m) === 'all';
  m.permissions.forEach((p) => (all ? form.permissions.delete(p.code) : form.permissions.add(p.code)));
}

async function save() {
  error.value = '';
  saved.value = false;
  saving.value = true;
  const body = { name: form.name, description: form.description, permissions: [...form.permissions] };
  try {
    const role = isNew.value
      ? await api<RoleRow>('/roles', { method: 'POST', json: body })
      : await api<RoleRow>(`/roles/${selectedId.value}`, { method: 'PATCH', json: body });
    await load();
    select(role);
    saved.value = true;
    await session.refresh();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

async function remove() {
  const r = selectedRole.value;
  if (!r) return;
  const warn = r.userCount ? `\nهذا الدور مسند إلى ${r.userCount} مستخدم وسيفقدون صلاحياته.` : '';
  if (!confirm(`حذف الدور "${r.name}"؟${warn}`)) return;
  try {
    await api(`/roles/${r.id}`, { method: 'DELETE' });
    selectedId.value = null;
    await load();
    await session.refresh();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>الأدوار والصلاحيات</h1>
        <p class="muted">كل دور مجموعة صلاحيات على وحدات النظام. أسند الأدوار للمستخدمين من شاشة المستخدمين.</p>
      </div>
      <button v-if="canManage" class="btn btn-primary" @click="startNew">+ دور جديد</button>
    </div>

    <div class="layout">
      <aside class="card role-list">
        <button v-for="r in roles" :key="r.id" :class="['role-item', { active: r.id === selectedId }]" @click="select(r)">
          <span>{{ r.name }}</span>
          <span class="muted small">{{ r.permissions.length }} صلاحية · {{ r.userCount }} مستخدم</span>
        </button>
        <div v-if="!roles.length" class="muted small" style="padding: 12px">لا توجد أدوار بعد.</div>
      </aside>

      <section v-if="showEditor" class="card editor">
        <div v-if="error" class="alert alert-error">{{ error }}</div>
        <div v-if="saved" class="alert alert-success">تم الحفظ</div>
        <form @submit.prevent="save">
          <div class="row">
            <div class="field" style="flex: 1"><label>اسم الدور</label><input v-model="form.name" class="input" :disabled="!canManage" required /></div>
            <div class="field" style="flex: 2"><label>الوصف</label><input v-model="form.description" class="input" :disabled="!canManage" /></div>
          </div>

          <h2 style="margin: 6px 0 12px">الصلاحيات حسب الوحدة</h2>
          <div v-for="m in modules" :key="m.code" class="module">
            <div class="module-head">
              <label class="check">
                <input type="checkbox" :checked="moduleState(m) === 'all'" :indeterminate="moduleState(m) === 'some'"
                  :disabled="!canManage" @change="toggleModule(m)" />
                <strong>{{ m.name }}</strong>
              </label>
              <span class="muted small">{{ m.description }}</span>
            </div>
            <div class="perms">
              <label v-for="p in m.permissions" :key="p.code" class="check perm">
                <input type="checkbox" :checked="form.permissions.has(p.code)" :disabled="!canManage" @change="toggle(p.code)" />
                <span>{{ p.name }}<br /><code class="muted">{{ p.code }}</code></span>
              </label>
            </div>
          </div>

          <div v-if="canManage" class="modal-actions" style="justify-content: space-between">
            <button class="btn btn-primary" :disabled="saving">{{ isNew ? 'إنشاء الدور' : 'حفظ التغييرات' }}</button>
            <button v-if="!isNew" type="button" class="btn btn-danger" @click="remove">حذف الدور</button>
          </div>
        </form>
      </section>
      <section v-else class="card editor muted">اختر دورًا من القائمة أو أنشئ دورًا جديدًا.</section>
    </div>
  </div>
</template>

<style scoped>
.layout { display: grid; grid-template-columns: 260px 1fr; gap: 16px; align-items: start; }
.role-list { padding: 6px; display: flex; flex-direction: column; }
.role-item { background: none; border: 0; text-align: right; font: inherit; padding: 10px 12px; border-radius: 8px; cursor: pointer; display: flex; flex-direction: column; color: var(--text); }
.role-item:hover { background: var(--surface-2); }
.role-item.active { background: var(--primary-soft); color: var(--primary); }
.small { font-size: 0.82rem; }
.editor { padding: 20px; }
.row { display: flex; gap: 12px; flex-wrap: wrap; }
.module { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 12px; }
.module-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 14px; background: var(--surface-2); border-bottom: 1px solid var(--border); border-radius: 8px 8px 0 0; flex-wrap: wrap; }
.perms { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; padding: 12px 14px; }
.perm { align-items: flex-start; }
.perm input { margin-top: 4px; }
code { font-size: 0.75rem; direction: ltr; }
@media (max-width: 760px) { .layout { grid-template-columns: 1fr; } }
</style>
