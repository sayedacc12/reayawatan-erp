<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import NationalitySelect from '../../../components/NationalitySelect.vue';
import { useToast } from '../../../stores/toast';
import { CONTRACT_TYPES, QIWA, sar, type AllowanceType, type EmpRow, type Grade, type JobRow, type Unit } from '../lib';

/** نموذج الموظف: البيانات الشخصية، الوظيفة والعقد، الراتب وبدلاته، التأمينات والمستندات */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const props = defineProps<{ employee?: any | null }>();
const emit = defineEmits<{ close: []; saved: [id: string] }>();
const toast = useToast();
const jobs = ref<JobRow[]>([]);
const units = ref<Unit[]>([]);
const grades = ref<Grade[]>([]);
const managers = ref<EmpRow[]>([]);
const types = ref<AllowanceType[]>([]);
const saving = ref(false);
const e = props.employee;
const form = reactive({
  fullName: e?.fullName ?? '', nationalId: e?.nationalId ?? '', nationality: e?.nationality ?? 'سعودي', isSaudi: e?.isSaudi ?? true, gender: e?.gender ?? 'male',
  birthDate: e?.birthDate ?? '', phone: e?.phone ?? '', email: e?.email ?? '', jobId: e?.jobId ?? '', unitId: e?.unitId ?? '', managerId: e?.managerId ?? '',
  step: e?.step ?? 1, hireDate: e?.hireDate ?? '', contractType: e?.contractType ?? 'fixed', contractStart: e?.contractStart ?? '', contractEnd: e?.contractEnd ?? '',
  probationEnd: e?.probationEnd ?? '', qiwaStatus: e?.qiwaStatus ?? 'pending', basicSalary: e?.basicSalary ?? 0,
  allowances: (e?.allowances ?? [{ code: 'housing', name: 'بدل السكن', amount: 0 }, { code: 'transport', name: 'بدل النقل', amount: 0 }]) as { code: string; name: string; amount: number }[],
  attendanceCode: e?.attendanceCode ?? '', attendanceExempt: e?.attendanceExempt ?? false,
  salaryException: e?.salaryException ?? '', iban: e?.iban ?? '', gosiNumber: e?.gosiNumber ?? '', gosiFirstRegistration: e?.gosiFirstRegistration ?? '',
  idExpiry: e?.idExpiry ?? '', passportExpiry: e?.passportExpiry ?? '', leaveOpeningAnnual: e?.leaveOpening?.annual ?? '', leaveOpeningDate: e?.leaveOpeningDate ?? '',
});
onMounted(async () => {
  try {
    const [j, s, g, m, t] = await Promise.all([
      api<JobRow[]>('/hr/jobs'), api<{ units: Unit[] }>('/hr/structure'), api<Grade[]>('/hr/grades'), api<EmpRow[]>('/hr/employees'), api<AllowanceType[]>('/hr/allowance-types'),
    ]);
    types.value = t.filter((x) => !x.isSystem);
    jobs.value = j.filter((x) => x.isActive || x.id === form.jobId);
    units.value = s.units;
    grades.value = g;
    managers.value = m.filter((x) => x.id !== e?.id);
  } catch (err) {
    toast.error((err as Error).message);
  }
});
const job = computed(() => jobs.value.find((j) => j.id === form.jobId));
const grade = computed(() => grades.value.find((g) => g.id === job.value?.gradeId));
const outOfRange = computed(() => !!grade.value && (form.basicSalary < grade.value.minSalary || form.basicSalary > grade.value.maxSalary));
const gross = computed(() => Number(form.basicSalary) + form.allowances.reduce((s, a) => s + Number(a.amount || 0), 0));
watch(() => form.jobId, () => {
  if (!job.value) return;
  form.unitId = job.value.unitId;
  if (!e && grade.value) applyGrade();
});
watch(() => form.isSaudi, (v) => { if (!e) form.nationality = v ? 'سعودي' : ''; });
watch(() => form.hireDate, (v) => { if (!e && v && !form.contractStart) form.contractStart = v; });
/** الراتب والبدلات من سلم الرواتب حسب الدرجة */
function applyGrade() {
  const g = grade.value;
  if (!g) return;
  const s = g.scale[Math.min(form.step, g.steps) - 1] ?? g.scale[0];
  form.basicSalary = s.basic;
  form.allowances = s.allowances.map((a) => ({ ...a }));
}
const choices = (code: string) => types.value.filter((t) => (t.isActive || t.code === code) && (t.code === code || !form.allowances.some((a) => a.code === t.code)));
function addAllowance() {
  const t = choices('')[0];
  if (t) form.allowances.push({ code: t.code, name: t.name, amount: t.defaultKind === 'percent' ? Math.round((Number(form.basicSalary) * t.defaultValue) / 100) : t.defaultValue });
}
const nn = (v: string) => (v === '' ? null : v);
async function save() {
  saving.value = true;
  try {
    const body = {
      fullName: form.fullName, nationalId: form.nationalId, nationality: form.nationality, isSaudi: form.isSaudi, gender: form.gender, birthDate: nn(form.birthDate),
      phone: nn(form.phone), email: nn(form.email), jobId: form.jobId, unitId: nn(form.unitId), managerId: nn(form.managerId), step: Number(form.step), hireDate: form.hireDate,
      contractType: form.contractType, contractStart: form.contractStart || form.hireDate, contractEnd: nn(form.contractEnd), probationEnd: nn(form.probationEnd), qiwaStatus: form.qiwaStatus,
      basicSalary: Number(form.basicSalary), allowances: form.allowances.filter((a) => a.code).map((a) => ({ code: a.code, amount: Number(a.amount) })),
      attendanceCode: nn(String(form.attendanceCode).trim()), attendanceExempt: form.attendanceExempt,
      salaryException: nn(form.salaryException), iban: nn(form.iban.replace(/\s/g, '').toUpperCase()), gosiNumber: nn(form.gosiNumber), gosiFirstRegistration: nn(form.gosiFirstRegistration),
      idExpiry: nn(form.idExpiry), passportExpiry: nn(form.passportExpiry),
      leaveOpening: form.leaveOpeningAnnual === '' ? {} : { annual: Number(form.leaveOpeningAnnual) }, leaveOpeningDate: nn(form.leaveOpeningDate),
    };
    const r = e ? await api<{ id: string }>(`/hr/employees/${e.id}`, { method: 'PATCH', json: body }) : await api<{ id: string }>('/hr/employees', { method: 'POST', json: body });
    toast.success('تم حفظ بيانات الموظف');
    emit('saved', r.id);
  } catch (err) {
    toast.error((err as Error).message);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <form class="card modal modal-wide" style="max-width: 900px" @submit.prevent="save">
      <h2>{{ e ? `تعديل بيانات ${e.fullName}` : 'موظف جديد' }}</h2>
      <div class="hr-sec">البيانات الشخصية</div>
      <div class="hr-fields">
        <label class="field" style="grid-column: span 2"><span>الاسم الكامل</span><input v-model="form.fullName" class="input" required /></label>
        <label class="field"><span>الجنسية</span>
          <select v-model="form.isSaudi" class="input"><option :value="true">سعودي</option><option :value="false">غير سعودي</option></select>
        </label>
        <label v-if="!form.isSaudi" class="field"><span>الدولة</span><NationalitySelect v-model="form.nationality" required /></label>
        <label class="field"><span>{{ form.isSaudi ? 'رقم الهوية الوطنية' : 'رقم الإقامة' }}</span><input v-model="form.nationalId" class="input hr-code" inputmode="numeric" maxlength="10" required /></label>
        <label class="field"><span>الجنس</span><select v-model="form.gender" class="input"><option value="male">ذكر</option><option value="female">أنثى</option></select></label>
        <label class="field"><span>تاريخ الميلاد</span><input v-model="form.birthDate" type="date" class="input" /></label>
        <label class="field"><span>الجوال</span><input v-model="form.phone" class="input hr-code" placeholder="05xxxxxxxx" /></label>
        <label class="field"><span>البريد الإلكتروني</span><input v-model="form.email" type="email" class="input" /></label>
      </div>

      <div class="hr-sec">الوظيفة والعقد</div>
      <div class="hr-fields">
        <label class="field" style="grid-column: span 2"><span>الوظيفة</span>
          <select v-model="form.jobId" class="input" required>
            <option value="" disabled>اختر الوظيفة</option>
            <option v-for="j in jobs" :key="j.id" :value="j.id">{{ j.title }} · {{ j.unitName }}{{ j.vacancies ? ` (شاغر ${j.vacancies})` : '' }}</option>
          </select>
        </label>
        <label class="field"><span>الوحدة التنظيمية</span>
          <select v-model="form.unitId" class="input"><option v-for="u in units" :key="u.id" :value="u.id">{{ u.levelName }}: {{ u.name }}</option></select>
        </label>
        <label class="field"><span>المدير المباشر</span>
          <select v-model="form.managerId" class="input"><option value="">—</option><option v-for="m in managers" :key="m.id" :value="m.id">{{ m.fullName }}</option></select>
        </label>
        <label class="field"><span>تاريخ المباشرة</span><input v-model="form.hireDate" type="date" class="input" required /></label>
        <label class="field"><span>نوع العقد</span><select v-model="form.contractType" class="input"><option v-for="c in CONTRACT_TYPES" :key="c.value" :value="c.value">{{ c.label }}</option></select></label>
        <label class="field"><span>بداية العقد</span><input v-model="form.contractStart" type="date" class="input" /></label>
        <label class="field"><span>نهاية العقد</span><input v-model="form.contractEnd" type="date" class="input" :required="form.contractType === 'fixed'" /></label>
        <label class="field"><span>نهاية فترة التجربة</span><input v-model="form.probationEnd" type="date" class="input" /><small v-if="!e" class="pm-muted">تُحسب من اللائحة إذا تُركت فارغة</small></label>
        <label class="field"><span>حالة التوثيق في قوى</span><select v-model="form.qiwaStatus" class="input"><option v-for="q in QIWA" :key="q.value" :value="q.value">{{ q.label }}</option></select></label>
      </div>

      <div class="hr-sec">الراتب</div>
      <div v-if="grade" class="pm-muted" style="margin-bottom: 8px">
        المرتبة <b>{{ grade.code }} {{ grade.name }}</b>: من {{ sar(grade.minSalary) }} إلى {{ sar(grade.maxSalary) }}، {{ grade.steps }} درجات
        <label style="display: inline-flex; gap: 6px; align-items: center; margin-inline-start: 10px">الدرجة
          <select v-model.number="form.step" class="input" style="width: 70px; padding: 2px 6px"><option v-for="s in grade.steps" :key="s" :value="s">{{ s }}</option></select>
        </label>
        <button type="button" class="btn btn-sm" style="margin-inline-start: 8px" @click="applyGrade">تطبيق راتب الدرجة وبدلاتها</button>
      </div>
      <div class="hr-fields">
        <label class="field"><span>الراتب الأساسي</span><input v-model.number="form.basicSalary" type="number" min="0" step="0.01" class="input" required /></label>
        <label v-for="(a, i) in form.allowances" :key="i" class="field">
          <span style="display: flex; gap: 6px"><select v-model="a.code" class="input" style="padding: 2px 6px; font-size: .8rem"><option v-for="t in choices(a.code)" :key="t.code" :value="t.code">{{ t.name }}</option></select>
            <button type="button" class="btn btn-sm" @click="form.allowances.splice(i, 1)">✕</button></span>
          <input v-model.number="a.amount" type="number" min="0" step="0.01" class="input" />
        </label>
        <div class="field" style="align-self: end"><button type="button" class="btn btn-sm" :disabled="!choices('').length" @click="addAllowance">+ بدل آخر</button>
          <small class="pm-muted">البدلات تُعرَّف في إعدادات الموارد البشرية</small></div>
      </div>
      <p class="pm-muted">إجمالي الراتب الشهري: <b>{{ sar(gross) }}</b></p>
      <label v-if="outOfRange" class="field"><span style="color: var(--danger)">الراتب خارج حدود المرتبة، اكتب سبب الاستثناء</span><input v-model="form.salaryException" class="input" required /></label>

      <div class="hr-sec">البنك والتأمينات والمستندات</div>
      <div class="hr-fields">
        <label class="field"><span>رقم الآيبان</span><input v-model="form.iban" class="input hr-code" placeholder="SA..." /></label>
        <label class="field"><span>رقمه في جهاز البصمة</span><input v-model="form.attendanceCode" class="input hr-code" :placeholder="e ? `الرقم الوظيفي ${e.employeeNo}` : 'الرقم الوظيفي'" /></label>
        <label class="field" style="flex-direction: row; gap: 8px; align-items: center; align-self: end"><input v-model="form.attendanceExempt" type="checkbox" /><span>معفى من البصمة</span></label>
        <label class="field"><span>رقم المشترك في التأمينات</span><input v-model="form.gosiNumber" class="input hr-code" /></label>
        <label class="field"><span>تاريخ أول تسجيل في التأمينات</span><input v-model="form.gosiFirstRegistration" type="date" class="input" />
          <small class="pm-muted">يحدد نسبة المعاشات (النظام الجديد لمن سُجّل بعد 3 يوليو 2024)</small></label>
        <label class="field"><span>انتهاء {{ form.isSaudi ? 'الهوية' : 'الإقامة' }}</span><input v-model="form.idExpiry" type="date" class="input" /></label>
        <label v-if="!form.isSaudi" class="field"><span>انتهاء الجواز</span><input v-model="form.passportExpiry" type="date" class="input" /></label>
      </div>
      <div class="hr-sec">الرصيد الافتتاحي للإجازة السنوية (عند بدء استخدام النظام)</div>
      <div class="hr-fields">
        <label class="field"><span>الرصيد بالأيام</span><input v-model="form.leaveOpeningAnnual" type="number" step="0.5" class="input" /></label>
        <label class="field"><span>كما في تاريخ</span><input v-model="form.leaveOpeningDate" type="date" class="input" /></label>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" :disabled="saving">حفظ</button><button type="button" class="btn" @click="emit('close')">إلغاء</button></div>
    </form>
  </div>
</template>
