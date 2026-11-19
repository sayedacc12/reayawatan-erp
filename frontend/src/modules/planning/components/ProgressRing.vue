<script setup lang="ts">
import { computed } from 'vue';

/** حلقة إنجاز متحركة: القيمة الفعلية، ومؤشر صغير للمخطط */
const props = withDefaults(defineProps<{ value: number | null; planned?: number | null; size?: number; color?: string; label?: string }>(), { size: 74, color: '#0ea5e9', planned: null, label: '' });
const r = computed(() => props.size / 2 - 6);
const c = computed(() => 2 * Math.PI * r.value);
const off = computed(() => c.value * (1 - Math.min(100, Math.max(0, props.value ?? 0)) / 100));
const tick = computed(() => {
  if (props.planned === null || props.planned === undefined) return null;
  const a = (Math.min(100, props.planned) / 100) * 2 * Math.PI;
  const cx = props.size / 2, R1 = r.value - 6, R2 = r.value + 6;
  return { x1: cx + R1 * Math.cos(a), y1: cx + R1 * Math.sin(a), x2: cx + R2 * Math.cos(a), y2: cx + R2 * Math.sin(a) };
});
</script>

<template>
  <span class="pl-ring" :style="{ '--c': color, width: `${size}px`, height: `${size}px` }">
    <svg :width="size" :height="size">
      <circle class="bg" :cx="size / 2" :cy="size / 2" :r="r" fill="none" stroke-width="7" />
      <circle class="fg" :cx="size / 2" :cy="size / 2" :r="r" fill="none" :stroke="color" stroke-width="7" stroke-linecap="round" :stroke-dasharray="c" :stroke-dashoffset="off" />
      <line v-if="tick" :x1="tick.x1" :y1="tick.y1" :x2="tick.x2" :y2="tick.y2" stroke="#0f172a" stroke-opacity=".5" stroke-width="2" />
    </svg>
    <span class="pl-ring-label"><b>{{ value === null ? '—' : `${Math.round(value)}%` }}</b><small v-if="label">{{ label }}</small></span>
  </span>
</template>
