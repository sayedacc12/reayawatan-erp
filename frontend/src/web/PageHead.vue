<script setup lang="ts">
import Rich from './Rich.vue';
defineProps<{ title: string; lead?: string; crumbs?: { to?: string; l: string }[] }>();
</script>
<template>
  <div class="page-head"><div class="wrap">
    <div class="crumbs"><RouterLink to="/">الرئيسية</RouterLink><template v-for="c in crumbs ?? []" :key="c.l"> / <RouterLink v-if="c.to" :to="c.to">{{ c.l }}</RouterLink><template v-else>{{ c.l }}</template></template></div>
    <h1>{{ title }}</h1>
    <p v-if="lead" class="lead"><Rich :text="lead" /></p>
  </div></div>
</template>
