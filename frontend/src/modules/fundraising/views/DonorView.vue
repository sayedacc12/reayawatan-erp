<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import DonorForm from '../components/DonorForm.vue';
import { color, fmtDate, fmtNo, hijri, label, sar } from '../labels';
import type { Donor, DonorField, Settings } from '../types';
import '../fr.css';

interface DonorDetail extends Donor {
  levelName: string | null; levelColor: string | null; managerName: string | null; fields: DonorField[];
  opportunities: { id: string; opportunityNo: number; kind: string; status: string; date: string; totalAmount: number; collectedAmount: number; isZakat: boolean; receiptNo: number | null }[];
  batches: { id: string; batchNo: number; targetKind: string; targetName: string; status: string; amount: number; reserved: number; spent: number; transferred: number; opportunityNo: number }[];
  totals: { approved: number; pledgeOutstanding: number; pending: number };
  statement: { date: string; entryNo: number; description: string; debit: number; credit: number; balance: number; opportunityId: string | null }[];
  receivable: number;
}

const route = useRoute();
const router = useRouter();
const session = useSession();
const toast = useToast();
const d = ref<DonorDetail | null>(null);
const settings = ref<Settings | null>(null);
const error = ref('');
const editing = ref(false);
const tab = ref<'opps' | 'batches' | 'account'>('opps');

async function load() {
  try {
    d.value = await api<DonorDetail>(`/fundraising/donors/${route.params.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await load();
  settings.value = await api<Settings>('/fundraising/settings').catch(() => null);
});
const customRows = computed(() => (d.value?.fields ?? []).filter((f) => d.value!.customData[f.key] !== undefined).map((f) => {
  const v = d.value!.customData[f.key];
  const shown = f.type === 'checkbox' ? (v ? 'نعم' : 'لا') : f.type === 'percent' ? `${v}%` : f.type === 'date' ? fmtDate(String(v)) : String(v);
  return { label: f.label + (f.isActive ? '' : ' (حقل موقوف)'), value: shown };
}));
const batchTotals = computed(() => {
  const b = d.value?.batches ?? [];
  const sum = (k: 'amount' | 'reserved' | 'spent' | 'transferred') => b.reduce((s, x) => s + x[k], 0);
  const amount = sum('amount');
  return { amount, reserved: sum('reserved'), spent: sum('spent'), transferred: sum('transferred'), net: amount - sum('reserved') - sum('spent') - sum('transferred') };
});
function saved() {
  editing.value = false;
  load();
}
async function remove() {
  if (!d.value || !confirm('هل تريد حذف الداعم نهائيًا؟')) return;
  try {
    await api(`/fundraising/donors/${d.value.id}`, { method: 'DELETE' });
    toast.success('تم حذف الداعم');
    router.push('/fundraising/donors');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const pct = (x: number) => (batchTotals.value.amount ? (x / batchTotals.value.amount) * 100 : 0);
</script>

<template>
  <div v-if="d">
    <section class="fr-hero">
      <div>
        <p class="kicker">داعم رقم {{ d.donorNo }} · {{ d.type === 'entity' ? 'جهة' : 'فرد' }}</p>
        <h1>{{ d.name }} <span v-if="d.levelName" class="fr-badge lvl" :style="{ '--c': d.levelColor ?? '#e8b04b' }">{{ d.levelName }}</span></h1>
        <p class="sub">{{ d.managerName ? `مدير الدعم: ${d.managerName}` : 'لم يُحدد مدير دعم' }}{{ d.isActive ? '' : ' · موقوف' }}</p>
      </div>
      <div class="fr-hero-actions">
        <RouterLink v-if="session.can('fundraising.opportunities.create') && d.isActive" :to="{ path: '/fundraising/opportunities/new', query: { donor: d.id } }" class="btn btn-gold">+ فرصة تبرع لهذا الداعم</RouterLink>
        <button v-if="session.can('fundraising.donors.manage') && settings" class="btn btn-ghost-light" @click="editing = true">تعديل البيانات</button>
        <button v-if="session.can('fundraising.donors.manage') && !d.opportunities.length" class="btn btn-ghost-light" @click="remove">حذف</button>
      </div>
    </section>

    <div class="fr-kpis">
      <div class="fr-kpi" style="--a: #10b981; --i: 0"><span class="k-label">إجمالي التبرعات المعتمدة</span><strong>{{ sar(d.totals.approved) }}</strong><span class="k-foot">{{ d.opportunities.filter((o) => o.status === 'approved').length }} فرصة</span></div>
      <div class="fr-kpi fr-row-link" style="--a: #8b5cf6; --i: 1" @click="tab = 'account'"><span class="k-label">حساب الداعم المدين</span><strong>{{ sar(d.receivable) }}</strong><span class="k-foot">مستحقات وعود بالدفع لم تُسدَّد</span></div>
      <div class="fr-kpi" style="--a: #0ea5e9; --i: 2"><span class="k-label">صافي الدفعات المتاح</span><strong>{{ sar(batchTotals.net) }}</strong><span class="k-foot">بعد الحجز والصرف والمناقلات</span></div>
      <div class="fr-kpi" style="--a: #f59e0b; --i: 3"><span class="k-label">فرص قيد الاعتماد</span><strong>{{ d.totals.pending.toLocaleString('ar-SA') }}</strong><span class="k-foot">بانتظار القرار أو التعديل</span></div>
    </div>

    <section class="fr-panel info">
      <dl class="fr-kv">
        <div v-if="d.type === 'entity'"><dt>السجل التجاري أو الرقم الموحد</dt><dd dir="ltr">{{ d.identifier ?? '—' }}</dd></div>
        <div><dt>مدير الدعم</dt><dd>{{ d.managerName ?? '—' }}</dd></div>
        <div><dt>الجوال</dt><dd dir="ltr">{{ d.phone ?? '—' }}</dd></div>
        <div><dt>البريد الإلكتروني</dt><dd dir="ltr">{{ d.email ?? '—' }}</dd></div>
        <div><dt>المدينة</dt><dd>{{ d.city ?? '—' }}</dd></div>
        <div v-for="r in customRows" :key="r.label"><dt>{{ r.label }}</dt><dd>{{ r.value }}</dd></div>
        <div><dt>تاريخ التسجيل</dt><dd>{{ fmtDate(d.createdAt) }}</dd></div>
      </dl>
      <p v-if="d.notes" class="notes">{{ d.notes }}</p>
    </section>

    <nav class="fr-tabs">
      <button :class="['fr-tab', { on: tab === 'opps' }]" @click="tab = 'opps'">فرص التبرع ({{ d.opportunities.length }})</button>
      <button :class="['fr-tab', { on: tab === 'batches' }]" @click="tab = 'batches'">الدفعات وأرصدتها ({{ d.batches.length }})</button>
      <button :class="['fr-tab', { on: tab === 'account' }]" @click="tab = 'account'">كشف حساب الداعم ({{ d.statement.length }})</button>
    </nav>

    <div v-if="tab === 'account'" class="card table-wrap">
      <p class="muted acc-hint">مستحقات الوعود بالدفع على الداعم وسدادها، من قيود اليومية. الرصيد المدين هو ما بقي على الداعم.</p>
      <table class="table">
        <thead><tr><th>التاريخ</th><th>رقم القيد</th><th>البيان</th><th>مدين (مستحق)</th><th>دائن (سداد)</th><th>الرصيد</th></tr></thead>
        <tbody>
          <tr v-for="(r, i) in d.statement" :key="i" :class="{ 'fr-row-link': !!r.opportunityId }" @click="r.opportunityId && router.push(`/fundraising/opportunities/${r.opportunityId}`)">
            <td>{{ fmtDate(r.date) }}</td><td><span class="fr-no">{{ r.entryNo }}</span></td><td class="wrap">{{ r.description }}</td>
            <td class="fr-amount">{{ r.debit ? sar(r.debit) : '—' }}</td><td class="fr-amount">{{ r.credit ? sar(r.credit) : '—' }}</td><td><b>{{ sar(r.balance) }}</b></td>
          </tr>
        </tbody>
        <tfoot v-if="d.statement.length"><tr><td colspan="5"><b>الرصيد المستحق على الداعم</b></td><td><b>{{ sar(d.receivable) }}</b></td></tr></tfoot>
      </table>
      <p v-if="!d.statement.length" class="fr-empty">لا توجد مستحقات على هذا الداعم</p>
    </div>

    <div v-else-if="tab === 'opps'" class="card table-wrap">
      <table class="table">
        <thead><tr><th>رقم الفرصة</th><th>النوع</th><th>التاريخ</th><th>المبلغ</th><th>الحالة</th><th>سند القبض</th></tr></thead>
        <tbody>
          <tr v-for="o in d.opportunities" :key="o.id" class="fr-row-link" @click="router.push(`/fundraising/opportunities/${o.id}`)">
            <td><span class="fr-no">{{ fmtNo('FR', o.opportunityNo) }}</span> <span v-if="o.isZakat" class="fr-zakat">زكاة</span></td>
            <td>{{ label('kind', o.kind) }}</td>
            <td>{{ fmtDate(o.date) }}<span class="fr-hijri">{{ hijri(o.date) }}</span></td>
            <td class="fr-amount">{{ sar(o.totalAmount) }}<small v-if="o.kind === 'pledge'" class="muted"> · سُدد {{ sar(o.collectedAmount) }}</small></td>
            <td><span class="fr-badge" :style="{ '--c': color('status', o.status) }">{{ label('status', o.status) }}</span></td>
            <td>{{ o.receiptNo ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!d.opportunities.length" class="fr-empty">لا توجد فرص تبرع لهذا الداعم بعد</p>
    </div>

    <div v-else class="card">
      <div v-if="d.batches.length" class="util">
        <div class="fr-progress big">
          <i :style="{ width: pct(batchTotals.spent) + '%', background: '#0f766e' }" title="مخصوم" />
          <i :style="{ width: pct(batchTotals.reserved) + '%', background: '#f59e0b' }" title="محجوز" />
          <i :style="{ width: pct(batchTotals.transferred) + '%', background: '#8b5cf6' }" title="مناقلات" />
        </div>
        <div class="legend"><span><i style="background:#0f766e" />مخصوم {{ sar(batchTotals.spent) }}</span><span><i style="background:#f59e0b" />محجوز {{ sar(batchTotals.reserved) }}</span>
          <span><i style="background:#8b5cf6" />مناقلات {{ sar(batchTotals.transferred) }}</span><span><i style="background:var(--surface-2); border:1px solid var(--border)" />صافي متاح {{ sar(batchTotals.net) }}</span></div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الدفعة</th><th>الفرصة</th><th>الجهة</th><th>المبلغ</th><th>محجوز</th><th>مخصوم</th><th>صافي</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="b in d.batches" :key="b.id" class="fr-row-link" @click="router.push(`/fundraising/batches/${b.id}`)">
              <td><span class="fr-no">{{ fmtNo('B', b.batchNo) }}</span></td><td>{{ fmtNo('FR', b.opportunityNo) }}</td>
              <td><span class="fr-badge" :style="{ '--c': color('target', b.targetKind) }">{{ label('target', b.targetKind) }}</span> {{ b.targetName }}</td>
              <td class="fr-amount">{{ sar(b.amount) }}</td><td>{{ sar(b.reserved) }}</td><td>{{ sar(b.spent) }}</td>
              <td><b>{{ sar(b.amount - b.reserved - b.spent - b.transferred) }}</b></td>
              <td><span class="fr-badge" :style="{ '--c': color('batch', b.status) }">{{ label('batch', b.status) }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!d.batches.length" class="fr-empty">لا توجد دفعات بعد</p>
    </div>

    <DonorForm v-if="editing && settings" :settings="settings" :donor="d" @close="editing = false" @saved="saved" />
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
  <div v-else class="fr-skeleton" />
</template>

<style scoped>
.lvl { font-size: .8rem; vertical-align: middle; margin-inline-start: 6px; background: rgba(255,255,255,.12); color: #fde68a; }
.info { margin-bottom: 18px; }
.notes { margin: 14px 0 0; padding: 10px 14px; background: var(--surface-2); border-radius: 10px; white-space: pre-wrap; }
.util { padding: 16px 18px 4px; }
.big { height: 12px; }
.legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: .82rem; margin: 10px 0; color: var(--muted); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.acc-hint { margin: 0 0 10px; font-size: .86rem; }
.wrap { white-space: normal; min-width: 260px; }
</style>
