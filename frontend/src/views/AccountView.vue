<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../api';
import { useSession } from '../stores/session';

const session = useSession();
const current = ref('');
const next = ref('');
const confirm = ref('');
const error = ref('');
const done = ref(false);
const busy = ref(false);

async function submit() {
  error.value = '';
  done.value = false;
  if (next.value !== confirm.value) {
    error.value = 'تأكيد كلمة المرور غير مطابق';
    return;
  }
  busy.value = true;
  try {
    await api('/auth/change-password', { method: 'POST', json: { currentPassword: current.value, newPassword: next.value } });
    done.value = true;
    current.value = next.value = confirm.value = '';
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
      <p><strong>{{ session.user?.fullName }}</strong><br /><span class="muted" dir="ltr">{{ session.user?.email }}</span></p>
      <h2 style="margin: 18px 0 12px">تغيير كلمة المرور</h2>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <div v-if="done" class="alert alert-success">تم تغيير كلمة المرور</div>
      <form @submit.prevent="submit">
        <div class="field"><label>كلمة المرور الحالية</label><input v-model="current" class="input" type="password" dir="ltr" required /></div>
        <div class="field"><label>كلمة المرور الجديدة (8 أحرف على الأقل)</label><input v-model="next" class="input" type="password" dir="ltr" minlength="8" required /></div>
        <div class="field"><label>تأكيد كلمة المرور الجديدة</label><input v-model="confirm" class="input" type="password" dir="ltr" required /></div>
        <button class="btn btn-primary" :disabled="busy">حفظ</button>
      </form>
    </div>
  </div>
</template>
