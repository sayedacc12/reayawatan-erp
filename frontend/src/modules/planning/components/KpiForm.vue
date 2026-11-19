<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { AGGREGATION, DIRECTION, errMsg, PERIODICITY, periodLabel, periodsOf, type Item } from '../lib';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** تعريف مؤشر أداء: الوحدة والاتجاه والدورية وخط الأساس والمستهدف لكل سنة أو لكل فترة */
const props = defineProps<{ plan: any; kpi: any | null; items: Item[]; units: string[]; itemId?: string | null }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', v: any): void }>();
const toast = useToast();
const k = props.kpi;
const years = props.plan.periods as number[];
const f = reactive({
  name: k?.name ?? '', description: k?.description ?? '', itemId: k?.itemId ?? props.itemId ?? '', unit: k?.unit ?? props.units[0] ?? '٪',
  direction: k?.direction ?? 'up', frequency: k?.frequency ?? 'annual', aggregation: k?.aggregation ?? 'last', baseline: k?.baseline ?? null,
  weight: k?.weight ?? 1, ownerName: k?.ownerName ?? '', dataSource: k?.dataSource ?? '',
  targets: { ...(k?.targets ?? {}) } as Record<string, number | null>,
});
const detailed = ref(Object.keys(f.targets).some((p) => p.length > 4));
const final = ref<number | null>(null);
const keys = computed(() => (detailed.value && f.frequency !== 'annual' ? years.flatMap((y) => periodsOf(y, f.frequency)) : years.map(String)));
const itemsSorted = computed(() => [...props.items].sort((a, b) => a.code.localeCompare(b.code)));
function spread() {
  if (final.value === null) return;
  const b = f.baseline === null || f.baseline === ('' as any) ? null : Number(f.baseline);
  years.forEach((y, i) => { f.targets[String(y)] = b === null ? final.value : Math.round((b + ((final.value! - b) * (i + 1)) / years.length) * 100) / 100; });
  detailed.value = false;
}
async function save() {
  const targets = Object.fromEntries(keys.value.filter((p) => f.targets[p] !== null && f.targets[p] !== undefined && (f.targets[p] as any) !== '').map((p) => [p, Number(f.targets[p])]));
  const n = (v: any) => (v === '' || v === undefined ? null : v);
  const body = { ...f, itemId: n(f.itemId), baseline: f.baseline === null || (f.baseline as any) === '' ? null : Number(f.baseline), ownerName: n(f.ownerName), dataSource: n(f.dataSource), description: n(f.description), targets };
  try {
    const res = k ? await api(`/planning/kpis/${k.id}`, { method: 'PATCH', json: body }) : await api(`/planning/plans/${props.plan.id}/kpis`, { method: 'POST', json: body });
    toast.success(k ? 'حُفظ المؤشر' : 'أُضيف المؤشر');
    emit('saved', res);
  } catch (e) {
    toast.error(errMsg(e));
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <form class="card modal modal-wide" @submit.prevent="save">
      <h2>{{ k ? `${k.code} · تعديل المؤشر` : 'مؤشر أداء جديد' }}</h2>
      <label class="field"><span>اسم المؤشر</span><input v-model="f.name" class="input" required placeholder="مثل: نسبة رضا المستفيدين عن الخدمات" /></label>
      <label class="field"><span>طريقة الحساب والوصف</span><textarea v-model="f.description" class="input" rows="2" /></label>
      <div class="rk-fields">
        <label class="field"><span>يقيس العنصر</span><select v-model="f.itemId" class="input"><option value="">الخطة كلها</option><option v-for="i in itemsSorted" :key="i.id" :value="i.id">{{ i.code }} {{ i.title }}</option></select></label>
        <label class="field"><span>وحدة القياس</span><select v-model="f.unit" class="input"><option v-for="u in units" :key="u" :value="u">{{ u }}</option></select></label>
        <label class="field"><span>الاتجاه</span><select v-model="f.direction" class="input"><option v-for="(l, x) in DIRECTION" :key="x" :value="x">{{ l }}</option></select></label>
        <label class="field"><span>دورية القياس</span><select v-model="f.frequency" class="input"><option v-for="(l, x) in PERIODICITY" :key="x" :value="x">{{ l }}</option></select></label>
        <label class="field"><span>تجميع قراءات السنة</span><select v-model="f.aggregation" class="input"><option v-for="(l, x) in AGGREGATION" :key="x" :value="x">{{ l }}</option></select></label>
        <label class="field"><span>خط الأساس</span><input v-model="f.baseline" type="number" step="any" class="input" /></label>
        <label class="field"><span>الوزن</span><input v-model.number="f.weight" type="number" min="0" step="0.1" class="input" /></label>
        <label class="field"><span>مسؤول القياس</span><input v-model="f.ownerName" class="input" /></label>
        <label class="field"><span>مصدر البيانات</span><input v-model="f.dataSource" class="input" placeholder="مثل: استبانة رضا نصف سنوية" /></label>
      </div>
      <div class="rk-sec">المستهدفات</div>
      <div class="pl-flex" style="margin-bottom: 8px">
        <span class="pm-muted">المستهدف النهائي</span><input v-model.number="final" type="number" step="any" class="input" style="width: 120px" />
        <button type="button" class="btn btn-sm" @click="spread">توزيع متدرج من خط الأساس</button>
        <label v-if="f.frequency !== 'annual'" class="pl-flex" style="margin-inline-start: auto"><input v-model="detailed" type="checkbox" /> مستهدف لكل {{ PERIODICITY[f.frequency] === 'شهرية' ? 'شهر' : 'فترة' }}</label>
      </div>
      <div class="pl-years">
        <label v-for="p in keys" :key="p" class="field"><span>{{ periodLabel(p) }}</span><input v-model="f.targets[p]" type="number" step="any" class="input" /></label>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary">حفظ</button>
        <button type="button" class="btn" @click="emit('close')">إغلاق</button>
      </div>
    </form>
  </div>
</template>
