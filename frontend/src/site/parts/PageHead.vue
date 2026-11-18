<script setup lang="ts">
import { useSite } from '../site';

defineProps<{ title: string; text?: string | null; crumb?: [string, string] }>();
const site = useSite();
</script>

<template>
  <section class="sx-pagehead">
    <div class="sx-wrap">
      <div class="sx-crumbs"><RouterLink :to="site.to()">الرئيسية</RouterLink><span>/</span><template v-if="crumb"><RouterLink :to="site.to(crumb[0])">{{ crumb[1] }}</RouterLink><span>/</span></template><span>{{ title }}</span></div>
      <h1>{{ title }}</h1>
      <p v-if="text">{{ text }}</p>
      <slot />
    </div>
  </section>
</template>
