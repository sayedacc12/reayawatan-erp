<script setup lang="ts">
import { computed } from 'vue';
import AppIcon from '../components/AppIcon.vue';
import { useSession } from '../stores/session';

const session = useSession();

const greeting = computed(() => {
  const h = new Date().getHours();
  return h < 12 ? 'صباح الخير' : h < 18 ? 'مساء النور' : 'مساء الخير';
});
const today = new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// ألوان متدرجة لكل تطبيق حسب ترتيبه
const palettes = [
  ['#14b8a6', '#0f766e'], ['#6366f1', '#4338ca'], ['#f59e0b', '#d97706'],
  ['#ec4899', '#be185d'], ['#0ea5e9', '#0369a1'], ['#22c55e', '#15803d'],
];
const tint = (i: number) => {
  const [a, b] = palettes[i % palettes.length];
  return { '--a': a, '--b': b, '--i': i } as Record<string, string | number>;
};

// خارطة الطريق: وحدات قادمة تظهر لمستخدمي الجمعيات كبطاقات "قريبًا"
const upcoming = [
  { name: 'الأعضاء', icon: 'users', desc: 'سجل الأعضاء والاشتراكات' },
  { name: 'التبرعات', icon: 'heart', desc: 'الإيصالات والحملات والمتبرعين' },
  { name: 'المحاسبة', icon: 'wallet', desc: 'القيود والحسابات والتقارير' },
  { name: 'الموقع ومنصة التبرعات', icon: 'globe', desc: 'خدمة إضافية لكل جمعية' },
];

function spotlight(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
}
</script>

<template>
  <div>
    <section class="welcome">
      <div class="welcome-glow" aria-hidden="true" />
      <div class="welcome-text">
        <p class="date">{{ today }}</p>
        <h1>{{ greeting }}، {{ session.user?.fullName }} 👋</h1>
        <p class="sub">
          {{ session.user?.organizationName ? `أنت في ${session.user.organizationName}.` : 'أنت في لوحة إدارة المنصة.' }}
          اختر النظام الذي تريد العمل عليه.
        </p>
      </div>
    </section>

    <div v-if="session.apps.length" class="apps">
      <RouterLink v-for="(app, i) in session.apps" :key="app.code" :to="app.menu[0].path" class="app" :style="tint(i)" @pointermove="spotlight">
        <span class="app-icon"><AppIcon :name="app.icon" /></span>
        <span class="app-title">{{ app.name }}</span>
        <span v-if="app.description" class="app-desc">{{ app.description }}</span>
        <span class="app-links">
          <span v-for="m in app.menu" :key="m.path" class="pill">{{ m.label }}</span>
        </span>
      </RouterLink>
    </div>
    <template v-if="session.user?.organizationId">
      <h2 class="section-title">قريبًا في منصتك</h2>
      <div class="apps">
        <div v-for="(u, i) in upcoming" :key="u.name" class="app soon" :style="tint(i + 1)">
          <span class="app-icon"><AppIcon :name="u.icon" /></span>
          <span class="app-title">{{ u.name }}</span>
          <span class="app-desc">{{ u.desc }}</span>
          <span class="soon-badge">قريبًا</span>
        </div>
      </div>
    </template>
    <div v-if="!session.apps.length" class="card empty">
      لا توجد أنظمة متاحة لحسابك حاليًا. تواصل مع مدير النظام لمنحك الصلاحيات المطلوبة.
    </div>
  </div>
</template>

<style scoped>
.welcome { position: relative; overflow: hidden; border-radius: 20px; padding: 30px 30px; margin-bottom: 26px; color: #fff; background: var(--grad-dark); box-shadow: 0 16px 40px rgba(6,20,26,.18); }
.welcome-glow { position: absolute; inset: 0;
  background: radial-gradient(500px 220px at 15% 0%, rgba(45,212,191,.45), transparent 70%), radial-gradient(400px 200px at 90% 120%, rgba(232,176,75,.35), transparent 70%);
  animation: breathe 8s ease-in-out infinite; }
@keyframes breathe { 50% { opacity: .6; transform: scale(1.05); } }
.welcome-text { position: relative; animation: rise .6s var(--ease) both; }
.date { margin: 0 0 6px; color: #5eead4; font-size: .9rem; font-weight: 500; }
.welcome h1 { font-size: 1.7rem; }
.sub { margin: 8px 0 0; color: rgba(255,255,255,.75); }

.apps { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 18px; }
.app { position: relative; overflow: hidden; padding: 24px 20px 20px; border-radius: 18px; background: var(--surface); border: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 8px; color: var(--text); box-shadow: var(--shadow);
  transition: transform .25s var(--ease), box-shadow .25s, border-color .25s; animation: rise .55s calc(var(--i) * 70ms + 120ms) var(--ease) both; }
.app::before { content: ''; position: absolute; inset: 0; opacity: 0; transition: opacity .25s;
  background: radial-gradient(260px circle at var(--mx, 50%) var(--my, 50%), color-mix(in srgb, var(--a) 16%, transparent), transparent 60%); }
.app:hover { transform: translateY(-5px); border-color: color-mix(in srgb, var(--a) 45%, var(--border)); box-shadow: 0 18px 40px color-mix(in srgb, var(--a) 22%, transparent); }
.app:hover::before { opacity: 1; }
.app > * { position: relative; }
.app-icon { width: 54px; height: 54px; border-radius: 16px; display: grid; place-items: center; font-size: 1.45rem; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, var(--a), var(--b)); box-shadow: 0 10px 22px color-mix(in srgb, var(--a) 40%, transparent); transition: transform .3s var(--ease); margin-bottom: 6px; }
.app:hover .app-icon { transform: rotate(-6deg) scale(1.06); }
.app-title { font-weight: 700; font-size: 1.08rem; }
.app-desc { color: var(--muted); font-size: .88rem; }
.app-links { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.pill { font-size: .78rem; padding: 2px 10px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); color: var(--muted); }
.section-title { margin: 34px 0 14px; font-size: 1rem; color: var(--muted); font-weight: 600; }
.soon { background: color-mix(in srgb, var(--surface) 70%, transparent); border-style: dashed; animation-delay: calc(var(--i) * 70ms + 300ms); }
.soon .app-icon { filter: saturate(.55); opacity: .8; box-shadow: none; }
.soon:hover { transform: translateY(-3px); }
.soon-badge { position: absolute; top: 16px; inset-inline-end: 16px; font-size: .74rem; font-weight: 600; padding: 2px 10px; border-radius: 999px;
  color: color-mix(in srgb, var(--a) 80%, #000); background: color-mix(in srgb, var(--a) 14%, transparent); }
.empty { padding: 28px; text-align: center; color: var(--muted); }
@keyframes rise { from { opacity: 0; transform: translateY(16px); } }
@media (max-width: 760px) { .welcome { padding: 22px 18px; } .welcome h1 { font-size: 1.3rem; } }
</style>
