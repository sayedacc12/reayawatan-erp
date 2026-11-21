<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed } from 'vue';
import { FIELD_LABELS } from '../sections';

/**
 * محرر عام لقسم محتوى: يقرأ شكل الحقل من القيمة الافتراضية (نص، رقم، نعم/لا، قائمة، مجموعة حقول)
 * فيعرض الحقل المناسب. القوائم تُضاف وتُحذف وتُرتب.
 */
const props = defineProps<{ modelValue: any; tpl: any; path: string; label?: string }>();
const emit = defineEmits<{ 'update:modelValue': [v: any] }>();

const kind = computed(() => (Array.isArray(props.tpl) ? 'list' : props.tpl !== null && typeof props.tpl === 'object' ? 'object' : typeof props.tpl));
const key = computed(() => props.path.split('.').pop()!.replace(/\[\d+\]$/, ''));
const title = computed(() => props.label ?? FIELD_LABELS[key.value] ?? key.value);
const long = computed(() => typeof props.tpl === 'string' && (props.tpl.length > 70 || ['lead', 'text', 'intro', 'storyLead', 'logoText', 'govText', 'calcNote'].includes(key.value)));
const itemTpl = computed(() => (Array.isArray(props.tpl) ? (props.tpl.length ? props.tpl[0] : '') : null));

function blank(t: any): any {
  if (Array.isArray(t)) return [];
  if (t && typeof t === 'object') return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, blank(v)]));
  if (typeof t === 'number') return 0;
  if (typeof t === 'boolean') return false;
  return '';
}
const list = computed<any[]>(() => (Array.isArray(props.modelValue) ? props.modelValue : []));
function setItem(i: number, v: any) { const a = [...list.value]; a[i] = v; emit('update:modelValue', a); }
function add() { emit('update:modelValue', [...list.value, blank(itemTpl.value)]); }
function remove(i: number) { const a = [...list.value]; a.splice(i, 1); emit('update:modelValue', a); }
function move(i: number, d: number) { const a = [...list.value]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x); emit('update:modelValue', a); }
function setField(k: string, v: any) { emit('update:modelValue', { ...(props.modelValue ?? {}), [k]: v }); }
</script>

<template>
  <div v-if="kind === 'string'" class="field">
    <label>{{ title }}</label>
    <textarea v-if="long" class="input" rows="3" :value="modelValue" @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" />
    <input v-else class="input" :value="modelValue" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)">
  </div>
  <div v-else-if="kind === 'number'" class="field">
    <label>{{ title }}</label>
    <input class="input" type="number" :value="modelValue" @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))">
  </div>
  <label v-else-if="kind === 'boolean'" class="check" style="margin-bottom: 12px">
    <input type="checkbox" :checked="modelValue" @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"> {{ title }}
  </label>
  <div v-else-if="kind === 'list'" class="field">
    <label>{{ title }}</label>
    <div class="rw-editor">
      <div v-for="(item, i) in list" :key="i" class="ed-item">
        <div class="ed-head">
          <span>{{ i + 1 }}</span>
          <span style="display: flex; gap: 4px">
            <button class="btn btn-sm" type="button" :disabled="i === 0" title="أعلى" @click="move(i, -1)">↑</button>
            <button class="btn btn-sm" type="button" :disabled="i === list.length - 1" title="أسفل" @click="move(i, 1)">↓</button>
            <button class="btn btn-sm btn-danger" type="button" @click="remove(i)">حذف</button>
          </span>
        </div>
        <ValueEditor :model-value="item" :tpl="itemTpl" :path="`${path}[${i}]`" :label="typeof itemTpl === 'string' ? ' ' : undefined" @update:model-value="setItem(i, $event)" />
      </div>
      <button class="btn btn-sm" type="button" style="justify-self: start" @click="add">+ إضافة</button>
    </div>
  </div>
  <div v-else-if="kind === 'object'">
    <ValueEditor v-for="(v, k) in tpl" :key="k" :model-value="modelValue?.[k]" :tpl="v" :path="`${path}.${k}`" @update:model-value="setField(String(k), $event)" />
  </div>
</template>
