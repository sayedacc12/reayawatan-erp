<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import StatusBadge from '../modules/beneficiaries/components/StatusBadge.vue';
import { useToast } from '../stores/toast';
import { portalApi } from './portal';

interface Me { organization: { name: string }; profile: { fullName: string; fileNo: number; nationalId: string; phone: string | null; altPhone: string | null; city: string | null; address: string | null; status: string } }
const toast = useToast();
const me = ref<Me | null>(null);
const form = reactive({ phone: '', altPhone: '', city: '', address: '' });
const error = ref('');

onMounted(async () => {
  me.value = await portalApi<Me>('/me');
  const p = me.value.profile;
  Object.assign(form, { phone: p.phone ?? '', altPhone: p.altPhone ?? '', city: p.city ?? '', address: p.address ?? '' });
});

async function save() {
  error.value = '';
  try {
    me.value = await portalApi<Me>('/me', { method: 'PATCH', json: form });
    toast.success('تم حفظ بياناتك');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <div v-if="me" class="grid">
    <section class="card id">
      <span class="av">{{ me.profile.fullName.charAt(0) }}</span>
      <h2>{{ me.profile.fullName }}</h2>
      <p class="muted">ملف رقم {{ me.profile.fileNo }} في {{ me.organization.name }}</p>
      <p dir="ltr" class="nid">{{ me.profile.nationalId }}</p>
      <StatusBadge :value="me.profile.status" />
    </section>
    <form class="card edit" @submit.prevent="save">
      <h2>بيانات التواصل</h2>
      <p class="muted small">الاسم ورقم الهوية بيتعدلوا من الجمعية فقط.</p>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <div class="two">
        <div class="field"><label>الموبايل</label><input v-model="form.phone" class="input" dir="ltr" required /></div>
        <div class="field"><label>رقم إضافي</label><input v-model="form.altPhone" class="input" dir="ltr" /></div>
        <div class="field"><label>المدينة</label><input v-model="form.city" class="input" /></div>
        <div class="field"><label>العنوان</label><input v-model="form.address" class="input" /></div>
      </div>
      <button class="btn btn-primary">حفظ</button>
    </form>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: 300px 1fr; gap: 18px; align-items: start; }
.id { padding: 26px 20px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.av { width: 76px; height: 76px; border-radius: 24px; display: grid; place-items: center; font-size: 2rem; font-weight: 700; color: #fff; background: var(--grad); box-shadow: 0 12px 30px rgba(20,184,166,.45); margin-bottom: 6px; }
.id p { margin: 0; }
.nid { font-weight: 600; letter-spacing: 1px; }
.edit { padding: 20px; }
.edit h2 { margin-bottom: 4px; }
.small { font-size: .84rem; margin: 0 0 14px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
@media (max-width: 760px) { .grid, .two { grid-template-columns: 1fr; } }
</style>
