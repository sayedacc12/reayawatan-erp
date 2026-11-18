<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import CountUp from '../../beneficiaries/components/CountUp.vue';
import { useSession } from '../../../stores/session';
import { P, fmtDate, sar } from '../lib';
import { KIND_ICON, REQ_COLOR, type ReqRow } from '../self/ess';
import '../../projects/projects.css';
import '../hr.css';

/** شؤون الموظفين: كل طلبات الخدمة الذاتية وسلف الموظفين */
interface Adv { id: string; employeeName: string; requestId: string; amount: number; installments: number; installmentAmount: number; startMonth: string; status: string; paid: number; remaining: number; paidInstallments: number }
const session = useSession();
const router = useRouter();
const tab = ref<'requests' | 'advances'>('requests');
const status = ref('pending');
const typeId = ref('');
const data = ref<{ counts: Record<string, number>; types: { id: string; name: string }[]; rows: ReqRow[] } | null>(null);
const advances = ref<Adv[]>([]);
const error = ref('');
const q = ref('');

async function load() {
  try {
    const qs = new URLSearchParams();
    if (status.value !== 'all') qs.set('status', status.value);
    if (typeId.value) qs.set('typeId', typeId.value);
    data.value = await api(`/hr/requests?${qs}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await load();
  advances.value = await api<Adv[]>('/hr/advances').catch(() => []);
});
watch([status, typeId], load);
const rows = () => (data.value?.rows ?? []).filter((r) => !q.value || `${r.employeeName} ${r.requestNo} ${r.summary}`.includes(q.value.trim()));
const STATUSES = [{ v: 'pending', l: 'قيد الاعتماد' }, { v: 'returned', l: 'معادة' }, { v: 'approved', l: 'معتمدة' }, { v: 'rejected', l: 'مرفوضة' }, { v: 'all', l: 'الكل' }];
</script>

<template>
  <div>
    <section class="pm-hero hr-hero">
      <div>
        <p class="pm-kicker">شؤون الموظفين</p>
        <h1>طلبات الموظفين</h1>
        <p class="pm-sub">كل ما يقدمه الموظفون من الخدمة الذاتية: الإجازات والاستئذان والخروج والعودة والخطابات والسلف والطلبات العامة، ومسار اعتماد كل طلب.</p>
      </div>
      <div class="pm-actions">
        <RouterLink v-if="session.can(P.settings)" to="/hr/settings?tab=services" class="btn hr-ghost">أنواع الطلبات ومساراتها</RouterLink>
      </div>
      <div v-if="data" class="pm-kpis">
        <div class="pm-kpi" style="--a: #f59e0b; --i: 0"><span>قيد الاعتماد</span><strong><CountUp :value="data.counts.pending" /></strong></div>
        <div class="pm-kpi" style="--a: #f97316; --i: 1"><span>معادة للتعديل</span><strong><CountUp :value="data.counts.returned" /></strong></div>
        <div class="pm-kpi" style="--a: #10b981; --i: 2"><span>معتمدة</span><strong><CountUp :value="data.counts.approved" /></strong></div>
        <div class="pm-kpi" style="--a: #a78bfa; --i: 3"><span>السلف القائمة</span><strong><CountUp :value="advances.filter((a) => a.remaining > 0).length" /></strong><small>{{ sar(advances.reduce((s, a) => s + a.remaining, 0)) }} متبقية</small></div>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <section class="card pm-panel">
      <div class="hr-tabs">
        <button :class="['hr-tab', { on: tab === 'requests' }]" @click="tab = 'requests'">الطلبات</button>
        <button :class="['hr-tab', { on: tab === 'advances' }]" @click="tab = 'advances'">سلف الموظفين</button>
      </div>
      <template v-if="tab === 'requests'">
        <div class="hr-toolbar">
          <select v-model="status" class="input"><option v-for="s in STATUSES" :key="s.v" :value="s.v">{{ s.l }}</option></select>
          <select v-model="typeId" class="input"><option value="">كل الأنواع</option><option v-for="t in data?.types ?? []" :key="t.id" :value="t.id">{{ t.name }}</option></select>
          <span class="grow" />
          <input v-model="q" class="input" placeholder="بحث بالموظف أو رقم الطلب" />
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>الرقم</th><th>الموظف</th><th>الطلب</th><th>التفاصيل</th><th>الحالة</th><th>عند</th><th>التاريخ</th></tr></thead>
            <tbody>
              <tr v-for="r in rows()" :key="r.id" class="hr-row-click" @click="router.push(`/me/requests/${r.id}`)">
                <td class="hr-num">{{ r.requestNo }}</td>
                <td>{{ r.employeeName }}</td>
                <td>{{ KIND_ICON[r.kind] }} {{ r.typeName }}</td>
                <td style="white-space: normal; max-width: 320px">{{ r.summary }}<span v-if="r.attachments" class="pm-muted"> · 📎 {{ r.attachments }}</span></td>
                <td><span class="pm-tag" :style="{ background: `${REQ_COLOR[r.status]}22`, color: REQ_COLOR[r.status] }">{{ r.statusLabel }}</span></td>
                <td>{{ r.status === 'pending' ? r.currentApprover ?? r.currentStep : '—' }}</td>
                <td>{{ fmtDate(r.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="data && !rows().length" class="pm-empty">لا توجد طلبات</p>
        </div>
      </template>
      <div v-else class="table-wrap">
        <p class="pm-muted">السلفة تُنشأ عند الاعتماد النهائي لطلبها، وتُخصم أقساطها تلقائيًا في كشف الرواتب الشهري بحد أقصى صافي الراتب، ويُسجل السداد عند اعتماد الكشف.</p>
        <table class="table">
          <thead><tr><th>الموظف</th><th>المبلغ</th><th>القسط</th><th>بداية الخصم</th><th>الأقساط المسددة</th><th>المسدد</th><th>المتبقي</th></tr></thead>
          <tbody>
            <tr v-for="a in advances" :key="a.id" class="hr-row-click" @click="router.push(`/me/requests/${a.requestId}`)">
              <td>{{ a.employeeName }}</td><td class="hr-num">{{ sar(a.amount) }}</td><td class="hr-num">{{ sar(a.installmentAmount) }}</td><td>{{ a.startMonth }}</td>
              <td>{{ a.paidInstallments }} / {{ a.installments }}</td><td class="hr-num">{{ sar(a.paid) }}</td><td class="hr-num"><b>{{ sar(a.remaining) }}</b></td>
            </tr>
          </tbody>
        </table>
        <p v-if="!advances.length" class="pm-empty">لا توجد سلف</p>
      </div>
    </section>
  </div>
</template>
