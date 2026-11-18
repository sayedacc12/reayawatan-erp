<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import SiteIcon from '../SiteIcon.vue';
import NewsCard from '../parts/NewsCard.vue';
import { dateAr, paras, useSite } from '../site';

/* eslint-disable @typescript-eslint/no-explicit-any */
const route = useRoute();
const site = useSite();
const n = ref<any>(null);
const err = ref('');
onMounted(async () => {
  try {
    n.value = await site.get(`/news/${route.params.id}`);
    document.title = `${n.value.title} · ${site.data.value.identity.displayName}`;
  } catch (e) {
    err.value = (e as Error).message;
  }
});
const more = computed(() => (site.data.value.news as any[]).filter((x) => x.id !== n.value?.id).slice(0, 3));
const shareUrl = computed(() => window.location.href.split('?')[0]);
const wa = computed(() => `https://wa.me/?text=${encodeURIComponent(`${n.value?.title}\n${shareUrl.value}`)}`);
const x = computed(() => `https://x.com/intent/post?text=${encodeURIComponent(n.value?.title ?? '')}&url=${encodeURIComponent(shareUrl.value)}`);
</script>

<template>
  <div>
    <div v-if="err" class="sx-empty" style="padding-top: 120px"><h2>{{ err }}</h2></div>
    <article v-else-if="n">
      <section class="sx-pagehead ni-head">
        <div class="sx-wrap ni-narrow">
          <div class="sx-crumbs"><RouterLink :to="site.to()">الرئيسية</RouterLink><span>/</span><RouterLink :to="site.to('/news')">الأخبار</RouterLink></div>
          <small class="ni-date">{{ dateAr(n.date) }}</small>
          <h1>{{ n.title }}</h1>
          <p>{{ n.summary }}</p>
        </div>
      </section>
      <div class="sx-wrap ni-narrow">
        <img v-if="n.imageUrl" :src="n.imageUrl" :alt="n.title" class="ni-img" />
        <div class="sx-card ni-body">
          <div class="sx-prose"><p v-for="(t, i) in paras(n.body)" :key="i">{{ t }}</p></div>
          <div class="ni-share"><span>شارك الخبر:</span><a :href="wa" target="_blank" rel="noopener"><SiteIcon name="whatsapp" :size="18" /></a><a :href="x" target="_blank" rel="noopener"><SiteIcon name="x" :size="18" /></a></div>
        </div>
      </div>
      <section v-if="more.length" class="sx-sec">
        <div class="sx-wrap"><div class="sx-head"><h2>أخبار أخرى</h2></div><div class="sx-grid"><NewsCard v-for="m in more" :key="m.id" :n="m" /></div></div>
      </section>
    </article>
  </div>
</template>

<style scoped>
.ni-narrow { max-width: 860px; }
.ni-head { padding-bottom: 120px; }
.ni-date { display: inline-block; padding: 4px 14px; border-radius: 999px; background: var(--accent); color: var(--dark); font-weight: 700; margin-bottom: 12px; }
.ni-img { width: 100%; border-radius: var(--r); margin-top: -90px; position: relative; box-shadow: 0 24px 50px rgba(0,0,0,.2); aspect-ratio: 16 / 9; object-fit: cover; display: block; }
.ni-body { padding: 32px; margin-top: 22px; }
.ni-share { display: flex; gap: 8px; align-items: center; border-top: 1px solid var(--line); padding-top: 16px; color: var(--text-2); }
.ni-share a { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: var(--soft); color: var(--primary); transition: background .2s, color .2s; }
.ni-share a:hover { background: var(--primary); color: #fff; }
</style>
