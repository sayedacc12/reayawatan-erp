<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import SupplierFields from '../modules/procurement/components/SupplierFields.vue';
import { supplierForm, supplierPayload } from '../modules/procurement/lib';
import { loadMe, setMe, supplierApi } from './supplier';

const route = useRoute();
const slug = route.params.slug as string;
const info = ref<any>(null);
const m = ref<any>(null);
const form = ref(supplierForm());
const busy = ref(false);
const error = ref('');
const ok = ref('');
onMounted(async () => {
  try {
    [info.value, m.value] = await Promise.all([supplierApi(`/o/${slug}`), loadMe(true)]);
    form.value = supplierForm(m.value.supplier);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
async function save() {
  busy.value = true;
  error.value = '';
  ok.value = '';
  try {
    m.value = await supplierApi('/me', { method: 'PUT', json: supplierPayload(form.value) });
    setMe(m.value);
    ok.value = 'حُفظت البيانات ✓';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-head"><div><h1>بيانات المنشأة</h1><p class="muted">حدّث بيانات منشأتك وجهات التواصل والفروع.</p></div></div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="ok" class="alert alert-success">{{ ok }}</div>
    <form v-if="m && info" class="card pm-panel" @submit.prevent="save">
      <SupplierFields v-model="form" :entity-types="info.entityTypes" :supplier-kinds="info.supplierKinds" :categories="info.categories" :activities="info.activities" :legal-locked="m.supplier.legalLocked" />
      <p v-if="m.user.role !== 'owner'" class="pm-muted">تعديل البيانات لمدير الحساب فقط.</p>
      <button v-else class="btn btn-primary" :disabled="busy">{{ busy ? 'جارٍ الحفظ...' : 'حفظ' }}</button>
    </form>
  </div>
</template>
