<script setup lang="ts">
import { computed } from 'vue';
/** حلقة درجة التقييم من 100 بلون المستوى */
const props = defineProps<{ score: number | null; color?: string | null; size?: number; label?: string | null }>();
const r = 42;
const c = 2 * Math.PI * r;
const off = computed(() => c * (1 - Math.max(0, Math.min(100, props.score ?? 0)) / 100));
</script>

<template>
  <div class="ring" :style="{ width: `${size ?? 104}px`, height: `${size ?? 104}px`, '--rc': color ?? '#94a3b8' }">
    <svg viewBox="0 0 100 100">
      <circle cx="50" cy="50" :r="r" class="bg" />
      <circle cx="50" cy="50" :r="r" class="fg" :stroke-dasharray="c" :stroke-dashoffset="off" />
    </svg>
    <div class="v"><b>{{ score === null ? '—' : Math.round(score) }}</b><small>{{ label ?? 'من 100' }}</small></div>
  </div>
</template>

<style scoped>
.ring { position: relative; flex-shrink: 0; }
svg { width: 100%; height: 100%; transform: rotate(-90deg); animation: pt-spin .8s var(--ease) both; }
circle { fill: none; stroke-width: 9; }
.bg { stroke: color-mix(in srgb, var(--rc) 14%, transparent); }
.fg { stroke: var(--rc); stroke-linecap: round; transition: stroke-dashoffset .9s var(--ease); filter: drop-shadow(0 0 6px color-mix(in srgb, var(--rc) 55%, transparent)); }
.v { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; line-height: 1.1; }
.v b { font-size: 1.5rem; color: var(--rc); }
.v small { font-size: .68rem; color: var(--muted); }
</style>
