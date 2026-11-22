<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import CountUp from '../../../shared/CountUp.vue';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, fmtDate, sar, todayStr, type EmpRow } from '../lib';
import { SEP_COLOR, type SepRow } from '../separation';
import '../../../shared/module.css';
import '../hr.css';

/** إخلاء الطرف ونهاية الخدمة: ملف لكل موظف تنتهي خدمته، يمر بإخلاء الطرف ثم بيان المستحقات واعتماده ثم الصرف */
const session = useSession();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const status = ref('');
const data = ref<{ counts: Record<string, number>; rows: SepRow[] } | null>(null);
const error = ref('');
const q = ref('');
async function load() {
  try {
    data.value = await api(`/hr/separations${status.value ? `?status=${status.value}` : ''}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(status, load);
const rows = computed(() => (data.value?.rows ?? []).filter((r) => !q.value || `${r.employeeName} ${r.separationNo}`.includes(q.value.trim())));

const form = reactive({ show: false, employeeId: '', reason: 'resignation', lastWorkingDay: todayStr(), noticeDate: todayStr(), note: '' });
const employees = ref<EmpRow[]>([]);
const reasons = ref<{ value: string; label: string }[]>([]);
async function openForm(employeeId = '') {
  [employees.value, reasons.value] = await Promise.all([api<EmpRow[]>('/hr/employees'), api<{ value: string; label: string }[]>('/hr/eos/reasons')]);
  form.employeeId = employeeId;
  form.show = true;
}
onMounted(() => {
  if (route.query.employee && session.can(P.separations)) openForm(String(route.query.employee));
});
async function create() {
  try {
    const s = await api<{ id: string }>('/hr/separations', {
      method: 'POST', json: { employeeId: form.employeeId, reason: form.reason, lastWorkingDay: form.lastWorkingDay, noticeDate: form.noticeDate || null, note: form.note || null },
    });
    toast.success('فُتح الملف وأُرسلت بنود إخلاء الطرف لمسؤوليها');
    router.push(`/hr/separations/${s.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const STATUSES = [
  { v: '', l: 'الكل' }, { v: 'clearance', l: 'إخلاء الطرف' }, { v: 'settlement', l: 'المستحقات قيد الاعتماد' }, { v: 'approved', l: 'بانتظار الصرف' }, { v: 'paid', l: 'صُرفت' }, { v: 'cancelled', l: 'ملغاة' },
];
</script>

<template>
  <div>
    <section class="pm-hero hr-hero">
      <div>
        <p class="pm-kicker">شؤون الموظفين</p>
        <h1>إخلاء الطرف ونهاية الخدمة</h1>
        <p class="pm-sub">ملف لكل موظف تنتهي خدمته: يُخلي كل مسؤول بنده (المدير المباشر، العهد، المالية، الأنظمة)، ثم يُعد بيان المستحقات ويمر بمراحل اعتماد لا يعتمد فيها معدّه، وعند الاعتماد النهائي تنتهي الخدمة ويُقيد المستحق ويُنشأ سند صرفه.</p>
      </div>
      <div class="pm-actions">
        <button v-if="session.can(P.separations)" class="btn hr-glow" @click="openForm()">+ فتح ملف إنهاء خدمة</button>
        <RouterLink v-if="session.can(P.settings)" to="/hr/settings?tab=separation" class="btn hr-ghost">بنود الإخلاء ومراحل الاعتماد</RouterLink>
      </div>
      <div v-if="data" class="pm-kpis">
        <div class="pm-kpi" style="--a: #f59e0b; --i: 0"><span>في إخلاء الطرف</span><strong><CountUp :value="data.counts.clearance" /></strong></div>
        <div class="pm-kpi" style="--a: #6366f1; --i: 1"><span>مستحقات قيد الاعتماد</span><strong><CountUp :value="data.counts.settlement" /></strong></div>
        <div class="pm-kpi" style="--a: #10b981; --i: 2"><span>معتمدة بانتظار الصرف</span><strong><CountUp :value="data.counts.approved" /></strong></div>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <section class="card pm-panel">
      <div class="hr-toolbar">
        <select v-model="status" class="input"><option v-for="s in STATUSES" :key="s.v" :value="s.v">{{ s.l }}</option></select>
        <span class="grow" />
        <input v-model="q" class="input" placeholder="بحث باسم الموظف أو رقم الملف" />
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الملف</th><th>الموظف</th><th>السبب</th><th>آخر يوم عمل</th><th>إخلاء الطرف</th><th>صافي المستحقات</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id" class="hr-row-click" @click="router.push(`/hr/separations/${r.id}`)">
              <td class="hr-num">{{ r.separationNo }}</td>
              <td>{{ r.employeeName }} <small v-if="r.fromRequest" class="pm-muted">· من طلب استقالة</small></td>
              <td>{{ r.reasonLabel }}</td>
              <td>{{ fmtDate(r.lastWorkingDay) }}</td>
              <td>
                <div class="sep-mini"><i :style="{ width: `${r.items ? (r.cleared / r.items) * 100 : 100}%` }" /></div>
                <small class="pm-muted">{{ r.cleared }} / {{ r.items }}<template v-if="r.blocked"> · <span style="color: #ef4444">{{ r.blocked }} متوقف</span></template></small>
              </td>
              <td class="hr-num">{{ r.net === null ? '—' : sar(r.net) }}</td>
              <td><span class="pm-tag" :style="{ background: `${SEP_COLOR[r.status]}22`, color: SEP_COLOR[r.status] }">{{ r.statusLabel }}</span></td>
            </tr>
          </tbody>
        </table>
        <p v-if="data && !rows.length" class="pm-empty">لا توجد ملفات</p>
      </div>
    </section>

    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" style="max-width: 560px" @submit.prevent="create">
        <h2>فتح ملف إنهاء خدمة</h2>
        <label class="field"><span>الموظف</span>
          <select v-model="form.employeeId" class="input" required>
            <option value="" disabled>اختر الموظف</option>
            <option v-for="e in employees.filter((x) => x.status === 'active')" :key="e.id" :value="e.id">{{ e.fullName }} · {{ e.jobTitle }}</option>
          </select>
        </label>
        <label class="field"><span>سبب انتهاء الخدمة</span><select v-model="form.reason" class="input"><option v-for="r in reasons" :key="r.value" :value="r.value">{{ r.label }}</option></select></label>
        <div class="hr-fields">
          <label class="field"><span>تاريخ الإشعار</span><input v-model="form.noticeDate" type="date" class="input" /></label>
          <label class="field"><span>آخر يوم عمل</span><input v-model="form.lastWorkingDay" type="date" class="input" required /></label>
        </div>
        <label class="field"><span>ملاحظة</span><textarea v-model="form.note" class="input" rows="2" /></label>
        <p class="pm-muted">تصل بنود إخلاء الطرف لمسؤوليها فورًا في جرس المهام، ولا تنتهي الخدمة إلا بالاعتماد النهائي لبيان المستحقات.</p>
        <div class="modal-actions"><button type="button" class="btn" @click="form.show = false">إلغاء</button><button class="btn btn-primary">فتح الملف</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.sep-mini { width: 110px; height: 7px; border-radius: 99px; background: var(--surface-2); overflow: hidden; }
.sep-mini i { display: block; height: 100%; background: linear-gradient(90deg, #10b981, #2dd4bf); border-radius: 99px; }
</style>
