<script setup lang="ts">
import { reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import type { Donor, Settings } from '../types';
import SupportManagerPicker, { type ManagerRef } from './SupportManagerPicker.vue';

/** نموذج إضافة وتعديل داعم: الحقول الأساسية + الحقول المرنة من الإعدادات */
const props = defineProps<{ settings: Settings; donor?: Donor | null }>();
const emit = defineEmits<{ close: []; saved: [Donor] }>();
const toast = useToast();
const d = props.donor;
const form = reactive({
  name: d?.name ?? '', type: d?.type ?? 'individual', identifier: d?.identifier ?? '', phone: d?.phone ?? '', email: d?.email ?? '',
  city: d?.city ?? '', levelId: d?.levelId ?? null, supportManagerId: d?.supportManagerId ?? null, notes: d?.notes ?? '', isActive: d?.isActive ?? true,
  customData: { ...(d?.customData ?? {}) } as Record<string, any>,
});
const cur = props.settings.managers.find((m) => m.id === d?.supportManagerId);
const manager = ref<ManagerRef | null>(cur ? { kind: cur.kind, userId: cur.userId ?? null, name: cur.name } : null);
const externalNames = props.settings.managers.filter((m) => m.kind === 'external' && m.isActive).map((m) => m.name);
const fields = props.settings.donorFields.filter((f) => f.isActive);
const saving = ref(false);
const error = ref('');

async function save() {
  saving.value = true;
  error.value = '';
  const nul = (v: string) => v.trim() || null;
  try {
    const body = {
      ...form, identifier: form.type === 'individual' ? null : nul(form.identifier), supportManagerId: null,
      supportManager: manager.value ? { kind: manager.value.kind, userId: manager.value.userId, name: manager.value.name.trim() } : null, phone: nul(form.phone), email: nul(form.email), city: nul(form.city), notes: nul(form.notes),
    };
    const saved = await api<Donor>(d ? `/fundraising/donors/${d.id}` : '/fundraising/donors', { method: d ? 'PUT' : 'POST', json: body });
    toast.success(d ? 'تم حفظ بيانات الداعم' : `تم تسجيل الداعم برقم ${saved.donorNo}`);
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
    <form class="card modal modal-wide" @submit.prevent="save">
      <h2>{{ d ? `تعديل بيانات الداعم رقم ${d.donorNo}` : 'داعم جديد' }}</h2>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <div class="grid2">
        <div class="field span2"><label>اسم الداعم *</label><input v-model="form.name" class="input" required /></div>
        <div class="field"><label>النوع</label>
          <div class="fr-pills">
            <button type="button" :class="['fr-pill', { on: form.type === 'individual' }]" @click="form.type = 'individual'">فرد</button>
            <button type="button" :class="['fr-pill', { on: form.type === 'entity' }]" @click="form.type = 'entity'">جهة (شركة، مؤسسة، جهة حكومية)</button>
          </div></div>
        <div v-if="form.type === 'entity'" class="field"><label>رقم السجل التجاري أو الرقم الموحد</label><input v-model="form.identifier" class="input" dir="ltr" /></div>
        <div class="field"><label>الجوال</label><input v-model="form.phone" class="input" dir="ltr" placeholder="05xxxxxxxx" /></div>
        <div class="field"><label>البريد الإلكتروني</label><input v-model="form.email" class="input" dir="ltr" /></div>
        <div class="field"><label>المدينة</label><input v-model="form.city" class="input" /></div>
        <div class="field"><label>المستوى</label>
          <select v-model="form.levelId" class="input"><option :value="null">—</option><option v-for="l in settings.levels" :key="l.id" :value="l.id">{{ l.name }}</option></select></div>
        <div class="field span2"><label>مدير الدعم</label><SupportManagerPicker v-model="manager" :external-names="externalNames" /></div>
        <template v-for="f in fields" :key="f.key">
          <div :class="['field', { span2: f.type === 'textarea' }]">
            <label>{{ f.label }}{{ f.required ? ' *' : '' }}</label>
            <textarea v-if="f.type === 'textarea'" v-model="form.customData[f.key]" class="input" rows="2" />
            <select v-else-if="f.type === 'select'" v-model="form.customData[f.key]" class="input"><option :value="undefined">—</option><option v-for="o in f.options" :key="o" :value="o">{{ o }}</option></select>
            <label v-else-if="f.type === 'checkbox'" class="check"><input v-model="form.customData[f.key]" type="checkbox" /> نعم</label>
            <div v-else-if="f.type === 'percent'" class="pct"><input v-model.number="form.customData[f.key]" type="number" :min="f.min ?? 0" :max="f.max ?? 100" step="0.01" class="input" /><span>%</span></div>
            <input v-else-if="f.type === 'number'" v-model.number="form.customData[f.key]" type="number" :min="f.min ?? undefined" :max="f.max ?? undefined" class="input" />
            <input v-else-if="f.type === 'date'" v-model="form.customData[f.key]" type="date" class="input" />
            <input v-else v-model="form.customData[f.key]" class="input" :dir="f.type === 'mobile' || f.type === 'email' ? 'ltr' : undefined" :placeholder="f.type === 'mobile' ? '05xxxxxxxx' : ''" />
          </div>
        </template>
        <div class="field span2"><label>ملاحظات</label><textarea v-model="form.notes" class="input" rows="2" /></div>
      </div>
      <label class="check"><input v-model="form.isActive" type="checkbox" /> داعم نشط</label>
      <div class="modal-actions">
        <button class="btn btn-primary" :disabled="saving">{{ saving ? 'جارٍ الحفظ...' : 'حفظ' }}</button>
        <button type="button" class="btn" @click="emit('close')">إلغاء</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
.span2 { grid-column: span 2; }
.pct { display: flex; align-items: center; gap: 6px; }
@media (max-width: 600px) { .grid2 { grid-template-columns: 1fr; } .span2 { grid-column: auto; } }
</style>
