<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import NationalitySelect from '../components/NationalitySelect.vue';
import ParticleField from '../components/ParticleField.vue';
import { hasArabic, passwordProblem, strongPasswordProblem } from '../validation';
import { portalApi, setPortalToken, usePortal, type PortalProject } from './portal';

const route = useRoute();
const router = useRouter();
const slug = route.params.slug as string;
const portal = usePortal(slug);
const info = ref<{ name: string; projects: PortalProject[]; nationalities: string[] } | null>(null);
const notFound = ref(false);
const mode = ref<'login' | 'register' | 'forgot' | 'change'>('login');
const error = ref('');
const busy = ref(false);
const loginForm = reactive({ nationalId: '', password: '' });
const forgotForm = reactive({ nationalId: '', phone: '' });
const forgotDone = ref('');
// الدخول بكلمة مؤقتة: يختار المستفيد كلمة جديدة قبل المتابعة
const change = reactive({ current: '', next: '', confirm: '' });
const changeProblem = computed(() => strongPasswordProblem(change.next));
function setMode(m: typeof mode.value) {
  mode.value = m;
  error.value = '';
  forgotDone.value = '';
}
const reg = reactive({ fullName: '', nationalId: '', phone: '', gender: 'female', nationality: '', birthDate: '', city: '', password: '', confirm: '' });

onMounted(async () => {
  if (portal.token) {
    // جلسة بكلمة مؤقتة لم تُغيّر بعد: تبقى في صفحة تغيير كلمة المرور
    const me = await portalApi<{ mustChangePassword?: boolean }>('/me').catch(() => null);
    if (!me?.mustChangePassword) { router.replace(`/portal/${slug}/home`); return; }
    mode.value = 'change';
  }
  try {
    info.value = await portalApi(`/o/${slug}`);
  } catch {
    notFound.value = true;
  }
});

const axes = computed(() => {
  const m = new Map<string, PortalProject[]>();
  for (const p of info.value?.projects ?? []) m.set(p.axis, [...(m.get(p.axis) ?? []), p]);
  return [...m.entries()];
});
const pwProblem = computed(() => passwordProblem(reg.password));

async function submit() {
  error.value = '';
  if (mode.value === 'forgot') return sendForgot();
  if (mode.value === 'change') return sendChange();
  if (mode.value === 'register') {
    if (pwProblem.value) { error.value = pwProblem.value; return; }
    if (reg.password !== reg.confirm) { error.value = 'كلمتا المرور غير متطابقتين'; return; }
  } else if (hasArabic(loginForm.password)) {
    error.value = 'اكتب كلمة المرور بالأحرف الإنجليزية، وغيّر لغة لوحة المفاتيح';
    return;
  }
  busy.value = true;
  try {
    const { confirm: _c, ...regBody } = reg;
    const res = mode.value === 'login'
      ? await portalApi<{ accessToken: string; mustChangePassword?: boolean }>(`/o/${slug}/login`, { method: 'POST', json: loginForm })
      : await portalApi<{ accessToken: string; mustChangePassword?: boolean }>(`/o/${slug}/register`, { method: 'POST', json: regBody });
    setPortalToken(res.accessToken);
    if (res.mustChangePassword) {
      change.current = loginForm.password;
      setMode('change');
      return;
    }
    router.push(`/portal/${slug}/${mode.value === 'register' ? 'apply' : 'home'}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function sendForgot() {
  busy.value = true;
  try {
    forgotDone.value = (await portalApi<{ message: string }>(`/o/${slug}/forgot`, { method: 'POST', json: forgotForm })).message;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function sendChange() {
  if (changeProblem.value) { error.value = changeProblem.value; return; }
  if (change.next !== change.confirm) { error.value = 'كلمتا المرور غير متطابقتين'; return; }
  busy.value = true;
  try {
    await portalApi('/change-password', { method: 'POST', json: { currentPassword: change.current, newPassword: change.next } });
    router.push(`/portal/${slug}/home`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

function cancelChange() {
  setPortalToken(null);
  setMode('login');
}
</script>

<template>
  <div v-if="notFound" class="card nf">الجمعية غير موجودة أو البوابة غير متاحة حاليًا.</div>
  <div v-else class="auth">
    <section class="hero">
      <ParticleField />
      <div class="hero-in">
        <p class="kicker">بوابة المستفيدين</p>
        <h1>{{ info?.name ?? '...' }}</h1>
        <p class="sub">قدّم طلبك إلكترونيًا، وتابع كل مرحلة يمر بها حتى الاعتماد، وتواصل مع الجمعية من مكان واحد.</p>
        <ul class="steps">
          <li><span>1</span>سجّل برقم هويتك</li>
          <li><span>2</span>اختر المشروع وقدّم طلبك</li>
          <li><span>3</span>تابع المراحل لحظة بلحظة</li>
        </ul>
      </div>
    </section>

    <section class="card box">
      <div v-if="mode === 'forgot' || mode === 'change'" class="alt-head">
        <h2>{{ mode === 'forgot' ? 'استعادة كلمة المرور' : 'اختر كلمة مرور جديدة' }}</h2>
        <p class="muted">{{ mode === 'forgot'
          ? 'اكتب رقم هويتك والجوال المسجل لدى الجمعية. إن تطابقا تتصل بك الجمعية على جوالك المسجل وتسلّمك كلمة مرور مؤقتة.'
          : 'دخلت بكلمة مرور مؤقتة. اختر كلمة مرور خاصة بك: 8 أحرف على الأقل، فيها حرف إنجليزي ورقم.' }}</p>
      </div>
      <div v-else class="switch">
        <button :class="{ on: mode === 'login' }" @click="mode = 'login'; error = ''">تسجيل الدخول</button>
        <button :class="{ on: mode === 'register' }" @click="mode = 'register'; error = ''">حساب جديد</button>
        <span class="pill" :style="{ transform: mode === 'login' ? 'translateX(0)' : 'translateX(-100%)' }" />
      </div>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <form @submit.prevent="submit">
        <Transition name="page" mode="out-in">
          <div v-if="mode === 'login'" key="l">
            <div class="field"><label>رقم الهوية / الإقامة</label><input v-model="loginForm.nationalId" class="input" inputmode="numeric" dir="ltr" required autocomplete="username" /></div>
            <div class="field"><label>كلمة المرور</label><input v-model="loginForm.password" class="input" type="password" dir="ltr" required autocomplete="current-password" /></div>
          </div>
          <div v-else-if="mode === 'forgot'" key="f">
            <div v-if="forgotDone" class="alert alert-success">{{ forgotDone }}</div>
            <template v-else>
              <div class="field"><label>رقم الهوية / الإقامة</label><input v-model="forgotForm.nationalId" class="input" inputmode="numeric" dir="ltr" required /></div>
              <div class="field"><label>الجوال المسجل لدى الجمعية</label><input v-model="forgotForm.phone" class="input" inputmode="tel" dir="ltr" required placeholder="05xxxxxxxx" /></div>
            </template>
          </div>
          <div v-else-if="mode === 'change'" key="c">
            <div class="field"><label>كلمة المرور المؤقتة</label><input v-model="change.current" class="input" type="password" dir="ltr" required autocomplete="current-password" /></div>
            <div class="field"><label>كلمة المرور الجديدة</label><input v-model="change.next" :class="['input', { invalid: changeProblem }]" type="password" dir="ltr" required autocomplete="new-password" /><small v-if="changeProblem" class="field-error">{{ changeProblem }}</small></div>
            <div class="field"><label>تأكيد كلمة المرور الجديدة</label><input v-model="change.confirm" class="input" type="password" dir="ltr" required autocomplete="new-password" /></div>
          </div>
          <div v-else key="r" class="two">
            <div class="field wide"><label>الاسم رباعي *</label><input v-model="reg.fullName" class="input" required minlength="3" /></div>
            <div class="field"><label>رقم الهوية *</label><input v-model="reg.nationalId" class="input" inputmode="numeric" dir="ltr" required /></div>
            <div class="field"><label>الجوال *</label><input v-model="reg.phone" class="input" inputmode="tel" dir="ltr" required /></div>
            <div class="field"><label>النوع</label><select v-model="reg.gender" class="input"><option value="female">أنثى</option><option value="male">ذكر</option></select></div>
            <div class="field"><label>الجنسية *</label><NationalitySelect v-model="reg.nationality" :options="info?.nationalities ?? []" required /></div>
            <div class="field"><label>تاريخ الميلاد</label><input v-model="reg.birthDate" class="input" type="date" /></div>
            <div class="field wide"><label>المدينة / المنطقة</label><input v-model="reg.city" class="input" /></div>
            <div class="field"><label>كلمة المرور *</label><input v-model="reg.password" :class="['input', { invalid: pwProblem }]" type="password" dir="ltr" required autocomplete="new-password" /></div>
            <div class="field"><label>تأكيد كلمة المرور *</label><input v-model="reg.confirm" class="input" type="password" dir="ltr" required autocomplete="new-password" /></div>
            <small v-if="pwProblem" class="field-error wide">{{ pwProblem }}</small>
          </div>
        </Transition>
        <button v-if="!(mode === 'forgot' && forgotDone)" class="btn btn-primary go" :disabled="busy">{{ busy ? 'لحظة...' : { login: 'دخول', register: 'إنشاء الحساب', forgot: 'إرسال الطلب', change: 'حفظ ومتابعة' }[mode] }}</button>
      </form>
      <button v-if="mode === 'login'" type="button" class="link" @click="setMode('forgot')">نسيت كلمة المرور؟</button>
      <button v-else-if="mode === 'forgot'" type="button" class="link" @click="setMode('login')">← العودة لتسجيل الدخول</button>
      <button v-else-if="mode === 'change'" type="button" class="link" @click="cancelChange">خروج</button>
    </section>

    <section v-if="axes.length" class="projects">
      <h2>المشاريع المتاحة للتقديم</h2>
      <div v-for="([axis, list], ai) in axes" :key="axis" class="axis">
        <p class="axis-name">{{ axis }}</p>
        <div class="grid">
          <article v-for="(p, i) in list" :key="p.id" class="card proj" :style="{ '--i': ai * 3 + i }">
            <small>{{ p.program }}</small>
            <b>{{ p.name }}</b>
            <p v-if="p.description" class="muted">{{ p.description }}</p>
          </article>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.nf { padding: 40px; text-align: center; }
.auth { display: grid; grid-template-columns: 1.15fr 1fr; gap: 20px; align-items: start; }
.hero { position: relative; overflow: hidden; border-radius: 24px; min-height: 440px; padding: 36px 32px; color: #fff; background: var(--grad-dark); box-shadow: 0 20px 50px rgba(6,20,26,.25); }
.hero :deep(canvas) { position: absolute; inset: 0; width: 100%; height: 100%; }
.hero-in { position: relative; z-index: 1; animation: rise .6s var(--ease) both; }
.kicker { color: #5eead4; font-weight: 600; margin: 0 0 6px; }
.hero h1 { font-size: 2rem; line-height: 1.3; background: linear-gradient(90deg, #fff, #a7f3e9 60%, #f5c66b); -webkit-background-clip: text; background-clip: text; color: transparent; }
.sub { color: rgba(255,255,255,.78); max-width: 460px; margin: 12px 0 26px; }
.steps { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
.steps li { display: flex; align-items: center; gap: 12px; animation: rise .5s var(--ease) both; }
.steps li:nth-child(2) { animation-delay: .1s; } .steps li:nth-child(3) { animation-delay: .2s; }
.steps span { width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; font-weight: 700; background: rgba(94,234,212,.15); border: 1px solid rgba(94,234,212,.4); color: #5eead4; box-shadow: 0 0 14px rgba(45,212,191,.3); }
.box { padding: 22px; animation: rise .55s .1s var(--ease) both; }
.switch { position: relative; display: grid; grid-template-columns: 1fr 1fr; background: var(--surface-2); border-radius: 12px; padding: 4px; margin-bottom: 16px; }
.switch button { position: relative; z-index: 1; font: inherit; font-weight: 600; padding: 9px; border: 0; background: none; cursor: pointer; color: var(--muted); transition: color .2s; }
.switch button.on { color: #fff; }
.pill { position: absolute; top: 4px; bottom: 4px; right: 4px; width: calc(50% - 4px); border-radius: 9px; background: var(--grad); box-shadow: 0 6px 16px rgba(13,148,136,.35); transition: transform .35s var(--ease); }
.alt-head h2 { margin: 0 0 4px; font-size: 1.2rem; }
.alt-head p { margin: 0 0 14px; font-size: .9rem; line-height: 1.7; }
.link { display: block; margin: 12px auto 0; background: none; border: 0; font: inherit; color: var(--primary); font-weight: 600; cursor: pointer; }
.link:hover { text-decoration: underline; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.wide { grid-column: 1 / -1; }
.go { width: 100%; margin-top: 6px; min-height: 46px; font-size: 1.02rem; }
.projects { grid-column: 1 / -1; margin-top: 10px; }
.projects h2 { margin-bottom: 12px; }
.axis-name { color: var(--primary); font-weight: 700; margin: 14px 0 8px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.proj { padding: 16px; display: flex; flex-direction: column; gap: 4px; animation: rise .45s calc(var(--i) * 60ms + 200ms) var(--ease) both; transition: transform .2s; border-top: 3px solid var(--gold); }
.proj:hover { transform: translateY(-3px); }
.proj small { color: var(--muted); font-size: .76rem; }
.proj p { margin: 4px 0 0; font-size: .86rem; }
@keyframes rise { from { opacity: 0; transform: translateY(14px); } }
@media (max-width: 860px) { .auth { grid-template-columns: 1fr; } .hero { min-height: auto; padding: 26px 20px; } .hero h1 { font-size: 1.5rem; } }
@media (max-width: 480px) { .two { grid-template-columns: 1fr; } }
</style>
