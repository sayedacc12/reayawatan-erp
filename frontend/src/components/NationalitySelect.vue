<script setup lang="ts">
/**
 * قائمة منسدلة للجنسية من القائمة المعتمدة في إعدادات الجمعية.
 * إذا كانت للسجل جنسية قديمة ليست في القائمة تظهر خيارًا مستقلًا حتى لا تضيع.
 */
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';

const props = defineProps<{ options?: string[]; required?: boolean; disabled?: boolean }>();
const model = defineModel<string | null | undefined>({ required: true });
const loaded = ref<string[]>([]);
onMounted(async () => {
  if (props.options) return;
  try { loaded.value = await api<string[]>('/lookups/nationalities'); } catch { loaded.value = []; }
});
const list = computed(() => props.options ?? loaded.value);
const legacy = computed(() => (model.value && !list.value.includes(model.value) ? model.value : null));
</script>

<template>
  <select v-model="model" class="input" :required="required" :disabled="disabled">
    <option v-if="!model" value="" disabled>اختر الجنسية</option>
    <option v-if="legacy" :value="legacy">{{ legacy }} (غير موجودة في القائمة الحالية)</option>
    <option v-for="n in list" :key="n" :value="n">{{ n }}</option>
  </select>
</template>
