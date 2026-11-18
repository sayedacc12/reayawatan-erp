<script setup lang="ts">
import { computed } from 'vue';

/** منحنى درجة الأداء المالي الشهرية (السنوية المتوقعة حتى كل شهر) مع امتداد الاتجاه لنهاية السنة */
const props = defineProps<{ points: { month: string; score: number }[]; projected: number | null; monthsLeft?: number }>();
const W = 600;
const H = 140;
const geo = computed(() => {
  const n = props.points.length + (props.projected != null && props.monthsLeft ? props.monthsLeft : 0);
  const step = n > 1 ? (W - 40) / (n - 1) : 0;
  const y = (v: number) => H - 20 - (Math.max(0, Math.min(100, v)) / 100) * (H - 30);
  const pts = props.points.map((p, i) => [20 + (W - 40) - i * step, y(p.score)] as const);
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = pts.length ? `${pts[0][0]},${H - 20} ${line} ${pts[pts.length - 1][0]},${H - 20}` : '';
  const last = pts[pts.length - 1];
  const proj = last && props.projected != null && props.monthsLeft ? `${last[0]},${last[1]} ${20},${y(props.projected)}` : '';
  return { pts, line, area, proj, y };
});
</script>

<template>
  <svg class="gv-spark" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none">
    <defs><linearGradient id="gvg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#10b981" stop-opacity=".35" /><stop offset="1" stop-color="#10b981" stop-opacity="0" /></linearGradient></defs>
    <line v-for="g in [50, 70, 90]" :key="g" x1="20" :x2="W - 20" :y1="geo.y(g)" :y2="geo.y(g)" stroke="currentColor" stroke-opacity=".08" />
    <text v-for="g in [50, 70, 90]" :key="`t${g}`" :x="W - 4" :y="geo.y(g) + 3" text-anchor="end">{{ g }}</text>
    <polygon v-if="geo.area" class="ar" :points="geo.area" />
    <polyline v-if="geo.line" class="ln" :points="geo.line" />
    <polyline v-if="geo.proj" class="pj" :points="geo.proj" />
    <g v-for="(p, i) in geo.pts" :key="i">
      <circle :cx="p[0]" :cy="p[1]" r="3.5" fill="#10b981" />
      <text :x="p[0]" :y="H - 4" text-anchor="middle">{{ points[i].month.slice(5) }}</text>
    </g>
  </svg>
</template>
