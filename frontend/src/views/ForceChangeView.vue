<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import BrandMark from '../components/BrandMark.vue';
import { api } from '../api';
import { loginPath, useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import { strongPasswordProblem } from '../validation';

/** الدخول بكلمة مرور مؤقتة: يختار المستخدم كلمة مرور جديدة قبل استخدام النظام */
const session = useSession();
const router = useRouter();
const toast = useToast();
const current = ref('');
const next = ref('');
const confirm = ref('');
const error = ref('');
const busy = ref(false);
const tried = ref(false);

const nextProblem = computed(() => {
  const p = strongPasswordProblem(next.value);
  if (p) return p;
  if (next.value && next.value === current.value) return 'اختر كلمة مرور مختلفة عن المؤقتة';
  return '';
});
const confirmProblem = computed(() => (confirm.value && confirm.value !== next.value ? 'التأكيد غير مطابق لكلمة المرور الجديدة' : ''));

async function submit() {
  tried.value = true;
  error.value = '';
  if (!current.value || !next.value || !confirm.value || nextProblem.value || confirmProblem.value) {
    error.value = 'راجع الخانات المعلّمة باللون الأحمر';
    return;
  }
  busy.value = true;
  try {
    await api('/auth/change-password', { method: 'POST', json: { currentPassword: current.value, newPassword: next.value } });
    await session.refresh();
    toast.success('تم حفظ كلمة المرور الجديدة');
    router.replace('/');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

function logout() {
  const to = loginPath();
  session.logout();
  router.replace(to);
}
</script>

<template>
  <div class="fc">
    <form class="card fc-card" novalidate @submit.prevent="submit">
      <div class="fc-head">
        <BrandMark :size="40" />
        <div>
          <h1>اختر كلمة مرور جديدة</h1>
          <p class="muted">دخلت بكلمة مرور مؤقتة. لحماية حسابك اختر كلمة مرور خاصة بك قبل المتابعة.</p>
        </div>
      </div>
      <ul class="fc-rules">
        <li>8 أحرف على الأقل، بالأحرف الإنجليزية والأرقام والرموز.</li>
        <li>تحتوي على حرف إنجليزي ورقم على الأقل.</li>
        <li>لا تكون اسم الدخول أو جزءًا من بريدك.</li>
      </ul>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <div class="field">
        <label>كلمة المرور المؤقتة</label>
        <input v-model="current" :class="['input', { invalid: tried && !current }]" type="password" dir="ltr" autocomplete="current-password" />
      </div>
      <div class="field">
        <label>كلمة المرور الجديدة</label>
        <input v-model="next" :class="['input', { invalid: nextProblem || (tried && !next) }]" type="password" dir="ltr" autocomplete="new-password" />
        <small v-if="nextProblem" class="field-error">{{ nextProblem }}</small>
      </div>
      <div class="field">
        <label>تأكيد كلمة المرور الجديدة</label>
        <input v-model="confirm" :class="['input', { invalid: confirmProblem || (tried && !confirm) }]" type="password" dir="ltr" autocomplete="new-password" />
        <small v-if="confirmProblem" class="field-error">{{ confirmProblem }}</small>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" :disabled="busy">{{ busy ? 'جارٍ الحفظ…' : 'حفظ ومتابعة' }}</button>
        <button type="button" class="btn" @click="logout">خروج</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.fc { min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: radial-gradient(1000px 600px at 90% -10%, rgba(45,212,191,.16), transparent 60%), var(--bg); }
.fc-card { width: 100%; max-width: 460px; padding: 24px; }
.fc-head { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
.fc-head h1 { font-size: 1.3rem; margin: 0 0 4px; }
.fc-head p { margin: 0; font-size: .92rem; }
.fc-rules { margin: 0 0 16px; padding: 12px 30px 12px 14px; border-radius: 12px; background: var(--surface-2); font-size: .88rem; line-height: 1.8; }
</style>
