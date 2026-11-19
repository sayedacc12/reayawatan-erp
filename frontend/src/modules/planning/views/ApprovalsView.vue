<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { errMsg, fmtDateTime, KIND, money, pct } from '../lib';
import '../../projects/projects.css';
import '../../risk/risk.css';
import '../planning.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const router = useRouter();
const rows = ref<any[] | null>(null);
const error = ref('');
onMounted(async () => {
  try { rows.value = await api<any[]>('/planning/approvals'); } catch (e) { error.value = errMsg(e); }
});
</script>

<template>
  <div>
    <div class="page-head"><div><h1>بانتظار اعتمادي</h1><p class="muted">الخطط المرفوعة للاعتماد. تظهر أولًا الخطط التي تنتظر قرارك في مرحلتها الحالية.</p></div></div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <section v-if="rows" class="card pm-panel">
      <p v-if="!rows.length" class="pm-empty">لا توجد خطط قيد الاعتماد</p>
      <div v-else class="table-wrap"><table class="table">
        <thead><tr><th>الخطة</th><th>النوع</th><th>المرحلة الحالية</th><th>التكلفة</th><th>رُفعت</th><th /></tr></thead>
        <tbody><tr v-for="r in rows" :key="r.id" class="rk-row" @click="router.push(`/planning/plans/${r.id}?tab=versions`)">
          <td style="white-space: normal"><span class="rk-code">{{ r.code }}</span> {{ r.title }}<span class="pm-muted">{{ r.unitName ?? '—' }} · {{ r.startYear }}{{ r.endYear !== r.startYear ? ` - ${r.endYear}` : '' }}
            <template v-if="r.version"> · تعديل على الإصدار {{ r.version }}: {{ r.revisionNote }}</template></span></td>
          <td>{{ KIND[r.kind] }}</td>
          <td>{{ r.stageName }}<span class="pm-muted">{{ r.routeName }}</span></td>
          <td class="pm-money">{{ money(r.summary.totalCost) }}<span class="pm-muted">{{ r.summary.items }} عنصرًا · {{ r.summary.kpis }} مؤشرًا · {{ pct(r.summary.progress) }}</span></td>
          <td>{{ fmtDateTime(r.submittedAt) }}</td>
          <td><span v-if="r.canDecide" class="pm-pill" style="--c: #f59e0b">بانتظار قرارك</span></td>
        </tr></tbody>
      </table></div>
    </section>
  </div>
</template>
