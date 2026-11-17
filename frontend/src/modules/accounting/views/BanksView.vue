<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import SearchSelect from '../../fundraising/components/SearchSelect.vue';
import { P, sar, useAccounts, type CashAccount } from '../lib';
import '../../projects/projects.css';
import '../acc.css';

const session = useSession();
const toast = useToast();
const router = useRouter();
const rows = ref<CashAccount[]>([]);
const { load: loadAccounts, subOptions } = useAccounts();
const error = ref('');
async function load() {
  try {
    rows.value = await api<CashAccount[]>('/accounting/cash-accounts');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => { load(); loadAccounts().catch(() => {}); });
const total = computed(() => rows.value.reduce((s, r) => s + r.balance, 0));
const show = ref(false);
const editing = ref<CashAccount | null>(null);
const form = reactive({ kind: 'bank' as 'bank' | 'cash', name: '', bankName: '', accountNumber: '', iban: '', description: '', glAccountId: null as string | null, isActive: true });
function openNew(kind: 'bank' | 'cash') {
  editing.value = null;
  Object.assign(form, { kind, name: '', bankName: '', accountNumber: '', iban: '', description: '', glAccountId: null, isActive: true });
  show.value = true;
}
function openEdit(c: CashAccount) {
  editing.value = c;
  Object.assign(form, { kind: c.kind, name: c.name, bankName: c.bankName ?? '', accountNumber: c.accountNumber ?? '', iban: c.iban ?? '', description: c.description ?? '', glAccountId: c.glAccount?.id ?? null, isActive: c.isActive });
  show.value = true;
}
async function save() {
  const body = { ...form, bankName: form.bankName || null, accountNumber: form.accountNumber || null, iban: form.iban.replace(/\s/g, '').toUpperCase() || null, description: form.description || null };
  try {
    if (editing.value) await api(`/accounting/cash-accounts/${editing.value.id}`, { method: 'PATCH', json: body });
    else await api('/accounting/cash-accounts', { method: 'POST', json: body });
    toast.success('تم الحفظ');
    show.value = false;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const ledger = (c: CashAccount) => c.glAccount && router.push({ path: '/accounting/reports', query: { r: 'accounting.ledger', f_accountId: c.glAccount.id } });
</script>

<template>
  <div>
    <section class="pm-hero ac-hero">
      <div>
        <p class="pm-kicker">النظام المالي</p>
        <h1>البنوك والنقدية</h1>
        <p class="pm-sub">الحسابات البنكية والصناديق المستخدمة في سندات القبض والصرف. الحساب المرتبط في الدليل لا يُغيَّر بعد وجود حركة عليه إلا بعد تصفيته.</p>
      </div>
      <div v-if="session.can(P.banks)" class="pm-actions">
        <button class="btn ac-glow" @click="openNew('bank')">حساب بنكي</button>
        <button class="btn ac-ghost" @click="openNew('cash')">صندوق نقدية</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <p class="pm-muted">إجمالي الأرصدة: <b class="pm-money">{{ sar(total) }}</b></p>
    <div class="bank-grid">
      <div v-for="(c, i) in rows" :key="c.id" :class="['bcard', c.kind, { off: !c.isActive }]" :style="{ animationDelay: i * 60 + 'ms' }">
        <div class="top"><span class="chip">{{ c.kind === 'bank' ? 'حساب بنكي' : 'صندوق' }}</span><span v-if="!c.isActive" class="chip">موقوف</span></div>
        <h3>{{ c.name }}</h3>
        <p v-if="c.bankName" class="sub">{{ c.bankName }}<template v-if="c.accountNumber"> · <span class="ac-code">{{ c.accountNumber }}</span></template></p>
        <p v-if="c.iban" class="iban ac-code">{{ c.iban.replace(/(.{4})/g, '$1 ').trim() }}</p>
        <strong class="bal">{{ sar(c.balance) }}</strong>
        <p class="gl"><span class="ac-code">{{ c.glAccount?.code }}</span> {{ c.glAccount?.name }}</p>
        <div class="acts">
          <button v-if="session.can(P.reports)" class="btn btn-sm" @click="ledger(c)">كشف الحساب</button>
          <button v-if="session.can(P.banks)" class="btn btn-sm" @click="openEdit(c)">تعديل</button>
        </div>
      </div>
      <div v-if="!rows.length" class="card ac-empty-state" style="grid-column: 1 / -1"><div class="ic">🏦</div><h3>لا توجد حسابات بنكية أو صناديق</h3><p class="pm-muted">أضف حسابات البنوك والصناديق لتستخدمها في سندات القبض والصرف.</p></div>
    </div>

    <div v-if="show" class="modal-backdrop" @click.self="show = false">
      <form class="card modal" @submit.prevent="save">
        <h2>{{ form.kind === 'bank' ? 'حساب بنكي' : 'صندوق نقدية' }}</h2>
        <label class="field"><span>الاسم</span><input v-model="form.name" class="input" required /></label>
        <template v-if="form.kind === 'bank'">
          <div class="field-row">
            <label class="field"><span>اسم البنك</span><input v-model="form.bankName" class="input" required /></label>
            <label class="field"><span>رقم الحساب</span><input v-model="form.accountNumber" class="input ac-code" required /></label>
          </div>
          <label class="field"><span>الآيبان IBAN</span><input v-model="form.iban" class="input ac-code" placeholder="SA0000000000000000000000" /></label>
        </template>
        <label class="field"><span>الحساب المرتبط في الدليل</span>
          <SearchSelect v-model="form.glAccountId" :options="subOptions((a) => a.nature === 'assets')" :selected-label="editing?.glAccount ? `${editing.glAccount.code} ${editing.glAccount.name}` : ''" placeholder="ابحث في حسابات الأصول" required />
        </label>
        <label class="field"><span>الوصف</span><input v-model="form.description" class="input" /></label>
        <label class="check"><input v-model="form.isActive" type="checkbox" /> نشط</label>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.bank-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.bcard { position: relative; overflow: hidden; border-radius: 20px; padding: 18px 20px; color: #fff; min-height: 220px; display: flex; flex-direction: column; gap: 4px;
  background: linear-gradient(135deg, #0f766e, #134e4a 60%, #1e293b); box-shadow: 0 16px 34px rgba(15,118,110,.25); animation: pm-rise .5s var(--ease) both; transition: transform .25s var(--ease); }
.bcard:hover { transform: translateY(-4px) rotate(-.3deg); }
.bcard.cash { background: linear-gradient(135deg, #b45309, #78350f 60%, #292524); box-shadow: 0 16px 34px rgba(180,83,9,.25); }
.bcard::before { content: ''; position: absolute; width: 220px; height: 220px; border-radius: 50%; inset-inline-end: -70px; top: -90px; background: radial-gradient(circle, rgba(255,255,255,.22), transparent 70%); }
.bcard::after { content: ''; position: absolute; inset: 0; background: linear-gradient(115deg, transparent 40%, rgba(255,255,255,.12) 50%, transparent 60%); transform: translateX(-100%); transition: transform .8s; }
.bcard:hover::after { transform: translateX(100%); }
.bcard.off { filter: grayscale(.8); opacity: .7; }
.top { display: flex; gap: 6px; }
.chip { font-size: .72rem; background: rgba(255,255,255,.16); padding: 2px 10px; border-radius: 99px; }
h3 { margin: 8px 0 0; font-size: 1.1rem; }
.sub, .gl { margin: 0; opacity: .8; font-size: .85rem; }
.iban { margin: 4px 0 0; letter-spacing: 1px; opacity: .9; }
.bal { font-size: 1.5rem; margin-top: auto; }
.acts { display: flex; gap: 6px; margin-top: 8px; position: relative; z-index: 1; }
.acts .btn { background: rgba(255,255,255,.14); color: #fff; border-color: rgba(255,255,255,.25); }
.check { display: flex; gap: 8px; align-items: center; }
</style>
