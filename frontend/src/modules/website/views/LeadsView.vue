<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { api, downloadProtectedFile } from '../../../api';
import { useToast } from '../../../stores/toast';
import { dateOnly, riyadh, SOURCES, STATUSES, type LeadRow } from '../lib';
import '../../../shared/module.css';
import '../../../shared/ws.css';
import '../website.css';

const toast = useToast();
const f = reactive({ status: 'open', source: '', q: '', page: 1 });
const data = ref<{ rows: LeadRow[]; total: number; size: number; counts: Record<string, number> } | null>(null);
const error = ref('');
async function load() {
  try {
    const qs = new URLSearchParams();
    for (const k of ['status', 'source', 'q'] as const) if (f[k]) qs.set(k, f[k]);
    qs.set('page', String(f.page));
    data.value = await api(`/website/leads?${qs}`);
    error.value = '';
  } catch (e) { error.value = (e as Error).message; }
}
onMounted(load);
watch(() => [f.status, f.source], () => { f.page = 1; load(); });
watch(() => f.page, load);
let t: ReturnType<typeof setTimeout> | undefined;
watch(() => f.q, () => { clearTimeout(t); t = setTimeout(() => { f.page = 1; load(); }, 350); });
const TABS = [{ v: 'open', l: 'قيد المتابعة' }, { v: 'new', l: 'جديد' }, { v: 'won', l: 'تم التعاقد' }, { v: 'lost', l: 'لم يتم' }, { v: 'spam', l: 'غير جاد' }, { v: '', l: 'الكل' }];
const openCount = () => ['new', 'contacted', 'qualified', 'proposal'].reduce((a, k) => a + (data.value?.counts[k] ?? 0), 0);
async function exportCsv() {
  try { await downloadProtectedFile('/website/leads/export', 'leads.csv'); } catch (e) { toast.error((e as Error).message); }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>العملاء المحتملون</h1><p class="muted" style="margin: 4px 0 0">كل ما يصل من نماذج الموقع، بنتيجة كل أداة. تواصلوا مع كل طلب جديد خلال يومي عمل.</p></div>
      <button class="btn" @click="exportCsv">تصدير CSV</button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="ws-tabs">
      <button v-for="tb in TABS" :key="tb.v" :class="['ws-tab', { on: f.status === tb.v }]" @click="f.status = tb.v">
        {{ tb.l }}
        <span v-if="tb.v === 'open' && data" class="count">{{ openCount() }}</span>
        <span v-else-if="tb.v && data?.counts[tb.v]" :class="['count', { warn: tb.v === 'new' }]">{{ data.counts[tb.v] }}</span>
      </button>
    </div>
    <div class="ws-filters">
      <select v-model="f.source" class="input"><option value="">كل المصادر</option><option v-for="(s, k) in SOURCES" :key="k" :value="k">{{ s.l }}</option></select>
      <input v-model="f.q" class="input grow" placeholder="بحث بالاسم أو الجهة أو البريد أو الجوال">
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>#</th><th>الاسم والجهة</th><th>المصدر</th><th>النتيجة</th><th>الحالة</th><th>المسؤول</th><th>التاريخ</th></tr></thead>
        <tbody>
          <tr v-for="r in data?.rows ?? []" :key="r.id">
            <td>{{ r.leadNo }}</td>
            <td><RouterLink :to="`/website/leads/${r.id}`"><b>{{ r.name }}</b></RouterLink><br><small class="muted">{{ r.orgName || r.email }}</small></td>
            <td><span class="ws-pill" :style="{ '--c': SOURCES[r.source]?.c }">{{ SOURCES[r.source]?.l }}</span></td>
            <td>
              <span v-if="r.score !== null">جاهزية {{ r.score }}/100</span>
              <span v-else-if="r.bookingAt">جلسة {{ riyadh(r.bookingAt) }}</span>
              <span v-else-if="r.serviceSlug" class="muted">{{ r.serviceSlug }}</span>
              <span v-else class="muted">—</span>
            </td>
            <td><span class="ws-pill" :style="{ '--c': STATUSES[r.status]?.c }">{{ STATUSES[r.status]?.l }}</span></td>
            <td>{{ r.assignedName ?? '—' }}<br><small v-if="r.nextActionOn" class="muted">متابعة {{ r.nextActionOn }}</small></td>
            <td>{{ dateOnly(r.createdAt) }}</td>
          </tr>
          <tr v-if="data && !data.rows.length"><td colspan="7" class="ws-empty">لا توجد طلبات بهذه التصفية.</td></tr>
        </tbody>
      </table>
    </div>
    <div v-if="data && data.total > data.size" class="ws-actions">
      <button class="btn btn-sm" :disabled="f.page <= 1" @click="f.page--">السابق</button>
      <span class="muted">صفحة {{ f.page }} من {{ Math.ceil(data.total / data.size) }}</span>
      <button class="btn btn-sm" :disabled="f.page >= Math.ceil(data.total / data.size)" @click="f.page++">التالي</button>
    </div>
  </div>
</template>
