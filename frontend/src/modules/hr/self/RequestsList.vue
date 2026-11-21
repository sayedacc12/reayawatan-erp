<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { REQ_COLOR, type ReqRow } from './ess';
import ReqList from './ReqList.vue';

const rows = ref<ReqRow[] | null>(null);
const error = ref('');
const status = ref('all');
const q = ref('');
onMounted(async () => {
  try {
    rows.value = await api<ReqRow[]>('/hr/me/requests');
  } catch (e) {
    error.value = (e as Error).message;
    rows.value = [];
  }
});
const FILTERS = [
  { v: 'all', label: 'الكل' }, { v: 'pending', label: 'قيد الاعتماد' }, { v: 'returned', label: 'معادة للتعديل' },
  { v: 'approved', label: 'معتمدة' }, { v: 'rejected', label: 'مرفوضة' }, { v: 'cancelled', label: 'ملغاة' },
];
const count = (v: string) => (rows.value ?? []).filter((r) => v === 'all' || r.status === v).length;
const shown = computed(() => (rows.value ?? []).filter((r) => (status.value === 'all' || r.status === status.value)
  && (!q.value || `${r.typeName} ${r.summary} ${r.requestNo}`.includes(q.value.trim()))));
</script>

<template>
  <div>
    <div class="ess-head">
      <div>
        <p class="ess-kicker" style="color: var(--muted)">الخدمة الذاتية</p>
        <h1>طلباتي</h1>
      </div>
      <RouterLink to="/me/new" class="btn btn-primary">+ طلب جديد</RouterLink>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <section class="card ess-card">
      <div class="hr-toolbar">
        <div class="ess-filters">
          <button v-for="f in FILTERS" :key="f.v" :class="{ on: status === f.v }" :style="{ '--c': REQ_COLOR[f.v] ?? '#1f6446' }" @click="status = f.v">
            {{ f.label }} <b>{{ count(f.v) }}</b>
          </button>
        </div>
        <span class="grow" />
        <input v-model="q" class="input" placeholder="بحث برقم الطلب أو نوعه" />
      </div>
      <div v-if="!rows" class="ess-skeleton"><i /><i /></div>
      <ReqList v-else :rows="shown" :empty="status === 'all' && !q ? 'لم تقدّم أي طلب بعد. ابدأ من «طلب جديد».' : 'لا توجد طلبات بهذا التصنيف'" />
    </section>
  </div>
</template>
