<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { FUNDING_TYPES, MODES, sar } from '../labels';
import type { TreeNode } from '../types';

/** إضافة أو تعديل محور أو برنامج أو مشروع (مع بيانات المشروع وخدماته) */
const props = defineProps<{ node?: TreeNode | null; level: TreeNode['level']; parentId?: string | null }>();
const emit = defineEmits<{ close: []; saved: [n: TreeNode] }>();
const toast = useToast();
const levelName = { axis: 'محور', program: 'برنامج', project: 'مشروع' } as const;
const n = props.node;
const locked = computed(() => !!n && n.level === 'project' && !['draft', 'returned', 'rejected'].includes(n.approvalStatus ?? 'draft'));
const form = reactive({
  name: n?.name ?? '', description: n?.description ?? '', isActive: n?.isActive ?? true, portalVisible: n?.portalVisible ?? true,
  fundingType: n?.fundingType ?? 'restricted', zakatEligible: n?.zakatEligible ?? false, spendingMode: n?.spendingMode ?? 'beneficiaries',
  managerName: n?.managerName ?? '', startDate: n?.startDate ?? '', endDate: n?.endDate ?? '', budget: n?.budget ?? ('' as number | ''),
  targetBeneficiaries: n?.targetBeneficiaries ?? ('' as number | ''), goals: n?.goals ?? '', multiServices: n?.multiServices ?? false,
  services: (n?.services ?? []).map((s) => ({ name: s.name, cost: s.cost ?? ('' as number | ''), description: s.description ?? '', portalVisible: s.portalVisible !== false })),
});
const error = ref('');
const saving = ref(false);
const numOrNull = (v: number | '' | null) => (v === '' || v === null ? null : Number(v));
const servicesTotal = computed(() => form.services.reduce((a, s) => a + (Number(s.cost) || 0), 0));

async function save() {
  error.value = '';
  saving.value = true;
  try {
    const body: Record<string, unknown> = { name: form.name, description: form.description, isActive: form.isActive };
    if (props.level === 'project') {
      Object.assign(body, {
        portalVisible: form.portalVisible, managerName: form.managerName, startDate: form.startDate || null, endDate: form.endDate || null,
        budget: numOrNull(form.budget), targetBeneficiaries: numOrNull(form.targetBeneficiaries), goals: form.goals, multiServices: form.multiServices,
        services: form.services.filter((s) => s.name.trim()).map((s) => ({ name: s.name.trim(), cost: numOrNull(s.cost), description: s.description || null, portalVisible: s.portalVisible })),
      });
      if (!locked.value) Object.assign(body, { fundingType: form.fundingType, zakatEligible: form.fundingType === 'restricted' && form.zakatEligible, spendingMode: form.spendingMode });
    }
    const saved = n
      ? await api<TreeNode>(`/projects/nodes/${n.id}`, { method: 'PATCH', json: body })
      : await api<TreeNode>('/projects/nodes', { method: 'POST', json: { ...body, level: props.level, parentId: props.parentId ?? null } });
    toast.success(n ? 'تم الحفظ' : `تمت إضافة ال${levelName[props.level]}`);
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
    <form class="card modal" :class="{ 'modal-wide': level === 'project' }" @submit.prevent="save">
      <h2 class="mt">{{ n ? `تعديل ال${levelName[level]}` : `${levelName[level]} جديد` }}</h2>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <div class="field"><label>اسم ال{{ levelName[level] }} *</label><input v-model="form.name" class="input" required autofocus /></div>
      <div class="field"><label>نبذة عن ال{{ levelName[level] }}</label><textarea v-model="form.description" class="input" rows="2" /></div>

      <template v-if="level === 'project'">
        <p class="sec">نوع المشروع</p>
        <p v-if="locked" class="alert alert-error small">المشروع {{ n?.approvalStatus === 'pending' ? 'قيد الاعتماد' : 'معتمد' }}، لذا لا يمكن تغيير نوعه أو الزكاة أو طريقة الصرف{{ n?.approvalStatus === 'approved' ? ' إلا بعد إعادة فتحه للتعديل من صفحته' : '' }}.</p>
        <div class="types" :class="{ dim: locked }">
          <label v-for="t in FUNDING_TYPES" :key="t.value" :class="['type', { on: form.fundingType === t.value }]" :style="{ '--c': t.color }">
            <input v-model="form.fundingType" type="radio" :value="t.value" :disabled="locked" /><b>{{ t.label }}</b>
            <small>{{ t.value === 'restricted' ? 'يُصرف فقط فيما حدده الداعم' : t.value === 'unrestricted' ? 'تتصرف فيه الجمعية حسب الحاجة' : 'للمصاريف التشغيلية والإدارية' }}</small>
          </label>
        </div>
        <label class="check zakat" :class="{ dim: locked || form.fundingType !== 'restricted' }">
          <input v-model="form.zakatEligible" type="checkbox" :disabled="locked || form.fundingType !== 'restricted'" />
          المشروع ضمن بنود الزكاة <small class="muted">(للمشاريع المقيدة فقط، وتظهر له تبرعات الزكاة)</small>
        </label>
        <div class="field" style="margin-top: 10px"><label>طريقة الصرف</label>
          <select v-model="form.spendingMode" class="input" :disabled="locked"><option v-for="m in MODES" :key="m.value" :value="m.value">{{ m.label }}</option></select>
          <small class="muted">{{ form.spendingMode === 'general' ? 'مثل المشاريع الإعلامية التوعوية: يحوّل مدير المشروع رصيد الدفعة كاملًا إلى محجوز، ثم تصرف المالية بالفواتير.' : 'يُحمَّل كل طلب مستفيد معتمد على دفعة داعم.' }}</small>
        </div>

        <p class="sec">بيانات المشروع</p>
        <div class="grid">
          <div class="field"><label>مدير المشروع</label><input v-model="form.managerName" class="input" /></div>
          <div class="field"><label>الميزانية التقديرية (ريال)</label><input v-model="form.budget" type="number" min="0" class="input" /></div>
          <div class="field"><label>تاريخ البداية</label><input v-model="form.startDate" type="date" class="input" /></div>
          <div class="field"><label>تاريخ النهاية</label><input v-model="form.endDate" type="date" class="input" /></div>
          <div class="field"><label>عدد المستفيدين المستهدف</label><input v-model="form.targetBeneficiaries" type="number" min="0" class="input" /></div>
        </div>
        <div class="field"><label>أهداف المشروع</label><textarea v-model="form.goals" class="input" rows="2" /></div>

        <p class="sec">الخدمات (المستوى الرابع)</p>
        <p class="muted small">الخدمات هي ما يختاره المستفيد عند التقديم في البوابة. يمكن تقديم أكثر من خدمة في المشروع نفسه.</p>
        <div class="svcs">
          <div v-for="(s, i) in form.services" :key="i" class="svc">
            <input v-model="s.name" class="input" placeholder="اسم الخدمة" />
            <input v-model="s.cost" type="number" min="0" class="input" placeholder="التكلفة" />
            <input v-model="s.description" class="input" placeholder="نبذة للمستفيد (اختياري)" />
            <label class="check" title="تظهر في بوابة المستفيدين"><input v-model="s.portalVisible" type="checkbox" /> البوابة</label>
            <button type="button" class="icon" title="حذف" @click="form.services.splice(i, 1)">✕</button>
          </div>
        </div>
        <button type="button" class="btn btn-sm" @click="form.services.push({ name: '', cost: '', description: '', portalVisible: true })">+ إضافة خدمة</button>
        <label v-if="form.services.length > 1" class="check" style="margin-inline-start: 12px"><input v-model="form.multiServices" type="checkbox" /> يختار المستفيد أكثر من خدمة في الطلب</label>
        <p v-if="servicesTotal" class="muted small" style="margin-top: 6px">إجمالي تكلفة الخدمات: {{ sar(servicesTotal) }}</p>
        <label class="check" style="margin-top: 12px; display: flex"><input v-model="form.portalVisible" type="checkbox" /> يظهر المشروع في بوابة المستفيدين بعد اعتماده</label>
      </template>
      <label class="check" style="margin-top: 10px"><input v-model="form.isActive" type="checkbox" /> نشط</label>
      <div class="modal-actions" style="margin-top: 16px">
        <button class="btn btn-primary" :disabled="saving">{{ saving ? 'جارٍ الحفظ...' : 'حفظ' }}</button>
        <button type="button" class="btn" @click="emit('close')">إلغاء</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.mt { margin-bottom: 14px; }
.sec { font-weight: 700; color: var(--primary); margin: 16px 0 8px; }
.small { font-size: .8rem; margin: 0 0 8px; }
textarea.input { resize: vertical; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.types { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.type { border: 1.5px solid var(--border); border-radius: 12px; padding: 10px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; transition: all .2s var(--ease); }
.type input { display: none; }
.type b { color: var(--c); }
.type small { font-size: .74rem; color: var(--muted); }
.type.on { border-color: var(--c); background: color-mix(in srgb, var(--c) 8%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 15%, transparent); }
.zakat { margin-top: 10px; }
.dim { opacity: .55; }
.field small { display: block; margin-top: 4px; font-size: .78rem; }
.svcs { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.svc { display: grid; grid-template-columns: 1.3fr 100px 1.5fr auto 30px; gap: 6px; align-items: center; }
.icon { background: none; border: 0; cursor: pointer; width: 30px; height: 30px; border-radius: 8px; color: var(--muted); }
.icon:hover { background: var(--danger-soft); color: var(--danger); }
@media (max-width: 640px) { .grid, .types { grid-template-columns: 1fr; } .svc { grid-template-columns: 1fr 90px; } }
</style>
