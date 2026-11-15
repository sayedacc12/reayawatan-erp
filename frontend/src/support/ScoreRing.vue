<script setup lang="ts">
import { computed } from 'vue';
/** حلقة نسبة الأداء (من 100) */
const props = defineProps<{ value: number | null; size?: number; label?: string }>();
const C = 2 * Math.PI * 42;
const color = computed(() => (props.value === null ? '#94a3b8' : props.value >= 90 ? '#10b981' : props.value >= 70 ? '#14b8a6' : props.value >= 60 ? '#e8b04b' : '#ef4444'));
const dash = computed(() => `${((props.value ?? 0) / 100) * C} ${C}`);
</script>

<template>
  <div class="ring" :style="{ width: (size ?? 110) + 'px' }">
    <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" class="bg" /><circle cx="50" cy="50" r="42" class="fg" :stroke="color" :stroke-dasharray="dash" /></svg>
    <div class="c"><b :style="{ color }">{{ value ?? '—' }}</b><small v-if="label">{{ label }}</small></div>
  </div>
</template>

<style scoped>
.ring { position: relative; aspect-ratio: 1; }
svg { width: 100%; transform: rotate(-90deg); }
.bg { fill: none; stroke: var(--surface-2); stroke-width: 9; }
.fg { fill: none; stroke-width: 9; stroke-linecap: round; animation: draw 1.1s var(--ease) both; filter: drop-shadow(0 0 4px currentColor); }
@keyframes draw { from { stroke-dasharray: 0 400; } }
.c { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.c b { font-size: 1.6rem; line-height: 1; }
.c small { color: var(--muted); font-size: .72rem; margin-top: 2px; }
</style>
