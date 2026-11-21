<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../../api';
import { useSession } from '../../../../stores/session';
import { useToast } from '../../../../stores/toast';
import SearchSelect from '../../../../shared/SearchSelect.vue';
import { AF, FIELD_TYPES, useLookups, type FieldDef, type Group, type Recon } from '../../assets';
import { P, loadAnalytic, sar, useAccounts, type Analytic } from '../../lib';
import '../../../../shared/module.css';
import '../../acc.css';
import './assets.css';

const session = useSession();
const toast = useToast();
const route = useRoute();
const { load: reloadLookups } = useLookups();
const tab = ref<'groups' | 'recon'>(route.query.tab === 'recon' ? 'recon' : 'groups');
const groups = ref<Group[]>([]);
const recon = ref<Recon | null>(null);
const error = ref('');
const { load: loadAccounts, subOptions } = useAccounts();
const analytic = ref<Analytic[]>([]);
const asOf = ref('');

async function load() {
  try {
    groups.value = await api<Group[]>(`${AF}/groups`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function loadRecon() {
  try {
    recon.value = await api<Recon>(`${AF}/reconciliation${asOf.value ? `?asOf=${asOf.value}` : ''}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => {
  load();
  loadRecon();
  loadAccounts().catch(() => {});
  loadAnalytic().then((r) => (analytic.value = r.accounts.filter((a) => a.kind === 'sub' && a.isActive))).catch(() => {});
});
const reconOf = (g: Group) => recon.value?.groups.find((x) => x.groupId === g.id);

// ---------------- نموذج المجموعة ----------------
interface FieldForm { key?: string; label: string; type: FieldDef['type']; required: boolean; expiry: boolean; options: string }
const show = ref(false);
const editing = ref<Group | null>(null);
const busy = ref(false);
const form = reactive({
  code: '', name: '', description: '', method: 'straight_line', rate: 10 as number | null, lifeYears: null as number | null, useLife: false, isTangible: true, isActive: true,
  assetAccountId: null as string | null, accumAccountId: null as string | null, expenseAccountId: null as string | null, gainLossAccountId: null as string | null,
  analyticId: '' as string, depreciable: true, fields: [] as FieldForm[],
});
const assetOpts = computed(() => subOptions((a) => a.nature === 'assets'));
const accumOpts = computed(() => subOptions((a) => a.nature === 'assets' || a.nature === 'liabilities'));
const expenseOpts = computed(() => subOptions((a) => a.nature === 'expenses'));
const glOpts = computed(() => subOptions((a) => a.nature === 'revenue' || a.nature === 'expenses'));
const accLabel = (r: { code: string; name: string } | null | undefined) => (r ? `${r.code} ${r.name}` : '');
const derivedLife = computed(() => (form.depreciable && !form.useLife && form.rate ? Math.round((100 / form.rate) * 100) / 100 : null));
const derivedRate = computed(() => (form.depreciable && form.useLife && form.lifeYears ? Math.round((100 / form.lifeYears) * 100) / 100 : null));

function openNew() {
  editing.value = null;
  Object.assign(form, {
    code: '', name: '', description: '', method: 'straight_line', rate: 10, lifeYears: null, useLife: false, isTangible: true, isActive: true,
    assetAccountId: null, accumAccountId: null, expenseAccountId: null, gainLossAccountId: null, analyticId: '', depreciable: true, fields: [],
  });
  show.value = true;
}
function openEdit(g: Group) {
  editing.value = g;
  Object.assign(form, {
    code: g.code, name: g.name, description: g.description ?? '', method: g.method, rate: g.rate || null, lifeYears: g.lifeYears, useLife: g.lifeBasis === 'life',
    isTangible: g.isTangible, isActive: g.isActive, assetAccountId: g.assetAccount?.id ?? null, accumAccountId: g.accumAccount?.id ?? null,
    expenseAccountId: g.expenseAccount?.id ?? null, gainLossAccountId: g.gainLossAccount?.id ?? null, analyticId: g.analytic?.id ?? '', depreciable: g.depreciable,
    fields: g.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: !!f.required, expiry: !!f.expiry, options: (f.options ?? []).join('، ') })),
  });
  show.value = true;
}
async function save() {
  busy.value = true;
  const dep = form.depreciable;
  const byLife = form.useLife && form.method !== 'declining';
  const body = {
    code: form.code, name: form.name, description: form.description || null, method: form.method, isTangible: form.isTangible, isActive: form.isActive,
    rate: !dep ? 0 : byLife ? 0 : form.rate, lifeYears: dep && byLife ? form.lifeYears : null,
    assetAccountId: form.assetAccountId, accumAccountId: dep ? form.accumAccountId : null, expenseAccountId: dep ? form.expenseAccountId : null,
    gainLossAccountId: form.gainLossAccountId, analyticId: form.analyticId || null,
    fields: form.fields.filter((f) => f.label.trim()).map((f) => ({
      key: f.key, label: f.label.trim(), type: f.type, required: f.required, expiry: f.type === 'date' && f.expiry,
      options: f.type === 'select' ? f.options.split(/[،,\n]/).map((x) => x.trim()).filter(Boolean) : undefined,
    })),
  };
  try {
    if (editing.value) await api(`${AF}/groups/${editing.value.id}`, { method: 'PATCH', json: body });
    else await api(`${AF}/groups`, { method: 'POST', json: body });
    toast.success('تم حفظ المجموعة');
    show.value = false;
    await Promise.all([load(), loadRecon(), reloadLookups(true).catch(() => {})]);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function remove(g: Group) {
  if (!confirm(`حذف المجموعة «${g.name}»؟`)) return;
  try {
    await api(`${AF}/groups/${g.id}`, { method: 'DELETE' });
    toast.success('حُذفت المجموعة');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <section class="pm-hero ac-hero fa-hero">
      <div>
        <p class="pm-kicker">الأصول الثابتة</p>
        <h1>مجموعات الأصول الثابتة</h1>
        <p class="pm-sub">كل مجموعة (مبانٍ، سيارات، أثاث...) تحدد حساب الأصل ومجمع الإهلاك ومصروف الإهلاك وحساب أرباح وخسائر البيع، ونسبة الإهلاك أو العمر الإنتاجي، وحقولًا إضافية لأصولها.</p>
      </div>
      <div class="pm-actions"><button v-if="session.can(P.assetsManage)" class="btn ac-glow" @click="openNew">مجموعة جديدة</button></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="pm-tabs">
      <button :class="['pm-tab', { on: tab === 'groups' }]" @click="tab = 'groups'">المجموعات <b>{{ groups.length }}</b></button>
      <button :class="['pm-tab', { on: tab === 'recon' }]" @click="tab = 'recon'">
        المطابقة مع الدليل <span v-if="recon && !recon.ok" class="fa-flag">{{ recon.issues }}</span><b v-else-if="recon">✓</b>
      </button>
    </div>

    <section v-if="tab === 'groups'" class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الرمز</th><th>المجموعة</th><th>الإهلاك</th><th>الحسابات</th><th>الأصول وصافي القيمة</th><th>المطابقة</th><th></th></tr></thead>
          <tbody>
            <tr v-for="g in groups" :key="g.id" :class="{ off: !g.isActive }">
              <td class="ac-code"><b>{{ g.code }}</b></td>
              <td><b>{{ g.name }}</b><span v-if="!g.isTangible" class="pm-tag">غير مادي</span><span v-if="g.description" class="pm-muted">{{ g.description }}</span>
                <span v-if="g.fields.length" class="flds"><span v-for="f in g.fields" :key="f.key" class="pm-tag">{{ f.label }}{{ f.expiry ? ' ⏰' : '' }}</span></span></td>
              <td>
                <template v-if="g.depreciable">{{ g.methodLabel }}<span class="pm-muted">{{ g.rate ? `${g.rate}% سنويًا` : '' }}{{ g.lifeYears ? ` · ${g.lifeYears} سنة` : '' }}</span></template>
                <span v-else class="pm-tag">لا تُهلك</span>
              </td>
              <td class="accs">
                <span><i>الأصل</i> <span class="ac-code">{{ g.assetAccount?.code }}</span></span>
                <span v-if="g.accumAccount"><i>المجمع</i> <span class="ac-code">{{ g.accumAccount.code }}</span></span>
                <span v-if="g.expenseAccount"><i>المصروف</i> <span class="ac-code">{{ g.expenseAccount.code }}</span></span>
                <span><i>أرباح وخسائر</i> <span class="ac-code">{{ g.gainLossAccount?.code }}</span></span>
              </td>
              <td class="ac-num"><b>{{ sar(g.nbv) }}</b><span class="pm-muted">{{ g.inBooks }} أصل · التكلفة {{ sar(g.cost) }}</span></td>
              <td><span v-if="reconOf(g)?.ok === false" class="fa-flag" :title="reconOf(g)?.problems.join('\n')">غير مطابقة</span><span v-else-if="reconOf(g)" class="pm-ok">✓ مطابقة</span></td>
              <td class="acts">
                <button v-if="session.can(P.assetsManage)" class="btn btn-sm" @click="openEdit(g)">تعديل</button>
                <button v-if="session.can(P.assetsManage) && !g.assets" class="btn btn-sm" @click="remove(g)">حذف</button>
              </td>
            </tr>
            <tr v-if="!groups.length"><td colspan="7" class="pm-empty">عرّف أول مجموعة (مثل المباني أو السيارات) ثم سجل أصولها</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else class="card pm-panel">
      <h2>مطابقة قيم الأصول مع أرصدة الدليل المحاسبي
        <label class="pm-muted" style="font-weight: 400">في تاريخ <input v-model="asOf" type="date" class="input" style="width: auto" @change="loadRecon" /></label>
      </h2>
      <p class="fa-sub">قيمة أصول كل مجموعة ومجمع إهلاكها يجب أن تساوي رصيد الحساب في الدليل. أي قيد يدوي على هذه الحسابات من خارج الأصول يظهر هنا سببًا للاختلاف.</p>
      <div v-if="recon" class="table-wrap">
        <table class="table">
          <thead><tr><th>الحساب</th><th>النوع</th><th>المجموعات</th><th>رصيد الدليل</th><th>سجل الأصول</th><th>الفرق</th><th>الحالة والسبب</th></tr></thead>
          <tbody>
            <tr v-for="a in recon.accounts" :key="a.accountId" :class="{ bad: !a.ok }">
              <td><span class="ac-code">{{ a.code }}</span> {{ a.name }}</td><td>{{ a.kindLabel }}</td><td>{{ a.groups.join('، ') }}</td>
              <td class="ac-num">{{ sar(a.gl) }}</td><td class="ac-num">{{ sar(a.subledger) }}</td><td class="ac-num"><b>{{ sar(a.diff) }}</b></td>
              <td>
                <span v-if="a.ok" class="pm-ok">✓ مطابق</span>
                <template v-else>
                  <span class="fa-flag">غير مطابق</span>
                  <span v-for="(p, i) in a.problems" :key="i" class="pm-muted">{{ p }}</span>
                  <RouterLink v-for="fe in a.foreignEntries" :key="fe.id" :to="`/accounting/entries/${fe.id}`" class="pm-link">فتح القيد {{ fe.entryNo }}</RouterLink>
                </template>
              </td>
            </tr>
            <tr v-if="!recon.accounts.length"><td colspan="7" class="pm-empty">لا توجد مجموعات بعد</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="show" class="modal-backdrop" @click.self="show = false">
      <form class="card modal modal-wide" @submit.prevent="save">
        <h2>{{ editing ? `تعديل مجموعة ${editing.name}` : 'مجموعة أصول جديدة' }}</h2>
        <div class="field-row">
          <label class="field"><span>رمز المجموعة (إنجليزي)</span><input v-model="form.code" class="input ac-code" maxlength="12" required placeholder="CAR" /></label>
          <label class="field"><span>اسم المجموعة</span><input v-model="form.name" class="input" required placeholder="السيارات" /></label>
        </div>
        <label class="field"><span>الوصف</span><input v-model="form.description" class="input" /></label>
        <div class="fa-row" style="margin-bottom: 10px">
          <label class="fa-check"><input v-model="form.depreciable" type="checkbox" /> تُهلك (ألغِ التحديد للأراضي)</label>
          <label class="fa-check"><input v-model="form.isTangible" type="checkbox" /> أصول مادية (تُسلَّم عهدة لموظف)</label>
          <label class="fa-check"><input v-model="form.isActive" type="checkbox" /> نشطة</label>
        </div>
        <div v-if="form.depreciable" class="field-row">
          <label class="field"><span>طريقة الإهلاك</span>
            <select v-model="form.method" class="input">
              <option value="straight_line">القسط الثابت</option><option value="declining">القسط المتناقص</option><option value="accelerated">الإهلاك المعجل (مجموع أرقام السنوات)</option>
            </select>
          </label>
          <div class="field"><span>أساس الاحتساب</span>
            <div class="ac-switch"><button type="button" :class="{ on: !form.useLife }" @click="form.useLife = false">نسبة سنوية</button><button type="button" :class="{ on: form.useLife }" :disabled="form.method === 'declining'" @click="form.useLife = true">عمر إنتاجي</button></div>
          </div>
          <label v-if="!form.useLife || form.method === 'declining'" class="field"><span>نسبة الإهلاك المعتمدة %</span><input v-model.number="form.rate" type="number" min="0.01" max="100" step="0.01" class="input" required />
            <small v-if="derivedLife" class="pm-muted">العمر الإنتاجي {{ derivedLife }} سنة</small></label>
          <label v-else class="field"><span>العمر الإنتاجي (سنوات)</span><input v-model.number="form.lifeYears" type="number" min="1" max="100" step="0.5" class="input" required />
            <small v-if="derivedRate" class="pm-muted">ما يعادل {{ derivedRate }}% سنويًا</small></label>
        </div>
        <p v-if="form.depreciable && form.method === 'declining'" class="fa-info">القسط المتناقص: النسبة × صافي القيمة في بداية كل سنة مالية، ويقل القسط سنة بعد سنة.</p>
        <p v-if="form.depreciable && form.method === 'accelerated'" class="fa-info">الإهلاك المعجل بمجموع أرقام السنوات: السنة الأولى تأخذ النصيب الأكبر (مثلًا 5/15 للعمر 5 سنوات) ثم يتناقص.</p>

        <h3 class="sec">الحسابات من الدليل المحاسبي</h3>
        <div class="field-row">
          <label class="field"><span>حساب الأصل</span><SearchSelect v-model="form.assetAccountId" :options="assetOpts" :selected-label="accLabel(editing?.assetAccount)" placeholder="ابحث برقم الحساب أو اسمه" required /></label>
          <label v-if="form.depreciable" class="field"><span>حساب مجمع الإهلاك</span><SearchSelect v-model="form.accumAccountId" :options="accumOpts" :selected-label="accLabel(editing?.accumAccount)" placeholder="ابحث برقم الحساب أو اسمه" required /></label>
        </div>
        <div class="field-row">
          <label v-if="form.depreciable" class="field"><span>حساب مصروف الإهلاك</span><SearchSelect v-model="form.expenseAccountId" :options="expenseOpts" :selected-label="accLabel(editing?.expenseAccount)" placeholder="ابحث برقم الحساب أو اسمه" required /></label>
          <label class="field"><span>حساب الأرباح والخسائر من البيع</span><SearchSelect v-model="form.gainLossAccountId" :options="glOpts" :selected-label="accLabel(editing?.gainLossAccount)" placeholder="ابحث برقم الحساب أو اسمه" required /></label>
        </div>
        <label v-if="form.depreciable" class="field"><span>مركز التكلفة لمصروف الإهلاك</span>
          <select v-model="form.analyticId" class="input"><option value="">— يُحدد لكل أصل —</option><option v-for="a in analytic" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select>
        </label>

        <h3 class="sec">حقول إضافية لأصول هذه المجموعة <small class="pm-muted">مثل رقم اللوحة وتاريخ انتهاء الاستمارة للسيارات</small></h3>
        <div class="fa-rows">
          <div v-for="(f, i) in form.fields" :key="i" class="fa-row">
            <input v-model="f.label" class="input" placeholder="اسم الحقل" required />
            <select v-model="f.type" class="input" style="flex: 0 0 130px"><option v-for="t in FIELD_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option></select>
            <input v-if="f.type === 'select'" v-model="f.options" class="input" placeholder="الخيارات مفصولة بفاصلة" />
            <label class="fa-check"><input v-model="f.required" type="checkbox" /> إلزامي</label>
            <label v-if="f.type === 'date'" class="fa-check" title="ينبه النظام قبل هذا التاريخ"><input v-model="f.expiry" type="checkbox" /> تاريخ انتهاء (تنبيه)</label>
            <button type="button" class="btn btn-sm" @click="form.fields.splice(i, 1)">✕</button>
          </div>
          <button type="button" class="btn btn-sm" style="align-self: flex-start" @click="form.fields.push({ label: '', type: 'text', required: false, expiry: false, options: '' })">+ حقل</button>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ</button><button type="button" class="btn" @click="show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped>
td .pm-muted, td .pm-link { display: block; }
.accs { font-size: .76rem; }
.table { font-size: .86rem; }
.accs > span { display: block; white-space: nowrap; }
.accs i { font-style: normal; color: var(--muted); }
.off { opacity: .55; }
.flds { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
.bad td { background: #fef2f2; }
.acts { white-space: nowrap; }
.sec { font-size: .92rem; margin: 14px 0 8px; padding-top: 10px; border-top: 1px dashed var(--border); }
</style>
