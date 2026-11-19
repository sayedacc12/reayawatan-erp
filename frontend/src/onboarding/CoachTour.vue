<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * الجولة الإرشادية: تبرز عناصر الواجهة واحدًا تلو الآخر بإطار مضيء وسهم يشير إليها،
 * مع بطاقة شرح قصيرة. العنصر يُحدَّد بخاصية data-tour، والخطوة التي لا يظهر عنصرها تُتخطى.
 */
export interface TourStep { target: string; title: string; text: string; icon?: string }
const props = defineProps<{ steps: TourStep[] }>();
const emit = defineEmits<{ done: [finished: boolean] }>();

const idx = ref(0);
const rect = ref<{ top: number; left: number; width: number; height: number } | null>(null);
const bubble = ref<HTMLElement | null>(null);
const pos = ref<{ top: number; left: number; place: 'below' | 'above' | 'center' | 'start' | 'end'; arrow: number }>({ top: 0, left: 0, place: 'center', arrow: 0 });

const live = ref<TourStep[]>([]);
const present = () => props.steps.filter((s) => document.querySelector(`[data-tour="${s.target}"]`));
const step = computed(() => live.value[idx.value]);
const PAD = 8;

function el() {
  if (!step.value) return null;
  // قد يتكرر العنصر (مثل نسخة الجوال)؛ نختار الظاهر منه
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${step.value.target}"]`));
  return all.find((e) => e.offsetParent !== null || e.getClientRects().length) ?? null;
}

async function measure(scroll = false) {
  const e = el();
  if (!e) {
    rect.value = null;
    return;
  }
  if (scroll) {
    e.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await new Promise((r) => setTimeout(r, 380));
  }
  const r = e.getBoundingClientRect();
  rect.value = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
  await nextTick();
  place();
}

function place() {
  const r = rect.value;
  const b = bubble.value;
  if (!r || !b) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const bw = b.offsetWidth;
  const bh = b.offsetHeight;
  const gap = 18;
  const below = r.top + r.height + gap + bh < vh - 8;
  const above = r.top - gap - bh > 8;
  const cx = r.left + r.width / 2;
  // عنصر طويل (مثل قائمة الأنظمة): البطاقة بجانبه والسهم يشير إليه أفقيًا
  if (r.height > vh * 0.45 && (r.left - gap - bw > 8 || r.left + r.width + gap + bw < vw - 8)) {
    const top = Math.max(12, Math.min(vh - bh - 12, Math.max(r.top, 0) + 60));
    if (r.left - gap - bw > 8) pos.value = { top, left: r.left - gap - bw, place: 'end', arrow: 34 };
    else pos.value = { top, left: r.left + r.width + gap, place: 'start', arrow: 34 };
    return;
  }
  const left = Math.max(12, Math.min(vw - bw - 12, cx - bw / 2));
  if (below || !above) {
    const top = below ? r.top + r.height + gap : Math.max(12, vh - bh - 12);
    pos.value = { top, left, place: below ? 'below' : 'center', arrow: cx - left };
  } else {
    pos.value = { top: r.top - gap - bh, left, place: 'above', arrow: cx - left };
  }
}

function go(n: number) {
  if (n >= live.value.length) {
    emit('done', true);
    return;
  }
  idx.value = Math.max(0, n);
  measure(true);
}
function key(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('done', false);
  else if (e.key === 'ArrowLeft' || e.key === 'Enter') go(idx.value + 1);
  else if (e.key === 'ArrowRight') go(idx.value - 1);
}
const onResize = () => measure();
onMounted(() => {
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onResize, true);
  window.addEventListener('keydown', key);
  // ننتظر قليلًا حتى ترسم اللوحة عناصرها
  setTimeout(() => {
    live.value = present();
    if (live.value.length) measure(true);
    else emit('done', true);
  }, 350);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  window.removeEventListener('scroll', onResize, true);
  window.removeEventListener('keydown', key);
});
const holeStyle = computed(() => (rect.value
  ? { top: `${rect.value.top}px`, left: `${rect.value.left}px`, width: `${rect.value.width}px`, height: `${rect.value.height}px` }
  : { top: '50%', left: '50%', width: '0px', height: '0px' }));
</script>

<template>
  <div class="ct" role="dialog" aria-modal="true" :aria-label="step?.title">
    <div class="ct-hole" :style="holeStyle"><i class="pulse" /></div>
    <div v-if="step" ref="bubble" :key="idx" :class="['ct-bubble', pos.place]" :style="{ top: `${pos.top}px`, left: `${pos.left}px`, '--arrow': `${pos.arrow}px` }">
      <div class="ct-head">
        <span class="ct-ic" aria-hidden="true">{{ step.icon ?? '✨' }}</span>
        <div>
          <small>الخطوة {{ idx + 1 }} من {{ live.length }}</small>
          <h3>{{ step.title }}</h3>
        </div>
      </div>
      <p>{{ step.text }}</p>
      <div class="ct-bar"><i :style="{ width: `${((idx + 1) / live.length) * 100}%` }" /></div>
      <div class="ct-actions">
        <button class="ct-link" @click="emit('done', false)">إنهاء الجولة</button>
        <span class="sp" />
        <button v-if="idx > 0" class="ct-btn ghost" @click="go(idx - 1)">السابق</button>
        <button class="ct-btn" @click="go(idx + 1)">{{ idx + 1 === live.length ? 'تم، لنبدأ!' : 'التالي ←' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ct { position: fixed; inset: 0; z-index: 390; }
/* الظل الكبير حول الإطار يعتم بقية الشاشة ويترك العنصر المقصود مضيئًا */
.ct-hole { position: fixed; border-radius: 14px; box-shadow: 0 0 0 9999px rgba(4, 16, 22, .72), 0 0 0 2px #5eead4, 0 0 30px 6px rgba(94,234,212,.55);
  transition: top .45s cubic-bezier(.2,.8,.2,1), left .45s cubic-bezier(.2,.8,.2,1), width .45s cubic-bezier(.2,.8,.2,1), height .45s cubic-bezier(.2,.8,.2,1); pointer-events: none; }
.ct-hole .pulse { position: absolute; inset: -2px; border-radius: inherit; border: 2px solid #f5c66b; animation: ct-pulse 1.8s ease-out infinite; }
@keyframes ct-pulse { from { opacity: .9; transform: scale(1); } to { opacity: 0; transform: scale(1.18); } }
.ct-bubble { position: fixed; width: min(360px, calc(100vw - 24px)); background: linear-gradient(160deg, #0b2a2e, #06141a); color: #fff; border-radius: 18px; padding: 16px 18px 14px;
  border: 1px solid rgba(94,234,212,.35); box-shadow: 0 24px 60px rgba(0,0,0,.45); animation: ct-in .4s cubic-bezier(.2,.8,.2,1) both; }
@keyframes ct-in { from { opacity: 0; transform: translateY(10px) scale(.96); } }
.ct-bubble.above { animation-name: ct-in-up; }
@keyframes ct-in-up { from { opacity: 0; transform: translateY(-10px) scale(.96); } }
/* السهم يشير إلى منتصف العنصر المضيء */
.ct-bubble::before { content: ''; position: absolute; width: 16px; height: 16px; background: #0b2a2e; border: 1px solid rgba(94,234,212,.35); left: calc(var(--arrow) - 8px); transform: rotate(45deg); }
.ct-bubble.below::before { top: -9px; border-bottom: 0; border-right: 0; }
.ct-bubble.above::before { bottom: -9px; border-top: 0; border-left: 0; background: #06141a; }
.ct-bubble.center::before { display: none; }
.ct-bubble.end::before, .ct-bubble.start::before { left: auto; top: calc(var(--arrow) - 8px); }
.ct-bubble.end::before { right: -9px; border-left: 0; border-bottom: 0; }
.ct-bubble.start::before { left: -9px; border-right: 0; border-top: 0; }
.ct-head { display: flex; gap: 12px; align-items: center; }
.ct-ic { width: 42px; height: 42px; flex-shrink: 0; border-radius: 12px; display: grid; place-items: center; font-size: 1.3rem; background: linear-gradient(135deg, rgba(94,234,212,.25), rgba(245,198,107,.25)); }
.ct-head small { color: #5eead4; font-weight: 600; }
.ct-head h3 { margin: 2px 0 0; font-size: 1.08rem; }
.ct-bubble p { margin: 10px 0 12px; color: rgba(255,255,255,.82); line-height: 1.8; font-size: .94rem; }
.ct-bar { height: 4px; border-radius: 4px; background: rgba(255,255,255,.12); overflow: hidden; margin-bottom: 12px; }
.ct-bar i { display: block; height: 100%; background: linear-gradient(90deg, #5eead4, #f5c66b); transition: width .4s; }
.ct-actions { display: flex; align-items: center; gap: 8px; }
.ct-actions .sp { flex: 1; }
.ct-link { background: none; border: 0; color: rgba(255,255,255,.55); font: inherit; font-size: .85rem; cursor: pointer; padding: 0; }
.ct-link:hover { color: #fff; }
.ct-btn { font: inherit; font-weight: 700; border: 0; border-radius: 10px; padding: 8px 16px; cursor: pointer; color: #06141a; background: #5eead4; }
.ct-btn.ghost { background: rgba(255,255,255,.1); color: #fff; }
@media (prefers-reduced-motion: reduce) { .ct-hole, .ct-hole .pulse, .ct-bubble { transition: none; animation: none; } }
</style>
