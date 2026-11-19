<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, ref } from 'vue';
import type { SupplierForm } from '../lib';

/**
 * حقول بيانات المورد، يستخدمها الموظف في السجل والمورد في البوابة.
 * البيانات النظامية (الاسم ونوع الكيان والسجل والضريبي والهوية) تُقفل بعد إرسال الطلب في البوابة.
 */
const f = defineModel<SupplierForm>({ required: true });
const props = defineProps<{
  entityTypes: Record<string, string>; supplierKinds: Record<string, string>;
  categories: { id: string; name: string; color: string; isActive?: boolean }[]; activities: string[];
  legalLocked?: boolean;
}>();
const newActivity = ref('');
const individual = computed(() => f.value.entityType === 'individual');
const activityOptions = computed(() => [...new Set([...props.activities, ...f.value.activities])]);
function toggle(list: string[], v: string) {
  const i = list.indexOf(v);
  if (i >= 0) list.splice(i, 1);
  else list.push(v);
}
function addActivity() {
  const v = newActivity.value.trim();
  if (v && !f.value.activities.includes(v)) f.value.activities.push(v);
  newActivity.value = '';
}
</script>

<template>
  <div>
    <p v-if="legalLocked" class="alert alert-info">البيانات النظامية مقفلة بعد إرسال الطلب. لتعديلها تواصل مع الجمعية.</p>
    <div class="pc-sec">بيانات المنشأة</div>
    <div class="pc-fields">
      <label class="field wide"><span>اسم المنشأة كما في السجل *</span><input v-model="f.name" class="input" :disabled="legalLocked" required /></label>
      <label class="field"><span>الاسم بالإنجليزية</span><input v-model="f.nameEn" class="input" dir="ltr" /></label>
      <label class="field"><span>نوع الكيان *</span>
        <select v-model="f.entityType" class="input" :disabled="legalLocked"><option v-for="(l, k) in entityTypes" :key="k" :value="k">{{ l }}</option></select>
      </label>
      <label class="field"><span>نوع المورد *</span>
        <select v-model="f.supplierKind" class="input"><option v-for="(l, k) in supplierKinds" :key="k" :value="k">{{ l }}</option></select>
      </label>
      <template v-if="!individual">
        <label class="field"><span>رقم السجل التجاري</span><input v-model="f.crNumber" class="input" dir="ltr" inputmode="numeric" maxlength="10" :disabled="legalLocked" placeholder="10 أرقام" /></label>
        <label class="field"><span>انتهاء السجل</span><input v-model="f.crExpiry" class="input" type="date" /></label>
      </template>
      <label v-else class="field"><span>رقم الهوية أو الإقامة</span><input v-model="f.nationalId" class="input" dir="ltr" inputmode="numeric" maxlength="10" :disabled="legalLocked" /></label>
      <label class="field"><span>الرقم الضريبي</span><input v-model="f.vatNumber" class="input" dir="ltr" inputmode="numeric" maxlength="15" :disabled="legalLocked" placeholder="15 رقمًا يبدأ وينتهي بـ 3" /></label>
    </div>

    <div class="pc-sec">التواصل والعنوان</div>
    <div class="pc-fields">
      <label class="field"><span>المدينة</span><input v-model="f.city" class="input" /></label>
      <label class="field"><span>الهاتف</span><input v-model="f.phone" class="input" dir="ltr" inputmode="tel" /></label>
      <label class="field"><span>البريد الإلكتروني</span><input v-model="f.email" class="input" dir="ltr" type="email" /></label>
      <label class="field"><span>الموقع الإلكتروني</span><input v-model="f.website" class="input" dir="ltr" placeholder="https://" /></label>
      <label class="field wide"><span>العنوان الوطني</span><input v-model="f.address" class="input" /></label>
    </div>

    <div class="pc-sec">الأنشطة والتصنيف</div>
    <div class="pc-chips" style="margin-bottom: 8px">
      <button v-for="a in activityOptions" :key="a" type="button" :class="['pc-chip', { on: f.activities.includes(a) }]" @click="toggle(f.activities, a)">{{ a }}</button>
    </div>
    <div class="pc-inline" style="margin-bottom: 10px">
      <input v-model="newActivity" class="input" placeholder="نشاط آخر غير موجود في القائمة" @keydown.enter.prevent="addActivity" />
      <button type="button" class="btn btn-sm" :disabled="!newActivity.trim()" @click="addActivity">إضافة</button>
    </div>
    <div v-if="categories.length" class="pc-chips" style="margin-bottom: 8px">
      <span class="pm-muted" style="font-size: .82rem">التصنيف:</span>
      <button v-for="c in categories.filter((x) => x.isActive !== false || f.categoryIds.includes(x.id))" :key="c.id" type="button"
              :class="['pc-chip', { on: f.categoryIds.includes(c.id) }]" :style="{ '--c': c.color }" @click="toggle(f.categoryIds, c.id)">{{ c.name }}</button>
    </div>
    <label class="field"><span>نبذة عن المنشأة وخبراتها</span><textarea v-model="f.about" class="input" rows="3" /></label>

    <div class="pc-sec">جهات التواصل <button type="button" class="btn btn-sm" @click="f.contacts.push({ name: '', title: '', phone: '', email: '', authorized: false })">+ جهة تواصل</button></div>
    <div v-for="(c, i) in f.contacts" :key="i" class="pc-inline" style="margin-bottom: 6px">
      <input v-model="c.name" class="input" placeholder="الاسم" />
      <input v-model="c.title" class="input" placeholder="المسمى" />
      <input v-model="c.phone" class="input" dir="ltr" placeholder="الجوال" />
      <input v-model="c.email" class="input" dir="ltr" placeholder="البريد" />
      <label class="pm-muted" style="font-size: .82rem; white-space: nowrap"><input v-model="c.authorized" type="checkbox" /> مفوض بالتوقيع</label>
      <button type="button" class="btn btn-sm" @click="f.contacts.splice(i, 1)">✕</button>
    </div>

    <div class="pc-sec">الفروع <button type="button" class="btn btn-sm" @click="f.branches.push({ name: '', city: '', address: '', phone: '' })">+ فرع</button></div>
    <div v-for="(b, i) in f.branches" :key="i" class="pc-inline" style="margin-bottom: 6px">
      <input v-model="b.name" class="input" placeholder="اسم الفرع" />
      <input v-model="b.city" class="input" placeholder="المدينة" />
      <input v-model="b.address" class="input" placeholder="العنوان" />
      <input v-model="b.phone" class="input" dir="ltr" placeholder="الهاتف" />
      <button type="button" class="btn btn-sm" @click="f.branches.splice(i, 1)">✕</button>
    </div>
  </div>
</template>
