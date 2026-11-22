<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, STATUS_COLOR, fmtDate, hijri, num, type EmpRow } from '../lib';
import '../../../shared/module.css';
import '../hr.css';

interface Req { id: string; employeeId: string; employeeName: string; employeeNo: number | null; leaveType: string; leaveTypeName: string; startDate: string; endDate: string; days: number; note: string | null; status: string; statusLabel: string; decisionNote: string | null; decidedByName: string | null; createdByName: string }
interface Bal { code: string; name: string; available: number | null; entitlement: number | null; taken: number; pending: number; eligible: boolean; accrual: string; note: string | null }
const session = useSession();
const toast = useToast();
const route = useRoute();
const status = ref('pending');
const data = ref<{ types: { code: string; name: string; gender: string | null }[]; requests: Req[] }>({ types: [], requests: [] });
const employees = ref<EmpRow[]>([]);
const error = ref('');
async function load() {
  try {
    data.value = await api(`/hr/leaves?status=${status.value}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await load();
  employees.value = await api<EmpRow[]>('/hr/employees').catch(() => []);
});
watch(status, load);
const form = reactive({ show: route.query.new === '1', employeeId: '', leaveType: 'annual', startDate: '', endDate: '', note: '' });
const balances = ref<Bal[]>([]);
watch(() => form.employeeId, async (id) => {
  balances.value = id ? await api<Bal[]>(`/hr/employees/${id}/balances`).catch(() => []) : [];
  if (!balances.value.some((b) => b.code === form.leaveType)) form.leaveType = 'annual';
});
const bal = computed(() => balances.value.find((b) => b.code === form.leaveType));
const days = computed(() => (form.startDate && form.endDate && form.endDate >= form.startDate ? Math.round((Date.parse(form.endDate) - Date.parse(form.startDate)) / 86400000) + 1 : 0));
async function submit() {
  try {
    await api('/hr/leaves', { method: 'POST', json: { employeeId: form.employeeId, leaveType: form.leaveType, startDate: form.startDate, endDate: form.endDate, note: form.note || null } });
    toast.success('أُرسل طلب الإجازة للاعتماد');
    Object.assign(form, { show: false, employeeId: '', startDate: '', endDate: '', note: '' });
    status.value = 'pending';
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function decide(r: Req, decision: 'approve' | 'reject') {
  const note = decision === 'reject' ? prompt('سبب الرفض') : null;
  if (decision === 'reject' && !note) return;
  try {
    await api(`/hr/leaves/${r.id}/decision`, { method: 'POST', json: { decision, note } });
    toast.success(decision === 'approve' ? 'اعتُمدت الإجازة' : 'رُفضت الإجازة');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function cancel(r: Req) {
  if (!confirm('إلغاء طلب الإجازة؟')) return;
  try {
    await api(`/hr/leaves/${r.id}/cancel`, { method: 'POST' });
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <section class="pm-hero hr-hero">
      <div><p class="pm-kicker">شؤون الموظفين</p><h1>الإجازات</h1><p class="pm-sub">أنواع الإجازات وأرصدتها تأتي من لائحة الموارد البشرية، والنظام يمنع الطلب الذي يتجاوز الرصيد أو يتداخل مع إجازة أخرى.</p></div>
      <div class="pm-actions"><button v-if="session.can(P.leaves)" class="btn hr-glow" @click="form.show = true">طلب إجازة</button></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <section class="card pm-panel">
      <div class="hr-tabs">
        <button v-for="t in [{ v: 'pending', l: 'بانتظار الاعتماد' }, { v: 'approved', l: 'معتمدة' }, { v: 'rejected', l: 'مرفوضة' }, { v: 'all', l: 'الكل' }]" :key="t.v" :class="['hr-tab', { on: status === t.v }]" @click="status = t.v">{{ t.l }}</button>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الموظف</th><th>النوع</th><th>الفترة</th><th>الأيام</th><th>الحالة</th><th></th></tr></thead>
          <tbody>
            <tr v-for="r in data.requests" :key="r.id">
              <td><RouterLink :to="`/hr/employees/${r.employeeId}`" class="pm-link">{{ r.employeeName }}</RouterLink><span class="pm-muted">سجّلها {{ r.createdByName }}</span></td>
              <td>{{ r.leaveTypeName }}<span v-if="r.note" class="pm-muted">{{ r.note }}</span></td>
              <td>{{ fmtDate(r.startDate) }} ← {{ fmtDate(r.endDate) }}<span class="pm-muted">{{ hijri(r.startDate) }}</span></td>
              <td class="hr-num">{{ r.days }}</td>
              <td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[r.status] }">{{ r.statusLabel }}</span><span v-if="r.decisionNote" class="pm-muted">{{ r.decisionNote }}</span></td>
              <td style="white-space: nowrap">
                <template v-if="r.status === 'pending' && session.can(P.approveLeaves)">
                  <button class="btn btn-sm btn-primary" @click="decide(r, 'approve')">اعتماد</button>
                  <button class="btn btn-sm" @click="decide(r, 'reject')">رفض</button>
                </template>
                <button v-if="r.status === 'pending' || (r.status === 'approved' && session.can(P.approveLeaves))" class="btn btn-sm" @click="cancel(r)">إلغاء</button>
              </td>
            </tr>
            <tr v-if="!data.requests.length"><td colspan="6" class="pm-empty">لا توجد طلبات</td></tr>
          </tbody>
        </table>
      </div>
    </section>
    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" @submit.prevent="submit">
        <h2>طلب إجازة</h2>
        <label class="field"><span>الموظف</span>
          <select v-model="form.employeeId" class="input" required><option value="" disabled>اختر الموظف</option><option v-for="e in employees" :key="e.id" :value="e.id">{{ e.fullName }}</option></select>
        </label>
        <label class="field"><span>نوع الإجازة</span>
          <select v-model="form.leaveType" class="input"><option v-for="b in (balances.length ? balances : data.types)" :key="b.code" :value="b.code">{{ b.name }}</option></select>
        </label>
        <div v-if="bal" class="pm-muted" style="margin-bottom: 10px">
          <template v-if="bal.accrual === 'per_request'">{{ bal.entitlement ? `حتى ${bal.entitlement} أيام في المرة` : 'حسب المدة المثبتة' }}</template>
          <template v-else>الرصيد المتاح: <b>{{ num(bal.available) }}</b> يوم (المأخوذ {{ bal.taken }}، بانتظار الاعتماد {{ bal.pending }})</template>
          <span v-if="!bal.eligible" style="color: var(--danger)"> · لا يستحقها بعد</span>
          <div v-if="bal.note">{{ bal.note }}</div>
        </div>
        <div class="pm-grid2">
          <label class="field"><span>من</span><input v-model="form.startDate" type="date" class="input" required /></label>
          <label class="field"><span>إلى</span><input v-model="form.endDate" type="date" class="input" required /></label>
        </div>
        <p v-if="days" class="pm-muted">المدة {{ days }} يوم</p>
        <label class="field"><span>ملاحظة</span><textarea v-model="form.note" class="input" rows="2" /></label>
        <div class="modal-actions"><button class="btn btn-primary">إرسال</button><button type="button" class="btn" @click="form.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
