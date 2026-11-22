<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * خلفية "شبكة نجوم" متحركة تتفاعل مع حركة الماوس.
 * تتوقف تلقائيًا عند تفضيل تقليل الحركة، وعند إخفاء الصفحة.
 */
const canvas = ref<HTMLCanvasElement | null>(null);
let raf = 0;
let cleanup: () => void = () => {};

onMounted(() => {
  const el = canvas.value!;
  const ctx = el.getContext('2d')!;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0, h = 0;
  type P = { x: number; y: number; vx: number; vy: number; r: number };
  let pts: P[] = [];
  const mouse = { x: -9999, y: -9999 };

  function resize() {
    w = el.clientWidth; h = el.clientHeight;
    el.width = w * dpr; el.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(110, Math.floor((w * h) / 14000));
    pts = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
      r: Math.random() * 1.6 + 0.6,
    }));
  }

  function frame() {
    ctx.clearRect(0, 0, w, h);
    for (const p of pts) {
      if (!reduce) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.hypot(dx, dy);
        if (d < 120 && d > 0) { p.x += (dx / d) * 0.8; p.y += (dy / d) * 0.8; }
      }
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 130) {
          ctx.strokeStyle = `rgba(125, 249, 230, ${0.16 * (1 - d / 130)})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    for (const p of pts) {
      ctx.fillStyle = 'rgba(190, 255, 245, 0.85)';
      ctx.shadowColor = 'rgba(127,179,148, 0.9)';
      ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    if (!reduce && !document.hidden) raf = requestAnimationFrame(frame);
  }

  const onMove = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
  };
  const onVis = () => { if (!document.hidden && !reduce) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } };

  resize(); frame();
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onMove);
  document.addEventListener('visibilitychange', onVis);
  cleanup = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('visibilitychange', onVis);
  };
});
onBeforeUnmount(() => cleanup());
</script>

<template>
  <canvas ref="canvas" class="particles" aria-hidden="true" />
</template>

<style scoped>
.particles { position: absolute; inset: 0; width: 100%; height: 100%; }
</style>
