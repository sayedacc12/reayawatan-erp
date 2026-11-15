<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

/** رقم يعد من الصفر للقيمة بحركة ناعمة */
const props = defineProps<{ value: number; decimals?: number }>();
const shown = ref(0);
let raf = 0;

function run(from: number, to: number) {
  cancelAnimationFrame(raf);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { shown.value = to; return; }
  const start = performance.now();
  const dur = 900;
  const step = (t: number) => {
    const p = Math.min(1, (t - start) / dur);
    shown.value = from + (to - from) * (1 - Math.pow(1 - p, 3));
    if (p < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
onMounted(() => run(0, props.value));
watch(() => props.value, (v, old) => run(old ?? 0, v));
</script>

<template>
  <span>{{ shown.toLocaleString('ar-EG', { maximumFractionDigits: decimals ?? 0 }) }}</span>
</template>
