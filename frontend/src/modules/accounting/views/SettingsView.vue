<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { useToast } from '../../../stores/toast';
import SearchSelect from '../../fundraising/components/SearchSelect.vue';
import { dt, useAccounts } from '../lib';
import '../../projects/projects.css';
import '../acc.css';

interface Category { id: string; name: string; behavior: 'customer' | 'supplier' | 'other'; behaviorLabel: string; partners: number }
interface Settings { analyticLevels: number; warehouseTypes: string[]; chartInstalledAt: string | null; closingAccount: { id: string; code: string; name: string } | null; categories: Category[] }
interface ChartInfo { name: string; accounts: number; postingAccounts: number; levels: number; installedAt: string | null; canInstall: boolean; existingAccounts: number }
interface Stage { id?: string | null; name: string; instructions: string | null; roleId: string | null; pending?: number }

const toast = useToast();
type Tab = 'general' | 'chart' | 'receipt' | 'payment' | 'categories' | 'warehouses' | 'permissions';
const tabs: { key: Tab; label: string }[] = [
  { key: 'general', label: 'عام' }, { key: 'chart', label: 'الدليل الموحد' }, { key: 'receipt', label: 'مراحل اعتماد القبض' }, { key: 'payment', label: 'مراحل اعتماد الصرف' },
  { key: 'categories', label: 'تصنيفات العملاء والموردين' }, { key: 'warehouses', label: 'أنواع المستودعات' }, { key: 'permissions', label: 'الصلاحيات' },
];
const tab = ref<Tab>('general');
const s = ref<Settings | null>(null);
const chart = ref<ChartInfo | null>(null);
const roles = ref<{ id: string; name: string }[]>([]);
const stages = ref<Record<'receipt' | 'payment', Stage[]>>({ receipt: [], payment: [] });
const { load: loadAccounts, subOptions } = useAccounts();
const busy = ref(false);
const levels = ref(3);
const closingId = ref<string | null>(null);
const whTypes = ref<string[]>([]);

async function load() {
  const [st, ch, r, sr, sp] = await Promise.all([
    api<Settings>('/accounting/settings'), api<ChartInfo>('/accounting/chart'),
    api<{ roles: { id: string; name: string }[] }>('/roles/module/accounting').catch(() => ({ roles: [] })),
    api<Stage[]>('/accounting/voucher-stages/receipt'), api<Stage[]>('/accounting/voucher-stages/payment'),
  ]);
  s.value = st; chart.value = ch; roles.value = r.roles; stages.value = { receipt: sr, payment: sp };
  levels.value = st.analyticLevels; closingId.value = st.closingAccount?.id ?? null; whTypes.value = [...st.warehouseTypes];
}
onMounted(() => { load(); loadAccounts().catch(() => {}); });

async function patch(json: object, msg = 'تم حفظ الإعدادات') {
  busy.value = true;
  try {
    s.value = await api<Settings>('/accounting/settings', { method: 'PATCH', json });
    toast.success(msg);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}

// ---------------- تنصيب الدليل ----------------
const confirmOpen = ref(false);
const typed = ref('');
const installed = ref<{ installed: number; postingAccounts: number } | null>(null);
async function install() {
  busy.value = true;
  try {
    installed.value = await api('/accounting/chart/install', { method: 'POST' });
    confirmOpen.value = false;
    toast.success('تم تنصيب الدليل المحاسبي الموحد');
    await load();
    await loadAccounts();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}

// ---------------- مراحل الاعتماد ----------------
async function saveStages(kind: 'receipt' | 'payment') {
  busy.value = true;
  try {
    stages.value[kind] = await api<Stage[]>(`/accounting/voucher-stages/${kind}`, {
      method: 'PUT', json: { stages: stages.value[kind].map((x) => ({ id: x.id || null, name: x.name, instructions: x.instructions || null, roleId: x.roleId || null })) },
    });
    toast.success('تم حفظ مراحل الاعتماد');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
function move(list: Stage[], i: number, d: number) {
  const [x] = list.splice(i, 1);
  list.splice(i + d, 0, x);
}

// ---------------- التصنيفات ----------------
const newCat = ref({ name: '', behavior: 'customer' as Category['behavior'] });
async function addCat() {
  try {
    await api('/accounting/categories', { method: 'POST', json: newCat.value });
    newCat.value = { name: '', behavior: 'customer' };
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function removeCat(c: Category) {
  if (!confirm(`حذف التصنيف «${c.name}»؟`)) return;
  try {
    await api(`/accounting/categories/${c.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const kindStages = computed(() => (tab.value === 'receipt' || tab.value === 'payment' ? stages.value[tab.value] : []));
</script>

<template>
  <div>
    <section class="pm-hero ac-hero">
      <div>
        <p class="pm-kicker">النظام المالي</p>
        <h1>إعدادات النظام المالي</h1>
        <p class="pm-sub">الدليل الموحد، مستويات التحليلي، حساب إقفال النتائج، مراحل اعتماد السندات، التصنيفات، والصلاحيات.</p>
      </div>
    </section>
    <div class="pm-tabs">
      <button v-for="t in tabs" :key="t.key" :class="['pm-tab', { on: tab === t.key }]" @click="tab = t.key">{{ t.label }}</button>
    </div>

    <template v-if="s && chart">
      <section v-if="tab === 'general'" class="card pm-panel">
        <h2>إعدادات عامة</h2>
        <div class="field-row">
          <label class="field"><span>مستويات الحسابات التحليلية</span>
            <select v-model.number="levels" class="input"><option :value="2">مستويان (رئيسي ← فرعي)</option><option :value="3">ثلاثة مستويات</option></select>
          </label>
          <label class="field" style="grid-column: span 2"><span>حساب إقفال نتائج النشاط (من حسابات صافي الأصول)</span>
            <SearchSelect v-model="closingId" :options="subOptions((a) => a.nature === 'net_assets')" :selected-label="s.closingAccount ? `${s.closingAccount.code} ${s.closingAccount.name}` : ''" placeholder="ابحث في صافي الأصول" />
          </label>
        </div>
        <p class="pm-muted">عند فتح سنة جديدة لا تُرحَّل أرصدة الإيرادات والمصروفات، وتُقفل نتيجتها (الفائض أو العجز) في هذا الحساب.</p>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy" @click="patch({ analyticLevels: levels, closingAccountId: closingId })">حفظ</button></div>
      </section>

      <section v-if="tab === 'chart'" class="card pm-panel chartbox">
        <div class="chart-hero">
          <div class="book">📘</div>
          <div>
            <h2 style="justify-content: flex-start">{{ chart.name }}</h2>
            <p class="pm-muted">{{ chart.accounts.toLocaleString('en') }} حسابًا، منها {{ chart.postingAccounts }} حسابًا فرعيًا للتسجيل في المستوى {{ chart.levels }}. تُنشأ معه مراكز التكلفة حسب التصنيف الوظيفي للمصروفات، ويُضبط حساب الإقفال على «صافي الأصول غير المقيدة».</p>
          </div>
        </div>
        <ul class="facts">
          <li>راجعنا الدليل قبل تنصيبه: صُححت أخطاء ترقيم في النسخة المطبوعة، ووُحِّدت الحسابات الفرعية في مستوى واحد بحساب تفصيلي بالاسم نفسه حيث لزم، كما توصي تعليمات الدليل.</li>
          <li>حسابات المصروفات الفرعية تتطلب حسابًا تحليليًا (مركز تكلفة) في كل قيد.</li>
          <li>التنصيب متاح في بداية الإعداد فقط والدليل فارغ، ويمكن بعده إضافة حسابات خاصة بالجمعية.</li>
        </ul>
        <div v-if="chart.installedAt" class="alert alert-success">تم تنصيب الدليل الموحد في {{ dt(chart.installedAt) }}.</div>
        <div v-else-if="!chart.canInstall" class="alert alert-error">في الدليل {{ chart.existingAccounts }} حساب بالفعل، والتنصيب متاح في بداية الإعداد فقط والدليل فارغ.</div>
        <button v-else class="btn ac-glow big" :disabled="busy" @click="confirmOpen = true; typed = ''">تنصيب الدليل المحاسبي الموحد</button>
        <div v-if="installed" class="alert alert-success" style="margin-top: 10px">نُصّب {{ installed.installed }} حسابًا. <RouterLink to="/accounting/accounts" class="pm-link">افتح الدليل المحاسبي</RouterLink></div>
      </section>

      <section v-if="tab === 'receipt' || tab === 'payment'" class="card pm-panel">
        <h2>مراحل اعتماد {{ tab === 'receipt' ? 'سندات القبض' : 'سندات الصرف' }}</h2>
        <p class="pm-muted">يمر السند على المراحل بالترتيب، وفي كل مرحلة: موافقة أو رفض أو إرجاع للتعديل. الموافقة في آخر مرحلة تحوّل السند إلى قيد مرحّل. بدون مراحل يُعتمد السند مباشرة ممن لديه صلاحية اعتماد السندات.
          <template v-if="tab === 'payment'"> صاحب قرار المرحلة الأخيرة هو المعتمد النهائي، وهو وحده من يعيد سند الصرف للمسودة أو يلغيه.</template></p>
        <TransitionGroup name="list" tag="div">
          <div v-for="(x, i) in kindStages" :key="x.id ?? `n${i}`" class="stage">
            <span class="num">{{ i + 1 }}</span>
            <div class="grow">
              <div class="field-row">
                <input v-model="x.name" class="input" placeholder="اسم المرحلة (مثل: المراجع المالي)" />
                <select v-model="x.roleId" class="input"><option :value="null">أي مستخدم معه صلاحية اعتماد السندات</option><option v-for="r in roles" :key="r.id" :value="r.id">الدور: {{ r.name }}</option></select>
              </div>
              <input v-model="x.instructions" class="input" placeholder="تعليمات للمعتمد (اختياري)" style="margin-top: 6px" />
              <small v-if="x.pending" class="pm-muted">{{ x.pending }} سند ينتظر في هذه المرحلة</small>
            </div>
            <div class="ops">
              <button class="btn btn-sm" :disabled="i === 0" @click="move(kindStages, i, -1)">▲</button>
              <button class="btn btn-sm" :disabled="i === kindStages.length - 1" @click="move(kindStages, i, 1)">▼</button>
              <button class="btn btn-sm btn-danger" @click="kindStages.splice(i, 1)">✕</button>
            </div>
          </div>
        </TransitionGroup>
        <button class="btn btn-sm" @click="kindStages.push({ name: '', instructions: null, roleId: null })">+ إضافة مرحلة</button>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy" @click="saveStages(tab as 'receipt' | 'payment')">حفظ المراحل</button></div>
      </section>

      <section v-if="tab === 'categories'" class="card pm-panel">
        <h2>تصنيفات العملاء والموردين</h2>
        <table class="table">
          <thead><tr><th>التصنيف</th><th>السلوك</th><th>عدد الشركاء</th><th></th></tr></thead>
          <tbody>
            <tr v-for="c in s.categories" :key="c.id"><td>{{ c.name }}</td><td>{{ c.behaviorLabel }}</td><td>{{ c.partners }}</td><td><button v-if="!c.partners" class="btn btn-sm btn-danger" @click="removeCat(c)">حذف</button></td></tr>
          </tbody>
        </table>
        <div class="ac-toolbar" style="margin-top: 10px">
          <input v-model="newCat.name" class="input grow" placeholder="اسم التصنيف (مثل: متبرعون عينيون)" />
          <select v-model="newCat.behavior" class="input"><option value="customer">عملاء (حساب مدينين وحد ائتماني)</option><option value="supplier">موردون (حساب دائنين)</option><option value="other">تصنيف آخر</option></select>
          <button class="btn btn-primary" :disabled="!newCat.name" @click="addCat">إضافة</button>
        </div>
      </section>

      <section v-if="tab === 'warehouses'" class="card pm-panel">
        <h2>أنواع المستودعات</h2>
        <div v-for="(_, i) in whTypes" :key="i" class="ac-toolbar"><input v-model="whTypes[i]" class="input grow" /><button class="btn btn-sm" @click="whTypes.splice(i, 1)">✕</button></div>
        <button class="btn btn-sm" @click="whTypes.push('')">+ نوع</button>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy" @click="patch({ warehouseTypes: whTypes })">حفظ</button></div>
      </section>

      <ModulePermissionsPane v-if="tab === 'permissions'" module="accounting" />
    </template>

    <div v-if="confirmOpen" class="modal-backdrop" @click.self="confirmOpen = false">
      <div class="card modal">
        <h2>تأكيد تنصيب الدليل الموحد</h2>
        <p>سيُضاف إلى الدليل المحاسبي <b>{{ chart?.accounts.toLocaleString('en') }}</b> حسابًا من «{{ chart?.name }}»، ومراكز التكلفة الوظيفية الخمسة. لا يمكن تنصيبه مرة أخرى بعد ذلك.</p>
        <label class="field"><span>للتأكيد اكتب: تنصيب</span><input v-model="typed" class="input" /></label>
        <div class="modal-actions">
          <button class="btn btn-primary" :disabled="busy || typed.trim() !== 'تنصيب'" @click="install">{{ busy ? 'جارٍ التنصيب...' : 'نعم، نصّب الدليل' }}</button>
          <button class="btn" @click="confirmOpen = false">إلغاء</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chartbox { position: relative; overflow: hidden; }
.chart-hero { display: flex; gap: 18px; align-items: center; margin-bottom: 10px; }
.book { font-size: 3rem; width: 86px; height: 86px; flex: 0 0 86px; display: grid; place-items: center; border-radius: 24px; background: linear-gradient(135deg, #e0f2fe, #ccfbf1); animation: ac-float 4s ease-in-out infinite; box-shadow: 0 10px 30px rgba(14,165,233,.25); }
.facts { margin: 0 0 16px; padding-inline-start: 20px; color: var(--muted); line-height: 1.9; }
.big { padding: 12px 26px; font-size: 1.05rem; }
.stage { display: flex; gap: 12px; align-items: flex-start; border: 1px solid var(--border); border-radius: 14px; padding: 12px; margin-bottom: 10px; background: var(--surface); }
.stage .num { width: 32px; height: 32px; flex: 0 0 32px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; color: #fff; background: var(--grad); box-shadow: 0 0 12px rgba(20,184,166,.4); }
.stage .grow { flex: 1; }
.stage .ops { display: flex; gap: 4px; }
.list-move, .list-enter-active, .list-leave-active { transition: all .3s var(--ease); }
.list-enter-from, .list-leave-to { opacity: 0; transform: translateX(-20px); }
</style>
