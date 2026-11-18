<script setup lang="ts">
import { computed, ref } from 'vue';
import PageHead from '../parts/PageHead.vue';
import ProgramCard from '../parts/ProgramCard.vue';
import { useSite, vReveal } from '../site';

/* eslint-disable @typescript-eslint/no-explicit-any */
const site = useSite();
const filter = ref<'all' | 'open' | 'waqf'>('all');
const list = computed(() => (site.data.value.programs as any[]).filter((p) => filter.value === 'all' || (filter.value === 'open' ? p.donate?.open : p.donate?.kind === 'waqf')));
</script>

<template>
  <div>
    <PageHead title="برامجنا ومشاريعنا" text="برامج معتمدة بأهداف واضحة ونتائج قابلة للقياس. تبرعك يُصرف في وجهه، ويصلك إيصال فوري." />
    <section class="sx-sec">
      <div class="sx-wrap">
        <div class="pr-tabs">
          <button :class="{ on: filter === 'all' }" @click="filter = 'all'">كل البرامج</button>
          <button :class="{ on: filter === 'open' }" @click="filter = 'open'">مفتوحة للتبرع</button>
          <button :class="{ on: filter === 'waqf' }" @click="filter = 'waqf'">الأوقاف</button>
        </div>
        <div v-if="!list.length" class="sx-empty">لا توجد برامج هنا حاليًا</div>
        <div class="sx-grid"><ProgramCard v-for="p in list" :key="p.id" v-reveal :p="p" /></div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pr-tabs { display: flex; gap: 8px; justify-content: center; margin-bottom: 30px; flex-wrap: wrap; }
.pr-tabs button { padding: 9px 20px; border-radius: 999px; border: 1.5px solid var(--line); background: var(--paper); font: inherit; font-weight: 600; cursor: pointer; color: var(--text-2); transition: all .2s; }
.pr-tabs button.on { background: var(--primary); border-color: var(--primary); color: #fff; box-shadow: 0 8px 18px color-mix(in srgb, var(--primary) 30%, transparent); }
</style>
