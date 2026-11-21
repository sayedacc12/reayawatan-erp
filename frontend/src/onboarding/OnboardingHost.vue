<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from '../stores/session';
import CelebrationHost from './CelebrationHost.vue';
import CoachTour, { type TourStep } from './CoachTour.vue';
import WelcomeScreen from './WelcomeScreen.vue';
import { celebrate, launchView, loadOnboarding, markTourDone, markWelcomeSeen, onboarding } from './onboarding';

/** يدير التعريف بالنظام لمستخدمي الجمعيات: الترحيب أول مرة، ثم الجولة، ثم التهاني */
const session = useSession();
const route = useRoute();
const router = useRouter();
const isAdmin = computed(() => !!session.user?.isSuperadmin);

onMounted(async () => {
  const s = await loadOnboarding();
  if (s && !s.welcomeSeen && onboarding.stage === 'idle') onboarding.stage = 'welcome';
});

// خطوات الإطلاق تُكتشف من عمل المستخدم في الأنظمة، فنعيد فحصها عند التنقل (مرة كل 8 ثوانٍ على الأكثر)
let last = Date.now();
watch(() => route.path, () => {
  if (!isAdmin.value || Date.now() - last < 8000) return;
  last = Date.now();
  loadOnboarding();
});

async function toTour() {
  markWelcomeSeen();
  onboarding.stage = 'idle';
  if (route.path !== '/me') await router.push('/me');
  onboarding.stage = 'tour';
}
function later() {
  markWelcomeSeen();
  onboarding.stage = 'idle';
}

const steps = computed<TourStep[]>(() => [
  { target: 'home', icon: '🏠', title: 'لوحتك هي نقطة البداية', text: 'اضغط شعار الجمعية من أي شاشة لتعود إلى لوحتك. هنا تبدأ يومك وترى ملخص عملك.' },
  ...(isAdmin.value ? [{ target: 'launch', icon: '🚀', title: 'ابدأ من خطوات الإطلاق', text: 'رتبنا لك تجهيز الجمعية في مراحل قصيرة. كل خطوة تفتح لك الشاشة المطلوبة، وتُعلَّم تلقائيًا عند إنجازها.' }] : []),
  { target: 'systems', icon: '🧩', title: 'الأنظمة المصرح لك بها', text: 'هذه قائمة أنظمتك حسب صلاحياتك. اضغط أي نظام لتفتحه، وستظهر قائمته الجانبية بكل شاشاته.' },
  { target: 'self', icon: '✦', title: 'لوحتي', text: 'زر سريع يعيدك إلى لوحتك وخدماتك الذاتية مثل طلب إجازة أو خطاب أو سلفة.' },
  { target: 'bell', icon: '🔔', title: 'جرس المهام', text: 'كل ما ينتظر قرارك في كل الأنظمة يصلك هنا: اعتمادات وطلبات ومراجعات، مقسمة حسب النظام.' },
  { target: 'help', icon: '🧭', title: 'الدليل دائمًا معك', text: 'من هنا تعيد هذه الجولة أو شاشة الترحيب متى شئت' + (isAdmin.value ? '، وتفتح خطوات الإطلاق.' : '.') },
  { target: 'user', icon: '👤', title: 'حسابك', text: 'من هنا تغيّر كلمة المرور وتسجّل الخروج.' },
]);

function tourDone(finished: boolean) {
  onboarding.stage = 'idle';
  markTourDone();
  if (!finished) return;
  const next = launchView.value?.next;
  celebrate({
    key: 'tour', kind: 'tour', icon: '🎉', title: 'أنهيت الجولة التعريفية!',
    text: isAdmin.value && next ? 'صرت تعرف طريقك في النظام. الخطوة الأولى للإطلاق تنتظرك.' : 'صرت تعرف طريقك في النظام. بالتوفيق في عملك.',
    cta: isAdmin.value && next ? { label: `ابدأ: ${next.title}`, to: next.link } : undefined,
  });
}
</script>

<template>
  <WelcomeScreen v-if="onboarding.stage === 'welcome'" @tour="toTour" @later="later" />
  <CoachTour v-if="onboarding.stage === 'tour'" :steps="steps" @done="tourDone" />
  <CelebrationHost />
</template>
