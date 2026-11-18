<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SiteIcon from '../SiteIcon.vue';
import PageHead from '../parts/PageHead.vue';
import { useSite } from '../site';

/* eslint-disable @typescript-eslint/no-explicit-any */
const route = useRoute();
const router = useRouter();
const site = useSite();
const q = ref(String(route.query.q ?? ''));
const r = ref<any>(null);
const busy = ref(false);
async function run(term: string) {
  if (term.trim().length < 2) return void (r.value = null);
  busy.value = true;
  try {
    r.value = await site.get(`/search?q=${encodeURIComponent(term.trim())}`);
  } finally {
    busy.value = false;
  }
}
watch(() => route.query.q, (v) => run(String(v ?? '')), { immediate: true });
function go() {
  router.replace({ ...site.to('/search'), query: { ...site.to().query, q: q.value } });
}
const total = () => (r.value ? r.value.news.length + r.value.programs.length + r.value.documents.length : 0);
</script>

<template>
  <div>
    <PageHead title="البحث في الموقع">
      <form class="se-form" @submit.prevent="go"><SiteIcon name="search" :size="22" /><input v-model="q" placeholder="ابحث عن برنامج أو خبر أو لائحة..." autofocus /><button class="sx-btn main sm">بحث</button></form>
    </PageHead>
    <section class="sx-sec">
      <div class="sx-wrap" style="max-width: 860px">
        <p v-if="busy" class="sx-empty">جارٍ البحث...</p>
        <p v-else-if="r && !total()" class="sx-empty">لا توجد نتائج لـ «{{ route.query.q }}»</p>
        <template v-else-if="r">
          <div v-if="r.programs.length" class="se-grp"><h3>البرامج</h3><RouterLink v-for="p in r.programs" :key="p.slug" :to="site.to(`/programs/${p.slug}`)" class="sx-card se-item"><SiteIcon name="heart" :size="20" /><div><strong>{{ p.name }}</strong><small>{{ p.summary }}</small></div></RouterLink></div>
          <div v-if="r.news.length" class="se-grp"><h3>الأخبار</h3><RouterLink v-for="n in r.news" :key="n.id" :to="site.to(`/news/${n.id}`)" class="sx-card se-item"><SiteIcon name="megaphone" :size="20" /><div><strong>{{ n.title }}</strong><small>{{ n.summary }}</small></div></RouterLink></div>
          <div v-if="r.documents.length" class="se-grp"><h3>اللوائح والوثائق</h3><RouterLink v-for="d in r.documents" :key="d.id" :to="site.to(`/documents/${d.id}`)" class="sx-card se-item"><SiteIcon name="doc" :size="20" /><div><strong>{{ d.title }}</strong><small>{{ d.summary }}</small></div></RouterLink></div>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.se-form { display: flex; align-items: center; gap: 10px; max-width: 640px; margin-top: 20px; padding: 6px 6px 6px 16px; padding-inline-start: 18px; border-radius: 999px; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.25); backdrop-filter: blur(8px); }
.se-form input { flex: 1; min-width: 0; background: transparent; border: 0; color: #fff; font: inherit; font-size: 1.05rem; }
.se-form input::placeholder { color: rgba(255,255,255,.65); }
.se-form input:focus { outline: 0; }
.se-grp { margin-bottom: 26px; display: grid; gap: 10px; }
.se-grp h3 { color: var(--primary); }
.se-item { display: flex; gap: 14px; align-items: flex-start; padding: 16px 18px; transition: transform .2s; }
.se-item:hover { transform: translateX(-4px); }
.se-item svg { color: var(--primary); margin-top: 4px; flex-shrink: 0; }
.se-item div { display: grid; }
.se-item small { color: var(--text-2); }
</style>
