<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '../../../components/AppIcon.vue';
import { useSession } from '../../../stores/session';
import { ess, loadSummary, setMode } from './ess';
import OrgHome from './OrgHome.vue';
import { launchView } from '../../../onboarding/onboarding';
import '../../../shared/module.css';
import '../hr.css';
import './ess.css';

const session = useSession();
const route = useRoute();
const router = useRouter();
onMounted(() => loadSummary());

const isManager = computed(() => !!ess.summary?.isManager);
// المدير يعود إلى وضع الموظف تلقائيًا إن لم يعد له فريق
watch(() => ess.summary, (s) => {
  if (s && !s.isManager && ess.mode === 'manager') setMode('employee');
});
const mode = computed(() => (isManager.value ? ess.mode : 'employee'));
// الوضع يتبع الشاشة المفتوحة: شاشات الفريق للمدير، ولوحتي وطلباتي للموظف
watch(() => route.path, (p) => {
  if (p === '/me/manager' || p.startsWith('/me/team')) setMode('manager');
  else if (p === '/me' || p === '/me/new' || p.startsWith('/me/new/') || p === '/me/requests') setMode('employee');
}, { immediate: true });

function switchMode(m: 'employee' | 'manager') {
  setMode(m);
  router.push(m === 'manager' ? '/me/manager' : '/me');
}

const linked = computed(() => !!ess.summary?.linked);
// خطوات الإطلاق لمدير نظام الجمعية حتى تكتمل
const launchLink = computed(() => (launchView.value && !launchView.value.complete
  ? [{ to: '/launch', label: 'خطوات الإطلاق', icon: 'sprout', badge: launchView.value.total - launchView.value.done }]
  : []));
const nav = computed(() => (!linked.value
  ? [{ to: '/me', label: 'لوحتي', icon: 'grid', exact: true }, ...launchLink.value]
  : mode.value === 'manager'
  ? [
    { to: '/me/manager', label: 'لوحة المدير', icon: 'grid', exact: true },
    { to: '/me/approvals', label: 'بانتظار اعتمادي', icon: 'shieldCheck', badge: ess.summary?.awaiting ?? 0 },
    { to: '/me/team', label: 'فريقي', icon: 'users' },
    { to: '/me/requests', label: 'طلباتي', icon: 'layers' },
    { to: '/me/new', label: 'طلب جديد', icon: 'sprout' },
  ]
  : [
    { to: '/me', label: 'لوحتي', icon: 'grid', exact: true },
    { to: '/me/new', label: 'طلب جديد', icon: 'sprout' },
    { to: '/me/requests', label: 'طلباتي', icon: 'layers' },
    ...(ess.summary?.awaiting ? [{ to: '/me/approvals', label: 'بانتظار اعتمادي', icon: 'shieldCheck', badge: ess.summary.awaiting }] : []),
    ...launchLink.value,
  ]));
const active = (n: { to: string; exact?: boolean }) => (n.exact ? route.path === n.to : route.path === n.to || route.path.startsWith(`${n.to}/`));
const PALETTE = ['#14b8a6', '#6366f1', '#f59e0b', '#ec4899', '#0ea5e9', '#22c55e', '#a855f7', '#ef4444'];
const appTint = (i: number) => ({ '--c': PALETTE[i % PALETTE.length], '--i': i });
const initials = computed(() => ess.summary?.employee?.fullName.split(' ').slice(0, 2).map((w) => w.charAt(0)).join(' ') ?? '');
</script>

<template>
  <div :class="['ess-shell', { unlinked: ess.summary && !linked }]">
    <aside class="ess-side">
      <div class="ess-me">
        <span class="ess-avatar">{{ initials }}</span>
        <div>
          <strong>{{ ess.summary?.employee?.fullName ?? session.user?.fullName }}</strong>
          <span v-if="ess.summary?.employee" class="pm-muted">الرقم الوظيفي {{ ess.summary.employee.employeeNo }}</span>
        </div>
      </div>
      <div v-if="isManager" class="ess-switch" role="tablist" aria-label="وضع العرض">
        <button role="tab" :aria-selected="mode === 'employee'" :class="{ on: mode === 'employee' }" @click="switchMode('employee')">موظف</button>
        <button role="tab" :aria-selected="mode === 'manager'" :class="{ on: mode === 'manager' }" @click="switchMode('manager')">مدير</button>
        <i :style="{ transform: mode === 'manager' ? 'translateX(-100%)' : 'none' }" />
      </div>
      <p class="ess-side-title">{{ linked ? 'الخدمة الذاتية' : 'لوحتي' }}</p>
      <nav class="ess-nav">
        <RouterLink v-for="n in nav" :key="n.to" :to="n.to" :class="['ess-link', { on: active(n) }]">
          <AppIcon :name="n.icon" :size="18" /><span>{{ n.label }}</span>
          <b v-if="'badge' in n && n.badge" class="ess-count">{{ n.badge }}</b>
        </RouterLink>
      </nav>
      <template v-if="session.apps.length">
        <p class="ess-side-title ess-apps-title">الأنظمة المصرح لك بها <small>{{ session.apps.length }}</small></p>
        <nav class="ess-nav ess-apps" data-tour="systems">
          <RouterLink v-for="(a, i) in session.apps" :key="a.code" :to="a.menu[0].path" class="ess-link" :style="appTint(i)">
            <span class="ess-app-ic"><AppIcon :name="a.icon" :size="16" /></span><span>{{ a.name }}</span>
          </RouterLink>
        </nav>
      </template>
    </aside>
    <section class="ess-main">
      <!-- من ليس له ملف موظف يبدأ من لوحته العامة (المهام والأنظمة وخطوات الإطلاق) بدل شاشة التطبيقات -->
      <OrgHome v-if="ess.summary && !ess.summary.linked && route.path === '/me'" />
      <div v-else-if="ess.summary && !ess.summary.linked" class="card ess-unlinked">
        <h2>حسابك غير مربوط بملف موظف</h2>
        <p class="pm-muted">الخدمة الذاتية متاحة لكل موظف بعد ربط حساب دخوله بملفه في الموارد البشرية. اطلب من شؤون الموظفين فتح ملفك واختيار حسابك في خانة «حساب الدخول».</p>
        <RouterLink to="/me" class="btn">العودة إلى لوحتي</RouterLink>
      </div>
      <RouterView v-else-if="ess.summary" v-slot="{ Component }">
        <Transition name="page" mode="out-in"><component :is="Component" :key="route.path" /></Transition>
      </RouterView>
      <div v-else class="ess-skeleton"><i /><i /><i /></div>
    </section>
  </div>
</template>
