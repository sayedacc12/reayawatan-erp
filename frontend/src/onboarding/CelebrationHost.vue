<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import { useRouter } from 'vue-router';
import { nextCelebration, onboarding } from './onboarding';

/** شاشات التهنئة: بطاقة صغيرة عند إنجاز خطوة، واحتفال كامل بقصاصات ملونة عند اكتمال مرحلة أو الإطلاق كله */
const router = useRouter();
const c = computed(() => onboarding.celebration);
const big = computed(() => !!c.value && c.value.kind !== 'step');
const COLORS = ['#a9c9b5', '#d9bc98', '#2f7a57', '#ec4899', '#a78bfa', '#38bdf8', '#fde68a'];
// قصاصات بمواضع وسرعات ثابتة لكل احتفال
const bits = computed(() => Array.from({ length: big.value ? 90 : 26 }, (_, i) => ({
  '--x': `${(i * 37) % 100}%`, '--d': `${(i % 9) * 0.12}s`, '--t': `${2.4 + (i % 7) * 0.35}s`, '--r': `${(i * 47) % 360}deg`,
  '--c': COLORS[i % COLORS.length], '--w': `${6 + (i % 4) * 2}px`, '--s': i % 2 ? '50%' : '2px', '--sway': `${((i % 5) - 2) * 30}px`,
})));
let timer: ReturnType<typeof setTimeout> | undefined;
watch(c, (v) => {
  clearTimeout(timer);
  // تهنئة الخطوة تختفي وحدها
  if (v?.kind === 'step') timer = setTimeout(nextCelebration, 4500);
});
onBeforeUnmount(() => clearTimeout(timer));
function go(to: string) {
  nextCelebration();
  router.push(to);
}
</script>

<template>
  <Transition name="cel">
    <div v-if="c" :key="c.key" :class="['cel', { big }]" :role="big ? 'dialog' : 'status'" :aria-modal="big || undefined" aria-live="polite">
      <div class="confetti" aria-hidden="true"><i v-for="(b, i) in bits" :key="i" :style="b" /></div>
      <div class="cel-card">
        <div class="cel-ic"><span class="burst" />{{ c.icon }}</div>
        <div class="cel-body">
          <h2>{{ c.title }}</h2>
          <p>{{ c.text }}</p>
          <div v-if="big" class="cel-actions">
            <button v-if="c.cta" class="cel-btn gold" @click="go(c.cta.to)">{{ c.cta.label }} ←</button>
            <button :class="['cel-btn', { gold: !c.cta }]" @click="nextCelebration">{{ c.kind === 'all' ? 'شكرًا 🌾' : 'رائع' }}</button>
          </div>
        </div>
        <button v-if="!big" class="cel-x" aria-label="إغلاق" @click="nextCelebration">×</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.cel { position: fixed; z-index: 420; pointer-events: none; }
.cel:not(.big) { bottom: 22px; inset-inline-end: 22px; width: min(380px, calc(100vw - 32px)); }
.cel.big { inset: 0; display: grid; place-items: center; padding: 16px; background: radial-gradient(800px 500px at 50% 40%, rgba(15,59,63,.8), rgba(4,16,22,.88)); pointer-events: auto; }
.confetti { position: fixed; inset: 0; overflow: hidden; pointer-events: none; }
.cel:not(.big) .confetti { position: absolute; inset: -160px -20px 0; }
.confetti i { position: absolute; top: -20px; left: var(--x); width: var(--w); height: calc(var(--w) * 1.6); background: var(--c); border-radius: var(--s); opacity: 0;
  animation: fall var(--t) var(--d) cubic-bezier(.3,.6,.5,1) forwards; }
@keyframes fall { 0% { opacity: 1; transform: translate(0, 0) rotate(0); } 100% { opacity: 0; transform: translate(var(--sway), 105vh) rotate(calc(var(--r) + 540deg)); } }
.cel:not(.big) .confetti i { animation-name: fall-s; }
@keyframes fall-s { 0% { opacity: 1; transform: translate(0, 0) rotate(0); } 100% { opacity: 0; transform: translate(var(--sway), 260px) rotate(var(--r)); } }
.cel-card { position: relative; display: flex; gap: 14px; align-items: center; pointer-events: auto; color: #fff; border-radius: 18px; padding: 14px 16px;
  background: linear-gradient(150deg, #0f3b3f, #06141a); border: 1px solid rgba(94,234,212,.4); box-shadow: 0 20px 50px rgba(0,0,0,.35); }
.big .cel-card { flex-direction: column; text-align: center; padding: 36px 30px 28px; width: min(520px, 100%); border-radius: 28px; animation: pop .6s cubic-bezier(.2,1.4,.4,1) both;
  box-shadow: 0 40px 100px rgba(0,0,0,.5), 0 0 80px rgba(94,234,212,.2); }
@keyframes pop { from { opacity: 0; transform: scale(.7); } }
.cel-ic { position: relative; flex-shrink: 0; width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; font-size: 1.5rem; background: linear-gradient(135deg, rgba(94,234,212,.3), rgba(245,198,107,.3)); }
.big .cel-ic { width: 104px; height: 104px; border-radius: 50%; font-size: 3.2rem; animation: bob 2.4s ease-in-out infinite; }
@keyframes bob { 50% { transform: translateY(-6px) rotate(-4deg); } }
.burst { position: absolute; inset: -14px; border-radius: 50%; background: conic-gradient(from 0deg, transparent, rgba(245,198,107,.6), transparent 30%, rgba(94,234,212,.6), transparent 60%, rgba(245,198,107,.6), transparent 85%);
  filter: blur(6px); animation: spin 6s linear infinite; z-index: -1; opacity: 0; }
.big .burst { opacity: 1; }
@keyframes spin { to { transform: rotate(360deg); } }
.cel-body h2 { margin: 0; font-size: 1.05rem; }
.big .cel-body h2 { font-size: 1.6rem; margin-top: 10px; background: linear-gradient(90deg, #fff, #99f6e4, #d9bc98); -webkit-background-clip: text; background-clip: text; color: transparent; }
.cel-body p { margin: 4px 0 0; color: rgba(255,255,255,.8); font-size: .9rem; line-height: 1.8; }
.big .cel-body p { font-size: 1rem; margin-top: 8px; }
.cel-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 20px; }
.cel-btn { font: inherit; font-weight: 700; border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.1); color: #fff; border-radius: 12px; padding: 10px 20px; cursor: pointer; }
.cel-btn.gold { border: 0; color: #06141a; background: linear-gradient(135deg, #d9bc98, #c7a27a); box-shadow: 0 10px 26px rgba(232,176,75,.4); }
.cel-x { position: absolute; top: 6px; inset-inline-end: 10px; background: none; border: 0; color: rgba(255,255,255,.6); font-size: 1.2rem; cursor: pointer; }
.cel-enter-active, .cel-leave-active { transition: opacity .35s, transform .35s cubic-bezier(.2,.8,.2,1); }
.cel-enter-from, .cel-leave-to { opacity: 0; }
.cel:not(.big).cel-enter-from { transform: translateY(20px); }
@media (prefers-reduced-motion: reduce) { .confetti { display: none; } .cel-card, .cel-ic, .burst { animation: none !important; } }
</style>
