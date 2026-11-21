<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import PageHead from '../PageHead.vue';
import Rich from '../Rich.vue';
import VisitorFields from '../VisitorFields.vue';
import { blankVisitor, setTitle, visitorBody } from '../parts';
import { AR, bySlug, C, post, site, visitMeta } from '../site';

/** مكتبة الأدلة: التحميل مقابل البريد، وكل تحميل يصل للنظام عميلًا محتملًا */
const g = computed(() => C().guides ?? {});
const guides = computed(() => site.data?.guides ?? []);
const openSlug = ref('');
const visitor = reactive(blankVisitor());
const sending = ref(false);
const err = ref('');
const links = reactive<Record<string, string>>({});
onMounted(() => setTitle('الأدلة المجانية'));

function choose(slug: string) { openSlug.value = slug; err.value = ''; }
async function request(slug: string) {
  err.value = '';
  sending.value = true;
  try {
    const r = await post<{ downloadUrl?: string }>(`/guides/${encodeURIComponent(slug)}`, { ...visitorBody(visitor), ...visitMeta() });
    links[slug] = r.downloadUrl ?? '';
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <PageHead :title="g.title || 'الأدلة المجانية'" :lead="g.lead" :crumbs="[{ l: 'الأدلة المجانية' }]" />
  <section class="band"><div class="wrap">
    <div v-if="!guides.length" class="card" style="display: grid; gap: 12px"><p><Rich :text="g.emptyText" /></p><RouterLink class="btn btn-primary" to="/contact" style="justify-self: start">تواصل معنا</RouterLink></div>
    <div v-else class="guide-grid">
      <article v-for="x in guides" :key="x.slug" class="guide-card">
        <div class="guide-cover"><img v-if="x.hasCover" :src="`/api/public/web/guides/${x.slug}/cover`" :alt="x.title" loading="lazy"><b v-else>{{ x.title }}</b></div>
        <h3>{{ x.title }}</h3>
        <p class="guide-meta"><template v-if="x.serviceSlug && bySlug(x.serviceSlug)">{{ bySlug(x.serviceSlug)!.title }}</template><template v-if="x.pages"> · {{ AR(x.pages) }} صفحة</template></p>
        <p>{{ x.summary }}</p>
        <div v-if="links[x.slug] !== undefined" class="ok-box" role="status">
          <template v-if="links[x.slug]"><p>الدليل جاهز للتحميل، ورابطه صالح لمدة ثلاثة أيام.</p><a class="btn btn-primary" :href="links[x.slug]" rel="nofollow">تحميل الدليل</a></template>
          <p v-else>استلمنا طلبكم.</p>
        </div>
        <form v-else-if="openSlug === x.slug" class="mini" @submit.prevent="request(x.slug)">
          <VisitorFields :model-value="visitor" :idp="`g-${x.slug}`" />
          <p v-if="err" class="err">{{ err }}</p>
          <button class="btn btn-primary" type="submit" :disabled="sending">{{ sending ? 'جارٍ التجهيز…' : 'احصلوا على الدليل' }}</button>
          <p class="note">نستخدم بريدكم لإرسال الدليل وما يتصل به فقط.</p>
        </form>
        <button v-else class="btn btn-primary" type="button" @click="choose(x.slug)">تحميل مجاني</button>
      </article>
    </div>
  </div></section>
</template>
