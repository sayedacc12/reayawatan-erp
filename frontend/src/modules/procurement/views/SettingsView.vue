<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { lookups, setLookups, stockLookups } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

const toast = useToast();
const supplierUrl = `${location.origin}/supplier/${useSession().user?.organizationSlug ?? ''}`;
const copyUrl = () => navigator.clipboard.writeText(supplierUrl).then(() => toast.success('نُسخ الرابط'), () => toast.error('تعذر النسخ'));
const tab = ref<'general' | 'sourcing' | 'docs' | 'suppliers' | 'portal' | 'accounting' | 'stock' | 'invoices' | 'evaluation' | 'permissions'>('general');
const ev = ref<any>(null);
const METRICS: Record<string, string> = { onTimePct: 'التوريد في الموعد', fillPct: 'اكتمال الكميات', qualityPct: 'الجودة في الفحص', invoiceOkPct: 'مطابقة الفواتير', kpiPct: 'مستويات الخدمة' };
const inv = ref<any>({ matchTolerancePct: 0, vatInputAccountId: '', paymentDays: 30 });
const slk = ref<any>(null);
const st = ref<any>({});
const src = ref<any>(null);
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
  inv.value = { matchTolerancePct: s.matchTolerancePct ?? 0, vatInputAccountId: s.vatInputAccountId ?? '', paymentDays: s.paymentDays ?? 30 };
  cats.value = v.categories.map((c: any) => ({ ...c, description: c.description ?? '' }));
  const so = v.sourcing;
  src.value = {
    methodLimits: { ...so.methodLimits }, minQuotes: so.minQuotes, technicalPass: so.technicalPass, orderTerms: so.orderTerms ?? '', discloseWinner: so.discloseWinner,
    approvalLevels: so.approvalLevels.map((l: any) => ({ ...l })), evalCriteria: so.evalCriteria.map((c: any) => ({ ...c })),
  };
}
const critWeight = () => src.value.evalCriteria.reduce((s: number, c: any) => s + (Number(c.weight) || 0), 0);
async function saveSourcing() {
  const x = src.value;
  if (critWeight() !== 100) return toast.error('مجموع أوزان معايير التقييم يجب أن يكون 100');
  busy.value = true;
  try {
    apply(await api('/procurement/sourcing-settings', {
      method: 'PUT',
      json: {
        methodLimits: { direct: Number(x.methodLimits.direct), quotes: Number(x.methodLimits.quotes) }, minQuotes: Number(x.minQuotes), technicalPass: Number(x.technicalPass),
        orderTerms: x.orderTerms || null, discloseWinner: !!x.discloseWinner,
        approvalLevels: x.approvalLevels.map((l: any) => ({ name: l.name, minAmount: Number(l.minAmount), permission: l.permission })),
        evalCriteria: x.evalCriteria.map((c: any) => ({ key: c.key, name: c.name, weight: Number(c.weight), kind: c.kind })),
      },
    }));
    toast.success('حُفظت إعدادات الشراء');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  try {
    apply(await lookups(true));
  } catch (e) {
    toast.error((e as Error).message);
  }
});
function applyStock(s: any) {
  st.value = {
    grniAccountId: s.grniAccountId ?? '', adjustAccountId: s.adjustAccountId ?? '', adjustAnalyticId: s.adjustAnalyticId ?? '',
    openingAccountId: s.openingAccountId ?? '', defaultExpenseAccountId: s.defaultExpenseAccountId ?? '', expiryAlertDays: s.expiryAlertDays ?? 60,
    overReceiptPct: s.overReceiptPct ?? 0, vatInCost: s.vatInCost ?? true, requireInspection: !!s.requireInspection,
  };
}
async function openStock() {
  tab.value = 'stock';
  if (!slk.value) slk.value = await stockLookups().catch(() => ({ accounts: [], analytics: [] }));
  applyStock(lk.value.settings);
}
const accs = (natures: string[]) => (slk.value?.accounts ?? []).filter((a: any) => natures.includes(a.nature));
async function saveStock() {
  busy.value = true;
  const x = st.value;
  const nul = (v: string) => (v ? v : null);
  try {
    const s = await api<any>('/procurement/stock-settings', {
      method: 'PUT',
      json: {
        grniAccountId: nul(x.grniAccountId), adjustAccountId: nul(x.adjustAccountId), adjustAnalyticId: nul(x.adjustAnalyticId),
        openingAccountId: nul(x.openingAccountId), defaultExpenseAccountId: nul(x.defaultExpenseAccountId), expiryAlertDays: Number(x.expiryAlertDays),
        overReceiptPct: Number(x.overReceiptPct), vatInCost: !!x.vatInCost, requireInspection: !!x.requireInspection,
      },
    });
    apply(await lookups(true));
    applyStock(s);
    toast.success('حُفظت إعدادات المستودعات');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
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
async function openEval() {
  tab.value = 'evaluation';
  if (ev.value) return;
  try {
    const x = await api<any>('/procurement/evaluation-lookups');
    ev.value = {
      criteria: x.criteria.map((c: any) => ({ ...c, metric: c.metric ?? '' })), gradeA: x.gradeLimits.A, gradeB: x.gradeLimits.B, gradeC: x.gradeLimits.C,
      blockWeak: x.blockWeak, auditAreaIds: [...(x.auditAreaIds ?? [])], areas: x.auditAreas,
    };
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const evWeight = () => (ev.value?.criteria ?? []).reduce((t: number, c: any) => t + Number(c.weight || 0), 0);
async function saveEval() {
  busy.value = true;
  try {
    const e = ev.value;
    await api('/procurement/evaluation-settings', {
      method: 'PUT',
      json: {
        criteria: e.criteria.map((c: any) => ({ key: c.key, name: c.name, weight: Number(c.weight), metric: c.metric || null })),
        gradeA: Number(e.gradeA), gradeB: Number(e.gradeB), gradeC: Number(e.gradeC), blockWeak: e.blockWeak, auditAreaIds: e.auditAreaIds,
      },
    });
    toast.success('حُفظت إعدادات التقييم');
  } catch (err) {
    toast.error((err as Error).message);
  } finally {
    busy.value = false;
  }
}
async function saveInvoices() {
  busy.value = true;
  try {
    await api('/procurement/invoice-settings', { method: 'PUT', json: { matchTolerancePct: Number(inv.value.matchTolerancePct) || 0, vatInputAccountId: inv.value.vatInputAccountId || null, paymentDays: Number(inv.value.paymentDays) || 0 } });
    toast.success('حُفظت إعدادات الفواتير');
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
      <button :class="{ on: tab === 'sourcing' }" @click="tab = 'sourcing'">الشراء والاعتماد</button>
      <button :class="{ on: tab === 'docs' }" @click="tab = 'docs'">مستندات الموردين</button>
      <button :class="{ on: tab === 'suppliers' }" @click="tab = 'suppliers'">الأنشطة والتصنيفات</button>
      <button :class="{ on: tab === 'portal' }" @click="tab = 'portal'">بوابة الموردين</button>
      <button :class="{ on: tab === 'accounting' }" @click="tab = 'accounting'">الربط المالي</button>
      <button :class="{ on: tab === 'stock' }" @click="openStock">المستودعات</button>
      <button :class="{ on: tab === 'invoices' }" @click="tab = 'invoices'">الفواتير والمطابقة</button>
      <button :class="{ on: tab === 'evaluation' }" @click="openEval">تقييم الموردين والرقابة</button>
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
            <button class="btn btn-sm" @click="cats.push({ name: '', description: '', color: '#164e38', isActive: true })">+ تصنيف</button>
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

      <div v-else-if="tab === 'sourcing' && src" style="display: grid; gap: 16px">
        <section class="card pm-panel">
          <h2>أسلوب الشراء حسب القيمة</h2>
          <div class="pc-fields">
            <label class="field"><span>شراء مباشر حتى (ريال)</span><input v-model.number="src.methodLimits.direct" type="number" min="0" class="input" /></label>
            <label class="field"><span>طلب عروض أسعار حتى (ريال)</span><input v-model.number="src.methodLimits.quotes" type="number" min="0" class="input" /><small class="pm-muted">وما زاد عليه منافسة عامة.</small></label>
            <label class="field"><span>الحد الأدنى لعدد العروض</span><input v-model.number="src.minQuotes" type="number" min="1" max="10" class="input" /></label>
            <label class="field"><span><input v-model="src.discloseWinner" type="checkbox" /> إبلاغ الموردين غير الفائزين باسم الفائز</span></label>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>مستويات اعتماد التعميد</h2>
          <p class="pm-muted" style="font-size: .82rem">يمر التعميد بكل مستوى يبلغ حده الأدنى، بالترتيب، وكل مستوى بمعتمد مختلف عن مُعد التعميد ومن سبقه.</p>
          <table class="pc-lines">
            <thead><tr><th>المستوى</th><th style="width: 150px">من قيمة (ريال)</th><th style="width: 220px">الصلاحية المطلوبة</th><th /></tr></thead>
            <tbody>
              <tr v-for="(l, i) in src.approvalLevels" :key="i">
                <td><input v-model="l.name" class="input" /></td>
                <td><input v-model.number="l.minAmount" type="number" min="0" class="input" /></td>
                <td><select v-model="l.permission" class="input"><option value="procurement.orders.approve">اعتماد التعميدات</option><option value="procurement.orders.approve_high">اعتماد التعميدات العالية</option></select></td>
                <td><button type="button" class="btn btn-ghost" :disabled="src.approvalLevels.length < 2" @click="src.approvalLevels.splice(i, 1)">✕</button></td>
              </tr>
            </tbody>
          </table>
          <button class="btn" style="margin-top: 8px" :disabled="src.approvalLevels.length >= 6" @click="src.approvalLevels.push({ name: '', minAmount: 0, permission: 'procurement.orders.approve_high' })">+ مستوى</button>
        </section>
        <section class="card pm-panel">
          <h2>معايير التقييم الافتراضية <small :class="critWeight() === 100 ? 'pc-okflag' : 'pc-flag'">المجموع {{ critWeight() }} من 100</small></h2>
          <table class="pc-lines">
            <thead><tr><th>المعيار</th><th style="width: 170px">النوع</th><th style="width: 90px">الوزن</th><th /></tr></thead>
            <tbody>
              <tr v-for="(c, i) in src.evalCriteria" :key="c.key">
                <td><input v-model="c.name" class="input" /></td>
                <td><select v-model="c.kind" class="input"><option value="price">مالي (آلي من السعر)</option><option value="technical">فني (تقدّره اللجنة)</option></select></td>
                <td><input v-model.number="c.weight" type="number" min="1" max="100" class="input" /></td>
                <td><button type="button" class="btn btn-ghost" @click="src.evalCriteria.splice(i, 1)">✕</button></td>
              </tr>
            </tbody>
          </table>
          <div class="pc-inline" style="margin-top: 8px">
            <button class="btn" @click="src.evalCriteria.push({ key: `c${Date.now().toString(36).slice(-5)}`, name: '', weight: 0, kind: 'technical' })">+ معيار</button>
            <label class="field" style="margin: 0"><span>الحد الأدنى للدرجة الفنية</span><input v-model.number="src.technicalPass" type="number" min="0" max="100" class="input" style="width: 100px" /></label>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>الشروط العامة للتعميد</h2>
          <textarea v-model="src.orderTerms" class="input" rows="6" />
        </section>
        <div><button class="btn btn-primary" :disabled="busy" @click="saveSourcing">حفظ إعدادات الشراء</button></div>
      </div>

      <section v-else-if="tab === 'portal'" class="card pm-panel">
        <div class="field"><span>رابط بوابة الموردين (للتسجيل والدخول)</span>
          <div class="pc-inline"><code dir="ltr">{{ supplierUrl }}</code><button type="button" class="btn btn-sm" @click="copyUrl">نسخ</button><a :href="supplierUrl" target="_blank" class="btn btn-sm">فتح</a></div></div>
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

      <section v-else-if="tab === 'invoices'" class="card pm-panel">
        <p class="pm-muted">تُطابق كل فاتورة مع التعميد (السعر) والاستلام المعتمد (الكمية). الفرق في السعر ضمن نسبة السماح لا يُعد استثناء، ويُحمّل على بند الموازنة ومصدر التمويل نفسيهما.</p>
        <div class="pc-fields">
          <label class="field"><span>نسبة السماح في سعر الوحدة %</span><input v-model.number="inv.matchTolerancePct" type="number" min="0" max="20" step="any" class="input" /></label>
          <label class="field"><span>مدة السداد الافتراضية (يوم)</span><input v-model.number="inv.paymentDays" type="number" min="0" max="365" class="input" /></label>
          <label class="field"><span>حساب ضريبة المدخلات</span>
            <select v-model="inv.vatInputAccountId" class="input"><option value="">—</option><option v-for="a in lk.accounts.filter((x: any) => x.nature === 'assets')" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select>
            <small class="pm-muted">مطلوب لتسجيل الفواتير في المالي إذا كانت الضريبة لا تدخل في تكلفة المشتريات (من تبويب المستودعات).</small></label>
        </div>
        <button class="btn btn-primary" :disabled="busy" @click="saveInvoices">حفظ</button>
      </section>

      <section v-else-if="tab === 'evaluation' && ev" class="card pm-panel">
        <p class="pm-muted">معايير تقييم أداء الموردين وأوزانها (مجموعها 100). المعيار المرتبط بمؤشر تُقترح درجته آليًا من بيانات المورد، والمعيار اليدوي يقدّره المقيّم.</p>
        <table class="pc-lines">
          <thead><tr><th>المعيار</th><th>الوزن %</th><th>المؤشر المحسوب</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(c, i) in ev.criteria" :key="i">
              <td><input v-model="c.name" class="input" maxlength="200" /></td>
              <td><input v-model.number="c.weight" type="number" min="0" max="100" step="any" class="input" style="width: 90px" /></td>
              <td><select v-model="c.metric" class="input"><option value="">يدوي</option><option v-for="(l, k) in METRICS" :key="k" :value="k">{{ l }}</option></select></td>
              <td><button type="button" class="btn btn-ghost" @click="ev.criteria.splice(i, 1)">✕</button></td>
            </tr>
          </tbody>
          <tfoot><tr><td>المجموع</td><td :class="{ 'pc-flag': evWeight() !== 100 }">{{ evWeight() }}</td><td colspan="2"></td></tr></tfoot>
        </table>
        <button type="button" class="btn" style="margin: 8px 0" @click="ev.criteria.push({ key: `c${Date.now().toString(36)}`, name: '', weight: 0, metric: '' })">إضافة معيار</button>
        <div class="pc-fields">
          <label class="field"><span>ممتاز (A) من درجة</span><input v-model.number="ev.gradeA" type="number" min="1" max="100" class="input" /></label>
          <label class="field"><span>جيد (B) من درجة</span><input v-model.number="ev.gradeB" type="number" min="1" max="100" class="input" /></label>
          <label class="field"><span>مقبول (C) من درجة</span><input v-model.number="ev.gradeC" type="number" min="1" max="100" class="input" /><small class="pm-muted">وما دونها ضعيف (D)</small></label>
        </div>
        <label class="pc-inline" style="margin: 8px 0"><input v-model="ev.blockWeak" type="checkbox" /> منع دعوة الموردين ذوي التقدير الضعيف (D) إلى المنافسات الجديدة</label>
        <div v-if="ev.areas.length" style="margin-bottom: 10px">
          <span class="pm-muted" style="font-size: .85rem">مجالات المراجعة الداخلية الخاصة بالمشتريات (تظهر توصياتها في شاشة الرقابة)</span>
          <div class="pc-chips" style="margin-top: 6px"><label v-for="a in ev.areas" :key="a.id" class="pc-chip"><input v-model="ev.auditAreaIds" type="checkbox" :value="a.id" /> {{ a.name }}</label></div>
        </div>
        <button class="btn btn-primary" :disabled="busy" @click="saveEval">حفظ</button>
      </section>

      <section v-else-if="tab === 'stock'" class="card pm-panel">
        <p class="pm-muted">حسابات قيود المستودعات (سندات المخازن). حساب المخزون نفسه يُحدد في مجموعة الأصناف أو المستودع، وحساب المصروف عند الصرف في مجموعة الأصناف أو الصنف.</p>
        <div class="pc-fields">
          <label class="field"><span>بضاعة مستلمة غير مفوترة (دائن عند الاستلام)</span>
            <select v-model="st.grniAccountId" class="input"><option value="">—</option><option v-for="a in accs(['liabilities'])" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select>
            <small class="pm-muted">يُقفل عند تسجيل فاتورة المورد في المرحلة الرابعة.</small></label>
          <label class="field"><span>فروقات المخزون (الجرد والإتلاف وفروق المرتجع)</span>
            <select v-model="st.adjustAccountId" class="input"><option value="">—</option><option v-for="a in accs(['expenses'])" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select></label>
          <label class="field"><span>مركز تكلفة الفروقات</span>
            <select v-model="st.adjustAnalyticId" class="input"><option value="">—</option><option v-for="a in slk?.analytics ?? []" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select>
            <small class="pm-muted">يلزم إذا كان حساب الفروقات يتطلب مركز تكلفة.</small></label>
          <label class="field"><span>مقابل الأرصدة الافتتاحية</span>
            <select v-model="st.openingAccountId" class="input"><option value="">—</option><option v-for="a in accs(['net_assets'])" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select></label>
          <label class="field"><span>المصروف الافتراضي للبنود الحرة والخدمات</span>
            <select v-model="st.defaultExpenseAccountId" class="input"><option value="">—</option><option v-for="a in accs(['expenses'])" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select></label>
          <label class="field"><span>تنبيه الصلاحية قبل (يوم)</span><input v-model.number="st.expiryAlertDays" type="number" min="1" max="730" class="input" /></label>
          <label class="field"><span>نسبة الزيادة المسموحة في الاستلام %</span><input v-model.number="st.overReceiptPct" type="number" min="0" max="50" class="input" /></label>
        </div>
        <label class="pc-inline" style="margin: 8px 0"><input v-model="st.vatInCost" type="checkbox" /> ضريبة القيمة المضافة غير مستردة وتدخل في تكلفة الصنف</label>
        <label class="pc-inline" style="margin: 8px 0"><input v-model="st.requireInspection" type="checkbox" /> محضر لجنة الاستلام والفحص إلزامي في كل استلام بتعميد</label>
        <div><button class="btn btn-primary" :disabled="busy" @click="saveStock">حفظ</button></div>
      </section>

      <ModulePermissionsPane v-else-if="tab === 'permissions'" module="procurement" />
    </template>
  </div>
</template>
