<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { fmtDate } from '../lib';
import { loadSummary, type ReqRow } from './ess';
import ReqList from './ReqList.vue';

const data = ref<{ waiting: ReqRow[]; decided: ReqRow[] } | null>(null);
const error = ref('');
const tab = ref<'waiting' | 'decided'>('waiting');
interface Clr { separationId: string; separationNo: number; employeeName: string; lastWorkingDay: string; code: string; name: string; status: string }
const clearance = ref<Clr[]>([]);
onMounted(async () => {
  try {
    [data.value, clearance.value] = await Promise.all([api<{ waiting: ReqRow[]; decided: ReqRow[] }>('/hr/me/approvals'), api<Clr[]>('/hr/me/clearance')]);
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
    <section v-if="clearance.length" class="card ess-card" style="margin-bottom: 14px">
      <h2>🚪 إخلاء طرف بانتظارك <small class="pm-muted">({{ clearance.length }})</small></h2>
      <p class="pm-muted" style="margin-top: 0">بنود إخلاء طرف لموظفين تنتهي خدمتهم، وأنت المسؤول عنها. افتح الملف لإخلاء البند أو إيقافه بملاحظة.</p>
      <RouterLink v-for="c in clearance" :key="`${c.separationId}-${c.code}`" :to="`/hr/separations/${c.separationId}`" class="ess-clr">
        <b>{{ c.name }}</b><span>{{ c.employeeName }} · ملف {{ c.separationNo }}</span><small>آخر يوم عمل {{ fmtDate(c.lastWorkingDay) }}<template v-if="c.status === 'blocked'"> · متوقف</template></small>
      </RouterLink>
    </section>
    <section v-if="data" class="card ess-card">
      <div class="pm-tabs">
        <button :class="['pm-tab', { on: tab === 'waiting' }]" @click="tab = 'waiting'">بانتظار قراري <b>{{ data.waiting.length }}</b></button>
        <button :class="['pm-tab', { on: tab === 'decided' }]" @click="tab = 'decided'">قرارات سابقة <b>{{ data.decided.length }}</b></button>
      </div>
      <ReqList :rows="tab === 'waiting' ? data.waiting : data.decided" show-employee :empty="tab === 'waiting' ? 'لا توجد طلبات بانتظارك 🎉' : 'لم تتخذ قرارات بعد'" />
    </section>
  </div>
</template>

<style scoped>
.ess-clr { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; padding: 10px 12px; border: 1px solid var(--border); border-inline-start: 4px solid #f59e0b; border-radius: 10px; margin-bottom: 8px; color: var(--text); text-decoration: none; transition: transform .2s var(--ease); }
.ess-clr:hover { transform: translateX(-3px); }
.ess-clr span { grid-column: 1; color: var(--muted); font-size: .85rem; }
.ess-clr small { grid-row: 1 / 3; grid-column: 2; align-self: center; color: var(--muted); }
</style>
