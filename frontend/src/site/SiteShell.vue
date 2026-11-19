<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SiteIcon from './SiteIcon.vue';
import { fontStack, loadFont, themeVars } from './fonts';
import { SITE, SOCIAL, publicApi, socialHref, type SiteCtx } from './site';
import './site.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const route = useRoute();
const router = useRouter();
const slug = route.params.slug as string;
const preview = (route.query.preview as string) || null;
const data = ref<any>(null);
const error = ref('');
const scrolled = ref(false);
const menu = ref(false);
const q = ref('');

const qs = (path: string) => `${path}${preview ? `${path.includes('?') ? '&' : '?'}preview=${encodeURIComponent(preview)}` : ''}`;
const PAGES = new Set(['donate', 'programs', 'news', 'about', 'governance', 'partners', 'contact']);
const ctx: SiteCtx = {
  slug, preview, data,
  to: (path = '') => ({ path: `/w/${slug}${path}`, query: (preview ? { preview } : {}) as Record<string, string> }),
  get: (path = '') => publicApi(qs(`/public/website/${slug}${path}`)),
  post: (path, body) => publicApi(`/public/website/${slug}${path}`, { method: 'POST', json: body }),
  target: (t) => {
    if (!t) return { internal: true, href: ctx.to() };
    if (/^https?:/.test(t)) return { internal: false, href: t };
    const [page, hash] = t.split('#');
    if (PAGES.has(page)) return { internal: true, href: { ...ctx.to(`/${page}`), hash: hash ? `#${hash}` : undefined } };
    const links = data.value?.links ?? {};
    return { internal: false, href: links[page] ?? '#' };
  },
};
provide(SITE, ctx);

onMounted(async () => {
  try {
    data.value = await ctx.get();
    const id = data.value.identity;
    loadFont(id.fonts?.body);
    loadFont(id.fonts?.heading);
    const desc = data.value.seo?.description || id.about || '';
    let m = document.querySelector('meta[name="description"]');
    if (!m) {
      m = document.createElement('meta');
      m.setAttribute('name', 'description');
      document.head.appendChild(m);
    }
    m.setAttribute('content', desc.slice(0, 300));
    setTitle();
  } catch (e) {
    error.value = (e as Error).message;
  }
  window.addEventListener('scroll', onScroll, { passive: true });
});
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll));
function onScroll() {
  scrolled.value = window.scrollY > 30;
}
function setTitle() {
  if (!data.value) return;
  const name = data.value.seo?.title || data.value.identity.displayName;
  document.title = route.meta.title ? `${route.meta.title} · ${name}` : name;
}
watch(() => route.fullPath, () => {
  menu.value = false;
  setTitle();
});

const style = computed(() => {
  const id = data.value?.identity;
  if (!id) return {};
  return { ...themeVars(id.colors), '--sx-font': fontStack(id.fonts?.body), '--sx-head': fontStack(id.fonts?.heading || id.fonts?.body) };
});
const id = computed(() => data.value?.identity ?? {});
const sec = computed(() => data.value?.sections ?? {});
const isHome = computed(() => route.path === `/w/${slug}` || route.path === `/w/${slug}/`);
const nav = computed(() => {
  const s = sec.value;
  return [
    ['', 'الرئيسية', true], ['/about', 'من نحن', s.about], ['/programs', 'برامجنا', s.programs], ['/news', 'الأخبار', s.news],
    ['/governance', 'الحوكمة والشفافية', s.governance], ['/partners', 'شركاؤنا', s.partners], ['/contact', 'تواصل معنا', s.contact],
  ].filter((x) => x[2]) as [string, string, boolean][];
});
const ann = computed(() => data.value?.home?.announcement);
const social = computed(() => SOCIAL.filter(([k]) => id.value.contact?.social?.[k]).map(([k, l]) => ({ k, l, href: socialHref(k, id.value.contact.social[k]) })));
const year = new Date().getFullYear();
function search() {
  if (q.value.trim().length < 2) return;
  router.push({ ...ctx.to('/search'), query: { ...ctx.to().query, q: q.value.trim() } });
  q.value = '';
}
const annTarget = computed(() => ctx.target(ann.value?.link));
</script>

<template>
  <div class="sx" :style="style">
    <div v-if="error" class="sx-empty" style="padding-top: 20vh"><h2>تعذر فتح الموقع</h2><p>{{ error }}</p></div>
    <template v-else-if="data">
      <div v-if="!data.published" class="sh-preview">معاينة: الموقع غير منشور بعد، ولا يراه إلا من معه هذا الرابط.</div>
      <header :class="['sh-head', { solid: scrolled || !isHome, home: isHome }]">
        <div v-if="ann?.on && ann.text" class="sh-ann">
        <component :is="annTarget.internal ? 'RouterLink' : 'a'" v-bind="annTarget.internal ? { to: annTarget.href } : { href: annTarget.href }"><SiteIcon name="megaphone" :size="16" /> {{ ann.text }} <span v-if="ann.link">←</span></component>
      </div>
        <div class="sx-wrap sh-bar">
          <RouterLink :to="ctx.to()" class="sh-brand">
            <img v-if="id.logoUrl" :src="(scrolled || !isHome) ? id.logoUrl : id.logoLightUrl || id.logoUrl" :alt="id.displayName" />
            <span><strong>{{ id.shortName || id.displayName }}</strong><small v-if="id.englishName">{{ id.englishName }}</small></span>
          </RouterLink>
          <nav class="sh-nav">
            <RouterLink v-for="[p, l] in nav" :key="p" :to="ctx.to(p)" :class="{ on: p ? route.path.startsWith(`/w/${slug}${p}`) : isHome }">{{ l }}</RouterLink>
          </nav>
          <div class="sh-tools">
            <RouterLink :to="ctx.to('/search')" class="sh-icon" title="بحث"><SiteIcon name="search" :size="19" /></RouterLink>
            <div v-if="sec.portal || sec.staff" class="sh-gates">
              <a v-if="sec.portal" :href="data.links.portal" class="sh-gate" title="بوابة المستفيدين"><SiteIcon name="users" :size="16" /><span><em>بوابة </em>المستفيدين</span></a>
              <a v-if="sec.staff" :href="data.links.login" class="sh-gate" title="بوابة الموظفين"><SiteIcon name="building" :size="16" /><span><em>بوابة </em>الموظفين</span></a>
            </div>
            <RouterLink v-if="sec.store && data.store.enabled" :to="ctx.to('/donate')" class="sx-btn main sm"><SiteIcon name="heart" :size="16" /> تبرع الآن</RouterLink>
            <button class="sh-icon sh-burger" aria-label="القائمة" @click="menu = !menu"><SiteIcon :name="menu ? 'x' : 'menu'" :size="22" /></button>
          </div>
        </div>
      </header>
      <transition name="sh-fade">
        <div v-if="menu" class="sh-drawer" @click.self="menu = false">
          <nav>
            <div v-if="sec.portal || sec.staff" class="sh-drawer-gates">
              <a v-if="sec.portal" :href="data.links.portal" class="sh-drawer-gate ben"><SiteIcon name="users" :size="20" /><span><b>بوابة المستفيدين</b><small>قدّم طلبك وتابعه</small></span></a>
              <a v-if="sec.staff" :href="data.links.login" class="sh-drawer-gate staff"><SiteIcon name="building" :size="20" /><span><b>بوابة الموظفين</b><small>دخول فريق العمل</small></span></a>
            </div>
            <RouterLink v-for="[p, l] in nav" :key="p" :to="ctx.to(p)">{{ l }}</RouterLink>
            <a v-if="sec.volunteer" :href="data.links.volunteer">التطوع</a>
            <a v-if="sec.membership" :href="data.links.membership">العضوية</a>
          </nav>
        </div>
      </transition>

      <main><RouterView v-slot="{ Component }"><transition name="sh-page" mode="out-in"><component :is="Component" :key="route.path + (route.query.gift ? '~gift' : '')" /></transition></RouterView></main>

      <footer class="sh-foot">
        <div class="sh-foot-glow" />
        <div class="sx-wrap sh-foot-grid">
          <div>
            <div class="sh-brand light"><img v-if="id.logoLightUrl || id.logoUrl" :src="id.logoLightUrl || id.logoUrl" alt="" /><span><strong>{{ id.displayName }}</strong></span></div>
            <p class="sh-about">{{ id.slogan || id.about?.slice(0, 160) }}</p>
            <form class="sh-search" @submit.prevent="search"><input v-model="q" placeholder="ابحث في الموقع..." /><button aria-label="بحث"><SiteIcon name="search" :size="18" /></button></form>
            <div v-if="social.length" class="sh-social"><a v-for="s in social" :key="s.k" :href="s.href" target="_blank" rel="noopener" :title="s.l"><SiteIcon :name="s.k" :size="18" /></a></div>
          </div>
          <div>
            <h4>روابط</h4>
            <RouterLink v-for="[p, l] in nav.slice(1)" :key="p" :to="ctx.to(p)">{{ l }}</RouterLink>
            <RouterLink :to="ctx.to('/verify')">التحقق من إيصال</RouterLink>
          </div>
          <div>
            <h4>شارك معنا</h4>
            <RouterLink v-if="sec.store" :to="ctx.to('/donate')">تبرع</RouterLink>
            <a v-if="sec.volunteer" :href="data.links.volunteer">سجّل متطوعًا</a>
            <a v-if="sec.membership" :href="data.links.membership">عضوية الجمعية العمومية</a>
            <a v-if="sec.portal" :href="data.links.portal">بوابة المستفيدين</a>
            <a v-if="sec.staff" :href="data.links.login">بوابة الموظفين</a>
          </div>
          <div>
            <h4>تواصل معنا</h4>
            <p v-if="id.contact?.address"><SiteIcon name="pin" :size="16" /> {{ id.contact.address }}<template v-if="id.contact.city">، {{ id.contact.city }}</template></p>
            <p v-if="id.contact?.phone"><SiteIcon name="phone" :size="16" /> <a :href="`tel:${id.contact.phone}`" dir="ltr">{{ id.contact.phone }}</a></p>
            <p v-if="id.contact?.email"><SiteIcon name="mail" :size="16" /> <a :href="`mailto:${id.contact.email}`">{{ id.contact.email }}</a></p>
            <p v-if="id.contact?.workingHours"><SiteIcon name="clock" :size="16" /> {{ id.contact.workingHours }}</p>
          </div>
        </div>
        <div class="sx-wrap sh-copy">
          <span>© {{ year }} {{ id.displayName }}<template v-if="id.licenseNo"> · ترخيص رقم {{ id.licenseNo }}<template v-if="id.licenseAuthority"> ({{ id.licenseAuthority }})</template></template></span>
          <span v-if="data.footerText">{{ data.footerText }}</span>
          <span class="sh-powered">يعمل بمنصة سنابل</span>
        </div>
      </footer>
    </template>
    <div v-else class="sh-loading"><i /><i /><i /></div>
  </div>
</template>

<style scoped>
.sh-preview { background: #fef3c7; color: #92400e; text-align: center; padding: 6px 12px; font-size: .88rem; }
.sh-ann { background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #fff), var(--accent)); background-size: 200% 100%; animation: sh-slide 6s linear infinite; text-align: center; padding: 8px 16px; font-weight: 700; color: var(--dark); font-size: .92rem; }
.sh-ann a { display: inline-flex; align-items: center; gap: 8px; }
@keyframes sh-slide { to { background-position: -200% 0; } }
.sh-head { position: sticky; top: 0; z-index: 50; transition: background .35s, box-shadow .35s, color .35s; color: var(--ink); background: rgba(255,255,255,.92); backdrop-filter: blur(14px); }
.sh-head.home:not(.solid) { position: absolute; top: 0; inset-inline: 0; background: transparent; color: #fff; backdrop-filter: none; }
.sh-head.solid { box-shadow: 0 6px 24px rgba(16,32,31,.08); }
.sh-bar { display: flex; align-items: center; gap: 20px; height: 76px; }
.sh-brand { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.sh-brand img { height: 48px; width: auto; max-width: 130px; object-fit: contain; }
.sh-brand span { display: grid; line-height: 1.25; }
.sh-brand strong { font-family: var(--sx-head); font-size: 1.12rem; }
.sh-brand small { font-size: .7rem; opacity: .7; letter-spacing: .02em; direction: ltr; text-align: right; }
.sh-nav { display: flex; gap: 2px; margin-inline-start: auto; }
.sh-nav a { padding: 8px 12px; border-radius: 999px; font-weight: 600; font-size: .94rem; position: relative; transition: background .2s, color .2s; }
.sh-nav a::after { content: ''; position: absolute; bottom: 2px; inset-inline: 30%; height: 2px; border-radius: 2px; background: var(--accent); transform: scaleX(0); transition: transform .3s var(--ease2); }
.sh-nav a:hover::after, .sh-nav a.on::after { transform: scaleX(1); }
.sh-nav a.on { color: var(--primary); }
.sh-head.home:not(.solid) .sh-nav a.on { color: var(--accent); }
.sh-tools { display: flex; align-items: center; gap: 8px; }
.sh-icon { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: transparent; border: 0; color: inherit; cursor: pointer; transition: background .2s; }
.sh-icon:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.sh-burger { display: none; }
.sh-gates { display: flex; gap: 6px; }
.sh-gate { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 999px; font-weight: 700; font-size: .84rem; white-space: nowrap; border: 1.5px solid color-mix(in srgb, currentColor 30%, transparent); transition: background .2s, border-color .2s, transform .2s; }
.sh-gate:hover { background: color-mix(in srgb, var(--primary) 12%, transparent); border-color: var(--primary); transform: translateY(-1px); }
.sh-head.home:not(.solid) .sh-gate:hover { background: rgba(255,255,255,.14); border-color: var(--accent); }
.sh-gate svg { color: var(--accent); flex-shrink: 0; }
.sh-head.solid .sh-gate svg, .sh-head:not(.home) .sh-gate svg { color: var(--primary); }
.sh-drawer-gates { display: grid; gap: 8px; margin-bottom: 12px; padding-bottom: 14px; border-bottom: 1px solid var(--line, #e5e7eb); }
.sh-drawer a.sh-drawer-gate { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 14px; color: #fff; }
.sh-drawer-gate.ben { background: linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 70%, #000)); }
.sh-drawer-gate.staff { background: linear-gradient(135deg, var(--dark, #10201f), color-mix(in srgb, var(--dark, #10201f) 75%, var(--primary))); }
.sh-drawer-gate span { display: grid; line-height: 1.3; }
.sh-drawer-gate small { font-weight: 500; opacity: .8; font-size: .78rem; }
.sh-drawer a.sh-drawer-gate:hover { color: #fff; filter: brightness(1.08); }
.sh-drawer { position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,.4); backdrop-filter: blur(4px); }
.sh-drawer nav { position: absolute; top: 0; bottom: 0; inset-inline-start: 0; width: min(300px, 82vw); background: var(--paper); padding: 90px 20px 20px; display: grid; align-content: start; gap: 4px; box-shadow: 0 0 40px rgba(0,0,0,.2); }
.sh-drawer a { padding: 12px 14px; border-radius: 12px; font-weight: 600; }
.sh-drawer a:hover, .sh-drawer a.router-link-active { background: var(--primary-soft); color: var(--primary); }
.sh-fade-enter-active, .sh-fade-leave-active { transition: opacity .25s; }
.sh-fade-enter-from, .sh-fade-leave-to { opacity: 0; }
.sh-page-enter-active, .sh-page-leave-active { transition: opacity .25s, transform .25s; }
.sh-page-enter-from { opacity: 0; transform: translateY(10px); }
.sh-page-leave-to { opacity: 0; }

.sh-foot { position: relative; overflow: hidden; background: var(--grad-dark); color: rgba(255,255,255,.82); padding: 64px 0 0; margin-top: 0; }
.sh-foot-glow { position: absolute; width: 520px; height: 520px; border-radius: 50%; background: radial-gradient(circle, color-mix(in srgb, var(--secondary) 40%, transparent), transparent 70%); top: -260px; inset-inline-end: -120px; }
.sh-foot-grid { position: relative; display: grid; grid-template-columns: 1.5fr 1fr 1fr 1.3fr; gap: 32px; }
.sh-foot h4 { color: #fff; margin-bottom: 14px; font-size: 1.05rem; }
.sh-foot-grid > div:not(:first-child) { display: flex; flex-direction: column; gap: 8px; font-size: .93rem; }
.sh-foot-grid a:hover { color: var(--accent); }
.sh-foot-grid p { display: flex; gap: 8px; align-items: flex-start; margin: 0; }
.sh-foot-grid p svg { margin-top: 5px; flex-shrink: 0; color: var(--accent); }
.sh-brand.light { color: #fff; margin-bottom: 12px; }
.sh-about { font-size: .93rem; opacity: .85; }
.sh-search { display: flex; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.2); border-radius: 999px; overflow: hidden; margin: 12px 0; }
.sh-search input { flex: 1; min-width: 0; background: transparent; border: 0; color: #fff; padding: 10px 16px; font: inherit; }
.sh-search input::placeholder { color: rgba(255,255,255,.6); }
.sh-search input:focus { outline: 0; }
.sh-search button { background: var(--accent); border: 0; color: var(--dark); padding: 0 16px; cursor: pointer; }
.sh-social { display: flex; gap: 8px; flex-wrap: wrap; }
.sh-social a { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: rgba(255,255,255,.1); transition: background .25s, transform .25s; }
.sh-social a:hover { background: var(--accent); color: var(--dark); transform: translateY(-3px); }
.sh-copy { position: relative; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; border-top: 1px solid rgba(255,255,255,.12); margin-top: 44px; padding-top: 18px; padding-bottom: 22px; font-size: .82rem; opacity: .75; }
.sh-powered { opacity: .8; }
.sh-loading { min-height: 100vh; display: flex; align-items: center; justify-content: center; gap: 10px; }
.sh-loading i { width: 14px; height: 14px; border-radius: 50%; background: #0f766e; animation: sh-dot 1s infinite alternate; }
.sh-loading i:nth-child(2) { animation-delay: .2s; } .sh-loading i:nth-child(3) { animation-delay: .4s; }
@keyframes sh-dot { to { transform: translateY(-14px); opacity: .4; } }
.sh-gate em { font-style: normal; }
@media (max-width: 1600px) { .sh-gate em { display: none; } .sh-gate { padding: 7px 10px; } .sh-nav a { padding: 8px 8px; font-size: .9rem; } .sh-bar { gap: 14px; } }
.sh-nav a { white-space: nowrap; }
@media (max-width: 1280px) { .sh-gate span { display: none; } .sh-gate { padding: 0; width: 38px; height: 38px; justify-content: center; } }
@media (max-width: 1080px) { .sh-nav { display: none; } .sh-burger { display: grid; } .sh-tools { margin-inline-start: auto; } .sh-gate span, .sh-gate em { display: inline; } .sh-gate { padding: 7px 12px; width: auto; height: auto; } }
@media (max-width: 720px) { .sh-gates { display: none; } }
@media (max-width: 860px) { .sh-foot-grid { grid-template-columns: 1fr 1fr; } }
@media (max-width: 560px) { .sh-foot-grid { grid-template-columns: 1fr; } .sh-brand small { display: none; } .sh-bar { gap: 10px; height: 66px; } .sh-brand img { height: 40px; } }
</style>
