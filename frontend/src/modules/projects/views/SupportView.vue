<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { METHODS, color, fmtDate, label, links, sar } from '../labels';
import type { Allocation, Batch, ProjectRow, QueueItem } from '../types';
import '../projects.css';

interface Options {
  request: { id: string; requestNo: number; estimatedCost: number | null; supportPercent: number | null; need: number | null; covered: number; outstanding: number | null };
  beneficiary: { id: string; fullName: string; nationality: string | null; residency: string | null };
  project: { id: string; name: string; zakatEligible: boolean };
  batches: Batch[];
}

const route = useRoute();
const router = useRouter();
const toast = useToast();
const projects = ref<ProjectRow[]>([]);
const queue = ref<QueueItem[]>([]);
const allocations = ref<Allocation[]>([]);
const projectId = ref((route.query.project as string) || '');
const tab = ref<'queue' | 'allocations' | 'general'>('queue');
const error = ref('');
const busy = ref(false);

const approved = computed(() => projects.value.filter((p) => p.approvalStatus === 'approved'));
const current = computed(() => projects.value.find((p) => p.id === projectId.value));
const shownQueue = computed(() => queue.value.filter((q) => (!projectId.value || q.projectId === projectId.value) && (q.outstanding === null || q.outstanding > 0)));
const shownAlloc = computed(() => allocations.value.filter((a) => !projectId.value || a.activityId === projectId.value));

async function load() {
  error.value = '';
  try {
    [projects.value, queue.value, allocations.value] = await Promise.all([
      api<ProjectRow[]>('/projects/list'),
      api<QueueItem[]>('/projects-ops/support/queue'),
      api<Allocation[]>('/projects-ops/support/allocations'),
    ]);
    if (current.value?.spendingMode === 'general' && tab.value === 'queue') tab.value = 'general';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(projectId, (id) => {
  router.replace({ query: id ? { project: id } : {} });
  if (current.value?.spendingMode === 'general') tab.value = 'general';
  generalBatches.value = [];
  if (tab.value === 'general' && id) loadGeneral();
});

// ---- تحميل طلب على دفعة ----
const opts = ref<Options | null>(null);
const pick = ref<{ batchId: string; amount: number | null; notes: string }>({ batchId: '', amount: null, notes: '' });
async function openAllocate(q: QueueItem) {
  try {
    opts.value = await api<Options>(`/projects-ops/support/requests/${q.id}/options`);
    const firstOk = opts.value.batches.find((b) => !b.violations?.length);
    pick.value = { batchId: firstOk?.id ?? '', amount: q.outstanding ?? null, notes: '' };
    if (firstOk && pick.value.amount) pick.value.amount = Math.min(pick.value.amount, firstOk.net);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const pickedBatch = computed(() => opts.value?.batches.find((b) => b.id === pick.value.batchId));
async function recheck() {
  if (!opts.value || !pick.value.amount) return;
  try {
    const fresh = await api<Options>(`/projects-ops/support/requests/${opts.value.request.id}/options?amount=${pick.value.amount}`);
    opts.value.batches = fresh.batches;
  } catch { /* تجاهل */ }
}
async function allocate() {
  if (!opts.value) return;
  busy.value = true;
  try {
    await api('/projects-ops/support/allocate', { method: 'POST', json: { requestId: opts.value.request.id, batchId: pick.value.batchId, amount: Number(pick.value.amount), notes: pick.value.notes || null } });
    toast.success('حُمّل الطلب على الدفعة وأصبح المبلغ محجوزًا');
    opts.value = null;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}

// ---- الصرف العام ----
const generalBatches = ref<Batch[]>([]);
async function loadGeneral() {
  if (!projectId.value) return;
  try {
    generalBatches.value = await api<Batch[]>(`/projects-ops/support/projects/${projectId.value}/batches`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
watch(tab, (t) => { if (t === 'general') loadGeneral(); });
async function reserveAll(b: Batch) {
  if (!confirm(`سيُحجز صافي رصيد الدفعة رقم ${b.batchNo} بالكامل (${sar(b.net)}) لهذا المشروع. هل تريد المتابعة؟`)) return;
  try {
    await api('/projects-ops/support/general', { method: 'POST', json: { activityId: projectId.value, batchId: b.id } });
    toast.success('أصبح رصيد الدفعة محجوزًا للصرف العام، ويمكنك الآن إصدار طلبات الصرف');
    await Promise.all([load(), loadGeneral()]);
  } catch (e) {
    toast.error((e as Error).message);
  }
}

// ---- طلب صرف للمالية ----
const payFor = ref<Allocation | null>(null);
const pay = ref({ amount: 0, method: 'voucher' as 'voucher' | 'invoice', payeeKind: 'beneficiary', payeeName: '', description: '' });
function openPay(a: Allocation) {
  payFor.value = a;
  pay.value = { amount: Math.max(0, a.remaining - a.pendingPayments), method: a.kind === 'request' ? 'voucher' : 'invoice', payeeKind: a.kind === 'request' ? 'beneficiary' : 'provider', payeeName: a.beneficiaryName ?? '', description: '' };
}
async function requestPay() {
  if (!payFor.value) return;
  busy.value = true;
  try {
    await api('/projects-ops/payments', { method: 'POST', json: { allocationId: payFor.value.id, ...pay.value, amount: Number(pay.value.amount), payeeName: pay.value.payeeName || null, description: pay.value.description || null } });
    toast.success('أُرسل طلب الصرف إلى المالية');
    payFor.value = null;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}

// ---- إلغاء الحجز ----
async function release(a: Allocation) {
  const reason = prompt('سبب إلغاء الحجز (يعود المبلغ غير المصروف إلى رصيد الدفعة):');
  if (!reason) return;
  try {
    await api(`/projects-ops/support/allocations/${a.id}/release`, { method: 'POST', json: { reason } });
    toast.success('أُلغي الحجز وعاد المبلغ إلى رصيد الدفعة');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}

const totals = computed(() => shownAlloc.value.reduce((t, a) => ({ reserved: t.reserved + (a.status === 'released' ? 0 : a.remaining), spent: t.spent + a.spentAmount, pending: t.pending + a.pendingPayments }), { reserved: 0, spent: 0, pending: 0 }));
</script>

<template>
  <div>
    <section class="pm-hero">
      <div>
        <p class="pm-kicker">إدارة الدعم</p>
        <h1>تحميل الطلبات على دفعات الداعمين</h1>
        <p class="pm-sub">يُحمّل طلب المستفيد على دفعة داعم مطابقة لاشتراطاته فيصبح المبلغ محجوزًا، ثم يتحول إلى مخصوم بعد أن تصرفه المالية بسند صرف أو فاتورة.</p>
      </div>
      <select v-model="projectId" class="input" style="max-width: 300px">
        <option value="">كل المشاريع المعتمدة</option>
        <option v-for="p in approved" :key="p.id" :value="p.id">{{ p.code }} · {{ p.name }}</option>
      </select>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #6366f1; --i: 0"><span>طلبات تنتظر الدعم</span><strong>{{ shownQueue.length }}</strong></div>
      <div class="pm-kpi" style="--a: #f59e0b; --i: 1"><span>محجوز</span><strong>{{ sar(totals.reserved) }}</strong></div>
      <div class="pm-kpi" style="--a: #0ea5e9; --i: 2"><span>طلبات صرف لدى المالية</span><strong>{{ sar(totals.pending) }}</strong></div>
      <div class="pm-kpi" style="--a: #10b981; --i: 3"><span>مخصوم</span><strong>{{ sar(totals.spent) }}</strong></div>
      <div v-if="current" class="pm-kpi" style="--a: #0d9488; --i: 4"><span>المتاح للمشروع</span><strong>{{ sar(current.available) }}</strong><small>{{ label('mode', current.spendingMode) }}</small></div>
    </div>

    <div class="pm-tabs">
      <button class="pm-tab" :class="{ on: tab === 'queue' }" @click="tab = 'queue'">طلبات المستفيدين <b>{{ shownQueue.length }}</b></button>
      <button class="pm-tab" :class="{ on: tab === 'allocations' }" @click="tab = 'allocations'">المبالغ المحجوزة <b>{{ shownAlloc.length }}</b></button>
      <button class="pm-tab" :class="{ on: tab === 'general' }" @click="tab = 'general'">الصرف العام</button>
    </div>

    <div v-if="tab === 'queue'" class="card table-wrap">
      <table class="table">
        <thead><tr><th>الطلب</th><th>المستفيد</th><th>المشروع</th><th>التكلفة التقديرية</th><th>احتياج الدعم</th><th>المغطى</th><th>المتبقي</th><th></th></tr></thead>
        <tbody>
          <tr v-for="q in shownQueue" :key="q.id">
            <td><RouterLink :to="links.request(q.id)" class="pm-link">#{{ q.requestNo }}</RouterLink><span class="pm-muted">اعتمد {{ fmtDate(q.approvedAt) }}</span></td>
            <td><RouterLink :to="links.beneficiary(q.beneficiaryId)" class="pm-link">{{ q.beneficiaryName }}</RouterLink><span class="pm-muted">ملف {{ q.fileNo }}<template v-if="q.nationality"> · {{ q.nationality }}</template><template v-if="q.residency"> · {{ label('residency', q.residency) }}</template></span></td>
            <td><RouterLink :to="links.project(q.projectId)" class="pm-link">{{ q.projectName }}</RouterLink></td>
            <td class="pm-money">{{ q.estimatedCost === null ? '—' : sar(q.estimatedCost) }}</td>
            <td class="pm-money">{{ q.need === null ? 'غير محدد' : sar(q.need) }}<span v-if="q.supportPercent !== null" class="pm-muted">{{ q.supportPercent }}% دعم الجمعية</span></td>
            <td class="pm-money">{{ sar(q.covered) }}</td>
            <td class="pm-money" style="color: var(--primary)">{{ q.outstanding === null ? '—' : sar(q.outstanding) }}</td>
            <td><button class="btn btn-primary btn-sm" @click="openAllocate(q)">تحميل على دفعة</button></td>
          </tr>
          <tr v-if="!shownQueue.length"><td colspan="8" class="pm-empty">لا توجد طلبات معتمدة تنتظر الدعم</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="tab === 'allocations'" class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>المشروع</th><th>المستفيد / النوع</th><th>الدفعة والداعم</th><th>المبلغ</th><th>المصروف</th><th>المتبقي</th><th>الحالة</th><th></th></tr></thead>
        <tbody>
          <tr v-for="a in shownAlloc" :key="a.id">
            <td>#{{ a.allocationNo }}<span class="pm-muted">{{ fmtDate(a.createdAt) }}</span></td>
            <td><RouterLink :to="links.project(a.activityId)" class="pm-link">{{ a.projectName }}</RouterLink></td>
            <td>
              <template v-if="a.kind === 'request'"><RouterLink v-if="a.beneficiaryId" :to="links.beneficiary(a.beneficiaryId)" class="pm-link">{{ a.beneficiaryName }}</RouterLink><RouterLink v-if="a.requestId" :to="links.request(a.requestId)" class="pm-muted">طلب #{{ a.requestNo }}</RouterLink></template>
              <span v-else class="pm-tag">صرف عام</span>
            </td>
            <td><RouterLink :to="links.batch(a.batchId)" class="pm-link">دفعة {{ a.batchNo }}</RouterLink><RouterLink v-if="a.donorId" :to="links.donor(a.donorId)" class="pm-muted">{{ a.donorName }}</RouterLink></td>
            <td class="pm-money">{{ sar(a.amount) }}</td>
            <td class="pm-money">{{ sar(a.spentAmount) }}</td>
            <td class="pm-money">{{ sar(a.remaining) }}<span v-if="a.pendingPayments" class="pm-muted">{{ sar(a.pendingPayments) }} لدى المالية</span></td>
            <td><span class="pm-pill" :style="{ '--c': color('alloc', a.status) }">{{ label('alloc', a.status) }}</span></td>
            <td style="white-space: nowrap">
              <template v-if="a.status === 'reserved' || a.status === 'partial'">
                <button class="btn btn-primary btn-sm" :disabled="a.remaining - a.pendingPayments <= 0" @click="openPay(a)">طلب صرف</button>
                <button class="btn btn-sm" @click="release(a)">إلغاء الحجز</button>
              </template>
            </td>
          </tr>
          <tr v-if="!shownAlloc.length"><td colspan="9" class="pm-empty">لا توجد مبالغ محجوزة</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="tab === 'general'" class="card pm-panel">
      <h2>الصرف العام للمشاريع غير المرتبطة بمستفيدين</h2>
      <p class="pm-muted" style="margin-top: -4px">عند الصرف العام يتحول صافي رصيد الدفعة بالكامل إلى رصيد محجوز للمشروع، ثم تُصدر عليه طلبات الصرف وتحمّل المالية المصروف بالسندات والفواتير.</p>
      <p v-if="!projectId" class="pm-empty">اختر مشروعًا من الأعلى لعرض دفعاته</p>
      <p v-else-if="current?.spendingMode !== 'general'" class="alert alert-error">هذا المشروع مخصص للصرف على طلبات المستفيدين. غيّر طريقة الصرف من بيانات المشروع لاستخدام الصرف العام.</p>
      <div v-else class="table-wrap">
        <table class="table">
          <thead><tr><th>الدفعة</th><th>الداعم</th><th>المستوى</th><th>المبلغ</th><th>صافي الرصيد</th><th>المطابقة</th><th></th></tr></thead>
          <tbody>
            <tr v-for="b in generalBatches" :key="b.id">
              <td><RouterLink :to="links.batch(b.id)" class="pm-link">دفعة {{ b.batchNo }}</RouterLink><span v-if="b.isZakat" class="pm-tag zakat">زكاة</span></td>
              <td><RouterLink :to="links.donor(b.donorId)" class="pm-link">{{ b.donorName }}</RouterLink></td>
              <td><span class="pm-tag">{{ b.activityId === projectId ? 'المشروع' : 'البرنامج' }}</span></td>
              <td class="pm-money">{{ sar(b.amount) }}</td>
              <td class="pm-money" style="color: var(--primary)">{{ sar(b.net) }}</td>
              <td><span v-if="!b.violations?.length" class="pm-ok">✓ مطابقة</span><ul v-else class="pm-viol"><li v-for="v in b.violations" :key="v">{{ v }}</li></ul></td>
              <td><button class="btn btn-primary btn-sm" :disabled="!!b.violations?.length || b.net <= 0" @click="reserveAll(b)">حجز كامل الرصيد</button></td>
            </tr>
            <tr v-if="!generalBatches.length"><td colspan="7" class="pm-empty">لا توجد دفعات على هذا المشروع أو برنامجه</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- نافذة التحميل على دفعة -->
    <div v-if="opts" class="modal-backdrop" @click.self="opts = null">
      <form class="card modal modal-wide" @submit.prevent="allocate">
        <h2>تحميل الطلب #{{ opts.request.requestNo }} على دفعة</h2>
        <p class="pm-muted" style="margin: 4px 0 12px">{{ opts.beneficiary.fullName }} · {{ opts.project.name }} · المتبقي من الاحتياج: <b>{{ opts.request.outstanding === null ? 'غير محدد' : sar(opts.request.outstanding) }}</b></p>
        <div class="batches">
          <label v-for="b in opts.batches" :key="b.id" class="batch" :class="{ off: b.violations?.length, on: pick.batchId === b.id }">
            <input v-model="pick.batchId" type="radio" :value="b.id" :disabled="!!b.violations?.length" />
            <div>
              <strong>دفعة {{ b.batchNo }} · {{ b.donorName }}</strong>
              <span class="pm-muted">صافي الرصيد {{ sar(b.net) }} · {{ b.activityId === opts.project.id ? 'على المشروع' : 'على البرنامج' }}<template v-if="b.isZakat"> · زكاة</template><template v-if="b.beneficiaryRequestId"> · مخصصة لهذه الحالة</template></span>
              <span v-if="!b.violations?.length" class="pm-ok">✓ مطابقة لاشتراطات الداعم</span>
              <ul v-else class="pm-viol"><li v-for="v in b.violations" :key="v">{{ v }}</li></ul>
            </div>
          </label>
          <p v-if="!opts.batches.length" class="pm-empty">لا توجد دفعات على هذا المشروع أو برنامجه</p>
        </div>
        <div class="pm-grid2" style="margin-top: 12px">
          <div class="field"><label>المبلغ المحجوز *</label><input v-model.number="pick.amount" class="input" type="number" min="0.01" step="0.01" required @change="recheck" /><small v-if="pickedBatch" class="pm-muted">الحد الأعلى: {{ sar(Math.min(pickedBatch.net, opts.request.outstanding ?? pickedBatch.net)) }}</small></div>
          <div class="field"><label>ملاحظات</label><input v-model="pick.notes" class="input" /></div>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy || !pick.batchId">حجز المبلغ</button><button type="button" class="btn" @click="opts = null">إلغاء</button></div>
      </form>
    </div>

    <!-- نافذة طلب الصرف -->
    <div v-if="payFor" class="modal-backdrop" @click.self="payFor = null">
      <form class="card modal" @submit.prevent="requestPay">
        <h2>طلب صرف إلى المالية</h2>
        <p class="pm-muted" style="margin: 4px 0 12px">{{ payFor.projectName }} · المتاح للطلب {{ sar(payFor.remaining - payFor.pendingPayments) }}</p>
        <div class="pm-grid2">
          <div class="field"><label>المبلغ *</label><input v-model.number="pay.amount" class="input" type="number" min="0.01" step="0.01" :max="payFor.remaining - payFor.pendingPayments" required /></div>
          <div class="field"><label>طريقة الصرف *</label><select v-model="pay.method" class="input"><option v-for="m in METHODS" :key="m.value" :value="m.value">{{ m.label }}</option></select></div>
          <div class="field"><label>المستفيد من الصرف</label><select v-model="pay.payeeKind" class="input"><option value="beneficiary">المستفيد</option><option value="provider">مزود خدمة</option><option value="other">أخرى</option></select></div>
          <div class="field"><label>اسم المستفيد من الصرف</label><input v-model="pay.payeeName" class="input" /></div>
        </div>
        <div class="field"><label>البيان</label><textarea v-model="pay.description" class="input" rows="2" /></div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">إرسال للمالية</button><button type="button" class="btn" @click="payFor = null">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.batches { display: grid; gap: 8px; max-height: 46vh; overflow-y: auto; }
.batch { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; cursor: pointer; transition: border-color .2s, box-shadow .2s; }
.batch div { display: flex; flex-direction: column; gap: 2px; }
.batch.on { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.batch.off { opacity: .75; cursor: not-allowed; background: var(--surface-2); }
.batch input { margin-top: 4px; }
</style>
