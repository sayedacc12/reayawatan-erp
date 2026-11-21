<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import StatementTable from '../components/StatementTable.vue';
import { sar } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

/** كشف حساب المورد: الفواتير المسجلة في المالي والإشعارات الدائنة والسداد، والرصيد المستحق له */
const props = defineProps<{ id: string }>();
const router = useRouter();
const toast = useToast();
const st = ref<any>(null);
const f = ref({ from: '', to: '' });
async function load() {
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    st.value = await api(`/procurement/suppliers/${props.id}/statement?${q}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
watch(() => [f.value.from, f.value.to], load);
const printPage = () => window.print();
</script>

<template>
  <div v-if="st">
    <div class="page-head">
      <div>
        <h1>كشف حساب المورد</h1>
        <p class="muted">{{ st.supplier.code }} · {{ st.supplier.name }}<span v-if="st.supplier.vatNumber"> · الرقم الضريبي {{ st.supplier.vatNumber }}</span></p>
      </div>
      <div class="pc-inline pc-noprint">
        <button class="btn" @click="printPage">طباعة</button>
        <button class="btn btn-ghost" @click="router.push(`/procurement/suppliers/${id}`)">ملف المورد</button>
      </div>
    </div>
    <div class="pc-toolbar pc-noprint">
      <label class="field"><span>من</span><input v-model="f.from" type="date" class="input" /></label>
      <label class="field"><span>إلى</span><input v-model="f.to" type="date" class="input" :min="f.from" /></label>
    </div>
    <p v-if="st.underReview.count" class="pm-muted" style="margin: 0 0 10px">لا يشمل الكشف {{ st.underReview.count }} فاتورة قيد المراجعة أو بانتظار التسجيل في المالي بمبلغ {{ sar(st.underReview.amount) }}.</p>
    <StatementTable :st="st" link-base="/procurement/invoices" />
  </div>
</template>
