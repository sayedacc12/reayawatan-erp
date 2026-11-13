<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from '../stores/session';

const session = useSession();
const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);

/** التطبيق الحالي: الوحدة التي يتبعها المسار، لعرض قائمتها الجانبية */
const currentApp = computed(() =>
  session.apps.find((a) => a.menu.some((m) => route.path.startsWith(m.path))),
);

function logout() {
  session.logout();
  router.push('/login');
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="topbar-start">
        <RouterLink to="/" class="home-link" title="كل التطبيقات">
          <span class="grid-icon" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>التطبيقات</span>
        </RouterLink>
        <span class="org-name">{{ session.user?.organizationName ?? 'إدارة المنصة' }}</span>
        <span v-if="currentApp" class="app-name">{{ currentApp.name }}</span>
      </div>
      <div class="user">
        <button class="user-btn" @click="menuOpen = !menuOpen">
          <span class="avatar">{{ session.user?.fullName.charAt(0) }}</span>
          <span class="user-name">{{ session.user?.fullName }}</span>
        </button>
        <div v-if="menuOpen" class="user-menu card" @click="menuOpen = false">
          <div class="muted email" dir="ltr">{{ session.user?.email }}</div>
          <RouterLink to="/account">حسابي وكلمة المرور</RouterLink>
          <button class="link-btn" @click="logout">تسجيل الخروج</button>
        </div>
      </div>
    </header>
    <div class="body">
      <nav v-if="currentApp" class="sidebar">
        <RouterLink v-for="m in currentApp.menu" :key="m.path" :to="m.path" class="nav-item">{{ m.label }}</RouterLink>
      </nav>
      <main class="content"><RouterView /></main>
    </div>
  </div>
</template>

<style scoped>
.shell { min-height: 100vh; display: flex; flex-direction: column; }
.topbar { height: 56px; background: var(--primary); color: #fff; display: flex; align-items: center;
  justify-content: space-between; padding: 0 16px; position: sticky; top: 0; z-index: 20; }
.topbar-start { display: flex; align-items: center; gap: 18px; min-width: 0; }
.home-link { color: #fff; display: flex; align-items: center; gap: 8px; font-weight: 600; }
.grid-icon { display: grid; grid-template-columns: repeat(2, 7px); gap: 3px; }
.grid-icon i { width: 7px; height: 7px; background: #fff; border-radius: 2px; }
.org-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-inline-start: 1px solid rgba(255,255,255,.35); padding-inline-start: 18px; }
.app-name { opacity: 0.85; border-inline-start: 1px solid rgba(255,255,255,.35); padding-inline-start: 18px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.user { position: relative; }
.user-btn { background: none; border: 0; color: #fff; display: flex; align-items: center; gap: 8px; cursor: pointer; font: inherit; }
.avatar { width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,.2); display: grid; place-items: center; font-weight: 600; }
.user-menu { position: absolute; inset-inline-end: 0; top: 46px; min-width: 220px; padding: 8px; display: flex; flex-direction: column; color: var(--text); }
.user-menu > * { padding: 8px 10px; border-radius: 6px; }
.user-menu a:hover, .link-btn:hover { background: var(--surface-2); }
.email { font-size: 0.85rem; border-bottom: 1px solid var(--border); border-radius: 0; text-align: right; }
.link-btn { background: none; border: 0; text-align: right; font: inherit; color: var(--danger); cursor: pointer; }
.body { flex: 1; display: flex; min-height: 0; }
.sidebar { width: 220px; background: var(--surface); border-inline-start: 1px solid var(--border); padding: 14px 10px; display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; }
.nav-item { color: var(--text); padding: 9px 12px; border-radius: 8px; }
.nav-item:hover { background: var(--surface-2); }
.nav-item.router-link-active { background: var(--primary-soft); color: var(--primary); font-weight: 600; }
.content { flex: 1; padding: 24px; min-width: 0; }
@media (max-width: 760px) {
  .body { flex-direction: column; }
  .sidebar { width: auto; flex-direction: row; overflow-x: auto; border-inline-start: 0; border-bottom: 1px solid var(--border); padding: 8px 16px; }
  .nav-item { white-space: nowrap; }
  .content { padding: 16px; }
  .user-name, .home-link span:last-child, .app-name { display: none; }
}
</style>
