<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import SiteIcon from '../SiteIcon.vue';
import DonateBox from '../parts/DonateBox.vue';
import { dateAr, num, paras, sar, useSite, vReveal } from '../site';

/* eslint-disable @typescript-eslint/no-explicit-any */
const route = useRoute();
const site = useSite();
const p = ref<any>(null);
const err = ref('');
onMounted(async () => {
  try {
    p.value = await site.get(`/programs/${route.params.pslug}`);
    document.title = `${p.value.name} · ${site.data.value.identity.displayName}`;
    if (route.hash === '#donate') {
      await nextTick();
      document.getElementById('donate')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (e) {
    err.value = (e as Error).message;
  }
});
const pct = computed(() => (p.value?.donate?.goal ? Math.min(100, Math.round((p.value.donate.raised / p.value.donate.goal) * 100)) : 0));
const showStore = computed(() => site.data.value.sections.store && site.data.value.store.enabled && p.value?.donate);
</script>

<template>
  <div>
    <div v-if="err" class="sx-empty" style="padding-top: 120px"><h2>{{ err }}</h2><RouterLink :to="site.to('/programs')" class="sx-btn line" style="margin-top: 16px">كل البرامج</RouterLink></div>
    <template v-else-if="p">
      <section class="pp-hero">
        <div class="pp-bg" :style="p.imageUrl ? { backgroundImage: `url(${p.imageUrl})` } : {}" />
        <div class="sx-wrap pp-in">
          <div class="sx-crumbs"><RouterLink :to="site.to()">الرئيسية</RouterLink><span>/</span><RouterLink :to="site.to('/programs')">برامجنا</RouterLink></div>
          <span class="pp-ic"><SiteIcon :name="p.icon" :size="30" /></span>
          <h1>{{ p.name }}</h1>
          <p v-if="p.tagline" class="pp-tag">{{ p.tagline }}</p>
          <div v-if="p.donate" class="pp-raised">
            <div><small>جُمع حتى الآن</small><strong>{{ sar(p.donate.raised) }}</strong></div>
            <div v-if="p.donate.goal"><small>المستهدف</small><strong>{{ sar(p.donate.goal) }}</strong></div>
            <div><small>عدد التبرعات</small><strong>{{ num(p.donate.count) }}</strong></div>
            <div v-if="p.donate.endDate"><small>تنتهي الحملة</small><strong>{{ dateAr(p.donate.endDate) }}</strong></div>
          </div>
          <div v-if="p.donate?.goal" class="sx-bar pp-bar"><i :style="{ width: `${Math.max(3, pct)}%` }" /></div>
        </div>
      </section>
      <section class="sx-sec">
        <div class="sx-wrap pp-grid">
          <div>
            <div v-reveal class="sx-card pp-block"><h2>عن البرنامج</h2><p class="pp-sum">{{ p.summary }}</p><div class="sx-prose"><p v-for="(t, i) in paras(p.about)" :key="i">{{ t }}</p></div></div>
            <div v-if="p.services?.length" v-reveal class="pp-block-plain">
              <h2>ماذا نقدم</h2>
              <div class="pp-services"><div v-for="(s, i) in p.services" :key="i" class="pp-svc"><span><SiteIcon :name="s.icon" :size="24" /></span><div><h3>{{ s.title }}</h3><p>{{ s.text }}</p></div></div></div>
            </div>
            <div v-if="p.points?.length || p.audience || p.timing" v-reveal class="sx-card pp-block">
              <div class="pp-facts">
                <div v-if="p.audience"><SiteIcon name="users" :size="20" /><div><small>الفئة المستهدفة</small>{{ p.audience }}</div></div>
                <div v-if="p.timing"><SiteIcon name="clock" :size="20" /><div><small>مدة التنفيذ</small>{{ p.timing }}</div></div>
              </div>
              <ul v-if="p.points?.length" class="pp-points"><li v-for="(x, i) in p.points" :key="i"><SiteIcon name="check" :size="18" />{{ x }}</li></ul>
            </div>
            <RouterLink v-if="p.kit" :to="site.to(`/documents/${p.kit.id}`)" class="sx-card pp-kit"><SiteIcon name="doc" :size="26" /><div><strong>{{ p.kit.title }}</strong><small>اطلع على الحقيبة التعريفية للبرنامج</small></div><SiteIcon name="download" :size="20" /></RouterLink>
          </div>
          <aside v-if="showStore" class="pp-side"><DonateBox :program="p" /></aside>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.pp-hero { position: relative; overflow: hidden; color: #fff; padding: 64px 0 54px; background: var(--dark); }
.pp-bg { position: absolute; inset: 0; background: var(--grad-dark) center / cover; opacity: .35; filter: saturate(1.1); }
.pp-hero::after { content: ''; position: absolute; inset: 0; background: linear-gradient(0deg, var(--dark), transparent 70%); }
.pp-in { position: relative; z-index: 1; }
.pp-ic { width: 64px; height: 64px; border-radius: 18px; display: grid; place-items: center; background: var(--accent); color: var(--dark); margin: 6px 0 14px; box-shadow: 0 10px 30px color-mix(in srgb, var(--accent) 45%, transparent); }
.pp-hero h1 { font-size: clamp(1.9rem, 4.5vw, 3rem); }
.pp-tag { font-size: 1.15rem; opacity: .85; margin-top: 6px; }
.pp-raised { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 22px; }
.pp-raised > div { padding: 12px 18px; border-radius: 14px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.16); backdrop-filter: blur(6px); display: grid; min-width: 130px; }
.pp-raised small { opacity: .75; }
.pp-raised strong { font-size: 1.25rem; color: var(--accent); }
.pp-bar { margin-top: 18px; max-width: 640px; background: rgba(255,255,255,.18); height: 11px; }
.pp-grid { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 28px; align-items: start; }
.pp-side { position: sticky; top: 96px; }
.pp-block { padding: 28px; margin-bottom: 22px; }
.pp-block h2, .pp-block-plain h2 { font-size: 1.45rem; margin-bottom: 12px; color: var(--primary); }
.pp-block-plain { margin-bottom: 22px; }
.pp-sum { font-size: 1.1rem; font-weight: 600; }
.pp-services { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
.pp-svc { display: flex; gap: 14px; padding: 18px; border-radius: 16px; background: var(--paper); border: 1px solid var(--line); transition: transform .3s var(--ease2), box-shadow .3s; }
.pp-svc:hover { transform: translateY(-4px); box-shadow: 0 14px 30px color-mix(in srgb, var(--primary) 12%, transparent); }
.pp-svc > span { flex-shrink: 0; width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; background: color-mix(in srgb, var(--primary) 10%, #fff); color: var(--primary); }
.pp-svc h3 { font-size: 1.05rem; }
.pp-svc p { margin: 4px 0 0; color: var(--text-2); font-size: .92rem; }
.pp-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 14px; }
.pp-facts > div { display: flex; gap: 10px; align-items: flex-start; }
.pp-facts svg { color: var(--primary); margin-top: 4px; flex-shrink: 0; }
.pp-facts small { display: block; color: var(--text-2); }
.pp-points { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
.pp-points li { display: flex; gap: 10px; align-items: flex-start; }
.pp-points svg { color: #10b981; margin-top: 5px; flex-shrink: 0; }
.pp-kit { display: flex; gap: 14px; align-items: center; padding: 18px 22px; color: var(--primary); transition: transform .25s; }
.pp-kit:hover { transform: translateY(-3px); }
.pp-kit div { flex: 1; display: grid; color: var(--ink); }
.pp-kit small { color: var(--text-2); }
@media (max-width: 980px) { .pp-grid { grid-template-columns: 1fr; } .pp-side { position: static; } }
</style>
