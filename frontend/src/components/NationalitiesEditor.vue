<script setup lang="ts">
/**
 * محرر قائمة الجنسيات المعتمدة في الجمعية. القائمة مشتركة بين كل الوحدات
 * (اشتراطات الداعمين في فرص التبرع، ونموذج تقديم طلبات المستفيدين).
 */
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { useToast } from '../stores/toast';

const toast = useToast();
const list = ref<string[]>([]);
const original = ref<string[]>([]);
const input = ref('');
const filter = ref('');
const saving = ref(false);
const error = ref('');
onMounted(async () => {
  try {
    list.value = await api<string[]>('/lookups/nationalities');
    original.value = [...list.value];
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const dirty = computed(() => JSON.stringify(list.value) !== JSON.stringify(original.value));
const shown = computed(() => list.value.filter((n) => !filter.value || n.includes(filter.value.trim())));
function add() {
  const v = input.value.trim().replace(/\s+/g, ' ');
  if (!v) return;
  if (list.value.includes(v)) toast.error(`"${v}" موجودة في القائمة`);
  else list.value.push(v);
  input.value = '';
}
function remove(n: string) {
  list.value = list.value.filter((x) => x !== n);
}
function move(n: string, d: -1 | 1) {
  const i = list.value.indexOf(n);
  const j = i + d;
  if (j < 0 || j >= list.value.length) return;
  [list.value[i], list.value[j]] = [list.value[j], list.value[i]];
}
async function save() {
  saving.value = true;
  error.value = '';
  try {
    list.value = await api<string[]>('/lookups/nationalities', { method: 'PUT', json: { nationalities: list.value } });
    original.value = [...list.value];
    toast.success('تم حفظ قائمة الجنسيات');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="ne">
    <p class="muted hint">هذه القائمة مشتركة في الجمعية كلها: تظهر قائمةً منسدلة في اشتراطات الداعمين بفرص التبرع، وفي نموذج تقديم طلبات المستفيدين. حذف جنسية لا يغيّر السجلات السابقة.</p>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="bar">
      <input v-model="input" class="input" placeholder="أضف جنسية، مثل: سعودي" @keydown.enter.prevent="add" />
      <button type="button" class="btn" @click="add">+ إضافة</button>
      <span class="grow" />
      <input v-model="filter" class="input search" placeholder="بحث في القائمة" />
    </div>
    <TransitionGroup name="chip" tag="div" class="chips">
      <span v-for="n in shown" :key="n" class="chip">
        <button type="button" class="mv" title="تقديم" @click="move(n, -1)">‹</button>
        {{ n }}
        <button type="button" class="mv" title="تأخير" @click="move(n, 1)">›</button>
        <button type="button" class="x" title="حذف" @click="remove(n)">×</button>
      </span>
    </TransitionGroup>
    <p class="muted count">{{ list.length.toLocaleString('ar-SA') }} جنسية</p>
    <div class="actions">
      <button type="button" class="btn btn-primary" :disabled="!dirty || saving" @click="save">{{ saving ? 'جارٍ الحفظ...' : 'حفظ القائمة' }}</button>
      <button v-if="dirty" type="button" class="btn" @click="list = [...original]">تراجع</button>
    </div>
  </div>
</template>

<style scoped>
.hint { margin: 0 0 12px; font-size: .88rem; line-height: 1.7; }
.bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.bar .input { max-width: 260px; }
.bar .search { max-width: 200px; }
.grow { flex: 1; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { display: inline-flex; align-items: center; gap: 4px; padding: 5px 6px 5px 10px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); font-size: .9rem; }
.chip button { border: 0; background: none; cursor: pointer; color: var(--muted); font: inherit; line-height: 1; padding: 0 3px; }
.chip .x:hover { color: #dc2626; }
.chip .mv { opacity: 0; transition: opacity .15s; }
.chip:hover .mv { opacity: 1; }
.count { font-size: .82rem; margin: 10px 0; }
.actions { display: flex; gap: 8px; }
.chip-enter-active, .chip-leave-active { transition: all .2s; }
.chip-enter-from, .chip-leave-to { opacity: 0; transform: scale(.9); }
</style>
