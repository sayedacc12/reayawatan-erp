<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { loadLookups, thisYear, unitOptions, type Lookups, type Plan, type RiskRef } from '../lib';
import RiskPicker from './RiskPicker.vue';

/** إنشاء خطة رئيسية أو فرعية أو تعديلها */
const props = defineProps<{ initial?: Plan | null; masters: { id: string; code: string; title: string; year: number; periodFrom: string; periodTo: string }[]; kind?: 'master' | 'sub'; parentId?: string; year?: number }>();
const emit = defineEmits<{ close: []; saved: [id: string] }>();
const toast = useToast();
const lookups = ref<Lookups | null>(null);
const units = computed(() => unitOptions(lookups.value));
const i = props.initial;
const y = i?.year ?? props.year ?? thisYear();
const form = reactive({
  kind: (i?.kind ?? props.kind ?? 'master') as 'master' | 'sub', parentId: i?.parentId ?? props.parentId ?? props.masters[0]?.id ?? '', year: y, title: i?.title ?? '',
  scopeType: (i?.scopeType ?? (props.kind === 'sub' ? 'unit' : 'org')) as 'org' | 'unit' | 'outside', unitId: i?.unitId ?? '', outsideLabel: i?.outsideLabel ?? '',
  periodFrom: i?.periodFrom ?? `${y}-01-01`, periodTo: i?.periodTo ?? `${y}-12-31`, objectives: i?.objectives ?? '', methodology: i?.methodology ?? '',
  availableHours: i?.availableHours ?? 0, riskRefs: (i?.riskRefs ?? []).map((r) => ({ id: r.id, code: r.code, title: r.title, level: r.level, score: r.score })) as RiskRef[],
});
onMounted(async () => {
  lookups.value = await loadLookups().catch(() => null);
});
function setKind(k: 'master' | 'sub') {
  form.kind = k;
  if (k === 'sub' && form.scopeType === 'org') form.scopeType = 'unit';
  if (k === 'master') form.scopeType = 'org';
  syncParent();
}
function syncParent() {
  const m = props.masters.find((x) => x.id === form.parentId);
  if (form.kind === 'sub' && m) Object.assign(form, { year: m.year, periodFrom: m.periodFrom, periodTo: m.periodTo });
}
async function save() {
  try {
    const body = {
      ...form, parentId: form.kind === 'sub' ? form.parentId : null, unitId: form.scopeType === 'unit' ? form.unitId || null : null,
      outsideLabel: form.scopeType === 'outside' ? form.outsideLabel : null, objectives: form.objectives || null, methodology: form.methodology || null,
      availableHours: Number(form.availableHours), year: Number(form.year),
    };
    const r = i ? await api<{ id: string }>(`/audit/plans/${i.id}`, { method: 'PATCH', json: body }) : await api<{ id: string }>('/audit/plans', { method: 'POST', json: body });
    toast.success('حُفظت الخطة');
    emit('saved', r.id);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <form class="card modal modal-wide" @submit.prevent="save">
      <h2>{{ i ? 'تعديل الخطة' : 'خطة مراجعة جديدة' }}</h2>
      <div v-if="!i" class="au-seg" style="margin-bottom: 14px">
        <button type="button" :class="{ on: form.kind === 'master' }" @click="setKind('master')">خطة رئيسية سنوية</button>
        <button type="button" :class="{ on: form.kind === 'sub' }" :disabled="!masters.length" @click="setKind('sub')">خطة فرعية</button>
      </div>
      <label v-if="form.kind === 'sub'" class="field"><span>تتبع الخطة الرئيسية</span>
        <select v-model="form.parentId" class="input" required @change="syncParent"><option v-for="m in masters" :key="m.id" :value="m.id">{{ m.code }} · {{ m.title }}</option></select>
      </label>
      <label class="field"><span>عنوان الخطة</span><input v-model="form.title" class="input" required /></label>
      <div v-if="form.kind === 'sub'" class="field"><span>نطاق الخطة الفرعية</span>
        <div style="display: flex; gap: 8px; flex-wrap: wrap">
          <div class="au-seg"><button type="button" :class="{ on: form.scopeType === 'unit' }" @click="form.scopeType = 'unit'">وحدة من الهيكل</button><button type="button" :class="{ on: form.scopeType === 'outside' }" @click="form.scopeType = 'outside'">خارج الهيكل</button></div>
          <select v-if="form.scopeType === 'unit'" v-model="form.unitId" class="input" style="flex: 1; min-width: 200px" required><option value="" disabled>اختر الوحدة</option><option v-for="u in units" :key="u.id" :value="u.id">{{ u.label }}</option></select>
          <input v-else v-model="form.outsideLabel" class="input" style="flex: 1; min-width: 200px" placeholder="مثل: الشركاء المنفذون، الفروع، الموردون" required />
        </div>
      </div>
      <div class="pm-grid2">
        <label class="field"><span>السنة</span><input v-model.number="form.year" type="number" class="input" :disabled="form.kind === 'sub'" /></label>
        <label class="field"><span>الساعات المتاحة للمراجعة</span><input v-model.number="form.availableHours" type="number" min="0" class="input" /></label>
        <label class="field"><span>من</span><input v-model="form.periodFrom" type="date" class="input" required /></label>
        <label class="field"><span>إلى</span><input v-model="form.periodTo" type="date" class="input" required /></label>
      </div>
      <label class="field"><span>الأهداف</span><textarea v-model="form.objectives" class="input" rows="2" /></label>
      <label class="field"><span>المنهجية والمعايير</span><textarea v-model="form.methodology" class="input" rows="2" placeholder="مثل: منهجية مبنية على المخاطر وفق المعايير الدولية لممارسة المراجعة الداخلية" /></label>
      <p class="au-sec">المخاطر التي تستهدفها الخطة</p>
      <RiskPicker v-model="form.riskRefs" :lookups="lookups" :unit-id="form.scopeType === 'unit' ? form.unitId : null" />
      <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="emit('close')">إلغاء</button></div>
    </form>
  </div>
</template>
