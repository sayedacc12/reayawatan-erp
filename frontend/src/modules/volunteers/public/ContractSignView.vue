<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import { fmtDate, fmtDateTime } from '../lib';
import VolShell from './VolShell.vue';
import '../../projects/projects.css';
import '../volunteers.css';

interface C { contractNo: string; organizationName: string; volunteerName: string; startDate: string; endDate: string; clauses: { title: string; body: string }[]; status: string; signedName: string | null; signedAt: string | null }
const route = useRoute();
const token = route.params.token as string;
const c = ref<C | null>(null);
const error = ref('');
const f = reactive({ signedName: '', accept: false });
const busy = ref(false);
const formError = ref('');
onMounted(async () => {
  try {
    c.value = await api<C>(`/public/volunteers/contract/${token}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
async function sign() {
  formError.value = '';
  busy.value = true;
  try {
    c.value = await api<C>(`/public/volunteers/contract/${token}/sign`, { method: 'POST', json: f });
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <VolShell :org="c?.organizationName" wide>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <article v-if="c" class="card doc">
      <h1>عقد تطوع</h1>
      <p class="pm-muted" style="text-align: center">رقم العقد <span class="vt-code">{{ c.contractNo }}</span> · من {{ fmtDate(c.startDate) }} إلى {{ fmtDate(c.endDate) }}</p>
      <section v-for="(cl, i) in c.clauses" :key="i"><h3>{{ i + 1 }}. {{ cl.title }}</h3><p>{{ cl.body }}</p></section>
      <div v-if="c.status === 'signed'" class="signed">✅ وقّع {{ c.signedName }} هذا العقد إلكترونيًا في {{ fmtDateTime(c.signedAt) }}</div>
      <form v-else class="sign" @submit.prevent="sign">
        <div v-if="formError" class="alert alert-error">{{ formError }}</div>
        <label class="field"><span>اكتب اسمك الكامل للتوقيع ({{ c.volunteerName }})</span><input v-model="f.signedName" class="input" required /></label>
        <label class="check"><input v-model="f.accept" type="checkbox" required /> قرأت بنود العقد وأوافق عليها</label>
        <button class="btn btn-primary" style="margin-top: 10px; min-height: 44px" :disabled="busy">توقيع العقد</button>
      </form>
    </article>
  </VolShell>
</template>

<style scoped>
.doc { padding: 32px 40px; line-height: 2; margin-top: 16px; border-radius: 18px; }
h1 { text-align: center; font-size: 1.6rem; margin: 0; }
h3 { font-size: 1rem; margin: 12px 0 0; color: #065f46; }
section p { margin: 0; }
.sign { margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--border); }
.signed { margin-top: 20px; padding: 12px 14px; border-radius: 12px; background: #ecfdf5; color: #047857; font-weight: 600; }
@media (max-width: 640px) { .doc { padding: 20px 16px; } }
</style>
