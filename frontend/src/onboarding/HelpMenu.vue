<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from '../stores/session';
import { launchView, onboarding, replayWelcome, startTour } from './onboarding';

/** زر «الدليل» في الشريط العلوي: إعادة الجولة أو الترحيب، وخطوات الإطلاق لمدير النظام */
const session = useSession();
const route = useRoute();
const router = useRouter();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const outside = (e: MouseEvent) => {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false;
};
onMounted(() => document.addEventListener('click', outside));
onBeforeUnmount(() => document.removeEventListener('click', outside));

async function tour() {
  open.value = false;
  if (route.path !== '/me') await router.push('/me');
  startTour();
}
function welcome() {
  open.value = false;
  replayWelcome();
}
</script>

<template>
  <div ref="root" class="help" data-tour="help">
    <button class="help-btn" :aria-expanded="open" title="الدليل والجولة التعريفية" @click="open = !open">
      <span aria-hidden="true">🧭</span><span class="label">الدليل</span>
      <b v-if="session.user?.isSuperadmin && launchView && !launchView.complete && onboarding.state?.launchHidden" class="dot" />
    </button>
    <Transition name="drop">
      <div v-if="open" class="help-menu card">
        <RouterLink v-if="session.user?.isSuperadmin && launchView" to="/launch" class="item" @click="open = false">
          <span>🚀</span><span><b>خطوات الإطلاق</b><small>{{ launchView.done }} من {{ launchView.total }} · {{ launchView.pct }}%</small></span>
        </RouterLink>
        <button class="item" @click="tour"><span>✨</span><span><b>الجولة التعريفية</b><small>تعرّف على أجزاء الشاشة</small></span></button>
        <button class="item" @click="welcome"><span>🍃</span><span><b>شاشة الترحيب</b><small>ما هو النظام ومن أين أبدأ</small></span></button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.help { position: relative; }
.help-btn { position: relative; display: inline-flex; align-items: center; gap: 6px; font: inherit; font-weight: 600; font-size: .9rem; color: inherit; cursor: pointer;
  background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.16); border-radius: 10px; padding: 6px 12px; transition: background .2s; }
.help-btn:hover { background: rgba(255,255,255,.16); }
.dot { position: absolute; top: -3px; inset-inline-end: -3px; width: 10px; height: 10px; border-radius: 50%; background: #d9bc98; box-shadow: 0 0 0 3px rgba(245,198,107,.3); }
.help-menu { position: absolute; top: calc(100% + 8px); inset-inline-end: 0; width: 270px; padding: 6px; z-index: 60; color: var(--text); }
.item { display: flex; gap: 10px; align-items: center; width: 100%; text-align: start; padding: 9px 10px; border-radius: 10px; background: none; border: 0; font: inherit; color: var(--text); cursor: pointer; }
.item:hover { background: var(--surface-2); }
.item > span:first-child { width: 34px; height: 34px; flex-shrink: 0; display: grid; place-items: center; border-radius: 10px; background: var(--primary-soft); }
.item b { display: block; font-size: .92rem; }
.item small { color: var(--muted); }
@media (max-width: 760px) { .help-btn .label { display: none; } }
</style>
