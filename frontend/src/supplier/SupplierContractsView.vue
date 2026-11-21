<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CONTRACT_COLOR, fmtDate, sar } from '../modules/procurement/lib';
import { supplierApi } from './supplier';

/** عقود المورد السارية والمنتهية التي شاركتها الشركة معه */
const route = useRoute();
const router = useRouter();
const slug = computed(() => route.params.slug as string);
const rows = ref<any[]>([]);
const error = ref('');
const loading = ref(true);
onMounted(async () => {
  try {
    rows.value = await supplierApi('/contracts');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>العقود</h1>
        <p class="muted">العقود والاتفاقيات المعتمدة بينكم وبين الشركة: المدة والقيمة والأسعار التعاقدية ومستويات الخدمة والجزاءات المعتمدة.</p>
      </div>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>العقد</th><th>المدة</th><th>القيمة</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="pc-row" @click="router.push(`/supplier/${slug}/contracts/${r.id}`)">
            <td class="pc-code">{{ r.code }}<small class="pm-muted" style="display: block">{{ r.kindLabel }}</small></td>
            <td>{{ r.title }}</td>
            <td style="font-size: .85rem">{{ fmtDate(r.startsOn) }}<small class="pm-muted" style="display: block">إلى {{ fmtDate(r.endsOn) }}</small></td>
            <td class="pc-num">{{ sar(r.value) }}</td>
            <td><span class="pm-pill" :style="{ '--c': CONTRACT_COLOR[r.status] }">{{ r.statusLabel }}</span></td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="5" class="pc-empty">لا توجد عقود.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
