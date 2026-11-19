<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import { strongPasswordProblem } from '../validation';

const session = useSession();
const toast = useToast();
const router = useRouter();
const current = ref('');
const next = ref('');
const confirm = ref('');
const error = ref('');
const busy = ref(false);
const tried = ref(false);

// رسائل تظهر تحت كل خانة أثناء الكتابة
const nextProblem = computed(() => {
  const p = strongPasswordProblem(next.value);
  if (p) return p;
  if (next.value && next.value === current.value) return 'يجب أن تختلف كلمة المرور الجديدة عن الحالية';
  return '';
});
const confirmProblem = computed(() =>
  confirm.value && confirm.value !== next.value ? 'التأكيد غير مطابق لكلمة المرور الجديدة' : '',
);
const canSubmit = computed(() => current.value && next.value && confirm.value && !nextProblem.value && !confirmProblem.value);

function leave() {
  if (window.history.state?.back) router.back();
  else router.push('/');
}

async function submit() {
  tried.value = true;
  error.value = '';
  if (!canSubmit.value) {
    error.value = 'راجع الخانات المعلّمة باللون الأحمر';
    return;
  }
  busy.value = true;
  try {
    await api('/auth/change-password', { method: 'POST', json: { currentPassword: current.value, newPassword: next.value } });
    toast.success('تم تغيير كلمة المرور بنجاح');
    leave();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div style="max-width: 460px">
    <div class="page-head"><h1>حسابي</h1></div>
    <div class="card" style="padding: 20px">
      <p>
        <strong>{{ session.user?.fullName }}</strong><br />
        <span v-if="session.user?.username" class="muted">اسم الدخول: <code dir="ltr">{{ session.user.username }}</code><br /></span>
        <span class="muted" dir="ltr">{{ session.user?.email }}</span>
      </p>
      <h2 style="margin: 18px 0 12px">تغيير كلمة المرور</h2>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <form novalidate @submit.prevent="submit">
        <div class="field">
          <label>كلمة المرور الحالية</label>
          <input v-model="current" :class="['input', { invalid: tried && !current }]" type="password" dir="ltr" autocomplete="current-password" />
          <small v-if="tried && !current" class="field-error">اكتب كلمة المرور الحالية</small>
        </div>
        <div class="field">
          <label>كلمة المرور الجديدة</label>
          <input v-model="next" :class="['input', { invalid: nextProblem || (tried && !next) }]" type="password" dir="ltr" autocomplete="new-password" />
          <small v-if="nextProblem" class="field-error">{{ nextProblem }}</small>
          <small v-else-if="tried && !next" class="field-error">اكتب كلمة المرور الجديدة</small>
          <small v-else class="muted">8 أحرف على الأقل، بالأحرف الإنجليزية والأرقام والرموز، وفيها حرف ورقم على الأقل</small>
        </div>
        <div class="field">
          <label>تأكيد كلمة المرور الجديدة</label>
          <input v-model="confirm" :class="['input', { invalid: confirmProblem || (tried && !confirm) }]" type="password" dir="ltr" autocomplete="new-password" />
          <small v-if="confirmProblem" class="field-error">{{ confirmProblem }}</small>
          <small v-else-if="tried && !confirm" class="field-error">أعد كتابة كلمة المرور الجديدة</small>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" :disabled="busy">{{ busy ? 'جارٍ الحفظ…' : 'حفظ' }}</button>
          <button type="button" class="btn" @click="leave">إلغاء</button>
        </div>
      </form>
    </div>
  </div>
</template>
