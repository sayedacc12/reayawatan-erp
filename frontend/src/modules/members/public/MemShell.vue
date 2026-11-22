<script setup lang="ts">
import BrandMark from '../../../components/BrandMark.vue';
import ParticleField from '../../../components/ParticleField.vue';
/** إطار صفحات العضوية العامة (بدون دخول) بخلفية متحركة */
defineProps<{ org?: string | null; wide?: boolean }>();
</script>

<template>
  <div class="mpub">
    <div class="aurora" aria-hidden="true"><span /><span /><span /></div>
    <ParticleField />
    <header class="bar">
      <div class="brand"><BrandMark :size="34" /><span>{{ org ?? 'رعاية وطن' }}</span><small>العضوية</small></div>
    </header>
    <main :class="['wrap', { wide }]"><slot /></main>
    <footer class="foot">رعاية وطن · National Care</footer>
  </div>
</template>

<style scoped>
.mpub { min-height: 100vh; position: relative; overflow-x: hidden; background: linear-gradient(140deg, #071330, #0b2447 50%, #0b3b3a); padding-bottom: 30px; }
.aurora { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
.aurora span { position: absolute; width: 60vmax; height: 60vmax; border-radius: 50%; filter: blur(90px); opacity: .32; animation: drift 18s ease-in-out infinite alternate; }
.aurora span:nth-child(1) { background: #2dd4bf; top: -25vmax; right: -15vmax; }
.aurora span:nth-child(2) { background: #fbbf24; bottom: -30vmax; left: -20vmax; animation-delay: -6s; opacity: .2; }
.aurora span:nth-child(3) { background: #22d3ee; top: 30%; left: 30%; width: 40vmax; height: 40vmax; animation-delay: -12s; opacity: .12; }
@keyframes drift { to { transform: translate(6vmax, 4vmax) scale(1.1); } }
.bar { position: relative; z-index: 2; display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; max-width: 1000px; margin: 0 auto; }
.brand { display: flex; align-items: center; gap: 10px; color: #fff; font-weight: 700; font-size: 1.15rem; }
.brand small { font-weight: 600; color: #0b1b3f; background: linear-gradient(135deg, #2dd4bf, #fbbf24); border-radius: 999px; padding: 1px 10px; font-size: .78rem; }
.wrap { position: relative; z-index: 2; max-width: 780px; margin: 0 auto; padding: 0 16px; }
.wrap.wide { max-width: 940px; }
.foot { position: relative; z-index: 2; text-align: center; color: rgba(255,255,255,.45); font-size: .78rem; margin-top: 26px; }
@media (max-width: 640px) { .bar { padding: 14px 16px; } }
</style>
