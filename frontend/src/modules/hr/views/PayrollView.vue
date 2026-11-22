<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import CountUp from '../../../shared/CountUp.vue';
import { P, STATUS_COLOR, fmtDate, sar, todayStr } from '../lib';
import '../../../shared/module.css';
import '../hr.css';

/** كشوف الرواتب الشهرية: إصدار كشف الشهر ومتابعة اعتماده وصرفه */
interface Run {
  id: string; month: string; monthLabel: string; kind: 'staff' | 'contractors'; kindLabel: string; status: string; statusLabel: string; stageName: string | null; employees: number; net: number; employerCost: number;
  vouchers: number; createdByName: string; approvedAt: string | null;
}
const session = useSession();
const toast = useToast();
const router = useRouter();
const runs = ref<Run[]>([]);
const loaded = ref(false);
const month = ref(todayStr().slice(0, 7));
const busy = ref(false);
const kind = ref<'staff' | 'contractors'>('staff');
const tab = ref<'all' | 'staff' | 'contractors'>('all');
const TABS = [['all', 'الكل'], ['staff', 'الموظفون'], ['contractors', 'المتعاونون']] as const;
const shown = computed(() => (tab.value === 'all' ? runs.value : runs.value.filter((r) => r.kind === tab.value)));
async function load() {
  try {
    runs.value = await api<Run[]>('/hr/payroll-runs');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loaded.value = true;
  }
}
onMounted(load);
async function create() {
  busy.value = true;
  try {
    const r = await api<{ id: string }>('/hr/payroll-runs', { method: 'POST', json: { month: month.value, kind: kind.value } });
    router.push(`/hr/payroll/${r.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const live = computed(() => runs.value.filter((r) => r.status !== 'cancelled'));
const year = computed(() => live.value.filter((r) => r.kind === 'staff' && r.status === 'approved' && r.month.startsWith(todayStr().slice(0, 4))));
const pending = computed(() => live.value.filter((r) => r.status === 'pending').length);
</script>

<template>
  <div>
    <section class="pm-hero hr-hero">
      <div>
        <p class="pm-kicker">شؤون الموظفين</p>
        <h1>مسير الرواتب</h1>
        <p class="pm-sub">يُصدر كشف كل شهر من بيانات الموظفين والإجازات والحضور، ثم يمر بمراحل الاعتماد. عند الاعتماد النهائي يصدر القيد في النظام المالي محمّلًا على الحساب التحليلي لكل وحدة، ثم تُنشأ سندات الصرف لكل بنك. وللمتعاونين كشف مستقل بلا تأمينات، بقيد مستقل وسند صرف لكل متعاون.</p>
      </div>
      <div v-if="session.can(P.payroll)" class="pm-actions">
        <select v-model="kind" class="input" style="width: auto"><option value="staff">كشف الموظفين</option><option value="contractors">كشف المتعاونين</option></select>
        <input v-model="month" type="month" class="input" style="width: auto" :max="todayStr().slice(0, 7)" />
        <button class="btn hr-glow" :disabled="busy" @click="create">{{ busy ? 'جارٍ الإعداد…' : kind === 'contractors' ? 'إصدار كشف المتعاونين' : 'إصدار كشف الشهر' }}</button>
      </div>
    </section>

    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #a78bfa; --i: 0"><span>كشوف معتمدة هذا العام</span><strong><CountUp :value="year.length" /></strong><small>{{ pending ? `${pending} قيد الاعتماد` : 'لا كشوف معلقة' }}</small></div>
      <div class="pm-kpi" style="--a: #10b981; --i: 1"><span>صافي الرواتب هذا العام</span><strong><CountUp :value="year.reduce((s, r) => s + r.net, 0)" :decimals="2" /></strong><small>ريال</small></div>
      <div class="pm-kpi" style="--a: #f472b6; --i: 2"><span>التكلفة الكاملة هذا العام</span><strong><CountUp :value="year.reduce((s, r) => s + r.employerCost, 0)" :decimals="2" /></strong><small>مع حصة الشركة في التأمينات</small></div>
    </div>

    <section class="card pm-panel">
      <div class="hr-tabs">
        <button v-for="t in TABS" :key="t[0]" :class="['hr-tab', { on: tab === t[0] }]" @click="tab = t[0]">{{ t[1] }}</button>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الشهر</th><th>النوع</th><th>الحالة</th><th>العدد</th><th>صافي الرواتب</th><th>التكلفة الكاملة</th><th>سندات الصرف</th><th>أعده</th><th></th></tr></thead>
          <tbody>
            <tr v-for="r in shown" :key="r.id" :style="{ opacity: r.status === 'cancelled' ? 0.5 : 1 }">
              <td><RouterLink :to="`/hr/payroll/${r.id}`" class="pm-link"><b>{{ r.monthLabel }}</b></RouterLink></td>
              <td><span class="pm-tag" :class="{ 'hr-tag-contractor': r.kind === 'contractors' }">{{ r.kind === 'contractors' ? 'متعاونون' : 'موظفون' }}</span></td>
              <td>
                <span class="pm-tag" :style="{ background: `${STATUS_COLOR[r.status]}22`, color: STATUS_COLOR[r.status] }">{{ r.statusLabel }}</span>
                <span v-if="r.stageName" class="hr-mini">لدى: {{ r.stageName }}</span>
                <span v-if="r.approvedAt" class="hr-mini">{{ fmtDate(r.approvedAt) }}</span>
              </td>
              <td class="hr-num">{{ r.employees }}</td>
              <td class="pm-money">{{ sar(r.net) }}</td>
              <td class="pm-money">{{ sar(r.employerCost) }}</td>
              <td class="hr-num">{{ r.vouchers || '—' }}</td>
              <td>{{ r.createdByName }}</td>
              <td><RouterLink :to="`/hr/payroll/${r.id}`" class="btn btn-sm">فتح</RouterLink></td>
            </tr>
            <tr v-if="loaded && !shown.length"><td colspan="9" class="pm-empty">لم يُصدر كشف رواتب بعد. اختر الشهر واضغط «إصدار كشف الشهر».</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
