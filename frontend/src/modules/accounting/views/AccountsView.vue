<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import SearchSelect from '../../../shared/SearchSelect.vue';
import { downloadReport } from '../../../components/reports/reports';
import { downloadFile } from '../assets';
import { KINDS, NATURES, P, dc, natureColor, useAccounts, type Account } from '../lib';
import '../../../shared/module.css';
import '../acc.css';

const session = useSession();
const toast = useToast();
const { accounts, postingLevel, chartInstalledAt, load } = useAccounts();
const error = ref('');
const search = ref('');
const nature = ref('');
const open = ref(new Set<string>());
onMounted(async () => {
  try {
    await load();
    accounts.value.filter((a) => a.level === 1).forEach((a) => open.value.add(a.id));
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const byParent = computed(() => {
  const m = new Map<string | null, Account[]>();
  for (const a of accounts.value) m.set(a.parentId, [...(m.get(a.parentId) ?? []), a]);
  return m;
});
const norm = (s: string) => s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
const visible = computed(() => {
  const q = norm(search.value.trim());
  if (q || nature.value) {
    return accounts.value.filter((a) => (!nature.value || a.nature === nature.value) && (!q || a.code.startsWith(q) || norm(a.name).includes(q))).slice(0, 400);
  }
  const out: Account[] = [];
  const walk = (pid: string | null) => {
    for (const a of byParent.value.get(pid) ?? []) {
      out.push(a);
      if (open.value.has(a.id)) walk(a.id);
    }
  };
  walk(null);
  return out;
});
const flat = computed(() => !!(search.value.trim() || nature.value));
function toggle(a: Account) {
  if (open.value.has(a.id)) open.value.delete(a.id);
  else open.value.add(a.id);
  open.value = new Set(open.value);
}
function expandAll(on: boolean) {
  open.value = on ? new Set(accounts.value.filter((a) => a.kind !== 'sub').map((a) => a.id)) : new Set();
}
const stats = computed(() => ({
  total: accounts.value.length, subs: accounts.value.filter((a) => a.kind === 'sub').length,
  levels: Math.max(0, ...accounts.value.map((a) => a.level)), analytic: accounts.value.filter((a) => a.requiresAnalytic).length,
}));

// ---------------- الإضافة والتعديل ----------------
const editing = ref<Account | null>(null);
const show = ref(false);
const form = reactive({ code: '', name: '', kind: 'sub', nature: 'assets', parentId: null as string | null, requiresAnalytic: false, description: '', isActive: true });
const parentOptions = computed(() => accounts.value.filter((a) => a.kind !== 'sub' && a.level < 9).map((a) => ({ id: a.id, label: `${a.code} ${a.name}`, sub: `المستوى ${a.level}` })));
function openNew(parent?: Account) {
  editing.value = null;
  copiedFrom.value = null;
  const siblings = parent ? byParent.value.get(parent.id) ?? [] : [];
  Object.assign(form, {
    code: parent ? suggestCode(parent, siblings) : '', name: '', kind: parent ? (postingLevel.value && parent.level + 1 >= postingLevel.value ? 'sub' : 'main') : 'root',
    nature: parent?.nature ?? 'assets', parentId: parent?.id ?? null, requiresAnalytic: parent?.nature === 'expenses', description: '', isActive: true,
  });
  show.value = true;
}
/** نسخ إعداد حساب سابق: نفس الأب والنوع والطبيعة والتحليلي والوصف، برقم جديد مقترح، ثم تعدّل ما تريد */
function openCopy(a: Account) {
  editing.value = null;
  const parent = accounts.value.find((x) => x.id === a.parentId);
  const siblings = parent ? byParent.value.get(parent.id) ?? [] : accounts.value.filter((x) => x.kind === 'root');
  Object.assign(form, {
    code: parent ? suggestCode(parent, siblings) : '', name: a.name, kind: a.kind, nature: a.nature, parentId: a.parentId,
    requiresAnalytic: a.requiresAnalytic, description: a.description ?? '', isActive: true,
  });
  copiedFrom.value = a;
  show.value = true;
}
const copiedFrom = ref<Account | null>(null);
// الحساب الجديد يأخذ طبيعة أبيه تلقائيًا عند اختيار الأب (ويمكن تغييرها)
watch(() => form.parentId, (id) => {
  if (editing.value || !id || (copiedFrom.value && copiedFrom.value.parentId === id)) return;
  const p = accounts.value.find((a) => a.id === id);
  if (p) { form.nature = p.nature; if (form.kind !== 'sub') form.requiresAnalytic = false; else form.requiresAnalytic = p.nature === 'expenses'; }
});
const parentLabel = computed(() => { const p = accounts.value.find((a) => a.id === form.parentId); return p ? `${p.code} ${p.name}` : ''; });
function suggestCode(parent: Account, siblings: Account[]) {
  const last = siblings.map((s) => s.code).filter((c) => /^\d+$/.test(c)).sort((a, b) => Number(a) - Number(b)).at(-1);
  if (last) return String(Number(last) + 1).padStart(last.length, '0');
  return `${parent.code}01`;
}
function openEdit(a: Account) {
  editing.value = a;
  copiedFrom.value = null;
  Object.assign(form, { code: a.code, name: a.name, kind: a.kind, nature: a.nature, parentId: a.parentId, requiresAnalytic: a.requiresAnalytic, description: a.description ?? '', isActive: a.isActive });
  show.value = true;
}
const parentLevel = computed(() => accounts.value.find((a) => a.id === form.parentId)?.level ?? 0);
async function save() {
  try {
    const body = { ...form, description: form.description || null, parentId: form.kind === 'root' ? null : form.parentId };
    if (editing.value) {
      const { parentId: _p, ...rest } = body;
      await api(`/accounting/accounts/${editing.value.id}`, { method: 'PATCH', json: rest });
    } else {
      await api('/accounting/accounts', { method: 'POST', json: body });
    }
    toast.success(editing.value ? 'تم تعديل الحساب' : 'تمت إضافة الحساب');
    show.value = false;
    await load();
    if (form.parentId) open.value = new Set([...open.value, form.parentId]);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove(a: Account) {
  if (!confirm(`حذف الحساب ${a.code} ${a.name}؟`)) return;
  try {
    await api(`/accounting/accounts/${a.id}`, { method: 'DELETE' });
    toast.success('تم حذف الحساب');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const canManage = computed(() => session.can(P.accounts));

// ---------------- التصدير والاستيراد ----------------
const exporting = ref('');
async function exportChart(format: 'xlsx' | 'pdf') {
  exporting.value = format;
  try {
    await downloadReport('accounting.chart', format, { level: '9' });
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    exporting.value = '';
  }
}
interface ImportResult {
  mode: 'check' | 'apply'; total: number; created: number;
  accepted: { row: number; code: string; name: string; kind: string; nature: string; parentCode: string | null; level: number }[];
  skipped: { row: number; code: string; name: string; reasons: string[] }[];
}
const importOpen = ref(false);
const importFile = ref<File | null>(null);
const importBusy = ref(false);
const importResult = ref<ImportResult | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
function openImport() { importOpen.value = true; importFile.value = null; importResult.value = null; }
async function importTemplate() {
  try {
    await downloadFile('/accounting/accounts/import/template', 'نموذج استيراد الدليل المحاسبي.xlsx');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function pickImport(e: Event) { importFile.value = (e.target as HTMLInputElement).files?.[0] ?? null; importResult.value = null; }
/** check: فحص وتقرير دون حفظ. apply: إضافة الحسابات المطابقة فقط بعد موافقة المستخدم */
async function runImport(mode: 'check' | 'apply') {
  if (!importFile.value) return;
  importBusy.value = true;
  try {
    const fd = new FormData();
    fd.append('file', importFile.value);
    fd.append('mode', mode);
    importResult.value = await api<ImportResult>('/accounting/accounts/import', { method: 'POST', body: fd });
    if (mode === 'apply') {
      toast.success(`أُضيف ${importResult.value.created} حسابًا${importResult.value.skipped.length ? `، واستُبعد ${importResult.value.skipped.length}` : ''}`);
      await load();
    }
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    importBusy.value = false;
  }
}
const natureLabel = (n: string) => NATURES.find((x) => x.value === n)?.label ?? n;
const kindLabel = (k: string) => KINDS.find((x) => x.value === k)?.label ?? k;
</script>

<template>
  <div>
    <section class="pm-hero ac-hero">
      <div>
        <p class="pm-kicker">النظام المالي</p>
        <h1>الدليل المحاسبي</h1>
        <p class="pm-sub">جذري ← رئيسي ← فرعي، حتى 9 مستويات. التسجيل على الحسابات الفرعية فقط، وكلها في مستوى واحد<template v-if="postingLevel"> (المستوى {{ postingLevel }})</template>.</p>
      </div>
      <div class="pm-actions">
        <button v-if="canManage" class="btn ac-glow" @click="openNew()">حساب جذري جديد</button>
        <button v-if="canManage" class="btn ac-ghost" @click="openImport()">استيراد من Excel</button>
        <button v-if="accounts.length" class="btn ac-ghost" :disabled="!!exporting" @click="exportChart('xlsx')">{{ exporting === 'xlsx' ? 'جارٍ التصدير...' : 'تصدير Excel' }}</button>
        <button v-if="accounts.length" class="btn ac-ghost" :disabled="!!exporting" @click="exportChart('pdf')">{{ exporting === 'pdf' ? 'جارٍ التصدير...' : 'تصدير PDF' }}</button>
        <RouterLink v-if="!accounts.length && session.can(P.settings)" to="/accounting/settings" class="btn ac-ghost">تنصيب دليل الشركات الجاهز</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #0ea5e9; --i: 0"><span>عدد الحسابات</span><strong>{{ stats.total.toLocaleString('en') }}</strong><small>{{ chartInstalledAt ? 'دليل الشركات الجاهز' : 'دليل مخصص' }}</small></div>
      <div class="pm-kpi" style="--a: #10b981; --i: 1"><span>حسابات فرعية</span><strong>{{ stats.subs.toLocaleString('en') }}</strong><small>يُسجَّل عليها فقط</small></div>
      <div class="pm-kpi" style="--a: #8b5cf6; --i: 2"><span>المستويات</span><strong>{{ stats.levels }}</strong><small>الحد الأقصى 9</small></div>
      <div class="pm-kpi" style="--a: #f59e0b; --i: 3"><span>تتطلب تحليليًا</span><strong>{{ stats.analytic.toLocaleString('en') }}</strong><small>مركز تكلفة إلزامي</small></div>
    </div>

    <section class="card pm-panel">
      <div class="ac-toolbar">
        <input v-model="search" class="input grow" placeholder="ابحث برقم الحساب أو اسمه..." />
        <select v-model="nature" class="input"><option value="">كل الطبائع</option><option v-for="n in NATURES" :key="n.value" :value="n.value">{{ n.label }}</option></select>
        <template v-if="!flat"><button class="btn btn-sm" @click="expandAll(true)">توسيع الكل</button><button class="btn btn-sm" @click="expandAll(false)">طي الكل</button></template>
      </div>
      <div v-if="!accounts.length" class="ac-empty-state">
        <div class="ic">📒</div>
        <h3>الدليل المحاسبي فارغ</h3>
        <p class="pm-muted">نصّب دليل الشركات الجاهز من الإعدادات بضغطة واحدة، أو استورده من ملف Excel، أو ابدأ بإضافة الحسابات الجذرية يدويًا.</p>
      </div>
      <div v-else class="table-wrap">
        <table class="table tree">
          <thead><tr><th>رقم الحساب واسمه</th><th>النوع</th><th>الطبيعة</th><th>المستوى</th><th>الرصيد</th><th v-if="canManage"></th></tr></thead>
          <tbody>
            <tr v-for="a in visible" :key="a.id" :class="['ac-tree-row', `k-${a.kind}`, { off: !a.isActive }]">
              <td>
                <span v-if="!flat" class="ac-indent" :style="{ width: (a.level - 1) * 18 + 'px' }" />
                <button v-if="!flat && a.children" :class="['ac-toggle', { open: open.has(a.id) }]" @click="toggle(a)">◀</button>
                <span v-else-if="!flat" class="ac-toggle" />
                <span class="ac-code code">{{ a.code }}</span> <span class="nm">{{ a.name }}</span>
                <span v-if="a.requiresAnalytic" class="pm-tag" title="يتطلب حسابًا تحليليًا">تحليلي</span>
                <span v-if="!a.isActive" class="pm-tag">موقوف</span>
              </td>
              <td>{{ a.kindLabel }}</td>
              <td><span class="pm-pill" :style="{ '--c': natureColor(a.nature) }">{{ a.natureLabel }}</span></td>
              <td class="ac-code">{{ a.level }}</td>
              <td class="ac-num" :class="a.balance > 0 ? 'ac-dr' : a.balance < 0 ? 'ac-cr' : 'pm-muted'">{{ dc(a.balance) }}</td>
              <td v-if="canManage" class="acts">
                <button v-if="a.kind !== 'sub' && a.level < 9" class="btn btn-sm" title="إضافة حساب تحته" @click="openNew(a)">+</button>
                <button class="btn btn-sm" @click="openEdit(a)">تعديل</button>
                <button v-if="a.kind !== 'root'" class="btn btn-sm" title="نسخ إعداد هذا الحساب لإنشاء حساب جديد" @click="openCopy(a)">نسخ</button>
                <button v-if="!a.moves && !a.children" class="btn btn-sm btn-danger" @click="remove(a)">حذف</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="flat && visible.length === 400" class="pm-muted">تُعرض أول 400 نتيجة، حدّد البحث أكثر.</p>
      </div>
    </section>

    <div v-if="show" class="modal-backdrop" @click.self="show = false">
      <form class="card modal" @submit.prevent="save">
        <h2>{{ editing ? 'تعديل حساب' : copiedFrom ? 'حساب جديد منسوخ' : 'إضافة حساب' }}</h2>
        <p v-if="copiedFrom" class="pm-muted">منسوخ من {{ copiedFrom.code }} {{ copiedFrom.name }}: غيّر الرقم والاسم وما تريد قبل الحفظ.</p>
        <label class="field"><span>نوع الحساب</span>
          <select v-model="form.kind" class="input" :disabled="!!editing && editing.moves > 0"><option v-for="k in KINDS" :key="k.value" :value="k.value">{{ k.label }}</option></select>
        </label>
        <label v-if="form.kind !== 'root'" class="field"><span>الحساب الأب</span>
          <SearchSelect v-if="!editing" v-model="form.parentId" :options="parentOptions" :selected-label="parentLabel" placeholder="ابحث برقم الحساب الأب أو اسمه" required />
          <input v-else class="input" disabled :value="accounts.find((a) => a.id === form.parentId)?.name" />
          <small v-if="form.parentId" class="pm-muted">الحساب الجديد في المستوى {{ parentLevel + 1 }}، ويأخذ طبيعة أبيه «{{ natureLabel(accounts.find((a) => a.id === form.parentId)?.nature ?? '') }}»</small>
        </label>
        <div class="field-row">
          <label class="field"><span>رقم الحساب</span><input v-model="form.code" class="input ac-code" required :disabled="!!editing && editing.moves > 0" /></label>
          <label class="field"><span>طبيعة الحساب</span>
            <select v-model="form.nature" class="input" :disabled="!!editing && editing.moves > 0"><option v-for="n in NATURES" :key="n.value" :value="n.value">{{ n.label }}</option></select>
          </label>
        </div>
        <label class="field"><span>اسم الحساب</span><input v-model="form.name" class="input" required /></label>
        <label class="field"><span>وصف (اختياري)</span><textarea v-model="form.description" class="input" rows="2" /></label>
        <label class="check"><input v-model="form.requiresAnalytic" type="checkbox" /> يتطلب حسابًا تحليليًا (لا يُقبل القيد عليه بدونه)</label>
        <label class="check"><input v-model="form.isActive" type="checkbox" /> نشط</label>
        <p class="pm-muted">لا يُفتح حساب تحت حساب فرعي، والجذري بلا أب، ولا يتكرر رقم الحساب، والحساب الفرعي الذي عليه معاملات لا يُلغى.</p>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="show = false">إلغاء</button></div>
      </form>
    </div>
    <div v-if="importOpen" class="modal-backdrop" @click.self="!importBusy && (importOpen = false)">
      <div class="card modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="imp-title">
        <h2 id="imp-title">استيراد الدليل المحاسبي من Excel</h2>
        <ol class="imp-steps">
          <li>نزّل النموذج واكتب حساباتك فيه (الرقم، الاسم، رقم الأب، النوع، الطبيعة). <button class="link" type="button" @click="importTemplate">تنزيل النموذج</button></li>
          <li>ارفع الملف واضغط «فحص الملف»: يظهر تقرير بالحسابات المطابقة والمستبعدة وسبب كل استبعاد، ولا يُحفظ شيء.</li>
          <li>اضغط «اعتماد الاستيراد» لإضافة الحسابات المطابقة فقط. الحساب غير المطابق وكل ما تحته لا يُدرج، والحسابات الموجودة لا تتغير.</li>
        </ol>
        <input ref="fileInput" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="input" @change="pickImport" />
        <template v-if="importResult">
          <div :class="['alert', importResult.skipped.length ? 'alert-error' : 'alert-success']" style="margin-top: 12px">
            <template v-if="importResult.mode === 'check'">نتيجة الفحص: {{ importResult.total }} حسابًا في الملف، المطابق منها {{ importResult.accepted.length }} والمستبعد {{ importResult.skipped.length }}. لم يُحفظ شيء بعد.</template>
            <template v-else>تم الاستيراد: أُضيف {{ importResult.created }} حسابًا، واستُبعد {{ importResult.skipped.length }}.</template>
          </div>
          <template v-if="importResult.skipped.length">
            <h3 class="imp-h">الحسابات التي لم تُدرج وسبب كل منها</h3>
            <div class="table-wrap imp-table">
              <table class="table"><thead><tr><th>الصف</th><th>رقم الحساب</th><th>الاسم</th><th>السبب</th></tr></thead>
                <tbody><tr v-for="x in importResult.skipped" :key="x.row"><td class="ac-code">{{ x.row }}</td><td class="ac-code">{{ x.code || '—' }}</td><td>{{ x.name || '—' }}</td><td><div v-for="(m, i) in x.reasons" :key="i">{{ m }}</div></td></tr></tbody>
              </table>
            </div>
          </template>
          <template v-if="importResult.mode === 'check' && importResult.accepted.length">
            <h3 class="imp-h">الحسابات المطابقة ({{ importResult.accepted.length }})</h3>
            <div class="table-wrap imp-table">
              <table class="table"><thead><tr><th>رقم الحساب</th><th>الاسم</th><th>الأب</th><th>النوع</th><th>الطبيعة</th><th>المستوى</th></tr></thead>
                <tbody><tr v-for="x in importResult.accepted" :key="x.row"><td class="ac-code">{{ x.code }}</td><td>{{ x.name }}</td><td class="ac-code">{{ x.parentCode ?? '—' }}</td><td>{{ kindLabel(x.kind) }}</td><td>{{ natureLabel(x.nature) }}</td><td class="ac-code">{{ x.level }}</td></tr></tbody>
              </table>
            </div>
          </template>
        </template>
        <div class="modal-actions">
          <button v-if="!importResult || importResult.mode === 'apply'" class="btn btn-primary" :disabled="!importFile || importBusy" @click="runImport('check')">{{ importBusy ? 'جارٍ الفحص...' : 'فحص الملف' }}</button>
          <button v-else class="btn btn-primary" :disabled="importBusy || !importResult.accepted.length" @click="runImport('apply')">{{ importBusy ? 'جارٍ الاستيراد...' : `اعتماد الاستيراد (${importResult.accepted.length} حساب)` }}</button>
          <button class="btn" :disabled="importBusy" @click="importOpen = false">إغلاق</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tree td { padding-top: 7px; padding-bottom: 7px; }
.k-root .nm { font-weight: 800; }
.k-main .nm { font-weight: 600; }
.k-sub .code { color: var(--primary); }
.off { opacity: .55; }
.acts { white-space: nowrap; display: flex; gap: 4px; justify-content: flex-end; }
.check { display: flex; gap: 8px; align-items: center; margin: 4px 0; }
.imp-steps { margin: 6px 0 12px; padding-inline-start: 20px; line-height: 1.9; }
.imp-h { font-size: 1rem; margin: 14px 0 6px; }
.imp-table { max-height: 260px; overflow: auto; }
.link { background: none; border: 0; color: var(--primary); text-decoration: underline; cursor: pointer; font: inherit; }
</style>
