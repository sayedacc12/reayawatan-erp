<script setup lang="ts">
import { reactive, ref } from 'vue';
import { api } from '../../../api';
import DynFields from './DynFields.vue';
import { AVAILABILITY, type Lookups } from '../lib';

/** نموذج المتطوع: البيانات الأساسية الثابتة + نوع التطوع ومجالاته + الحقول المرنة من الإعدادات */
const props = defineProps<{ lookups: Lookups; initial?: Record<string, unknown> | null; id?: string | null }>();
const emit = defineEmits<{ saved: [v: { id: string }]; cancel: [] }>();
const i = props.initial ?? {};
const f = reactive({
  fullName: (i.fullName as string) ?? '', nationalId: (i.nationalId as string) ?? '', mobile: (i.mobile as string) ?? '', email: (i.email as string) ?? '',
  gender: (i.gender as string) ?? 'male', birthDate: (i.birthDate as string) ?? '', city: (i.city as string) ?? '', qualification: (i.qualification as string) ?? '',
  typeCode: (i.typeCode as string) ?? '', fieldCodes: [...((i.fieldCodes as string[]) ?? [])], skills: (i.skills as string) ?? '',
  availability: [...((i.availability as string[]) ?? [])], answers: { ...((i.answers as Record<string, unknown>) ?? {}) },
});
const error = ref('');
const busy = ref(false);
const toggle = (list: string[], v: string) => {
  const k = list.indexOf(v);
  if (k >= 0) list.splice(k, 1);
  else list.push(v);
};
async function save() {
  error.value = '';
  busy.value = true;
  try {
    const body = { ...f, email: f.email || null, birthDate: f.birthDate || null, city: f.city || null, qualification: f.qualification || null, typeCode: f.typeCode || null, skills: f.skills || null };
    const v = props.id
      ? await api<{ id: string }>(`/volunteers/volunteers/${props.id}`, { method: 'PATCH', json: body })
      : await api<{ id: string }>('/volunteers/volunteers', { method: 'POST', json: body });
    emit('saved', v);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form @submit.prevent="save">
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="vt-sec">البيانات الأساسية</div>
    <div class="pm-grid2">
      <label class="field"><span>الاسم الكامل *</span><input v-model="f.fullName" class="input" required /></label>
      <label class="field"><span>رقم الهوية أو الإقامة *</span><input v-model="f.nationalId" class="input" dir="ltr" maxlength="10" required /></label>
      <label class="field"><span>رقم الجوال *</span><input v-model="f.mobile" class="input" dir="ltr" placeholder="05xxxxxxxx" required /></label>
      <label class="field"><span>البريد الإلكتروني</span><input v-model="f.email" type="email" class="input" dir="ltr" /></label>
      <label class="field"><span>الجنس *</span><select v-model="f.gender" class="input"><option value="male">ذكر</option><option value="female">أنثى</option></select></label>
      <label class="field"><span>تاريخ الميلاد</span><input v-model="f.birthDate" type="date" class="input" /></label>
      <label class="field"><span>المدينة</span><input v-model="f.city" class="input" /></label>
      <label class="field"><span>المؤهل العلمي</span><input v-model="f.qualification" class="input" /></label>
    </div>
    <div class="vt-sec">التطوع</div>
    <label class="field"><span>نوع التطوع</span>
      <select v-model="f.typeCode" class="input"><option value="">غير محدد</option><option v-for="t in lookups.volunteerTypes.filter((x) => x.isActive || x.code === f.typeCode)" :key="t.code" :value="t.code">{{ t.name }}</option></select>
    </label>
    <div class="field"><span>مجالات التطوع المفضلة</span>
      <div class="vt-chips"><button v-for="x in lookups.volunteerFields.filter((y) => y.isActive || f.fieldCodes.includes(y.code))" :key="x.code" type="button" :class="['vt-chip', { on: f.fieldCodes.includes(x.code) }]" @click="toggle(f.fieldCodes, x.code)">{{ x.name }}</button></div>
    </div>
    <div class="field"><span>أوقات الإتاحة</span>
      <div class="vt-chips"><button v-for="a in AVAILABILITY" :key="a" type="button" :class="['vt-chip', { on: f.availability.includes(a) }]" @click="toggle(f.availability, a)">{{ a }}</button></div>
    </div>
    <label class="field"><span>المهارات والخبرات</span><textarea v-model="f.skills" class="input" rows="2" /></label>
    <template v-if="lookups.registrationFields.length">
      <div class="vt-sec">بيانات إضافية</div>
      <DynFields v-model="f.answers" :fields="lookups.registrationFields" />
    </template>
    <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ</button><button type="button" class="btn" @click="emit('cancel')">إلغاء</button></div>
  </form>
</template>
