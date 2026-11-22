<script setup lang="ts">
import { computed } from 'vue';
import { launchView, onboarding, setLaunchHidden } from './onboarding';

/** بطاقة خطوات الإطلاق في لوحة مدير النظام: التقدم والخطوة التالية */
const v = launchView;
const show = computed(() => !!v.value && !v.value.complete && !onboarding.state?.launchHidden);
const C = 2 * Math.PI * 34;
</script>

<template>
  <section v-if="show && v" class="lc" data-tour="launch">
    <div class="lc-ring" :aria-label="`أنجزت ${v.pct}% من خطوات الإطلاق`">
      <svg viewBox="0 0 80 80" width="84" height="84" aria-hidden="true">
        <defs><linearGradient id="lc-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a9c9b5" /><stop offset="1" stop-color="#d9bc98" /></linearGradient></defs>
        <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="7" />
        <circle cx="40" cy="40" r="34" fill="none" stroke="url(#lc-g)" stroke-width="7" stroke-linecap="round" :stroke-dasharray="C" :stroke-dashoffset="C * (1 - v.pct / 100)" transform="rotate(-90 40 40)" class="arc" />
      </svg>
      <b>{{ v.pct }}%</b>
    </div>
    <div class="lc-body">
      <p class="lc-kicker">🚀 خطوات إطلاق الشركة · {{ v.done }} من {{ v.total }}</p>
      <h2 v-if="v.next">الخطوة التالية: {{ v.next.title }}</h2>
      <p v-if="v.next" class="lc-hint">{{ v.next.hint }}</p>
      <div class="lc-phases">
        <span v-for="p in v.phases" :key="p.key" :class="{ ok: p.complete, cur: v.next?.phase === p.key }" :title="`${p.title}: ${p.done} من ${p.steps.length}`">{{ p.complete ? '✓' : p.icon }} {{ p.title }}</span>
      </div>
    </div>
    <div class="lc-actions">
      <RouterLink v-if="v.next" :to="v.next.link" class="lc-btn gold">ابدأ الخطوة ←</RouterLink>
      <RouterLink to="/launch" class="lc-btn">كل الخطوات</RouterLink>
      <button class="lc-hide" title="يمكنك فتحها لاحقًا من زر الدليل" @click="setLaunchHidden(true)">إخفاء</button>
    </div>
  </section>
</template>

<style scoped>
.lc { position: relative; overflow: hidden; display: grid; grid-template-columns: auto 1fr auto; gap: 18px; align-items: center; padding: 18px 20px; margin-bottom: 18px; border-radius: 20px; color: #fff;
  background: linear-gradient(120deg, #06141a, #10291e 55%, #133a3a); border: 1px solid rgba(94,234,212,.25); box-shadow: 0 16px 40px rgba(6,20,26,.2); animation: lc-in .5s cubic-bezier(.2,.8,.2,1) both; }
.lc::before { content: ''; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(400px 160px at 85% 0%, rgba(245,198,107,.22), transparent 70%), radial-gradient(360px 160px at 10% 120%, rgba(94,234,212,.25), transparent 70%); }
.lc > * { position: relative; }
@keyframes lc-in { from { opacity: 0; transform: translateY(12px); } }
.lc-ring { position: relative; width: 84px; height: 84px; display: grid; place-items: center; }
.lc-ring svg { position: absolute; inset: 0; }
.lc-ring b { font-size: 1.15rem; }
.arc { transition: stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1); filter: drop-shadow(0 0 6px rgba(94,234,212,.6)); }
.lc-kicker { margin: 0; color: #a9c9b5; font-weight: 600; font-size: .85rem; }
.lc h2 { margin: 4px 0 2px; font-size: 1.15rem; }
.lc-hint { margin: 0; color: rgba(255,255,255,.72); font-size: .9rem; }
.lc-phases { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.lc-phases span { font-size: .78rem; padding: 2px 10px; border-radius: 999px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); color: rgba(255,255,255,.7); }
.lc-phases span.ok { background: rgba(94,234,212,.16); border-color: rgba(94,234,212,.45); color: #99f6e4; }
.lc-phases span.cur { border-color: #d9bc98; color: #fde68a; box-shadow: 0 0 12px rgba(245,198,107,.3); }
.lc-actions { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
.lc-btn { text-align: center; font-weight: 700; padding: 8px 16px; border-radius: 11px; color: #fff; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.2); white-space: nowrap; }
.lc-btn.gold { color: #06141a; border: 0; background: linear-gradient(135deg, #d9bc98, #c7a27a); box-shadow: 0 8px 20px rgba(232,176,75,.35); }
.lc-hide { background: none; border: 0; color: rgba(255,255,255,.5); font: inherit; font-size: .8rem; cursor: pointer; }
.lc-hide:hover { color: #fff; }
@media (max-width: 760px) {
  .lc { grid-template-columns: auto 1fr; }
  .lc-actions { grid-column: 1 / -1; flex-direction: row; flex-wrap: wrap; }
  .lc-btn { flex: 1; }
}
</style>
