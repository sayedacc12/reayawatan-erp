<script setup lang="ts">
import { reactive, ref } from 'vue';
import NationalitySelect from '../../../components/NationalitySelect.vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { CATEGORIES, GENDERS, HOUSING, MARITAL, RESIDENCIES, STATUSES } from '../labels';
import type { Beneficiary, BeneficiaryFields } from '../types';

/** نموذج إضافة/تعديل ملف مستفيد في نافذة منبثقة */
const props = defineProps<{ beneficiary?: Beneficiary | null }>();
const emit = defineEmits<{ close: []; saved: [b: Beneficiary] }>();
const toast = useToast();

const b = props.beneficiary;
const form = reactive<BeneficiaryFields>({
  fullName: b?.fullName ?? '', nationalId: b?.nationalId ?? '', gender: b?.gender ?? 'female',
  birthDate: b?.birthDate ?? '', phone: b?.phone ?? '', altPhone: b?.altPhone ?? '', city: b?.city ?? '', nationality: b?.nationality ?? '', residency: b?.residency ?? null,
  address: b?.address ?? '', maritalStatus: b?.maritalStatus ?? null, category: b?.category ?? 'poor_family',
  status: b?.status ?? 'new', monthlyIncome: b?.monthlyIncome ?? 0, incomeSource: b?.incomeSource ?? '',
  housingType: b?.housingType ?? null, monthlyRent: b?.monthlyRent ?? null, healthStatus: b?.healthStatus ?? '',
  notes: b?.notes ?? '',
});
const error = ref('');
const saving = ref(false);

async function save() {
  error.value = '';
  saving.value = true;
  try {
    const body = { ...form, monthlyIncome: Number(form.monthlyIncome) || 0,
      monthlyRent: form.housingType === 'rented' && form.monthlyRent !== null && String(form.monthlyRent) !== '' ? Number(form.monthlyRent) : null };
    const saved = b
      ? await api<Beneficiary>(`/beneficiaries/${b.id}`, { method: 'PATCH', json: body })
      : await api<Beneficiary>('/beneficiaries', { method: 'POST', json: body });
    toast.success(b ? 'تم حفظ التعديلات' : `تم فتح ملف رقم ${saved.fileNo}`);
    emit('saved', saved);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <form class="card modal modal-wide" @submit.prevent="save" @keydown.esc="emit('close')">
      <h2 class="title">{{ b ? `تعديل ملف رقم ${b.fileNo}` : 'ملف مستفيد جديد' }}</h2>
      <div v-if="error" class="alert alert-error">{{ error }}</div>

      <fieldset>
        <legend>البيانات الأساسية</legend>
        <div class="grid">
          <div class="field span-2"><label>الاسم رباعي *</label><input v-model="form.fullName" class="input" required minlength="3" autofocus /></div>
          <div class="field"><label>رقم الهوية / الإقامة</label><input v-model="form.nationalId" class="input" inputmode="numeric" dir="ltr" maxlength="20" /></div>
          <div class="field"><label>النوع *</label>
            <div class="seg"><label v-for="g in GENDERS" :key="g.value" :class="{ on: form.gender === g.value }"><input v-model="form.gender" type="radio" :value="g.value" />{{ g.label }}</label></div>
          </div>
          <div class="field"><label>تاريخ الميلاد</label><input v-model="form.birthDate" class="input" type="date" /></div>
          <div class="field"><label>الحالة الاجتماعية</label>
            <select v-model="form.maritalStatus" class="input"><option :value="null">—</option><option v-for="m in MARITAL" :key="m.value" :value="m.value">{{ m.label }}</option></select>
          </div>
          <div class="field"><label>فئة الحالة *</label>
            <select v-model="form.category" class="input" required><option v-for="c in CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</option></select>
          </div>
          <div class="field"><label>حالة الملف</label>
            <select v-model="form.status" class="input"><option v-for="s in STATUSES" :key="s.value" :value="s.value">{{ s.label }}</option></select>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>التواصل والعنوان</legend>
        <div class="grid">
          <div class="field"><label>الجوال</label><input v-model="form.phone" class="input" inputmode="tel" dir="ltr" /></div>
          <div class="field"><label>رقم إضافي</label><input v-model="form.altPhone" class="input" inputmode="tel" dir="ltr" /></div>
          <div class="field"><label>المدينة / المنطقة</label><input v-model="form.city" class="input" /></div>
          <div class="field"><label>الجنسية *</label><NationalitySelect v-model="form.nationality" required /></div>
          <div class="field"><label>فئة الإقامة</label>
            <select v-model="form.residency" class="input"><option :value="null">غير محددة</option><option v-for="r in RESIDENCIES" :key="r.value" :value="r.value">{{ r.label }}</option></select>
          </div>
          <div class="field"><label>العنوان بالتفصيل</label><input v-model="form.address" class="input" /></div>
        </div>
      </fieldset>

      <fieldset>
        <legend>الدخل والسكن والصحة</legend>
        <div class="grid">
          <div class="field"><label>الدخل الشهري</label><input v-model="form.monthlyIncome" class="input" type="number" min="0" step="0.01" /></div>
          <div class="field"><label>مصدر الدخل</label><input v-model="form.incomeSource" class="input" placeholder="معاش، عمل يومي..." /></div>
          <div class="field"><label>نوع السكن</label>
            <select v-model="form.housingType" class="input"><option :value="null">—</option><option v-for="h in HOUSING" :key="h.value" :value="h.value">{{ h.label }}</option></select>
          </div>
          <div v-if="form.housingType === 'rented'" class="field"><label>الإيجار الشهري</label><input v-model="form.monthlyRent" class="input" type="number" min="0" step="0.01" /></div>
          <div class="field span-2"><label>الحالة الصحية</label><input v-model="form.healthStatus" class="input" placeholder="أمراض مزمنة، إعاقة..." /></div>
          <div class="field span-2"><label>ملاحظات</label><textarea v-model="form.notes" class="input" rows="2" /></div>
        </div>
      </fieldset>

      <div class="modal-actions">
        <button class="btn btn-primary" :disabled="saving">{{ saving ? 'جارٍ الحفظ...' : 'حفظ الملف' }}</button>
        <button type="button" class="btn" @click="emit('close')">إلغاء</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.title { margin-bottom: 14px; }
fieldset { border: 0; padding: 0; margin: 0 0 8px; }
legend { font-size: .82rem; font-weight: 700; color: var(--primary); margin-bottom: 10px; display: flex; align-items: center; gap: 8px; width: 100%; }
legend::after { content: ''; flex: 1; height: 1px; background: linear-gradient(90deg, var(--border), transparent); }
.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 14px; }
.span-2 { grid-column: span 2; }
textarea.input { resize: vertical; }
.seg { display: flex; gap: 6px; }
.seg label { flex: 1; text-align: center; padding: 8px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; font-weight: 500; transition: all .2s; }
.seg label.on { background: var(--primary-soft); border-color: var(--primary); color: var(--primary); }
.seg input { display: none; }
@media (max-width: 600px) { .grid { grid-template-columns: 1fr; } .span-2 { grid-column: auto; } }
</style>
