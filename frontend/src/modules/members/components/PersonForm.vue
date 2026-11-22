<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import NationalitySelect from '../../../components/NationalitySelect.vue';
import DynFields from './DynFields.vue';
import { durationLabel, sar, type Condition, type DocReq, type FormField } from '../lib';

/**
 * نموذج العضوية الموحد: نوع العضوية، البيانات الشخصية، الحقول الإضافية من الإعدادات، المستندات (صورة الهوية)،
 * والإقرار بشروط العضوية. يُستخدم في الصفحة العامة وإدخال الموظف وتعديل العضو وإضافة العضو القائم.
 */
interface TypeLite { code: string; name: string; description?: string | null; fee: number; joiningFee: number; durationMonths: number; votingRights: boolean; minAge: number | null; saudiOnly: boolean; benefits?: string | null; color: string; isActive?: boolean }
const props = defineProps<{
  types: TypeLite[]; nationalities: string[]; fields: FormField[]; documents?: DocReq[]; conditions?: Condition[];
  mode: 'apply' | 'member' | 'direct'; initial?: Record<string, unknown> | null; existingDocs?: { key: string; fileName: string }[]; busy?: boolean; submitLabel?: string; cards?: boolean;
}>();
const emit = defineEmits<{ submit: [data: Record<string, unknown>, files: Record<string, File>]; cancel: [] }>();
const i = props.initial ?? {};
const s = (k: string) => (i[k] as string) ?? '';
const f = reactive({
  typeCode: s('typeCode') || (props.types.find((t) => t.isActive !== false)?.code ?? ''), fullName: s('fullName'), nationalId: s('nationalId'), idExpiry: s('idExpiry'),
  nationality: s('nationality') || 'سعودي', gender: s('gender') || 'male', birthDate: s('birthDate'), mobile: s('mobile'), email: s('email'), city: s('city'),
  address: s('address'), occupation: s('occupation'), employer: s('employer'), qualification: s('qualification'),
  answers: { ...((i.answers as Record<string, unknown>) ?? {}) },
  acceptedConditions: [...((i.acceptedConditions as string[]) ?? [])],
  joinedOn: s('joinedOn'), startDate: s('startDate'), endDate: s('endDate'), memberNo: (i.memberNo as number | null) ?? null,
});
const files = reactive<Record<string, File>>({});
const error = ref('');
const type = computed(() => props.types.find((t) => t.code === f.typeCode));
const docs = computed(() => (props.documents ?? []).filter((d) => d.isActive));
const conds = computed(() => (props.conditions ?? []).filter((c) => c.isActive));
const hasDoc = (k: string) => !!files[k] || !!props.existingDocs?.some((d) => d.key === k);
function pick(key: string, e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) files[key] = file;
  else delete files[key];
}
function toggleCond(k: string) {
  const at = f.acceptedConditions.indexOf(k);
  if (at >= 0) f.acceptedConditions.splice(at, 1);
  else f.acceptedConditions.push(k);
}
const nil = (v: string) => v || null;
function submit() {
  error.value = '';
  if (props.mode === 'apply') {
    const missing = docs.value.find((d) => d.required && !hasDoc(d.key));
    if (missing) return (error.value = `أرفق ${missing.name}`);
    const notAccepted = conds.value.find((c) => !f.acceptedConditions.includes(c.key));
    if (notAccepted) return (error.value = 'يجب الإقرار بجميع شروط العضوية');
  }
  const data: Record<string, unknown> = {
    typeCode: f.typeCode, fullName: f.fullName, nationalId: f.nationalId, idExpiry: nil(f.idExpiry), nationality: f.nationality, gender: f.gender,
    birthDate: nil(f.birthDate), mobile: f.mobile, email: nil(f.email), city: nil(f.city), address: nil(f.address), occupation: nil(f.occupation),
    employer: nil(f.employer), qualification: nil(f.qualification), answers: f.answers,
  };
  if (props.mode === 'apply') data.acceptedConditions = f.acceptedConditions;
  if (props.mode === 'direct') Object.assign(data, { joinedOn: f.joinedOn, startDate: f.startDate, endDate: nil(f.endDate), memberNo: f.memberNo || null });
  emit('submit', data, { ...files });
}
defineExpose({ setError: (m: string) => (error.value = m) });
</script>

<template>
  <form @submit.prevent="submit">
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="mb-sec">نوع العضوية</div>
    <div v-if="cards" class="mb-types">
      <button v-for="t in types" :key="t.code" type="button" :class="['mb-type', { on: f.typeCode === t.code }]" :style="{ '--c': t.color }" @click="f.typeCode = t.code">
        <h3>{{ t.name }}</h3>
        <div class="fee">{{ t.fee ? sar(t.fee) : 'بدون اشتراك' }} <small v-if="t.fee">{{ durationLabel(t.durationMonths) }}</small></div>
        <div v-if="t.joiningFee" class="pm-muted">+ رسوم انتساب {{ sar(t.joiningFee) }} مرة واحدة</div>
        <p v-if="t.description" class="pm-muted" style="margin: 6px 0 0">{{ t.description }}</p>
        <ul>
          <li v-if="t.votingRights">حق التصويت في الجمعية العمومية</li>
          <li v-if="t.minAge">العمر {{ t.minAge }} سنة فأكثر</li>
          <li v-if="t.saudiOnly">للسعوديين</li>
          <li v-for="b in (t.benefits ?? '').split('\n').filter(Boolean).slice(0, 3)" :key="b">{{ b }}</li>
        </ul>
      </button>
    </div>
    <label v-else class="field"><span>نوع العضوية *</span>
      <select v-model="f.typeCode" class="input" required>
        <option v-for="t in types.filter((x) => x.isActive !== false || x.code === f.typeCode)" :key="t.code" :value="t.code">{{ t.name }} ({{ t.fee ? sar(t.fee) : 'بدون اشتراك' }})</option>
      </select>
    </label>
    <p v-if="type && (type.minAge || type.saudiOnly)" class="pm-muted" style="margin: 6px 0 0">شروط هذا النوع: {{ [type.minAge ? `العمر ${type.minAge} سنة فأكثر` : '', type.saudiOnly ? 'سعودي الجنسية' : ''].filter(Boolean).join('، ') }}</p>

    <div class="mb-sec">البيانات الشخصية</div>
    <div class="pm-grid2">
      <label class="field"><span>الاسم الكامل (كما في الهوية) *</span><input v-model="f.fullName" class="input" required /></label>
      <label class="field"><span>رقم الهوية أو الإقامة *</span><input v-model="f.nationalId" class="input" dir="ltr" maxlength="10" inputmode="numeric" required /></label>
      <label class="field"><span>تاريخ انتهاء الهوية</span><input v-model="f.idExpiry" type="date" class="input" /></label>
      <label class="field"><span>الجنسية *</span><NationalitySelect v-model="f.nationality" :options="nationalities" required /></label>
      <label class="field"><span>الجنس *</span><select v-model="f.gender" class="input"><option value="male">ذكر</option><option value="female">أنثى</option></select></label>
      <label class="field"><span>تاريخ الميلاد{{ type?.minAge ? ' *' : '' }}</span><input v-model="f.birthDate" type="date" class="input" :required="!!type?.minAge" /></label>
      <label class="field"><span>رقم الجوال *</span><input v-model="f.mobile" class="input" dir="ltr" placeholder="05xxxxxxxx" inputmode="tel" required /></label>
      <label class="field"><span>البريد الإلكتروني</span><input v-model="f.email" type="email" class="input" dir="ltr" /></label>
      <label class="field"><span>المدينة</span><input v-model="f.city" class="input" /></label>
      <label class="field"><span>العنوان الوطني</span><input v-model="f.address" class="input" /></label>
      <label class="field"><span>المهنة</span><input v-model="f.occupation" class="input" /></label>
      <label class="field"><span>جهة العمل</span><input v-model="f.employer" class="input" /></label>
      <label class="field"><span>المؤهل العلمي</span><input v-model="f.qualification" class="input" /></label>
    </div>

    <template v-if="fields.length">
      <div class="mb-sec">بيانات إضافية</div>
      <DynFields v-model="f.answers" :fields="fields" />
    </template>

    <template v-if="mode === 'direct'">
      <div class="mb-sec">العضوية الحالية</div>
      <div class="pm-grid2">
        <label class="field"><span>تاريخ الانضمام للشركة *</span><input v-model="f.joinedOn" type="date" class="input" required /></label>
        <label class="field"><span>رقم العضوية (اختياري، يُرقّم تلقائيًا)</span><input v-model.number="f.memberNo" type="number" min="1" class="input" dir="ltr" /></label>
        <label class="field"><span>بداية مدة العضوية الحالية *</span><input v-model="f.startDate" type="date" class="input" required /></label>
        <label class="field"><span>نهاية مدة العضوية الحالية</span><input v-model="f.endDate" type="date" class="input" /><small class="pm-muted">تُحسب من مدة النوع إن تُركت فارغة</small></label>
      </div>
    </template>

    <template v-if="mode === 'apply' && docs.length">
      <div class="mb-sec">المستندات</div>
      <div v-for="d in docs" :key="d.key" :class="['mb-doc', { ok: hasDoc(d.key) }]">
        <span style="flex: 1"><b>{{ d.name }}</b><span v-if="d.required" style="color: var(--danger)"> *</span>
          <small v-if="!files[d.key] && existingDocs?.some((x) => x.key === d.key)" class="pm-muted" style="display: block">مرفق سابقًا، ويمكنك استبداله</small>
          <small class="pm-muted" style="display: block">صورة JPG أو PNG أو ملف PDF، بحد أقصى 10 ميجابايت</small></span>
        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" @change="pick(d.key, $event)" />
      </div>
    </template>

    <template v-if="mode === 'apply' && conds.length">
      <div class="mb-sec">الإقرار بشروط العضوية</div>
      <label v-for="c in conds" :key="c.key" class="mb-cond" @click.prevent="toggleCond(c.key)">
        <input type="checkbox" :checked="f.acceptedConditions.includes(c.key)" />
        <span>{{ c.text }}<small v-if="c.reference">{{ c.reference }}</small></span>
      </label>
    </template>

    <div class="modal-actions">
      <button class="btn btn-primary" :disabled="busy">{{ submitLabel ?? 'حفظ' }}</button>
      <button type="button" class="btn" @click="emit('cancel')">إلغاء</button>
    </div>
  </form>
</template>
