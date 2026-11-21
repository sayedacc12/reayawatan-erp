<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import StatementTable from '../modules/procurement/components/StatementTable.vue';
import { sar } from '../modules/procurement/lib';
import { supplierApi } from './supplier';

/** كشف حساب المورد لدى الجمعية */
const st = ref<any>(null);
const error = ref('');
const f = ref({ from: '', to: '' });
async function load() {
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    st.value = await supplierApi(`/statement?${q}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(() => [f.value.from, f.value.to], load);
const printPage = () => window.print();
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="st">
      <div class="page-head">
        <div><h1>كشف الحساب</h1><p class="muted">{{ st.supplier.code }} · {{ st.supplier.name }}. يظهر في الكشف ما سجلته الجمعية من فواتير وإشعارات دائنة وما سددته.</p></div>
        <div class="pc-noprint"><button class="btn" @click="printPage">طباعة</button></div>
      </div>
      <div class="pc-toolbar pc-noprint">
        <label class="field"><span>من</span><input v-model="f.from" type="date" class="input" /></label>
        <label class="field"><span>إلى</span><input v-model="f.to" type="date" class="input" :min="f.from" /></label>
      </div>
      <p v-if="st.underReview.count" class="pm-muted" style="margin: 0 0 10px">لديكم {{ st.underReview.count }} فاتورة قيد المراجعة بمبلغ {{ sar(st.underReview.amount) }}، وتظهر في الكشف بعد تسجيلها.</p>
      <StatementTable :st="st" :link-base="`/supplier/${$route.params.slug}/invoices`" />
    </template>
  </div>
</template>
