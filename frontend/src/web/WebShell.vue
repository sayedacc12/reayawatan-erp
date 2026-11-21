<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useSession } from '../stores/session';
import Rich from './Rich.vue';
import { C, loadSite, services, site } from './site';
import './web.css';
import './web-extra.css';

/** إطار الموقع العام لرعاية وطن: الشريط العلوي والتذييل، والمحتوى من لوحة التحكم في النظام */
const route = useRoute();
const session = useSession();
const open = ref(false);
const loggedIn = ref(false);
onMounted(async () => {
  loadSite();
  await session.restore().catch(() => undefined);
  loggedIn.value = session.isLoggedIn;
});
watch(() => route.fullPath, () => { open.value = false; });
const section = computed(() => (route.path === '/' ? 'home' : route.path.split('/')[1]));
const NAV = [
  { to: '/', k: 'home', l: 'الرئيسية' }, { to: '/about', k: 'about', l: 'من نحن' }, { to: '/services', k: 'services', l: 'خدماتنا' },
  { to: '/assess', k: 'assess', l: 'قيّم جاهزيتك' }, { to: '/guides', k: 'guides', l: 'الأدلة المجانية' }, { to: '/contact', k: 'contact', l: 'تواصل معنا' },
];
const contact = computed(() => C().contact ?? {});
const about = computed(() => C().about ?? {});
const cardValue = (label: string) => (about.value.card ?? []).find((x: { label: string }) => x.label === label)?.value;
const year = new Date().getFullYear();
const staffLink = computed(() => (loggedIn.value ? '/me' : '/login'));
</script>

<template>
  <div class="rw-site" dir="rtl" lang="ar">
    <header :class="['top', { open }]">
      <div class="wrap">
        <RouterLink class="brand" to="/" aria-label="رعاية وطن، الصفحة الرئيسية">
          <img class="lg-dark" src="/brand/logo.png" alt="رعاية وطن National Care"><img class="lg-light" src="/brand/logo-light.png" alt="رعاية وطن National Care">
        </RouterLink>
        <nav id="nav" class="main" aria-label="القائمة الرئيسية">
          <RouterLink v-for="n in NAV" :key="n.k" :to="n.to" :aria-current="section === n.k ? 'page' : undefined">{{ n.l }}</RouterLink>
          <RouterLink :to="staffLink" class="portal-mobile">{{ loggedIn ? 'لوحة التحكم' : 'بوابة الموظفين' }}</RouterLink>
        </nav>
        <div class="top-actions">
          <RouterLink class="btn btn-sm portal-link" :to="staffLink">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
            {{ loggedIn ? 'لوحة التحكم' : 'بوابة الموظفين' }}
          </RouterLink>
          <RouterLink class="btn btn-primary btn-sm cta-top" to="/book">جلسة تشخيص مجانية</RouterLink>
        </div>
        <button class="menu-btn" aria-label="فتح القائمة" :aria-expanded="open" aria-controls="nav" @click="open = !open">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
      </div>
    </header>

    <main>
      <div v-if="site.error && !site.data" class="wrap" style="padding: 80px 16px; text-align: center"><p>{{ site.error }}</p><button class="btn" @click="loadSite(true)">إعادة المحاولة</button></div>
      <div v-else-if="!site.data" class="wrap" style="padding: 120px 16px; text-align: center; color: var(--muted)">جارٍ التحميل…</div>
      <div v-else :key="route.path" :data-page="section"><RouterView /></div>
    </main>

    <footer>
      <div class="wrap">
        <div class="foot-grid">
          <div style="display: grid; gap: 14px; align-content: start">
            <RouterLink class="brand" to="/"><img src="/brand/logo-light.png" alt="رعاية وطن National Care"></RouterLink>
            <p>شركة سعودية غير ربحية مملوكة لجمعية عناية الصحية، تقدم الاستشارات والحلول للقطاع غير الربحي، وللقطاع الصحي منه على وجه الخصوص.</p>
          </div>
          <div><h4>الشركة</h4><ul>
            <li><RouterLink to="/about">من نحن</RouterLink></li><li><RouterLink to="/services">خدماتنا</RouterLink></li>
            <li><RouterLink to="/guides">الأدلة المجانية</RouterLink></li><li><RouterLink to="/contact">طلب استشارة</RouterLink></li>
            <li><RouterLink :to="staffLink">بوابة الموظفين</RouterLink></li>
          </ul></div>
          <div><h4>خدماتنا</h4><ul><li v-for="s in services()" :key="s.slug"><RouterLink :to="`/services/${s.slug}`">{{ s.title }}</RouterLink></li></ul></div>
          <div><h4>تواصل</h4><ul>
            <li>الهاتف: <Rich :text="contact.phone" /></li>
            <li>البريد: <Rich :text="contact.email" /></li>
            <li>العنوان: <Rich :text="contact.address" /></li>
            <li>ساعات العمل: <Rich :text="contact.hours" /></li>
          </ul></div>
        </div>
        <div class="legal">
          <span>© {{ year }} شركة رعاية وطن للاستثمار (National Care). جميع الحقوق محفوظة.</span>
          <span>العناصر المظللة <span class="ph">يُستكمل</span> بيانات تنتظر الاعتماد.</span>
          <span>السجل التجاري: <Rich :text="cardValue('السجل التجاري')" /> · الرقم الضريبي: <Rich :text="cardValue('الرقم الضريبي')" /></span>
        </div>
      </div>
    </footer>
  </div>
</template>
