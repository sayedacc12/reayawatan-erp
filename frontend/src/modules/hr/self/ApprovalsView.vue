<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { loadSummary, type ReqRow } from './ess';
import ReqList from './ReqList.vue';

const data = ref<{ waiting: ReqRow[]; decided: ReqRow[] } | null>(null);
const error = ref('');
const tab = ref<'waiting' | 'decided'>('waiting');
onMounted(async () => {
  try {
    data.value = await api('/hr/me/approvals');
    loadSummary(true);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>

<template>
  <div>
    <div class="ess-head">
      <div>
        <p class="ess-kicker" style="color: var(--muted)">الاعتمادات</p>
        <h1>بانتظار اعتمادي</h1>
        <p class="pm-muted" style="margin: 4px 0 0">الطلبات التي وصلت إليك حسب التبعية الإدارية في الهيكل أو حسب دورك في مسار الاعتماد.</p>
      </div>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="!data" class="ess-skeleton"><i /><i /></div>
    <section v-else class="card ess-card">
      <div class="pm-tabs">
        <button :class="['pm-tab', { on: tab === 'waiting' }]" @click="tab = 'waiting'">بانتظار قراري <b>{{ data.waiting.length }}</b></button>
        <button :class="['pm-tab', { on: tab === 'decided' }]" @click="tab = 'decided'">قرارات سابقة <b>{{ data.decided.length }}</b></button>
      </div>
      <ReqList :rows="tab === 'waiting' ? data.waiting : data.decided" show-employee :empty="tab === 'waiting' ? 'لا توجد طلبات بانتظارك 🎉' : 'لم تتخذ قرارات بعد'" />
    </section>
  </div>
</template>
