<script setup lang="ts">
import { onMounted, ref } from 'vue';
import NewsCard from '../parts/NewsCard.vue';
import PageHead from '../parts/PageHead.vue';
import { useSite, vReveal } from '../site';

/* eslint-disable @typescript-eslint/no-explicit-any */
const site = useSite();
const d = ref<any>(null);
const err = ref('');
async function load(page = 1) {
  try {
    d.value = await site.get(`/news?page=${page}`);
    if (page > 1) window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    err.value = (e as Error).message;
  }
}
onMounted(() => load());
</script>

<template>
  <div>
    <PageHead title="المركز الإعلامي" text="أخبار الجمعية وفعالياتها وإنجازاتها." />
    <section class="sx-sec">
      <div class="sx-wrap">
        <div v-if="err" class="sx-err">{{ err }}</div>
        <div v-if="d && !d.items.length" class="sx-empty">لا توجد أخبار منشورة بعد</div>
        <div v-if="d" class="sx-grid"><NewsCard v-for="n in d.items" :key="n.id" v-reveal :n="n" /></div>
        <div v-if="d && d.pages > 1" class="nw-pages">
          <button v-for="i in d.pages" :key="i" :class="{ on: i === d.page }" @click="load(i)">{{ i }}</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.nw-pages { display: flex; gap: 6px; justify-content: center; margin-top: 30px; }
.nw-pages button { width: 40px; height: 40px; border-radius: 12px; border: 1px solid var(--line); background: var(--paper); font: inherit; cursor: pointer; }
.nw-pages button.on { background: var(--primary); color: #fff; border-color: var(--primary); }
</style>
