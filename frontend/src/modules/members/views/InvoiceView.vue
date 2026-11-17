<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, openProtectedFile } from '../../../api';
import { useToast } from '../../../stores/toast';
import StatusPill from '../components/StatusPill.vue';
import { VOUCHER_STATUS, copy, fmtDate, fmtDateTime, publicUrl, sar, todayStr, whatsappLink } from '../lib';
import '../../projects/projects.css';
import '../members.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id: string }>();
const toast = useToast();
const inv = ref<any>(null);
const error = ref('');
const busy = ref(false);
const dialog = ref<null | 'pay' | 'reject' | 'cancel'>(null);
const f = ref({ method: 'cash', paidOn: todayStr(), reference: '', note: '' });

async function load() {
  try {
    inv.value = await api(`/members/invoices/${props.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
async function run(path: string, json: unknown, ok: string) {
  busy.value = true;
  try {
    inv.value = await api(`/members/invoices/${props.id}/${path}`, { method: 'POST', json });
    dialog.value = null;
    toast.success(ok);
    if (inv.value.voucherError && path === 'pay') toast.error(`سُجل السداد، لكن لم يُنشأ سند القبض: ${inv.value.voucherError}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
function openPay(method: 'cash' | 'transfer') {
  f.value = { method, paidOn: todayStr(), reference: inv.value.transferReceipt?.reference ?? '', note: '' };
  dialog.value = 'pay';
}
const pay = () => run('pay', { method: f.value.method, paidOn: f.value.paidOn, reference: f.value.reference.trim() || null }, 'سُجل السداد وفُعّلت العضوية');
const reject = () => run('reject-transfer', { note: f.value.note.trim() || null }, 'رُفض الإيصال وأُبلغ العضو في رابط السداد');
const cancel = () => run('cancel', { note: f.value.note.trim() || null }, 'أُلغيت المطالبة');
const retry = () => run('voucher', {}, 'تمت المحاولة');
const check = () => run('check', {}, 'حُدثت حالة الدفع من البوابة');
const openReceipt = () => openProtectedFile(`/members/invoices/${props.id}/receipt`).catch((e) => toast.error((e as Error).message));
const payLink = () => publicUrl(`/m/pay/${inv.value.payToken}`);
async function copyLink() {
  if (await copy(payLink())) toast.success('نُسخ رابط السداد');
}
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="inv">
      <section class="pm-hero mb-hero">
        <div>
          <p class="pm-kicker">مطالبة <span class="mb-code">{{ inv.invoiceNo }}</span> · {{ inv.kindLabel }}</p>
          <h1>{{ sar(inv.amount) }}</h1>
          <p class="pm-sub">{{ inv.partyName }} · {{ inv.typeName }} · أُصدرت {{ fmtDateTime(inv.createdAt) }}{{ inv.createdByName ? ` بواسطة ${inv.createdByName}` : '' }}</p>
        </div>
        <div class="pm-actions">
          <StatusPill :status="inv.status" :label="inv.statusLabel" />
          <button v-if="inv.can.confirmTransfer" class="btn mb-glow" @click="openPay('transfer')">تأكيد التحويل</button>
          <button v-else-if="inv.can.pay" class="btn mb-glow" @click="openPay('cash')">تسجيل سداد في المقر</button>
          <button v-if="inv.can.check" class="btn mb-ghost" :disabled="busy" @click="check">التحقق من بوابة الدفع</button>
        </div>
      </section>

      <div class="mb-grid">
        <section class="card pm-panel">
          <h2>تفاصيل المطالبة</h2>
          <table class="table"><tbody>
            <tr v-for="(x, i) in inv.items" :key="i"><td>{{ x.label }}</td><td style="text-align: end"><b>{{ sar(x.amount) }}</b></td></tr>
            <tr><td><b>الإجمالي</b></td><td style="text-align: end"><b>{{ sar(inv.amount) }}</b></td></tr>
          </tbody></table>
          <dl class="pm-dl">
            <dt>رقم الهوية</dt><dd class="mb-code">{{ inv.nationalId }}</dd>
            <dt>الجوال</dt><dd class="mb-code">{{ inv.mobile }}</dd>
            <dt>تاريخ الاستحقاق</dt><dd>{{ fmtDate(inv.dueDate) }}</dd>
            <dt>العضو</dt><dd><RouterLink v-if="inv.member" :to="`/members/list/${inv.member.id}`" class="pm-link">العضوية رقم {{ inv.member.memberNo }}</RouterLink><span v-else>لم يُفعّل بعد</span></dd>
            <dt>طلب العضوية</dt><dd><RouterLink v-if="inv.application" :to="`/members/applications/${inv.application.id}`" class="pm-link">{{ inv.application.applicationNo }}</RouterLink><span v-else>—</span></dd>
          </dl>
          <div v-if="inv.note" class="alert alert-error">{{ inv.note }}</div>
          <div v-if="inv.status === 'unpaid'" class="link-box">
            <div class="mb-sec">رابط السداد للعضو</div>
            <p class="mb-code" style="word-break: break-all; font-size: .8rem">{{ payLink() }}</p>
            <div style="display: flex; gap: 6px; flex-wrap: wrap">
              <button class="btn btn-sm" @click="copyLink">نسخ الرابط</button>
              <a class="btn btn-sm" :href="whatsappLink(inv.mobile, `السلام عليكم ${inv.partyName}، رابط سداد ${inv.kindLabel} (${sar(inv.amount)}): ${payLink()}`)" target="_blank" rel="noopener">إرسال بواتساب</a>
            </div>
          </div>
        </section>

        <section class="card pm-panel">
          <h2>السداد</h2>
          <template v-if="inv.status === 'paid'">
            <dl class="pm-dl">
              <dt>تاريخ السداد</dt><dd>{{ fmtDate(inv.paidOn) }}</dd>
              <dt>الطريقة</dt><dd>{{ inv.methodLabel }}</dd>
              <dt>المرجع</dt><dd class="mb-code">{{ inv.paymentRef ?? inv.gatewayId ?? '—' }}</dd>
              <dt>سجله</dt><dd>{{ inv.receivedByName ?? '—' }}</dd>
              <dt>فترة العضوية</dt><dd>{{ fmtDate(inv.periodStart) }} - {{ fmtDate(inv.periodEnd) }}</dd>
            </dl>
          </template>
          <p v-else class="pm-muted">لم تُسدد بعد.</p>
          <div v-if="inv.transferReceipt" class="link-box">
            <div class="mb-sec">إيصال التحويل البنكي</div>
            <p>{{ inv.transferReceipt.fileName }} · {{ fmtDateTime(inv.transferReceipt.uploadedAt) }}<template v-if="inv.transferReceipt.reference"> · مرجع <span class="mb-code">{{ inv.transferReceipt.reference }}</span></template></p>
            <div style="display: flex; gap: 6px; flex-wrap: wrap">
              <button class="btn btn-sm" @click="openReceipt">عرض الإيصال</button>
              <button v-if="inv.can.confirmTransfer" class="btn btn-sm btn-primary" @click="openPay('transfer')">تأكيد بعد المطابقة</button>
              <button v-if="inv.can.confirmTransfer" class="btn btn-sm btn-danger" @click="f.note = ''; dialog = 'reject'">رفض الإيصال</button>
            </div>
          </div>

          <div class="mb-sec">سند القبض في النظام المالي</div>
          <p v-if="inv.voucher"><RouterLink :to="`/accounting/vouchers/${inv.voucher.id}`" class="pm-link">سند قبض رقم {{ inv.voucher.serial }}</RouterLink> · {{ VOUCHER_STATUS[inv.voucher.status] ?? inv.voucher.status }}</p>
          <template v-else-if="inv.status === 'paid'">
            <div v-if="inv.voucherError" class="alert alert-error">{{ inv.voucherError }}</div>
            <button v-if="inv.can.voucher" class="btn btn-sm" :disabled="busy" @click="retry">إعادة إنشاء سند القبض</button>
          </template>
          <p v-else class="pm-muted">يُنشأ تلقائيًا عند السداد.</p>

          <button v-if="inv.can.cancel" class="btn btn-sm btn-danger" style="margin-top: 14px" @click="f.note = ''; dialog = 'cancel'">إلغاء المطالبة</button>
        </section>
      </div>
    </template>

    <div v-if="dialog && inv" class="modal-backdrop" @click.self="dialog = null">
      <div class="card modal">
        <template v-if="dialog === 'pay'">
          <h2>{{ f.method === 'transfer' ? 'تأكيد التحويل البنكي' : 'تسجيل سداد' }}</h2>
          <p class="pm-muted">بعد الحفظ تُفعّل العضوية أو تُجدد، ويُنشأ سند قبض مسودة في النظام المالي.</p>
          <label class="field"><span>طريقة السداد</span><select v-model="f.method" class="input"><option value="cash">نقدًا أو بالشبكة في المقر</option><option value="transfer">تحويل بنكي</option></select></label>
          <label class="field"><span>تاريخ السداد</span><input v-model="f.paidOn" type="date" class="input" :max="todayStr()" /></label>
          <label class="field"><span>المرجع (رقم الحوالة أو الإيصال)</span><input v-model="f.reference" class="input" dir="ltr" /></label>
          <div class="modal-actions"><button class="btn" @click="dialog = null">إلغاء</button><button class="btn btn-primary" :disabled="busy" @click="pay">تسجيل {{ sar(inv.amount) }}</button></div>
        </template>
        <template v-else>
          <h2>{{ dialog === 'reject' ? 'رفض إيصال التحويل' : 'إلغاء المطالبة' }}</h2>
          <p v-if="dialog === 'reject'" class="pm-muted">يظهر السبب للعضو في رابط السداد، ويمكنه رفع إيصال جديد أو الدفع بطريقة أخرى.</p>
          <p v-else-if="inv.kind === 'new'" class="pm-muted">إلغاء مطالبة الاشتراك الجديد يلغي طلب العضوية أيضًا.</p>
          <label class="field"><span>السبب *</span><textarea v-model="f.note" class="input" rows="3" /></label>
          <div class="modal-actions"><button class="btn" @click="dialog = null">رجوع</button>
            <button class="btn btn-danger" :disabled="busy || !f.note.trim()" @click="dialog === 'reject' ? reject() : cancel()">تأكيد</button></div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.link-box { margin-top: 10px; background: var(--surface-2); border-radius: 12px; padding: 4px 12px 12px; }
</style>
