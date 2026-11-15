<script setup lang="ts">
import { computed } from 'vue';
import { color, label, type LabelKind } from '../labels';

const props = defineProps<{ value: string; kind?: LabelKind }>();
const c = computed(() => color(props.kind ?? 'status', props.value));
</script>

<template>
  <span class="sb" :style="{ '--c': c }"><i />{{ label(kind ?? 'status', value) }}</span>
</template>

<style scoped>
.sb { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px 2px 12px; border-radius: 999px; font-size: .8rem; font-weight: 600;
  color: color-mix(in srgb, var(--c) 82%, #000); background: color-mix(in srgb, var(--c) 13%, transparent); white-space: nowrap; }
.sb i { width: 7px; height: 7px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 22%, transparent); }
</style>
