<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import BrandMark from '../../../components/BrandMark.vue';
import MinutesDoc from '../components/MinutesDoc.vue';
import { fmtDate, type Snapshot } from '../lib';
import '../meetings.css';

/** توقيع المحضر لمن هم خارج النظام: رابط شخصي + رمز تحقق من 6 أرقام */
interface View { name: string; role: string; status: string; signStatus: string; hash: string; deadline: string | null; minutes: Snapshot }
const token = useRoute().params.token as string;
const v = ref<View | null>(null);
const error = ref('');
const done = ref<'' | 'sign' | 'abstain'>('');
const busy = ref(false);
const f = reactive({ decision: 'sign' as 'sign' | 'abstain', code: '', reason: '' });
onMounted(async () => {
  try {
    v.value = await api<View>(`/public/minutes/sign/${token}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
async function submit() {
  busy.value = true;
  error.value = '';
  try {
    await api(`/public/minutes/sign/${token}`, { method: 'POST', json: { decision: f.decision, code: f.code, reason: f.reason || null } });
    done.value = f.decision;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="ms">
    <div class="glow" aria-hidden="true"><span /><span /></div>
    <main class="wrap">
      <header class="top"><BrandMark :size="30" /><b>{{ v?.minutes.organization || 'سنابل' }}</b></header>
      <div v-if="!v && error" class="card box">{{ error }}</div>
      <div v-else-if="done" class="card box" style="text-align: center">
        <span class="big">{{ done === 'sign' ? '✓' : '!' }}</span>
        <h1>{{ done === 'sign' ? 'تم توقيع المحضر' : 'سُجّل امتناعك عن التوقيع' }}</h1>
        <p class="muted">شكرًا لك. يمكنك إغلاق هذه الصفحة.</p>
      </div>
      <template v-else-if="v">
        <div class="card box">
          <p class="kicker">توقيع محضر اجتماع</p>
          <h1>{{ v.minutes.title }}</h1>
          <p class="muted">مرحبًا {{ v.name }} ({{ v.role }}). راجع نص المحضر أدناه، ثم أدخل رمز التحقق الذي وصلك من أمين السر.<template v-if="v.deadline"> آخر موعد للتوقيع {{ fmtDate(v.deadline) }}.</template></p>
          <p v-if="v.signStatus !== 'pending'" class="closed">سبق تسجيل ردك على هذا المحضر.</p>
          <form v-else-if="v.status === 'signing'" class="mt-sign" style="margin-top: 14px" @submit.prevent="submit">
            <div class="seg">
              <button type="button" :class="{ on: f.decision === 'sign' }" @click="f.decision = 'sign'">أوقّع على المحضر</button>
              <button type="button" :class="{ on: f.decision === 'abstain' }" @click="f.decision = 'abstain'">أمتنع عن التوقيع</button>
            </div>
            <input v-if="f.decision === 'abstain'" v-model="f.reason" class="input" placeholder="سبب الامتناع (إلزامي)" style="margin-bottom: 10px" />
            <input v-model="f.code" class="input code" inputmode="numeric" maxlength="6" placeholder="••••••" dir="ltr" autocomplete="one-time-code" />
            <div v-if="error" class="alert alert-error" style="margin-top: 10px">{{ error }}</div>
            <button class="btn mt-glow" style="width: 100%; margin-top: 12px; padding: 12px" :disabled="busy || f.code.length !== 6 || (f.decision === 'abstain' && f.reason.trim().length < 3)">تأكيد</button>
            <p style="font-size: .72rem; margin: 10px 0 0" dir="ltr">SHA-256: {{ v.hash }}</p>
          </form>
          <p v-else class="closed">المحضر لم يعد متاحًا للتوقيع.</p>
        </div>
        <MinutesDoc :m="v.minutes" style="margin-top: 16px" />
      </template>
    </main>
  </div>
</template>

<style scoped>
.ms { min-height: 100vh; background: var(--grad-dark); position: relative; overflow-x: hidden; padding: 24px 14px 60px; }
.glow { position: fixed; inset: 0; pointer-events: none; }
.glow span { position: absolute; width: 50vmax; height: 50vmax; border-radius: 50%; filter: blur(90px); opacity: .3; animation: drift 16s ease-in-out infinite alternate; }
.glow span:first-child { background: #6366f1; top: -20vmax; right: -15vmax; }
.glow span:last-child { background: #e8b04b; bottom: -25vmax; left: -15vmax; opacity: .2; animation-delay: -8s; }
@keyframes drift { to { transform: translate(5vmax, 4vmax) scale(1.08); } }
.wrap { position: relative; z-index: 1; max-width: 860px; margin: 0 auto; }
.top { display: flex; align-items: center; gap: 10px; color: #fff; font-size: 1.1rem; margin-bottom: 16px; }
.box { padding: 26px; }
.box h1 { margin: 4px 0 6px; font-size: 1.35rem; }
.kicker { color: var(--primary); font-weight: 700; font-size: .82rem; margin: 0; }
.muted { color: var(--muted); }
.closed { background: #fef2f2; color: #991b1b; border-radius: 12px; padding: 12px; }
.seg { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
.seg button { border: 1px solid rgba(255,255,255,.35); background: rgba(255,255,255,.08); color: #fff; border-radius: 12px; padding: 10px; cursor: pointer; font: inherit; }
.seg button.on { background: #fff; color: #1e1b4b; font-weight: 700; }
.code { font-size: 1.8rem; letter-spacing: 12px; text-align: center; font-family: ui-monospace, monospace; }
.big { display: inline-grid; place-items: center; width: 72px; height: 72px; border-radius: 50%; background: linear-gradient(135deg, #10b981, #6366f1); color: #fff; font-size: 2rem; }
</style>
