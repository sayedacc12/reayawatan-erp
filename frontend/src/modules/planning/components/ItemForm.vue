<script setup lang="ts">
import { computed, reactive } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { errMsg, FUNDING, money, RESOURCE_KINDS, TARGET_KINDS, type CustomField, type Item, type Lookups } from '../lib';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** نموذج إضافة عنصر أو تعديله: البيانات، المستهدفات، المعالم، الموارد، والتكلفة لكل سنة */
const props = defineProps<{ plan: any; item: Item | null; parentId: string | null; level: number; lookups: Lookups; customFields: CustomField[] }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', v: any): void }>();
const toast = useToast();
const src = props.item;
const years = computed(() => props.plan.periods as number[]);
const f = reactive({
  title: src?.title ?? '', description: src?.description ?? '', ownerUserId: src?.ownerUserId ?? '', ownerName: src?.ownerName ?? '',
  unitId: src?.unitId ?? (props.plan.kind === 'operational' ? props.plan.unitId ?? '' : ''), participantUnitIds: (src?.participants ?? []).map((p) => p.id),
  startDate: src?.startDate ?? '', endDate: src?.endDate ?? '', weight: src?.weight ?? 1,
  targets: JSON.parse(JSON.stringify(src?.targets ?? [])) as any[], milestones: JSON.parse(JSON.stringify(src?.milestones ?? [])) as any[],
  resources: JSON.parse(JSON.stringify(src?.resources ?? [])) as any[],
  costByYear: Object.fromEntries((props.plan.periods as number[]).map((y) => [String(y), src?.costByYear?.[String(y)] ?? 0])) as Record<string, number>,
  fundingType: src?.fundingType ?? '', costCenterId: src?.costCenterId ?? '', customValues: { ...(src?.customValues ?? {}) } as Record<string, any>,
});
const levelName = computed(() => props.plan.levels[props.level]?.name ?? 'عنصر');
const fields = computed(() => props.customFields.filter((c) => c.appliesTo === 'all' || c.appliesTo === props.plan.kind));
const total = computed(() => Object.values(f.costByYear).reduce((s, v) => s + (Number(v) || 0), 0));
const resCost = computed(() => f.resources.reduce((s, r) => s + (Number(r.cost) || 0), 0));
const isLeafish = computed(() => props.level >= props.plan.levels.length - 1 || !src?.hasChildren);
function ownerPick() {
  const u = props.lookups.users.find((x) => x.id === f.ownerUserId);
  if (u) f.ownerName = u.fullName;
}
function spreadResources() {
  const ys = years.value.filter((y) => !f.startDate || Number(f.startDate.slice(0, 4)) <= y).filter((y) => !f.endDate || Number(f.endDate.slice(0, 4)) >= y);
  const list = ys.length ? ys : years.value;
  for (const y of years.value) f.costByYear[String(y)] = 0;
  for (const y of list) f.costByYear[String(y)] = Math.round((resCost.value / list.length) * 100) / 100;
}
async function save() {
  const n = (v: any) => (v === '' || v === undefined ? null : v);
  const body = {
    ...(src ? {} : { parentId: props.parentId }),
    title: f.title, description: n(f.description), ownerUserId: n(f.ownerUserId), ownerName: n(f.ownerName), unitId: n(f.unitId), participantUnitIds: f.participantUnitIds,
    startDate: n(f.startDate), endDate: n(f.endDate), weight: Number(f.weight) || 0,
    targets: f.targets.map((t) => ({ ...t, value: t.value === '' || t.value === null ? null : Number(t.value), unit: n(t.unit), dueDate: n(t.dueDate) })),
    milestones: f.milestones.map((m) => ({ ...m, dueDate: n(m.dueDate), doneDate: n(m.doneDate) })),
    resources: f.resources.map((r) => ({ ...r, quantity: r.quantity === '' || r.quantity === null ? null : Number(r.quantity), cost: r.cost === '' || r.cost === null ? null : Number(r.cost), unit: n(r.unit) })),
    costByYear: Object.fromEntries(Object.entries(f.costByYear).map(([y, v]) => [y, Number(v) || 0])),
    fundingType: n(f.fundingType), costCenterId: n(f.costCenterId), customValues: f.customValues,
  };
  try {
    const res = src
      ? await api(`/planning/items/${src.id}`, { method: 'PATCH', json: body })
      : await api(`/planning/plans/${props.plan.id}/items`, { method: 'POST', json: body });
    toast.success(src ? 'حُفظ التعديل' : `أُضيف ${levelName.value}`);
    emit('saved', res);
  } catch (e) {
    toast.error(errMsg(e));
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <form class="card modal modal-wide" style="max-width: 900px" @submit.prevent="save">
      <h2>{{ src ? `${src.code} · تعديل ${levelName}` : `إضافة ${levelName}` }}</h2>
      <p v-if="plan.status === 'approved'" class="rk-warn">الخطة معتمدة. الحفظ يفتح مسودة تعديل، ويبقى الإصدار المعتمد محفوظًا حتى يُعتمد التعديل.</p>
      <label class="field"><span>العنوان</span><input v-model="f.title" class="input" required /></label>
      <label class="field"><span>الوصف</span><textarea v-model="f.description" class="input" rows="2" /></label>
      <div class="rk-fields">
        <label class="field"><span>المسؤول (من المستخدمين)</span>
          <select v-model="f.ownerUserId" class="input" @change="ownerPick"><option value="">—</option><option v-for="u in lookups.users" :key="u.id" :value="u.id">{{ u.fullName }}</option></select></label>
        <label class="field"><span>اسم المسؤول</span><input v-model="f.ownerName" class="input" placeholder="أو اكتب الاسم أو المسمى" /></label>
        <label class="field"><span>الإدارة المسؤولة</span>
          <select v-model="f.unitId" class="input"><option value="">—</option><option v-for="u in lookups.units" :key="u.id" :value="u.id">{{ '— '.repeat(u.level) }}{{ u.name }}</option></select></label>
        <label class="field"><span>الوزن النسبي</span><input v-model.number="f.weight" type="number" min="0" max="1000" step="0.1" class="input" /></label>
        <label class="field"><span>تاريخ البداية</span><input v-model="f.startDate" type="date" class="input" /></label>
        <label class="field"><span>تاريخ النهاية</span><input v-model="f.endDate" type="date" class="input" /></label>
      </div>
      <label class="field"><span>الإدارات المشاركة</span>
        <select v-model="f.participantUnitIds" multiple class="input" style="min-height: 70px"><option v-for="u in lookups.units" :key="u.id" :value="u.id">{{ u.name }}</option></select></label>

      <div class="rk-sec">المستهدفات <button type="button" class="btn btn-sm" @click="f.targets.push({ kind: 'quantitative', text: '', value: null, unit: '', dueDate: '' })">+ مستهدف</button></div>
      <div class="pl-mini-list">
        <div v-for="(t, i) in f.targets" :key="i">
          <select v-model="t.kind" class="input"><option v-for="(l, k) in TARGET_KINDS" :key="k" :value="k">{{ l }}</option></select>
          <input v-model="t.text" class="input" placeholder="نص المستهدف" style="grid-column: span 2" />
          <input v-model="t.value" type="number" step="any" class="input" placeholder="القيمة" />
          <input v-model="t.unit" class="input" placeholder="الوحدة" />
          <input v-model="t.dueDate" type="date" class="input" />
          <button type="button" class="btn btn-sm" @click="f.targets.splice(i, 1)">✕</button>
        </div>
      </div>

      <div class="rk-sec">المعالم الرئيسية <button type="button" class="btn btn-sm" @click="f.milestones.push({ title: '', dueDate: '', done: false })">+ معلم</button></div>
      <div class="pl-mini-list">
        <div v-for="(m, i) in f.milestones" :key="i">
          <input v-model="m.title" class="input" placeholder="عنوان المعلم" style="grid-column: span 2" />
          <input v-model="m.dueDate" type="date" class="input" />
          <label class="pl-flex"><input v-model="m.done" type="checkbox" /> أُنجز</label>
          <button type="button" class="btn btn-sm" @click="f.milestones.splice(i, 1)">✕</button>
        </div>
      </div>

      <div class="rk-sec">الموارد المطلوبة <button type="button" class="btn btn-sm" @click="f.resources.push({ kind: 'financial', name: '', quantity: null, unit: '', cost: null })">+ مورد</button></div>
      <div class="pl-mini-list">
        <div v-for="(r, i) in f.resources" :key="i">
          <select v-model="r.kind" class="input"><option v-for="(l, k) in RESOURCE_KINDS" :key="k" :value="k">{{ l }}</option></select>
          <input v-model="r.name" class="input" placeholder="المورد" style="grid-column: span 2" />
          <input v-model="r.quantity" type="number" min="0" step="any" class="input" placeholder="الكمية" />
          <input v-model="r.unit" class="input" placeholder="الوحدة" />
          <input v-model="r.cost" type="number" min="0" step="any" class="input" placeholder="التكلفة" />
          <button type="button" class="btn btn-sm" @click="f.resources.splice(i, 1)">✕</button>
        </div>
      </div>
      <p v-if="resCost" class="pm-muted">مجموع تكلفة الموارد {{ money(resCost) }} <button type="button" class="btn btn-sm" @click="spreadResources">توزيعها على سنوات التنفيذ</button></p>

      <div class="rk-sec">التكلفة التقديرية لكل سنة <span class="pm-muted">الإجمالي {{ money(total) }}</span></div>
      <p v-if="src?.hasChildren" class="pm-muted">تكلفة هذا العنصر تُجمع أيضًا من فروعه. اكتب هنا التكلفة الخاصة به فقط إن وجدت.</p>
      <div class="pl-years">
        <label v-for="y in years" :key="y" class="field"><span>{{ y }}</span><input v-model.number="f.costByYear[String(y)]" type="number" min="0" step="any" class="input" /></label>
      </div>
      <div class="rk-fields">
        <label class="field"><span>نوع التمويل</span><select v-model="f.fundingType" class="input"><option value="">—</option><option v-for="(l, k) in FUNDING" :key="k" :value="k">{{ l }}</option></select></label>
        <label class="field"><span>مركز التكلفة</span>
          <select v-model="f.costCenterId" class="input"><option value="">—</option><option v-for="c in lookups.costCenters" :key="c.id" :value="c.id">{{ c.code }} {{ c.name }}</option></select></label>
        <label v-for="c in fields" :key="c.key" class="field"><span>{{ c.label }}</span>
          <select v-if="c.type === 'select'" v-model="f.customValues[c.key]" class="input"><option :value="null">—</option><option v-for="o in c.options" :key="o" :value="o">{{ o }}</option></select>
          <input v-else v-model="f.customValues[c.key]" :type="c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'" class="input" /></label>
      </div>
      <p v-if="!isLeafish" class="pm-muted">نسبة الإنجاز تُحسب من الفروع تلقائيًا.</p>
      <div class="modal-actions">
        <button class="btn btn-primary">حفظ</button>
        <button type="button" class="btn" @click="emit('close')">إغلاق</button>
      </div>
    </form>
  </div>
</template>
