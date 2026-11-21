<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import { fmtDate } from '../lib';
import VolShell from './VolShell.vue';
import '../../../shared/module.css';
import '../volunteers.css';

interface R { certificateNo: string; kind: string; title: string; hours: number; issuedOn: string; isRevoked: boolean; volunteerName: string; organizationName: string }
const route = useRoute();
const code = ref((route.query.code as string) ?? '');
const r = ref<R | null>(null);
const error = ref('');
async function check() {
  error.value = '';
  r.value = null;
  try {
    r.value = await api<R>(`/public/volunteers/certificate/${encodeURIComponent(code.value.trim())}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
if (code.value) check();
</script>

<template>
  <VolShell>
    <section class="card" style="padding: 22px; border-radius: 18px; margin-top: 30px">
      <h1 style="font-size: 1.3rem">التحقق من شهادة تطوع</h1>
      <p class="pm-muted">اكتب رمز التحقق المطبوع أسفل الشهادة.</p>
      <form style="display: flex; gap: 8px" @submit.prevent="check">
        <input v-model="code" class="input" dir="ltr" placeholder="A1B2C3D4E5" required />
        <button class="btn btn-primary">تحقق</button>
      </form>
      <div v-if="error" class="alert alert-error" style="margin-top: 12px">{{ error }}</div>
      <div v-if="r" :class="['res', { bad: r.isRevoked }]">
        <b>{{ r.isRevoked ? '⚠️ هذه الشهادة ملغاة' : '✅ شهادة صحيحة' }}</b>
        <p>{{ r.title }} رقم {{ r.certificateNo }} صادرة من <b>{{ r.organizationName }}</b> للمتطوع/ـة <b>{{ r.volunteerName }}</b>
          بتاريخ {{ fmtDate(r.issuedOn) }}{{ r.kind === 'hours' ? `، بعدد ${r.hours} ساعة تطوعية` : '' }}.</p>
      </div>
    </section>
  </VolShell>
</template>

<style scoped>
.res { margin-top: 14px; padding: 12px 14px; border-radius: 12px; background: #ecfdf5; color: #065f46; }
.res.bad { background: #fef2f2; color: #991b1b; }
.res p { margin: 6px 0 0; }
</style>
