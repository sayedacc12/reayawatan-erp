<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../../api';
import { useSession } from '../../../../stores/session';
import { useToast } from '../../../../stores/toast';
import SearchSelect from '../../../../shared/SearchSelect.vue';
import { AF, useLookups, type AssetDetail, type AssetRow, type BudgetOption, type Move } from '../../assets';
import { P, sar, todayStr, useAccounts } from '../../lib';
import '../../../../shared/module.css';
import '../../acc.css';
import './assets.css';

type Op = 'purchase' | 'addition' | 'wip' | 'capitalize' | 'revaluation' | 'impairment' | 'sale' | 'scrap';
const OPS: { key: Op; label: string; icon: string; hint: string }[] = [
  { key: 'purchase', label: 'شراء أصل', icon: '🛒', hint: 'يصدر سند صرف (نقدي أو بنكي أو آجل على حساب المورد)، ولا يدخل الأصل الدفاتر ولا يُهلك إلا بعد اعتماد السند في مرحلته النهائية.' },
  { key: 'addition', label: 'إضافة وتحسين', icon: '🔧', hint: 'تكلفة رأسمالية تزيد قيمة الأصل (مثل تركيب مصعد)، ويُوزَّع إهلاكها على العمر المتبقي. يصدر بها سند صرف.' },
  { key: 'wip', label: 'دفعة تحت التنفيذ', icon: '🏗️', hint: 'دفعة للمقاول أو المورد على أصل لم يكتمل (مثل مبنى تحت الإنشاء): يصدر بها سند صرف على حساب المشروعات تحت التنفيذ، ولا تدخل تكلفة الأصل ولا يُهلك حتى رسملته.' },
  { key: 'capitalize', label: 'رسملة', icon: '🏁', hint: 'عند اكتمال الأصل تحت التنفيذ: تُنقل دفعاته المعتمدة من حساب المشروعات تحت التنفيذ إلى حساب الأصل بسند أصول، ويبدأ إهلاكه من تاريخ الرسملة.' },
  { key: 'revaluation', label: 'إعادة تقييم', icon: '📈', hint: 'إن زادت القيمة العادلة (بتقرير مقيّم معتمد) على صافي القيمة الدفترية: يزيد الفرق تكلفة الأصل مقابل حساب فائض إعادة التقييم، ويُهلك على العمر المتبقي.' },
  { key: 'impairment', label: 'هبوط قيمة', icon: '📉', hint: 'إن قلت القيمة القابلة للاسترداد عن صافي القيمة الدفترية: الفرق خسارة هبوط قيمة تُضاف لمجمع الإهلاك (وتُخفض تكلفة الأراضي لأنها لا تُهلك).' },
  { key: 'sale', label: 'بيع أصل', icon: '🤝', hint: 'خطوتان: إهلاك من آخر إهلاك حتى تاريخ البيع، ثم سند قبض يعكس حساب الأصل ومجمع إهلاكه، والفرق ربح أو خسارة في حساب المجموعة.' },
  { key: 'scrap', label: 'تخريد', icon: '🗑️', hint: 'إهلاك حتى تاريخ التخريد، ثم قيد يستبعد الأصل ومجمع إهلاكه، وصافي القيمة خسارة. تنتهي عهدة الموظف تلقائيًا.' },
];
const session = useSession();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const { lookups, load: loadLookups } = useLookups();
const { load: loadAccounts, subOptions } = useAccounts();
const view = ref<'new' | 'log'>(route.query.view === 'log' || !session.can(P.assetsOperate) ? 'log' : 'new');
const op = ref<Op>('purchase');
const assets = ref<AssetRow[]>([]);
const log = ref<Move[]>([]);
const lf = reactive({ kind: '', status: '' });
const error = ref('');

async function loadAssets() {
  assets.value = await api<AssetRow[]>(AF);
}
async function loadLog() {
  try {
    const qs = new URLSearchParams(Object.entries(lf).filter(([, v]) => v) as [string, string][]).toString();
    log.value = await api<Move[]>(`${AF}/operations${qs ? `?${qs}` : ''}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await Promise.all([loadAssets(), loadLog(), loadLookups(), loadAccounts()]).catch((e) => (error.value = (e as Error).message));
  const pre = String(route.query.assetId ?? '');
  const a = assets.value.find((x) => x.id === pre);
  const q = String(route.query.op ?? '');
  if (OPS.some((o) => o.key === q)) op.value = q as Op;
  else if (a) op.value = a.status === 'draft' ? 'purchase' : a.status === 'construction' ? 'wip' : 'sale';
  if (a) form.assetId = a.id;
  budgetOptions.value = await api<BudgetOption[]>(`${AF}/budgets/options`).catch(() => []);
});
watch(lf, loadLog);

const form = reactive({
  assetId: null as string | null, date: todayStr(), amount: null as number | null, method: 'bank' as 'cash' | 'bank' | 'credit',
  cashAccountId: '', partnerId: '', partyName: '', notes: '', counterAccountId: null as string | null,
  funded: false, fundingAccountId: null as string | null, fundingName: '', fundedAmount: null as number | null, budgetLineId: '',
});
watch(op, () => { form.assetId = null; form.amount = null; form.notes = ''; form.funded = false; form.budgetLineId = ''; });
const STATUS_FOR: Record<Op, string[]> = {
  purchase: ['draft'], wip: ['draft', 'construction'], capitalize: ['construction'],
  addition: ['active'], revaluation: ['active'], impairment: ['active'], sale: ['active'], scrap: ['active'],
};
const wantDraft = computed(() => STATUS_FOR[op.value].includes('draft'));
const assetOptions = computed(() => assets.value.filter((a) => STATUS_FOR[op.value].includes(a.status))
  .map((a) => ({ id: a.id, label: `${a.code} ${a.name}`, sub: a.status === 'active' ? `صافي القيمة ${sar(a.nbv)} · آخر إهلاك ${a.depreciatedThrough ?? '—'}` : `${a.groupName} · ${a.statusLabel}` })));
const pays = computed(() => ['purchase', 'addition', 'wip', 'sale'].includes(op.value));
const spends = computed(() => ['purchase', 'addition', 'wip'].includes(op.value));
const budgetOptions = ref<BudgetOption[]>([]);
const lineOptions = computed(() => budgetOptions.value.filter((l) => picked.value && l.groupId === picked.value.groupId && form.date >= l.start && form.date <= l.end));
const pickedLine = computed(() => budgetOptions.value.find((l) => l.id === form.budgetLineId) ?? null);
const fundingOptions = computed(() => subOptions(() => true));
// الأصل تحت التنفيذ: مجموع دفعاته المعتمدة قبل الرسملة
const detail = ref<AssetDetail | null>(null);
watch(() => [form.assetId, op.value], async () => {
  detail.value = null;
  if (form.assetId && op.value === 'capitalize') detail.value = await api<AssetDetail>(`${AF}/${form.assetId}`).catch(() => null);
});
const picked = computed(() => assets.value.find((a) => a.id === form.assetId) ?? null);
const cashOptions = computed(() => (lookups.value?.cash ?? []).filter((c) => c.kind === (form.method === 'bank' ? 'bank' : 'cash')));
watch(() => form.method, () => { form.cashAccountId = cashOptions.value[0]?.id ?? ''; });
watch(cashOptions, (o) => { if (!o.some((c) => c.id === form.cashAccountId)) form.cashAccountId = o[0]?.id ?? ''; }, { immediate: true });
const hint = computed(() => OPS.find((o) => o.key === op.value)!.hint);
const AMOUNT_LABEL: Partial<Record<Op, string>> = { sale: 'قيمة البيع', revaluation: 'القيمة العادلة حسب التقييم', impairment: 'القيمة القابلة للاسترداد', wip: 'مبلغ الدفعة' };
const busy = ref(false);

async function submit() {
  busy.value = true;
  const pay = form.method === 'credit' ? { method: 'credit', partnerId: form.partnerId } : { method: form.method, cashAccountId: form.cashAccountId };
  const common = { assetId: form.assetId, date: form.date, partyName: form.partyName || null, notes: form.notes || null };
  let path = '';
  let body: Record<string, unknown> = {};
  const extra = spends.value ? {
    budgetLineId: form.budgetLineId || null,
    ...(form.funded ? { fundingAccountId: form.fundingAccountId, fundingName: form.fundingName, fundedAmount: form.fundedAmount || null } : {}),
  } : {};
  if (spends.value) { path = 'purchase'; body = { ...common, ...pay, ...extra, kind: op.value, amount: form.amount }; }
  if (op.value === 'revaluation') { path = 'revaluation'; body = { ...common, fairValue: form.amount }; }
  if (op.value === 'impairment') { path = 'impairment'; body = { ...common, recoverable: form.amount }; }
  if (op.value === 'capitalize') { path = 'capitalize'; body = common; }
  if (op.value === 'sale') { path = 'sale'; body = { ...common, ...pay, price: form.amount }; }
  if (op.value === 'scrap') { path = 'scrap'; body = common; }
  try {
    const r = await api<Move & { depRun?: { total: number } | null }>(`${AF}/operations/${path}`, { method: 'POST', json: body });
    const dep = r.depRun ? ` · احتُسب إهلاك حتى التاريخ ${sar(r.depRun.total)}` : '';
    toast.success(r.voucher ? `صدر سند ${r.voucher.kind === 'receipt' ? 'القبض' : 'الصرف'} رقم ${r.voucher.serial}${dep}` : `تمت العملية${dep}`);
    await Promise.all([loadAssets(), loadLog()]);
    if (r.voucher) router.push(`/accounting/vouchers/${r.voucher.id}`);
    else form.assetId = null;
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function cancelOp(m: Move) {
  const reason = prompt(`سبب إلغاء ${m.kindLabel} للأصل ${m.asset?.code}؟`);
  if (!reason) return;
  try {
    await api(`${AF}/operations/${m.id}/cancel`, { method: 'POST', json: { reason } });
    toast.success('أُلغيت العملية وعُكس قيدها');
    await Promise.all([loadAssets(), loadLog()]);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const ST: Record<string, string> = { done: '#10b981', pending: '#6366f1', cancelled: '#b91c1c' };
const CANCELLABLE = ['scrap', 'revaluation', 'impairment', 'capitalize'];
</script>

<template>
  <div>
    <section class="pm-hero ac-hero fa-hero">
      <div>
        <p class="pm-kicker">الأصول الثابتة</p>
        <h1>عمليات الأصول</h1>
        <p class="pm-sub">شراء وإضافة وبيع وتخريد، وكل عملية تصدر سندها وقيدها من الأصول مباشرة. ولإهلاك الأصول استخدم شاشة احتساب الإهلاك.</p>
      </div>
      <div class="pm-actions"><RouterLink v-if="session.can(P.assetsDepreciate)" to="/accounting/assets/depreciation" class="btn ac-ghost">إهلاك الأصول</RouterLink></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="pm-tabs">
      <button v-if="session.can(P.assetsOperate)" :class="['pm-tab', { on: view === 'new' }]" @click="view = 'new'">عملية جديدة</button>
      <button :class="['pm-tab', { on: view === 'log' }]" @click="view = 'log'">سجل العمليات <b>{{ log.length }}</b></button>
    </div>

    <template v-if="view === 'new'">
      <div class="ops">
        <button v-for="o in OPS" :key="o.key" :class="['opc', { on: op === o.key }]" @click="op = o.key"><span>{{ o.icon }}</span>{{ o.label }}</button>
      </div>
      <form class="card pm-panel" @submit.prevent="submit">
        <p class="fa-info">{{ hint }}</p>
        <div class="field-row">
          <label class="field"><span>الأصل</span>
            <SearchSelect v-model="form.assetId" :options="assetOptions" :placeholder="wantDraft ? 'الأصول المسجلة بلا قيمة' : 'الأصول في الخدمة'" :empty-text="wantDraft ? 'سجل الأصل أولًا من سجل الأصول' : 'لا توجد أصول في الخدمة'" required />
          </label>
          <label class="field"><span>التاريخ</span><input v-model="form.date" type="date" class="input" :max="todayStr()" required /></label>
          <label v-if="op !== 'scrap' && op !== 'capitalize'" class="field"><span>{{ AMOUNT_LABEL[op] ?? 'المبلغ' }} (ريال)</span><input v-model.number="form.amount" type="number" min="0.01" step="0.01" class="input" required /></label>
        </div>
        <p v-if="picked && picked.status === 'active' && op !== 'purchase'" class="fa-sub">
          التكلفة {{ sar(picked.cost) }} · مجمع الإهلاك {{ sar(picked.accum) }} · صافي القيمة <b>{{ sar(picked.nbv) }}</b> · آخر إهلاك {{ picked.depreciatedThrough ?? '—' }}
          <template v-if="op === 'sale' && form.amount"> · المتوقع: <b :class="form.amount - picked.nbv >= 0 ? 'fa-money-pos' : 'fa-money-neg'">{{ form.amount - picked.nbv >= 0 ? 'ربح' : 'خسارة' }} نحو {{ sar(Math.abs(form.amount - picked.nbv)) }}</b> (قبل إهلاك الفترة الجزئية)</template>
          <template v-if="op === 'revaluation' && form.amount"> · <b :class="form.amount > picked.nbv ? 'fa-money-pos' : 'fa-money-neg'">{{ form.amount > picked.nbv ? `زيادة ${sar(form.amount - picked.nbv)} لفائض إعادة التقييم` : 'القيمة العادلة لا تزيد على صافي القيمة: سجّل هبوط قيمة' }}</b></template>
          <template v-if="op === 'impairment' && form.amount"> · <b :class="form.amount < picked.nbv ? 'fa-money-neg' : 'fa-money-pos'">{{ form.amount < picked.nbv ? `خسارة هبوط ${sar(picked.nbv - form.amount)}` : 'لا يوجد هبوط' }}</b></template>
        </p>
        <p v-if="op === 'capitalize' && detail" class="fa-sub">
          دفعات معتمدة: <b>{{ sar(detail.wip.total) }}</b> ({{ detail.wip.count }} دفعة)<template v-if="detail.wip.pending"> · <b class="fa-money-neg">{{ detail.wip.pending }} دفعة تنتظر الاعتماد</b></template>
          · تُنقل إلى حساب أصول مجموعة «{{ detail.groupName }}»
        </p>
        <p v-if="op === 'wip' && !lookups?.config.wipAccountId" class="ac-warn">حدد حساب المشروعات تحت التنفيذ في إعدادات النظام المالي (تبويب الأصول الثابتة) أولًا.</p>

        <template v-if="pays">
          <div class="field-row">
            <div class="field"><span>{{ op === 'sale' ? 'طريقة استلام قيمة البيع' : 'طريقة الشراء' }}</span>
              <div class="ac-switch">
                <button type="button" :class="{ on: form.method === 'cash' }" @click="form.method = 'cash'">نقدي</button>
                <button type="button" :class="{ on: form.method === 'bank' }" @click="form.method = 'bank'">بنكي</button>
                <button type="button" :class="{ on: form.method === 'credit' }" @click="form.method = 'credit'">آجل</button>
              </div>
            </div>
            <label v-if="form.method !== 'credit'" class="field"><span>{{ form.method === 'bank' ? 'الحساب البنكي' : 'الصندوق' }}</span>
              <select v-model="form.cashAccountId" class="input" required><option v-for="c in cashOptions" :key="c.id" :value="c.id">{{ c.name }}</option></select>
            </label>
            <label v-else class="field"><span>{{ op === 'sale' ? 'العميل أو الشريك (المشتري)' : 'المورد أو الشريك (البائع)' }}</span>
              <select v-model="form.partnerId" class="input" required><option value="" disabled>اختر من العملاء والموردين</option><option v-for="p in lookups?.partners ?? []" :key="p.id" :value="p.id">{{ p.name }}</option></select>
            </label>
            <label class="field"><span>{{ op === 'sale' ? 'اسم المشتري في السند' : 'اسم البائع في السند' }}</span><input v-model="form.partyName" class="input" placeholder="اختياري" /></label>
          </div>
        </template>
        <template v-if="spends">
          <div class="field-row">
            <label class="field"><span>بند الموازنة الرأسمالية</span>
              <select v-model="form.budgetLineId" class="input">
                <option value="">بدون (إنفاق غير مدرج في الموازنة)</option>
                <option v-for="l in lineOptions" :key="l.id" :value="l.id">{{ l.description }} · المتبقي {{ sar(l.remaining) }} ({{ l.year }})</option>
              </select>
            </label>
            <label class="field fa-check"><input v-model="form.funded" type="checkbox" /> <span>ممول من منحة أو مشروع (يُخفَّض المقيد عند اعتماد الشراء)</span></label>
          </div>
          <p v-if="pickedLine && form.amount && form.amount > pickedLine.remaining" class="ac-warn">المبلغ يتجاوز المتبقي في بند الموازنة ({{ sar(pickedLine.remaining) }}){{ lookups?.config.budgetControl === 'block' ? '، ولن يُقبل حسب الإعدادات' : '' }}.</p>
          <div v-if="form.funded" class="field-row fa-fund">
            <label class="field"><span>اسم المنحة أو المشروع</span><input v-model="form.fundingName" class="input" required placeholder="مثل: منحة مشروع التمكين الرقمي" /></label>
            <label class="field"><span>الحساب المقيد الذي يُخفَّض</span><SearchSelect v-model="form.fundingAccountId" :options="fundingOptions" placeholder="مثل: صافي الأصول المقيدة" required /></label>
            <label class="field"><span>المبلغ الممول (ريال)</span><input v-model.number="form.fundedAmount" type="number" min="0.01" step="0.01" class="input" :placeholder="form.amount ? `كامل المبلغ ${form.amount}` : 'كامل المبلغ'" /></label>
          </div>
        </template>
        <label v-if="op === 'revaluation'" class="field"><span>جهة التقييم (المقيّم المعتمد)</span><input v-model="form.partyName" class="input" required /></label>
        <label class="field"><span>{{ op === 'scrap' ? 'سبب التخريد ومرجعه' : op === 'impairment' ? 'سبب هبوط القيمة' : 'ملاحظات' }}</span><input v-model="form.notes" class="input" :required="op === 'scrap' || op === 'impairment'" /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">{{ OPS.find((o) => o.key === op)!.label }}</button></div>
      </form>
    </template>

    <section v-else class="card pm-panel">
      <div class="ac-toolbar">
        <select v-model="lf.kind" class="input"><option value="">كل العمليات</option><option value="opening">رصيد افتتاحي</option><option value="purchase">شراء</option><option value="addition">إضافة</option><option value="wip">دفعة تحت التنفيذ</option><option value="capitalize">رسملة</option><option value="revaluation">إعادة تقييم</option><option value="impairment">هبوط قيمة</option><option value="sale">بيع</option><option value="scrap">تخريد</option></select>
        <select v-model="lf.status" class="input"><option value="">كل الحالات</option><option value="pending">تنتظر اعتماد السند</option><option value="done">منفذة</option><option value="cancelled">ملغاة</option></select>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>رقم</th><th>العملية</th><th>الأصل</th><th>التاريخ</th><th>المبلغ</th><th>الطريقة</th><th>ربح / خسارة</th><th>السند والقيد</th><th>الحالة</th><th></th></tr></thead>
          <tbody>
            <tr v-for="m in log" :key="m.id" :class="{ voided: m.status === 'cancelled' }">
              <td class="ac-code">{{ m.moveNo }}</td><td><b>{{ m.kindLabel }}</b><span v-if="m.partyName" class="pm-muted">{{ m.partyName }}</span></td>
              <td><RouterLink v-if="m.asset" :to="`/accounting/assets/${m.asset.id}`" class="pm-link"><span class="ac-code">{{ m.asset.code }}</span></RouterLink><span class="pm-muted">{{ m.asset?.name }}</span></td>
              <td>{{ m.date }}</td><td class="ac-num">{{ sar(m.kind === 'sale' ? m.proceeds : m.amount) }}</td><td>{{ m.methodLabel ?? '' }}</td>
              <td class="ac-num"><span v-if="m.kind === 'sale' || m.kind === 'scrap' || m.kind === 'impairment'" :class="m.gainLoss >= 0 ? 'fa-money-pos' : 'fa-money-neg'">{{ sar(m.gainLoss) }}</span></td>
              <td>
                <RouterLink v-if="m.voucher" :to="`/accounting/vouchers/${m.voucher.id}`" class="pm-link">سند {{ m.voucher.kind === 'receipt' ? 'قبض' : 'صرف' }} {{ m.voucher.serial }}</RouterLink>
                <RouterLink v-if="m.entry" :to="`/accounting/entries/${m.entry.id}`" class="pm-link">القيد {{ m.entry.entryNo }}</RouterLink>
                <span v-if="m.funding" class="pm-muted">🎗️ {{ m.funding.name }}: {{ sar(m.funding.amount) }}<RouterLink v-if="m.funding.entry" :to="`/accounting/entries/${m.funding.entry.id}`" class="pm-link">قيد تحرير القيد {{ m.funding.entry.entryNo }}</RouterLink></span>
                <span v-if="m.budgetLine" class="pm-muted">الموازنة: {{ m.budgetLine.description }}</span>
              </td>
              <td><span class="pm-pill" :style="{ '--c': ST[m.status] }">{{ m.statusLabel }}</span><span v-if="m.cancelReason" class="pm-muted">{{ m.cancelReason }}</span></td>
              <td><button v-if="m.status === 'done' && CANCELLABLE.includes(m.kind) && session.can(P.assetsReverse)" class="btn btn-sm" @click="cancelOp(m)">إلغاء</button></td>
            </tr>
            <tr v-if="!log.length"><td colspan="10" class="pm-empty">لا توجد عمليات</td></tr>
          </tbody>
        </table>
      </div>
      <p class="fa-sub" style="margin-top: 10px">عمليات الشراء والبيع تُلغى من سندها في النظام المالي (طلب إلغاء السند المعتمد)، بشرط ألا يكون للأصل إهلاك محتسب بعدها.</p>
    </section>
  </div>
</template>

<style scoped>
.ops { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 10px; margin-bottom: 14px; }
.fa-check { flex-direction: row !important; align-items: center; gap: 8px; align-self: end; padding-bottom: 10px; }
.fa-fund { background: var(--surface-2); border-radius: 12px; padding: 10px; }
.opc { border: 1px solid var(--border); background: var(--surface); border-radius: 16px; padding: 14px 10px; font: inherit; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 6px;
  font-weight: 600; transition: .2s; }
.opc span { font-size: 1.6rem; transition: transform .25s; }
.opc:hover span { transform: scale(1.15) rotate(-6deg); }
.opc.on { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft), 0 10px 24px rgba(14,165,233,.12); color: var(--primary); }
td .pm-muted, td .pm-link { display: block; }
.voided td { color: var(--muted); }
@media (max-width: 800px) { .ops { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
</style>
