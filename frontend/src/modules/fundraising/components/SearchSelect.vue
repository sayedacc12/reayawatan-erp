<script setup lang="ts">
/**
 * قائمة منسدلة بحث تفاعلي: تُفتح عند التركيز، وتتصفّى مع كل حرف يُكتب،
 * وتعمل بالأسهم وEnter وEsc. تقبل خيارات ثابتة أو دالة بحث من الخادم.
 */
import { computed, nextTick, ref, watch } from 'vue';

export interface SelectOption { id: string; label: string; sub?: string }

const props = withDefaults(defineProps<{
  modelValue: string | null;
  options?: SelectOption[];
  fetcher?: (q: string) => Promise<SelectOption[]>;
  selectedLabel?: string;
  placeholder?: string;
  emptyText?: string;
  required?: boolean;
}>(), { options: undefined, fetcher: undefined, selectedLabel: '', placeholder: 'ابحث...', emptyText: 'لا توجد نتائج مطابقة', required: false });
const emit = defineEmits<{ 'update:modelValue': [string | null]; select: [SelectOption | null] }>();

const open = ref(false);
const query = ref('');
const remote = ref<SelectOption[]>([]);
const loading = ref(false);
const hi = ref(0);
const input = ref<HTMLInputElement | null>(null);
const picked = ref<SelectOption | null>(null);

const shownLabel = computed(() => picked.value?.label ?? props.selectedLabel ?? props.options?.find((o) => o.id === props.modelValue)?.label ?? '');
watch(() => props.modelValue, (v) => { if (!v) picked.value = null; else if (picked.value && picked.value.id !== v) picked.value = null; });

const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();
const items = computed(() => {
  if (props.fetcher) return remote.value;
  const q = norm(query.value);
  return (props.options ?? []).filter((o) => !q || norm(`${o.label} ${o.sub ?? ''}`).includes(q)).slice(0, 50);
});

let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
function search() {
  if (!props.fetcher) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const my = ++seq;
    loading.value = true;
    const r = await props.fetcher!(query.value.trim()).catch(() => []);
    if (my === seq) { remote.value = r; loading.value = false; }
  }, query.value ? 220 : 0);
}
watch(query, () => { hi.value = 0; if (open.value) search(); });

function show() {
  if (open.value) return;
  open.value = true;
  query.value = '';
  hi.value = 0;
  search();
}
function choose(o: SelectOption) {
  picked.value = o;
  emit('update:modelValue', o.id);
  emit('select', o);
  open.value = false;
  query.value = '';
  input.value?.blur();
}
function clear() {
  picked.value = null;
  emit('update:modelValue', null);
  emit('select', null);
  nextTick(() => input.value?.focus());
}
function key(e: KeyboardEvent) {
  if (!open.value && ['ArrowDown', 'Enter'].includes(e.key)) { show(); e.preventDefault(); return; }
  if (e.key === 'ArrowDown') { hi.value = Math.min(items.value.length - 1, hi.value + 1); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { hi.value = Math.max(0, hi.value - 1); e.preventDefault(); }
  else if (e.key === 'Enter') { const o = items.value[hi.value]; if (o) choose(o); e.preventDefault(); }
  else if (e.key === 'Escape') { open.value = false; }
}
function blur() { setTimeout(() => { open.value = false; query.value = ''; }, 150); }
</script>

<template>
  <div :class="['ss', { open }]">
    <input
      ref="input" class="input ss-input" :value="open ? query : shownLabel" :placeholder="modelValue && !open ? '' : placeholder"
      :required="required && !modelValue" autocomplete="off" role="combobox" :aria-expanded="open"
      @focus="show" @input="query = ($event.target as HTMLInputElement).value" @keydown="key" @blur="blur"
    />
    <span class="ss-caret" aria-hidden="true">▾</span>
    <button v-if="modelValue && !open" type="button" class="ss-clear" title="إزالة الاختيار" @mousedown.prevent="clear">×</button>
    <Transition name="ss">
      <ul v-if="open" class="ss-list" role="listbox">
        <li v-for="(o, i) in items" :key="o.id" :class="{ hi: i === hi, on: o.id === modelValue }" role="option" @mousedown.prevent="choose(o)" @mouseenter="hi = i">
          <b>{{ o.label }}</b><small v-if="o.sub">{{ o.sub }}</small>
        </li>
        <li v-if="loading && !items.length" class="ss-empty">جارٍ البحث...</li>
        <li v-else-if="!items.length" class="ss-empty">{{ emptyText }}</li>
        <slot name="footer" />
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.ss { position: relative; }
.ss-input { padding-inline-end: 56px; cursor: pointer; }
.ss.open .ss-input { cursor: text; border-color: var(--primary); box-shadow: 0 0 0 3px rgba(20, 184, 166, .15); }
.ss-caret { position: absolute; inset-inline-end: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; transition: transform .2s; }
.ss.open .ss-caret { transform: translateY(-50%) rotate(180deg); }
.ss-clear { position: absolute; inset-inline-end: 30px; top: 50%; transform: translateY(-50%); border: 0; background: none; color: var(--muted); font-size: 1.1rem; cursor: pointer; line-height: 1; }
.ss-clear:hover { color: #dc2626; }
.ss-list { position: absolute; z-index: 30; inset-inline: 0; top: calc(100% + 6px); max-height: 280px; overflow: auto; margin: 0; padding: 6px; list-style: none;
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 18px 40px rgba(15, 23, 42, .16); }
.ss-list li { display: flex; flex-direction: column; gap: 1px; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.ss-list li small { color: var(--muted); font-size: .78rem; }
.ss-list li.hi { background: var(--surface-2); }
.ss-list li.on b { color: var(--primary); }
.ss-list li.ss-empty { color: var(--muted); cursor: default; font-size: .86rem; }
.ss-enter-active, .ss-leave-active { transition: opacity .15s, transform .15s; }
.ss-enter-from, .ss-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
