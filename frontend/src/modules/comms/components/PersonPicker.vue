<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Person } from '../lib';

/** اختيار موظف واحد أو عدة موظفين بالبحث بالاسم أو الإدارة */
const props = defineProps<{ people: Person[]; modelValue: string | string[] | null; multiple?: boolean; placeholder?: string; exclude?: string[] }>();
const emit = defineEmits<{ 'update:modelValue': [v: string | string[] | null] }>();
const q = ref('');
const open = ref(false);
const selected = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : props.modelValue ? [props.modelValue] : []));
const options = computed(() => props.people
  .filter((p) => !(props.exclude ?? []).includes(p.id) && (!props.multiple || !selected.value.includes(p.id)))
  .filter((p) => !q.value || `${p.fullName} ${p.unitName ?? ''} ${p.jobTitle ?? ''}`.includes(q.value.trim()))
  .slice(0, 40));
const nameOf = (id: string) => props.people.find((p) => p.id === id)?.fullName ?? '—';
function pick(p: Person) {
  if (props.multiple) emit('update:modelValue', [...selected.value, p.id]);
  else emit('update:modelValue', p.id);
  q.value = '';
  open.value = props.multiple;
}
function remove(id: string) {
  emit('update:modelValue', props.multiple ? selected.value.filter((x) => x !== id) : null);
}
function blur() {
  setTimeout(() => (open.value = false), 150);
}
</script>

<template>
  <div class="cm-pick">
    <div v-if="multiple && selected.length" class="cm-chips" style="margin-bottom: 6px">
      <span v-for="id in selected" :key="id" class="cm-chip">{{ nameOf(id) }}<button type="button" title="إزالة" @click="remove(id)">×</button></span>
    </div>
    <div v-if="!multiple && selected.length" class="cm-chip" style="display: flex; justify-content: space-between; padding: 8px 12px; border-radius: 10px">
      <span><b>{{ nameOf(selected[0]) }}</b> <span class="pm-muted">{{ people.find((p) => p.id === selected[0])?.unitName ?? '' }}</span></span>
      <button type="button" title="تغيير" @click="remove(selected[0])">×</button>
    </div>
    <input v-else v-model="q" class="input" :placeholder="placeholder ?? 'ابحث بالاسم أو الإدارة'" @focus="open = true" @blur="blur" />
    <div v-if="open && options.length && (multiple || !selected.length)" class="menu">
      <button v-for="p in options" :key="p.id" type="button" @mousedown.prevent="pick(p)">
        <span>{{ p.fullName }}</span><span class="pm-muted">{{ p.unitName ?? p.jobTitle ?? '' }}</span>
      </button>
    </div>
  </div>
</template>
