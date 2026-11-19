<script setup lang="ts">
/** نموذج إضافة أصل أو تعديله: بياناته ومجموعته والجهة المسؤولة وحقول المجموعة المرنة وعقود الصيانة وإعدادات الإهلاك الخاصة */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import SearchSelect from '../../fundraising/components/SearchSelect.vue';
import { AF, CONDITIONS, useLookups, type AssetDetail, type Maint } from '../assets';
import { todayStr } from '../lib';

const props = defineProps<{ asset?: AssetDetail | null }>();
const emit = defineEmits<{ saved: [AssetDetail]; close: [] }>();
const toast = useToast();
const { lookups, load } = useLookups();
onMounted(() => load().catch((e) => toast.error((e as Error).message)));

const a = props.asset;
const form = reactive({
  groupId: a?.groupId ?? '', name: a?.name ?? '', description: a?.description ?? '', serialNumber: a?.serialNumber ?? '', location: a?.location ?? '',
  unitId: a?.unitId ?? '', custodianEmployeeId: null as string | null, custodyDate: todayStr(), condition: 'جديد',
  fieldValues: { ...(a?.fieldValues ?? {}) } as Record<string, string | number | null>,
  maintenance: (a?.maintenance ?? []).map((m) => ({ ...m })) as Maint[],
  override: !!(a && (a.method || a.rate !== null || a.lifeYears !== null)), method: a?.method ?? '', rate: a?.rate ?? null as number | null,
  lifeYears: a?.lifeYears ?? null as number | null, salvageValue: a?.salvageValue ?? 0, analyticId: a?.analyticId ?? '',
});
const busy = ref(false);
const groups = computed(() => (lookups.value?.groups ?? []).filter((g) => g.isActive || g.id === form.groupId));
const group = computed(() => lookups.value?.groups.find((g) => g.id === form.groupId) ?? null);
const empOptions = computed(() => (lookups.value?.employees ?? []).filter((e) => e.status === 'active').map((e) => ({ id: e.id, label: e.fullName, sub: `رقم ${e.employeeNo}` })));
const needCustody = computed(() => !a && !!group.value?.isTangible && !!lookups.value?.config.requireCustody);
watch(() => form.custodianEmployeeId, (id) => {
  const e = lookups.value?.employees.find((x) => x.id === id);
  if (e?.unitId && !form.unitId) form.unitId = e.unitId;
});

async function save() {
  busy.value = true;
  const body: Record<string, unknown> = {
    groupId: form.groupId, name: form.name, description: form.description || null, serialNumber: form.serialNumber || null, location: form.location || null,
    unitId: form.unitId || null, fieldValues: form.fieldValues,
    maintenance: form.maintenance.filter((m) => m.provider.trim()).map((m) => ({ ...m, cost: m.cost === null || String(m.cost) === '' ? null : Number(m.cost) })),
    method: form.override ? form.method || null : null, rate: form.override && form.rate !== null && String(form.rate) !== '' ? Number(form.rate) : null,
    lifeYears: form.override && form.lifeYears !== null && String(form.lifeYears) !== '' ? Number(form.lifeYears) : null,
    salvageValue: Number(form.salvageValue || 0), analyticId: form.analyticId || null,
  };
  if (!a) Object.assign(body, { custodianEmployeeId: form.custodianEmployeeId, custodyDate: form.custodyDate, condition: form.condition });
  try {
    const r = a ? await api<AssetDetail>(`${AF}/${a.id}`, { method: 'PATCH', json: body }) : await api<AssetDetail>(AF, { method: 'POST', json: body });
    toast.success(a ? 'تم حفظ بيانات الأصل' : `سُجل الأصل برمز ${r.code}`);
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
    <form class="card modal modal-wide" @submit.prevent="save">
      <h2>{{ a ? `تعديل ${a.code}` : 'إضافة أصل' }}</h2>
      <div class="field-row">
        <label class="field"><span>مجموعة الأصل</span>
          <select v-model="form.groupId" class="input" required :disabled="!!a && a.cost > 0">
            <option value="" disabled>اختر المجموعة</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }} ({{ g.code }})</option>
          </select>
          <small v-if="group" class="pm-muted">{{ group.depreciable ? `${group.methodLabel}${group.rate ? ` · ${group.rate}%` : ''}${group.lifeYears ? ` · ${group.lifeYears} سنة` : ''}` : 'لا تُهلك' }} · حساب الأصل {{ group.assetAccount?.code }}</small>
        </label>
        <label class="field"><span>اسم الأصل</span><input v-model="form.name" class="input" required /></label>
      </div>
      <div class="field-row">
        <label class="field"><span>الرقم التسلسلي (من المصنع)</span><input v-model="form.serialNumber" class="input ac-code" /></label>
        <label class="field"><span>الموقع</span><input v-model="form.location" class="input" placeholder="المقر - الدور الأول" /></label>
        <label class="field"><span>الإدارة المسؤولة</span>
          <select v-model="form.unitId" class="input"><option value="">—</option><option v-for="u in lookups?.units ?? []" :key="u.id" :value="u.id">{{ u.name }}</option></select>
        </label>
      </div>
      <label class="field"><span>الوصف</span><textarea v-model="form.description" class="input" rows="2" /></label>

      <template v-if="!a">
        <h3 class="sec">الموظف المستلم (العهدة)</h3>
        <div class="field-row">
          <label class="field"><span>الموظف {{ needCustody ? '' : '(اختياري)' }}</span><SearchSelect v-model="form.custodianEmployeeId" :options="empOptions" placeholder="ابحث باسم الموظف" :required="needCustody" /></label>
          <label class="field"><span>تاريخ الاستلام</span><input v-model="form.custodyDate" type="date" class="input" /></label>
          <label class="field"><span>حالة الأصل عند الاستلام</span><select v-model="form.condition" class="input"><option v-for="c in CONDITIONS" :key="c">{{ c }}</option></select></label>
        </div>
        <p v-if="needCustody" class="fa-info">الأصول المادية يجب أن تكون في عهدة موظف. يصدر نموذج تسليم عهدة تلقائيًا، ويؤكد الموظف استلامه.</p>
      </template>

      <template v-if="group?.fields.length">
        <h3 class="sec">بيانات خاصة بمجموعة {{ group.name }}</h3>
        <div class="field-row">
          <label v-for="f in group.fields" :key="f.key" class="field"><span>{{ f.label }}{{ f.required ? ' *' : '' }}{{ f.expiry ? ' ⏰' : '' }}</span>
            <select v-if="f.type === 'select'" v-model="form.fieldValues[f.key]" class="input" :required="f.required"><option :value="null">—</option><option v-for="o in f.options" :key="o" :value="o">{{ o }}</option></select>
            <input v-else v-model="form.fieldValues[f.key]" :type="f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'" class="input" :required="f.required" step="any" />
          </label>
        </div>
      </template>

      <h3 class="sec">عقود الصيانة</h3>
      <div class="fa-rows">
        <div v-for="(m, i) in form.maintenance" :key="i" class="fa-row">
          <input v-model="m.provider" class="input" placeholder="الجهة المنفذة" required />
          <label class="pm-muted">من <input v-model="m.startDate" type="date" class="input" required /></label>
          <label class="pm-muted">إلى <input v-model="m.endDate" type="date" class="input" required /></label>
          <input v-model.number="m.cost" type="number" min="0" step="0.01" class="input" placeholder="التكلفة" style="flex: 0 0 110px" />
          <button type="button" class="btn btn-sm" @click="form.maintenance.splice(i, 1)">✕</button>
        </div>
        <button type="button" class="btn btn-sm" style="align-self: flex-start" @click="form.maintenance.push({ provider: '', startDate: todayStr(), endDate: '', cost: null })">+ عقد صيانة</button>
      </div>

      <h3 class="sec">الإهلاك</h3>
      <div class="field-row">
        <label class="field"><span>القيمة التخريدية (ريال)</span><input v-model.number="form.salvageValue" type="number" min="0" step="0.01" class="input" /></label>
        <label class="field"><span>مركز التكلفة</span>
          <select v-model="form.analyticId" class="input"><option value="">{{ group?.analytic ? `مركز المجموعة: ${group.analytic.name}` : '—' }}</option><option v-for="c in lookups?.analytic ?? []" :key="c.id" :value="c.id">{{ c.code }} {{ c.name }}</option></select>
        </label>
      </div>
      <label class="fa-check"><input v-model="form.override" type="checkbox" /> طريقة أو نسبة خاصة بهذا الأصل (بدلًا من إعدادات المجموعة)</label>
      <div v-if="form.override" class="field-row">
        <label class="field"><span>الطريقة</span><select v-model="form.method" class="input"><option value="">طريقة المجموعة</option><option v-for="m in lookups?.methods ?? []" :key="m.value" :value="m.value">{{ m.label }}</option></select></label>
        <label class="field"><span>النسبة %</span><input v-model.number="form.rate" type="number" min="0" max="100" step="0.01" class="input" /></label>
        <label class="field"><span>العمر الإنتاجي (سنوات)</span><input v-model.number="form.lifeYears" type="number" min="1" max="100" step="0.5" class="input" /></label>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ</button><button type="button" class="btn" @click="emit('close')">إلغاء</button></div>
    </form>
  </div>
</template>

<style scoped>
.sec { font-size: .92rem; margin: 14px 0 8px; padding-top: 10px; border-top: 1px dashed var(--border); }
</style>
