<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { addressPayload, emptyAddress } from '../lib';

const props = defineProps<{ customer?: any; lk: any }>();
const emit = defineEmits<{ saved: [any]; close: [] }>();
const toast = useToast();
const busy = ref(false);
const c = props.customer;
const f = ref<any>({
  kind: c?.kind ?? 'business', name: c?.name ?? '', nameEn: c?.nameEn ?? '', vatNumber: c?.vatNumber ?? '', idType: c?.idType ?? '', idNumber: c?.idNumber ?? '',
  address: { ...emptyAddress(), ...(c?.address ?? {}) }, phone: c?.phone ?? '', email: c?.email ?? '', isActive: c?.isActive ?? true, notes: c?.notes ?? '',
});
async function save() {
  busy.value = true;
  try {
    const x = f.value;
    const json = {
      kind: x.kind, name: x.name, nameEn: x.nameEn || null, vatNumber: x.vatNumber || null, idType: x.idType || null, idNumber: x.idNumber || null,
      address: addressPayload(x.address), phone: x.phone || null, email: x.email || null, isActive: x.isActive, notes: x.notes || null,
    };
    const r = c ? await api(`/billing/customers/${c.id}`, { method: 'PUT', json }) : await api('/billing/customers', { method: 'POST', json });
    toast.success('حُفظ ملف العميل');
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
    <form class="card modal" style="max-width: 760px" @submit.prevent="save">
      <h2>{{ c ? 'تعديل ملف العميل' : 'عميل جديد' }}</h2>
      <div class="pc-fields">
        <label class="field"><span>النوع</span><select v-model="f.kind" class="input"><option v-for="(l, k) in lk.customerKinds" :key="k" :value="k">{{ l }}</option></select></label>
        <label class="field"><span>الاسم</span><input v-model="f.name" class="input" required minlength="2" maxlength="250" /></label>
        <label class="field"><span>الاسم بالإنجليزية (اختياري)</span><input v-model="f.nameEn" class="input" maxlength="250" dir="ltr" /></label>
        <label class="field"><span>الرقم الضريبي</span><input v-model="f.vatNumber" class="input" maxlength="20" dir="ltr" placeholder="3xxxxxxxxxxxxx3" /></label>
        <label class="field"><span>معرّف آخر</span><select v-model="f.idType" class="input"><option value="">—</option><option v-for="(l, k) in lk.idTypes" :key="k" :value="k">{{ l }}</option></select></label>
        <label v-if="f.idType" class="field"><span>رقم المعرّف</span><input v-model="f.idNumber" class="input" maxlength="40" dir="ltr" /></label>
        <label class="field"><span>الجوال أو الهاتف</span><input v-model="f.phone" class="input" maxlength="20" dir="ltr" /></label>
        <label class="field"><span>البريد الإلكتروني</span><input v-model="f.email" type="email" class="input" maxlength="200" dir="ltr" /></label>
      </div>
      <p class="pc-sec">العنوان الوطني <small class="pm-muted" style="font-weight: 400">(إلزامي للفاتورة الضريبية للمنشآت)</small></p>
      <div class="pc-fields">
        <label class="field"><span>رقم المبنى</span><input v-model="f.address.buildingNo" class="input" maxlength="4" dir="ltr" /></label>
        <label class="field"><span>الشارع</span><input v-model="f.address.street" class="input" maxlength="200" /></label>
        <label class="field"><span>الحي</span><input v-model="f.address.district" class="input" maxlength="120" /></label>
        <label class="field"><span>المدينة</span><input v-model="f.address.city" class="input" maxlength="120" /></label>
        <label class="field"><span>الرمز البريدي</span><input v-model="f.address.postalCode" class="input" maxlength="5" dir="ltr" /></label>
        <label class="field"><span>الرقم الإضافي</span><input v-model="f.address.additionalNo" class="input" maxlength="4" dir="ltr" /></label>
      </div>
      <label class="field"><span>ملاحظات</span><textarea v-model="f.notes" class="input" rows="2" maxlength="1000" /></label>
      <label v-if="c" class="field" style="flex-direction: row; gap: 8px; align-items: center"><input v-model="f.isActive" type="checkbox" /> <span>نشط</span></label>
      <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ</button><button type="button" class="btn" @click="emit('close')">رجوع</button></div>
    </form>
  </div>
</template>
