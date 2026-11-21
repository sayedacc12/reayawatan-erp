<script setup lang="ts">
/** إجراء الترحيل والإغلاق الموحد: ترحيل المستندات ← إغلاق الشهور ← محضر جرد السندات ← إغلاق السنة */
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const steps = [
  { n: 1, label: 'ترحيل القيود', hint: 'رحّل القيود وتابع السندات غير المعتمدة', to: '/accounting/posting' },
  { n: 2, label: 'إغلاق الشهور', hint: 'بالتسلسل، بعد ترحيل كل المستندات', to: '/accounting/periods' },
  { n: 3, label: 'محاضر جرد السندات', hint: 'يعتمده مدير النظام بنفسه', to: '/accounting/inventory' },
  { n: 4, label: 'إغلاق السنة', hint: 'بعد إغلاق الشهور واعتماد المحضر', to: '/accounting/periods#year' },
];
const active = computed(() => (route.path === '/accounting/periods' && route.hash === '#year' ? 4 : steps.find((s) => s.to === route.path)?.n ?? 0));
</script>

<template>
  <nav class="cflow no-print" aria-label="إجراء الترحيل والإغلاق">
    <RouterLink v-for="s in steps" :key="s.n" :to="s.to" :class="['cstep', { on: active === s.n, past: active > s.n }]">
      <span class="num">{{ active > s.n ? '✓' : s.n }}</span>
      <span class="txt"><b>{{ s.label }}</b><small>{{ s.hint }}</small></span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.cflow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
.cstep { position: relative; display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-radius: 16px; background: var(--surface); border: 1px solid var(--border);
  color: inherit; text-decoration: none; transition: transform .2s, box-shadow .2s, border-color .2s; }
.cstep:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(15, 118, 110, .12); }
.cstep .num { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; background: var(--surface-2); color: var(--muted); }
.cstep .txt { display: flex; flex-direction: column; min-width: 0; }
.cstep small { color: var(--muted); font-size: .75rem; }
.cstep.past .num { background: #d1fae5; color: #047857; }
.cstep.on { border-color: transparent; background: linear-gradient(135deg, #164e38, #134e4a); color: #fff; box-shadow: 0 10px 26px rgba(15, 118, 110, .3); }
.cstep.on small { color: rgba(255, 255, 255, .75); }
.cstep.on .num { background: #fbbf24; color: #3b2a00; animation: glow 2s ease-in-out infinite; }
@keyframes glow { 50% { box-shadow: 0 0 0 6px rgba(251, 191, 36, .25); } }
@media (max-width: 900px) { .cflow { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
