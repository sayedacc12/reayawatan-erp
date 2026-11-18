<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { addMonthsStr, lookups, today } from '../lib';

/** إنشاء مسودة عقد شراكة: تُبنى بنوده تلقائيًا من مكتبة البنود حسب نوع الشراكة */
const props = defineProps<{ partnerId?: string }>();
const emit = defineEmits<{ close: []; saved: [any] }>();
const toast = useToast();
const lk = ref<any>(null);
const picks = ref<any>({ partners: [], projects: [] });
const busy = ref(false);
const f = reactive({ partnerId: props.partnerId ?? '', typeId: '', title: '', startsOn: today(), endsOn: addMonthsStr(today(), 12), value: null as number | null, projectId: '', orgSignerName: '', orgSignerTitle: '' });
onMounted(async () => {
  try {
    [lk.value, picks.value] = await Promise.all([lookups(), api('/partnerships/picks')]);
    f.orgSignerName = lk.value.settings.signerName ?? '';
    f.orgSignerTitle = lk.value.settings.signerTitle ?? '';
    pickPartner();
  } catch (e) {
    toast.error((e as Error).message);
  }
});
const approved = computed(() => picks.value.partners.filter((p: any) => p.status === 'approved'));
function pickPartner() {
  const p = picks.value.partners.find((x: any) => x.id === f.partnerId);
  if (p && !f.typeId) f.typeId = p.typeIds[0] ?? '';
}
watch(() => f.typeId, (id) => {
  const t = lk.value?.types.find((x: any) => x.id === id);
  if (t) f.endsOn = addMonthsStr(f.startsOn, t.defaultMonths);
});
const clauseCount = ref<number | null>(null);
watch(() => f.typeId, async (id) => {
  if (!id) return;
  const all = await api<any[]>('/partnerships/clauses');
  clauseCount.value = all.filter((c) => c.isActive && (c.isDefault || c.isMandatory) && (!c.typeIds.length || c.typeIds.includes(id))).length;
});
async function save() {
  busy.value = true;
  try {
    const r = await api('/partnerships/contracts', { method: 'POST', json: { ...f, projectId: f.projectId || null, value: f.value || null } });
    toast.success('أُنشئت مسودة العقد من مكتبة البنود');
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
      <h2 style="margin-bottom: 4px">عقد شراكة جديد</h2>
      <p class="pm-muted" style="margin: 0 0 12px">تُنسخ البنود الأساسية من مكتبة البنود حسب نوع الشراكة، ثم تعدّلها لهذا العقد قبل رفعه للاعتماد.</p>
      <div v-if="lk" class="pt-fields">
        <div class="field"><label>الشريك المعتمد *</label>
          <select v-model="f.partnerId" class="input" required @change="pickPartner"><option value="">اختر الشريك</option><option v-for="p in approved" :key="p.id" :value="p.id">{{ p.name }}</option></select>
          <small v-if="!approved.length" class="pm-muted">لا يوجد شريك معتمد بعد. قيّم الشريك واعتمده أولًا.</small></div>
        <div class="field"><label>نوع الشراكة *</label>
          <select v-model="f.typeId" class="input" required><option value="">اختر النوع</option><option v-for="t in lk.types.filter((x: any) => x.isActive)" :key="t.id" :value="t.id">{{ t.name }}</option></select>
          <small v-if="clauseCount !== null" class="pm-muted">سيبدأ العقد بـ {{ clauseCount }} بندًا من المكتبة</small></div>
        <div class="field" style="grid-column: 1 / -1"><label>عنوان العقد (موضوع الشراكة) *</label><input v-model="f.title" class="input" required minlength="3" placeholder="مثل: دعم برنامج كفالة الأيتام 2027" /></div>
        <div class="field"><label>تاريخ البداية *</label><input v-model="f.startsOn" type="date" class="input" required /></div>
        <div class="field"><label>تاريخ النهاية *</label><input v-model="f.endsOn" type="date" class="input" required /></div>
        <div class="field"><label>قيمة الشراكة (ريال)</label><input v-model.number="f.value" type="number" min="0" step="0.01" class="input" placeholder="اتركه فارغًا إن لم توجد" /></div>
        <div class="field"><label>المشروع المرتبط</label>
          <select v-model="f.projectId" class="input"><option value="">بدون مشروع</option><option v-for="p in picks.projects" :key="p.id" :value="p.id">{{ p.name }}</option></select></div>
        <div class="field"><label>ممثل الجمعية في التوقيع</label><input v-model="f.orgSignerName" class="input" /></div>
        <div class="field"><label>صفته</label><input v-model="f.orgSignerTitle" class="input" /></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" :disabled="busy || !lk">إنشاء المسودة</button>
        <button type="button" class="btn" @click="emit('close')">إلغاء</button>
      </div>
    </form>
  </div>
</template>
