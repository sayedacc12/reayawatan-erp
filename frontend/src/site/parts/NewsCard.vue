<script setup lang="ts">
import SiteIcon from '../SiteIcon.vue';
import { dateAr, useSite } from '../site';

/* eslint-disable @typescript-eslint/no-explicit-any */
defineProps<{ n: any }>();
const site = useSite();
</script>

<template>
  <RouterLink :to="site.to(`/news/${n.id}`)" class="sx-card sx-news">
    <div class="sx-news-img"><img v-if="n.imageUrl" :src="n.imageUrl" :alt="n.title" loading="lazy" /><SiteIcon v-else name="megaphone" :size="44" /></div>
    <div class="sx-news-body"><small>{{ dateAr(n.date) }}</small><h3>{{ n.title }}</h3><p>{{ n.summary }}</p></div>
  </RouterLink>
</template>
