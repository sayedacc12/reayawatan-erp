<script setup lang="ts">
/**
 * خانة رقم الحساب في سطر القيد: يكتب المستخدم رقم الحساب أو جزءًا من اسمه فتظهر قائمة بحث،
 * وعند مطابقة الرقم يظهر اسم الحساب تلقائيًا. الحسابات الفرعية النشطة فقط.
 */
import { computed, ref, watch } from 'vue';
import type { Account } from '../lib';

const props = defineProps<{ modelValue: string | null; accounts: Account[]; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [string | null]; picked: [Account] }>();
const text = ref('');
const open = ref(false);
const hi = ref(0);
const current = computed(() => props.accounts.find((a) => a.id === props.modelValue) ?? null);
watch(current, (a) => { if (a && !open.value) text.value = a.code; }, { immediate: true });

const norm = (s: string) => s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
const items = computed(() => {
  const q = norm(text.value.trim());
  const subs = props.accounts.filter((a) => a.kind === 'sub' && a.isActive);
  if (!q) return subs.slice(0, 30);
  return subs.filter((a) => a.code.startsWith(q) || norm(a.name).includes(q)).slice(0, 30);
});
function pick(a: Account) {
  text.value = a.code;
  open.value = false;
  emit('update:modelValue', a.id);
  emit('picked', a);
}
function onInput() {
  open.value = true;
  hi.value = 0;
  const exact = props.accounts.find((a) => a.code === text.value.trim() && a.kind === 'sub' && a.isActive);
  emit('update:modelValue', exact?.id ?? null);
}
function onKey(e: KeyboardEvent) {
  if (!open.value && (e.key === 'ArrowDown')) { open.value = true; return; }
  if (e.key === 'ArrowDown') { hi.value = Math.min(hi.value + 1, items.value.length - 1); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { hi.value = Math.max(hi.value - 1, 0); e.preventDefault(); }
  else if (e.key === 'Enter' && open.value && items.value[hi.value]) { pick(items.value[hi.value]); e.preventDefault(); }
  else if (e.key === 'Escape') open.value = false;
}
function onBlur() {
  setTimeout(() => {
    open.value = false;
    if (current.value) text.value = current.value.code;
  }, 160);
}
</script>

<template>
  <div class="acell">
    <input v-model="text" class="input ac-code" :class="{ bad: text && !current }" :disabled="disabled" placeholder="رقم الحساب"
      @input="onInput" @focus="open = true" @keydown="onKey" @blur="onBlur" />
    <span class="name" :title="current?.name">{{ current ? current.name : text ? 'اختر حسابًا فرعيًا من القائمة' : '' }}</span>
    <ul v-if="open && !disabled" class="drop">
      <li v-for="(a, i) in items" :key="a.id" :class="{ hi: i === hi }" @mousedown.prevent="pick(a)" @mouseenter="hi = i">
        <span class="ac-code">{{ a.code }}</span> <span>{{ a.name }}</span>
        <small v-if="a.requiresAnalytic">تحليلي</small>
      </li>
      <li v-if="!items.length" class="none">لا توجد حسابات فرعية مطابقة</li>
    </ul>
  </div>
</template>

<style scoped>
.acell { position: relative; min-width: 240px; }
.acell .input { width: 130px; padding: 6px 8px; }
.acell .input.bad { border-color: #f59e0b; }
.name { display: inline-block; margin-inline-start: 8px; font-size: .84rem; color: var(--muted); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
.drop { position: absolute; z-index: 30; top: 100%; inset-inline-start: 0; width: 380px; max-height: 280px; overflow-y: auto; margin: 4px 0 0; padding: 4px; list-style: none;
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 18px 40px rgba(15,23,42,.18); animation: pop .18s var(--ease) both; }
.drop li { padding: 7px 10px; border-radius: 8px; cursor: pointer; display: flex; gap: 8px; align-items: center; font-size: .88rem; }
.drop li.hi { background: var(--primary-soft); }
.drop li small { margin-inline-start: auto; font-size: .7rem; color: #b45309; }
.drop li.none { color: var(--muted); cursor: default; }
@keyframes pop { from { opacity: 0; transform: translateY(-4px); } }
</style>
