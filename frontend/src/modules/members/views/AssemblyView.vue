<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import StatusPill from '../components/StatusPill.vue';
import { exportCsv, fmtDate, hijri, todayStr } from '../lib';
import '../../../shared/module.css';
import '../members.css';

interface Row {
  id: string; memberNo: number; fullName: string; nationalId: string; mobile: string; typeName: string; joinedOn: string; endDate: string;
  status: string; statusLabel: string; eligible: boolean; reason: string | null;
}
interface Data { date: string; eligible: number; quorum: number; pending: Row[]; rows: Row[]; attendees: Row[] }
const date = ref(todayStr());
const data = ref<Data | null>(null);
const error = ref('');
const tab = ref<'eligible' | 'pending'>('eligible');

async function load() {
  try {
    data.value = await api<Data>(`/members/assembly?date=${date.value}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(date, load);
const print = () => window.print();
function exportRows() {
  if (!data.value) return;
  exportCsv(`كشف الجمعية العمومية ${data.value.date}`, ['م', 'رقم العضوية', 'الاسم', 'الهوية', 'الجوال', 'النوع', 'الانضمام', 'نهاية العضوية', 'التوقيع'],
    data.value.rows.map((r, i) => [i + 1, r.memberNo, r.fullName, r.nationalId, r.mobile, r.typeName, r.joinedOn, r.endDate, '']));
}
</script>

<template>
  <div>
    <section class="pm-hero mb-hero">
      <div><p class="pm-kicker">الجمعية العمومية</p><h1>كشف أصحاب حق التصويت</h1>
        <p class="pm-sub">الأعضاء الذين يحق لهم حضور اجتماع الجمعية العمومية والتصويت في تاريخ الاجتماع، والنصاب القانوني (النصف + 1). اطبع الكشف للتوقيع عند الحضور.</p></div>
      <div class="pm-actions">
        <label class="field" style="margin: 0"><span style="color: inherit">تاريخ الاجتماع</span><input v-model="date" type="date" class="input" /></label>
        <button class="btn mb-ghost" @click="exportRows">تصدير كشف الحضور</button>
        <button class="btn mb-ghost" @click="print">طباعة</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="data">
      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #1e3a8a; --i: 0"><span>أصحاب حق التصويت</span><strong>{{ data.eligible }}</strong><small>في {{ fmtDate(data.date) }} · {{ hijri(data.date) }}</small></div>
        <div class="pm-kpi" style="--a: #0f766e; --i: 1"><span>النصاب القانوني</span><strong>{{ data.quorum }}</strong><small>النصف + 1 من أصحاب الحق</small></div>
        <div class="pm-kpi" style="--a: #f59e0b; --i: 2"><span>لم يكتسبوا الحق بعد</span><strong>{{ data.pending.length }}</strong><small>من أنواع لها حق التصويت</small></div>
        <div class="pm-kpi" style="--a: #64748b; --i: 3"><span>الأعضاء الساريون</span><strong>{{ data.attendees.length }}</strong><small>يحق لهم الحضور</small></div>
      </div>
      <div class="mb-tabs">
        <button :class="['mb-tab', { on: tab === 'eligible' }]" @click="tab = 'eligible'">أصحاب حق التصويت ({{ data.rows.length }})</button>
        <button :class="['mb-tab', { on: tab === 'pending' }]" @click="tab = 'pending'">لم يكتسبوا الحق ({{ data.pending.length }})</button>
      </div>
      <section class="card pm-panel">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>م</th><th>رقم العضوية</th><th>الاسم</th><th>النوع</th><th>الانضمام</th><th>نهاية العضوية</th><th>{{ tab === 'eligible' ? 'التوقيع' : 'السبب' }}</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in tab === 'eligible' ? data.rows : data.pending" :key="r.id" class="mb-row" @click="$router.push(`/members/list/${r.id}`)">
                <td>{{ i + 1 }}</td><td class="mb-code">{{ r.memberNo }}</td><td><b>{{ r.fullName }}</b></td><td>{{ r.typeName }}</td>
                <td>{{ fmtDate(r.joinedOn) }}</td><td>{{ fmtDate(r.endDate) }}</td>
                <td v-if="tab === 'eligible'" style="min-width: 120px; border-bottom: 1px dotted var(--border)"></td>
                <td v-else><span class="pm-muted">{{ r.reason }}</span> <StatusPill :status="r.status" :label="r.statusLabel" /></td>
              </tr>
              <tr v-if="!(tab === 'eligible' ? data.rows : data.pending).length"><td colspan="7" class="pm-empty">لا يوجد أعضاء</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
