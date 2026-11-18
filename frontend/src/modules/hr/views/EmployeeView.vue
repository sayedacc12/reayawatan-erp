<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import EmployeeForm from '../components/EmployeeForm.vue';
import { P, STATUS_COLOR, fmtDate, hijri, num, sar, todayStr } from '../lib';
import '../../projects/projects.css';
import '../hr.css';

const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const e = ref<any>(null);
const error = ref('');
const tab = ref<'info' | 'salary' | 'leaves' | 'eos'>('info');
const editing = ref(false);
async function load() {
  try {
    e.value = await api(`/hr/employees/${props.id}`);
  } catch (err) {
    error.value = (err as Error).message;
  }
}
onMounted(load);
const reasons = ref<{ value: string; label: string }[]>([]);
const router = useRouter();
const term = reactive({ show: false, terminationDate: todayStr(), reason: 'contract_end', note: '' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const settlement = ref<any>(null);
async function openTerminate() {
  reasons.value = await api('/hr/eos/reasons');
  term.show = true;
  await preview();
}
async function preview() {
  try {
    settlement.value = await api('/hr/eos/calculate', { method: 'POST', json: { employeeId: props.id, endDate: term.terminationDate, reason: term.reason } });
  } catch {
    // المعاينة لمن يملك الاطلاع على الرواتب فقط
    settlement.value = null;
  }
}
/** إنهاء الخدمة يمر بملف إخلاء الطرف: يُخلي كل مسؤول بنده، ثم يُعد بيان المستحقات ويُعتمد، وعندها تنتهي الخدمة */
async function terminate() {
  try {
    const s = await api<{ id: string }>('/hr/separations', { method: 'POST', json: { employeeId: props.id, lastWorkingDay: term.terminationDate, reason: term.reason, note: term.note || null } });
    toast.success('فُتح ملف إنهاء الخدمة وأُرسلت بنود إخلاء الطرف لمسؤوليها');
    term.show = false;
    router.push(`/hr/separations/${s.id}`);
  } catch (err) {
    toast.error((err as Error).message);
  }
}
const ACCRUAL: Record<string, string> = { monthly: 'تستحق شهريًا', yearly: 'رصيد سنوي', per_request: 'لكل مناسبة', once: 'مرة واحدة' };
const span = (s: { years: number; months: number; days: number }) => `${s.years} سنة و${s.months} شهر و${s.days} يوم`;
</script>

<template>
  <div v-if="e">
    <section class="pm-hero hr-hero">
      <div>
        <p class="pm-kicker">ملف الموظف رقم {{ e.employeeNo }} · {{ e.unitName }}</p>
        <h1>{{ e.fullName }}</h1>
        <p class="pm-sub">{{ e.jobTitle }}{{ e.gradeName ? ` · المرتبة ${e.gradeName} الدرجة ${e.step}` : '' }} · في الخدمة منذ {{ span(e.service) }}</p>
      </div>
      <div class="pm-actions">
        <span class="pm-pill" :style="{ '--c': STATUS_COLOR[e.status], background: 'rgba(255,255,255,.9)' }">{{ e.status === 'active' ? 'على رأس العمل' : `انتهت خدمته: ${e.terminationLabel}` }}</span>
        <button v-if="e.status === 'active' && session.can(P.employees)" class="btn hr-glow" @click="editing = true">تعديل البيانات</button>
        <button v-if="e.status === 'active' && session.can(P.separations)" class="btn hr-ghost" @click="openTerminate">إنهاء الخدمة وإخلاء الطرف</button>
      </div>
    </section>
    <div class="hr-tabs">
      <button :class="['hr-tab', { on: tab === 'info' }]" @click="tab = 'info'">البيانات والعقد</button>
      <button v-if="e.breakdown" :class="['hr-tab', { on: tab === 'salary' }]" @click="tab = 'salary'">تفصيل الراتب والتأمينات</button>
      <button :class="['hr-tab', { on: tab === 'leaves' }]" @click="tab = 'leaves'">أرصدة الإجازات</button>
      <button v-if="e.eos" :class="['hr-tab', { on: tab === 'eos' }]" @click="tab = 'eos'">نهاية الخدمة</button>
    </div>

    <Transition name="page" mode="out-in">
      <div v-if="tab === 'info'" key="i" class="hr-grid">
        <section class="card pm-panel">
          <h2>البيانات الشخصية</h2>
          <dl class="pm-dl">
            <div><dt>{{ e.isSaudi ? 'الهوية الوطنية' : 'الإقامة' }}</dt><dd class="hr-code">{{ e.nationalId }}</dd></div>
            <div><dt>الجنسية</dt><dd>{{ e.nationality }}</dd></div>
            <div><dt>الجنس</dt><dd>{{ e.gender === 'female' ? 'أنثى' : 'ذكر' }}</dd></div>
            <div><dt>تاريخ الميلاد</dt><dd>{{ fmtDate(e.birthDate) }}</dd></div>
            <div><dt>الجوال</dt><dd class="hr-code">{{ e.phone ?? '—' }}</dd></div>
            <div><dt>البريد</dt><dd>{{ e.email ?? '—' }}</dd></div>
            <div><dt>حساب الدخول</dt><dd>{{ e.userName ?? 'غير مربوط' }}</dd></div>
            <div><dt>المدير المباشر</dt><dd>{{ e.managerName ?? '—' }}</dd></div>
            <div><dt>رقم التأمينات</dt><dd class="hr-code">{{ e.gosiNumber ?? '—' }}</dd></div>
            <div><dt>رقم البصمة</dt><dd><span class="hr-code">{{ e.attendanceCode || e.employeeNo }}</span><span v-if="e.attendanceExempt" class="pm-tag">معفى من البصمة</span></dd></div>
            <div><dt>انتهاء {{ e.isSaudi ? 'الهوية' : 'الإقامة' }}</dt><dd>{{ fmtDate(e.idExpiry) }}<span class="hr-hijri">{{ hijri(e.idExpiry) }}</span></dd></div>
            <div v-if="!e.isSaudi"><dt>انتهاء الجواز</dt><dd>{{ fmtDate(e.passportExpiry) }}</dd></div>
          </dl>
        </section>
        <section class="card pm-panel">
          <h2>العقد</h2>
          <dl class="pm-dl">
            <div><dt>نوع العقد</dt><dd>{{ e.contractTypeLabel }}</dd></div>
            <div><dt>المباشرة</dt><dd>{{ fmtDate(e.hireDate) }}<span class="hr-hijri">{{ hijri(e.hireDate) }}</span></dd></div>
            <div><dt>بداية العقد</dt><dd>{{ fmtDate(e.contractStart) }}</dd></div>
            <div><dt>نهاية العقد</dt><dd>{{ fmtDate(e.contractEnd) }}<span class="hr-hijri">{{ hijri(e.contractEnd) }}</span></dd></div>
            <div><dt>نهاية التجربة</dt><dd>{{ fmtDate(e.probationEnd) }}</dd></div>
            <div><dt>قوى</dt><dd>{{ e.qiwaLabel }}</dd></div>
          </dl>
          <template v-if="e.status === 'terminated'">
            <h2 style="margin-top: 14px">انتهاء الخدمة</h2>
            <dl class="pm-dl">
              <div><dt>آخر يوم</dt><dd>{{ fmtDate(e.terminationDate) }}</dd></div>
              <div><dt>السبب</dt><dd>{{ e.terminationLabel }}</dd></div>
              <div v-if="e.eosAmount !== null"><dt>مكافأة نهاية الخدمة</dt><dd class="pm-money">{{ sar(e.eosAmount) }}</dd></div>
            </dl>
            <p v-if="e.terminationNote" class="pm-muted">{{ e.terminationNote }}</p>
          </template>
        </section>
      </div>

      <div v-else-if="tab === 'salary' && e.breakdown" key="s" class="hr-grid">
        <section class="card pm-panel">
          <h2>بنود الراتب الشهري</h2>
          <table class="table">
            <tbody>
              <tr v-for="it in e.breakdown.items" :key="it.code"><td>{{ it.name }}</td><td class="pm-money">{{ sar(it.amount) }}</td></tr>
              <tr><td><b>إجمالي الراتب</b></td><td class="pm-money">{{ sar(e.breakdown.gross) }}</td></tr>
              <tr><td>حصة الموظف في التأمينات (معاشات {{ e.breakdown.gosi.rates.pension }}% + ساند)</td><td class="pm-money" style="color: var(--danger)">- {{ sar(e.breakdown.gosi.employee.total) }}</td></tr>
              <tr><td><b>صافي الراتب</b></td><td class="pm-money" style="color: var(--success); font-size: 1.1rem">{{ sar(e.breakdown.net) }}</td></tr>
            </tbody>
          </table>
          <div v-if="e.salaryRange" style="margin-top: 14px">
            <span class="pm-muted">موقع الراتب الأساسي في المرتبة ({{ sar(e.salaryRange.min) }} - {{ sar(e.salaryRange.max) }})</span>
            <div class="hr-range"><i style="inset-inline: 0" /><b :style="{ insetInlineStart: Math.min(100, Math.max(0, ((e.basicSalary - e.salaryRange.min) / Math.max(1, e.salaryRange.max - e.salaryRange.min)) * 100)) + '%' }" /></div>
            <p v-if="e.salaryException" class="pm-muted">استثناء: {{ e.salaryException }}</p>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>التكلفة على الجمعية</h2>
          <dl class="pm-dl" style="grid-template-columns: 1fr">
            <div><dt>الأجر الخاضع للتأمينات</dt><dd>{{ sar(e.breakdown.gosi.base) }} <span class="pm-tag">{{ e.breakdown.gosi.rates.newLaw ? 'النظام الجديد' : e.isSaudi ? 'النظام السابق' : 'غير سعودي' }}</span></dd></div>
            <div><dt>معاشات على الجمعية</dt><dd>{{ sar(e.breakdown.gosi.employer.pension) }}</dd></div>
            <div><dt>ساند على الجمعية</dt><dd>{{ sar(e.breakdown.gosi.employer.saned) }}</dd></div>
            <div><dt>الأخطار المهنية</dt><dd>{{ sar(e.breakdown.gosi.employer.hazards) }}</dd></div>
            <div><dt>مخصص نهاية الخدمة الشهري</dt><dd>{{ sar(e.breakdown.eosProvision) }}</dd></div>
            <div><dt>التكلفة الشهرية الكاملة</dt><dd class="pm-money" style="font-size: 1.2rem">{{ sar(e.breakdown.employerCost) }}</dd></div>
            <div><dt>الأجر اليومي</dt><dd>{{ sar(e.breakdown.dailyWage) }}</dd></div>
            <div><dt>الآيبان</dt><dd class="hr-code">{{ e.iban ?? '—' }}</dd></div>
          </dl>
        </section>
      </div>

      <div v-else-if="tab === 'leaves'" key="l">
        <div class="hr-cards">
          <article v-for="(b, i) in e.balances" :key="b.code" class="card hr-card" :style="{ '--i': i, opacity: b.eligible ? 1 : 0.6 }">
            <h3>{{ b.name }} <span class="pm-tag">{{ ACCRUAL[b.accrual] }}</span></h3>
            <div v-if="b.accrual === 'per_request'" class="pm-muted">{{ b.entitlement ? `${b.entitlement} أيام في كل مرة` : 'حسب المدة المثبتة' }} · المأخوذ هذه السنة {{ b.taken }}</div>
            <template v-else>
              <strong style="font-size: 1.6rem">{{ num(b.available) }} <small class="pm-muted">يوم متاح</small></strong>
              <div class="pm-bar"><i :style="{ width: (b.entitlement ? Math.min(100, (b.taken / b.entitlement) * 100) : 0) + '%', background: '#a78bfa' }" /><i :style="{ width: (b.entitlement ? Math.min(100, (b.pending / b.entitlement) * 100) : 0) + '%', background: '#f59e0b' }" /></div>
              <span class="pm-muted">المستحق {{ num(b.entitlement) }} · المأخوذ {{ b.taken }} · بانتظار الاعتماد {{ b.pending }}</span>
            </template>
            <span v-if="!b.eligible" class="pm-muted" style="color: var(--danger)">لم يستوفِ شرط مدة الخدمة بعد</span>
            <small v-if="b.note" class="pm-muted">{{ b.note }}</small>
          </article>
        </div>
        <section class="card pm-panel" style="margin-top: 16px">
          <h2>سجل الإجازات</h2>
          <table class="table">
            <thead><tr><th>النوع</th><th>من</th><th>إلى</th><th>الأيام</th><th>الحالة</th></tr></thead>
            <tbody>
              <tr v-for="l in e.leaves" :key="l.id"><td>{{ l.leaveTypeName }}</td><td>{{ fmtDate(l.startDate) }}</td><td>{{ fmtDate(l.endDate) }}</td><td>{{ l.days }}</td>
                <td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[l.status] }">{{ l.statusLabel }}</span></td></tr>
              <tr v-if="!e.leaves.length"><td colspan="5" class="pm-empty">لا توجد إجازات</td></tr>
            </tbody>
          </table>
        </section>
      </div>

      <div v-else-if="tab === 'eos' && e.eos" key="e" class="hr-grid">
        <section class="card pm-panel">
          <h2>مكافأة نهاية الخدمة حتى اليوم</h2>
          <p class="pm-muted">الأجر المعتمد في الحساب {{ sar(e.eos.wage) }} · مدة الخدمة {{ span(e.eos.contractEnd.service) }}</p>
          <dl class="pm-dl">
            <div><dt>عند انتهاء العقد أو الإنهاء من الجمعية</dt><dd class="pm-money" style="font-size: 1.2rem">{{ sar(e.eos.contractEnd.amount) }}</dd></div>
            <div><dt>عند الاستقالة</dt><dd class="pm-money" style="font-size: 1.2rem">{{ sar(e.eos.resignation.amount) }}</dd><small class="pm-muted">{{ e.eos.resignation.explanation }}</small></div>
            <div><dt>الشريحة الأولى</dt><dd>{{ sar(e.eos.contractEnd.firstPart) }}</dd></div>
            <div><dt>ما بعد الشريحة الأولى</dt><dd>{{ sar(e.eos.contractEnd.secondPart) }}</dd></div>
          </dl>
        </section>
        <section class="card pm-panel">
          <h2>كيف تُحسب؟</h2>
          <ul class="hr-list pm-muted">
            <li>نصف أجر شهر عن كل سنة من السنوات الخمس الأولى.</li>
            <li>أجر شهر كامل عن كل سنة بعدها، وأجزاء السنة تُحسب بنسبتها.</li>
            <li>عند الاستقالة: لا مكافأة قبل سنتين، والثلث حتى 5 سنوات، والثلثان حتى 10 سنوات، وكاملة بعدها.</li>
            <li>النسب كلها من لائحة الموارد البشرية ويمكن تعديلها.</li>
          </ul>
          <RouterLink to="/hr/eos" class="btn btn-sm" style="margin-top: 10px">حاسبة نهاية الخدمة</RouterLink>
        </section>
      </div>
    </Transition>

    <EmployeeForm v-if="editing" :employee="e" @close="editing = false" @saved="editing = false; load()" />
    <div v-if="term.show" class="modal-backdrop" @click.self="term.show = false">
      <form class="card modal" @submit.prevent="terminate">
        <h2>إنهاء خدمة {{ e.fullName }}</h2>
        <p class="pm-muted" style="margin-top: 0">يُفتح ملف إخلاء الطرف ويصل كل بند لمسؤوله. تنتهي الخدمة عند الاعتماد النهائي لبيان المستحقات، ثم يُنشأ سند صرفها.</p>
        <label class="field"><span>آخر يوم عمل</span><input v-model="term.terminationDate" type="date" class="input" required @change="preview" /></label>
        <label class="field"><span>سبب انتهاء الخدمة</span><select v-model="term.reason" class="input" @change="preview"><option v-for="r in reasons" :key="r.value" :value="r.value">{{ r.label }}</option></select></label>
        <label class="field"><span>ملاحظة</span><textarea v-model="term.note" class="input" rows="2" /></label>
        <div v-if="settlement" class="card" style="padding: 12px; background: var(--surface-2)">
          <b>المخالصة النهائية التقديرية</b>
          <dl class="pm-dl" style="margin-top: 8px">
            <div><dt>مكافأة نهاية الخدمة</dt><dd>{{ sar(settlement.eos.amount) }}</dd><small class="pm-muted">{{ settlement.eos.explanation }}</small></div>
            <div><dt>تعويض رصيد الإجازة ({{ num(settlement.leaveDays) }} يوم)</dt><dd>{{ sar(settlement.leaveEncashment) }}</dd></div>
            <div><dt>الإجمالي</dt><dd class="pm-money" style="font-size: 1.15rem">{{ sar(settlement.total) }}</dd></div>
          </dl>
          <small class="pm-muted">لا يشمل راتب الشهر الأخير ولا الاستقطاعات، وتُصرف من النظام المالي.</small>
        </div>
        <div class="modal-actions"><button class="btn btn-danger">فتح ملف إخلاء الطرف</button><button type="button" class="btn" @click="term.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
</template>
