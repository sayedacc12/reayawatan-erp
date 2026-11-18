<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import SiteIcon from '../SiteIcon.vue';
import PageHead from '../parts/PageHead.vue';
import { dateAr, paras, useSite } from '../site';

/* eslint-disable @typescript-eslint/no-explicit-any */
const route = useRoute();
const site = useSite();
const d = ref<any>(null);
const err = ref('');
onMounted(async () => {
  try {
    d.value = await site.get(`/documents/${route.params.id}`);
  } catch (e) {
    err.value = (e as Error).message;
  }
});
const file = () => `/api/public/website/${site.slug}/documents/${route.params.id}/file${site.preview ? `?preview=${site.preview}` : ''}`;
</script>

<template>
  <div>
    <PageHead :title="d?.title ?? 'وثيقة'" :text="d?.summary" :crumb="['/governance', 'الحوكمة والشفافية']" />
    <section class="sx-sec">
      <div class="sx-wrap" style="max-width: 860px">
        <div v-if="err" class="sx-err">{{ err }}</div>
        <div v-else-if="d" class="sx-card dc">
          <div class="dc-meta">
            <div><small>النوع</small>{{ d.typeLabel }}</div>
            <div v-if="d.code"><small>الرمز</small>{{ d.code }}</div>
            <div><small>الإصدار</small>{{ d.version }}</div>
            <div v-if="d.issuedOn"><small>تاريخ الإصدار</small>{{ dateAr(d.issuedOn) }}</div>
          </div>
          <div v-if="d.content" class="sx-prose"><p v-for="(t, i) in paras(d.content)" :key="i">{{ t }}</p></div>
          <div class="dc-actions">
            <a v-if="d.hasFile" :href="file()" target="_blank" rel="noopener" class="sx-btn prim"><SiteIcon name="download" :size="18" /> تحميل الوثيقة</a>
            <a v-if="d.externalUrl" :href="d.externalUrl" target="_blank" rel="noopener" class="sx-btn line">فتح الرابط ↗</a>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.dc { padding: 28px; }
.dc-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 20px; }
.dc-meta > div { padding: 12px 14px; border-radius: 12px; background: var(--soft); display: grid; font-weight: 700; }
.dc-meta small { color: var(--text-2); font-weight: 400; }
.dc-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
</style>
