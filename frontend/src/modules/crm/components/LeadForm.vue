<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, ref } from 'vue';
import { api, ApiError } from '../../../api';
import { useToast } from '../../../stores/toast';

/** إضافة عميل محتمل أو تعديل بياناته. عند وجود سجل بالجوال أو البريد نفسه يظهر التنبيه، ولا يُحفظ إلا بتأكيد */
const props = defineProps<{ lk: any; lead?: any }>();
const emit = defineEmits<{ (e: 'saved', v: { id: string }): void; (e: 'close'): void }>();
const toast = useToast();
const busy = ref(false);
const dupMsg = ref('');
const l = props.lead;
const f = ref({
  name: l?.name ?? '', company: l?.company ?? '', title: l?.title ?? '', phone: l?.phone ?? '', email: l?.email ?? '', city: l?.city ?? '',
  interest: l?.interest ?? '', source: l?.source ?? 'manual', campaign: l?.campaign ?? '', message: l?.message ?? '', ownerId: '',
});
const active = (list: any[]) => list.filter((i) => i.isActive || i.key === f.value.source || i.key === f.value.interest);
const sources = computed(() => active(props.lk.settings.sources));
const interests = computed(() => active(props.lk.settings.interests));
const canAssign = props.lk.can.assign;

async function save(allowDuplicate = false) {
  busy.value = true;
  try {
    const x = f.value;
    const json: any = {
      name: x.name, company: x.company || null, title: x.title || null, phone: x.phone || null, email: x.email || null, city: x.city || null,
      interest: x.interest || null, source: x.source, campaign: x.campaign || null, message: x.message || null,
    };
    if (l) {
      await api(`/crm/leads/${l.id}`, { method: 'PUT', json });
      toast.success('حُفظت التعديلات');
      emit('saved', { id: l.id });
    } else {
      const r = await api<{ id: string; code: string }>('/crm/leads', { method: 'POST', json: { ...json, ownerId: x.ownerId || null, allowDuplicate } });
      toast.success(`أُضيف العميل المحتمل ${r.code}`);
      emit('saved', r);
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) dupMsg.value = e.message;
    else toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <form class="card modal cr-modal" @submit.prevent="save(false)">
      <h2>{{ lead ? 'تعديل بيانات العميل المحتمل' : 'عميل محتمل جديد' }}</h2>
      <div class="cr-fields">
        <label class="field"><span>الاسم</span><input v-model="f.name" class="input" maxlength="200" required /></label>
        <label class="field"><span>المنشأة (إن وُجدت)</span><input v-model="f.company" class="input" maxlength="250" /></label>
        <label class="field"><span>المسمى الوظيفي</span><input v-model="f.title" class="input" maxlength="150" /></label>
        <label class="field"><span>الجوال</span><input v-model="f.phone" class="input" maxlength="20" dir="ltr" placeholder="05xxxxxxxx" @input="dupMsg = ''" /></label>
        <label class="field"><span>البريد الإلكتروني</span><input v-model="f.email" type="email" class="input" maxlength="200" dir="ltr" @input="dupMsg = ''" /></label>
        <label class="field"><span>المدينة</span><input v-model="f.city" class="input" maxlength="100" /></label>
        <label class="field"><span>المصدر</span><select v-model="f.source" class="input" required><option v-for="s in sources" :key="s.key" :value="s.key">{{ s.label }}</option></select></label>
        <label class="field"><span>الاهتمام</span><select v-model="f.interest" class="input"><option value="">—</option><option v-for="s in interests" :key="s.key" :value="s.key">{{ s.label }}</option></select></label>
        <label class="field"><span>الحملة أو المناسبة</span><input v-model="f.campaign" class="input" maxlength="200" placeholder="مثل: معرض الرياض 2026" /></label>
        <label v-if="!lead && canAssign" class="field"><span>المسؤول</span>
          <select v-model="f.ownerId" class="input">
            <option value="">{{ lk.settings.assignMode === 'round_robin' ? 'بالتناوب آليًا' : 'بدون إسناد الآن' }}</option>
            <option v-for="u in lk.users" :key="u.id" :value="u.id">{{ u.fullName }}</option>
          </select>
        </label>
      </div>
      <label class="field"><span>رسالته أو ملاحظات أولية</span><textarea v-model="f.message" class="input" rows="2" maxlength="4000" /></label>
      <div v-if="dupMsg" class="cr-warn">
        {{ dupMsg }}
        <div style="margin-top: 8px"><button type="button" class="btn btn-sm" :disabled="busy" @click="save(true)">أؤكد أنه عميل محتمل جديد</button></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" @click="emit('close')">إلغاء</button>
        <button class="btn btn-primary" :disabled="busy">حفظ</button>
      </div>
    </form>
  </div>
</template>
