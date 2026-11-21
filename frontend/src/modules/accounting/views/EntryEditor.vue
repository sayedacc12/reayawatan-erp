<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import AccountCell from '../components/AccountCell.vue';
import AnalyticPicker, { type Share } from '../components/AnalyticPicker.vue';
import { ENTRY_STATUS, SOURCE_TYPES, P, VOUCHER_TYPES, allTypes, docTypes, dt, loadDocTypes, loadAnalytic, money, todayStr, useAccounts, type Analytic, type Partner } from '../lib';
import '../../projects/projects.css';
import '../acc.css';

interface Line { accountId: string | null; debit: number | null; credit: number | null; label: string; partnerId: string | null; analytic: Share[] }
interface Entry {
  id: string; entryNo: number; voucherType: string; voucherLabel: string; voucherNo: string; fiscalYear: number; entryDate: string; documentDate: string;
  description: string; counterparty: string | null; status: string; source: string; total: number; createdByName: string; postedAt: string | null; postedByName: string | null;
  cancelledAt: string | null; cancelledByName: string | null; cancelReason: string | null; voucherId: string | null; periodLocked: boolean; createdAt: string;
  lines: { accountId: string; accountCode: string; accountName: string; debit: number; credit: number; label: string | null; partnerId: string | null; partnerName: string | null; analytic: (Share & { code: string; name: string })[] }[];
}
const props = defineProps<{ id?: string }>();
const session = useSession();
const toast = useToast();
const router = useRouter();
const route = useRoute();
const { accounts, load: loadAccounts } = useAccounts();
const analytic = ref<Analytic[]>([]);
const partners = ref<Partner[]>([]);
const entry = ref<Entry | null>(null);
const error = ref('');
const busy = ref(false);

const blank = (): Line => ({ accountId: null, debit: null, credit: null, label: '', partnerId: null, analytic: [] });
const q = String(route.query.type ?? '');
const presetType = ['journal', 'adjustment', 'opening'].includes(q) || /^d_[a-z0-9]{6,16}$/.test(q) ? q : 'journal';
const form = reactive({ voucherType: presetType, documentDate: todayStr(), description: '', counterparty: '', lines: [blank(), blank()] as Line[] });

async function load() {
  try {
    await Promise.all([
      loadAccounts(),
      loadAnalytic().then((r) => { analytic.value = r.accounts; }),
      api<Partner[]>('/accounting/partners').then((r) => { partners.value = r; }).catch(() => {}),
    ]);
    if (props.id) {
      entry.value = await api<Entry>(`/accounting/entries/${props.id}`);
      fill(entry.value);
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function fill(e: Entry) {
  Object.assign(form, {
    voucherType: e.voucherType, documentDate: e.documentDate, description: e.description, counterparty: e.counterparty ?? '',
    lines: e.lines.map((l) => ({ accountId: l.accountId, debit: l.debit || null, credit: l.credit || null, label: l.label ?? '', partnerId: l.partnerId, analytic: l.analytic.map((a) => ({ analyticId: a.analyticId, percent: a.percent })) })),
  });
}
onMounted(load);
watch(() => props.id, () => { entry.value = null; load(); });

/** القيد الافتتاحي لا يخضع للترحيل: يسري بمجرد حفظه ويبقى قابلًا للتعديل ما دام شهره مفتوحًا */
const isOpening = computed(() => form.voucherType === 'opening');
const editable = computed(() => !entry.value || ((entry.value.status === 'draft' || (isOpening.value && entry.value.status === 'posted'))
  && entry.value.source === 'manual' && !entry.value.periodLocked));
const canEdit = computed(() => editable.value && session.can(P.entries));
const acc = (id: string | null) => accounts.value.find((a) => a.id === id);
const cents = (v: number | null) => Math.round(Number(v || 0) * 100);
const totD = computed(() => form.lines.reduce((s, l) => s + cents(l.debit), 0));
const totC = computed(() => form.lines.reduce((s, l) => s + cents(l.credit), 0));
const diff = computed(() => totD.value - totC.value);
const balanced = computed(() => totD.value > 0 && diff.value === 0);
function setSide(l: Line, side: 'debit' | 'credit') {
  if (Number(l[side]) > 0) l[side === 'debit' ? 'credit' : 'debit'] = null;
}
function addLine(i?: number) {
  const l = blank();
  // يقترح الفرق ليتوازن القيد
  if (diff.value > 0) l.credit = diff.value / 100;
  else if (diff.value < 0) l.debit = -diff.value / 100;
  l.label = form.lines.at(-1)?.label ?? '';
  form.lines.splice(i === undefined ? form.lines.length : i + 1, 0, l);
}
const lineIssue = (l: Line) => {
  const a = acc(l.accountId);
  if (!l.accountId) return '';
  if (a?.requiresAnalytic && !l.analytic.length) return 'يلزم حساب تحليلي';
  if (form.voucherType === 'opening' && (a?.nature === 'revenue' || a?.nature === 'expenses')) return 'لا أرصدة افتتاحية للإيرادات والمصروفات';
  return '';
};
const picker = ref<number | null>(null);
const analyticLabel = (s: Share[]) => s.map((x) => `${analytic.value.find((a) => a.id === x.analyticId)?.name ?? ''}${s.length > 1 ? ` ${x.percent}%` : ''}`).join('، ');
const partnerOptions = computed(() => partners.value.filter((p) => p.isActive));

async function save(post = false) {
  busy.value = true;
  try {
    const lines = form.lines.filter((l) => l.accountId || cents(l.debit) || cents(l.credit)).map((l) => ({
      accountId: l.accountId, debit: Number(l.debit || 0), credit: Number(l.credit || 0), label: l.label || null, partnerId: l.partnerId, analytic: l.analytic,
    }));
    const body = { documentDate: form.documentDate, description: form.description, counterparty: form.counterparty || null, lines };
    let saved: Entry;
    if (entry.value) {
      saved = await api<Entry>(`/accounting/entries/${entry.value.id}`, { method: 'PUT', json: body });
      if (post) saved = await api<Entry>(`/accounting/entries/${saved.id}/post`, { method: 'POST' });
    } else {
      saved = await api<Entry>('/accounting/entries', { method: 'POST', json: { ...body, voucherType: form.voucherType, post } });
    }
    toast.success(post && !isOpening.value ? `تم حفظ القيد رقم ${saved.entryNo} وترحيله` : `تم حفظ القيد رقم ${saved.entryNo}`);
    if (!entry.value) router.replace(`/accounting/entries/${saved.id}`);
    entry.value = saved;
    fill(saved);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function action(path: string, msg: string, body?: unknown) {
  busy.value = true;
  try {
    entry.value = await api<Entry>(`/accounting/entries/${entry.value!.id}/${path}`, { method: 'POST', json: body ?? {} });
    fill(entry.value);
    toast.success(msg);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
function cancelEntry() {
  const reason = prompt('سبب إلغاء القيد (يبقى رقمه ويظهر ملغيًا):');
  if (reason) action('cancel', 'أُلغي القيد', { reason });
}
const types = computed(() => [...VOUCHER_TYPES.filter((t) => t.value !== 'receipt' && t.value !== 'payment' && !SOURCE_TYPES.includes(t.value)), ...docTypes.value.filter((d) => d.isActive).map((d) => ({ value: d.code, label: d.name }))]);
loadDocTypes();
</script>

<template>
  <div>
    <section class="pm-hero ac-hero no-print">
      <div>
        <p class="pm-kicker"><RouterLink to="/accounting/entries" style="color: inherit">قيود اليومية</RouterLink> ‹ {{ entry ? `القيد رقم ${entry.entryNo}` : 'قيد جديد' }}</p>
        <h1>{{ entry ? `${entry.voucherLabel} ${entry.voucherNo}` : 'قيد يومية جديد' }}</h1>
        <p class="pm-sub">اكتب رقم الحساب أو جزءًا من اسمه ليظهر اسم الحساب تلقائيًا. السطر مدين أو دائن فقط، ولا يُحفظ القيد إلا متوازنًا.</p>
      </div>
      <div class="pm-actions">
        <template v-if="entry">
          <button v-if="entry.status === 'draft' && !isOpening && session.can(P.post) && !entry.periodLocked" class="btn ac-glow" :disabled="busy" @click="action('post', 'تم ترحيل القيد')">ترحيل</button>
          <button v-if="entry.status === 'posted' && !isOpening && entry.source === 'manual' && session.can(P.unpost)" class="btn ac-ghost" :disabled="busy || entry.periodLocked" @click="action('unpost', 'تم فك الترحيل')">فك الترحيل</button>
          <button v-if="entry.status !== 'cancelled' && entry.source === 'manual' && session.can(P.cancel)" class="btn ac-ghost" :disabled="busy || entry.periodLocked" @click="cancelEntry">إلغاء القيد</button>
          <RouterLink v-if="entry.voucherId" :to="`/accounting/vouchers/${entry.voucherId}`" class="btn ac-ghost">السند</RouterLink>
          <button class="btn ac-ghost" onclick="window.print()">طباعة</button>
          <RouterLink v-if="session.can(P.entries)" to="/accounting/entries/new" class="btn ac-ghost">قيد جديد</RouterLink>
        </template>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="entry?.source === 'assets'" class="ro-note no-print">
      <b>🔒 للاطلاع فقط</b>
      <span>هذا {{ entry.voucherLabel }} يصدر من الأصول الثابتة، ولا يُنشأ ولا يُعدَّل ولا يُلغى من النظام المالي. إلغاؤه يكون من
        <RouterLink :to="entry.voucherType === 'depreciation' ? '/accounting/assets/runs' : '/accounting/assets/operations?view=log'" class="pm-link">{{ entry.voucherType === 'depreciation' ? 'سجل حركات الإهلاك' : 'سجل عمليات الأصول' }}</RouterLink>.</span>
    </div>

    <div v-if="entry?.source === 'stock'" class="ro-note no-print">
      <b>🔒 للاطلاع فقط</b>
      <span>هذا سند مخازن يصدر من المستودعات مع كل حركة استلام أو صرف أو تحويل أو إتلاف أو جرد، ولا يُنشأ ولا يُعدَّل ولا يُلغى من النظام المالي. إلغاؤه يكون بإلغاء المستند في
        <RouterLink to="/procurement/stock-docs" class="pm-link">حركات المستودع</RouterLink> أو <RouterLink to="/procurement/receipts" class="pm-link">الاستلام</RouterLink>.</span>
    </div>

    <div v-if="entry?.source === 'payables'" class="ro-note no-print">
      <b>🔒 للاطلاع فقط</b>
      <span>هذا قيد فاتورة مورد سُجل من مستحقات الموردين بعد مطابقة الفاتورة مع التعميد والاستلام، ولا يُعدَّل ولا يُلغى من شاشة القيود. إلغاؤه يكون من
        <RouterLink to="/accounting/payables" class="pm-link">مستحقات الموردين</RouterLink>.</span>
    </div>

    <section :class="['card', 'pm-panel', 'sheet', { 'is-void': entry?.status === 'cancelled' }]">
      <div v-if="entry?.status === 'cancelled'" class="stamp">ملغي</div>
      <div class="head">
        <div v-if="entry" class="meta">
          <span class="pm-pill" :style="{ '--c': ENTRY_STATUS[entry.status].color }">{{ isOpening && entry.status === 'posted' ? 'ساري' : ENTRY_STATUS[entry.status].label }}</span>
          <span>رقم القيد <b class="ac-code">{{ entry.entryNo }}</b></span>
          <span>رقم المستند <b class="ac-code">{{ entry.voucherNo }}</b></span>
          <span v-if="entry.source === 'voucher'" class="pm-tag">ناتج عن سند</span>
          <span v-if="entry.source === 'system'" class="pm-tag">قيد آلي</span>
          <span v-if="entry.source === 'assets'" class="pm-tag">من الأصول الثابتة</span>
          <span v-if="entry.source === 'stock'" class="pm-tag">من المستودعات</span>
          <span v-if="entry.source === 'payables'" class="pm-tag">من مستحقات الموردين</span>
          <span v-if="entry.periodLocked" class="pm-tag">الفترة مغلقة</span>
        </div>
        <div class="field-row">
          <label class="field"><span>نوع المستند</span>
            <select v-model="form.voucherType" class="input" :disabled="!!entry">
              <option v-for="t in (entry ? allTypes : types)" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </label>
          <label class="field"><span>تاريخ القيد</span><input class="input" :value="entry?.entryDate ?? todayStr()" disabled /></label>
          <label class="field"><span>تاريخ المستند</span><input v-model="form.documentDate" class="input" type="date" :disabled="!canEdit" required /></label>
          <label class="field"><span>الجهة (اختياري)</span><input v-model="form.counterparty" class="input" :disabled="!canEdit" /></label>
        </div>
        <label class="field"><span>البيان</span><input v-model="form.description" class="input" :disabled="!canEdit" placeholder="شرح القيد" required /></label>
      </div>

      <div class="table-wrap lines">
        <table class="table">
          <thead><tr><th>#</th><th>الحساب</th><th>مدين</th><th>دائن</th><th>البيان</th><th>الشريك</th><th>التحليلي</th><th v-if="canEdit"></th></tr></thead>
          <tbody>
            <tr v-for="(l, i) in form.lines" :key="i" :class="{ warn: lineIssue(l) }">
              <td class="pm-muted">{{ i + 1 }}</td>
              <td><AccountCell v-model="l.accountId" :accounts="accounts" :disabled="!canEdit" @picked="(a) => { if (a.requiresAnalytic && !l.analytic.length) picker = i; }" />
                <small v-if="lineIssue(l)" class="issue">{{ lineIssue(l) }}</small></td>
              <td><input v-model.number="l.debit" class="input num ac-dr" type="number" min="0" step="0.01" :disabled="!canEdit" @input="setSide(l, 'debit')" /></td>
              <td><input v-model.number="l.credit" class="input num ac-cr" type="number" min="0" step="0.01" :disabled="!canEdit" @input="setSide(l, 'credit')" @keydown.enter.prevent="i === form.lines.length - 1 && addLine()" /></td>
              <td><input v-model="l.label" class="input" :disabled="!canEdit" /></td>
              <td>
                <select v-model="l.partnerId" class="input" :disabled="!canEdit" style="min-width: 130px">
                  <option :value="null">—</option>
                  <option v-for="p in partnerOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </td>
              <td>
                <button class="btn btn-sm an" :class="{ need: acc(l.accountId)?.requiresAnalytic && !l.analytic.length }" :disabled="!canEdit && !l.analytic.length" @click="picker = i">
                  {{ l.analytic.length ? analyticLabel(l.analytic) : (acc(l.accountId)?.requiresAnalytic ? 'مطلوب' : '+') }}
                </button>
              </td>
              <td v-if="canEdit" class="acts"><button class="btn btn-sm" title="سطر بعده" @click="addLine(i)">+</button><button class="btn btn-sm" :disabled="form.lines.length <= 2" @click="form.lines.splice(i, 1)">✕</button></td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="tot">
              <td></td><td><button v-if="canEdit" class="btn btn-sm" @click="addLine()">+ سطر</button></td>
              <td class="ac-num ac-dr">{{ money(totD / 100) }}</td><td class="ac-num ac-cr">{{ money(totC / 100) }}</td>
              <td colspan="4">
                <span v-if="balanced" class="bal ok">✓ القيد متوازن</span>
                <span v-else-if="totD || totC" class="bal">الفرق {{ money(Math.abs(diff) / 100) }} {{ diff > 0 ? 'مدين' : 'دائن' }}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div v-if="canEdit" class="modal-actions no-print">
        <button v-if="isOpening" class="btn btn-primary" :disabled="busy || !balanced" @click="save(false)">حفظ القيد الافتتاحي</button>
        <span v-if="isOpening" class="pm-muted">القيد الافتتاحي لا يخضع للترحيل، ويسري أثره بمجرد حفظه.</span>
        <button v-if="!isOpening" class="btn btn-primary" :disabled="busy || !balanced" @click="save(false)">حفظ (غير مرحّل)</button>
        <button v-if="!isOpening && session.can(P.post)" class="btn ac-glow" :disabled="busy || !balanced" @click="save(true)">حفظ وترحيل</button>
      </div>

      <div v-if="entry" class="audit">
        <span>أنشأه {{ entry.createdByName }} · {{ dt(entry.createdAt) }}</span>
        <span v-if="entry.postedAt && !isOpening">رحّله {{ entry.postedByName }} · {{ dt(entry.postedAt) }}</span>
        <span v-if="entry.cancelledAt" class="void">ألغاه {{ entry.cancelledByName }} · {{ dt(entry.cancelledAt) }} · {{ entry.cancelReason }}</span>
      </div>
    </section>

    <AnalyticPicker v-if="picker !== null" :model-value="form.lines[picker].analytic" :analytic="analytic" :amount="Number(form.lines[picker].debit || form.lines[picker].credit || 0)"
      :required="acc(form.lines[picker].accountId)?.requiresAnalytic" @update:model-value="(v) => { if (canEdit) form.lines[picker!].analytic = v; }" @close="picker = null" />
  </div>
</template>

<style scoped>
.sheet { position: relative; overflow: visible; }
.sheet.is-void { background: repeating-linear-gradient(-45deg, var(--surface), var(--surface) 18px, #fef2f2 18px, #fef2f2 20px); }
.stamp { position: absolute; top: 40px; inset-inline-end: 50px; transform: rotate(-14deg); border: 4px solid #dc2626; color: #dc2626; font-size: 2.2rem; font-weight: 900; padding: 4px 26px;
  border-radius: 12px; opacity: .8; pointer-events: none; animation: stampin .5s var(--ease) both; }
@keyframes stampin { from { transform: rotate(-14deg) scale(2.2); opacity: 0; } }
.meta { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; color: var(--muted); }
.lines { overflow: visible; }
.lines td { vertical-align: top; padding: 6px 6px; }
.num { width: 120px; text-align: end; font-variant-numeric: tabular-nums; }
tr.warn { background: #fffbeb; }
.issue { display: block; color: #b45309; font-size: .74rem; margin-top: 2px; }
.an { max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an.need { border-color: #f59e0b; color: #b45309; animation: ac-pulse 2s infinite; }
.acts { white-space: nowrap; }
tfoot .tot td { font-weight: 700; border-top: 2px solid var(--border); }
.bal { color: var(--danger); }
.bal.ok { color: var(--success); }
.audit { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 14px; font-size: .8rem; color: var(--muted); }
.audit .void { color: var(--danger); }
@media print { .lines input, .lines select { border: 0; background: none; } }
.ro-note { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; border-radius: 14px; padding: 12px 16px; margin-bottom: 14px; background: #f0f9ff; border: 1px solid #bae6fd; color: #075985; }
</style>
