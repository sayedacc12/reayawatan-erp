<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, downloadProtectedFile } from '../../../api';
import { useToast } from '../../../stores/toast';
import { CAT_COLOR, DOC_COLOR, addressText, billingLookups, fmtDate, fmtDateTime, money, sar, today } from '../lib';
import '../../projects/projects.css';
import '../../procurement/procurement.css';
import '../billing.css';

const props = defineProps<{ id: string }>();
const router = useRouter();
const toast = useToast();
const d = ref<any>(null);
const lk = ref<any>(null);
const busy = ref(false);
type Modal = '' | 'issue' | 'return' | 'cancel' | 'collect';
const modal = ref<Modal>('');
const note = ref('');
const issueDate = ref('');
const pay = ref<any>({ date: today(), method: 'transfer', cashAccountId: '', amount: 0, note: '' });
const base = () => `/billing/documents/${props.id}`;
async function downloadXml() {
  try {
    await downloadProtectedFile(`${base()}/xml`, `${d.value.code}.xml`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}

async function load() {
  try {
    d.value = await api(base());
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(async () => {
  await load();
  lk.value = await billingLookups().catch(() => null);
});
watch(() => props.id, load);

const open = (m: Modal) => {
  note.value = '';
  issueDate.value = today();
  if (m === 'collect') pay.value = { date: today(), method: 'transfer', cashAccountId: '', amount: Math.max(0, Math.round((d.value.outstanding - d.value.pendingCollect) * 100) / 100), note: '' };
  modal.value = m;
};
const cashFor = computed(() => (lk.value?.cashAccounts ?? []).filter((c: any) => (pay.value.method === 'cash' ? c.kind === 'cash' : c.kind === 'bank')));
async function act(path: string, json: object, done: string) {
  busy.value = true;
  try {
    d.value = await api(`${base()}/${path}`, { method: 'POST', json });
    toast.success(done);
    modal.value = '';
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
function confirm() {
  const m = modal.value;
  if (m === 'issue') return act('issue', { date: issueDate.value || null }, 'صدر المستند وأُنشئ قيده في النظام المالي');
  if (m === 'return') return act('return', { reason: note.value }, 'أُعيد المستند للتعديل');
  if (m === 'cancel') return act('cancel', { reason: note.value }, 'أُلغي المستند');
  if (m === 'collect') {
    return act('collect', { date: pay.value.date, method: pay.value.method, cashAccountId: pay.value.cashAccountId, amount: Number(pay.value.amount), note: pay.value.note || null },
      'أُنشئ سند القبض، ويمر بمراحل اعتماد سندات القبض في النظام المالي');
  }
}
const submit = () => act('submit', {}, 'أُرسل المستند للإصدار');
const TITLES: Record<string, string> = { issue: 'إصدار المستند', return: 'إعادة المستند للتعديل', cancel: 'إلغاء المستند قبل إصداره', collect: 'تحصيل بسند قبض' };
const printPage = () => window.print();
const seller = computed(() => d.value?.seller ?? (lk.value ? { name: lk.value.settings.sellerName, vatNumber: lk.value.settings.vatNumber, address: lk.value.settings.address } : null));
const docTitle = computed(() => {
  if (!d.value) return '';
  const t = d.value.docType === 'standard' ? 'فاتورة ضريبية' : d.value.docType === 'simplified' ? 'فاتورة ضريبية مبسطة' : 'فاتورة';
  return d.value.kind === 'invoice' ? t : `${d.value.kindLabel} (${t})`;
});
</script>

<template>
  <div v-if="d">
    <div class="page-head">
      <div>
        <h1>{{ d.kindLabel }} {{ d.code }}</h1>
        <p class="muted">
          {{ d.typeLabel }} · {{ d.buyer?.name ?? 'عميل نقدي' }} ·
          <span class="pm-pill" :style="{ '--c': DOC_COLOR[d.status] }">{{ d.statusLabel }}</span>
          <span v-if="d.overdue" class="pc-flag" style="margin-inline-start: 6px">متأخرة السداد</span>
        </p>
      </div>
      <div class="pc-inline pc-noprint">
        <template v-if="d.can.edit">
          <button class="btn" @click="router.push(`/billing/invoices/${d.id}/edit`)">تعديل</button>
          <button class="btn btn-primary" :disabled="busy" @click="submit">إرسال للإصدار</button>
        </template>
        <button v-if="d.can.issue" class="btn btn-primary" @click="open('issue')">إصدار</button>
        <button v-if="d.can.return" class="btn" @click="open('return')">إعادة للتعديل</button>
        <button v-if="d.can.collect" class="btn btn-primary" @click="open('collect')">تحصيل</button>
        <button v-if="d.can.creditNote" class="btn btn-ghost" @click="router.push(`/billing/invoices/new?kind=credit_note&ref=${d.id}`)">إشعار دائن</button>
        <button v-if="d.can.debitNote" class="btn btn-ghost" @click="router.push(`/billing/invoices/new?kind=debit_note&ref=${d.id}`)">إشعار مدين</button>
        <button v-if="d.can.cancel" class="btn btn-ghost" @click="open('cancel')">إلغاء</button>
        <button class="btn" @click="printPage">طباعة</button>
      </div>
    </div>
    <div v-if="d.returnReason && ['draft', 'cancelled'].includes(d.status)" class="alert alert-error pc-noprint">{{ d.status === 'cancelled' ? 'سبب الإلغاء' : 'أُعيد للتعديل' }}: {{ d.returnReason }}</div>
    <div v-if="d.can.issueBlocked" class="alert pc-noprint" style="background: #fffbeb">لا يمكنك إصدار هذا المستند لأنك أعددته أو عدّلته أو أرسلته (فصل المهام). يصدره موظف آخر لديه صلاحية الإصدار.</div>
    <div v-if="d.categoryOverrides?.length && ['draft', 'pending'].includes(d.status)" class="alert pc-noprint" style="background: #fffbeb">
      <b>تنبيه للمصدِر: فئة ضريبية مختلفة عن فئة الصنف.</b> {{ d.categoryOverrides.join('؛ ') }}
    </div>
    <div v-if="d.buyerProblems?.length" class="alert alert-error pc-noprint">بيانات المشتري ناقصة للفاتورة الضريبية: {{ d.buyerProblems.join('، ') }}</div>

    <div class="pc-grid" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)">
      <section class="card bl-invoice">
        <div class="bl-invoice-head">
          <div>
            <h2>{{ docTitle }}</h2>
            <p class="pc-code" style="margin: 0">{{ d.code }}</p>
            <p class="pm-muted" style="margin: 4px 0 0; font-size: .82rem">
              تاريخ الإصدار {{ fmtDate(d.issueDate) }}<template v-if="d.issuedAt"> · {{ fmtDateTime(d.issuedAt) }}</template>
              <template v-if="d.supplyDate"> · تاريخ التوريد {{ fmtDate(d.supplyDate) }}</template>
              <template v-if="d.dueDate && d.kind === 'invoice'"> · الاستحقاق {{ fmtDate(d.dueDate) }}</template>
            </p>
            <p v-if="d.ref" style="margin: 4px 0 0; font-size: .84rem">على الفاتورة <RouterLink class="pm-link" :to="`/billing/invoices/${d.ref.id}`">{{ d.ref.code }}</RouterLink> بتاريخ {{ fmtDate(d.ref.issueDate) }} · السبب: {{ d.reason }}</p>
            <p v-if="!d.icv" style="margin-top: 8px"><span class="bl-stamp">مسودة غير صادرة</span></p>
          </div>
          <img v-if="d.qrImage" :src="d.qrImage" alt="رمز الاستجابة السريعة للفاتورة" />
        </div>
        <div class="bl-parties">
          <div>
            <h3>البائع</h3>
            <p><b>{{ seller?.name }}</b></p>
            <p v-if="seller?.vatNumber">الرقم الضريبي: <span class="pc-code">{{ seller.vatNumber }}</span></p>
            <p>{{ addressText(seller?.address) }}</p>
          </div>
          <div>
            <h3>المشتري</h3>
            <p><b>{{ d.buyer?.name ?? 'عميل نقدي' }}</b> <RouterLink v-if="d.customer" class="pm-link pc-noprint" :to="`/billing/customers/${d.customer.id}`">{{ d.customer.code }}</RouterLink></p>
            <p v-if="d.buyer?.vatNumber">الرقم الضريبي: <span class="pc-code">{{ d.buyer.vatNumber }}</span></p>
            <p v-if="d.buyer?.idNumber">{{ lk?.idTypes?.[d.buyer.idType] ?? 'المعرّف' }}: {{ d.buyer.idNumber }}</p>
            <p v-if="d.buyer?.address">{{ addressText(d.buyer.address) }}</p>
          </div>
        </div>
        <div class="table-wrap">
          <table class="bl-lines">
            <thead><tr><th>البيان</th><th>الكمية</th><th>السعر</th><th>الخصم</th><th>الصافي</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
            <tbody>
              <tr v-for="l in d.lines" :key="l.id">
                <td>{{ l.description }}<small class="pm-muted" style="display: block"><span :style="{ color: CAT_COLOR[l.category] }">{{ l.categoryLabel }} {{ l.rate }}%</span><template v-if="l.reasonText"> · {{ l.reasonText }}</template></small></td>
                <td class="pc-num">{{ l.qty }} {{ l.unit ?? '' }}</td>
                <td class="pc-num">{{ money(l.unitPrice) }}</td>
                <td class="pc-num">{{ l.discount ? money(l.discount) : '—' }}</td>
                <td class="pc-num">{{ money(l.net) }}</td>
                <td class="pc-num">{{ money(l.vat) }}</td>
                <td class="pc-num">{{ money(l.total) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="bl-totals" style="margin-top: 12px">
          <div><span>الإجمالي قبل الخصم</span><span class="pc-num">{{ sar(d.gross) }}</span></div>
          <div v-if="d.discount"><span>الخصم</span><span class="pc-num">− {{ sar(d.discount) }}</span></div>
          <div><span>الإجمالي الخاضع للضريبة</span><span class="pc-num">{{ sar(d.taxable) }}</span></div>
          <div v-for="b in d.breakdown" :key="`${b.category}${b.rate}${b.reasonCode}`" style="font-size: .82rem; color: var(--muted)"><span>{{ lk?.vatCategories?.[b.category] }} {{ b.rate }}%<template v-if="b.reasonText"> ({{ b.reasonText }})</template>: {{ money(b.taxable) }}</span><span class="pc-num">{{ money(b.vat) }}</span></div>
          <div v-if="d.docType !== 'nontax'"><span>مجموع ضريبة القيمة المضافة</span><span class="pc-num">{{ sar(d.vat) }}</span></div>
          <div class="grand"><span>الإجمالي شامل الضريبة</span><span class="pc-num">{{ sar(d.total) }}</span></div>
        </div>
        <p v-if="d.notes" style="white-space: pre-line; margin-top: 12px; font-size: .86rem">{{ d.notes }}</p>
        <p v-if="d.terms && d.kind === 'invoice'" class="pm-muted" style="white-space: pre-line; font-size: .8rem">{{ d.terms }}</p>
        <p v-if="d.uuid" class="pm-muted" style="font-size: .72rem; margin: 10px 0 0">المعرّف الفريد <span class="pc-code">{{ d.uuid }}</span> · العداد {{ d.icv }}</p>
        <p v-if="d.hasXml" class="pm-muted" style="font-size: .72rem; margin: 4px 0 0">بصمة المستند <span class="pc-code" dir="ltr">{{ d.invoiceHash }}</span></p>
        <p v-if="d.hasXml && d.signedEnv !== 'production'" style="margin: 6px 0 0"><span class="bl-stamp">نسخة تجريبية: موقّعة بشهادة {{ d.signedEnvLabel }}</span></p>
      </section>

      <div style="display: grid; gap: 16px; align-content: start" class="pc-noprint">
        <section class="card pm-panel">
          <h2>القيد والتحصيل</h2>
          <dl class="pc-dl" style="grid-template-columns: 1fr">
            <div><dt>قيد المستند</dt><dd><RouterLink v-if="d.entry" class="pm-link" :to="`/accounting/entries/${d.entry.id}`">قيد {{ d.entry.entryNo }} · {{ d.entry.voucherNo }}</RouterLink><span v-else>يُنشأ عند الإصدار</span></dd></div>
            <template v-if="d.kind === 'invoice' && d.icv">
              <div><dt>المحصّل</dt><dd>{{ sar(d.paidAmount) }}</dd></div>
              <div v-if="d.creditedAmount"><dt>الإشعارات الدائنة</dt><dd>− {{ sar(d.creditedAmount) }}</dd></div>
              <div v-if="d.debitedAmount"><dt>الإشعارات المدينة</dt><dd>+ {{ sar(d.debitedAmount) }}</dd></div>
              <div><dt>المتبقي</dt><dd><b>{{ sar(d.outstanding) }}</b><small v-if="d.pendingCollect" class="pm-muted" style="display: block">منها {{ sar(d.pendingCollect) }} في سندات قيد الاعتماد</small></dd></div>
            </template>
            <div v-if="d.analytic"><dt>مركز التكلفة</dt><dd>{{ d.analytic.code }} · {{ d.analytic.name }}</dd></div>
          </dl>
          <ul v-if="d.receipts.length" class="pc-log" style="margin-top: 8px">
            <li v-for="r in d.receipts" :key="r.id"><span><RouterLink class="pm-link" :to="`/accounting/vouchers/${r.id}`">سند قبض {{ r.serial }}</RouterLink> · {{ fmtDate(r.voucherDate) }} · {{ sar(r.amount) }} <small class="pm-muted">{{ r.statusLabel }}</small></span></li>
          </ul>
          <ul v-if="d.adjustments?.length" class="pc-log" style="margin-top: 8px">
            <li v-for="n in d.adjustments" :key="n.id"><span><RouterLink class="pm-link" :to="`/billing/invoices/${n.id}`">{{ n.kindLabel }} {{ n.code }}</RouterLink> · {{ sar(n.total) }} <small class="pm-muted">{{ n.statusLabel }}</small></span></li>
          </ul>
        </section>
        <section v-if="d.hasXml" class="card pm-panel">
          <h2>الفاتورة الإلكترونية</h2>
          <dl class="pc-dl" style="grid-template-columns: 1fr">
            <div><dt>التوقيع</dt><dd>موقّعة بشهادة الجمعية ({{ d.signedEnvLabel }})</dd></div>
            <div><dt>بصمة المستند السابق</dt><dd class="pc-code" dir="ltr" style="font-size: .72rem; word-break: break-all">{{ d.pih }}</dd></div>
            <div><dt>الإرسال للمنصة</dt><dd>لم يُرسل بعد (يُفعّل الإرسال في المرحلة القادمة)</dd></div>
          </dl>
          <button class="btn" style="margin-top: 8px" @click="downloadXml">تنزيل ملف الفاتورة (XML)</button>
        </section>
        <section class="card pm-panel">
          <h2>الإعداد والإصدار</h2>
          <dl class="pc-dl" style="grid-template-columns: 1fr">
            <div><dt>أعدّه</dt><dd>{{ d.createdByName }}</dd></div>
            <div v-if="d.issuedByName"><dt>أصدره</dt><dd>{{ d.issuedByName }} · {{ fmtDateTime(d.issuedAt) }}</dd></div>
          </dl>
        </section>
        <section class="card pm-panel">
          <h2>السجل</h2>
          <ul class="pc-log">
            <li v-for="(x, i) in [...d.log].reverse()" :key="i"><span><b>{{ x.action }}</b> · {{ x.byName }} <small class="pm-muted">{{ fmtDateTime(x.at) }}</small><div v-if="x.note" class="pm-muted" style="font-size: .8rem">{{ x.note }}</div></span></li>
          </ul>
        </section>
      </div>
    </div>

    <div v-if="modal" class="modal-backdrop" @click.self="modal = ''">
      <form class="card modal" @submit.prevent="confirm">
        <h2>{{ TITLES[modal] }}</h2>
        <template v-if="modal === 'issue'">
          <p class="pm-muted" style="font-size: .85rem">راجع المستند كاملًا قبل الإصدار. بعد الإصدار يثبت رقمه وعداده ورمز QR، ويُنشأ قيده المرحّل في النظام المالي: {{ d.kind === 'credit_note' ? 'دائن الذمم، ومدين الإيراد والضريبة' : 'مدين الذمم بالإجمالي، ودائن الإيراد وضريبة المخرجات' }}. ولا يُعدّل ولا يُلغى بعد ذلك.</p>
          <div class="bl-totals" style="margin: 0 0 10px; max-width: none"><div><span>{{ d.buyer?.name ?? 'عميل نقدي' }}</span><b class="pc-num">{{ sar(d.total) }}</b></div></div>
          <label class="field"><span>تاريخ الإصدار</span><input v-model="issueDate" type="date" class="input" :max="today()" required /><small class="pm-muted">بعد الربط مع منصة «فاتورة» يكون تاريخ الإصدار هو اليوم دائمًا.</small></label>
        </template>
        <template v-if="modal === 'collect'">
          <p class="pm-muted" style="font-size: .85rem">ينشأ سند قبض في النظام المالي بالمبلغ على حساب العميل، ويمر بمراحل اعتماد سندات القبض، ويُحدّث المحصّل عند اعتماده.</p>
          <label class="field"><span>التاريخ</span><input v-model="pay.date" type="date" class="input" :max="today()" required /></label>
          <label class="field"><span>الطريقة</span><select v-model="pay.method" class="input" @change="pay.cashAccountId = ''"><option value="transfer">تحويل بنكي</option><option value="card">شبكة (مدى)</option><option value="cash">نقدًا</option></select></label>
          <label class="field"><span>{{ pay.method === 'cash' ? 'الصندوق' : 'الحساب البنكي' }}</span><select v-model="pay.cashAccountId" class="input" required><option value="">اختر…</option><option v-for="c in cashFor" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
          <label class="field"><span>المبلغ</span><input v-model.number="pay.amount" type="number" min="0.01" step="any" class="input" required /></label>
          <label class="field"><span>ملاحظة</span><input v-model="pay.note" class="input" maxlength="500" /></label>
        </template>
        <label v-if="modal === 'return' || modal === 'cancel'" class="field"><span>السبب</span><textarea v-model="note" class="input" rows="3" required minlength="3" maxlength="500" /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">تأكيد</button><button type="button" class="btn" @click="modal = ''">رجوع</button></div>
      </form>
    </div>
  </div>
</template>
