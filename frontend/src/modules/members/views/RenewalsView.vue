<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import StatusPill from '../components/StatusPill.vue';
import { CHANNELS, P, copy, fmtDate, fmtDateTime, sar, whatsappLink } from '../lib';
import '../../projects/projects.css';
import '../members.css';

interface Row {
  id: string; memberNo: number; fullName: string; mobile: string; email: string | null; typeName: string; endDate: string; daysLeft: number; status: string; fee: number;
  invoice: { id: string; invoiceNo: string; amount: number; status: string; statusLabel: string; payToken: string } | null;
  lastNotice: { at: string; channel: string; daysLeft: number } | null; reminderDue: boolean; message: string;
}
interface Data { reminderDays: number[]; graceDays: number; autoInvoiceDays: number; rows: Row[] }
const session = useSession();
const toast = useToast();
const data = ref<Data | null>(null);
const error = ref('');
const filter = ref<'due' | 'all' | 'expired'>('due');
const busy = ref('');

async function load() {
  try {
    data.value = await api<Data>('/members/renewals');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
const rows = computed(() => (data.value?.rows ?? []).filter((r) => (filter.value === 'due' ? r.reminderDue : filter.value === 'expired' ? r.daysLeft < 0 : true)));
const dueCount = computed(() => data.value?.rows.filter((r) => r.reminderDue).length ?? 0);

async function log(r: Row, channel: string) {
  try {
    await api(`/members/members/${r.id}/notices`, { method: 'POST', json: { channel, message: r.message } });
    toast.success(`سُجل تنبيه ${r.fullName}`);
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function whatsapp(r: Row) {
  window.open(whatsappLink(r.mobile, r.message), '_blank', 'noopener');
  void log(r, 'whatsapp');
}
async function copyMsg(r: Row) {
  if (await copy(r.message)) toast.success('نُسخ نص التنبيه');
}
async function renew(r: Row) {
  busy.value = r.id;
  try {
    const x = await api<{ created: boolean; extended: boolean }>(`/members/members/${r.id}/renewal`, { method: 'POST' });
    toast.success(x.extended ? 'جُددت العضوية' : 'أُصدرت مطالبة التجديد');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <div>
    <section class="pm-hero mb-hero">
      <div><p class="pm-kicker">التجديد</p><h1>التجديد والتنبيهات</h1>
        <p class="pm-sub" v-if="data">ينبَّه العضو قبل انتهاء عضويته بـ {{ data.reminderDays.join(' و') }} يوم، وتصدر مطالبة التجديد تلقائيًا قبل الانتهاء بـ {{ data.autoInvoiceDays }} يوم، وتبقى العضوية في مهلة سماح {{ data.graceDays }} يوم بعد الانتهاء. أرسل التنبيه بواتساب برسالة جاهزة فيها رابط السداد.</p></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="mb-tabs">
      <button :class="['mb-tab', { on: filter === 'due' }]" @click="filter = 'due'">تنبيه مستحق ({{ dueCount }})</button>
      <button :class="['mb-tab', { on: filter === 'all' }]" @click="filter = 'all'">كل القريبة من الانتهاء ({{ data?.rows.length ?? 0 }})</button>
      <button :class="['mb-tab', { on: filter === 'expired' }]" @click="filter = 'expired'">انتهت حديثًا</button>
    </div>
    <section class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>العضو</th><th>الانتهاء</th><th>مطالبة التجديد</th><th>آخر تنبيه</th><th>إجراء</th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id">
              <td><RouterLink :to="`/members/list/${r.id}`" class="pm-link"><b>{{ r.fullName }}</b></RouterLink>
                <span class="pm-muted" style="display: block"><span class="mb-code">{{ r.memberNo }}</span> · {{ r.typeName }} · <span class="mb-code">{{ r.mobile }}</span></span></td>
              <td>{{ fmtDate(r.endDate) }}<span :class="['days', { late: r.daysLeft < 0 }]">{{ r.daysLeft < 0 ? `انتهت منذ ${-r.daysLeft} يوم` : `بعد ${r.daysLeft} يوم` }}</span></td>
              <td>
                <template v-if="r.invoice"><RouterLink :to="`/members/invoices/${r.invoice.id}`" class="pm-link mb-code">{{ r.invoice.invoiceNo }}</RouterLink> · {{ sar(r.invoice.amount) }}
                  <div><StatusPill :status="r.invoice.status" :label="r.invoice.statusLabel" /></div></template>
                <template v-else><span class="pm-muted">لم تصدر</span>
                  <button v-if="session.can(P.payments)" class="btn btn-sm" style="display: block; margin-top: 4px" :disabled="busy === r.id" @click="renew(r)">إصدار ({{ sar(r.fee) }})</button></template>
              </td>
              <td><template v-if="r.lastNotice">{{ CHANNELS[r.lastNotice.channel] ?? r.lastNotice.channel }}<span class="pm-muted" style="display: block">{{ fmtDateTime(r.lastNotice.at) }}</span></template>
                <span v-else class="pm-muted">لم يُنبَّه</span>
                <span v-if="r.reminderDue" class="pm-tag" style="background: #fef3c7; color: #92400e; display: inline-block; margin-top: 2px">مستحق الآن</span></td>
              <td><div class="acts">
                <button class="btn btn-sm btn-primary" :disabled="!r.mobile" @click="whatsapp(r)">واتساب</button>
                <button class="btn btn-sm" @click="copyMsg(r)">نسخ النص</button>
                <button class="btn btn-sm" @click="log(r, 'call')">تسجيل اتصال</button>
              </div></td>
            </tr>
            <tr v-if="!rows.length"><td colspan="5" class="pm-empty">{{ filter === 'due' ? 'لا توجد تنبيهات مستحقة الآن' : 'لا توجد عضويات في هذه القائمة' }}</td></tr>
          </tbody>
        </table>
      </div>
      <p class="pm-muted" style="font-size: .8rem">زر «واتساب» يفتح المحادثة برسالة جاهزة ويسجل التنبيه في ملف العضو. عدّل نص الرسالة من الإعدادات.</p>
    </section>
  </div>
</template>

<style scoped>
.days { display: block; width: fit-content; margin-top: 2px; font-size: .76rem; font-weight: 700; color: #b45309; background: #fef3c7; border-radius: 999px; padding: 1px 9px; }
.days.late { color: #b91c1c; background: #fee2e2; }
.acts { display: flex; gap: 4px; flex-wrap: wrap; }
</style>
