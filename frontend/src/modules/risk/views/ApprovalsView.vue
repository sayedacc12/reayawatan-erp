
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { fmtDateTime, loadConfig } from '../lib';
import '../../../shared/module.css';
import '../risk.css';

interface Item { process: string; id: string; code: string; title: string; stageName: string | null; link: string; submittedAt: string | null; byName: string | null }
const router = useRouter();
const items = ref<Item[] | null>(null);
const names = ref<Record<string, string>>({});
const error = ref('');
onMounted(async () => {
  try {
    const [rows, cfg] = await Promise.all([api<Item[]>('/risk/approvals'), loadConfig()]);
    items.value = rows;
    names.value = cfg.processes;
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>

<template>
  <div>
    <div class="page-head"><div><h1>بانتظار اعتمادي</h1><p class="muted">كل ما ينتظر قرارك في مراحل الاعتماد: المخاطر، والتحليلات، والتغيير، والالتزام، والاستمرارية، وفرق الأزمات، والإجراءات.</p></div></div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <section v-if="items" class="card pm-panel">
      <p v-if="!items.length" class="pm-empty">لا يوجد ما ينتظر قرارك الآن</p>
      <div v-else class="table-wrap"><table class="table">
        <thead><tr><th>النوع</th><th>الرمز</th><th>العنوان</th><th>المرحلة</th><th>رفعه</th></tr></thead>
        <tbody><tr v-for="i in items" :key="i.id" class="rk-row" @click="router.push(i.link)">
          <td><span class="pm-tag">{{ names[i.process] ?? i.process }}</span></td><td class="rk-code">{{ i.code }}</td>
          <td style="white-space: normal">{{ i.title }}</td><td><span class="pm-pill" style="--c: #f59e0b">{{ i.stageName }}</span></td>
          <td>{{ i.byName }}<span class="pm-muted">{{ fmtDateTime(i.submittedAt) }}</span></td>
        </tr></tbody>
      </table></div>
    </section>
  </div>
</template>
