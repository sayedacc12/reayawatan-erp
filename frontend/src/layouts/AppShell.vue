<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BrandMark from '../components/BrandMark.vue';
import SampleDataBanner from '../components/SampleDataBanner.vue';
import SideNav from '../components/SideNav.vue';
import TasksBell from '../components/TasksBell.vue';
import { ess, loadSummary, resetEss } from '../modules/hr/self/ess';
import { P as ACC, docTypes, loadDocTypes } from '../modules/accounting/lib';
import { loginPath, useSession } from '../stores/session';
import { clearIdentity, loadIdentity, orgLogo } from '../site/identity';

const session = useSession();
const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);

/** التطبيق الحالي: الوحدة التي يتبعها المسار، لعرض قائمتها الجانبية */
const currentApp = computed(() =>
  session.apps.find((a) => a.menu.some((m) => route.path.startsWith(m.path))),
);

/**
 * قائمة التطبيق الحالي. في النظام المالي تُضاف أنواع السندات الخاصة بالجمعية (من الإعدادات) تلقائيًا تحت «العمليات».
 */
const menu = computed(() => {
  const app = currentApp.value;
  if (!app) return [];
  if (app.code !== 'accounting' || !session.can(ACC.read)) return app.menu;
  const items = [...app.menu];
  const extra = docTypes.value.filter((d) => d.isActive).map((d) => ({ label: d.name, path: `/accounting/documents/${d.code}`, group: 'العمليات' }));
  let at = -1;
  items.forEach((m, i) => { if (m.group === 'العمليات') at = i; });
  items.splice(at + 1, 0, ...extra);
  return items;
});
watch(() => currentApp.value?.code, (c) => { if (c === 'accounting' && session.can(ACC.read)) loadDocTypes(); }, { immediate: true });

// هوية الجمعية (الشعار والألوان) إن اختارت تطبيقها داخل النظام
watch(() => session.user?.organizationId, (o) => (o ? loadIdentity() : clearIdentity()), { immediate: true });

/** الخدمة الذاتية: تظهر لمستخدمي الجمعيات المربوطين بملف موظف */
const isOrgUser = computed(() => !!session.user?.organizationId);
watch(() => session.user?.id, (id) => {
  resetEss();
  if (id && session.user?.organizationId) loadSummary();
}, { immediate: true });
const inSelf = computed(() => route.path === '/me' || route.path.startsWith('/me/'));

function logout() {
  clearIdentity();
  resetEss();
  session.logout();
  router.push(loginPath());
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="topbar-start">
        <RouterLink :to="ess.summary?.linked ? '/me' : '/'" class="home-link" :title="ess.summary?.linked ? 'لوحتي' : 'كل التطبيقات'">
          <img v-if="orgLogo" :src="orgLogo" class="org-logo" alt="" />
          <BrandMark v-else :size="32" />
          <span class="product">سنابل</span>
          <span class="org-name">{{ session.user?.organizationName ?? 'إدارة المنصة' }}</span>
        </RouterLink>
        <RouterLink v-if="!ess.summary?.linked" to="/" class="apps-btn" title="كل التطبيقات">
          <span class="grid-icon" aria-hidden="true"><i /><i /><i /><i /></span>
          <span class="label">التطبيقات</span>
        </RouterLink>
        <Transition name="crumb" mode="out-in">
          <span v-if="currentApp" :key="currentApp.code" class="app-name">{{ currentApp.name }}</span>
        </Transition>
      </div>
      <div class="top-actions">
      <RouterLink v-if="ess.summary?.linked" to="/me" :class="['self-btn', { on: inSelf }]" title="الخدمة الذاتية: لوحتي وطلباتي">
        <span aria-hidden="true">✦</span><span class="label">خدمتي</span>
        <b v-if="ess.summary.awaiting" class="self-count">{{ ess.summary.awaiting }}</b>
      </RouterLink>
      <TasksBell v-if="isOrgUser" />
      <div class="user">
        <button class="user-btn" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">
          <span class="avatar">{{ session.user?.fullName.charAt(0) }}</span>
          <span class="user-name">{{ session.user?.fullName }}</span>
        </button>
        <Transition name="drop">
          <div v-if="menuOpen" class="user-menu card" @click="menuOpen = false">
            <div class="menu-head">
              <span class="avatar big">{{ session.user?.fullName.charAt(0) }}</span>
              <div>
                <strong>{{ session.user?.fullName }}</strong>
                <div class="muted email" dir="ltr">{{ session.user?.email }}</div>
              </div>
            </div>
            <RouterLink v-if="ess.summary?.linked" to="/me">لوحتي (الخدمة الذاتية)</RouterLink>
            <RouterLink to="/account">حسابي وكلمة المرور</RouterLink>
            <button class="link-btn" @click="logout">تسجيل الخروج</button>
          </div>
        </Transition>
      </div>
      </div>
      <span class="glow-line" aria-hidden="true" />
    </header>
    <div class="body">
      <Transition name="side">
        <nav v-if="currentApp" class="sidebar">
          <p class="side-title">{{ currentApp.name }}</p>
           <SideNav :items="menu" :app-code="currentApp.code" />
        </nav>
      </Transition>
      <main class="content">
        <SampleDataBanner v-if="isOrgUser" />
        <RouterView v-slot="{ Component, route: r }">
          <Transition name="page" mode="out-in">
            <component :is="Component" :key="(r.meta.layoutKey as string | undefined) ?? r.path" />
          </Transition>
        </RouterView>
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell { min-height: 100vh; display: flex; flex-direction: column; }
.topbar { position: sticky; top: 0; z-index: 20; height: 60px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 18px; color: #fff; background: var(--grad-dark); box-shadow: 0 6px 24px rgba(6, 20, 26, .25); }
.glow-line { position: absolute; inset-inline: 0; bottom: 0; height: 2px;
  background: linear-gradient(90deg, transparent, #2dd4bf, var(--gold), #2dd4bf, transparent); background-size: 200% 100%; animation: line 6s linear infinite; opacity: .8; }
@keyframes line { to { background-position: 200% 0; } }
.topbar-start { display: flex; align-items: center; gap: 14px; min-width: 0; }
.home-link { color: #fff; display: flex; align-items: center; gap: 10px; font-weight: 700; min-width: 0; }
.org-logo { width: 34px; height: 34px; object-fit: contain; border-radius: 8px; background: rgba(255,255,255,.08); padding: 2px; }
.product { font-size: 1.15rem; background: linear-gradient(90deg, #fff, #a7f3e9 60%, #f5c66b); -webkit-background-clip: text; background-clip: text; color: transparent; }
.org-name { font-weight: 500; color: rgba(255,255,255,.75); border-inline-start: 1px solid rgba(255,255,255,.25); padding-inline-start: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
.apps-btn { display: flex; align-items: center; gap: 8px; color: rgba(255,255,255,.85); padding: 6px 12px; border-radius: 10px;
  border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.04); transition: background .2s, border-color .2s; }
.apps-btn:hover { background: rgba(255,255,255,.1); border-color: rgba(94,234,212,.5); }
.grid-icon { display: grid; grid-template-columns: repeat(2, 6px); gap: 3px; }
.grid-icon i { width: 6px; height: 6px; background: #5eead4; border-radius: 2px; }
.app-name { color: #a7f3e9; font-weight: 600; white-space: nowrap; }
.app-name::before { content: '‹'; margin-inline-end: 10px; color: rgba(255,255,255,.4); }
.crumb-enter-active, .crumb-leave-active { transition: all .25s var(--ease); }
.crumb-enter-from, .crumb-leave-to { opacity: 0; transform: translateX(-8px); }

.top-actions { display: flex; align-items: center; gap: 10px; }
.self-btn { position: relative; display: flex; align-items: center; gap: 6px; color: #fff; padding: 6px 14px; border-radius: 12px; font-weight: 600;
  background: linear-gradient(135deg, rgba(244,114,182,.28), rgba(167,139,250,.28)); border: 1px solid rgba(244,114,182,.45); transition: all .2s var(--ease); }
.self-btn:hover, .self-btn.on { background: linear-gradient(135deg, #f472b6, #a78bfa); box-shadow: 0 6px 20px rgba(244,114,182,.4); }
.self-count { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 99px; background: #f59e0b; font-size: .7rem; display: grid; place-items: center; }
.user { position: relative; }
.user-btn { background: none; border: 0; color: #fff; display: flex; align-items: center; gap: 8px; cursor: pointer; font: inherit; padding: 4px; border-radius: 999px; }
.avatar { width: 34px; height: 34px; border-radius: 50%; background: var(--grad); display: grid; place-items: center; font-weight: 700; color: #fff;
  box-shadow: 0 0 0 2px rgba(255,255,255,.25), 0 0 16px rgba(45,212,191,.5); }
.avatar.big { width: 42px; height: 42px; flex-shrink: 0; }
.user-menu { position: absolute; inset-inline-end: 0; top: 50px; min-width: 260px; padding: 8px; display: flex; flex-direction: column; color: var(--text); }
.menu-head { display: flex; gap: 10px; align-items: center; padding: 10px; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
.user-menu > a, .link-btn { padding: 9px 10px; border-radius: 8px; }
.user-menu a:hover, .link-btn:hover { background: var(--surface-2); }
.email { font-size: 0.82rem; text-align: right; }
.link-btn { background: none; border: 0; text-align: right; font: inherit; color: var(--danger); cursor: pointer; }
.drop-enter-active, .drop-leave-active { transition: all .2s var(--ease); transform-origin: top left; }
.drop-enter-from, .drop-leave-to { opacity: 0; transform: translateY(-6px) scale(.97); }

.body { flex: 1; display: flex; min-height: 0; }
.sidebar { width: 236px; background: var(--surface); border-inline-start: 1px solid var(--border); padding: 18px 12px; display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }
.side-title { font-size: .78rem; color: var(--muted); margin: 0 10px 8px; font-weight: 600; }
.nav-item { position: relative; color: var(--text); padding: 10px 14px; border-radius: 10px; transition: background .2s, color .2s, padding .2s var(--ease); }
.nav-item:hover { background: var(--surface-2); padding-inline-start: 18px; }
.nav-item.router-link-active { background: var(--primary-soft); color: var(--primary); font-weight: 600; }
.nav-item.router-link-active::before { content: ''; position: absolute; inset-inline-start: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 3px; background: var(--grad); box-shadow: 0 0 10px rgba(20,184,166,.6); }
.side-enter-active, .side-leave-active { transition: all .3s var(--ease); }
.side-enter-from, .side-leave-to { opacity: 0; transform: translateX(20px); }
.content { flex: 1; padding: 26px; min-width: 0; }
@media (max-width: 760px) {
  .body { flex-direction: column; }
  .sidebar { width: auto; flex-direction: row; overflow-x: auto; border-inline-start: 0; border-bottom: 1px solid var(--border); padding: 8px 16px; }
  .side-title { display: none; }
  .nav-item { white-space: nowrap; }
  .content { padding: 16px; }
  .user-name, .apps-btn .label, .app-name, .self-btn .label { display: none; }
  .org-name { max-width: 140px; }
}
</style>
