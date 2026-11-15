<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';

/**
 * صلاحيات وحدة واحدة على أدوار الجمعية، داخل شاشة إعدادات الوحدة.
 * بيعدّل صلاحيات الوحدة دي بس في كل دور، وصلاحيات باقي الوحدات بتفضل زي ما هي.
 */
const props = defineProps<{ module: string }>();

interface ModRole { id: string; name: string; description: string | null; permissions: string[]; userCount: number }
interface ModData { module: { code: string; name: string; permissions: { code: string; name: string }[] }; roles: ModRole[] }

const session = useSession();
const toast = useToast();
const data = ref<ModData | null>(null);
const error = ref('');
const selectedId = ref<string | null>(null);
const picked = reactive(new Set<string>());
const saving = ref(false);
const newName = ref('');
const adding = ref(false);

const selected = computed(() => data.value?.roles.find((r) => r.id === selectedId.value) ?? null);
const dirty = computed(() => {
  const r = selected.value;
  if (!r) return false;
  return r.permissions.length !== picked.size || r.permissions.some((c) => !picked.has(c));
});

async function load(keep?: string) {
  try {
    data.value = await api<ModData>(`/roles/module/${props.module}`);
    const target = data.value.roles.find((r) => r.id === (keep ?? selectedId.value)) ?? data.value.roles[0];
    if (target) select(target);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => load());

function select(r: ModRole) {
  selectedId.value = r.id;
  picked.clear();
  r.permissions.forEach((c) => picked.add(c));
}
function toggle(code: string) {
  picked.has(code) ? picked.delete(code) : picked.add(code);
}
function toggleAll() {
  const all = data.value!.module.permissions;
  if (picked.size === all.length) picked.clear();
  else all.forEach((p) => picked.add(p.code));
}

async function save() {
  if (!selected.value) return;
  saving.value = true;
  error.value = '';
  try {
    data.value = await api<ModData>(`/roles/${selected.value.id}/module/${props.module}`, { method: 'PUT', json: { permissions: [...picked] } });
    toast.success(`تم حفظ صلاحيات "${selected.value.name}"`);
    await session.refresh();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

async function addRole() {
  if (newName.value.trim().length < 2) return;
  adding.value = true;
  error.value = '';
  try {
    const name = newName.value.trim();
    data.value = await api<ModData>(`/roles/module/${props.module}`, { method: 'POST', json: { name, permissions: [] } });
    const created = data.value.roles.find((r) => r.name === name);
    if (created) select(created);
    newName.value = '';
    toast.success(`تم إنشاء دور "${name}"، اختر صلاحياته`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    adding.value = false;
  }
}
</script>

<template>
  <section class="mp">
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="data" class="grid">
      <aside class="card roles">
        <div class="roles-head">الأدوار</div>
        <button v-for="(r, i) in data.roles" :key="r.id" :class="['role', { on: r.id === selectedId }]" :style="{ '--i': i }" @click="select(r)">
          <span class="rn">{{ r.name }}</span>
          <span class="meter"><i :style="{ width: `${(r.permissions.length / data.module.permissions.length) * 100}%` }" /></span>
          <span class="muted small">{{ r.permissions.length }} من {{ data.module.permissions.length }} · {{ r.userCount }} مستخدم</span>
        </button>
        <form class="add" @submit.prevent="addRole">
          <input v-model="newName" class="input" placeholder="اسم دور جديد" maxlength="100" />
          <button class="btn btn-sm btn-primary" :disabled="adding || newName.trim().length < 2">إضافة</button>
        </form>
      </aside>

      <div v-if="selected" class="card perms">
        <div class="perms-head">
          <div>
            <h2>صلاحيات "{{ selected.name }}" في {{ data.module.name }}</h2>
            <p class="muted small">التعديل هنا يغيّر صلاحيات {{ data.module.name }} فقط. أما الصلاحيات العامة فتُضبط من شاشة الأدوار في الإعدادات العامة.</p>
          </div>
          <button class="btn btn-sm" @click="toggleAll">{{ picked.size === data.module.permissions.length ? 'إلغاء الكل' : 'تحديد الكل' }}</button>
        </div>
        <div class="list">
          <label v-for="(p, i) in data.module.permissions" :key="p.code" :class="['perm', { on: picked.has(p.code) }]" :style="{ '--i': i }">
            <span class="switch"><input type="checkbox" :checked="picked.has(p.code)" @change="toggle(p.code)" /><i /></span>
            <span>{{ p.name }}</span>
          </label>
        </div>
        <div class="foot">
          <span v-if="dirty" class="muted small">توجد تغييرات لم تُحفظ بعد</span>
          <button class="btn btn-primary" :disabled="saving || !dirty" @click="save">حفظ الصلاحيات</button>
        </div>
      </div>
      <div v-else class="card perms muted">لا توجد أدوار بعد. أضف أول دور من القائمة.</div>
    </div>
  </section>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: 270px 1fr; gap: 16px; align-items: start; }
.roles { padding: 8px; display: flex; flex-direction: column; gap: 4px; }
.roles-head { font-weight: 700; padding: 6px 10px 8px; color: var(--muted); font-size: .85rem; }
.role { display: flex; flex-direction: column; gap: 5px; text-align: right; font: inherit; color: var(--text); background: none; border: 1px solid transparent; border-radius: 12px; padding: 10px 12px; cursor: pointer;
  transition: all .2s; animation: rise .35s calc(var(--i) * 40ms) var(--ease, ease) both; }
.role:hover { background: var(--surface-2); }
.role.on { border-color: var(--primary); background: var(--primary-soft); box-shadow: 0 8px 20px rgba(20,184,166,.12); }
.rn { font-weight: 600; }
.meter { height: 5px; border-radius: 99px; background: var(--surface-2); overflow: hidden; }
.meter i { display: block; height: 100%; background: var(--grad, var(--primary)); border-radius: inherit; transition: width .4s; }
.add { display: flex; gap: 6px; padding: 8px 4px 2px; border-top: 1px dashed var(--border); margin-top: 6px; }
.add .input { flex: 1; min-width: 0; }
.perms { padding: 18px 20px; }
.perms-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
.perms-head h2 { font-size: 1.05rem; margin: 0 0 4px; }
.list { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.perm { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 12px; cursor: pointer; transition: all .2s;
  animation: rise .35s calc(var(--i) * 30ms) var(--ease, ease) both; }
.perm:hover { border-color: var(--primary); }
.perm.on { background: var(--primary-soft); border-color: var(--primary); }
.switch { position: relative; width: 38px; height: 22px; flex-shrink: 0; }
.switch input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
.switch i { position: absolute; inset: 0; border-radius: 99px; background: var(--border); transition: background .2s; pointer-events: none; }
.switch i::after { content: ''; position: absolute; top: 3px; right: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .2s; }
.switch input:checked + i { background: var(--primary); box-shadow: 0 0 10px rgba(20,184,166,.5); }
.switch input:checked + i::after { transform: translateX(-16px); }
.foot { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 16px; }
.small { font-size: .82rem; margin: 0; }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
@media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
</style>
