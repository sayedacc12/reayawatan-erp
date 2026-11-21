<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { useToast } from '../../../stores/toast';
import { lookups, setLookups } from '../lib';
import '../../../shared/module.css';
import '../partnerships.css';

const toast = useToast();
const tab = ref<'types' | 'classes' | 'criteria' | 'general' | 'permissions'>('criteria');
const lk = ref<any>(null);
const types = ref<any[]>([]);
const classes = ref<any[]>([]);
const criteria = ref<any[]>([]);
const tiers = ref<any[]>([]);
const general = ref<any>({});
const busy = ref(false);
function apply(v: any) {
  lk.value = v;
  setLookups(v);
  types.value = v.types.map((x: any) => ({ ...x }));
  classes.value = v.classes.map((x: any) => ({ ...x }));
  criteria.value = v.criteria.map((x: any) => ({ ...x }));
  tiers.value = v.tiers.map((x: any) => ({ ...x }));
  const s = v.settings;
  general.value = { alertDays: s.alertDays, evaluationMonths: s.evaluationMonths, signerName: s.signerName ?? '', signerTitle: s.signerTitle ?? '', orgCity: s.orgCity ?? '', orgLicense: s.orgLicense ?? '', courtCity: s.courtCity ?? '' };
}
onMounted(async () => {
  try {
    apply(await lookups(true));
  } catch (e) {
    toast.error((e as Error).message);
  }
});
const weightTotal = computed(() => criteria.value.filter((c) => c.isActive).reduce((a, c) => a + Number(c.weight || 0), 0));
function move(list: any[], i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}
async function run(fn: () => Promise<any>, ok: string) {
  busy.value = true;
  try {
    await fn();
    toast.success(ok);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const saveTypes = () => run(async () => {
  const list = await api<any[]>('/partnerships/settings/types', { method: 'PUT', json: { types: types.value.map((t) => ({ id: t.id, name: t.name, description: t.description || null, color: t.color, minScore: Number(t.minScore), defaultMonths: Number(t.defaultMonths), isActive: t.isActive })) } });
  apply({ ...lk.value, types: list });
}, 'حُفظت أنواع الشراكة');
const saveClasses = () => run(async () => {
  const list = await api<any[]>('/partnerships/settings/classes', { method: 'PUT', json: { classes: classes.value.map((c) => ({ id: c.id, name: c.name, description: c.description || null, color: c.color, isActive: c.isActive })) } });
  apply({ ...lk.value, classes: list });
}, 'حُفظت التصنيفات');
const saveCriteria = () => run(async () => {
  apply(await api('/partnerships/settings/criteria', {
    method: 'PUT', json: {
      criteria: criteria.value.map((c) => ({ id: c.id, name: c.name, guide: c.guide || null, weight: Number(c.weight), knockout: c.knockout, isActive: c.isActive })),
      tiers: tiers.value.map((t) => ({ key: t.key, label: t.label, min: Number(t.min), color: t.color })),
    },
  }));
}, 'حُفظت المعايير والمستويات');
const saveGeneral = () => run(async () => {
  apply(await api('/partnerships/settings/general', { method: 'PUT', json: { ...general.value, alertDays: Number(general.value.alertDays), evaluationMonths: Number(general.value.evaluationMonths) } }));
}, 'حُفظت الإعدادات');
const newKey = () => `tier_${Date.now().toString(36).slice(-5)}`;
</script>

<template>
  <div>
    <div class="page-head"><div><h1>إعدادات الشراكات</h1><p class="muted">معايير اختيار الشركاء وأوزانها، وأنواع الشراكة وتصنيفات الشركاء، والتنبيهات وبيانات الجمعية في العقود. تبويب بنود العقود من <RouterLink to="/partnerships/clauses" class="pm-link">مكتبة البنود</RouterLink>.</p></div></div>
    <nav class="pm-tabs">
      <button :class="['pm-tab', { on: tab === 'criteria' }]" @click="tab = 'criteria'">معايير الاختيار والمستويات</button>
      <button :class="['pm-tab', { on: tab === 'types' }]" @click="tab = 'types'">أنواع الشراكة</button>
      <button :class="['pm-tab', { on: tab === 'classes' }]" @click="tab = 'classes'">تصنيفات الشركاء</button>
      <button :class="['pm-tab', { on: tab === 'general' }]" @click="tab = 'general'">العقود والتنبيهات</button>
      <button :class="['pm-tab', { on: tab === 'permissions' }]" @click="tab = 'permissions'">الصلاحيات</button>
    </nav>

    <template v-if="lk">
      <section v-if="tab === 'criteria'" class="card pm-panel">
        <div class="wbar">
          <span>مجموع أوزان المعايير الفعالة</span>
          <div class="pt-bar" style="flex: 1"><i :style="{ width: Math.min(100, weightTotal) + '%', '--c': weightTotal === 100 ? '#10b981' : '#f59e0b' }" /></div>
          <b :class="weightTotal === 100 ? 'ok' : 'bad'">{{ weightTotal }}%</b>
        </div>
        <p class="pm-muted">كل معيار يُقيَّم من 1 إلى 5، والدرجة من 100 = مجموع (الوزن × الدرجة ÷ 5). المعيار الحاسم بدرجة 1 يجعل الشريك لا يجتاز القواعد، والمعتمد يقرر مع كتابة السبب.</p>
        <div v-for="(c, i) in criteria" :key="c.id ?? i" :class="['crow', { off: !c.isActive }]">
          <div class="crow-main">
            <input v-model="c.name" class="input" placeholder="اسم المعيار" style="flex: 2; min-width: 180px" />
            <label class="w"><input v-model.number="c.weight" type="number" min="1" max="100" class="input" />%</label>
            <label class="check"><input v-model="c.knockout" type="checkbox" /> حاسم</label>
            <label class="check"><input v-model="c.isActive" type="checkbox" /> فعّال</label>
            <button class="btn btn-sm" @click="move(criteria, i, -1)">↑</button><button class="btn btn-sm" @click="move(criteria, i, 1)">↓</button>
            <button class="btn btn-sm btn-danger" @click="criteria.splice(i, 1)">حذف</button>
          </div>
          <input v-model="c.guide" class="input guide" placeholder="دليل التقييم: ماذا تعني الدرجات (يظهر للمقيّم)" />
        </div>
        <button class="btn" @click="criteria.push({ name: '', guide: '', weight: 5, knockout: false, isActive: true })">+ معيار</button>

        <div class="pt-sec">مستويات الشركاء حسب الدرجة</div>
        <div v-for="(t, i) in tiers" :key="t.key" class="trow">
          <input v-model="t.color" type="color" class="color" />
          <input v-model="t.label" class="input" placeholder="اسم المستوى" style="flex: 1" />
          <label class="w">من <input v-model.number="t.min" type="number" min="1" max="100" class="input" /> فأكثر</label>
          <span class="pt-tier" :style="{ '--c': t.color }">{{ t.label || 'معاينة' }}</span>
          <button class="btn btn-sm btn-danger" :disabled="tiers.length === 1" @click="tiers.splice(i, 1)">حذف</button>
        </div>
        <button class="btn" @click="tiers.push({ key: newKey(), label: '', min: 50, color: '#64748b' })">+ مستوى</button>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy || weightTotal !== 100" @click="saveCriteria">حفظ المعايير والمستويات</button></div>
      </section>

      <section v-else-if="tab === 'types'" class="card pm-panel">
        <p class="pm-muted" style="margin-top: 0">لكل نوع حد أدنى لدرجة القبول، ومدة معتادة للعقد. البنود الخاصة بالنوع تُحدد من مكتبة البنود. النوع المستخدم لا يُحذف، أوقفه بدلًا من ذلك.</p>
        <div v-for="(t, i) in types" :key="t.id ?? i" :class="['crow', { off: !t.isActive }]">
          <div class="crow-main">
            <input v-model="t.color" type="color" class="color" />
            <input v-model="t.name" class="input" placeholder="اسم النوع" style="flex: 1; min-width: 160px" />
            <label class="w">الحد الأدنى <input v-model.number="t.minScore" type="number" min="0" max="100" class="input" /></label>
            <label class="w">المدة <input v-model.number="t.defaultMonths" type="number" min="1" max="120" class="input" /> شهرًا</label>
            <label class="check"><input v-model="t.isActive" type="checkbox" /> فعّال</label>
            <button class="btn btn-sm" @click="move(types, i, -1)">↑</button><button class="btn btn-sm" @click="move(types, i, 1)">↓</button>
            <button class="btn btn-sm btn-danger" @click="types.splice(i, 1)">حذف</button>
          </div>
          <input v-model="t.description" class="input guide" placeholder="وصف مختصر" />
        </div>
        <div class="modal-actions" style="justify-content: space-between">
          <button class="btn" @click="types.push({ name: '', description: '', color: '#0f766e', minScore: 60, defaultMonths: 12, isActive: true })">+ نوع</button>
          <button class="btn btn-primary" :disabled="busy" @click="saveTypes">حفظ الأنواع</button>
        </div>
      </section>

      <section v-else-if="tab === 'classes'" class="card pm-panel">
        <p class="pm-muted" style="margin-top: 0">تصنيف الجهة الشريكة حسب قطاعها. التصنيف المستخدم لا يُحذف، أوقفه بدلًا من ذلك.</p>
        <div v-for="(c, i) in classes" :key="c.id ?? i" :class="['crow-main', 'line', { off: !c.isActive }]">
          <input v-model="c.color" type="color" class="color" />
          <input v-model="c.name" class="input" placeholder="اسم التصنيف" style="flex: 1; min-width: 160px" />
          <input v-model="c.description" class="input" placeholder="وصف مختصر" style="flex: 2; min-width: 200px" />
          <label class="check"><input v-model="c.isActive" type="checkbox" /> فعّال</label>
          <button class="btn btn-sm" @click="move(classes, i, -1)">↑</button><button class="btn btn-sm" @click="move(classes, i, 1)">↓</button>
          <button class="btn btn-sm btn-danger" @click="classes.splice(i, 1)">حذف</button>
        </div>
        <div class="modal-actions" style="justify-content: space-between">
          <button class="btn" @click="classes.push({ name: '', description: '', color: '#0369a1', isActive: true })">+ تصنيف</button>
          <button class="btn btn-primary" :disabled="busy" @click="saveClasses">حفظ التصنيفات</button>
        </div>
      </section>

      <section v-else-if="tab === 'general'" class="card pm-panel" style="max-width: 900px">
        <div class="pt-sec" style="margin-top: 0">التنبيهات وإعادة التقييم</div>
        <div class="pt-fields">
          <div class="field"><label>التنبيه قبل انتهاء العقد (يوم)</label><input v-model.number="general.alertDays" type="number" min="7" max="365" class="input" /></div>
          <div class="field"><label>صلاحية تقييم الشريك (شهر)</label><input v-model.number="general.evaluationMonths" type="number" min="3" max="60" class="input" /></div>
        </div>
        <div class="pt-sec">بيانات الجمعية في تمهيد العقود</div>
        <div class="pt-fields">
          <div class="field"><label>ممثل الجمعية في التوقيع (افتراضيًا)</label><input v-model="general.signerName" class="input" /></div>
          <div class="field"><label>صفته</label><input v-model="general.signerTitle" class="input" /></div>
          <div class="field"><label>رقم ترخيص الجمعية</label><input v-model="general.orgLicense" class="input" dir="ltr" /></div>
          <div class="field"><label>مدينة الجمعية</label><input v-model="general.orgCity" class="input" /></div>
          <div class="field"><label>مدينة المحكمة المختصة</label><input v-model="general.courtCity" class="input" /></div>
        </div>
        <button class="btn btn-primary" :disabled="busy" @click="saveGeneral">حفظ</button>
      </section>

      <ModulePermissionsPane v-else module="partnerships" />
    </template>
  </div>
</template>

<style scoped>
.wbar { display: flex; align-items: center; gap: 12px; font-size: .9rem; background: var(--surface-2); padding: 10px 14px; border-radius: 12px; }
.wbar b { font-size: 1.1rem; }
.ok { color: #059669; }
.bad { color: #d97706; }
.crow { border: 1px solid var(--border); border-radius: 12px; padding: 10px; margin-bottom: 8px; }
.crow-main { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.crow-main.line { padding: 6px 0; border-bottom: 1px solid var(--border); }
.off { opacity: .55; }
.guide { margin-top: 6px; font-size: .85rem; }
.w { display: inline-flex; align-items: center; gap: 4px; font-size: .84rem; white-space: nowrap; }
.w .input { width: 72px; }
.trow { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.color { width: 42px; height: 38px; border: 1px solid var(--border); border-radius: 8px; padding: 2px; flex-shrink: 0; }
</style>
