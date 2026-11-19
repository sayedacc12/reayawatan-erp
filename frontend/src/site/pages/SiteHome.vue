<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import SiteIcon from '../SiteIcon.vue';
import NewsCard from '../parts/NewsCard.vue';
import ProgramCard from '../parts/ProgramCard.vue';
import { num, sar, useSite, vReveal } from '../site';

/* eslint-disable @typescript-eslint/no-explicit-any */
const site = useSite();
const d = computed(() => site.data.value);
const id = computed(() => d.value.identity);
const home = computed(() => d.value.home);
const sec = computed(() => d.value.sections);
const featured = computed(() => {
  const ps = d.value.programs as any[];
  const f = ps.filter((p) => p.featured);
  return (f.length >= 3 ? f : ps).slice(0, 6);
});
const ticker = computed(() => (d.value.news as any[]).filter((n) => n.ticker));
const cta1 = computed(() => site.target(home.value.primaryCta?.target));
const cta2 = computed(() => site.target(home.value.secondaryCta?.target));

// عدّاد الأرقام عند الظهور
const shown = ref<string[]>(home.value.stats.map(() => '0'));
const statsEl = ref<HTMLElement | null>(null);
function animate() {
  home.value.stats.forEach((s: any, i: number) => {
    const target = Number(String(s.value).replace(/[^\d.]/g, ''));
    const suffix = String(s.value).replace(/[\d.,٬]/g, '');
    if (!target) return void (shown.value[i] = s.value);
    const start = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 1600);
      const e = 1 - Math.pow(1 - k, 3);
      shown.value[i] = `${num(Math.round(target * e))}${suffix}`;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
onMounted(() => {
  if (!statsEl.value || typeof IntersectionObserver === 'undefined') return animate();
  const io = new IntersectionObserver((es) => {
    if (es.some((e) => e.isIntersecting)) {
      animate();
      io.disconnect();
    }
  }, { threshold: 0.3 });
  io.observe(statsEl.value);
});
const VALUE_ICONS = ['shield', 'eye', 'star', 'heart', 'handshake', 'target', 'medal', 'leaf'];
</script>

<template>
  <div>
    <!-- الواجهة -->
    <section class="hm-hero">
      <div class="hm-bg" :style="home.imageUrl ? { backgroundImage: `url(${home.imageUrl})` } : {}" />
      <div class="hm-shade" />
      <div class="hm-orbs"><i /><i /><i /></div>
      <div class="hm-grain" />
      <div class="sx-wrap hm-in">
        <span v-if="home.kicker" class="hm-kicker">{{ home.kicker }}</span>
        <h1 class="hm-title">{{ home.title }}</h1>
        <p class="hm-text">{{ home.text }}</p>
        <div class="hm-ctas">
          <component :is="cta1.internal ? 'RouterLink' : 'a'" v-if="home.primaryCta?.label" v-bind="cta1.internal ? { to: cta1.href } : { href: cta1.href }" class="sx-btn main"><SiteIcon name="heart" :size="18" /> {{ home.primaryCta.label }}</component>
          <component :is="cta2.internal ? 'RouterLink' : 'a'" v-if="home.secondaryCta?.label" v-bind="cta2.internal ? { to: cta2.href } : { href: cta2.href }" class="sx-btn ghost">{{ home.secondaryCta.label }}</component>
        </div>
        <div v-if="sec.store && d.store.totals?.count" class="hm-live">
          <span class="hm-pulse" /> <b>{{ sar(d.store.totals.raised) }}</b> تبرعات وصلت عبر الموقع من <b>{{ num(d.store.totals.count) }}</b> متبرعًا
        </div>
      </div>
      <div class="hm-scroll"><span /></div>
    </section>

    <!-- شريط الأخبار -->
    <div v-if="home.showTicker && sec.news && ticker.length" class="hm-ticker">
      <span class="hm-ticker-l"><SiteIcon name="megaphone" :size="16" /> آخر الأخبار</span>
      <div class="hm-ticker-track"><div class="hm-ticker-move">
        <RouterLink v-for="(n, i) in [...ticker, ...ticker]" :key="i" :to="site.to(`/news/${n.id}`)">{{ n.title }}</RouterLink>
      </div></div>
    </div>

    <!-- البوابات: المستفيدون والموظفون -->
    <section v-if="sec.portal || sec.staff" class="hm-gates">
      <div :class="['sx-wrap', 'hm-gates-in', { one: !(sec.portal && sec.staff) }]">
        <a v-if="sec.portal" v-reveal :href="d.links.portal" class="hm-gate ben">
          <span class="hm-gate-ic"><SiteIcon name="users" :size="28" /></span>
          <span class="hm-gate-tx"><b>بوابة المستفيدين</b><small>سجّل برقم هويتك، وقدّم طلبك، وتابع مراحله حتى الاعتماد.</small></span>
          <span class="hm-gate-go">دخول ←</span>
        </a>
        <a v-if="sec.staff" v-reveal :href="d.links.login" class="hm-gate staff" style="transition-delay: 90ms">
          <span class="hm-gate-ic"><SiteIcon name="building" :size="28" /></span>
          <span class="hm-gate-tx"><b>بوابة الموظفين</b><small>دخول فريق عمل الجمعية إلى أنظمتها ومهامهم اليومية.</small></span>
          <span class="hm-gate-go">دخول ←</span>
        </a>
      </div>
    </section>

    <!-- الأرقام -->
    <section v-if="home.stats.length" ref="statsEl" class="hm-stats">
      <div class="sx-wrap hm-stats-in">
        <div v-for="(s, i) in home.stats" :key="i" v-reveal class="hm-stat" :style="{ transitionDelay: `${i * 90}ms` }"><strong>{{ shown[i] }}</strong><span>{{ s.label }}</span></div>
      </div>
    </section>

    <!-- الرؤية والرسالة والأهداف -->
    <section v-if="home.showGoals && (id.vision || id.mission)" class="sx-sec">
      <div class="sx-wrap">
        <div v-reveal class="sx-head"><span class="sx-kicker">من نحن</span><h2>{{ id.displayName }}</h2><p>{{ id.about }}</p></div>
        <div class="hm-vm">
          <div v-if="id.vision" v-reveal class="hm-vm-card v"><span class="hm-vm-ic"><SiteIcon name="eye" :size="26" /></span><h3>رؤيتنا</h3><p>{{ id.vision }}</p></div>
          <div v-if="id.mission" v-reveal class="hm-vm-card m"><span class="hm-vm-ic"><SiteIcon name="target" :size="26" /></span><h3>رسالتنا</h3><p>{{ id.mission }}</p></div>
        </div>
        <div v-if="id.goals?.length" v-reveal class="hm-goals sx-card">
          <h3><SiteIcon name="check" :size="20" /> أهدافنا</h3>
          <ol><li v-for="(g, i) in id.goals" :key="i"><span>{{ i + 1 }}</span>{{ g }}</li></ol>
        </div>
      </div>
    </section>

    <!-- البرامج -->
    <section v-if="sec.programs && featured.length" class="sx-sec alt">
      <div class="sx-wrap">
        <div v-reveal class="sx-head"><span class="sx-kicker">برامجنا</span><h2>أثر يصل لمن يحتاجه</h2><p>اختر البرنامج الذي يلامس قلبك، وتابع أثر تبرعك بشفافية.</p></div>
        <div class="sx-grid"><ProgramCard v-for="(p, i) in featured" :key="p.id" v-reveal :p="p" :style="{ transitionDelay: `${(i % 3) * 100}ms` }" /></div>
        <div style="text-align: center; margin-top: 30px"><RouterLink :to="site.to('/programs')" class="sx-btn line">كل البرامج ←</RouterLink></div>
      </div>
    </section>

    <!-- القيم -->
    <section v-if="home.showValues && id.values?.length" class="sx-sec hm-values">
      <div class="sx-wrap">
        <div v-reveal class="sx-head"><span class="sx-kicker">قيمنا</span><h2>ما نؤمن به</h2></div>
        <div class="sx-grid g4">
          <div v-for="(v, i) in id.values" :key="i" v-reveal class="hm-val" :style="{ transitionDelay: `${i * 80}ms` }"><span><SiteIcon :name="VALUE_ICONS[i % VALUE_ICONS.length]" :size="26" /></span><h3>{{ v.title }}</h3><p>{{ v.text }}</p></div>
        </div>
      </div>
    </section>

    <!-- الأخبار -->
    <section v-if="sec.news && d.news.length" class="sx-sec alt">
      <div class="sx-wrap">
        <div v-reveal class="sx-head"><span class="sx-kicker">المركز الإعلامي</span><h2>آخر أخبارنا</h2></div>
        <div class="sx-grid"><NewsCard v-for="n in d.news.slice(0, 3)" :key="n.id" v-reveal :n="n" /></div>
        <div style="text-align: center; margin-top: 30px"><RouterLink :to="site.to('/news')" class="sx-btn line">كل الأخبار ←</RouterLink></div>
      </div>
    </section>

    <!-- شارك معنا -->
    <section v-if="sec.volunteer || sec.membership || sec.store" class="sx-sec">
      <div class="sx-wrap">
        <div v-reveal class="hm-join">
          <div class="hm-join-txt"><h2>كن جزءًا من الأثر</h2><p>تبرع، أو تطوع بوقتك وخبرتك، أو انضم لعضوية الجمعية العمومية.</p></div>
          <div class="hm-join-btns">
            <RouterLink v-if="sec.store" :to="site.to('/donate')" class="sx-btn main"><SiteIcon name="heart" :size="18" /> تبرع</RouterLink>
            <a v-if="sec.volunteer" :href="d.links.volunteer" class="sx-btn ghost"><SiteIcon name="hands" :size="18" /> تطوع معنا</a>
            <a v-if="sec.membership" :href="d.links.membership" class="sx-btn ghost"><SiteIcon name="users" :size="18" /> العضوية</a>
          </div>
          <i class="hm-join-orb" />
        </div>
      </div>
    </section>

    <!-- الشركاء -->
    <section v-if="sec.partners && d.partners.length" class="hm-partners">
      <div class="sx-wrap"><p class="hm-partners-l">شركاء النجاح</p></div>
      <div class="hm-marquee"><div class="hm-marquee-move">
        <component :is="p.url ? 'a' : 'span'" v-for="(p, i) in [...d.partners, ...d.partners]" :key="i" :href="p.url || undefined" target="_blank" rel="noopener" class="hm-partner">
          <img v-if="p.logoUrl" :src="p.logoUrl" :alt="p.name" /><span v-else>{{ p.name }}</span>
        </component>
      </div></div>
    </section>
  </div>
</template>

<style scoped>
.hm-hero { position: relative; min-height: 92vh; display: flex; align-items: center; color: #fff; overflow: hidden; padding: 120px 0 90px; }
.hm-bg { position: absolute; inset: -4%; background: var(--grad-dark) center / cover; animation: hm-zoom 24s ease-in-out infinite alternate; }
@keyframes hm-zoom { to { transform: scale(1.08) translate(-1%, 1%); } }
.hm-shade { position: absolute; inset: 0; background: linear-gradient(100deg, color-mix(in srgb, var(--dark) 55%, transparent) 0%, color-mix(in srgb, var(--dark) 88%, transparent) 60%, var(--dark) 100%); }
.hm-orbs i { position: absolute; border-radius: 50%; filter: blur(60px); opacity: .55; mix-blend-mode: screen; animation: hm-float 14s ease-in-out infinite; }
.hm-orbs i:nth-child(1) { width: 420px; height: 420px; background: var(--secondary); top: -120px; inset-inline-start: -100px; }
.hm-orbs i:nth-child(2) { width: 320px; height: 320px; background: var(--accent); bottom: -140px; inset-inline-start: 30%; animation-delay: -5s; opacity: .35; }
.hm-orbs i:nth-child(3) { width: 260px; height: 260px; background: var(--primary); top: 20%; inset-inline-end: -60px; animation-delay: -9s; }
@keyframes hm-float { 50% { transform: translate(40px, -30px) scale(1.12); } }
.hm-grain { position: absolute; inset: 0; background-image: radial-gradient(rgba(255,255,255,.08) 1px, transparent 1px); background-size: 22px 22px; mask-image: linear-gradient(to bottom, transparent, #000 40%, transparent); }
.hm-in { position: relative; z-index: 1; max-width: 1200px; width: 100%; }
.hm-kicker { display: inline-block; padding: 6px 16px; border-radius: 999px; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.25); backdrop-filter: blur(8px); font-size: .9rem; animation: hm-up .8s var(--ease2) both; }
.hm-title { font-size: clamp(2.2rem, 6vw, 4.2rem); max-width: 820px; margin: 18px 0 14px !important; background: linear-gradient(90deg, #fff 30%, var(--accent) 70%, #fff); background-size: 200% auto; -webkit-background-clip: text; background-clip: text; color: transparent !important; animation: hm-up .9s .1s var(--ease2) both, hm-sheen 6s 1s linear infinite; }
@keyframes hm-sheen { to { background-position: -200% center; } }
.hm-text { font-size: clamp(1rem, 1.6vw, 1.2rem); max-width: 640px; opacity: .9; animation: hm-up .9s .2s var(--ease2) both; }
.hm-ctas { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 26px; animation: hm-up .9s .3s var(--ease2) both; }
.hm-ctas .sx-btn { padding: 14px 30px; font-size: 1.05rem; }
.hm-live { margin-top: 30px; display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 14px; background: rgba(0,0,0,.25); backdrop-filter: blur(8px); font-size: .93rem; animation: hm-up .9s .45s var(--ease2) both; flex-wrap: wrap; }
.hm-live b { color: var(--accent); }
.hm-pulse { width: 9px; height: 9px; border-radius: 50%; background: #34d399; box-shadow: 0 0 0 0 rgba(52,211,153,.7); animation: hm-ping 1.8s infinite; }
@keyframes hm-ping { 70% { box-shadow: 0 0 0 12px rgba(52,211,153,0); } 100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); } }
@keyframes hm-up { from { opacity: 0; transform: translateY(24px); } }
.hm-scroll { position: absolute; bottom: 26px; left: 50%; transform: translateX(-50%); width: 26px; height: 42px; border: 2px solid rgba(255,255,255,.5); border-radius: 14px; }
.hm-scroll span { position: absolute; top: 8px; left: 50%; width: 4px; height: 8px; margin-left: -2px; border-radius: 2px; background: #fff; animation: hm-wheel 1.6s infinite; }
@keyframes hm-wheel { to { transform: translateY(14px); opacity: 0; } }

.hm-ticker { display: flex; align-items: stretch; background: var(--paper); border-bottom: 1px solid var(--line); overflow: hidden; }
.hm-ticker-l { display: flex; gap: 6px; align-items: center; padding: 12px 18px; background: var(--primary); color: #fff; font-weight: 700; white-space: nowrap; position: relative; z-index: 1; }
.hm-ticker-track { flex: 1; overflow: hidden; display: flex; align-items: center; }
.hm-ticker-move { display: flex; gap: 48px; white-space: nowrap; animation: hm-tick 40s linear infinite; padding-inline-start: 24px; }
.hm-ticker-move:hover { animation-play-state: paused; }
.hm-ticker-move a { font-weight: 600; position: relative; }
.hm-ticker-move a::before { content: '◆'; color: var(--accent); margin-inline-end: 10px; font-size: .7rem; }
.hm-ticker-move a:hover { color: var(--primary); }
@keyframes hm-tick { to { transform: translateX(50%); } }

.hm-stats { position: relative; z-index: 2; margin-top: -1px; background: var(--paper); }
.hm-stats-in { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0; padding: 30px 20px; }
.hm-stat { text-align: center; padding: 12px; border-inline-start: 1px solid var(--line); }
.hm-stat:first-child { border-inline-start: 0; }
.hm-stat strong { display: block; font-family: var(--sx-head); font-size: clamp(2rem, 4vw, 2.8rem); line-height: 1.2; background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
.hm-stat span { color: var(--text-2); font-weight: 600; }

.hm-vm { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
.hm-vm-card { position: relative; overflow: hidden; border-radius: var(--r); padding: 30px; color: #fff; background: var(--grad); box-shadow: 0 18px 40px color-mix(in srgb, var(--primary) 25%, transparent); }
.hm-vm-card.m { background: var(--grad-dark); }
.hm-vm-card::after { content: ''; position: absolute; width: 220px; height: 220px; border-radius: 50%; background: rgba(255,255,255,.08); top: -80px; inset-inline-end: -60px; }
.hm-vm-card h3 { font-size: 1.5rem; margin: 12px 0 8px; }
.hm-vm-card p { opacity: .92; font-size: 1.05rem; margin: 0; }
.hm-vm-ic { width: 54px; height: 54px; border-radius: 16px; display: grid; place-items: center; background: rgba(255,255,255,.16); color: var(--accent); }
.hm-goals { margin-top: 22px; padding: 28px; }
.hm-goals h3 { display: flex; gap: 8px; align-items: center; color: var(--primary); margin-bottom: 16px; }
.hm-goals ol { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px 26px; }
.hm-goals li { display: flex; gap: 12px; align-items: flex-start; }
.hm-goals li span { flex-shrink: 0; width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; background: color-mix(in srgb, var(--accent) 22%, #fff); color: var(--dark); font-weight: 700; }

.hm-values { background: linear-gradient(180deg, var(--soft), color-mix(in srgb, var(--primary) 6%, var(--soft))); }
.hm-val { text-align: center; padding: 28px 20px; border-radius: var(--r); background: var(--paper); border: 1px solid var(--line); transition: transform .35s var(--ease2), box-shadow .35s; }
.hm-val:hover { transform: translateY(-6px); box-shadow: 0 18px 36px color-mix(in srgb, var(--primary) 14%, transparent); }
.hm-val span { width: 62px; height: 62px; margin: 0 auto 12px; border-radius: 50%; display: grid; place-items: center; color: var(--primary); background: color-mix(in srgb, var(--primary) 10%, #fff); transition: background .3s, color .3s; }
.hm-val:hover span { background: var(--primary); color: #fff; }
.hm-val h3 { font-size: 1.15rem; margin-bottom: 6px; }
.hm-val p { color: var(--text-2); font-size: .92rem; margin: 0; }

.hm-join { position: relative; overflow: hidden; border-radius: 26px; padding: 44px; color: #fff; background: var(--grad-dark); display: flex; gap: 24px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.hm-join h2 { font-size: clamp(1.6rem, 3vw, 2.2rem); }
.hm-join p { opacity: .85; margin: 8px 0 0; }
.hm-join-btns { display: flex; gap: 10px; flex-wrap: wrap; position: relative; z-index: 1; }
.hm-join-txt { position: relative; z-index: 1; }
.hm-join-orb { position: absolute; width: 380px; height: 380px; border-radius: 50%; background: radial-gradient(circle, color-mix(in srgb, var(--accent) 45%, transparent), transparent 70%); inset-inline-end: -100px; top: -160px; animation: hm-float 12s infinite; }

.hm-partners { padding: 40px 0 56px; background: var(--paper); }
.hm-partners-l { text-align: center; color: var(--text-2); font-weight: 700; margin-bottom: 18px !important; }
.hm-marquee { overflow: hidden; mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent); }
.hm-marquee-move { display: flex; gap: 22px; width: max-content; animation: hm-tick 36s linear infinite; }
.hm-partner { display: grid; place-items: center; min-width: 180px; height: 78px; padding: 0 22px; border-radius: 16px; border: 1px solid var(--line); background: var(--soft); color: var(--text-2); font-weight: 700; font-size: .92rem; text-align: center; filter: grayscale(1); opacity: .8; transition: filter .3s, opacity .3s, transform .3s; }
.hm-partner:hover { filter: none; opacity: 1; transform: translateY(-3px); color: var(--primary); }
.hm-partner img { max-height: 54px; max-width: 150px; object-fit: contain; }
.hm-gates { position: relative; z-index: 3; padding: 28px 0 6px; }
.hm-gates-in { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.hm-gates-in.one { grid-template-columns: minmax(0, 560px); justify-content: center; }
.hm-gate { position: relative; overflow: hidden; display: flex; align-items: center; gap: 16px; padding: 22px 24px; border-radius: 22px; color: #fff; box-shadow: 0 18px 40px rgba(16,32,31,.18); transition: transform .3s var(--ease2), box-shadow .3s; }
.hm-gate::after { content: ''; position: absolute; inset: 0; background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,.18) 50%, transparent 70%); transform: translateX(120%); transition: transform .8s var(--ease2); }
.hm-gate:hover { transform: translateY(-4px); box-shadow: 0 24px 50px rgba(16,32,31,.25); }
.hm-gate:hover::after { transform: translateX(-120%); }
.hm-gate.ben { background: linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 65%, #000)); }
.hm-gate.staff { background: var(--grad-dark); }
.hm-gate-ic { width: 58px; height: 58px; flex-shrink: 0; border-radius: 16px; display: grid; place-items: center; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.25); color: var(--accent); box-shadow: 0 0 24px color-mix(in srgb, var(--accent) 35%, transparent); }
.hm-gate-tx { display: grid; gap: 4px; flex: 1; min-width: 0; }
.hm-gate-tx b { font-family: var(--sx-head); font-size: 1.22rem; }
.hm-gate-tx small { opacity: .82; font-size: .9rem; line-height: 1.6; }
.hm-gate-go { flex-shrink: 0; padding: 8px 16px; border-radius: 999px; background: var(--accent); color: var(--dark); font-weight: 800; font-size: .9rem; }
@media (max-width: 760px) { .hm-vm { grid-template-columns: 1fr; } .hm-join { padding: 30px 22px; } .hm-stat { border-inline-start: 0; } .hm-hero { min-height: 86vh; } .hm-gates-in { grid-template-columns: 1fr; gap: 12px; } .hm-gate { padding: 16px; gap: 12px; } .hm-gate-ic { width: 48px; height: 48px; } .hm-gate-tx b { font-size: 1.08rem; } .hm-gate-tx small { font-size: .84rem; } .hm-gate-go { padding: 6px 12px; font-size: .82rem; } }
</style>
