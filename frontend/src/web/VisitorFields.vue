<script setup lang="ts">
/** حقول الزائر المشتركة في نماذج الموقع، مع حقل مخفي لاصطياد البرامج الآلية */
export interface Visitor { name: string; email: string; orgName: string; phone: string; orgType?: string; website: string }
defineProps<{ modelValue: Visitor; phone?: boolean; idp: string; orgTypes?: string[] }>();
</script>

<template>
  <div class="frow">
    <div class="field"><label :for="`${idp}-name`">الاسم <span class="req">*</span></label><input :id="`${idp}-name`" v-model="modelValue.name" class="input" required autocomplete="name" maxlength="160"></div>
    <div class="field"><label :for="`${idp}-org`">الجهة</label><input :id="`${idp}-org`" v-model="modelValue.orgName" class="input" placeholder="اسم الجمعية أو المؤسسة" maxlength="200"></div>
  </div>
  <div class="frow">
    <div class="field"><label :for="`${idp}-email`">البريد الإلكتروني <span class="req">*</span></label><input :id="`${idp}-email`" v-model="modelValue.email" class="input" type="email" dir="ltr" required autocomplete="email" maxlength="200"></div>
    <div v-if="phone" class="field"><label :for="`${idp}-phone`">رقم الجوال</label><input :id="`${idp}-phone`" v-model="modelValue.phone" class="input" type="tel" dir="ltr" placeholder="05xxxxxxxx" autocomplete="tel" maxlength="20"></div>
    <div v-else-if="orgTypes" class="field"><label :for="`${idp}-type`">نوع الجهة</label><select :id="`${idp}-type`" v-model="modelValue.orgType" class="input"><option v-for="t in orgTypes" :key="t">{{ t }}</option></select></div>
  </div>
  <div class="hp" aria-hidden="true"><label>اتركوا هذا الحقل فارغًا<input v-model="modelValue.website" tabindex="-1" autocomplete="off"></label></div>
</template>
