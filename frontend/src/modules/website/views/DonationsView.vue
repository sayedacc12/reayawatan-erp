<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { STATUS_COLOR, WP, copy, errMsg, fmtDateTime, num, sar } from '../lib';
import '../website.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const route = useRoute();
const session = useSession();
const toast = useToast();
const f = reactive({ status: '', kind: '', program: String(route.query.program ?? ''), from: '', to: '', q: '' });
const data = ref<any>({ rows: [], totals: {} });
const programs = ref<any[]>([]);
const sel = ref<any>(null);
const busy = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

async function load() {
  try {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
    data.value = await api(`/website/donations${qs ? `?${qs}` : ''}`);
  } catch (e) {
    toast.error(errMsg(e));
  }
}
onMounted(async () => {
  load();
  try {
    programs.value = (await api<any[]>('/website/programs')).filter((p) => p.status === 'approved');
  } catch {
    /* القائمة اختيارية */
  }
});
watch(f, () => {
  clearTimeout(timer);
  timer = setTimeout(load, 300);
});
async function open(r: any) {
  try {
    sel.value = await api(`/website/donations/${r.id}`);
  } catch (e) {
    toast.error(errMsg(e));
  }
}
async function retry() {
  busy.value = true;
  try {
    sel.value = await api(`/website/donations/${sel.value.id}/voucher`, { method: 'POST' });
    toast.success('أُنشئ سند القبض');
    load();
  } catch (e) {
    toast.error(errMsg(e));
  } finally {
    busy.value = false;
  }
}
async function cancel() {
  if (!confirm('إلغاء طلب التبرع غير المدفوع؟')) return;
  busy.value = true;
  try {
    sel.value = await api(`/website/donations/${sel.value.id}/cancel`, { method: 'POST' });
    toast.success('أُلغي الطلب');
    load();
  } catch (e) {
    toast.error(errMsg(e));
  } finally {
    busy.value = false;
  }
}
async function copyLink(path: string) {
  if (await copy(window.location.origin + path)) toast.success('نُسخ الرابط');
}
</script>

<template>
  <div>
    <div class="page-head"><div><h1>تبرعات المتجر</h1><p class="muted">كل تبرع مدفوع يصدر له إيصال برمز تحقق، وسند قبض مسودة في النظام المالي.</p></div></div>
    <div class="ws-kpis">
      <div class="ws-kpi" style="--c: #10b981"><span class="v">{{ sar(data.totals.amount) }}</span><span class="l">إجمالي المدفوع</span></div>
      <div class="ws-kpi" style="--c: #0ea5e9"><span class="v">{{ num(data.totals.count) }}</span><span class="l">تبرع مدفوع</span></div>
      <div class="ws-kpi" style="--c: #f59e0b"><span class="v">{{ num(data.totals.pending) }}</span><span class="l">بانتظار الدفع</span></div>
      <div class="ws-kpi" :style="{ '--c': data.totals.voucherErrors ? '#ef4444' : '#94a3b8' }"><span class="v">{{ num(data.totals.voucherErrors) }}</span><span class="l">بلا سند قبض</span></div>
    </div>
    <div class="ws-filters">
      <input v-model="f.q" class="input grow" placeholder="اسم المتبرع أو جواله أو رقم الإيصال" />
      <select v-model="f.status" class="input"><option value="">كل الحالات</option><option value="paid">مدفوع</option><option value="pending">بانتظار الدفع</option><option value="failed">فشل</option><option value="cancelled">ملغى</option></select>
      <select v-model="f.kind" class="input"><option value="">كل الأنواع</option><option value="project">لمشروع</option><option value="waqf">وقف</option><option value="general">عام</option></select>
      <select v-model="f.program" class="input"><option value="">كل البرامج</option><option value="general">التبرع العام</option><option v-for="p in programs" :key="p.id" :value="p.id">{{ p.name }}</option></select>
      <input v-model="f.from" type="date" class="input" title="من" /><input v-model="f.to" type="date" class="input" title="إلى" />
    </div>
    <div class="card">
      <div v-if="!data.rows.length" class="ws-empty"><strong>لا توجد تبرعات</strong>تظهر هنا التبرعات القادمة من متجر الموقع</div>
      <div v-else class="table-wrap"><table class="table">
        <thead><tr><th>الإيصال</th><th>المتبرع</th><th>الوجهة</th><th>المبلغ</th><th>الحالة</th><th>التاريخ</th><th>السند</th></tr></thead>
        <tbody>
          <tr v-for="r in data.rows" :key="r.id" class="ws-click" @click="open(r)">
            <td class="ws-code">{{ r.receiptNo || '—' }}</td>
            <td>{{ r.donorName || 'فاعل خير' }}<div class="muted ws-code" style="font-size: .78rem">{{ r.donorPhone }}</div></td>
            <td>{{ r.programName }} <span v-if="r.monthly" class="ws-pill" style="--c: #0ea5e9">شهري</span> <span v-if="r.gift" class="ws-pill" style="--c: #ec4899">إهداء</span></td>
            <td><strong>{{ sar(r.amount) }}</strong></td>
            <td><span class="ws-pill" :style="{ '--c': STATUS_COLOR[r.status] }">{{ r.statusLabel }}</span></td>
            <td class="muted">{{ fmtDateTime(r.paidAt || r.createdAt) }}</td>
            <td><span v-if="r.status === 'paid'" :class="r.voucherId ? 'ok' : 'bad'">{{ r.voucherId ? '✓' : '!' }}</span></td>
          </tr>
        </tbody>
      </table></div>
    </div>

    <div v-if="sel" class="modal-backdrop" @click.self="sel = null">
      <div class="modal card">
        <div class="ws-row" style="justify-content: space-between"><h2>تبرع {{ sel.receiptNo || '' }}</h2><span class="ws-pill" :style="{ '--c': STATUS_COLOR[sel.status] }">{{ sel.statusLabel }}</span></div>
        <dl class="dn-dl">
          <dt>المبلغ</dt><dd><strong>{{ sar(sel.amount) }}</strong></dd>
          <dt>الوجهة</dt><dd>{{ sel.programName }} ({{ sel.kindLabel }})</dd>
          <dt>المتبرع</dt><dd>{{ sel.donorName || 'فاعل خير' }} · <span class="ws-code">{{ sel.donorPhone }}</span><template v-if="sel.donorEmail"> · {{ sel.donorEmail }}</template></dd>
          <template v-if="sel.gift"><dt>إهداء إلى</dt><dd>{{ sel.gift.to }}<template v-if="sel.gift.message">: «{{ sel.gift.message }}»</template></dd></template>
          <dt>التاريخ</dt><dd>{{ fmtDateTime(sel.paidAt || sel.createdAt) }}</dd>
          <template v-if="sel.paymentRef"><dt>مرجع الدفع</dt><dd class="ws-code">{{ sel.paymentRef }}</dd></template>
          <template v-if="sel.verifyCode"><dt>رمز التحقق</dt><dd class="ws-code">{{ sel.verifyCode }}</dd></template>
          <template v-if="sel.status === 'paid'"><dt>سند القبض</dt><dd><template v-if="sel.voucher">رقم {{ sel.voucher.serial }} ({{ sel.voucher.status === 'draft' ? 'مسودة بانتظار الترحيل' : sel.voucher.status }})</template><span v-else class="bad">لم يصدر: {{ sel.voucherError || 'أكمل الربط المالي' }}</span></dd></template>
        </dl>
        <div class="modal-actions">
          <button v-if="sel.status === 'paid'" class="btn" @click="copyLink(sel.receiptUrl)">نسخ رابط الإيصال</button>
          <a v-if="sel.status === 'paid'" :href="sel.receiptUrl" target="_blank" rel="noopener" class="btn">فتح الإيصال ↗</a>
          <button v-if="sel.status === 'pending'" class="btn" @click="copyLink(sel.payUrl)">نسخ رابط الدفع</button>
          <button v-if="sel.status === 'paid' && !sel.voucherId" class="btn btn-primary" :disabled="busy" @click="retry">إنشاء سند القبض</button>
          <button v-if="sel.status === 'pending' && session.can(WP.settings)" class="btn btn-danger" :disabled="busy" @click="cancel">إلغاء الطلب</button>
          <button class="btn" @click="sel = null">إغلاق</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ok { color: #10b981; font-weight: 700; }
.bad { color: #ef4444; font-weight: 700; }
.dn-dl { display: grid; grid-template-columns: 110px 1fr; gap: 8px 12px; margin: 12px 0; }
.dn-dl dt { color: var(--muted); }
.dn-dl dd { margin: 0; }
</style>
