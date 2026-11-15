<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import PublicShell from './PublicShell.vue';
import RegistrationForm from './RegistrationForm.vue';

const router = useRouter();
const busy = ref(false);
const error = ref('');

async function submit(fd: FormData) {
  busy.value = true;
  error.value = '';
  try {
    const res = await api<{ token: string }>('/public/registrations', { method: 'POST', body: fd });
    router.push({ path: `/register/${res.token}`, query: { new: '1' } });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const steps = [
  { t: 'قدّم طلبك', d: 'بيانات الجمعية والترخيص ومسؤوليها' },
  { t: 'المراجعة والاعتماد', d: 'تحدد إدارة المنصة الشاشات والقيمة' },
  { t: 'فترة تجريبية', d: 'جرّب النظام قبل التعاقد عند منحها' },
  { t: 'العقد الإلكتروني', d: 'راجعه ووقّعه من داخل المنصة' },
];
</script>

<template>
  <PublicShell>
    <section class="hero">
      <p class="kicker">انضم إلى سنابل</p>
      <h1>سجّل جمعيتك<br /><span class="shine">وابدأ رحلة التحول الرقمي</span></h1>
      <p class="lead">نظام متكامل لإدارة المستفيدين والمشاريع والموارد المالية، بحساب مستقل وبيانات معزولة لكل جمعية.</p>
      <ol class="steps">
        <li v-for="(s, i) in steps" :key="s.t" :style="{ '--i': i }"><span class="n">{{ i + 1 }}</span><b>{{ s.t }}</b><small>{{ s.d }}</small></li>
      </ol>
    </section>
    <div class="card form-card">
      <h2>طلب اشتراك جمعية</h2>
      <p class="muted">الحقول المعلَّمة بـ * إلزامية. ستحصل بعد الإرسال على رابط خاص لمتابعة طلبك، احتفظ به.</p>
      <RegistrationForm mode="public" :busy="busy" submit-label="إرسال طلب الاشتراك" @submit="submit">
        <template #error><div v-if="error" class="alert alert-error">{{ error }}</div></template>
      </RegistrationForm>
    </div>
  </PublicShell>
</template>

<style scoped>
.hero { color: #fff; text-align: center; padding: 26px 0 30px; }
.kicker { color: #5eead4; font-weight: 600; margin: 0 0 6px; animation: up .6s var(--ease) both; }
.hero h1 { font-size: clamp(1.7rem, 4vw, 2.5rem); line-height: 1.35; animation: up .6s .1s var(--ease) both; }
.shine { background: linear-gradient(90deg, #5eead4, #f5c66b, #5eead4); background-size: 200% auto; -webkit-background-clip: text; background-clip: text; color: transparent; animation: shine 5s linear infinite; }
@keyframes shine { to { background-position: 200% center; } }
.lead { color: rgba(255,255,255,.75); max-width: 600px; margin: 12px auto 0; animation: up .6s .2s var(--ease) both; }
@keyframes up { from { opacity: 0; transform: translateY(14px); } }
.steps { list-style: none; padding: 0; margin: 26px 0 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.steps li { background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 2px; backdrop-filter: blur(8px);
  animation: up .5s var(--ease) both; animation-delay: calc(.3s + var(--i) * .1s); }
.steps .n { width: 26px; height: 26px; margin: 0 auto 4px; border-radius: 50%; background: linear-gradient(135deg, #f5c66b, #e8b04b); color: #3b2a06; font-weight: 700; display: grid; place-items: center; font-size: .85rem; }
.steps small { color: rgba(255,255,255,.6); font-size: .8rem; }
.form-card { padding: 24px; animation: up .6s .35s var(--ease) both; }
.form-card h2 { margin-bottom: 4px; }
@media (max-width: 720px) { .steps { grid-template-columns: 1fr 1fr; } .form-card { padding: 18px 14px; } }
</style>
