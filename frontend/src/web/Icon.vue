<script setup lang="ts">
import { computed } from 'vue';
import { ICONS } from './site';

const props = defineProps<{ name: string }>();
const els = computed(() => ICONS[props.name] ?? ICONS.strategy);
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <component :is="e.tag" v-for="(e, i) in els" :key="i" v-bind="e.a" />
  </svg>
</template>
