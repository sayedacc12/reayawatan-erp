<script setup lang="ts">
import { computed } from 'vue';
import { SLA_STATE, remaining } from './support';
/** شارة مهلة (الرد أو الحل) مع العد التنازلي */
const props = defineProps<{ state: string; due: string; label: string; now: number }>();
const done = computed(() => props.state === 'met');
</script>

<template>
  <span :class="['tone', `tone-${SLA_STATE[state]?.tone ?? 'muted'}`]" :title="label">
    {{ label }}:
    <template v-if="done">تحققت ✓</template>
    <template v-else-if="state === 'paused'">متوقفة</template>
    <template v-else>{{ remaining(due, now) }}</template>
  </span>
</template>
