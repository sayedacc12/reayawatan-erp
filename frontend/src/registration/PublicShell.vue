<script setup lang="ts">
import BrandMark from '../components/BrandMark.vue';
import ParticleField from '../components/ParticleField.vue';
/** إطار الصفحات العامة للجمعيات (التسجيل والمتابعة والعقد) بخلفية متحركة */
defineProps<{ wide?: boolean }>();
</script>

<template>
  <div class="pub">
    <div class="aurora" aria-hidden="true"><span /><span /><span /></div>
    <ParticleField />
    <header class="bar">
      <RouterLink to="/register" class="brand"><BrandMark :size="34" /><span>سنابل</span><small>منصة إدارة الجمعيات</small></RouterLink>
      <RouterLink to="/login" class="bar-link">دخول إدارة المنصة</RouterLink>
    </header>
    <main :class="['wrap', { wide }]"><slot /></main>
  </div>
</template>

<style scoped>
.pub { min-height: 100vh; position: relative; overflow-x: hidden; background: var(--grad-dark); padding-bottom: 60px; }
.aurora { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
.aurora span { position: absolute; width: 60vmax; height: 60vmax; border-radius: 50%; filter: blur(90px); opacity: .35; animation: drift 18s ease-in-out infinite alternate; }
.aurora span:nth-child(1) { background: #2f7a57; top: -25vmax; right: -15vmax; }
.aurora span:nth-child(2) { background: #c7a27a; bottom: -30vmax; left: -20vmax; animation-delay: -6s; opacity: .22; }
.aurora span:nth-child(3) { background: #6366f1; top: 30%; left: 30%; width: 40vmax; height: 40vmax; animation-delay: -12s; opacity: .14; }
@keyframes drift { to { transform: translate(6vmax, 4vmax) scale(1.1); } }
.bar { position: relative; z-index: 2; display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; max-width: 1100px; margin: 0 auto; }
.brand { display: flex; align-items: center; gap: 10px; color: #fff; font-weight: 700; font-size: 1.2rem; }
.brand small { font-weight: 400; color: rgba(255,255,255,.6); font-size: .82rem; }
.bar-link { color: rgba(255,255,255,.75); font-size: .9rem; }
.bar-link:hover { color: #fff; }
.wrap { position: relative; z-index: 2; max-width: 860px; margin: 0 auto; padding: 0 16px; }
.wrap.wide { max-width: 980px; }
@media (max-width: 640px) { .brand small { display: none; } .bar { padding: 14px 16px; } }
</style>
