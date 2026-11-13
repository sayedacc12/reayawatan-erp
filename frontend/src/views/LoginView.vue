<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from '../stores/session';

const session = useSession();
const router = useRouter();
const route = useRoute();
const email = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    await session.login(email.value, password.value);
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/';
    router.replace(next);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login">
    <form class="card login-card" @submit.prevent="submit">
      <div class="brand">
        <div class="logo">ج</div>
        <div>
          <h1>نظام إدارة الجمعية</h1>
          <p class="muted">دخول موحد لكل أنظمة الجمعية</p>
        </div>
      </div>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <div class="field">
        <label for="email">البريد الإلكتروني</label>
        <input id="email" v-model="email" class="input" type="email" dir="ltr" autocomplete="username" required autofocus />
      </div>
      <div class="field">
        <label for="password">كلمة المرور</label>
        <input id="password" v-model="password" class="input" type="password" dir="ltr" autocomplete="current-password" required />
      </div>
      <button class="btn btn-primary full" :disabled="busy">{{ busy ? 'جارٍ الدخول…' : 'تسجيل الدخول' }}</button>
    </form>
  </div>
</template>

<style scoped>
.login { min-height: 100vh; display: grid; place-items: center; padding: 16px;
  background: linear-gradient(160deg, var(--primary-soft), var(--bg) 60%); }
.login-card { width: 100%; max-width: 400px; padding: 28px; }
.brand { display: flex; gap: 14px; align-items: center; margin-bottom: 22px; }
.logo { width: 48px; height: 48px; border-radius: 12px; background: var(--primary); color: #fff;
  display: grid; place-items: center; font-size: 1.5rem; font-weight: 700; flex-shrink: 0; }
.brand p { margin: 0; font-size: 0.9rem; }
.full { width: 100%; margin-top: 6px; }
</style>
