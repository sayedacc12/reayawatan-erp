<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ParticleField from '../components/ParticleField.vue';
import SupplierFields from '../modules/procurement/components/SupplierFields.vue';
import { supplierForm, supplierPayload } from '../modules/procurement/lib';
import { hasArabic, strongPasswordProblem } from '../validation';
import { loadMe, setSupplierToken, supplierApi, useSupplierPortal } from './supplier';

const route = useRoute();
const router = useRouter();
const slug = route.params.slug as string;
const portal = useSupplierPortal(slug);
const info = ref<any>(null);
const notFound = ref(false);
const resetToken = typeof route.query.reset === 'string' ? route.query.reset : '';
const mode = ref<'login' | 'register' | 'forgot' | 'reset' | 'change'>(resetToken ? 'reset' : 'login');
const error = ref('');
const done = ref('');
const busy = ref(false);
const login = reactive({ email: '', password: '' });
const forgotEmail = ref('');
const pw = reactive({ current: '', next: '', confirm: '' });
const owner = reactive({ ownerName: '', ownerEmail: '', ownerPhone: '', password: '', confirm: '' });
const form = ref(supplierForm());
const regProblem = computed(() => strongPasswordProblem(owner.password));
const pwProblem = computed(() => strongPasswordProblem(pw.next));
function setMode(m: typeof mode.value) {
  mode.value = m;
  error.value = '';
  done.value = '';
}

onMounted(async () => {
  try {
    info.value = await supplierApi(`/o/${slug}`);
  } catch {
    notFound.value = true;
    return;
  }
  if (portal.token && !resetToken) {
    const me = await loadMe(true).catch(() => null);
    if (me && !me.user.mustChangePassword) { router.replace(`/supplier/${slug}/home`); return; }
    if (me) mode.value = 'change';
  }
});

async function afterLogin(res: { accessToken: string; mustChangePassword?: boolean }, current = '') {
  setSupplierToken(res.accessToken);
  if (res.mustChangePassword) {
    pw.current = current;
    setMode('change');
    return;
  }
  await loadMe(true).catch(() => null);
  router.push(`/supplier/${slug}/home`);
}

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    if (mode.value === 'login') {
      if (hasArabic(login.password)) throw new Error('اكتب كلمة المرور بالأحرف الإنجليزية، وغيّر لغة لوحة المفاتيح');
      await afterLogin(await supplierApi(`/o/${slug}/login`, { method: 'POST', json: login }), login.password);
    } else if (mode.value === 'register') {
      if (regProblem.value) throw new Error(regProblem.value);
      if (owner.password !== owner.confirm) throw new Error('كلمتا المرور غير متطابقتين');
      const { confirm: _c, ...o } = owner;
      await afterLogin(await supplierApi(`/o/${slug}/register`, { method: 'POST', json: { ...supplierPayload(form.value), ...o } }));
    } else if (mode.value === 'forgot') {
      done.value = (await supplierApi<{ message: string }>(`/o/${slug}/forgot`, { method: 'POST', json: { email: forgotEmail.value } })).message;
    } else if (mode.value === 'reset') {
      if (pwProblem.value) throw new Error(pwProblem.value);
      if (pw.next !== pw.confirm) throw new Error('كلمتا المرور غير متطابقتين');
      await afterLogin(await supplierApi(`/o/${slug}/reset`, { method: 'POST', json: { token: resetToken, password: pw.next } }));
    } else {
      if (pwProblem.value) throw new Error(pwProblem.value);
      if (pw.next !== pw.confirm) throw new Error('كلمتا المرور غير متطابقتين');
      await afterLogin(await supplierApi('/change-password', { method: 'POST', json: { currentPassword: pw.current, newPassword: pw.next } }));
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function cancelChange() {
  setSupplierToken(null);
  setMode('login');
}
const title = computed(() => ({ login: 'دخول الموردين', register: 'تسجيل مورد جديد', forgot: 'استعادة كلمة المرور', reset: 'كلمة مرور جديدة', change: 'غيّر كلمة المرور المؤقتة' })[mode.value]);
</script>

<template>
  <div v-if="notFound" class="card nf"><h2>البوابة غير متاحة</h2><p class="muted">تأكد من الرابط، أو تواصل مع الجمعية.</p></div>
  <div v-else-if="info" :class="['auth', { wide: mode === 'register' }]">
    <section class="hero">
      <ParticleField />
      <div class="hero-in">
        <p class="kicker">بوابة الموردين</p>
        <h1>{{ info.name }}</h1>
        <p class="sub">{{ info.intro || 'سجّل منشأتك موردًا معتمدًا لدى الجمعية، وارفع مستنداتك، وتابع حالة طلبك وحسابك البنكي من مكان واحد.' }}</p>
        <ol class="steps">
          <li><span>1</span>أنشئ حساب المنشأة وبياناتها</li>
          <li><span>2</span>ارفع المستندات النظامية المطلوبة</li>
          <li><span>3</span>أرسل الطلب، وتابع اعتماده</li>
        </ol>
      </div>
    </section>

    <section class="card box">
      <div v-if="mode === 'login' || mode === 'register'" class="switch">
        <span class="pill" :style="{ transform: mode === 'register' ? 'translateX(-100%)' : 'none' }" />
        <button type="button" :class="{ on: mode === 'login' }" @click="setMode('login')">دخول</button>
        <button type="button" :class="{ on: mode === 'register' }" :disabled="!info.open" @click="setMode('register')">تسجيل جديد</button>
      </div>
      <h2 v-else class="alt-title">{{ title }}</h2>
      <p v-if="!info.open && mode === 'login'" class="muted small">التسجيل الجديد مغلق حاليًا، ويبقى الدخول متاحًا للموردين المسجلين.</p>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <div v-if="done" class="alert alert-success">{{ done }}</div>

      <form @submit.prevent="submit">
        <template v-if="mode === 'login'">
          <div class="field"><label>البريد الإلكتروني</label><input v-model="login.email" class="input" type="email" dir="ltr" required autocomplete="username" /></div>
          <div class="field"><label>كلمة المرور</label><input v-model="login.password" class="input" type="password" dir="ltr" required autocomplete="current-password" /></div>
        </template>
        <template v-else-if="mode === 'forgot'">
          <div v-if="!done" class="field"><label>البريد الإلكتروني المسجل</label><input v-model="forgotEmail" class="input" type="email" dir="ltr" required /></div>
        </template>
        <template v-else-if="mode === 'reset' || mode === 'change'">
          <div v-if="mode === 'change'" class="field"><label>كلمة المرور المؤقتة</label><input v-model="pw.current" class="input" type="password" dir="ltr" required autocomplete="current-password" /></div>
          <div class="field"><label>كلمة المرور الجديدة</label><input v-model="pw.next" :class="['input', { invalid: pwProblem }]" type="password" dir="ltr" required autocomplete="new-password" /><small v-if="pwProblem" class="field-error">{{ pwProblem }}</small></div>
          <div class="field"><label>تأكيد كلمة المرور</label><input v-model="pw.confirm" class="input" type="password" dir="ltr" required autocomplete="new-password" /></div>
        </template>
        <template v-else>
          <SupplierFields v-model="form" :entity-types="info.entityTypes" :supplier-kinds="info.supplierKinds" :categories="info.categories" :activities="info.activities" />
          <div class="pc-sec">مدير حساب المنشأة في البوابة</div>
          <div class="pc-fields">
            <div class="field"><label>الاسم *</label><input v-model="owner.ownerName" class="input" required /></div>
            <div class="field"><label>البريد الإلكتروني للدخول *</label><input v-model="owner.ownerEmail" class="input" type="email" dir="ltr" required /></div>
            <div class="field"><label>الجوال *</label><input v-model="owner.ownerPhone" class="input" dir="ltr" inputmode="tel" required placeholder="05xxxxxxxx" /></div>
            <div class="field"><label>كلمة المرور *</label><input v-model="owner.password" :class="['input', { invalid: regProblem }]" type="password" dir="ltr" required autocomplete="new-password" /><small v-if="regProblem" class="field-error">{{ regProblem }}</small></div>
            <div class="field"><label>تأكيد كلمة المرور *</label><input v-model="owner.confirm" class="input" type="password" dir="ltr" required autocomplete="new-password" /></div>
          </div>
        </template>
        <button v-if="!(mode === 'forgot' && done)" class="btn btn-primary go" :disabled="busy">{{ busy ? 'لحظة...' : { login: 'دخول', register: 'إنشاء الحساب', forgot: 'إرسال رابط الاستعادة', reset: 'حفظ ومتابعة', change: 'حفظ ومتابعة' }[mode] }}</button>
      </form>
      <button v-if="mode === 'login'" type="button" class="link" @click="setMode('forgot')">نسيت كلمة المرور؟</button>
      <button v-else-if="mode === 'forgot' || mode === 'reset'" type="button" class="link" @click="setMode('login')">← العودة لتسجيل الدخول</button>
      <button v-else-if="mode === 'change'" type="button" class="link" @click="cancelChange">خروج</button>
    </section>
  </div>
</template>

<style scoped>
.nf { padding: 40px; text-align: center; }
.auth { display: grid; grid-template-columns: 1.1fr 1fr; gap: 20px; align-items: start; }
.auth.wide { grid-template-columns: 1fr; }
.auth.wide .hero { min-height: auto; }
.auth.wide .steps { display: none; }
.hero { position: relative; overflow: hidden; border-radius: 24px; min-height: 420px; padding: 34px 30px; color: #fff; background: linear-gradient(135deg, #081824, #0d3346 55%, #0f4a3c); box-shadow: 0 20px 50px rgba(6,20,26,.25); }
.hero :deep(canvas) { position: absolute; inset: 0; width: 100%; height: 100%; }
.hero-in { position: relative; z-index: 1; animation: rise .6s var(--ease) both; }
.kicker { color: #7dd3fc; font-weight: 600; margin: 0 0 6px; }
.hero h1 { font-size: 1.9rem; line-height: 1.3; background: linear-gradient(90deg, #fff, #bae6fd 60%, #6ee7b7); -webkit-background-clip: text; background-clip: text; color: transparent; }
.sub { color: rgba(255,255,255,.8); max-width: 520px; margin: 12px 0 24px; white-space: pre-line; }
.steps { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
.steps li { display: flex; align-items: center; gap: 12px; }
.steps span { width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; font-weight: 700; background: rgba(125,211,252,.15); border: 1px solid rgba(125,211,252,.4); color: #7dd3fc; box-shadow: 0 0 14px rgba(56,189,248,.3); }
.box { padding: 22px; animation: rise .55s .1s var(--ease) both; }
.switch { position: relative; display: grid; grid-template-columns: 1fr 1fr; background: var(--surface-2); border-radius: 12px; padding: 4px; margin-bottom: 16px; }
.switch button { position: relative; z-index: 1; font: inherit; font-weight: 600; padding: 9px; border: 0; background: none; cursor: pointer; color: var(--muted); transition: color .2s; }
.switch button.on { color: #fff; }
.switch button:disabled { opacity: .5; cursor: not-allowed; }
.pill { position: absolute; top: 4px; bottom: 4px; right: 4px; width: calc(50% - 4px); border-radius: 9px; background: linear-gradient(135deg, #0284c7, #059669); box-shadow: 0 6px 16px rgba(2,132,199,.35); transition: transform .35s var(--ease); }
.alt-title { margin: 0 0 14px; font-size: 1.2rem; }
.small { font-size: .85rem; }
.link { display: block; margin: 12px auto 0; background: none; border: 0; font: inherit; color: var(--primary); font-weight: 600; cursor: pointer; }
.go { width: 100%; margin-top: 6px; min-height: 46px; font-size: 1.02rem; }
@keyframes rise { from { opacity: 0; transform: translateY(14px); } }
@media (max-width: 860px) { .auth { grid-template-columns: 1fr; } .hero { min-height: auto; padding: 24px 20px; } .hero h1 { font-size: 1.5rem; } }
</style>
