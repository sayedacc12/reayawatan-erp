<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { lookups } from '../lib';

/** نموذج إضافة شريك أو تعديل بياناته */
const props = defineProps<{ partner?: any }>();
const emit = defineEmits<{ close: []; saved: [any] }>();
const toast = useToast();
const lk = ref<any>(null);
const donors = ref<any[]>([]);
const busy = ref(false);
const p = props.partner;
const f = reactive({
  name: p?.name ?? '', classId: p?.classId ?? '', typeIds: [...(p?.typeIds ?? [])] as string[], registrationNo: p?.registrationNo ?? '', city: p?.city ?? '',
  website: p?.website ?? '', contactName: p?.contactName ?? '', contactTitle: p?.contactTitle ?? '', phone: p?.phone ?? '', email: p?.email ?? '',
  about: p?.about ?? '', donorId: p?.donorId ?? '', showOnWebsite: p?.showOnWebsite ?? false,
});
onMounted(async () => {
  try {
    lk.value = await lookups();
    donors.value = (await api<any>('/partnerships/picks')).donors;
  } catch (e) {
    toast.error((e as Error).message);
  }
});
function toggleType(id: string) {
  f.typeIds = f.typeIds.includes(id) ? f.typeIds.filter((x) => x !== id) : [...f.typeIds, id];
}
/** اختيار مانح من تنمية الموارد يملأ البيانات الفارغة */
function pickDonor() {
  const d = donors.value.find((x) => x.id === f.donorId);
  if (d && !f.name) f.name = d.name;
}
async function save() {
  busy.value = true;
  try {
    const body = { ...f, classId: f.classId || null, donorId: f.donorId || null };
    const r = await api(p ? `/partnerships/partners/${p.id}` : '/partnerships/partners', { method: p ? 'PUT' : 'POST', json: body });
    toast.success(p ? 'حُفظت بيانات الشريك' : 'سُجّل الشريك، والخطوة التالية تقييمه');
    emit('saved', r);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <form class="card modal pt-modal-wide" @submit.prevent="save">
      <h2 style="margin-bottom: 4px">{{ p ? 'تعديل بيانات الشريك' : 'شريك جديد' }}</h2>
      <p class="pm-muted" style="margin: 0 0 10px">بعد التسجيل يُقيَّم الشريك وفق معايير الاختيار، ثم يُعتمد قبل التعاقد معه.</p>
      <template v-if="lk">
        <div class="pt-sec">الجهة</div>
        <div class="pt-fields">
          <div class="field" style="grid-column: span 2"><label>اسم الجهة *</label><input v-model="f.name" class="input" required minlength="2" /></div>
          <div class="field"><label>التصنيف</label>
            <select v-model="f.classId" class="input"><option value="">اختر التصنيف</option><option v-for="c in lk.classes.filter((x: any) => x.isActive || x.id === f.classId)" :key="c.id" :value="c.id">{{ c.name }}</option></select></div>
          <div class="field"><label>رقم السجل التجاري أو الترخيص</label><input v-model="f.registrationNo" class="input" dir="ltr" /><small class="pm-muted">يُطلب من الشريك عند توقيع العقد إلكترونيًا للتحقق.</small></div>
          <div class="field"><label>المدينة</label><input v-model="f.city" class="input" /></div>
          <div class="field"><label>الموقع الإلكتروني</label><input v-model="f.website" class="input" dir="ltr" placeholder="https://" /></div>
        </div>
        <div class="field"><label>أنواع الشراكة المرشح لها</label>
          <div class="pt-chips">
            <button v-for="t in lk.types.filter((x: any) => x.isActive)" :key="t.id" type="button" :class="['pt-chip', { on: f.typeIds.includes(t.id) }]" :style="{ '--c': t.color }" @click="toggleType(t.id)">{{ t.name }}</button>
          </div>
        </div>
        <div class="pt-sec">ممثل الشريك (يظهر في تمهيد العقد)</div>
        <div class="pt-fields">
          <div class="field"><label>الاسم</label><input v-model="f.contactName" class="input" /></div>
          <div class="field"><label>الصفة</label><input v-model="f.contactTitle" class="input" placeholder="مثل: المدير التنفيذي" /></div>
          <div class="field"><label>الجوال أو الهاتف</label><input v-model="f.phone" class="input" dir="ltr" /></div>
          <div class="field"><label>البريد الإلكتروني</label><input v-model="f.email" class="input" dir="ltr" type="email" /></div>
        </div>
        <div class="pt-sec">الربط والظهور</div>
        <div class="pt-fields">
          <div class="field"><label>المانح المقابل في تنمية الموارد</label>
            <select v-model="f.donorId" class="input" @change="pickDonor"><option value="">لا يوجد</option><option v-for="d in donors" :key="d.id" :value="d.id">{{ d.name }}{{ d.type === 'entity' ? '' : ' (فرد)' }}</option></select></div>
          <div class="field" style="align-self: end"><label class="check"><input v-model="f.showOnWebsite" type="checkbox" /> يظهر في صفحة «شركاؤنا» بالموقع بعد اعتماده</label></div>
        </div>
        <div class="field"><label>نبذة ومجالات التعاون</label><textarea v-model="f.about" class="input" rows="3" /></div>
      </template>
      <div class="modal-actions">
        <button class="btn btn-primary" :disabled="busy || !lk">{{ p ? 'حفظ' : 'تسجيل الشريك' }}</button>
        <button type="button" class="btn" @click="emit('close')">إلغاء</button>
      </div>
    </form>
  </div>
</template>
