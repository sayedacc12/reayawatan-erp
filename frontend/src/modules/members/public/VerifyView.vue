<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import { fmtDate } from '../lib';
import MemShell from './MemShell.vue';
import '../../projects/projects.css';
import '../members.css';

/** التحقق العام من بطاقة العضوية برمز التحقق المطبوع عليها */
interface Result { orgName: string; memberNo: number; fullName: string; typeName: string; endDate: string; statusLabel: string; valid: boolean }
const route = useRoute();
const code = ref((route.query.code as string) ?? '');
const result = ref<Result | null>(null);
const error = ref('');
async function verify() {
  error.value = '';
  result.value = null;
  try {
    result.value = await api<Result>(`/public/members/card/${encodeURIComponent(code.value.trim())}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => code.value && verify());
</script>

<template>
  <MemShell :org="result?.orgName">
    <section class="card box">
      <h1>التحقق من بطاقة عضوية</h1>
      <p class="pm-muted">اكتب رمز التحقق المطبوع على البطاقة.</p>
      <form style="display: flex; gap: 8px" @submit.prevent="verify">
        <input v-model="code" class="input mb-code" placeholder="A1B2C3D4E5" required />
        <button class="btn btn-primary">تحقق</button>
      </form>
      <div v-if="error" class="alert alert-error" style="margin-top: 12px">{{ error }}</div>
      <Transition name="page">
        <div v-if="result" :class="['res', { bad: !result.valid }]">
          <div class="icon">{{ result.valid ? '✓' : '!' }}</div>
          <h2>{{ result.valid ? 'بطاقة صحيحة وسارية' : `البطاقة صحيحة لكن العضوية ${result.statusLabel}` }}</h2>
          <p><b>{{ result.fullName }}</b> · عضوية رقم {{ result.memberNo }} · {{ result.typeName }}</p>
          <p class="pm-muted">{{ result.orgName }} · صالحة حتى {{ fmtDate(result.endDate) }}</p>
        </div>
      </Transition>
    </section>
  </MemShell>
</template>

<style scoped>
.box { margin-top: 30px; padding: 24px; border-radius: 20px; text-align: center; }
.res { margin-top: 18px; padding: 16px; border-radius: 16px; background: #ecfdf5; color: #065f46; }
.res.bad { background: #fff7ed; color: #9a3412; }
.icon { width: 60px; height: 60px; margin: 0 auto 8px; border-radius: 50%; display: grid; place-items: center; font-size: 1.8rem; color: #fff; background: #10b981; }
.res.bad .icon { background: #f97316; }
</style>
