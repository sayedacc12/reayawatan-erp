<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import EmployeeForm from '../components/EmployeeForm.vue';
import { P, STATUS_COLOR, fmtDate, sar, type EmpRow } from '../lib';
import '../../../shared/module.css';
import '../hr.css';

const session = useSession();
const route = useRoute();
const router = useRouter();
const rows = ref<EmpRow[]>([]);
const status = ref('active');
const search = ref('');
const error = ref('');
const show = ref(route.query.new === '1');
async function load() {
  try {
    rows.value = await api<EmpRow[]>(`/hr/employees?status=${status.value}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(status, load);
const shown = computed(() => rows.value.filter((r) => !search.value || r.fullName.includes(search.value) || r.nationalId.includes(search.value) || r.jobTitle.includes(search.value) || String(r.employeeNo) === search.value));
const QIWA_C: Record<string, string> = { documented: '#10b981', pending: '#f59e0b', not_documented: '#ef4444' };
const QIWA_L: Record<string, string> = { documented: 'موثّق', pending: 'بانتظار الموافقة', not_documented: 'غير موثّق' };
const total = computed(() => shown.value.reduce((s, r) => s + (r.gross ?? 0), 0));
</script>

<template>
  <div>
    <section class="pm-hero hr-hero">
      <div><p class="pm-kicker">شؤون الموظفين</p><h1>الموظفون</h1><p class="pm-sub">ملف كل موظف وعقده وراتبه وأرصدة إجازاته ومكافأة نهاية خدمته.</p></div>
      <div class="pm-actions"><button v-if="session.can(P.employees)" class="btn hr-glow" @click="show = true">موظف جديد</button></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <section class="card pm-panel">
      <div class="hr-toolbar">
        <div class="hr-tabs" style="margin: 0">
          <button v-for="t in [{ v: 'active', l: 'على رأس العمل' }, { v: 'terminated', l: 'انتهت خدمتهم' }, { v: 'all', l: 'الكل' }]" :key="t.v" :class="['hr-tab', { on: status === t.v }]" @click="status = t.v">{{ t.l }}</button>
        </div>
        <span class="grow" />
        <input v-model="search" class="input" placeholder="ابحث بالاسم أو الهوية أو الوظيفة" />
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الرقم</th><th>الموظف</th><th>الوظيفة</th><th>المباشرة</th><th>العقد</th><th>قوى</th><th v-if="session.can(P.salaries)">إجمالي الراتب</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="r in shown" :key="r.id" class="hr-row-click" @click="router.push(`/hr/employees/${r.id}`)">
              <td class="hr-num">{{ r.employeeNo }}</td>
              <td><b>{{ r.fullName }}</b><span v-if="r.employmentKind === 'contractor'" class="pm-tag hr-tag-contractor">متعاون</span><span class="pm-muted">{{ r.isSaudi ? 'سعودي' : r.nationality }} · <span class="hr-code">{{ r.nationalId }}</span></span></td>
              <td>{{ r.jobTitle }}<span class="pm-muted">{{ r.unitName }}{{ r.gradeName ? ` · ${r.gradeName}` : '' }}</span></td>
              <td>{{ fmtDate(r.hireDate) }}</td>
              <td>{{ r.contractTypeLabel }}<span v-if="r.contractEnd" class="pm-muted">حتى {{ fmtDate(r.contractEnd) }}</span></td>
              <td><span class="pm-pill" :style="{ '--c': QIWA_C[r.qiwaStatus] }">{{ QIWA_L[r.qiwaStatus] }}</span></td>
              <td v-if="session.can(P.salaries)" class="pm-money">{{ r.gross === null ? '—' : sar(r.gross) }}</td>
              <td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[r.status] }">{{ r.status === 'active' ? 'على رأس العمل' : `انتهت ${fmtDate(r.terminationDate)}` }}</span></td>
            </tr>
            <tr v-if="!shown.length"><td colspan="8" class="pm-empty">لا يوجد موظفون</td></tr>
          </tbody>
          <tfoot v-if="session.can(P.salaries) && shown.length"><tr><td colspan="6"><b>الإجمالي ({{ shown.length }} موظف)</b></td><td class="pm-money">{{ sar(total) }}</td><td /></tr></tfoot>
        </table>
      </div>
    </section>
    <EmployeeForm v-if="show" @close="show = false" @saved="(id) => router.push(`/hr/employees/${id}`)" />
  </div>
</template>
