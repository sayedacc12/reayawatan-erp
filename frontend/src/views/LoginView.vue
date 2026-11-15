<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BrandMark from '../components/BrandMark.vue';
import ParticleField from '../components/ParticleField.vue';
import { api } from '../api';
import { useSession } from '../stores/session';
import { hasArabic } from '../validation';

const session = useSession();
const router = useRouter();
const route = useRoute();
const email = ref('');
// تنبيه لو لوحة المفاتيح على العربي وهو بيكتب الدخول أو كلمة المرور
const arabicKeyboard = computed(() => hasArabic(email.value) || hasArabic(password.value));
const password = ref('');
const showPassword = ref(false);
const error = ref('');
const busy = ref(false);
const success = ref(false);
const shake = ref(false);

// صفحة دخول جمعية معينة (/o/:slug)، أو صفحة إدارة المنصة (/login)
const slug = computed(() => (typeof route.params.slug === 'string' ? route.params.slug : ''));
const orgName = ref('');
const orgMissing = ref(false);
watch(slug, async (s) => {
  orgName.value = '';
  orgMissing.value = false;
  if (!s) return;
  try {
    orgName.value = (await api<{ name: string }>(`/auth/org/${s}`)).name;
  } catch {
    orgMissing.value = true;
  }
}, { immediate: true });
// لو موظف جمعية دخل من الصفحة العامة، الرسالة فيها رابط جمعيته
const orgLink = computed(() => error.value.match(/\/o\/[a-z0-9-]+/)?.[0] ?? '');
function goToOrg() {
  const target = orgLink.value;
  error.value = '';
  router.replace(target);
}

// عبارات متبدلة في العنوان
const words = ['التبرعات', 'المستفيدين', 'الأعضاء', 'المحاسبة', 'المتطوعين'];
const wordIndex = ref(0);
let timer = 0;
onMounted(() => {
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    timer = window.setInterval(() => (wordIndex.value = (wordIndex.value + 1) % words.length), 2400);
  }
});
onBeforeUnmount(() => clearInterval(timer));

// بقعة ضوء تتبع المؤشر داخل البطاقة
const card = ref<HTMLElement | null>(null);
function spotlight(e: PointerEvent) {
  const el = card.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
}

async function submit() {
  error.value = '';
  if (arabicKeyboard.value) {
    error.value = 'لوحة المفاتيح على اللغة العربية. غيّرها إلى الإنجليزية (Alt + Shift) ثم أعد كتابة البيانات';
    shake.value = false;
    requestAnimationFrame(() => (shake.value = true));
    return;
  }
  busy.value = true;
  try {
    await session.login(email.value, password.value, slug.value || undefined);
    success.value = true;
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/';
    setTimeout(() => router.replace(next), 650);
  } catch (e) {
    error.value = (e as Error).message;
    shake.value = false;
    requestAnimationFrame(() => (shake.value = true));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login" :class="{ leaving: success }">
    <div class="aurora" aria-hidden="true"><span /><span /><span /></div>
    <div class="pattern" aria-hidden="true" />
    <ParticleField />

    <div class="layout">
      <section class="hero">
        <div class="brand-row">
          <div class="hero-mark"><BrandMark :size="64" /></div>
          <div>
            <div class="wordmark">{{ slug ? orgName || '…' : 'سنابل' }}</div>
            <p class="eyebrow">{{ slug ? 'بوابة موظفي الجمعية · على منصة سنابل' : 'منصة إدارة الجمعيات الخيرية' }}</p>
          </div>
        </div>
        <h1 v-if="slug">
          مساحة عمل<br />
          فريق
          <span class="word-wrap">
            <Transition name="word" mode="out-in">
              <span :key="wordIndex" class="word">{{ words[wordIndex] }}</span>
            </Transition>
          </span>
        </h1>
        <h1 v-else>
          منصة واحدة<br />
          لإدارة
          <span class="word-wrap">
            <Transition name="word" mode="out-in">
              <span :key="wordIndex" class="word">{{ words[wordIndex] }}</span>
            </Transition>
          </span>
        </h1>
        <p class="lead">دخول موحد لكل أنظمة جمعيتك: الأعضاء والتبرعات والمستفيدين والمحاسبة، بصلاحيات دقيقة لكل موظف.</p>
        <ul class="chips">
          <li style="--d: 0.5s"><span class="dot" />بيانات معزولة وآمنة لكل جمعية</li>
          <li style="--d: 0.65s"><span class="dot" />صلاحيات لكل وحدة ولكل موظف</li>
          <li style="--d: 0.8s"><span class="dot" />وحدات تتكامل في قاعدة واحدة</li>
        </ul>
      </section>

      <form ref="card" class="glass" :class="{ shake }" @pointermove="spotlight" @submit.prevent="submit" @animationend="shake = false">
        <div class="glass-border" aria-hidden="true" />
        <div class="glass-inner">
          <div class="form-head">
            <BrandMark :size="40" />
            <div>
              <h2>{{ slug ? 'دخول الموظفين' : 'مرحبًا بك في سنابل' }}</h2>
              <p>{{ slug ? orgName : 'دخول إدارة المنصة. موظفو الجمعيات يدخلون من رابط جمعيتهم' }}</p>
            </div>
          </div>

          <div v-if="orgMissing" class="error" role="alert">رابط الجمعية غير صحيح. تأكد من الرابط مع إدارة جمعيتك.</div>
          <Transition name="fade">
            <div v-if="error" class="error" role="alert">
              {{ orgLink ? error.replace(/:?\s*\/o\/[a-z0-9-]+/, '.') : error }}
              <button v-if="orgLink" type="button" class="org-jump" @click="goToOrg">افتح صفحة جمعيتك ←</button>
            </div>
          </Transition>

          <label class="float">
            <input v-model="email" type="text" dir="ltr" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder=" " required autofocus />
            <span>اسم المستخدم أو البريد الإلكتروني</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4z M4 7l8 6 8-6" /></svg>
          </label>

          <label class="float">
            <input v-model="password" :type="showPassword ? 'text' : 'password'" dir="ltr" autocomplete="current-password" placeholder=" " required />
            <span>كلمة المرور</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3" /></svg>
            <button type="button" class="eye" :aria-label="showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'" @click="showPassword = !showPassword">
              {{ showPassword ? 'إخفاء' : 'إظهار' }}
            </button>
          </label>

          <Transition name="fade">
            <p v-if="arabicKeyboard && !error" class="hint" role="status">⌨️ لوحة المفاتيح على اللغة العربية، غيّرها إلى الإنجليزية (Alt + Shift)</p>
          </Transition>

          <button class="submit" :disabled="busy || success">
            <span class="shine" aria-hidden="true" />
            <span v-if="success">✓ تم الدخول</span>
            <span v-else-if="busy" class="loading"><i /><i /><i /></span>
            <span v-else>تسجيل الدخول</span>
          </button>

          <p class="secure">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /></svg>
            اتصال آمن ومشفّر
          </p>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login {
  --ink: #e7fffb;
  --ink-2: rgba(231, 255, 251, 0.68);
  --teal: #2dd4bf;
  --gold: #f5c66b;
  position: relative; min-height: 100vh; overflow: hidden; color: var(--ink);
  background: radial-gradient(1200px 800px at 80% -10%, #0f3d3a 0%, transparent 60%),
              radial-gradient(900px 700px at 0% 110%, #1a2b4a 0%, transparent 60%), #06141a;
  display: grid; place-items: center; padding: 24px 16px;
  transition: opacity 0.6s ease, transform 0.6s ease, filter 0.6s ease;
}
.login.leaving { opacity: 0; transform: scale(1.04); filter: blur(6px); }

/* أضواء الشفق المتحركة */
.aurora span { position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.55; mix-blend-mode: screen; }
.aurora span:nth-child(1) { width: 520px; height: 520px; background: #0d9488; top: -140px; right: -80px; animation: drift1 18s ease-in-out infinite; }
.aurora span:nth-child(2) { width: 460px; height: 460px; background: #6366f1; bottom: -160px; left: -100px; opacity: 0.35; animation: drift2 22s ease-in-out infinite; }
.aurora span:nth-child(3) { width: 340px; height: 340px; background: #f59e0b; top: 40%; left: 35%; opacity: 0.18; animation: drift3 26s ease-in-out infinite; }
@keyframes drift1 { 50% { transform: translate(-120px, 120px) scale(1.15); } }
@keyframes drift2 { 50% { transform: translate(140px, -90px) scale(1.1); } }
@keyframes drift3 { 50% { transform: translate(-160px, -60px) scale(1.3); } }

/* زخرفة هندسية خفيفة */
.pattern {
  position: absolute; inset: 0; opacity: 0.07;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cg fill='none' stroke='%23ffffff' stroke-width='1'%3E%3Crect x='22' y='22' width='36' height='36'/%3E%3Crect x='22' y='22' width='36' height='36' transform='rotate(45 40 40)'/%3E%3C/g%3E%3C/svg%3E");
  mask-image: radial-gradient(ellipse at center, #000 30%, transparent 75%);
}

.layout { position: relative; z-index: 2; width: 100%; max-width: 1120px; display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 64px; align-items: center; }

/* الجانب التعريفي */
.hero { animation: rise 0.9s cubic-bezier(.2,.8,.2,1) both; }
.brand-row { display: flex; align-items: center; gap: 18px; margin-bottom: 26px; }
.wordmark { font-size: 2.3rem; font-weight: 700; line-height: 1.1; background: linear-gradient(90deg, #ffffff, #a7f3e9 50%, var(--gold)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.hero-mark { width: 84px; height: 84px; border-radius: 22px; display: grid; place-items: center; flex-shrink: 0;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 0 60px rgba(45,212,191,0.35); animation: float 6s ease-in-out infinite; }
@keyframes float { 50% { transform: translateY(-8px); } }
.eyebrow { color: var(--teal); font-weight: 600; letter-spacing: 0.02em; margin: 4px 0 0; }
.hero h1 { font-size: clamp(2rem, 4.4vw, 3.4rem); line-height: 1.25; font-weight: 700; }
.word-wrap { display: inline-block; min-width: 4.5em; }
.word { display: inline-block; background: linear-gradient(90deg, #5eead4, #a5f3fc 40%, var(--gold)); -webkit-background-clip: text; background-clip: text; color: transparent;
  background-size: 200% auto; animation: shimmer 4s linear infinite; }
@keyframes shimmer { to { background-position: 200% center; } }
.word-enter-active, .word-leave-active { transition: all 0.45s cubic-bezier(.2,.8,.2,1); }
.word-enter-from { opacity: 0; transform: translateY(0.5em); filter: blur(6px); }
.word-leave-to { opacity: 0; transform: translateY(-0.5em); filter: blur(6px); }
.lead { color: var(--ink-2); font-size: 1.08rem; max-width: 32em; margin: 18px 0 26px; }
.chips { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.chips li { display: inline-flex; align-items: center; gap: 10px; color: var(--ink-2); opacity: 0; animation: rise 0.7s var(--d) cubic-bezier(.2,.8,.2,1) forwards; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--teal); box-shadow: 0 0 12px var(--teal); }

/* بطاقة زجاجية بإطار مضيء دوّار */
.glass { position: relative; border-radius: 24px; padding: 1.5px; animation: rise 0.9s 0.15s cubic-bezier(.2,.8,.2,1) both; }
.glass-border { position: absolute; inset: 0; border-radius: inherit; overflow: hidden; }
.glass-border::before { content: ''; position: absolute; inset: -60%;
  background: conic-gradient(from 0deg, transparent 0 60%, #2dd4bf 72%, #f5c66b 80%, transparent 90%); animation: spin 6s linear infinite; }
@keyframes spin { to { transform: rotate(1turn); } }
.glass-inner { position: relative; border-radius: 23px; padding: 34px 30px 26px;
  background: radial-gradient(400px circle at var(--mx, 50%) var(--my, 0%), rgba(94,234,212,0.13), transparent 45%), rgba(8, 26, 32, 0.78);
  backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); box-shadow: 0 30px 80px rgba(0,0,0,0.45); }
.form-head { display: flex; align-items: center; gap: 14px; margin-bottom: 26px; }
.form-head h2 { font-size: 1.4rem; }
.form-head p { margin: 0; color: var(--ink-2); font-size: 0.93rem; }

.error { background: rgba(244, 63, 94, 0.14); border: 1px solid rgba(244, 63, 94, 0.4); color: #fecdd3; padding: 10px 14px; border-radius: 12px; margin-bottom: 16px; font-size: 0.92rem; }
.org-jump { display: block; margin-top: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.25); color: #fff; font: inherit; font-size: 0.88rem;
  padding: 6px 12px; border-radius: 10px; cursor: pointer; }
.org-jump:hover { background: rgba(255,255,255,0.18); }
.hint { color: #fde68a; font-size: 0.86rem; margin: -6px 0 14px; }
.fade-enter-active, .fade-leave-active { transition: all 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(-6px); }

/* حقول بعناوين عائمة */
.float { position: relative; display: block; margin-bottom: 18px; }
.float input { width: 100%; font: inherit; color: var(--ink); background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 14px; padding: 22px 46px 8px 16px; text-align: right; transition: border-color .2s, box-shadow .2s, background .2s; }
.float input:focus { outline: none; border-color: var(--teal); background: rgba(45,212,191,0.06); box-shadow: 0 0 0 4px rgba(45,212,191,0.15), 0 0 24px rgba(45,212,191,0.25); }
.float span { position: absolute; right: 46px; top: 15px; color: var(--ink-2); pointer-events: none; transition: all .2s ease; }
.float input:focus + span, .float input:not(:placeholder-shown) + span { top: 5px; font-size: 0.75rem; color: var(--teal); }
.float svg { position: absolute; right: 15px; top: 16px; width: 20px; height: 20px; fill: none; stroke: var(--ink-2); stroke-width: 1.6; stroke-linejoin: round; }
.float input:focus ~ svg { stroke: var(--teal); }
.eye { position: absolute; left: 10px; top: 12px; background: none; border: 0; color: var(--ink-2); font: inherit; font-size: 0.82rem; cursor: pointer; padding: 4px 6px; border-radius: 6px; }
.eye:hover { color: var(--ink); background: rgba(255,255,255,0.06); }

.submit { position: relative; overflow: hidden; width: 100%; height: 52px; border: 0; border-radius: 14px; cursor: pointer; font: inherit; font-weight: 700; font-size: 1.05rem;
  color: #04201d; background: linear-gradient(135deg, #5eead4, #14b8a6 55%, #0d9488); box-shadow: 0 10px 30px rgba(20,184,166,0.45); transition: transform .15s, box-shadow .2s; margin-top: 6px; }
.submit:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 14px 40px rgba(20,184,166,0.6); }
.submit:active:not(:disabled) { transform: translateY(0); }
.submit:disabled { cursor: default; }
.shine { position: absolute; inset: 0; background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.55) 50%, transparent 70%); transform: translateX(120%); animation: sweep 3.2s ease-in-out infinite; }
@keyframes sweep { 60%, 100% { transform: translateX(-120%); } }
.loading { display: inline-flex; gap: 6px; }
.loading i { width: 8px; height: 8px; border-radius: 50%; background: #04201d; animation: bounce 0.9s infinite; }
.loading i:nth-child(2) { animation-delay: .15s; }
.loading i:nth-child(3) { animation-delay: .3s; }
@keyframes bounce { 50% { transform: translateY(-6px); opacity: .5; } }
.secure { display: flex; align-items: center; justify-content: center; gap: 6px; color: var(--ink-2); font-size: 0.82rem; margin: 18px 0 0; }
.secure svg { width: 15px; height: 15px; fill: none; stroke: var(--teal); stroke-width: 1.8; }

.shake { animation: shake 0.45s; }
@keyframes shake { 20%, 60% { transform: translateX(-8px); } 40%, 80% { transform: translateX(8px); } }
@keyframes rise { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }

@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; gap: 28px; max-width: 460px; }
  .hero { text-align: center; }
  .brand-row { justify-content: center; margin-bottom: 14px; }
  .hero-mark { width: 64px; height: 64px; }
  .wordmark { font-size: 1.9rem; }
  .brand-row > div:last-child { text-align: right; }
  .hero h1 { font-size: 1.9rem; }
  .lead, .chips { display: none; }
  .glass-inner { padding: 26px 20px 20px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .chips li { opacity: 1; }
}
</style>
