<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../../api';
import { useSession } from '../../../../stores/session';
import { useToast } from '../../../../stores/toast';
import MaintenanceForm from '../../components/MaintenanceForm.vue';
import { AF, useLookups, type MaintRecord } from '../../assets';
import { P, sar } from '../../lib';
import '../../../../shared/module.css';
import '../../acc.css';
import './assets.css';

interface Due { assetId: string; code: string; name: string; groupName: string; nextDate: string; intervalMonths: number; location: string | null; custodianName: string | null; overdue: boolean }
interface Failure {
  assetId: string; code: string; name: string; groupName: string; cost: number; nbv: number; repairs: number; preventive: number; maintenanceCost: number; repairCost: number;
  downtimeDays: number; lastRepair: string | null; ratio: number; frequent: boolean; advice: string | null;
}
const session = useSession();
const toast = useToast();
const router = useRouter();
const { lookups, load: loadLookups } = useLookups();
const tab = ref<'log' | 'due' | 'failures'>('log');
const log = ref<MaintRecord[]>([]);
const due = ref<Due[]>([]);
const fails = ref<{ from: string; to: string; threshold: { repairs: number; ratio: number }; rows: Failure[] } | null>(null);
const lf = reactive({ kind: '', from: '', to: '' });
const ff = reactive({ from: '', to: '', groupId: '' });
const error = ref('');
const recording = ref<{ assetId: string | null; label?: string; kind?: 'preventive' | 'repair' } | null>(null);

const qs = (o: Record<string, string>) => {
  const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString();
  return s ? `?${s}` : '';
};
async function loadLog() {
  try {
    log.value = await api<MaintRecord[]>(`${AF}/maintenance${qs(lf)}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function loadDue() { due.value = await api<Due[]>(`${AF}/maintenance/due`).catch(() => []); }
async function loadFails() { fails.value = await api<typeof fails.value>(`${AF}/maintenance/failures${qs(ff)}`).catch(() => null); }
onMounted(() => { loadLog(); loadDue(); loadFails(); loadLookups().catch(() => {}); });
watch(lf, loadLog);
watch(ff, loadFails);

const totals = computed(() => ({
  cost: log.value.reduce((s, m) => s + m.cost, 0),
  repairs: log.value.filter((m) => m.kind === 'repair').length,
  preventive: log.value.filter((m) => m.kind === 'preventive').length,
  downtime: log.value.reduce((s, m) => s + m.downtimeDays, 0),
}));
const overdue = computed(() => due.value.filter((d) => d.overdue).length);
const frequent = computed(() => fails.value?.rows.filter((r) => r.frequent).length ?? 0);

async function saved() {
  recording.value = null;
  await Promise.all([loadLog(), loadDue(), loadFails()]);
}
async function remove(m: MaintRecord) {
  if (!confirm(`حذف سجل الصيانة رقم ${m.recordNo}؟`)) return;
  try {
    await api(`${AF}/maintenance/${m.id}`, { method: 'DELETE' });
    await loadLog();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <section class="pm-hero ac-hero fa-hero">
      <div>
        <p class="pm-kicker">الأصول الثابتة</p>
        <h1>الصيانة</h1>
        <p class="pm-sub">سجل الصيانة الوقائية وإصلاح الأعطال لكل أصل بتكلفتها وأيام توقفه، ومواعيد الصيانة الدورية القادمة، وتحليل الأصول كثيرة الأعطال لاتخاذ قرار الإصلاح أو الاستبدال.</p>
      </div>
      <div class="pm-actions">
        <button v-if="session.can(P.assetsMaintain)" class="btn ac-glow" @click="recording = { assetId: null }">تسجيل صيانة</button>
        <RouterLink v-if="session.can(P.reports)" :to="{ path: '/accounting/reports', query: { r: 'accounting.assets.maintenance' } }" class="btn ac-ghost">تقرير الصيانة</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #0ea5e9; --i: 0"><span>تكلفة الصيانة (حسب التصفية)</span><strong>{{ sar(totals.cost) }}</strong><small>{{ log.length }} عملية</small></div>
      <div class="pm-kpi" style="--a: #dc2626; --i: 1"><span>إصلاح أعطال</span><strong>{{ totals.repairs }}</strong><small>وقائية {{ totals.preventive }} · توقف {{ totals.downtime }} يوم</small></div>
      <div class="pm-kpi" style="--a: #f59e0b; --i: 2"><span>صيانة دورية مستحقة</span><strong>{{ due.length }}</strong><small>{{ overdue ? `منها ${overdue} متأخرة` : 'لا متأخرات' }}</small></div>
      <div class="pm-kpi" style="--a: #8b5cf6; --i: 3"><span>أصول كثيرة الأعطال</span><strong>{{ frequent }}</strong><small>خلال آخر 12 شهرًا</small></div>
    </div>

    <div class="pm-tabs">
      <button :class="['pm-tab', { on: tab === 'log' }]" @click="tab = 'log'">سجل الصيانة <b>{{ log.length }}</b></button>
      <button :class="['pm-tab', { on: tab === 'due' }]" @click="tab = 'due'">المواعيد القادمة <b>{{ due.length }}</b></button>
      <button :class="['pm-tab', { on: tab === 'failures' }]" @click="tab = 'failures'">الأصول كثيرة الأعطال <b>{{ frequent }}</b></button>
    </div>

    <section v-if="tab === 'log'" class="card pm-panel">
      <div class="ac-toolbar">
        <select v-model="lf.kind" class="input"><option value="">كل الأنواع</option><option value="preventive">وقائية</option><option value="repair">إصلاح عطل</option></select>
        <label class="fa-row">من <input v-model="lf.from" type="date" class="input" /></label>
        <label class="fa-row">إلى <input v-model="lf.to" type="date" class="input" /></label>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>رقم</th><th>التاريخ</th><th>الأصل</th><th>النوع</th><th>الوصف</th><th>الجهة المنفذة</th><th>التكلفة</th><th>التوقف</th><th>السند</th><th></th></tr></thead>
          <tbody>
            <tr v-for="m in log" :key="m.id">
              <td class="ac-code">{{ m.recordNo }}</td><td>{{ m.date }}</td>
              <td><RouterLink v-if="m.asset" :to="`/accounting/assets/${m.asset.id}`" class="pm-link"><b>{{ m.asset.name }}</b></RouterLink><span class="pm-muted ac-code">{{ m.asset?.code }}</span></td>
              <td><span class="pm-pill" :style="{ '--c': m.kind === 'repair' ? '#dc2626' : '#0ea5e9' }">{{ m.kindLabel }}</span></td>
              <td>{{ m.description }}<span v-if="m.notes" class="pm-muted">{{ m.notes }}</span><span class="pm-muted">{{ m.createdByName }}</span></td>
              <td>{{ m.vendor ?? '—' }}</td><td class="ac-num">{{ sar(m.cost) }}</td><td>{{ m.downtimeDays ? `${m.downtimeDays} يوم` : '' }}</td>
              <td><RouterLink v-if="m.voucher" :to="`/accounting/vouchers/${m.voucher.id}`" class="pm-link">سند صرف {{ m.voucher.serial }}</RouterLink></td>
              <td><button v-if="session.can(P.assetsMaintain) && (!m.voucher || ['cancelled', 'rejected'].includes(m.voucher.status))" class="btn btn-sm" @click="remove(m)">حذف</button></td>
            </tr>
            <tr v-if="!log.length"><td colspan="10" class="pm-empty">لا توجد سجلات صيانة مطابقة</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="tab === 'due'" class="card pm-panel">
      <p class="fa-sub">الأصول التي لها خطة صيانة دورية وموعدها القادم خلال مدة التنبيه في الإعدادات، أو فات موعدها.</p>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الأصل</th><th>المجموعة</th><th>العهدة والموقع</th><th>كل</th><th>الموعد</th><th></th></tr></thead>
          <tbody>
            <tr v-for="d in due" :key="d.assetId">
              <td><RouterLink :to="`/accounting/assets/${d.assetId}`" class="pm-link"><b>{{ d.name }}</b></RouterLink><span class="pm-muted ac-code">{{ d.code }}</span></td>
              <td>{{ d.groupName }}</td><td>{{ d.custodianName ?? '—' }}<span class="pm-muted">{{ d.location }}</span></td><td>{{ d.intervalMonths }} شهر</td>
              <td><b :class="d.overdue ? 'late' : ''">{{ d.nextDate }}</b><span v-if="d.overdue" class="pm-muted late">متأخرة</span></td>
              <td><button v-if="session.can(P.assetsMaintain)" class="btn btn-sm btn-primary" @click="recording = { assetId: d.assetId, label: `${d.code} ${d.name}`, kind: 'preventive' }">تسجيل الصيانة</button></td>
            </tr>
            <tr v-if="!due.length"><td colspan="6" class="pm-empty">لا توجد صيانة دورية مستحقة قريبًا</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="tab === 'failures' && fails" class="card pm-panel">
      <p class="fa-sub">يُعد الأصل كثير الأعطال إذا تكرر إصلاحه {{ fails.threshold.repairs }} مرات فأكثر، أو بلغت تكلفة صيانته {{ fails.threshold.ratio }}% من تكلفته، خلال الفترة من {{ fails.from }} إلى {{ fails.to }}.</p>
      <div class="ac-toolbar">
        <label class="fa-row">من <input v-model="ff.from" type="date" class="input" /></label>
        <label class="fa-row">إلى <input v-model="ff.to" type="date" class="input" /></label>
        <select v-model="ff.groupId" class="input"><option value="">كل المجموعات</option><option v-for="g in lookups?.groups ?? []" :key="g.id" :value="g.id">{{ g.name }}</option></select>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الأصل</th><th>الإصلاحات</th><th>الوقائية</th><th>تكلفة الصيانة</th><th>نسبتها من التكلفة</th><th>التوقف</th><th>آخر عطل</th><th>التوصية</th></tr></thead>
          <tbody>
            <tr v-for="r in fails.rows" :key="r.assetId" :class="{ hot: r.frequent }" class="ac-row-click" @click="router.push(`/accounting/assets/${r.assetId}`)">
              <td><b>{{ r.name }}</b><span class="pm-muted"><span class="ac-code">{{ r.code }}</span> · {{ r.groupName }}</span></td>
              <td><b>{{ r.repairs }}</b></td><td>{{ r.preventive }}</td><td class="ac-num">{{ sar(r.maintenanceCost) }}</td>
              <td><div class="bar"><i :style="{ width: Math.min(100, r.ratio) + '%' }" /></div><small>{{ r.ratio }}%</small></td>
              <td>{{ r.downtimeDays }} يوم</td><td>{{ r.lastRepair ?? '—' }}</td>
              <td><span v-if="r.advice" class="fa-flag">{{ r.advice }}</span></td>
            </tr>
            <tr v-if="!fails.rows.length"><td colspan="8" class="pm-empty">لا توجد صيانة مسجلة في الفترة</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <MaintenanceForm v-if="recording" :asset-id="recording.assetId" :asset-label="recording.label" :kind="recording.kind" @saved="saved" @close="recording = null" />
  </div>
</template>

<style scoped>
td .pm-muted { display: block; }
.late { color: #b91c1c; }
tr.hot td { background: #fef2f2; }
.bar { width: 90px; height: 6px; border-radius: 99px; background: #e2e8f0; overflow: hidden; }
.bar i { display: block; height: 100%; background: linear-gradient(90deg, #f59e0b, #dc2626); }
td .fa-flag { white-space: normal; display: inline-block; max-width: 240px; }
</style>
