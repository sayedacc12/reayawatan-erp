<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import BrandMark from '../components/BrandMark.vue';

interface Q { id: string; text: string; type: 'rating' | 'choice' | 'text'; options?: string[] }
interface Survey { title: string; description: string | null; organizationName: string; questions: Q[]; open: boolean; formCode: string | null }
const route = useRoute();
const token = route.params.token as string;
const s = ref<Survey | null>(null);
const error = ref('');
const sent = ref(false);
const busy = ref(false);
const f = reactive({ respondentName: '', answers: {} as Record<string, string | number> });
onMounted(async () => {
  try {
    s.value = await api<Survey>(`/public/surveys/${token}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const FACES = ['😞', '🙁', '😐', '🙂', '😍'];
const LABELS = ['غير راضٍ إطلاقًا', 'غير راضٍ', 'محايد', 'راضٍ', 'راضٍ جدًا'];
const missing = computed(() => (s.value?.questions ?? []).filter((q) => q.type === 'rating' && !f.answers[q.id]).length);
async function submit() {
  if (missing.value) {
    error.value = 'أجب عن كل أسئلة التقييم';
    return;
  }
  error.value = '';
  busy.value = true;
  try {
    await api(`/public/surveys/${token}`, { method: 'POST', json: { answers: f.answers, respondentName: f.respondentName || null } });
    sent.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="sv">
    <div class="glow" aria-hidden="true"><span /><span /></div>
    <main class="wrap">
      <header class="top"><BrandMark :size="30" /><b>{{ s?.organizationName || 'رعاية وطن' }}</b></header>
      <div v-if="error && !s" class="card box">{{ error }}</div>
      <div v-else-if="sent" class="card box done">
        <span class="big">✓</span>
        <h1>شكرًا لك</h1>
        <p>وصل رأيك، وسنستفيد منه في تحسين خدماتنا.</p>
      </div>
      <form v-else-if="s" class="card box" @submit.prevent="submit">
        <p class="kicker">استبانة رضا<template v-if="s.formCode"> · <span dir="ltr">{{ s.formCode }}</span></template></p>
        <h1>{{ s.title }}</h1>
        <p v-if="s.description" class="muted">{{ s.description }}</p>
        <p v-if="!s.open" class="closed">هذه الاستبانة مغلقة حاليًا ولا تستقبل ردودًا.</p>
        <template v-else>
          <div v-for="(q, i) in s.questions" :key="q.id" class="q" :style="{ '--i': i }">
            <p class="qt">{{ i + 1 }}. {{ q.text }}</p>
            <div v-if="q.type === 'rating'" class="faces">
              <button v-for="n in 5" :key="n" type="button" :class="{ on: f.answers[q.id] === n }" :title="LABELS[n - 1]" @click="f.answers[q.id] = n">
                <span>{{ FACES[n - 1] }}</span><small>{{ LABELS[n - 1] }}</small>
              </button>
            </div>
            <div v-else-if="q.type === 'choice'" class="opts">
              <label v-for="o in q.options" :key="o" :class="{ on: f.answers[q.id] === o }"><input v-model="f.answers[q.id]" type="radio" :value="o" /> {{ o }}</label>
            </div>
            <textarea v-else v-model="f.answers[q.id]" class="input" rows="3" />
          </div>
          <label class="field"><span>الاسم (اختياري)</span><input v-model="f.respondentName" class="input" /></label>
          <div v-if="error" class="alert alert-error">{{ error }}</div>
          <button class="btn btn-primary send" :disabled="busy">{{ busy ? 'جارٍ الإرسال...' : 'إرسال' }}</button>
        </template>
      </form>
    </main>
  </div>
</template>

<style scoped>
.sv { min-height: 100vh; background: var(--grad-dark); position: relative; overflow-x: hidden; padding: 24px 14px 60px; }
.glow { position: fixed; inset: 0; pointer-events: none; }
.glow span { position: absolute; width: 50vmax; height: 50vmax; border-radius: 50%; filter: blur(90px); opacity: .3; animation: drift 16s ease-in-out infinite alternate; }
.glow span:first-child { background: #2f7a57; top: -20vmax; right: -15vmax; }
.glow span:last-child { background: #c7a27a; bottom: -25vmax; left: -15vmax; opacity: .2; animation-delay: -8s; }
@keyframes drift { to { transform: translate(5vmax, 4vmax) scale(1.08); } }
.wrap { position: relative; z-index: 1; max-width: 640px; margin: 0 auto; }
.top { display: flex; align-items: center; gap: 10px; color: #fff; font-size: 1.1rem; margin-bottom: 16px; }
.box { padding: 26px; animation: rise .5s ease both; }
.box h1 { margin: 4px 0 6px; font-size: 1.4rem; }
.kicker { color: var(--primary); font-weight: 700; font-size: .82rem; margin: 0; }
.muted { color: var(--muted); }
.closed { background: #fef2f2; color: #991b1b; border-radius: 12px; padding: 12px; }
.q { padding: 16px 0; border-bottom: 1px solid var(--border); animation: rise .45s calc(var(--i) * 60ms) ease both; }
.qt { font-weight: 600; margin: 0 0 10px; }
.faces { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.faces button { border: 1px solid var(--border); background: var(--surface); border-radius: 14px; padding: 8px 2px; cursor: pointer; display: grid; gap: 2px; transition: transform .15s, background .15s, border-color .15s; }
.faces button span { font-size: 1.6rem; filter: grayscale(.7); transition: filter .15s; }
.faces button small { font-size: .66rem; color: var(--muted); }
.faces button:hover { transform: translateY(-2px); }
.faces button.on { border-color: var(--primary); background: var(--primary-soft); transform: translateY(-3px) scale(1.04); }
.faces button.on span { filter: none; }
.opts { display: grid; gap: 6px; }
.opts label { border: 1px solid var(--border); border-radius: 12px; padding: 8px 12px; cursor: pointer; }
.opts label.on { border-color: var(--primary); background: var(--primary-soft); }
.send { width: 100%; margin-top: 12px; padding: 12px; font-size: 1rem; }
.done { text-align: center; }
.done .big { display: inline-grid; place-items: center; width: 72px; height: 72px; border-radius: 50%; background: linear-gradient(135deg, #10b981, #2f7a57); color: #fff; font-size: 2rem; animation: pop .6s ease both; }
@keyframes rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes pop { 0% { transform: scale(.3); opacity: 0; } 70% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
@media (max-width: 480px) { .faces button small { display: none; } }
</style>
