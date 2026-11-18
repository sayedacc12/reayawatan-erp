<script setup lang="ts">
import SiteIcon from '../SiteIcon.vue';
import { num, sar, useSite } from '../site';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ p: any }>();
const site = useSite();
const pct = () => (props.p.donate?.goal ? Math.min(100, Math.round((props.p.donate.raised / props.p.donate.goal) * 100)) : 0);
</script>

<template>
  <article class="sx-card sx-prog">
    <RouterLink :to="site.to(`/programs/${p.slug}`)" class="sx-prog-img">
      <img v-if="p.imageUrl" :src="p.imageUrl" :alt="p.name" loading="lazy" />
      <span v-if="p.donate?.kind === 'waqf'" class="sx-prog-tag">وقف</span>
      <span v-else-if="p.featured" class="sx-prog-tag">★ مميز</span>
      <span class="sx-prog-ic"><SiteIcon :name="p.icon" :size="24" /></span>
    </RouterLink>
    <div class="sx-prog-body">
      <RouterLink :to="site.to(`/programs/${p.slug}`)"><h3>{{ p.name }}</h3></RouterLink>
      <p>{{ p.tagline || p.summary }}</p>
      <template v-if="p.donate">
        <template v-if="p.donate.goal">
          <div class="sx-bar"><i :style="{ width: `${Math.max(3, pct())}%` }" /></div>
          <div class="sx-meta"><span>جُمع <b>{{ sar(p.donate.raised) }}</b></span><span>{{ pct() }}% من {{ num(p.donate.goal) }}</span></div>
        </template>
        <div v-else class="sx-meta"><span><b>{{ num(p.donate.count) }}</b> متبرع</span><span>جُمع {{ sar(p.donate.raised) }}</span></div>
        <RouterLink v-if="p.donate.open" :to="site.to(`/programs/${p.slug}#donate`)" class="sx-btn prim block">تبرع للبرنامج</RouterLink>
        <span v-else class="sx-closed">{{ p.donate.block }}</span>
      </template>
      <RouterLink v-else :to="site.to(`/programs/${p.slug}`)" class="sx-btn line block">تفاصيل البرنامج</RouterLink>
    </div>
  </article>
</template>
