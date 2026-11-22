<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { INVOICE_COLOR, INV_READ, ORDER_COLOR, PR, RECEIPT_COLOR, fmtDate, fmtDateTime, fmtQty, sar } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

const props = defineProps<{ id: string }>();
const router = useRouter();
const toast = useToast();
const o = ref<any>(null);
const busy = ref(false);
const modal = ref<'' | 'approve' | 'return' | 'cancel' | 'reply' | 'amend' | 'short'>('');
const note = ref('');
const amend = ref<any>({ lines: [], deliveryDate: '', terms: '' });
const base = () => `/procurement/orders/${props.id}`;

const session = useSession();
const invoices = ref<any[]>([]);
const canInvRead = () => INV_READ.some((p) => session.can(p));
const INVOICEABLE = ['issued', 'acknowledged', 'accepted', 'clarification', 'partial', 'closed'];
async function load() {
  try {
    o.value = await api(base());
    invoices.value = canInvRead() ? await api<any[]>(`/procurement/invoices?order=${props.id}`).catch(() => []) : [];
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
watch(() => props.id, load);

async function run(fn: () => Promise<any>, ok: string) {
  busy.value = true;
  try {
    o.value = await fn();
    toast.success(ok);
    modal.value = '';
    note.value = '';
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const post = (path: string, json: any = {}) => () => api(`${base()}/${path}`, { method: 'POST', json });
const submit = () => run(post('submit'), 'أُرسل التعميد للاعتماد');
function openAmend() {
  amend.value = { lines: o.value.lines.map((l: any) => ({ ...l })), deliveryDate: o.value.deliveryDate ?? '', terms: o.value.terms ?? '' };
  note.value = '';
  modal.value = 'amend';
}
function confirm() {
  const m = modal.value;
  if (m === 'approve') return run(post('approve', { note: note.value || null }), o.value.requiredLevels.length - o.value.approvals.length <= 1 ? 'اعتُمد التعميد وصدر للمورد' : 'سُجل اعتمادك وانتقل للمستوى التالي');
  if (m === 'return') return run(post('return', { reason: note.value }), 'أعيد التعميد للتعديل');
  if (m === 'cancel') return run(post('cancel', { reason: note.value }), 'أُلغي التعميد وفُك الحجز');
  if (m === 'reply') return run(post('reply', { reason: note.value }), 'أُرسل الرد للمورد');
  if (m === 'short') return run(async () => { await post('short-close', { reason: note.value })(); return api(base()); }, 'أُغلق التعميد بالمستلم وفُك حجز الباقي');
  if (m === 'amend') {
    const a = amend.value;
    return run(post('amend', {
      reason: note.value, deliveryDate: a.deliveryDate || null, terms: a.terms || null,
      lines: a.lines.filter((l: any) => Number(l.qty) > 0).map((l: any) => ({ lineId: l.lineId, qty: Number(l.qty), unitPrice: Number(l.unitPrice) })),
    }), 'عُدل التعميد وأُبلغ المورد');
  }
}
const TITLES: Record<string, string> = { approve: 'اعتماد التعميد', return: 'إعادة التعميد للتعديل', cancel: 'إلغاء التعميد', reply: 'الرد على استفسار المورد', amend: 'تعديل التعميد الصادر', short: 'إغلاق التعميد بالمستلم' };
const needsNote = computed(() => modal.value !== 'approve');
const check = computed(() => o.value?.liveCheck ?? o.value?.budgetCheck);
const RESP: Record<string, string> = { acknowledge: 'أكد الاستلام', accept: 'قبل التعميد', clarify: 'طلب توضيحًا', decline: 'اعتذر عن التنفيذ', reply: 'رد الجمعية' };
const printPage = () => window.print();
const steps = computed(() => (o.value?.requiredLevels ?? []).map((l: any, i: number) => ({ ...l, done: o.value.approvals[i] ?? null, now: o.value.status === 'pending' && i === o.value.approvals.length })));
</script>

<template>
  <div v-if="o">
    <div class="page-head">
      <div>
        <h1>{{ o.title }}</h1>
        <p class="muted">
          <span class="pc-code">{{ o.code }}</span><span v-if="o.version > 1"> (إصدار {{ o.version }})</span> · {{ o.kindLabel }} ·
          <span class="pm-pill" :style="{ '--c': ORDER_COLOR[o.status] }">{{ o.statusLabel }}</span>
        </p>
      </div>
      <div class="pc-inline pc-noprint">
        <button v-if="o.can.edit" class="btn" @click="router.push(`/procurement/orders/${o.id}/edit`)">تعديل</button>
        <button v-if="o.can.submit" class="btn btn-primary" :disabled="busy" @click="submit">إرسال للاعتماد</button>
        <template v-if="o.can.approve">
          <button class="btn btn-primary" @click="modal = 'approve'">اعتماد</button>
          <button class="btn" @click="modal = 'return'">إعادة للتعديل</button>
        </template>
        <button v-if="o.can.reply" class="btn btn-primary" @click="modal = 'reply'">الرد على المورد</button>
        <button v-if="o.can.receive" class="btn btn-primary" @click="router.push(`/procurement/receipts/new?kind=order&order=${o.id}`)">استلام وفحص</button>
        <button v-if="session.can(PR.invoices) && INVOICEABLE.includes(o.status)" class="btn" @click="router.push(`/procurement/invoices/new?order=${o.id}`)">تسجيل فاتورة</button>
        <button v-if="o.can.shortClose" class="btn" @click="note = ''; modal = 'short'">إغلاق بالمستلم</button>
        <button v-if="o.can.amend" class="btn" @click="openAmend">تعديل بالتخفيض</button>
        <button v-if="['issued', 'acknowledged', 'accepted', 'closed'].includes(o.status)" class="btn" @click="printPage">طباعة</button>
        <button v-if="o.can.cancel" class="btn btn-ghost" @click="modal = 'cancel'">إلغاء التعميد</button>
      </div>
    </div>

    <div v-if="o.status === 'pending' && !o.can.approve && o.can.approveWhy" class="alert pc-noprint" style="background: #fffbeb">{{ o.can.approveWhy }}</div>
    <div v-if="o.status === 'declined'" class="alert alert-error pc-noprint">اعتذر المورد عن التنفيذ. ألغِ التعميد ليُفك الحجز ويعود الطلب للتوريد.</div>
    <div v-if="o.cancelReason && o.status === 'cancelled'" class="alert alert-error">سبب الإلغاء: {{ o.cancelReason }}</div>

    <div class="pc-grid" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)">
      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <dl class="pc-dl">
            <div><dt>المورد</dt><dd><RouterLink class="pm-link" :to="`/procurement/suppliers/${o.supplier.id}`">{{ o.supplier.name }}</RouterLink> <span class="pc-code">{{ o.supplier.code }}</span></dd></div>
            <div><dt>الرقم الضريبي</dt><dd class="pc-code">{{ o.supplier.vatNumber ?? '—' }}</dd></div>
            <div><dt>طلب الشراء</dt><dd><RouterLink class="pm-link" :to="`/procurement/requests/${o.request.id}`">{{ o.request.code }}</RouterLink> {{ o.request.methodLabel ?? '' }}</dd></div>
            <div v-if="o.contract"><dt>العقد</dt><dd><RouterLink class="pm-link" :to="`/procurement/contracts/${o.contract.id}`">{{ o.contract.code }}</RouterLink> {{ o.contract.title }}
              <small class="pm-muted" style="display: block">المستخدم {{ sar(o.contract.used) }} من {{ sar(o.contract.value) }}</small>
              <small v-for="(w, i) in o.contract.warnings" :key="i" class="pc-flag" style="display: block">⚠ {{ w }}</small></dd></div>
            <div v-if="o.rfq"><dt>المنافسة</dt><dd><RouterLink class="pm-link" :to="`/procurement/rfqs/${o.rfq.id}`">{{ o.rfq.code }}</RouterLink></dd></div>
            <div><dt>الإدارة</dt><dd>{{ o.unitName ?? '—' }}</dd></div>
            <div><dt>المشروع</dt><dd>{{ o.projectName ?? '—' }}</dd></div>
            <div><dt>تاريخ التسليم</dt><dd>{{ fmtDate(o.deliveryDate) }}</dd></div>
            <div><dt>مكان التسليم</dt><dd>{{ o.warehouse ? `${o.warehouse.code} · ${o.warehouse.name}` : '' }}{{ o.deliveryPlace ? ` ${o.deliveryPlace}` : '' }}{{ !o.warehouse && !o.deliveryPlace ? '—' : '' }}</dd></div>
            <div v-if="o.beneficiaryRef"><dt>مرجع المستفيد</dt><dd class="pc-code">{{ o.beneficiaryRef }}</dd></div>
            <div v-if="o.issuedAt"><dt>صدر في</dt><dd>{{ fmtDateTime(o.issuedAt) }}</dd></div>
          </dl>
        </section>
        <section class="card pm-panel">
          <h2>البنود</h2>
          <div class="table-wrap">
            <table class="pc-lines">
              <thead><tr><th>#</th><th>البند</th><th>الكمية</th><th v-if="o.receipts.length" class="pc-noprint">المستلم</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
              <tbody>
                <tr v-for="(l, i) in o.lines" :key="l.lineId ?? i">
                  <td>{{ i + 1 }}</td><td><b>{{ l.description }}</b></td><td class="pc-num">{{ l.qty }} {{ l.uomName ?? '' }}</td>
                  <td v-if="o.receipts.length" class="pc-num pc-noprint">{{ fmtQty(l.receivedQty) }}<small v-if="l.receivedQty >= l.qty" class="pc-okflag" style="display: flex">مكتمل</small></td>
                  <td class="pc-num">{{ sar(l.unitPrice) }}</td><td class="pc-num">{{ sar(l.total) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr><td :colspan="o.receipts.length ? 5 : 4">قبل الضريبة</td><td class="pc-num">{{ sar(o.subtotal) }}</td></tr>
                <tr><td :colspan="o.receipts.length ? 5 : 4">ضريبة القيمة المضافة {{ o.vatRate }}%</td><td class="pc-num">{{ sar(o.vat) }}</td></tr>
                <tr><td :colspan="o.receipts.length ? 5 : 4"><b>الإجمالي</b></td><td class="pc-num"><b>{{ sar(o.total) }}</b></td></tr>
              </tfoot>
            </table>
          </div>
        </section>
        <section v-if="o.terms" class="card pm-panel">
          <h2>الشروط</h2>
          <p style="white-space: pre-line; font-size: .9rem">{{ o.terms }}</p>
        </section>
        <section v-if="o.rfq?.recommendation" class="card pm-panel pc-noprint">
          <h2>مبررات الترسية</h2>
          <p style="white-space: pre-line; font-size: .9rem">{{ o.rfq.recommendation }}</p>
        </section>
      </div>

      <div style="display: grid; gap: 16px; align-content: start" class="pc-noprint">
        <section v-if="steps.length" class="card pm-panel">
          <h2>مسار الاعتماد</h2>
          <ol class="pc-steps">
            <li v-for="(s, i) in steps" :key="i" :data-n="i + 1" :class="{ done: s.done, now: s.now }">
              <span>{{ s.name }}<div v-if="s.done" class="pm-muted" style="font-size: .78rem">{{ s.done.byName }} · {{ fmtDateTime(s.done.at) }}<span v-if="s.done.note"> · {{ s.done.note }}</span></div></span>
              <small v-if="s.minAmount">من {{ sar(s.minAmount) }}</small>
            </li>
          </ol>
        </section>
        <section class="card pm-panel">
          <h2>مصدر الصرف</h2>
          <dl class="pc-dl" style="grid-template-columns: 1fr">
            <div><dt>مصدر التمويل</dt><dd>{{ o.funding?.label ?? '—' }}<small v-if="o.fundingReserved" class="pc-okflag" style="margin-inline-start: 6px">محجوز {{ sar(o.fundingReserved) }}</small></dd></div>
            <div><dt>بند الموازنة</dt><dd>{{ o.budgetLine ? `${o.budgetLine.name} · ${o.budgetLine.budgetCode}` : '—' }}<small v-if="o.commitmentId" class="pc-okflag" style="margin-inline-start: 6px">مرتبط</small></dd></div>
          </dl>
          <div v-if="check" :class="['pc-check-box', check.allowed ? 'ok' : 'bad']" style="margin-top: 10px">
            <b>{{ check.allowed ? '✓' : '✕' }} {{ check.message }}</b>
            <div v-for="w in check.warnings" :key="w" style="font-size: .8rem; margin-top: 4px">• {{ w }}</div>
          </div>
          <p v-if="!o.commitmentId && !o.fundingReserved" class="pm-muted" style="font-size: .78rem; margin-top: 6px">يُحجز المبلغ عند الاعتماد الأخير.</p>
        </section>
        <section v-if="o.receipts.length" class="card pm-panel">
          <h2>الاستلامات</h2>
          <ul class="pc-log">
            <li v-for="x in o.receipts" :key="x.id">
              <span><RouterLink class="pm-link" :to="`/procurement/receipts/${x.id}`">{{ x.code }}</RouterLink> · {{ fmtDate(x.date) }} · {{ sar(x.total) }}
                <span class="pm-pill" :style="{ '--c': RECEIPT_COLOR[x.status] }">{{ x.status === 'posted' ? 'معتمد' : 'ملغى' }}</span>
                <small v-if="x.rejected" class="pc-flag">مرفوضات</small></span>
            </li>
          </ul>
          <p v-if="o.closeKind === 'short'" class="pm-muted" style="font-size: .8rem; margin-top: 6px">أُغلق التعميد بالكميات المستلمة وفُك حجز الباقي.</p>
        </section>
        <section v-if="invoices.length" class="card pm-panel pc-noprint">
          <h2>الفواتير والإشعارات الدائنة</h2>
          <ul class="pc-log">
            <li v-for="x in invoices" :key="x.id">
              <span><RouterLink class="pm-link" :to="`/procurement/invoices/${x.id}`">{{ x.code }}</RouterLink> · {{ x.kindLabel }} {{ x.supplierInvoiceNo }} · {{ sar(x.total) }}
                <span class="pm-pill" :style="{ '--c': INVOICE_COLOR[x.status] }">{{ x.statusLabel }}</span></span>
            </li>
          </ul>
        </section>
        <section v-if="o.responses.length" class="card pm-panel">
          <h2>ردود المورد</h2>
          <ul class="pc-log">
            <li v-for="(x, i) in o.responses" :key="i"><span><b>{{ RESP[x.action] }}</b> · {{ x.byName }} <small class="pm-muted">{{ fmtDateTime(x.at) }}</small><div v-if="x.note" style="font-size: .85rem">{{ x.note }}</div></span></li>
          </ul>
        </section>
        <section class="card pm-panel">
          <h2>السجل</h2>
          <ul class="pc-log">
            <li v-for="(x, i) in [...o.log].reverse()" :key="i"><span><b>{{ x.action }}</b> · {{ x.byName }} <small class="pm-muted">{{ fmtDateTime(x.at) }}</small><div v-if="x.note" class="pm-muted" style="font-size: .8rem">{{ x.note }}</div></span></li>
          </ul>
        </section>
      </div>
    </div>

    <div v-if="modal" class="modal-backdrop" @click.self="modal = ''">
      <form class="card modal" :style="modal === 'amend' ? 'max-width: 720px' : ''" @submit.prevent="confirm">
        <h2>{{ TITLES[modal] }}</h2>
        <template v-if="modal === 'approve'">
          <p>{{ o.nextLevel?.name }} لتعميد بقيمة <b>{{ sar(o.total) }}</b> للمورد {{ o.supplier.name }}.</p>
          <p v-if="o.requiredLevels.length - o.approvals.length <= 1" class="pm-muted" style="font-size: .85rem">هذا الاعتماد الأخير: يُحجز المبلغ من مصدر الصرف ويصدر التعميد للمورد عبر البوابة والبريد.</p>
        </template>
        <p v-if="modal === 'short'" class="pm-muted" style="font-size: .85rem">يُغلق التعميد بما استُلم منه، ويُفك حجز الباقي على بند الموازنة ومصدر التمويل، ولا يُستلم عليه بعد ذلك.</p>
        <template v-if="modal === 'amend'">
          <p class="pm-muted" style="font-size: .85rem">يخفض التعديل الكميات أو الأسعار فقط، ويُعاد حجز القيمة الجديدة ويُبلَّغ المورد بالإصدار الجديد. ضع الكمية صفرًا لحذف البند.</p>
          <table class="pc-lines">
            <thead><tr><th>البند</th><th style="width: 110px">الكمية</th><th style="width: 120px">سعر الوحدة</th></tr></thead>
            <tbody>
              <tr v-for="l in amend.lines" :key="l.lineId"><td>{{ l.description }}</td><td><input v-model.number="l.qty" type="number" min="0" step="any" class="input" /></td><td><input v-model.number="l.unitPrice" type="number" min="0.01" step="any" class="input" /></td></tr>
            </tbody>
          </table>
          <label class="field"><span>تاريخ التسليم</span><input v-model="amend.deliveryDate" type="date" class="input" /></label>
        </template>
        <label class="field"><span>{{ modal === 'approve' ? 'ملاحظة (اختياري)' : modal === 'reply' ? 'الرد' : 'السبب' }}</span><textarea v-model="note" class="input" rows="3" :required="needsNote" /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">تأكيد</button><button type="button" class="btn" @click="modal = ''">رجوع</button></div>
      </form>
    </div>
  </div>
</template>
