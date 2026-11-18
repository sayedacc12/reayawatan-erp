<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import SiteIcon from '../SiteIcon.vue';
import OrgChart from '../parts/OrgChart.vue';
import PageHead from '../parts/PageHead.vue';
import { dateAr, paras, useSite, vReveal } from '../site';

/* eslint-disable @typescript-eslint/no-explicit-any */
const site = useSite();
const d = computed(() => site.data.value);
const id = computed(() => d.value.identity);
const gov = ref<any>(null);
onMounted(async () => {
  if (d.value.about.showStructure) gov.value = await site.get('/governance').catch(() => null);
});
const VALUE_ICONS = ['shield', 'eye', 'star', 'heart', 'handshake', 'target', 'medal', 'leaf'];
</script>

<template>
  <div>
    <PageHead title="من نحن" :text="id.slogan" />
    <section class="sx-sec">
      <div class="sx-wrap ab-intro">
        <div v-reveal>
          <span class="sx-kicker">قصتنا</span>
          <h2 class="ab-h">{{ id.displayName }}</h2>
          <div class="sx-prose"><p v-for="(t, i) in paras(d.about.story || id.about)" :key="i">{{ t }}</p></div>
          <div class="ab-facts">
            <div v-if="id.foundedOn"><SiteIcon name="clock" :size="20" /><span><small>تاريخ التأسيس</small>{{ dateAr(id.foundedOn) }}</span></div>
            <div v-if="id.licenseNo"><SiteIcon name="shield" :size="20" /><span><small>رقم الترخيص</small>{{ id.licenseNo }}</span></div>
            <div v-if="id.contact?.city"><SiteIcon name="pin" :size="20" /><span><small>المقر</small>{{ id.contact.city }}</span></div>
          </div>
        </div>
        <div v-reveal class="ab-img"><img v-if="d.about.imageUrl" :src="d.about.imageUrl" alt="" /><div v-else class="ab-ph"><SiteIcon name="heart" :size="80" /></div><i /></div>
      </div>
    </section>
    <section class="sx-sec alt">
      <div class="sx-wrap">
        <div class="ab-vm">
          <div v-if="id.vision" v-reveal class="ab-vm-c"><SiteIcon name="eye" :size="30" /><h3>الرؤية</h3><p>{{ id.vision }}</p></div>
          <div v-if="id.mission" v-reveal class="ab-vm-c"><SiteIcon name="target" :size="30" /><h3>الرسالة</h3><p>{{ id.mission }}</p></div>
        </div>
        <div v-if="id.goals?.length" v-reveal style="margin-top: 40px">
          <div class="sx-head"><h2>أهدافنا</h2></div>
          <div class="ab-goals"><div v-for="(g, i) in id.goals" :key="i" class="ab-goal"><b>{{ String(i + 1).padStart(2, '0') }}</b><p>{{ g }}</p></div></div>
        </div>
      </div>
    </section>
    <section v-if="id.values?.length" class="sx-sec">
      <div class="sx-wrap">
        <div class="sx-head"><span class="sx-kicker">قيمنا</span><h2>ما نؤمن به</h2></div>
        <div class="sx-grid g4"><div v-for="(v, i) in id.values" :key="i" v-reveal class="sx-card ab-val"><SiteIcon :name="VALUE_ICONS[i % 8]" :size="28" /><h3>{{ v.title }}</h3><p>{{ v.text }}</p></div></div>
      </div>
    </section>
    <section v-if="gov" class="sx-sec alt">
      <div class="sx-wrap"><div class="sx-head"><span class="sx-kicker">الحوكمة</span><h2>الهيكل التنظيمي</h2></div><OrgChart :s="gov.structure" /></div>
    </section>
  </div>
</template>

<style scoped>
.ab-intro { display: grid; grid-template-columns: 1.1fr 1fr; gap: 44px; align-items: center; }
.ab-h { font-size: 2rem; margin: 6px 0 16px !important; }
.ab-facts { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 10px; }
.ab-facts > div { display: flex; gap: 10px; align-items: center; padding: 12px 16px; border-radius: 14px; background: var(--paper); border: 1px solid var(--line); }
.ab-facts svg { color: var(--primary); }
.ab-facts span { display: grid; line-height: 1.4; font-weight: 700; }
.ab-facts small { color: var(--text-2); font-weight: 400; }
.ab-img { position: relative; }
.ab-img img, .ab-ph { width: 100%; aspect-ratio: 4 / 3.4; object-fit: cover; border-radius: 26px; display: grid; place-items: center; background: var(--grad); color: rgba(255,255,255,.6); position: relative; z-index: 1; box-shadow: 0 30px 60px rgba(0,0,0,.15); }
.ab-img i { position: absolute; inset: 24px -18px -18px 24px; border-radius: 26px; border: 3px solid var(--accent); }
.ab-vm { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
.ab-vm-c { padding: 34px; border-radius: 24px; background: var(--soft); border: 1px solid var(--line); position: relative; overflow: hidden; }
.ab-vm-c::before { content: ''; position: absolute; inset-inline-start: 0; top: 0; bottom: 0; width: 5px; background: var(--grad); }
.ab-vm-c svg { color: var(--primary); }
.ab-vm-c h3 { font-size: 1.5rem; margin: 10px 0 8px; }
.ab-vm-c p { font-size: 1.08rem; color: var(--text-2); margin: 0; }
.ab-goals { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.ab-goal { padding: 22px; border-radius: 18px; background: var(--paper); border: 1px solid var(--line); transition: transform .3s var(--ease2), border-color .3s; }
.ab-goal:hover { transform: translateY(-4px); border-color: var(--primary); }
.ab-goal b { font-family: var(--sx-head); font-size: 2rem; background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
.ab-goal p { margin: 4px 0 0; }
.ab-val { text-align: center; padding: 26px 20px; }
.ab-val svg { color: var(--primary); }
.ab-val h3 { margin: 8px 0 4px; }
.ab-val p { color: var(--text-2); margin: 0; font-size: .93rem; }
@media (max-width: 860px) { .ab-intro, .ab-vm { grid-template-columns: 1fr; } }
</style>
