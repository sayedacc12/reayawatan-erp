<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useSession } from '../stores/session';
import { launchView, loadOnboarding, markStep, onboarding, setLaunchHidden, type LaunchStep } from './onboarding';

/** خطوات إطلاق الشركة بالترتيب: مراحل، وفي كل مرحلة خطوات تُكتشف تلقائيًا أو تُعلَّم يدويًا */
const session = useSession();
const v = launchView;
const busy = ref('');
onMounted(() => loadOnboarding());
const portalUrl = computed(() => (session.user?.organizationSlug ? `${location.origin}/portal/${session.user.organizationSlug}` : ''));
const copied = ref(false);
async function copyPortal() {
  try {
    await navigator.clipboard.writeText(portalUrl.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch { /* النسخ غير متاح */ }
}
async function mark(s: LaunchStep, status: 'done' | 'skipped' | null) {
  busy.value = s.key;
  await markStep(s.key, status);
  busy.value = '';
}
const C = 2 * Math.PI * 52;
</script>

<template>
  <div class="lv">
    <section class="lv-hero">
      <div class="lv-ring">
        <svg viewBox="0 0 120 120" width="132" height="132" aria-hidden="true">
          <defs><linearGradient id="lv-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a9c9b5" /><stop offset="1" stop-color="#d9bc98" /></linearGradient></defs>
          <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="10" />
          <circle cx="60" cy="60" r="52" fill="none" stroke="url(#lv-g)" stroke-width="10" stroke-linecap="round" :stroke-dasharray="C" :stroke-dashoffset="C * (1 - (v?.pct ?? 0) / 100)" transform="rotate(-90 60 60)" class="arc" />
        </svg>
        <b>{{ v?.pct ?? 0 }}%</b>
      </div>
      <div>
        <p class="kicker">🚀 خطوات الإطلاق</p>
        <h1>جهّز {{ session.user?.organizationName }} للانطلاق</h1>
        <p class="sub">اتبع المراحل بالترتيب. كل خطوة تفتح لك الشاشة المطلوبة، ونعلّمها تلقائيًا عند إنجازها. ويمكنك تعليمها «تمت» بنفسك أو تخطيها إن لم تحتجها.</p>
        <div class="hero-actions">
          <RouterLink v-if="v?.next" :to="v.next.link" class="h-btn gold">التالي: {{ v.next.title }} ←</RouterLink>
          <button v-if="onboarding.state?.launchHidden" class="h-btn" @click="setLaunchHidden(false)">أظهر البطاقة في لوحتي</button>
        </div>
      </div>
    </section>

    <div v-if="!v" class="card empty">لا توجد خطوات إطلاق لحسابك. خطوات الإطلاق تظهر لمدير نظام الشركة.</div>

    <ol v-else class="lv-phases">
      <li v-for="(p, pi) in v.phases" :key="p.key" :class="['ph', { ok: p.complete, cur: v.next?.phase === p.key }]" :style="{ '--i': pi }">
        <div class="ph-head">
          <span class="ph-ic">{{ p.complete ? '✓' : p.icon }}</span>
          <div class="ph-tx">
            <small>المرحلة {{ pi + 1 }}</small>
            <h2>{{ p.title }}</h2>
            <span class="muted">{{ p.hint }}</span>
          </div>
          <span class="ph-count">{{ p.done }} من {{ p.steps.length }}</span>
        </div>
        <ul class="steps">
          <li v-for="s in p.steps" :key="s.key" :class="['st', { done: s.done, skipped: s.skipped, next: v.next?.key === s.key }]">
            <span class="st-check" aria-hidden="true">{{ s.done ? '✓' : s.skipped ? '–' : '' }}</span>
            <div class="st-tx">
              <b>{{ s.title }}</b>
              <span class="muted">{{ s.hint }}</span>
              <div v-if="s.key === 'portal' && portalUrl" class="portal">
                <code dir="ltr">{{ portalUrl }}</code>
                <button class="btn btn-sm" @click="copyPortal">{{ copied ? 'نُسخ ✓' : 'نسخ الرابط' }}</button>
              </div>
              <small v-if="s.done && s.auto" class="tag ok">أُنجزت تلقائيًا</small>
              <small v-else-if="s.done" class="tag ok">علّمتها «تمت»</small>
              <small v-else-if="s.skipped" class="tag">تخطيتها</small>
            </div>
            <div class="st-actions">
              <RouterLink v-if="!s.done" :to="s.link" :class="['btn btn-sm', { 'btn-primary': v.next?.key === s.key }]">افتح الشاشة</RouterLink>
              <button v-if="!s.done && !s.skipped" class="btn btn-sm" :disabled="busy === s.key" @click="mark(s, 'done')">تمت</button>
              <button v-if="!s.done && !s.skipped" class="btn btn-sm" :disabled="busy === s.key" @click="mark(s, 'skipped')">تخطَّ</button>
              <button v-if="(s.done && !s.auto) || s.skipped" class="btn btn-sm" :disabled="busy === s.key" @click="mark(s, null)">تراجع</button>
            </div>
          </li>
        </ul>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.lv-hero { position: relative; overflow: hidden; display: flex; gap: 24px; align-items: center; padding: 26px 28px; border-radius: 22px; color: #fff; margin-bottom: 22px;
  background: var(--grad-dark); box-shadow: 0 16px 40px rgba(6,20,26,.18); }
.lv-hero::before { content: ''; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(500px 220px at 90% 0%, rgba(245,198,107,.28), transparent 70%), radial-gradient(460px 220px at 0% 120%, rgba(45,212,191,.35), transparent 70%); animation: breathe 8s ease-in-out infinite; }
@keyframes breathe { 50% { opacity: .6; } }
.lv-hero > * { position: relative; }
.lv-ring { position: relative; width: 132px; height: 132px; flex-shrink: 0; display: grid; place-items: center; }
.lv-ring svg { position: absolute; inset: 0; }
.lv-ring b { font-size: 1.7rem; }
.arc { transition: stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1); filter: drop-shadow(0 0 8px rgba(94,234,212,.6)); }
.kicker { margin: 0; color: #a9c9b5; font-weight: 600; }
.lv-hero h1 { margin: 4px 0 6px; font-size: 1.5rem; }
.sub { margin: 0; color: rgba(255,255,255,.75); max-width: 640px; line-height: 1.8; }
.hero-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.h-btn { font: inherit; font-weight: 700; padding: 9px 18px; border-radius: 12px; color: #fff; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.22); cursor: pointer; }
.h-btn.gold { color: #06141a; border: 0; background: linear-gradient(135deg, #d9bc98, #c7a27a); box-shadow: 0 8px 22px rgba(232,176,75,.4); }
.lv-phases { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; position: relative; }
.ph { position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 16px 18px; box-shadow: var(--shadow); animation: rise .5s calc(var(--i) * 80ms) var(--ease) both; }
@keyframes rise { from { opacity: 0; transform: translateY(14px); } }
.ph.cur { border-color: color-mix(in srgb, #c7a27a 60%, var(--border)); box-shadow: 0 10px 30px rgba(232,176,75,.15); }
.ph.ok { border-color: color-mix(in srgb, var(--primary) 40%, var(--border)); }
.ph-head { display: flex; gap: 12px; align-items: center; }
.ph-ic { width: 46px; height: 46px; flex-shrink: 0; border-radius: 14px; display: grid; place-items: center; font-size: 1.35rem; background: var(--surface-2); border: 1px solid var(--border); }
.ph.ok .ph-ic { background: var(--primary); color: #fff; border: 0; font-weight: 800; }
.ph.cur .ph-ic { background: linear-gradient(135deg, #fde68a, #d9bc98); border: 0; }
.ph-tx { flex: 1; }
.ph-tx small { color: var(--muted); font-weight: 600; }
.ph-tx h2 { margin: 0; font-size: 1.1rem; }
.ph-count { font-weight: 700; color: var(--muted); background: var(--surface-2); border-radius: 999px; padding: 2px 12px; }
.steps { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; }
.st { display: grid; grid-template-columns: 28px 1fr auto; gap: 12px; align-items: start; padding: 12px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface-2); transition: border-color .2s, background .2s; }
.st.next { border-color: #c7a27a; background: color-mix(in srgb, #fde68a 18%, var(--surface)); }
.st.done { background: color-mix(in srgb, var(--primary) 6%, var(--surface)); }
.st.done b { color: var(--primary); }
.st.skipped { opacity: .7; }
.st-check { width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--border); display: grid; place-items: center; font-weight: 800; background: var(--surface); margin-top: 2px; }
.st.done .st-check { background: var(--primary); border-color: var(--primary); color: #fff; animation: tick .4s var(--ease); }
.st.next .st-check { border-color: #c7a27a; box-shadow: 0 0 0 4px rgba(232,176,75,.2); }
@keyframes tick { from { transform: scale(.4); } }
.st-tx { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.st-tx .muted { font-size: .88rem; }
.tag { align-self: flex-start; font-size: .75rem; padding: 1px 9px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); }
.tag.ok { color: var(--primary); border-color: color-mix(in srgb, var(--primary) 40%, var(--border)); }
.portal { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 4px; }
.portal code { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 3px 8px; font-size: .82rem; overflow-wrap: anywhere; }
.st-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.empty { padding: 30px; text-align: center; color: var(--muted); }
@media (max-width: 760px) {
  .lv-hero { flex-direction: column; text-align: center; padding: 22px 18px; }
  .hero-actions { justify-content: center; }
  .st { grid-template-columns: 28px 1fr; }
  .st-actions { grid-column: 1 / -1; justify-content: flex-start; }
}
</style>
