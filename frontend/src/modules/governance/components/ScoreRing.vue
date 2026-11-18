<script setup lang="ts">
import { computed } from 'vue';
import { scoreColor } from '../lib';

const props = defineProps<{ value: number | null | undefined; predicted?: number | null; size?: number; label?: string; sub?: string }>();
const s = computed(() => props.size ?? 150);
const r = computed(() => s.value / 2 - 10);
const c = computed(() => 2 * Math.PI * r.value);
const off = (v: number | null | undefined) => c.value * (1 - Math.max(0, Math.min(100, v ?? 0)) / 100);
</script>

<template>
  <div class="gv-ring" :style="{ '--c': scoreColor(value), width: `${s}px`, height: `${s}px` }">
    <svg :width="s" :height="s">
      <circle class="track" :cx="s / 2" :cy="s / 2" :r="r" fill="none" stroke-width="10" />
      <circle v-if="predicted != null" class="pred" :cx="s / 2" :cy="s / 2" :r="r" fill="none" :stroke="scoreColor(predicted)" stroke-width="10" :stroke-dasharray="c" :stroke-dashoffset="off(predicted)" />
      <circle class="val" :cx="s / 2" :cy="s / 2" :r="r" fill="none" stroke="var(--c)" stroke-width="10" stroke-linecap="round" :stroke-dasharray="c" :stroke-dashoffset="off(value)" />
    </svg>
    <div class="in">
      <strong>{{ value == null ? '—' : `${value.toLocaleString('ar-SA', { maximumFractionDigits: 1 })}%` }}</strong>
      <small v-if="label">{{ label }}</small>
      <small v-if="sub">{{ sub }}</small>
    </div>
  </div>
</template>
