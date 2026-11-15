<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import SearchSelect from '../../fundraising/components/SearchSelect.vue';
import { money, natureColor, todayStr, useAccounts, type Partner } from '../lib';
import '../../projects/projects.css';
import '../acc.css';

interface Cat { code: string; name: string; description: string; ready: boolean }
interface TbRow { id: string; code: string; name: string; level: number; kind: string; nature: string; natureLabel: string; openingDebit: number; openingCredit: number; debit: number; credit: number; closingDebit: number; closingCredit: number }
interface Tb { year: number; from: string; to: string; rows: TbRow[]; totals: Omit<TbRow, 'id' | 'code' | 'name' | 'level' | 'kind' | 'nature' | 'natureLabel'> }
interface MoveRow { entryId: string; entryNo: number; voucherLabel: string; voucherNo: string; documentDate: string; description: string; accountCode: string; accountName: string; partnerName: string | null; debit: number; credit: number; balance: number }
interface Statement { year: number; from: string; to: string; opening: number; rows: MoveRow[]; debit: number; credit: number; closing: number; account?: { code: string; name: string; natureLabel: string }; partner?: { name: string } }

const route = useRoute();
const router = useRouter();
const toast = useToast();
const catalog = ref<Cat[]>([]);
const current = ref(String(route.query.r ?? 'trial-balance'));
const t = todayStr();
const f = reactive({ from: `${t.slice(0, 4)}-01-01`, to: t, level: 9, accountId: (route.query.r === 'ledger' ? String(route.query.id ?? '') : '') || null as string | null, partnerId: (route.query.r === 'partner' ? String(route.query.id ?? '') : '') || null as string | null });
const { accounts, load: loadAccounts } = useAccounts();
const partners = ref<Partner[]>([]);
const tb = ref<Tb | null>(null);
const st = ref<Statement | null>(null);
const busy = ref(false);
onMounted(async () => {
  catalog.value = await api<Cat[]>('/accounting/reports');
  await Promise.all([loadAccounts(), api<Partner[]>('/accounting/partners').then((r) => { partners.value = r; })]).catch(() => {});
  if (current.value === 'trial-balance' || (current.value === 'ledger' && f.accountId) || (current.value === 'partner' && f.partnerId)) run();
});
function pick(c: Cat) {
  current.value = c.code;
  tb.value = null; st.value = null;
  router.replace({ query: { r: c.code } });
  if (c.code === 'trial-balance') run();
}
async function run() {
  busy.value = true;
  try {
    const qs = `from=${f.from}&to=${f.to}`;
    if (current.value === 'trial-balance') tb.value = await api<Tb>(`/accounting/reports/trial-balance?${qs}&level=${f.level}`);
    else if (current.value === 'ledger' && f.accountId) st.value = await api<Statement>(`/accounting/reports/ledger/${f.accountId}?${qs}`);
    else if (current.value === 'partner' && f.partnerId) st.value = await api<Statement>(`/accounting/reports/partner/${f.partnerId}?${qs}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const accountOptions = computed(() => accounts.value.map((a) => ({ id: a.id, label: `${a.code} ${a.name}`, sub: a.kindLabel })));
const partnerOptions = computed(() => partners.value.map((p) => ({ id: p.id, label: p.name, sub: p.code })));
const cat = computed(() => catalog.value.find((c) => c.code === current.value));
const fmt = (v: number) => (v ? money(v) : '');
function drill(r: TbRow) {
  f.accountId = r.id;
  current.value = 'ledger';
  run();
}
</script>

<template>
  <div>
    <section class="pm-hero ac-hero no-print">
      <div>
        <p class="pm-kicker">النظام المالي</p>
        <h1>تقارير النظام المالي</h1>
        <p class="pm-sub">قسم تقارير مستقل للنظام المالي. التقارير الأساسية متاحة الآن، والقوائم المالية تُضاف وفق النماذج المعتمدة لاحقًا.</p>
      </div>
    </section>
    <div class="layout">
      <aside class="card list no-print">
        <button v-for="c in catalog" :key="c.code" :class="['item', { on: c.code === current, soon: !c.ready }]" @click="pick(c)">
          <b>{{ c.name }}</b><small>{{ c.ready ? c.description : 'قريبًا' }}</small>
        </button>
      </aside>
      <section class="card body">
        <template v-if="cat && !cat.ready">
          <div class="ac-empty-state"><div class="ic">📊</div><h3>{{ cat.name }}</h3><p class="pm-muted">{{ cat.description }}</p><p class="pm-muted">يُبنى هذا التقرير وفق النموذج الذي ستعتمده الجمعية لاحقًا.</p></div>
        </template>
        <template v-else>
          <div class="ac-toolbar no-print">
            <label class="pm-muted">من <input v-model="f.from" type="date" class="input" /></label>
            <label class="pm-muted">إلى <input v-model="f.to" type="date" class="input" /></label>
            <label v-if="current === 'trial-balance'" class="pm-muted">حتى المستوى
              <select v-model.number="f.level" class="input"><option v-for="l in 9" :key="l" :value="l">{{ l === 9 ? 'كل المستويات' : l }}</option></select>
            </label>
            <div v-if="current === 'ledger'" class="grow"><SearchSelect v-model="f.accountId" :options="accountOptions" placeholder="اختر الحساب (رئيسي أو فرعي)" /></div>
            <div v-if="current === 'partner'" class="grow"><SearchSelect v-model="f.partnerId" :options="partnerOptions" placeholder="اختر العميل أو المورد" /></div>
            <button class="btn btn-primary" :disabled="busy" @click="run">عرض</button>
            <button class="btn" onclick="window.print()">طباعة</button>
          </div>

          <div v-if="current === 'trial-balance' && tb">
            <h2 class="rtitle">ميزان المراجعة <small class="pm-muted">من {{ tb.from }} إلى {{ tb.to }} · السنة المالية {{ tb.year }}</small></h2>
            <div class="table-wrap">
              <table class="table tb">
                <thead>
                  <tr><th rowspan="2">الحساب</th><th colspan="2">الرصيد الافتتاحي</th><th colspan="2">الحركة</th><th colspan="2">الرصيد الختامي</th></tr>
                  <tr><th>مدين</th><th>دائن</th><th>مدين</th><th>دائن</th><th>مدين</th><th>دائن</th></tr>
                </thead>
                <tbody>
                  <tr v-for="r in tb.rows" :key="r.id" :class="['ac-row-click', `l${Math.min(r.level, 3)}`]" @click="drill(r)">
                    <td><span class="ac-indent" :style="{ width: (r.level - 1) * 14 + 'px' }" /><i class="dot" :style="{ background: natureColor(r.nature) }" /><span class="ac-code">{{ r.code }}</span> {{ r.name }}</td>
                    <td class="ac-num">{{ fmt(r.openingDebit) }}</td><td class="ac-num">{{ fmt(r.openingCredit) }}</td>
                    <td class="ac-num ac-dr">{{ fmt(r.debit) }}</td><td class="ac-num ac-cr">{{ fmt(r.credit) }}</td>
                    <td class="ac-num">{{ fmt(r.closingDebit) }}</td><td class="ac-num">{{ fmt(r.closingCredit) }}</td>
                  </tr>
                  <tr v-if="!tb.rows.length"><td colspan="7" class="pm-empty">لا توجد حركات مرحّلة في الفترة</td></tr>
                </tbody>
                <tfoot>
                  <tr><td>الإجمالي</td><td class="ac-num">{{ money(tb.totals.openingDebit) }}</td><td class="ac-num">{{ money(tb.totals.openingCredit) }}</td><td class="ac-num">{{ money(tb.totals.debit) }}</td><td class="ac-num">{{ money(tb.totals.credit) }}</td><td class="ac-num">{{ money(tb.totals.closingDebit) }}</td><td class="ac-num">{{ money(tb.totals.closingCredit) }}</td></tr>
                </tfoot>
              </table>
            </div>
            <p :class="tb.totals.debit === tb.totals.credit ? 'pm-ok' : 'alert alert-error'">{{ tb.totals.debit === tb.totals.credit ? '✓ الميزان متوازن' : 'الميزان غير متوازن' }}</p>
          </div>

          <div v-if="(current === 'ledger' || current === 'partner') && st">
            <h2 class="rtitle">{{ current === 'ledger' ? 'كشف حساب' : 'كشف حساب شريك' }}:
              <template v-if="st.account"><span class="ac-code">{{ st.account.code }}</span> {{ st.account.name }}</template><template v-else>{{ st.partner?.name }}</template>
              <small class="pm-muted">من {{ st.from }} إلى {{ st.to }}</small></h2>
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>التاريخ</th><th>القيد</th><th>المستند</th><th>البيان</th><th v-if="current === 'partner' || st.account">الحساب</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
                <tbody>
                  <tr class="open"><td colspan="5">الرصيد الافتتاحي للفترة</td><td></td><td></td><td class="ac-num">{{ money(st.opening) }}</td></tr>
                  <tr v-for="(r, i) in st.rows" :key="i" class="ac-row-click" @click="router.push(`/accounting/entries/${r.entryId}`)">
                    <td>{{ r.documentDate }}</td><td class="ac-code">{{ r.entryNo }}</td><td>{{ r.voucherLabel }} <span class="ac-code">{{ r.voucherNo }}</span></td>
                    <td>{{ r.description }}<span v-if="r.partnerName && current === 'ledger'" class="pm-muted"> · {{ r.partnerName }}</span></td>
                    <td><span class="ac-code">{{ r.accountCode }}</span> <small class="pm-muted">{{ r.accountName }}</small></td>
                    <td class="ac-num ac-dr">{{ fmt(r.debit) }}</td><td class="ac-num ac-cr">{{ fmt(r.credit) }}</td><td class="ac-num">{{ money(r.balance) }}</td>
                  </tr>
                  <tr v-if="!st.rows.length"><td colspan="8" class="pm-empty">لا توجد حركات مرحّلة في الفترة</td></tr>
                </tbody>
                <tfoot><tr><td colspan="5">الإجمالي والرصيد الختامي</td><td class="ac-num">{{ money(st.debit) }}</td><td class="ac-num">{{ money(st.credit) }}</td><td class="ac-num">{{ money(st.closing) }}</td></tr></tfoot>
              </table>
            </div>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 16px; align-items: start; }
.list { padding: 8px; display: flex; flex-direction: column; gap: 4px; position: sticky; top: 80px; }
.item { text-align: start; border: 0; background: none; font: inherit; padding: 10px 12px; border-radius: 10px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; transition: background .15s; }
.item small { color: var(--muted); font-size: .76rem; }
.item:hover { background: var(--surface-2); }
.item.on { background: var(--primary-soft); color: var(--primary); box-shadow: inset 3px 0 0 var(--primary); }
.item.soon { opacity: .65; }
.body { padding: 18px; min-height: 400px; }
.rtitle { font-size: 1.05rem; display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; }
.tb { font-size: .86rem; }
.tb th { text-align: center; }
.tb td, .tb th { padding: 7px 8px; }
.tb td:first-child { white-space: normal; min-width: 220px; }
.tb tr.l1 td { font-weight: 800; background: var(--surface-2); }
.tb tr.l2 td { font-weight: 600; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-inline-end: 6px; }
tfoot td { font-weight: 800; border-top: 2px solid var(--text); }
tr.open td { background: var(--surface-2); font-weight: 600; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } .list { position: static; flex-direction: row; overflow-x: auto; } .item { min-width: 160px; } }
@media print { .layout { display: block; } .body { box-shadow: none; border: 0; } }
</style>
