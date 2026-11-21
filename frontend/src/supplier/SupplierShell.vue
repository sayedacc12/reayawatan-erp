<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BrandMark from '../components/BrandMark.vue';
import { canBanks, loadMe, me, setSupplierToken, supplierApi, useSupplierPortal } from './supplier';
import '../modules/projects/projects.css';
import '../modules/procurement/procurement.css';

const route = useRoute();
const router = useRouter();
const slug = computed(() => route.params.slug as string);
const portal = useSupplierPortal(slug.value);
const orgName = ref('');

async function loadInfo() {
  try {
    orgName.value = (await supplierApi<{ name: string }>(`/o/${slug.value}`)).name;
  } catch {
    orgName.value = '';
  }
  if (portal.token) await loadMe().catch(() => null);
}
onMounted(loadInfo);
watch(() => portal.token, loadInfo);

function logout() {
  setSupplierToken(null);
  router.push(`/supplier/${slug.value}`);
}
const role = computed(() => me.value?.user.role as string | undefined);
const links = computed(() => [
  { to: `/supplier/${slug.value}/home`, label: 'حالة الطلب', show: true },
  { to: `/supplier/${slug.value}/rfqs`, label: 'المنافسات', show: me.value?.supplier.status === 'approved' },
  { to: `/supplier/${slug.value}/orders`, label: 'التعميدات', show: me.value?.supplier.status === 'approved' },
  { to: `/supplier/${slug.value}/invoices`, label: 'الفواتير', show: me.value?.supplier.status === 'approved' },
  { to: `/supplier/${slug.value}/profile`, label: 'بيانات المنشأة', show: true },
  { to: `/supplier/${slug.value}/docs`, label: 'المستندات', show: true },
  { to: `/supplier/${slug.value}/banks`, label: 'الحساب البنكي', show: canBanks(role.value) },
  { to: `/supplier/${slug.value}/users`, label: 'المستخدمون', show: role.value === 'owner' },
].filter((l) => l.show));
const ready = computed(() => portal.token && me.value && !me.value.user.mustChangePassword);
</script>

<template>
  <div class="sportal">
    <header class="stop">
      <RouterLink :to="ready ? `/supplier/${slug}/home` : `/supplier/${slug}`" class="brand">
        <BrandMark :size="34" />
        <span><b>{{ orgName || '...' }}</b><small>بوابة الموردين</small></span>
      </RouterLink>
      <nav v-if="ready" class="snav">
        <RouterLink v-for="l in links" :key="l.to" :to="l.to" class="slink">{{ l.label }}</RouterLink>
      </nav>
      <div v-if="portal.token" class="me">
        <span v-if="me" class="hello">{{ me.supplier.name }} · {{ me.user.fullName.split(' ')[0] }}</span>
        <button class="out" @click="logout">خروج</button>
      </div>
      <span class="line" />
    </header>
    <main class="smain">
      <RouterView v-slot="{ Component, route: r }">
        <Transition name="page" mode="out-in"><component :is="Component" :key="r.path" /></Transition>
      </RouterView>
    </main>
    <footer class="sfoot">تعمل بواسطة منصة سنابل</footer>
  </div>
</template>

<style scoped>
.sportal { min-height: 100vh; display: flex; flex-direction: column; background: radial-gradient(1200px 500px at 100% -10%, rgba(56,189,248,.12), transparent 60%), radial-gradient(900px 400px at -10% 110%, rgba(52,211,153,.10), transparent 60%), var(--bg); }
.stop { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 18px; padding: 10px 22px; background: rgba(8,24,36,.94); backdrop-filter: blur(10px); color: #fff; flex-wrap: wrap; }
.line { position: absolute; inset-inline: 0; bottom: 0; height: 2px; background: linear-gradient(90deg, transparent, #38bdf8, #34d399, #38bdf8, transparent); background-size: 200% 100%; animation: line 6s linear infinite; }
@keyframes line { to { background-position: 200% 0; } }
.brand { display: flex; align-items: center; gap: 10px; color: #fff; }
.brand small { display: block; font-size: .74rem; color: #7dd3fc; }
.snav { display: flex; gap: 4px; flex: 1; overflow-x: auto; }
.slink { color: rgba(255,255,255,.75); padding: 8px 14px; border-radius: 10px; white-space: nowrap; transition: all .2s; }
.slink:hover { color: #fff; background: rgba(255,255,255,.08); }
.slink.router-link-active { color: #06202b; background: linear-gradient(135deg, #7dd3fc, #34d399); font-weight: 700; box-shadow: 0 0 18px rgba(56,189,248,.45); }
.me { display: flex; align-items: center; gap: 10px; margin-inline-start: auto; }
.hello { color: rgba(255,255,255,.8); font-size: .88rem; }
.out { font: inherit; background: rgba(255,255,255,.08); color: #fff; border: 1px solid rgba(255,255,255,.2); border-radius: 8px; padding: 5px 12px; cursor: pointer; }
.smain { flex: 1; width: 100%; max-width: 1080px; margin: 0 auto; padding: 26px 18px; }
.sfoot { text-align: center; color: var(--muted); font-size: .8rem; padding: 18px; }
</style>
