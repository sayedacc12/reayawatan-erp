<script setup lang="ts">
import { onMounted, ref } from 'vue';
import SiteIcon from '../SiteIcon.vue';
import OrgChart from '../parts/OrgChart.vue';
import PageHead from '../parts/PageHead.vue';
import { dateAr, useSite, vReveal } from '../site';

/* eslint-disable @typescript-eslint/no-explicit-any */
const site = useSite();
const g = ref<any>(null);
const err = ref('');
const cat = ref(0);
onMounted(async () => {
  try {
    g.value = await site.get('/governance');
  } catch (e) {
    err.value = (e as Error).message;
  }
});
const fileUrl = (id: string) => `/api/public/website/${site.slug}/documents/${id}/file${site.preview ? `?preview=${site.preview}` : ''}`;
</script>

<template>
  <div>
    <PageHead title="الحوكمة والشفافية" :text="g?.intro" />
    <div v-if="err" class="sx-wrap sx-err" style="margin-top: 20px">{{ err }}</div>
    <template v-if="g">
      <section v-if="g.showBoard && (g.leaders.length || g.boardRows.length)" class="sx-sec">
        <div class="sx-wrap">
          <div class="sx-head"><span class="sx-kicker">القيادة</span><h2>مجلس الإدارة والإدارة التنفيذية</h2></div>
          <div class="gv-leaders"><div v-for="(l, i) in g.leaders" :key="i" v-reveal class="gv-leader"><div class="gv-photo"><img v-if="l.photoUrl" :src="l.photoUrl" :alt="l.name" /><SiteIcon v-else name="users" :size="40" /></div><h3>{{ l.name }}</h3><span>{{ l.role }}</span></div></div>
          <div v-if="g.boardRows.length" v-reveal class="sx-card gv-rows"><div v-for="(r, i) in g.boardRows" :key="i"><small>{{ r.k }}</small><strong>{{ r.v }}</strong></div></div>
        </div>
      </section>
      <section v-if="g.showStructure" class="sx-sec alt">
        <div class="sx-wrap"><div class="sx-head"><span class="sx-kicker">التنظيم</span><h2>الهيكل التنظيمي</h2></div><OrgChart :s="g.structure" /></div>
      </section>
      <section v-if="g.disclosures.length" class="sx-sec">
        <div class="sx-wrap">
          <div class="sx-head"><span class="sx-kicker">الإفصاح</span><h2>تقارير وإفصاحات</h2></div>
          <div class="sx-grid">
            <div v-for="(x, i) in g.disclosures" :key="i" v-reveal class="sx-card gv-disc">
              <div class="gv-disc-h"><SiteIcon name="chart" :size="22" /><span v-if="x.status" class="gv-st">{{ x.status }}</span></div>
              <h3>{{ x.title }}</h3><p>{{ x.text }}</p>
              <a v-if="x.docId" :href="fileUrl(x.docId)" target="_blank" rel="noopener" class="sx-btn line sm"><SiteIcon name="download" :size="16" /> تحميل</a>
            </div>
          </div>
        </div>
      </section>
      <section v-if="g.showDocuments && g.documents.length" class="sx-sec alt">
        <div class="sx-wrap">
          <div class="sx-head"><span class="sx-kicker">المكتبة</span><h2>اللوائح والسياسات</h2><p>الوثائق المعتمدة المتاحة للعامة.</p></div>
          <div class="gv-cats"><button v-for="(c, i) in g.documents" :key="c.name" :class="{ on: cat === i }" :style="{ '--c': c.color }" @click="cat = i">{{ c.name }} <small>{{ c.items.length }}</small></button></div>
          <div class="gv-docs">
            <RouterLink v-for="dc in g.documents[cat]?.items ?? []" :key="dc.id" :to="site.to(`/documents/${dc.id}`)" class="gv-doc">
              <span class="gv-doc-ic" :style="{ '--c': g.documents[cat].color }"><SiteIcon name="doc" :size="22" /></span>
              <div><strong>{{ dc.title }}</strong><small>{{ dc.typeLabel }}<template v-if="dc.code"> · {{ dc.code }}</template> · الإصدار {{ dc.version }}<template v-if="dc.issuedOn"> · {{ dateAr(dc.issuedOn) }}</template></small></div>
              <SiteIcon name="arrow" :size="18" />
            </RouterLink>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.gv-leaders { display: flex; flex-wrap: wrap; justify-content: center; gap: 26px; margin-bottom: 30px; }
.gv-leader { text-align: center; width: 220px; }
.gv-photo { width: 150px; height: 150px; margin: 0 auto 12px; border-radius: 50%; padding: 5px; background: conic-gradient(from 0deg, var(--accent), var(--primary), var(--secondary), var(--accent)); animation: gv-spin 8s linear infinite; }
.gv-photo img, .gv-photo svg { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; background: var(--paper); animation: gv-spin 8s linear infinite reverse; display: block; }
.gv-photo svg { padding: 36px; box-sizing: border-box; color: var(--primary); }
@keyframes gv-spin { to { transform: rotate(360deg); } }
.gv-leader h3 { font-size: 1.1rem; }
.gv-leader span { color: var(--primary); font-weight: 600; font-size: .92rem; }
.gv-rows { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); padding: 8px; }
.gv-rows > div { padding: 16px 18px; display: grid; border-inline-start: 1px solid var(--line); }
.gv-rows > div:first-child { border-inline-start: 0; }
.gv-rows small { color: var(--text-2); }
.gv-disc { padding: 22px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.gv-disc-h { display: flex; justify-content: space-between; width: 100%; color: var(--primary); }
.gv-st { font-size: .78rem; padding: 2px 10px; border-radius: 999px; background: #ecfdf5; color: #047857; font-weight: 700; }
.gv-disc p { color: var(--text-2); margin: 0; flex: 1; font-size: .93rem; }
.gv-cats { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-bottom: 22px; }
.gv-cats button { padding: 8px 16px; border-radius: 999px; border: 1.5px solid var(--line); background: var(--paper); font: inherit; font-weight: 600; cursor: pointer; transition: all .2s; }
.gv-cats button small { opacity: .6; }
.gv-cats button.on { background: var(--c); border-color: var(--c); color: #fff; }
.gv-docs { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); gap: 12px; }
.gv-doc { display: flex; gap: 14px; align-items: center; padding: 16px 18px; border-radius: 16px; background: var(--paper); border: 1px solid var(--line); transition: transform .25s var(--ease2), box-shadow .25s; }
.gv-doc:hover { transform: translateX(-4px); box-shadow: 0 10px 24px rgba(16,32,31,.08); }
.gv-doc div { flex: 1; display: grid; }
.gv-doc small { color: var(--text-2); }
.gv-doc > svg:last-child { color: var(--text-2); }
.gv-doc-ic { width: 46px; height: 46px; border-radius: 13px; display: grid; place-items: center; background: color-mix(in srgb, var(--c) 14%, #fff); color: var(--c); flex-shrink: 0; }
</style>
