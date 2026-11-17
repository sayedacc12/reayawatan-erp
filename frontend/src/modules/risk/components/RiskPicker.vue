
<script setup lang="ts">
import { computed, ref } from 'vue';

/** اختيار عدة مخاطر من السجل المؤسسي (أو أي عناصر برمز وعنوان) */
const props = defineProps<{ modelValue: string[]; options: { id: string; code: string; title: string }[]; placeholder?: string; disabled?: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string[]): void }>();
const pick = ref('');
const chosen = computed(() => props.modelValue.map((id) => props.options.find((o) => o.id === id)).filter(Boolean) as { id: string; code: string; title: string }[]);
const rest = computed(() => props.options.filter((o) => !props.modelValue.includes(o.id)));
function add() {
  if (pick.value) emit('update:modelValue', [...props.modelValue, pick.value]);
  pick.value = '';
}
</script>

<template>
  <div>
    <div class="rk-chips" style="margin-bottom: 6px">
      <span v-for="o in chosen" :key="o.id" class="rk-chip"><span class="rk-code">{{ o.code }}</span>{{ o.title }}
        <button v-if="!disabled" type="button" @click="emit('update:modelValue', modelValue.filter((x) => x !== o.id))">✕</button></span>
      <span v-if="!chosen.length" class="pm-muted">لا شيء مرتبط</span>
    </div>
    <select v-if="!disabled" v-model="pick" class="input" @change="add">
      <option value="">{{ placeholder ?? '+ ربط خطر من السجل' }}</option>
      <option v-for="o in rest" :key="o.id" :value="o.id">{{ o.code }} — {{ o.title }}</option>
    </select>
  </div>
</template>
