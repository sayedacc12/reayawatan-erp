<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BrandMark from '../components/BrandMark.vue';
import { portalApi, setPortalToken, usePortal } from './portal';

const route = useRoute();
const router = useRouter();
const slug = computed(() => route.params.slug as string);
const portal = usePortal(slug.value);
const orgName = ref('');
const userName = ref('');

async function loadInfo() {
  try {
    orgName.value = (await portalApi<{ name: string }>(`/o/${slug.value}`)).name;
  } catch {
    orgName.value = '';
  }
  if (portal.token) {
    try { userName.value = (await portalApi<{ profile: { fullName: string } }>('/me')).profile.fullName; } catch { /* يعيد التوجيه */ }
  }
}
onMounted(loadInfo);
watch(() => portal.token, loadInfo);

function logout() {
  setPortalToken(null);
  userName.value = '';
  router.push(`/portal/${slug.value}`);
}
const links = computed(() => [
  { to: `/portal/${slug.value}/home`, label: 'طلباتي' },
  { to: `/portal/${slug.value}/apply`, label: 'تقديم طلب' },
  { to: `/portal/${slug.value}/messages`, label: 'شكاوى واستفسارات' },
  { to: `/portal/${slug.value}/profile`, label: 'بياناتي' },
]);
</script>

<template>
  <div class="portal">
    <header class="ptop">
      <RouterLink :to="portal.token ? `/portal/${slug}/home` : `/portal/${slug}`" class="brand">
        <BrandMark :size="34" />
        <span><b>{{ orgName || '...' }}</b><small>بوابة المستفيدين</small></span>
      </RouterLink>
      <nav v-if="portal.token" class="pnav">
        <RouterLink v-for="l in links" :key="l.to" :to="l.to" class="plink">{{ l.label }}</RouterLink>
      </nav>
      <div v-if="portal.token" class="me">
        <span class="hello">أهلًا، {{ userName.split(' ')[0] }}</span>
        <button class="out" @click="logout">خروج</button>
      </div>
      <span class="line" />
    </header>
    <main class="pmain">
      <RouterView v-slot="{ Component, route: r }">
        <Transition name="page" mode="out-in"><component :is="Component" :key="r.path" /></Transition>
      </RouterView>
    </main>
    <footer class="pfoot">تعمل بواسطة منصة سنابل</footer>
  </div>
</template>

<style scoped>
.portal { min-height: 100vh; display: flex; flex-direction: column; background: radial-gradient(1200px 500px at 100% -10%, rgba(45,212,191,.12), transparent 60%), radial-gradient(900px 400px at -10% 110%, rgba(232,176,75,.10), transparent 60%), var(--bg); }
.ptop { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 18px; padding: 10px 22px; background: rgba(6,20,26,.92); backdrop-filter: blur(10px); color: #fff; flex-wrap: wrap; }
.line { position: absolute; inset-inline: 0; bottom: 0; height: 2px; background: linear-gradient(90deg, transparent, #2dd4bf, var(--gold), #2dd4bf, transparent); background-size: 200% 100%; animation: line 6s linear infinite; }
@keyframes line { to { background-position: 200% 0; } }
.brand { display: flex; align-items: center; gap: 10px; color: #fff; }
.brand small { display: block; font-size: .74rem; color: #5eead4; }
.pnav { display: flex; gap: 4px; flex: 1; overflow-x: auto; }
.plink { color: rgba(255,255,255,.75); padding: 8px 14px; border-radius: 10px; white-space: nowrap; transition: all .2s; }
.plink:hover { color: #fff; background: rgba(255,255,255,.08); }
.plink.router-link-active { color: #06141a; background: linear-gradient(135deg, #5eead4, #2dd4bf); font-weight: 700; box-shadow: 0 0 18px rgba(45,212,191,.5); }
.me { display: flex; align-items: center; gap: 10px; margin-inline-start: auto; }
.hello { color: rgba(255,255,255,.8); font-size: .9rem; }
.out { font: inherit; background: rgba(255,255,255,.08); color: #fff; border: 1px solid rgba(255,255,255,.2); border-radius: 8px; padding: 5px 12px; cursor: pointer; }
.pmain { flex: 1; width: 100%; max-width: 1080px; margin: 0 auto; padding: 26px 18px; }
.pfoot { text-align: center; color: var(--muted); font-size: .8rem; padding: 18px; }
@media (max-width: 760px) { .pnav { order: 3; flex-basis: 100%; } .hello { display: none; } .ptop { padding: 10px 14px; } .pmain { padding: 18px 14px; } }
</style>
