<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import AppIcon from '../components/AppIcon.vue';
import BrandMark from '../components/BrandMark.vue';
import { useSession } from '../stores/session';
import { launchView } from './onboarding';

/** شاشة الترحيب: ثلاث شرائح قصيرة تعرّف المستخدم الجديد بسنابل ومن أين يبدأ */
const emit = defineEmits<{ tour: []; later: [] }>();
const session = useSession();
const slide = ref(0);
const first = computed(() => session.user?.fullName.split(' ')[0] ?? '');
const isAdmin = computed(() => !!session.user?.isSuperadmin);
const apps = computed(() => session.apps.slice(0, 10));
const COLORS = ['#14b8a6', '#6366f1', '#f59e0b', '#ec4899', '#0ea5e9', '#22c55e', '#a855f7', '#ef4444', '#06b6d4', '#84cc16'];
const total = 3;

function go(n: number) {
  slide.value = Math.max(0, Math.min(total - 1, n));
}
function key(e: KeyboardEvent) {
  // الواجهة من اليمين لليسار: السهم الأيسر للتالي
  if (e.key === 'ArrowLeft') go(slide.value + 1);
  else if (e.key === 'ArrowRight') go(slide.value - 1);
  else if (e.key === 'Escape') emit('later');
}
onMounted(() => window.addEventListener('keydown', key));
onBeforeUnmount(() => window.removeEventListener('keydown', key));
const orbit = (i: number, n: number) => {
  const a = (i / n) * Math.PI * 2 - Math.PI / 2;
  return { '--x': `${Math.cos(a) * 150}px`, '--y': `${Math.sin(a) * 150}px`, '--c': COLORS[i % COLORS.length], '--i': i };
};
</script>

<template>
  <div class="wl" role="dialog" aria-modal="true" aria-labelledby="wl-title">
    <div class="wl-bg" aria-hidden="true"><i v-for="n in 18" :key="n" :style="{ '--n': n }" /></div>
    <div class="wl-card">
      <button class="wl-skip" @click="emit('later')">تخطَّ</button>
      <Transition name="wl-slide" mode="out-in">
        <section v-if="slide === 0" key="0" class="wl-slide">
          <div class="wl-logo"><span class="ring" /><span class="ring r2" /><BrandMark :size="92" /></div>
          <p class="wl-kicker">{{ session.user?.organizationName }}</p>
          <h1 id="wl-title">أهلًا بك في سنابل، {{ first }} 🌾</h1>
          <p class="wl-text">سعداء بانضمامك. سنابل منصة واحدة تجمع كل أعمال جمعيتك: المساعدات الاجتماعية، والمالية، والموارد البشرية، والجودة، وغيرها، في مكان واحد وبياناتها مترابطة.</p>
          <p class="wl-text dim">سنأخذك في جولة قصيرة لا تتجاوز دقيقة واحدة.</p>
        </section>
        <section v-else-if="slide === 1" key="1" class="wl-slide">
          <div class="wl-orbit" aria-hidden="true">
            <span class="core"><BrandMark :size="56" /></span>
            <span v-for="(a, i) in apps" :key="a.code" class="sat" :style="orbit(i, apps.length)"><AppIcon :name="a.icon" :size="20" /></span>
          </div>
          <h1>كل أنظمتك في مكان واحد</h1>
          <p class="wl-text">لك {{ session.apps.length }} {{ session.apps.length > 10 ? 'نظامًا' : 'أنظمة' }} في سنابل حسب صلاحياتك. تجدها دائمًا في جانب لوحتك، وتنتقل بينها بضغطة واحدة.</p>
          <div class="wl-chips"><span v-for="(a, i) in apps" :key="a.code" :style="{ '--c': COLORS[i % COLORS.length], '--i': i }">{{ a.name }}</span></div>
        </section>
        <section v-else key="2" class="wl-slide">
          <div class="wl-big" aria-hidden="true">🧭</div>
          <h1>من أين تبدأ؟</h1>
          <template v-if="isAdmin && launchView">
            <p class="wl-text">جهزنا لك <b>خطوات الإطلاق</b> مرتبة في {{ launchView.phases.length }} مراحل. اتبعها بالترتيب، وكل خطوة تُعلَّم تلقائيًا عند إنجازها.</p>
            <ol class="wl-phases">
              <li v-for="(p, i) in launchView.phases" :key="p.key" :style="{ '--i': i }"><span>{{ p.icon }}</span><b>{{ p.title }}</b><small>{{ p.hint }}</small></li>
            </ol>
          </template>
          <template v-else>
            <p class="wl-text">ابدأ كل يوم من <b>لوحتك</b>: ترى فيها ما ينتظرك من مهام، وبياناتك الوظيفية، والأنظمة المصرح لك بها.</p>
            <ol class="wl-phases">
              <li style="--i: 0"><span>🏠</span><b>لوحتي</b><small>نقطة البداية كل يوم</small></li>
              <li style="--i: 1"><span>🔔</span><b>جرس المهام</b><small>ما ينتظر قرارك في كل الأنظمة</small></li>
              <li style="--i: 2"><span>🧩</span><b>الأنظمة</b><small>في جانب اللوحة حسب صلاحياتك</small></li>
            </ol>
          </template>
        </section>
      </Transition>

      <footer class="wl-foot">
        <div class="wl-dots" role="tablist" aria-label="الشرائح">
          <button v-for="n in total" :key="n" role="tab" :aria-selected="slide === n - 1" :aria-label="`الشريحة ${n}`" :class="{ on: slide === n - 1 }" @click="go(n - 1)" />
        </div>
        <div class="wl-actions">
          <button v-if="slide > 0" class="wl-btn ghost" @click="go(slide - 1)">السابق</button>
          <button v-if="slide < total - 1" class="wl-btn" @click="go(slide + 1)">التالي ←</button>
          <template v-else>
            <button class="wl-btn ghost" @click="emit('later')">لاحقًا</button>
            <button class="wl-btn gold" @click="emit('tour')">ابدأ الجولة التعريفية ✨</button>
          </template>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.wl { position: fixed; inset: 0; z-index: 400; display: grid; place-items: center; padding: 16px; background: radial-gradient(1200px 700px at 70% 10%, #0f3b3f, #06141a 60%); color: #fff; overflow: auto; animation: wl-fade .5s ease both; }
@keyframes wl-fade { from { opacity: 0; } }
.wl-bg { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
.wl-bg i { position: absolute; width: 6px; height: 6px; border-radius: 50%; background: #5eead4; opacity: 0; box-shadow: 0 0 14px #5eead4;
  left: calc(var(--n) * 5.4%); bottom: -10px; animation: wl-float calc(9s + var(--n) * .37s) calc(var(--n) * -.8s) linear infinite; }
.wl-bg i:nth-child(3n) { background: #f5c66b; box-shadow: 0 0 14px #f5c66b; width: 4px; height: 4px; }
@keyframes wl-float { 0% { transform: translateY(0); opacity: 0; } 15% { opacity: .8; } 100% { transform: translateY(-110vh) translateX(40px); opacity: 0; } }
.wl-card { position: relative; width: min(680px, 100%); border-radius: 28px; padding: 40px 36px 26px; text-align: center;
  background: linear-gradient(160deg, rgba(255,255,255,.09), rgba(255,255,255,.03)); border: 1px solid rgba(255,255,255,.14);
  box-shadow: 0 40px 100px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.12); backdrop-filter: blur(18px); animation: wl-rise .7s cubic-bezier(.2,.8,.2,1) both; }
@keyframes wl-rise { from { opacity: 0; transform: translateY(30px) scale(.97); } }
.wl-skip { position: absolute; top: 16px; inset-inline-start: 18px; background: none; border: 0; color: rgba(255,255,255,.6); font: inherit; cursor: pointer; }
.wl-skip:hover { color: #fff; }
.wl-slide { min-height: 330px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; }
.wl-slide h1 { font-size: 1.7rem; margin: 6px 0 0; background: linear-gradient(90deg, #fff, #99f6e4 50%, #f5c66b); -webkit-background-clip: text; background-clip: text; color: transparent; }
.wl-kicker { margin: 0; color: #5eead4; font-weight: 600; }
.wl-text { margin: 0; max-width: 520px; color: rgba(255,255,255,.82); line-height: 1.9; }
.wl-text.dim { color: rgba(255,255,255,.55); font-size: .92rem; }
.wl-text b { color: #f5c66b; }
.wl-logo { position: relative; width: 140px; height: 140px; display: grid; place-items: center; margin-bottom: 8px; }
.wl-logo :deep(svg) { filter: drop-shadow(0 0 22px rgba(94,234,212,.55)); animation: wl-breathe 4s ease-in-out infinite; }
@keyframes wl-breathe { 50% { transform: scale(1.06); } }
.ring { position: absolute; inset: 0; border-radius: 50%; border: 1.5px solid rgba(94,234,212,.5); animation: wl-ring 3s ease-out infinite; }
.ring.r2 { animation-delay: 1.5s; border-color: rgba(245,198,107,.5); }
@keyframes wl-ring { from { transform: scale(.6); opacity: 1; } to { transform: scale(1.35); opacity: 0; } }
.wl-orbit { position: relative; width: 340px; height: 340px; max-width: 100%; margin: -20px 0 -14px; animation: wl-spin 40s linear infinite; }
.wl-orbit .core { position: absolute; inset: 0; display: grid; place-items: center; }
.wl-orbit .sat { position: absolute; top: 50%; left: 50%; width: 46px; height: 46px; margin: -23px; border-radius: 14px; display: grid; place-items: center; color: #fff;
  background: linear-gradient(135deg, var(--c), color-mix(in srgb, var(--c) 60%, #000)); box-shadow: 0 0 22px color-mix(in srgb, var(--c) 60%, transparent);
  transform: translate(var(--x), var(--y)); animation: wl-pop .5s calc(var(--i) * 80ms) cubic-bezier(.2,.8,.2,1) both; }
.wl-orbit .sat :deep(svg) { animation: wl-spin 40s linear infinite reverse; }
@keyframes wl-spin { to { transform: rotate(360deg); } }
@keyframes wl-pop { from { opacity: 0; transform: translate(0, 0) scale(.3); } }
.wl-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; max-width: 560px; }
.wl-chips span { padding: 3px 12px; border-radius: 999px; font-size: .82rem; border: 1px solid color-mix(in srgb, var(--c) 60%, transparent); background: color-mix(in srgb, var(--c) 18%, transparent);
  animation: wl-pop2 .4s calc(var(--i) * 50ms + 200ms) both; }
@keyframes wl-pop2 { from { opacity: 0; transform: translateY(8px); } }
.wl-big { font-size: 3.6rem; animation: wl-breathe 3s ease-in-out infinite; }
.wl-phases { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 8px; width: min(460px, 100%); text-align: start; counter-reset: ph; }
.wl-phases li { counter-increment: ph; display: grid; grid-template-columns: 36px 1fr; column-gap: 10px; align-items: center; padding: 9px 12px; border-radius: 14px;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); animation: wl-pop2 .45s calc(var(--i) * 90ms + 150ms) both; }
.wl-phases li span { grid-row: span 2; width: 36px; height: 36px; display: grid; place-items: center; border-radius: 10px; background: rgba(94,234,212,.14); font-size: 1.1rem; }
.wl-phases li b::before { content: counter(ph) '. '; color: #f5c66b; }
.wl-phases li small { color: rgba(255,255,255,.6); }
.wl-foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 20px; flex-wrap: wrap; }
.wl-dots { display: flex; gap: 6px; }
.wl-dots button { width: 9px; height: 9px; border-radius: 99px; border: 0; padding: 0; background: rgba(255,255,255,.25); cursor: pointer; transition: width .3s, background .3s; }
.wl-dots button.on { width: 28px; background: linear-gradient(90deg, #5eead4, #f5c66b); }
.wl-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.wl-btn { font: inherit; font-weight: 700; border: 0; border-radius: 12px; padding: 10px 20px; cursor: pointer; color: #06141a; background: #5eead4; transition: transform .15s, box-shadow .2s; }
.wl-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(94,234,212,.35); }
.wl-btn.ghost { background: rgba(255,255,255,.1); color: #fff; border: 1px solid rgba(255,255,255,.2); }
.wl-btn.gold { background: linear-gradient(135deg, #f5c66b, #e8b04b); box-shadow: 0 10px 26px rgba(232,176,75,.4); animation: wl-glow 2s ease-in-out infinite; }
@keyframes wl-glow { 50% { box-shadow: 0 10px 34px rgba(232,176,75,.7); } }
.wl-slide-enter-active, .wl-slide-leave-active { transition: opacity .3s, transform .35s cubic-bezier(.2,.8,.2,1); }
.wl-slide-enter-from { opacity: 0; transform: translateX(-30px); }
.wl-slide-leave-to { opacity: 0; transform: translateX(30px); }
@media (max-width: 560px) {
  .wl-card { padding: 34px 18px 20px; }
  .wl-slide h1 { font-size: 1.35rem; }
  .wl-orbit { zoom: .8; }
  .wl-foot { justify-content: center; }
}
@media (prefers-reduced-motion: reduce) { .wl *, .wl *::before { animation: none !important; } }
</style>
