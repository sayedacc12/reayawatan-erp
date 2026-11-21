<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import SearchSelect from '../../../shared/SearchSelect.vue';
import { P, dc, sar, useAccounts, type Partner } from '../lib';
import '../../../shared/module.css';
import '../acc.css';

interface Category { id: string; name: string; behavior: 'customer' | 'supplier' | 'other'; behaviorLabel: string; partners: number }
const session = useSession();
const toast = useToast();
const router = useRouter();
const rows = ref<Partner[]>([]);
const cats = ref<Category[]>([]);
const { load: loadAccounts, subOptions } = useAccounts();
const error = ref('');
const search = ref('');
const cat = ref('');
async function load() {
  try {
    [rows.value, cats.value] = await Promise.all([api<Partner[]>('/accounting/partners'), api<Category[]>('/accounting/categories')]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => { load(); loadAccounts().catch(() => {}); });
const shown = computed(() => rows.value.filter((p) => (!cat.value || p.categoryId === cat.value)
  && (!search.value || [p.name, p.code, p.taxNumber ?? '', ...p.phones].some((x) => x.includes(search.value)))));

const show = ref(false);
const editing = ref<Partner | null>(null);
const form = reactive({
  name: '', categoryId: '', description: '', phones: [''] as string[], emails: [''] as string[], addresses: [] as { label: string; address: string; city: string }[],
  taxNumber: '', crNumber: '', accountId: null as string | null, creditLimit: null as number | null, isActive: true,
});
const behavior = computed(() => cats.value.find((c) => c.id === form.categoryId)?.behavior ?? 'other');
const accountOptions = computed(() => subOptions((a) => behavior.value === 'customer' ? a.nature === 'assets' : behavior.value === 'supplier' ? a.nature === 'liabilities' : true));
function openNew() {
  editing.value = null;
  Object.assign(form, { name: '', categoryId: cat.value || cats.value[0]?.id || '', description: '', phones: [''], emails: [''], addresses: [], taxNumber: '', crNumber: '', accountId: null, creditLimit: null, isActive: true });
  show.value = true;
}
function openEdit(p: Partner) {
  editing.value = p;
  Object.assign(form, {
    name: p.name, categoryId: p.categoryId, description: p.description ?? '', phones: p.phones.length ? [...p.phones] : [''], emails: p.emails.length ? [...p.emails] : [''],
    addresses: p.addresses.map((a) => ({ label: a.label, address: a.address, city: a.city ?? '' })), taxNumber: p.taxNumber ?? '', crNumber: p.crNumber ?? '',
    accountId: p.account?.id ?? null, creditLimit: p.creditLimit, isActive: p.isActive,
  });
  show.value = true;
}
async function save() {
  const body = {
    ...form, description: form.description || null, taxNumber: form.taxNumber || null, crNumber: form.crNumber || null,
    phones: form.phones.map((x) => x.trim()).filter(Boolean), emails: form.emails.map((x) => x.trim()).filter(Boolean),
    addresses: form.addresses.filter((a) => a.address.trim()).map((a) => ({ label: a.label || 'العنوان', address: a.address, city: a.city || null })),
    creditLimit: behavior.value === 'customer' && form.creditLimit !== null && String(form.creditLimit) !== '' ? Number(form.creditLimit) : null,
  };
  try {
    if (editing.value) await api(`/accounting/partners/${editing.value.id}`, { method: 'PATCH', json: body });
    else await api('/accounting/partners', { method: 'POST', json: body });
    toast.success('تم حفظ بيانات الشريك');
    show.value = false;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const statement = (p: Partner) => router.push({ path: '/accounting/reports', query: { r: 'accounting.partner-statement', f_partnerId: p.id } });
</script>

<template>
  <div>
    <section class="pm-hero ac-hero">
      <div>
        <p class="pm-kicker">النظام المالي</p>
        <h1>دليل العملاء والموردين</h1>
        <p class="pm-sub">كل عميل أو مورد مرتبط بحساب في الدليل: العملاء بحساب مدينين وحد ائتماني، والموردون بحساب دائنين.</p>
      </div>
      <div class="pm-actions"><button v-if="session.can(P.partners)" class="btn ac-glow" @click="openNew">إضافة شريك</button></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="cats">
      <button :class="['catc', { on: !cat }]" @click="cat = ''"><b>{{ rows.length }}</b><span>الكل</span></button>
      <button v-for="c in cats" :key="c.id" :class="['catc', c.behavior, { on: cat === c.id }]" @click="cat = c.id"><b>{{ c.partners }}</b><span>{{ c.name }}</span></button>
    </div>

    <section class="card pm-panel">
      <div class="ac-toolbar"><input v-model="search" class="input grow" placeholder="ابحث بالاسم أو الرمز أو الرقم الضريبي أو الجوال..." /></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الرمز</th><th>الاسم</th><th>التصنيف</th><th>الحساب المرتبط</th><th>التواصل</th><th>الرصيد</th><th></th></tr></thead>
          <tbody>
            <tr v-for="p in shown" :key="p.id" :class="{ off: !p.isActive }">
              <td class="ac-code">{{ p.code }}</td>
              <td><b>{{ p.name }}</b><span v-if="p.taxNumber" class="pm-muted">ضريبي: <span class="ac-code">{{ p.taxNumber }}</span></span></td>
              <td>{{ p.categoryName }}</td>
              <td><template v-if="p.account"><span class="ac-code">{{ p.account.code }}</span> <span class="pm-muted">{{ p.account.name }}</span></template><span v-else class="pm-muted">—</span></td>
              <td><span class="pm-muted">{{ p.phones[0] }}</span><span class="pm-muted">{{ p.emails[0] }}</span></td>
              <td class="ac-num">
                {{ dc(p.balance) }}
                <span v-if="p.creditLimit !== null" :class="['pm-muted', { over: p.overLimit }]">الحد {{ sar(p.creditLimit) }}{{ p.overLimit ? ' · تجاوز' : '' }}</span>
              </td>
              <td class="acts">
                <button v-if="session.can(P.reports)" class="btn btn-sm" @click="statement(p)">كشف حساب</button>
                <button v-if="session.can(P.partners)" class="btn btn-sm" @click="openEdit(p)">تعديل</button>
              </td>
            </tr>
            <tr v-if="!shown.length"><td colspan="7" class="pm-empty">لا يوجد شركاء</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="show" class="modal-backdrop" @click.self="show = false">
      <form class="card modal modal-wide" @submit.prevent="save">
        <h2>{{ editing ? `تعديل ${editing.name}` : 'شريك جديد' }}</h2>
        <div class="field-row">
          <label class="field"><span>الاسم</span><input v-model="form.name" class="input" required /></label>
          <label class="field"><span>التصنيف</span><select v-model="form.categoryId" class="input" required><option v-for="c in cats" :key="c.id" :value="c.id">{{ c.name }} ({{ c.behaviorLabel }})</option></select></label>
        </div>
        <label class="field"><span>{{ behavior === 'customer' ? 'حساب المدينين المرتبط' : behavior === 'supplier' ? 'حساب الدائنين المرتبط' : 'الحساب المرتبط (اختياري)' }}</span>
          <SearchSelect v-model="form.accountId" :options="accountOptions" :selected-label="editing?.account ? `${editing.account.code} ${editing.account.name}` : ''" placeholder="ابحث برقم الحساب أو اسمه" :required="behavior !== 'other'" />
        </label>
        <div class="field-row">
          <label class="field"><span>الرقم الضريبي</span><input v-model="form.taxNumber" class="input ac-code" maxlength="15" /></label>
          <label class="field"><span>السجل التجاري</span><input v-model="form.crNumber" class="input ac-code" maxlength="10" /></label>
          <label v-if="behavior === 'customer'" class="field"><span>الحد الائتماني (ريال)</span><input v-model.number="form.creditLimit" class="input" type="number" min="0" step="0.01" /></label>
        </div>
        <label class="field"><span>الوصف</span><textarea v-model="form.description" class="input" rows="2" /></label>
        <div class="field-row">
          <div class="field"><span>أرقام التواصل</span>
            <div v-for="(_, i) in form.phones" :key="i" class="multi"><input v-model="form.phones[i]" class="input ac-code" /><button type="button" class="btn btn-sm" @click="form.phones.splice(i, 1)">✕</button></div>
            <button type="button" class="btn btn-sm" @click="form.phones.push('')">+ رقم</button>
          </div>
          <div class="field"><span>البريد الإلكتروني</span>
            <div v-for="(_, i) in form.emails" :key="i" class="multi"><input v-model="form.emails[i]" class="input ac-code" type="email" /><button type="button" class="btn btn-sm" @click="form.emails.splice(i, 1)">✕</button></div>
            <button type="button" class="btn btn-sm" @click="form.emails.push('')">+ بريد</button>
          </div>
        </div>
        <div class="field"><span>العناوين</span>
          <div v-for="(a, i) in form.addresses" :key="i" class="multi">
            <input v-model="a.label" class="input" placeholder="الوصف (المقر الرئيسي)" style="max-width: 160px" />
            <input v-model="a.address" class="input" placeholder="العنوان" />
            <input v-model="a.city" class="input" placeholder="المدينة" style="max-width: 130px" />
            <button type="button" class="btn btn-sm" @click="form.addresses.splice(i, 1)">✕</button>
          </div>
          <button type="button" class="btn btn-sm" @click="form.addresses.push({ label: '', address: '', city: '' })">+ عنوان</button>
        </div>
        <label class="check"><input v-model="form.isActive" type="checkbox" /> نشط</label>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.cats { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.catc { border: 1px solid var(--border); background: var(--surface); border-radius: 14px; padding: 10px 16px; font: inherit; cursor: pointer; display: flex; gap: 10px; align-items: center; transition: .2s; }
.catc b { font-size: 1.2rem; color: var(--primary); }
.catc.on { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.catc.supplier b { color: #b45309; }
.multi { display: flex; gap: 6px; margin-bottom: 6px; }
.off { opacity: .55; }
.over { color: var(--danger) !important; font-weight: 700; }
.acts { white-space: nowrap; }
.check { display: flex; gap: 8px; align-items: center; }
td .pm-muted { display: block; }
</style>
