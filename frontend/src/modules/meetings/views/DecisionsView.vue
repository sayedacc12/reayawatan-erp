<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import { KINDS, fmtDate, kindOf, type DecisionRow } from '../lib';
import '../../../shared/module.css';
import '../../comms/comms.css';
import '../meetings.css';

/** سجل القرارات والتوصيات عبر كل الجهات، مع حالة تنفيذ المهمة المرتبطة بكل منها */
const route = useRoute();
const rows = ref<DecisionRow[] | null>(null);
const error = ref('');
const f = reactive({ kind: String(route.query.kind ?? ''), status: '', q: '' });
async function load() {
  try {
    const qs = new URLSearchParams();
    for (const k of ['kind', 'status', 'q'] as const) if (f[k]) qs.set(k, f[k]);
    rows.value = await api<DecisionRow[]>(`/meetings/decisions?${qs}`);
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(() => [f.kind, f.status], load);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(() => f.q, () => { clearTimeout(timer); timer = setTimeout(load, 350); });
const TASK_AR: Record<string, string> = { open: 'لم تبدأ', in_progress: 'قيد التنفيذ', done: 'منجزة', cancelled: 'ملغاة' };
const TASK_C: Record<string, string> = { open: '#94a3b8', in_progress: '#0ea5e9', done: '#10b981', cancelled: '#64748b' };
</script>

<template>
  <div>
    <section class="pm-hero mt-hero">
      <p class="pm-kicker">الاجتماعات واللجان</p>
      <h1>سجل القرارات والتوصيات</h1>
      <p class="pm-sub">كل قرار أو توصية في محضر معتمد وله مسؤول يصبح مهمة بموعد إغلاق، وتتابع هنا نسبة تنفيذه حتى ينجز.</p>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="cm-toolbar">
      <input v-model="f.q" class="input grow" placeholder="ابحث في نص القرار أو التوصية" />
      <select v-model="f.kind" class="input"><option value="">كل الجهات</option><option v-for="k in KINDS" :key="k.value" :value="k.value">{{ k.label }}</option></select>
      <select v-model="f.status" class="input">
        <option value="">كل الحالات</option><option value="open">قيد التنفيذ</option><option value="overdue">متأخرة</option><option value="done">منجزة</option>
      </select>
    </div>
    <div v-if="rows" class="card" style="overflow-x: auto">
      <table class="table">
        <thead><tr><th>الرقم</th><th>القرار أو التوصية</th><th>الاجتماع</th><th>المسؤول</th><th>الموعد</th><th>التنفيذ</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td style="white-space: nowrap"><span class="cm-role" :style="{ '--c': r.kind === 'decision' ? '#b45309' : '#6366f1' }">{{ r.kind === 'decision' ? 'قرار' : 'توصية' }}</span><br /><small class="pm-muted">{{ r.item.split('.')[0] }}.{{ r.seq }}</small></td>
            <td style="min-width: 260px">{{ r.text }}<br /><small class="pm-muted">البند {{ r.item }}</small></td>
            <td><RouterLink :to="`/meetings/m/${r.meetingId}`">{{ r.meetingTitle }}</RouterLink><br /><small class="pm-muted" :style="{ color: kindOf(KINDS.find((k) => k.label === r.kindLabel)?.value ?? 'team').color }">{{ r.bodyName }} · {{ fmtDate(r.date) }}</small></td>
            <td>{{ r.ownerName ?? '—' }}</td>
            <td style="white-space: nowrap" :class="['cm-due', { late: r.overdue }]">{{ fmtDate(r.dueDate) }}</td>
            <td style="min-width: 140px">
              <RouterLink v-if="r.taskId" :to="`/comms/tasks/${r.taskId}`" style="display: grid; gap: 4px">
                <span class="pm-pill" :style="{ '--c': r.overdue ? '#e11d48' : TASK_C[r.taskStatus ?? 'open'] }">{{ r.overdue ? 'متأخرة' : TASK_AR[r.taskStatus ?? 'open'] }} · {{ r.taskRef }}</span>
                <div class="cm-track" :class="{ warn: r.overdue, ok: r.taskStatus === 'done' }"><i :style="{ width: `${r.progress ?? 0}%` }" /></div>
              </RouterLink>
              <small v-else class="pm-muted">بلا مسؤول</small>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!rows.length" class="pm-empty">لا توجد قرارات أو توصيات بهذا الفلتر.</p>
    </div>
  </div>
</template>
