<script setup lang="ts">
import { useSession } from '../stores/session';
const session = useSession();
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>أهلًا، {{ session.user?.fullName }}</h1>
        <p class="muted">اختر النظام الذي تريد العمل عليه</p>
      </div>
    </div>
    <div v-if="session.apps.length" class="apps">
      <RouterLink v-for="app in session.apps" :key="app.code" :to="app.menu[0].path" class="card app">
        <span class="app-icon">{{ app.name.charAt(0) }}</span>
        <span class="app-title">{{ app.name }}</span>
        <span v-if="app.description" class="muted app-desc">{{ app.description }}</span>
      </RouterLink>
    </div>
    <div v-else class="card empty">
      لا توجد أنظمة متاحة لحسابك حاليًا. تواصل مع مدير النظام لمنحك الصلاحيات المطلوبة.
    </div>
  </div>
</template>

<style scoped>
.apps { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
.app { padding: 22px 16px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; color: var(--text); transition: transform .12s, box-shadow .12s; }
.app:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(16,24,40,.08); }
.app-icon { width: 56px; height: 56px; border-radius: 14px; background: var(--primary-soft); color: var(--primary); display: grid; place-items: center; font-size: 1.5rem; font-weight: 700; }
.app-title { font-weight: 600; }
.app-desc { font-size: 0.85rem; }
.empty { padding: 28px; text-align: center; color: var(--muted); }
</style>
