<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { useToast } from '../../../stores/toast';
import { lookups, setLookups } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const toast = useToast();
const tab = ref<'general' | 'docs' | 'suppliers' | 'portal' | 'accounting' | 'permissions'>('general');
const lk = ref<any>(null);
const g = ref<any>({});
const docTypes = ref<any[]>([]);
const activities = ref<string[]>([]);
const cats = ref<any[]>([]);
const newActivity = ref('');
const busy = ref(false);
function apply(v: any) {
  lk.value = v;
  setLookups(v);
  const s = v.settings;
  g.value = { valuation: s.valuation, accountLevel: s.accountLevel, docAlertDays: s.docAlertDays, portalOpen: s.portalOpen, portalIntro: s.portalIntro ?? '',
    partnerCategoryId: s.partnerCategoryId ?? '', payablesAccountId: s.payablesAccountId ?? '' };
  docTypes.value = s.supplierDocTypes.map((d: any) => ({ ...d, entityTypes: [...d.entityTypes] }));
  activities.value = [...s.activities];
  cats.value = v.categories.map((c: any) => ({ ...c, description: c.description ?? '' }));
}
onMounted(async () => {
  try {
    apply(await lookups(true));
  } catch (e) {
    toast.error((e as Error).message);
  }
});
async function save(patch: Record<string, unknown>, ok = 'حُفظت الإعدادات') {
  busy.value = true;
  try {
    apply(await api('/procurement/settings', { method: 'PUT', json: patch }));
    toast.success(ok);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function saveCats() {
  busy.value = true;
  try {
    apply(await api('/procurement/supplier-categories', { method: 'PUT', json: { categories: cats.value.map((c) => ({ id: c.id, name: c.name, description: c.description || null, color: c.color, isActive: c.isActive })) } }));
    toast.success('حُفظت تصنيفات الموردين');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
function toggleEntity(d: any, k: string) {
  d.entityTypes = d.entityTypes.includes(k) ? d.entityTypes.filter((x: string) => x !== k) : [...d.entityTypes, k];
}
function addDocType() {
  docTypes.value.push({ key: `doc_${docTypes.value.length + 1}`, name: '', required: false, hasExpiry: false, entityTypes: [], isActive: true });
}
function addActivity() {
  const v = newActivity.value.trim();
  if (v && !activities.value.includes(v)) activities.value.push(v);
  newActivity.value = '';
}
</script>

<template>
  <div>
    <div class="page-head"><div><h1>إعدادات المشتريات والمستودعات</h1><p class="muted">طريقة التقييم ومستوى الحسابات، ومستندات الموردين المطلوبة، والأنشطة والتصنيفات، وبوابة الموردين، والربط بالنظام المالي.</p></div></div>
    <div class="pc-tabs">
      <button :class="{ on: tab === 'general' }" @click="tab = 'general'">عام</button>
      <button :class="{ on: tab === 'docs' }" @click="tab = 'docs'">مستندات الموردين</button>
      <button :class="{ on: tab === 'suppliers' }" @click="tab = 'suppliers'">الأنشطة والتصنيفات</button>
      <button :class="{ on: tab === 'portal' }" @click="tab = 'portal'">بوابة الموردين</button>
      <button :class="{ on: tab === 'accounting' }" @click="tab = 'accounting'">الربط المالي</button>
      <button :class="{ on: tab === 'permissions' }" @click="tab = 'permissions'">الصلاحيات</button>
    </div>

    <template v-if="lk">
      <section v-if="tab === 'general'" class="card pm-panel">
        <div class="pc-fields">
          <label class="field"><span>طريقة تقييم المخزون الافتراضية</span><select v-model="g.valuation" class="input"><option v-for="(l, k) in lk.valuation" :key="k" :value="k">{{ l }}</option></select>
            <small class="pm-muted">يمكن تغييرها لمجموعة أو صنف بعينه.</small></label>
          <label class="field"><span>حسابات المخزون تُحدد على مستوى</span>
            <select v-model="g.accountLevel" class="input"><option value="group">مجموعة الصنف</option><option value="warehouse">المستودع</option></select></label>
          <label class="field"><span>التنبيه قبل انتهاء مستندات الموردين (يوم)</span><input v-model.number="g.docAlertDays" class="input" type="number" min="1" max="365" /></label>
        </div>
        <button class="btn btn-primary" :disabled="busy" @click="save({ valuation: g.valuation, accountLevel: g.accountLevel, docAlertDays: g.docAlertDays })">حفظ</button>
      </section>

      <section v-else-if="tab === 'docs'" class="card pm-panel">
        <p class="pm-muted">المستندات التي تُطلب من المورد. المطلوب منها شرط لاعتماده، وما له تاريخ انتهاء يُتابَع وينبَّه عليه.</p>
        <table class="table">
          <thead><tr><th>الرمز</th><th>المستند</th><th>مطلوب</th><th>له انتهاء</th><th>ينطبق على</th><th>نشط</th><th /></tr></thead>
          <tbody>
            <tr v-for="(d, i) in docTypes" :key="i">
              <td><input v-model="d.key" class="input pc-code" style="max-width: 120px" /></td>
              <td><input v-model="d.name" class="input" /></td>
              <td><input v-model="d.required" type="checkbox" /></td>
              <td><input v-model="d.hasExpiry" type="checkbox" /></td>
              <td><div class="pc-chips"><button v-for="(l, k) in lk.entityTypes" :key="k" type="button" :class="['pc-chip', { on: d.entityTypes.includes(k) }]" @click="toggleEntity(d, String(k))">{{ l }}</button></div>
                <small v-if="!d.entityTypes.length" class="pm-muted">كل أنواع الكيانات</small></td>
              <td><input v-model="d.isActive" type="checkbox" /></td>
              <td><button class="btn btn-sm" @click="docTypes.splice(i, 1)">✕</button></td>
            </tr>
          </tbody>
        </table>
        <div class="pc-inline" style="margin-top: 10px">
          <button class="btn btn-sm" @click="addDocType">+ مستند</button>
          <button class="btn btn-primary" :disabled="busy" @click="save({ supplierDocTypes: docTypes }, 'حُفظت مستندات الموردين')">حفظ</button>
        </div>
      </section>

      <div v-else-if="tab === 'suppliers'" class="pc-grid">
        <section class="card pm-panel">
          <h2>تصنيفات الموردين</h2>
          <div v-for="(c, i) in cats" :key="c.id ?? i" class="pc-inline" style="margin-bottom: 6px">
            <input v-model="c.color" type="color" style="width: 42px; height: 36px; border: 0; background: none" />
            <input v-model="c.name" class="input" placeholder="اسم التصنيف" />
            <input v-model="c.description" class="input" placeholder="وصف" />
            <label class="pm-muted" style="white-space: nowrap"><input v-model="c.isActive" type="checkbox" /> نشط</label>
            <button class="btn btn-sm" @click="cats.splice(i, 1)">✕</button>
          </div>
          <div class="pc-inline" style="margin-top: 10px">
            <button class="btn btn-sm" @click="cats.push({ name: '', description: '', color: '#0f766e', isActive: true })">+ تصنيف</button>
            <button class="btn btn-primary" :disabled="busy" @click="saveCats">حفظ</button>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>الأنشطة والخدمات</h2>
          <p class="pm-muted" style="font-size: .85rem">يختار منها المورد أنشطته عند التسجيل، ويُبحث بها عند طلب العروض.</p>
          <div class="pc-chips" style="margin-bottom: 10px"><span v-for="(a, i) in activities" :key="a" class="pc-chip">{{ a }} <button class="btn btn-sm" style="padding: 0 4px; min-height: 0" @click="activities.splice(i, 1)">✕</button></span></div>
          <div class="pc-inline"><input v-model="newActivity" class="input" placeholder="نشاط جديد" @keydown.enter.prevent="addActivity" /><button class="btn btn-sm" @click="addActivity">إضافة</button></div>
          <button class="btn btn-primary" style="margin-top: 10px" :disabled="busy" @click="save({ activities }, 'حُفظت الأنشطة')">حفظ</button>
        </section>
      </div>

      <section v-else-if="tab === 'portal'" class="card pm-panel">
        <label class="field"><span><input v-model="g.portalOpen" type="checkbox" /> البوابة مفتوحة لتسجيل موردين جدد</span>
          <small class="pm-muted">إن أُغلقت يبقى دخول الموردين المسجلين متاحًا.</small></label>
        <label class="field"><span>رسالة ترحيب تظهر في صفحة البوابة</span><textarea v-model="g.portalIntro" class="input" rows="4" /></label>
        <button class="btn btn-primary" :disabled="busy" @click="save({ portalOpen: g.portalOpen, portalIntro: g.portalIntro || null })">حفظ</button>
      </section>

      <section v-else-if="tab === 'accounting'" class="card pm-panel">
        <p class="pm-muted">عند اعتماد المورد يُنشأ له حساب في النظام المالي تلقائيًا بالتصنيف والحساب التاليين. تُستخدم لاحقًا في الفواتير والمستحقات.</p>
        <div class="pc-fields">
          <label class="field"><span>تصنيف الموردين في النظام المالي</span>
            <select v-model="g.partnerCategoryId" class="input"><option value="">—</option><option v-for="c in lk.partnerCategories" :key="c.id" :value="c.id">{{ c.name }}</option></select>
            <small v-if="!lk.partnerCategories.length" class="pm-muted">أضف تصنيفًا سلوكه «موردون» من إعدادات النظام المالي.</small></label>
          <label class="field"><span>حساب الدائنين (الموردين)</span>
            <select v-model="g.payablesAccountId" class="input"><option value="">—</option><option v-for="a in lk.accounts.filter((x: any) => x.nature === 'liabilities')" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select></label>
        </div>
        <button class="btn btn-primary" :disabled="busy" @click="save({ partnerCategoryId: g.partnerCategoryId || null, payablesAccountId: g.payablesAccountId || null })">حفظ</button>
      </section>

      <ModulePermissionsPane v-else-if="tab === 'permissions'" module="procurement" />
    </template>
  </div>
</template>
