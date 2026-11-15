<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { METHODS, PAY_STATUS, color, fmtDate, label, links, sar, today } from '../labels';
import type { Allocation, Payment } from '../types';
import '../projects.css';

const session = useSession();
const toast = useToast();
const canPay = computed(() => session.can('projects.disbursement.execute'));
const payments = ref<Payment[]>([]);
const allocations = ref<Allocation[]>([]);
const status = ref<'pending' | 'paid' | 'rejected' | ''>('pending');
const q = ref('');
const error = ref('');
const busy = ref(false);

async function load() {
  error.value = '';
  try {
    [payments.value, allocations.value] = await Promise.all([
      api<Payment[]>('/projects-ops/payments'),
      api<Allocation[]>('/projects-ops/support/allocations'),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

const count = (s: string) => payments.value.filter((p) => p.status === s).length;
const sum = (s: string) => payments.value.filter((p) => p.status === s).reduce((t, p) => t + p.amount, 0);
const shown = computed(() => {
  const t = q.value.trim();
  return payments.value.filter((p) => (!status.value || p.status === status.value)
    && (!t || p.projectName.includes(t) || (p.payeeName ?? '').includes(t) || String(p.requestNo) === t || (p.referenceNo ?? '').includes(t)));
});

// ---- تنفيذ الصرف ----
const executing = ref<Payment | null>(null);
const exec = ref({ referenceNo: '', paidOn: today() });
function openExec(p: Payment) {
  executing.value = p;
  exec.value = { referenceNo: '', paidOn: today() };
}
async function execute() {
  if (!executing.value) return;
  busy.value = true;
  try {
    await api(`/projects-ops/payments/${executing.value.id}/execute`, { method: 'POST', json: exec.value });
    toast.success('تم الصرف: أصبح المبلغ مخصومًا وسُجّل القيد المحاسبي');
    executing.value = null;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function reject(p: Payment) {
  const reason = prompt('سبب رفض طلب الصرف:');
  if (!reason) return;
  try {
    await api(`/projects-ops/payments/${p.id}/reject`, { method: 'POST', json: { reason } });
    toast.success('رُفض طلب الصرف وعاد المبلغ محجوزًا للمشروع');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}

// ---- سند صرف مباشر على مبلغ محجوز ----
const open = computed(() => allocations.value.filter((a) => (a.status === 'reserved' || a.status === 'partial') && a.remaining - a.pendingPayments > 0));
const direct = ref<{ allocationId: string; amount: number; method: 'voucher' | 'invoice'; payeeKind: string; payeeName: string; description: string; referenceNo: string; paidOn: string } | null>(null);
const directAlloc = computed(() => open.value.find((a) => a.id === direct.value?.allocationId));
function openDirect() {
  direct.value = { allocationId: '', amount: 0, method: 'invoice', payeeKind: 'provider', payeeName: '', description: '', referenceNo: '', paidOn: today() };
}
function onAlloc() {
  const a = directAlloc.value;
  if (!a || !direct.value) return;
  direct.value.amount = a.remaining - a.pendingPayments;
  if (a.kind === 'request') Object.assign(direct.value, { method: 'voucher', payeeKind: 'beneficiary', payeeName: a.beneficiaryName ?? '' });
}
async function saveDirect() {
  if (!direct.value) return;
  busy.value = true;
  try {
    const d = direct.value;
    await api('/projects-ops/payments/direct', { method: 'POST', json: { ...d, amount: Number(d.amount), payeeName: d.payeeName || null, description: d.description || null } });
    toast.success('سُجّل سند الصرف وأصبح المبلغ مخصومًا');
    direct.value = null;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <section class="pm-hero">
      <div>
        <p class="pm-kicker">الصرف المالي</p>
        <h1>طلبات الصرف الواردة من إدارة المشاريع</h1>
        <p class="pm-sub">تتحقق المالية من الصرف برقم سند الصرف أو فاتورة مزود الخدمة، فيتحول المبلغ من محجوز إلى مخصوم ويُسجّل القيد المحاسبي تلقائيًا.</p>
      </div>
      <div class="pm-actions">
        <button v-if="canPay" class="btn btn-glow" @click="openDirect">+ سند صرف مباشر</button>
        <RouterLink :to="links.journal" class="btn btn-ghost">دفتر القيود</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #f59e0b; --i: 0"><span>بانتظار الصرف</span><strong>{{ sar(sum('pending')) }}</strong><small>{{ count('pending') }} طلب</small></div>
      <div class="pm-kpi" style="--a: #10b981; --i: 1"><span>مصروف</span><strong>{{ sar(sum('paid')) }}</strong><small>{{ count('paid') }} طلب</small></div>
      <div class="pm-kpi" style="--a: #ef4444; --i: 2"><span>مرفوض</span><strong>{{ count('rejected') }}</strong></div>
    </div>

    <div class="pm-filters">
      <div class="pm-tabs" style="margin: 0; border: 0">
        <button class="pm-tab" :class="{ on: status === '' }" @click="status = ''">الكل <b>{{ payments.length }}</b></button>
        <button v-for="s in PAY_STATUS" :key="s.value" class="pm-tab" :class="{ on: status === s.value }" @click="status = s.value as typeof status">{{ s.label }} <b>{{ count(s.value) }}</b></button>
      </div>
      <input v-model="q" class="input" placeholder="ابحث بالمشروع أو المستفيد أو رقم السند" />
    </div>

    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الطلب</th><th>المشروع</th><th>المستفيد من الصرف</th><th>الدفعة والداعم</th><th>الطريقة</th><th>المبلغ</th><th>الحالة</th><th></th></tr></thead>
        <tbody>
          <tr v-for="p in shown" :key="p.id">
            <td>#{{ p.requestNo }}<span class="pm-muted">{{ fmtDate(p.createdAt) }} · {{ p.requestedByName }}</span></td>
            <td><RouterLink :to="links.project(p.activityId)" class="pm-link">{{ p.projectName }}</RouterLink><RouterLink v-if="p.beneficiaryRequestId" :to="links.request(p.beneficiaryRequestId)" class="pm-muted">طلب مستفيد #{{ p.beneficiaryRequestNo }}</RouterLink></td>
            <td>
              <RouterLink v-if="p.beneficiaryId && p.payeeKind === 'beneficiary'" :to="links.beneficiary(p.beneficiaryId)" class="pm-link">{{ p.payeeName }}</RouterLink>
              <span v-else>{{ p.payeeName }}</span>
              <span v-if="p.description" class="pm-muted">{{ p.description }}</span>
            </td>
            <td><RouterLink :to="links.batch(p.batchId)" class="pm-link">دفعة {{ p.batchNo }}</RouterLink><span class="pm-muted">{{ p.donorName }}</span></td>
            <td><span class="pm-tag">{{ label('method', p.method) }}</span></td>
            <td class="pm-money">{{ sar(p.amount) }}</td>
            <td>
              <span class="pm-pill" :style="{ '--c': color('pay', p.status) }">{{ label('pay', p.status) }}</span>
              <span v-if="p.status === 'paid'" class="pm-muted">سند {{ p.referenceNo }} · {{ fmtDate(p.paidOn) }}<template v-if="p.journalEntryId"> · <RouterLink :to="links.journal">القيد</RouterLink></template></span>
              <span v-if="p.status === 'rejected'" class="pm-muted">{{ p.rejectReason }}</span>
            </td>
            <td style="white-space: nowrap">
              <template v-if="p.status === 'pending' && canPay">
                <button class="btn btn-primary btn-sm" @click="openExec(p)">تنفيذ الصرف</button>
                <button class="btn btn-sm btn-danger" @click="reject(p)">رفض</button>
              </template>
            </td>
          </tr>
          <tr v-if="!shown.length"><td colspan="8" class="pm-empty">لا توجد طلبات صرف</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="executing" class="modal-backdrop" @click.self="executing = null">
      <form class="card modal" @submit.prevent="execute">
        <h2>تنفيذ طلب الصرف #{{ executing.requestNo }}</h2>
        <p class="pm-muted" style="margin: 4px 0 12px">{{ executing.projectName }} · {{ executing.payeeName }} · <b>{{ sar(executing.amount) }}</b> · {{ label('method', executing.method) }}</p>
        <div class="pm-grid2">
          <div class="field"><label>{{ executing.method === 'invoice' ? 'رقم الفاتورة *' : 'رقم سند الصرف *' }}</label><input v-model="exec.referenceNo" class="input" required /></div>
          <div class="field"><label>تاريخ الصرف</label><input v-model="exec.paidOn" class="input" type="date" /></div>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">تأكيد الصرف</button><button type="button" class="btn" @click="executing = null">إلغاء</button></div>
      </form>
    </div>

    <div v-if="direct" class="modal-backdrop" @click.self="direct = null">
      <form class="card modal" @submit.prevent="saveDirect">
        <h2>سند صرف مباشر</h2>
        <p class="pm-muted" style="margin: 4px 0 12px">يُصرف على مبلغ محجوز سابقًا لمشروع، ويصبح مخصومًا فورًا.</p>
        <div class="field">
          <label>المبلغ المحجوز *</label>
          <select v-model="direct.allocationId" class="input" required @change="onAlloc">
            <option value="" disabled>اختر</option>
            <option v-for="a in open" :key="a.id" :value="a.id">#{{ a.allocationNo }} · {{ a.projectName }} · {{ a.kind === 'general' ? 'صرف عام' : a.beneficiaryName }} · متاح {{ sar(a.remaining - a.pendingPayments) }}</option>
          </select>
        </div>
        <div class="pm-grid2">
          <div class="field"><label>المبلغ *</label><input v-model.number="direct.amount" class="input" type="number" min="0.01" step="0.01" required /></div>
          <div class="field"><label>الطريقة *</label><select v-model="direct.method" class="input"><option v-for="m in METHODS" :key="m.value" :value="m.value">{{ m.label }}</option></select></div>
          <div class="field"><label>المستفيد من الصرف</label><select v-model="direct.payeeKind" class="input"><option value="beneficiary">المستفيد</option><option value="provider">مزود خدمة</option><option value="other">أخرى</option></select></div>
          <div class="field"><label>الاسم</label><input v-model="direct.payeeName" class="input" /></div>
          <div class="field"><label>{{ direct.method === 'invoice' ? 'رقم الفاتورة *' : 'رقم السند *' }}</label><input v-model="direct.referenceNo" class="input" required /></div>
          <div class="field"><label>تاريخ الصرف</label><input v-model="direct.paidOn" class="input" type="date" /></div>
        </div>
        <div class="field"><label>البيان</label><textarea v-model="direct.description" class="input" rows="2" /></div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ السند</button><button type="button" class="btn" @click="direct = null">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
