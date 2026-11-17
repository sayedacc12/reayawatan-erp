<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { LEVELS, loadLookups, todayStr, addDays, unitOptions, type Area, type Lookups, type RiskRef } from '../lib';
import RiskPicker from './RiskPicker.vue';

/** إنشاء مهمة مراجعة أو تعديلها وتوزيعها على الفريق */
interface PlanOpt { id: string; code: string; title: string; periodFrom: string; periodTo: string }
interface Initial {
  id: string; planId: string; areaId: string | null; title: string; objective: string | null; scope: string | null; scopeType: string; unitId: string | null;
  outsideLabel: string | null; priority: string; plannedStart: string; plannedEnd: string; budgetHours: number; leadUserId: string | null;
  team: { userId: string; role: string }[]; riskRefs: RiskRef[];
}
const props = defineProps<{ plans: PlanOpt[]; initial?: Initial | null; planId?: string }>();
const emit = defineEmits<{ close: []; saved: [id: string] }>();
const toast = useToast();
const lookups = ref<Lookups | null>(null);
const areas = ref<Area[]>([]);
const units = computed(() => unitOptions(lookups.value));
const i = props.initial;
const firstPlan = props.plans.find((p) => p.id === props.planId) ?? props.plans[0];
const start0 = firstPlan ? (todayStr() > firstPlan.periodFrom && todayStr() < firstPlan.periodTo ? todayStr() : firstPlan.periodFrom) : todayStr();
const form = reactive({
  planId: i?.planId ?? firstPlan?.id ?? '', areaId: i?.areaId ?? '', title: i?.title ?? '', objective: i?.objective ?? '', scope: i?.scope ?? '',
  scopeType: (i?.scopeType ?? 'unit') as 'unit' | 'outside', unitId: i?.unitId ?? '', outsideLabel: i?.outsideLabel ?? '', priority: i?.priority ?? 'medium',
  plannedStart: i?.plannedStart ?? start0, plannedEnd: i?.plannedEnd ?? addDays(start0, 21), budgetHours: i?.budgetHours ?? 40, leadUserId: i?.leadUserId ?? '',
  team: (i?.team ?? []).map((t) => ({ userId: t.userId, role: t.role })), riskRefs: [...(i?.riskRefs ?? [])] as RiskRef[],
});
const saving = ref(false);
onMounted(async () => {
  [lookups.value, areas.value] = await Promise.all([loadLookups(), api<Area[]>('/audit/areas').catch(() => [])]);
});
function pickArea() {
  const a = areas.value.find((x) => x.id === form.areaId);
  if (!a) return;
  if (!form.title) form.title = `مراجعة ${a.name}`;
  form.scopeType = a.scopeType;
  form.unitId = a.unitId ?? '';
  form.outsideLabel = a.outsideLabel ?? '';
  form.priority = a.level;
  if (!form.riskRefs.length) form.riskRefs = a.riskRefs.map((r) => ({ id: r.id, code: r.code, title: r.title, level: r.level, score: r.score }));
}
async function save() {
  saving.value = true;
  try {
    const body = {
      ...form, areaId: form.areaId || null, unitId: form.scopeType === 'unit' ? form.unitId || null : null, outsideLabel: form.scopeType === 'outside' ? form.outsideLabel : null,
      leadUserId: form.leadUserId || null, objective: form.objective || null, scope: form.scope || null, budgetHours: Number(form.budgetHours),
      team: form.team.filter((t) => t.userId), riskRefs: form.riskRefs.map((r) => ({ id: r.id, code: r.code, title: r.title, level: r.level, score: r.score })),
    };
    const r = i ? await api<{ id: string }>(`/audit/engagements/${i.id}`, { method: 'PATCH', json: body }) : await api<{ id: string }>('/audit/engagements', { method: 'POST', json: body });
    toast.success(i ? 'حُفظت المهمة' : 'أُنشئت مهمة المراجعة');
    emit('saved', r.id);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <form class="card modal" style="max-width: 760px" @submit.prevent="save">
      <h2>{{ i ? 'تعديل مهمة المراجعة وتوزيعها' : 'مهمة مراجعة جديدة' }}</h2>
      <div class="pm-grid2">
        <label class="field"><span>الخطة</span>
          <select v-model="form.planId" class="input" required><option v-for="p in plans" :key="p.id" :value="p.id">{{ p.code }} · {{ p.title }}</option></select>
        </label>
        <label class="field"><span>مجال المراجعة (من تقييم المخاطر)</span>
          <select v-model="form.areaId" class="input" @change="pickArea"><option value="">بدون مجال</option><option v-for="a in areas.filter((x) => x.isActive)" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }} ({{ a.levelLabel }})</option></select>
        </label>
      </div>
      <label class="field"><span>عنوان المهمة</span><input v-model="form.title" class="input" required /></label>
      <div class="pm-grid2">
        <label class="field"><span>الهدف</span><textarea v-model="form.objective" class="input" rows="2" /></label>
        <label class="field"><span>النطاق</span><textarea v-model="form.scope" class="input" rows="2" /></label>
      </div>
      <div class="field"><span>الجهة محل المراجعة</span>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
          <div class="au-seg"><button type="button" :class="{ on: form.scopeType === 'unit' }" @click="form.scopeType = 'unit'">من الهيكل التنظيمي</button><button type="button" :class="{ on: form.scopeType === 'outside' }" @click="form.scopeType = 'outside'">خارج الهيكل</button></div>
          <select v-if="form.scopeType === 'unit'" v-model="form.unitId" class="input" style="flex: 1; min-width: 200px" required><option value="" disabled>اختر الوحدة</option><option v-for="u in units" :key="u.id" :value="u.id">{{ u.label }}</option></select>
          <input v-else v-model="form.outsideLabel" class="input" style="flex: 1; min-width: 200px" placeholder="مثل: الشركاء المنفذون، مورد خارجي، فرع" required />
        </div>
      </div>
      <div class="pm-grid2">
        <label class="field"><span>الأولوية</span><select v-model="form.priority" class="input"><option v-for="l in LEVELS" :key="l.value" :value="l.value">{{ l.label }}</option></select></label>
        <label class="field"><span>الساعات المقدرة</span><input v-model.number="form.budgetHours" type="number" min="0" class="input" /></label>
        <label class="field"><span>البداية المخططة</span><input v-model="form.plannedStart" type="date" class="input" required /></label>
        <label class="field"><span>النهاية المخططة</span><input v-model="form.plannedEnd" type="date" class="input" required /></label>
      </div>
      <p class="au-sec">توزيع المهمة</p>
      <label class="field"><span>قائد المهمة</span>
        <select v-model="form.leadUserId" class="input"><option value="">لم يُحدد بعد</option><option v-for="u in lookups?.users ?? []" :key="u.id" :value="u.id">{{ u.fullName }}</option></select>
      </label>
      <div v-for="(t, k) in form.team" :key="k" style="display: flex; gap: 6px; margin-bottom: 6px">
        <select v-model="t.userId" class="input"><option value="" disabled>عضو الفريق</option><option v-for="u in lookups?.users ?? []" :key="u.id" :value="u.id">{{ u.fullName }}</option></select>
        <input v-model="t.role" class="input" style="max-width: 180px" placeholder="الدور" />
        <button type="button" class="btn btn-sm" @click="form.team.splice(k, 1)">✕</button>
      </div>
      <button type="button" class="btn btn-sm" @click="form.team.push({ userId: '', role: 'مراجع' })">+ عضو في الفريق</button>
      <p class="au-sec">المخاطر المرتبطة من سجل المخاطر</p>
      <RiskPicker v-model="form.riskRefs" :lookups="lookups" :unit-id="form.scopeType === 'unit' ? form.unitId : null" />
      <div class="modal-actions"><button class="btn btn-primary" :disabled="saving">حفظ</button><button type="button" class="btn" @click="emit('close')">إلغاء</button></div>
    </form>
  </div>
</template>
