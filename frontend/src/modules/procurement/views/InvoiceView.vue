<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, openProtectedFile } from '../../../api';
import { useToast } from '../../../stores/toast';
import { INVOICE_COLOR, fmtDate, fmtDateTime, fmtQty, fmtSize, sar, today, upload } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const props = defineProps<{ id: string }>();
const router = useRouter();
const toast = useToast();
const d = ref<any>(null);
const lk = ref<any>(null);
const busy = ref(false);
type Modal = '' | 'approve' | 'return' | 'reject' | 'cancel' | 'post' | 'unpost' | 'pay';
const modal = ref<Modal>('');
const note = ref('');
const pay = ref<any>({ date: today(), method: 'bank', cashAccountId: '', amount: 0, note: '' });
const postDate = ref('');
const msg = ref('');
const base = () => `/procurement/invoices/${props.id}`;

async function load() {
  try {
    d.value = await api(base());
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(async () => {
  await load();
  lk.value = await api('/procurement/invoice-lookups').catch(() => null);
});
watch(() => props.id, load);

const issues = computed(() => d.value?.match?.issues ?? []);
const open = (m: Modal) => {
  note.value = '';
  if (m === 'pay') pay.value = { date: today(), method: 'bank', cashAccountId: '', amount: Math.max(0, Math.round((d.value.outstanding - d.value.pendingPay) * 100) / 100), note: '' };
  if (m === 'post') postDate.value = d.value.invoiceDate;
  modal.value = m;
};
const cashFor = computed(() => (lk.value?.cashAccounts ?? []).filter((c: any) => c.kind === pay.value.method));

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
  if (m === 'approve') return act('approve', { note: note.value || null, overrideReason: issues.value.length ? note.value || null : null }, issues.value.length ? 'اعتُمدت الفاتورة بتجاوز الاستثناءات وأُحيلت للمالي' : 'اعتُمدت المطابقة وأُحيلت الفاتورة للمالي');
  if (m === 'return') return act('return', { reason: note.value }, 'أُعيدت الفاتورة للتصحيح');
  if (m === 'reject') return act('reject', { reason: note.value }, 'رُفضت الفاتورة');
  if (m === 'cancel') return act('cancel', { reason: note.value }, 'أُلغيت الفاتورة');
  if (m === 'post') return act('post', { date: postDate.value || null }, 'سُجل المستحق في النظام المالي بقيد فاتورة مورد');
  if (m === 'unpost') return act('unpost', { reason: note.value }, 'أُلغي تسجيل المستحق وعادت الفاتورة لقائمة المحالة للمالي');
  if (m === 'pay') {
    return act('pay', { date: pay.value.date, method: pay.value.method, cashAccountId: pay.value.cashAccountId, amount: Number(pay.value.amount), note: pay.value.note || null },
      'أُنشئ سند الصرف، ويمر بمراحل اعتماد سندات الصرف');
  }
}
async function send() {
  if (!msg.value.trim()) return;
  busy.value = true;
  try {
    d.value = await api(`${base()}/messages`, { method: 'POST', json: { text: msg.value } });
    msg.value = '';
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function addFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    d.value = await upload(`${base()}/files`, f);
  } catch (err) {
    toast.error((err as Error).message);
  }
}
async function removeFile(key: string) {
  try {
    d.value = await api(`${base()}/files/${key}`, { method: 'DELETE' });
  } catch (err) {
    toast.error((err as Error).message);
  }
}
const openFile = (key: string) => openProtectedFile(`${base()}/files/${key}`).catch((e: Error) => toast.error(e.message));
async function submit() {
  await act('submit', {}, 'أُرسلت الفاتورة للمراجعة والمطابقة');
}
const printPage = () => window.print();
const TITLES: Record<string, string> = {
  approve: 'اعتماد المطابقة وإحالة الفاتورة للمالي', return: 'إعادة الفاتورة للتصحيح', reject: 'رفض الفاتورة', cancel: 'إلغاء الفاتورة',
  post: 'تسجيل المستحق في النظام المالي', unpost: 'إلغاء تسجيل المستحق', pay: 'سند صرف لسداد الفاتورة',
};
</script>

<template>
  <div v-if="d">
    <div class="page-head">
      <div>
        <h1>{{ d.kindLabel }} {{ d.code }}</h1>
        <p class="muted">
          {{ d.supplier.name }} · رقم المورد {{ d.supplierInvoiceNo }} · {{ fmtDate(d.invoiceDate) }} ·
          <span class="pm-pill" :style="{ '--c': INVOICE_COLOR[d.status] }">{{ d.statusLabel }}</span>
          <span v-if="d.overdue" class="pc-flag" style="margin-inline-start: 6px">متأخرة السداد</span>
        </p>
      </div>
      <div class="pc-inline pc-noprint">
        <template v-if="d.can.edit">
          <button class="btn" @click="router.push(`/procurement/invoices/${d.id}/edit`)">تعديل</button>
          <button class="btn btn-primary" :disabled="busy" @click="submit">إرسال للمطابقة</button>
        </template>
        <button v-if="d.can.approve" class="btn btn-primary" @click="open('approve')">{{ issues.length ? 'اعتماد بتجاوز' : 'اعتماد المطابقة' }}</button>
        <button v-if="d.can.decline" class="btn" @click="open('return')">إعادة للتصحيح</button>
        <button v-if="d.can.decline" class="btn btn-ghost" @click="open('reject')">رفض</button>
        <button v-if="d.can.post" class="btn btn-primary" @click="open('post')">تسجيل المستحق</button>
        <button v-if="d.can.pay" class="btn btn-primary" @click="open('pay')">سداد</button>
        <button v-if="d.can.unpost" class="btn btn-ghost" @click="open('unpost')">إلغاء التسجيل</button>
        <button v-if="d.can.creditNote" class="btn btn-ghost" @click="router.push(`/procurement/invoices/new?order=${d.orderId}&kind=credit_note`)">إشعار دائن</button>
        <button v-if="d.can.cancel" class="btn btn-ghost" @click="open('cancel')">إلغاء</button>
        <button class="btn" @click="printPage">طباعة</button>
      </div>
    </div>
    <div v-if="d.returnReason && ['returned', 'rejected', 'cancelled'].includes(d.status)" class="alert alert-error">{{ d.returnReason }}</div>

    <section class="card pm-panel" :style="{ marginBottom: '14px', borderInlineStart: `4px solid ${d.match?.ok ? '#059669' : '#dc2626'}` }">
      <h2>المطابقة الثلاثية: التعميد والاستلام والفاتورة</h2>
      <p v-if="d.match?.ok" style="color: #047857; margin: 0">✓ الكميات لا تتجاوز المستلم المقبول غير المفوتر، والأسعار ضمن سعر التعميد، ولا توجد فاتورة مكررة.</p>
      <ul v-else-if="d.match" style="margin: 0; padding-inline-start: 18px">
        <li v-for="(x, i) in issues" :key="i" style="color: #b91c1c"><b>{{ d.matchIssues[x.kind] }}:</b> {{ x.message }}</li>
      </ul>
      <p v-if="d.override" class="pm-muted" style="margin: 6px 0 0">اعتُمدت بتجاوز الاستثناءات من {{ d.override.byName }} ({{ fmtDateTime(d.override.at) }}): {{ d.override.reason }}</p>
      <small class="pm-muted">{{ ['draft', 'submitted', 'returned'].includes(d.status) ? 'المطابقة محدّثة الآن بآخر استلام وفوترة.' : `المطابقة كما كانت عند الاعتماد ${fmtDateTime(d.match?.at)}.` }}</small>
    </section>

    <div class="pc-grid" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)">
      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <dl class="pc-dl">
            <div><dt>المورد</dt><dd><RouterLink class="pm-link" :to="`/procurement/suppliers/${d.supplier.id}`">{{ d.supplier.code }} · {{ d.supplier.name }}</RouterLink><small v-if="d.supplier.vatNumber" class="pm-muted" style="display: block">الرقم الضريبي {{ d.supplier.vatNumber }}</small></dd></div>
            <div><dt>التعميد</dt><dd><RouterLink class="pm-link" :to="`/procurement/orders/${d.order.id}`">{{ d.order.code }}</RouterLink> {{ d.order.title }}</dd></div>
            <div v-if="d.ref"><dt>الفاتورة الأصلية</dt><dd><RouterLink class="pm-link" :to="`/procurement/invoices/${d.ref.id}`">{{ d.ref.code }}</RouterLink> · رقم المورد {{ d.ref.supplierInvoiceNo }}</dd></div>
            <div><dt>الاستحقاق</dt><dd>{{ fmtDate(d.dueDate) }}</dd></div>
            <div><dt>المصدر</dt><dd>{{ d.via === 'portal' ? 'بوابة المورد' : `سجلها ${d.createdByName}` }}</dd></div>
            <div v-if="d.approvedByName"><dt>اعتمد المطابقة</dt><dd>{{ d.approvedByName }}</dd></div>
            <div v-if="d.postedByName"><dt>سجل المستحق</dt><dd>{{ d.postedByName }}</dd></div>
          </dl>
        </section>
        <section class="card pm-panel">
          <h2>البنود</h2>
          <table class="pc-lines">
            <thead><tr><th>البند</th><th>الكمية</th><th>سعر الوحدة</th><th>سعر التعميد</th><th>المبلغ</th></tr></thead>
            <tbody>
              <tr v-for="l in d.lines" :key="l.id">
                <td>{{ l.description }}</td>
                <td class="pc-num">{{ fmtQty(l.qty) }}</td>
                <td class="pc-num" :style="{ color: l.unitPrice > l.orderPrice ? '#b91c1c' : '' }">{{ l.unitPrice }}</td>
                <td class="pc-num">{{ l.orderPrice }}</td>
                <td class="pc-num">{{ sar(l.amount) }}</td>
              </tr>
              <tr v-if="d.extraAmount"><td colspan="4">مصاريف نقل وتخليص</td><td class="pc-num">{{ sar(d.extraAmount) }}</td></tr>
            </tbody>
            <tfoot>
              <tr><td colspan="4">قبل الضريبة</td><td class="pc-num">{{ sar(d.subtotal) }}</td></tr>
              <tr><td colspan="4">الضريبة {{ d.vatRate }}%</td><td class="pc-num">{{ sar(d.vat) }}</td></tr>
              <tr><td colspan="4"><b>الإجمالي</b></td><td class="pc-num"><b>{{ sar(d.total) }}</b></td></tr>
            </tfoot>
          </table>
          <p v-if="d.notes" class="pm-muted" style="white-space: pre-line; margin-top: 8px">{{ d.notes }}</p>
        </section>
        <section class="card pm-panel pc-noprint">
          <h2>الاستفسارات مع المورد</h2>
          <ul class="pc-log">
            <li v-for="(m, i) in d.messages" :key="i"><span><b>{{ m.from === 'supplier' ? 'المورد' : 'الجمعية' }}: {{ m.byName }}</b> <small class="pm-muted">{{ fmtDateTime(m.at) }}</small><div style="white-space: pre-line">{{ m.text }}</div></span></li>
            <li v-if="!d.messages.length" class="pm-muted">لا توجد استفسارات.</li>
          </ul>
          <form v-if="d.can.message" class="pc-inline" style="margin-top: 8px" @submit.prevent="send"><input v-model="msg" class="input grow" maxlength="2000" placeholder="اكتب رسالة للمورد" /><button class="btn" :disabled="busy">إرسال</button></form>
        </section>
      </div>
      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2>المستحق والسداد</h2>
          <dl class="pc-dl" style="grid-template-columns: 1fr">
            <div><dt>قيد فاتورة المورد</dt><dd><RouterLink v-if="d.entry" class="pm-link" :to="`/accounting/entries/${d.entry.id}`">قيد {{ d.entry.entryNo }} · {{ d.entry.voucherNo }}</RouterLink><span v-else>{{ d.status === 'approved' ? 'بانتظار تسجيل النظام المالي' : '—' }}</span></dd></div>
            <div v-if="d.kind === 'invoice'"><dt>المسدد</dt><dd>{{ sar(d.paidAmount) }}</dd></div>
            <div v-if="d.creditedAmount"><dt>المخصوم بإشعارات دائنة</dt><dd>{{ sar(d.creditedAmount) }}</dd></div>
            <div v-if="d.kind === 'invoice'"><dt>المتبقي</dt><dd><b>{{ sar(d.outstanding) }}</b><small v-if="d.pendingPay" class="pm-muted" style="display: block">منها {{ sar(d.pendingPay) }} في سندات قيد الاعتماد</small></dd></div>
            <div v-if="d.budgetDiff"><dt>فرق السعر على الموازنة</dt><dd>{{ sar(d.budgetDiff) }}</dd></div>
          </dl>
          <ul v-if="d.payments.length" class="pc-log" style="margin-top: 8px">
            <li v-for="p in d.payments" :key="p.id"><span><RouterLink class="pm-link" :to="`/accounting/vouchers/${p.id}`">سند صرف {{ p.serial }}</RouterLink> · {{ fmtDate(p.voucherDate) }} · {{ sar(p.amount) }} <small class="pm-muted">{{ p.statusLabel }}</small></span></li>
          </ul>
          <ul v-if="d.credits.length" class="pc-log" style="margin-top: 8px">
            <li v-for="c in d.credits" :key="c.id"><span><RouterLink class="pm-link" :to="`/procurement/invoices/${c.id}`">{{ c.code }}</RouterLink> · {{ sar(c.total) }} <small class="pm-muted">{{ c.statusLabel }}</small></span></li>
          </ul>
        </section>
        <section class="card pm-panel pc-noprint">
          <h2>صورة الفاتورة</h2>
          <ul class="pc-log">
            <li v-for="f in d.attachments" :key="f.key"><span><a class="pm-link" href="#" @click.prevent="openFile(f.key)">{{ f.name }}</a> <small class="pm-muted">{{ fmtSize(f.size) }}</small></span>
              <button v-if="d.can.edit" class="btn btn-ghost" @click="removeFile(f.key)">✕</button></li>
            <li v-if="!d.attachments.length" class="pm-muted">لا توجد مرفقات.</li>
          </ul>
          <label v-if="d.can.edit" class="btn" style="margin-top: 8px">إرفاق<input type="file" accept=".pdf,image/*" hidden @change="addFile" /></label>
        </section>
        <section class="card pm-panel pc-noprint">
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
        <template v-if="modal === 'approve'">
          <p v-if="!issues.length" class="pm-muted" style="font-size: .85rem">الفاتورة مطابقة للتعميد والاستلام. تُحال للنظام المالي ليسجل المستحق ويسدده.</p>
          <div v-else class="alert alert-error" style="font-size: .85rem">الفاتورة غير مطابقة ({{ issues.length }} استثناء). الاعتماد بتجاوز يُسجل باسمك مع السبب.</div>
        </template>
        <p v-if="modal === 'post'" class="pm-muted" style="font-size: .85rem">يصدر قيد فاتورة مورد مرحّل: البضاعة المستلمة غير المفوترة وضريبة المدخلات وفرق السعر مدينة، وحساب المورد دائن بالإجمالي. وفرق السعر لبنود الأصول الثابتة يُضاف لتكلفة الأصل، ويُحمّل فرق السعر على بند الموازنة ومصدر التمويل.</p>
        <label v-if="modal === 'post'" class="field"><span>تاريخ القيد</span><input v-model="postDate" type="date" class="input" :max="today()" required /></label>
        <template v-if="modal === 'pay'">
          <p class="pm-muted" style="font-size: .85rem">ينشأ سند صرف بالمبلغ على حساب المورد، ويمر بمراحل اعتماد سندات الصرف، ويُحدّث المسدد عند اعتماده.</p>
          <label class="field"><span>التاريخ</span><input v-model="pay.date" type="date" class="input" :max="today()" required /></label>
          <label class="field"><span>الطريقة</span><select v-model="pay.method" class="input" @change="pay.cashAccountId = ''"><option value="bank">حوالة بنكية</option><option value="cash">نقدًا</option></select></label>
          <label class="field"><span>{{ pay.method === 'bank' ? 'الحساب البنكي' : 'الصندوق' }}</span><select v-model="pay.cashAccountId" class="input" required><option value="">اختر…</option><option v-for="c in cashFor" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
          <label class="field"><span>المبلغ</span><input v-model.number="pay.amount" type="number" min="0.01" step="any" class="input" required /></label>
          <label class="field"><span>ملاحظة</span><input v-model="pay.note" class="input" maxlength="500" /></label>
        </template>
        <label v-if="modal !== 'post' && modal !== 'pay'" class="field">
          <span>{{ modal === 'approve' ? (issues.length ? 'سبب التجاوز' : 'ملاحظة (اختياري)') : 'السبب' }}</span>
          <textarea v-model="note" class="input" rows="3" :required="modal !== 'approve' || issues.length > 0" :minlength="modal === 'approve' && issues.length ? 5 : 3" />
        </label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">تأكيد</button><button type="button" class="btn" @click="modal = ''">رجوع</button></div>
      </form>
    </div>
  </div>
</template>
