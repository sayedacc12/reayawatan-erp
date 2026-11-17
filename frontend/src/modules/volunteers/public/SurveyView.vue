<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import { fmtDate } from '../lib';
import VolShell from './VolShell.vue';
import '../../projects/projects.css';
import '../volunteers.css';

interface Q { key: string; text: string; type: 'rating' | 'yesno' | 'text'; required: boolean }
interface S { organizationName: string; eventTitle: string; kindLabel: string; startDate: string; endDate: string; open: boolean; questions: { volunteer?: Q[]; beneficiary?: Q[] } }
const route = useRoute();
const token = route.params.token as string;
const s = ref<S | null>(null);
const error = ref('');
const audience = ref<'volunteer' | 'beneficiary'>(route.query.a === 'beneficiary' ? 'beneficiary' : 'volunteer');
const answers = reactive<Record<string, unknown>>({});
const name = ref('');
const done = ref(false);
const busy = ref(false);
const formError = ref('');
onMounted(async () => {
  try {
    s.value = await api<S>(`/public/volunteers/survey/${token}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const qs = computed(() => s.value?.questions[audience.value] ?? []);
const FACES = ['😞', '🙁', '😐', '🙂', '😍'];
async function send() {
  formError.value = '';
  busy.value = true;
  try {
    const picked = Object.fromEntries(qs.value.map((q) => [q.key, answers[q.key]]));
    await api(`/public/volunteers/survey/${token}`, { method: 'POST', json: { audience: audience.value, respondentName: name.value || null, answers: picked } });
    done.value = true;
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <VolShell :org="s?.organizationName">
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <section v-if="s" class="card panel">
      <p class="pm-muted" style="margin: 0">استبانة رضا · فعالية {{ s.kindLabel }} · {{ fmtDate(s.startDate) }}</p>
      <h1 style="font-size: 1.35rem; margin: 4px 0 14px">{{ s.eventTitle }}</h1>
      <div v-if="done" style="text-align: center; padding: 18px 0">
        <div style="font-size: 3rem">💚</div><h2>شكرًا لمشاركتك رأيك</h2><p class="pm-muted">رأيك يساعدنا على تحسين فعالياتنا القادمة.</p>
      </div>
      <p v-else-if="!s.open" class="alert alert-error">انتهى استقبال الردود على هذه الاستبانة.</p>
      <form v-else @submit.prevent="send">
        <div v-if="formError" class="alert alert-error">{{ formError }}</div>
        <div class="field"><span>صفتك في الفعالية</span>
          <div class="vt-tabs" style="margin: 0">
            <button type="button" :class="['vt-tab', { on: audience === 'volunteer' }]" @click="audience = 'volunteer'">متطوع مشارك</button>
            <button type="button" :class="['vt-tab', { on: audience === 'beneficiary' }]" @click="audience = 'beneficiary'">مستفيد</button>
          </div>
        </div>
        <label class="field"><span>الاسم (اختياري)</span><input v-model="name" class="input" /></label>
        <div v-for="(q, i) in qs" :key="q.key" class="q" :style="{ '--i': i }">
          <div class="qt">{{ i + 1 }}. {{ q.text }}<span v-if="q.required" style="color: var(--danger)"> *</span></div>
          <div v-if="q.type === 'rating'" class="vt-rate">
            <button v-for="n in 5" :key="n" type="button" :class="{ on: answers[q.key] === n }" :title="`${n} من 5`" @click="answers[q.key] = n">{{ FACES[n - 1] }}</button>
          </div>
          <div v-else-if="q.type === 'yesno'" class="vt-rate">
            <button type="button" style="width: auto; padding: 0 18px" :class="{ on: answers[q.key] === 'yes' }" @click="answers[q.key] = 'yes'">نعم</button>
            <button type="button" style="width: auto; padding: 0 18px" :class="{ on: answers[q.key] === 'no' }" @click="answers[q.key] = 'no'">لا</button>
          </div>
          <textarea v-else v-model="answers[q.key] as string" class="input" rows="2" />
        </div>
        <button class="btn btn-primary" style="width: 100%; min-height: 46px" :disabled="busy">إرسال</button>
      </form>
    </section>
  </VolShell>
</template>

<style scoped>
.panel { padding: 22px; border-radius: 18px; margin-top: 18px; }
.q { padding: 12px 0; border-bottom: 1px dashed var(--border); animation: pm-rise .4s calc(var(--i) * 50ms) var(--ease) both; }
.qt { font-weight: 600; margin-bottom: 8px; }
</style>
