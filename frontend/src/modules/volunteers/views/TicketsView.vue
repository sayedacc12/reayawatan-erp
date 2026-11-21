<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import StatusPill from '../components/StatusPill.vue';
import { P, TICKET_KINDS, copy, fmtDateTime, publicUrl } from '../lib';
import '../../../shared/module.css';
import '../volunteers.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const toast = useToast();
const rows = ref<any[]>([]);
const q = reactive({ status: '', kind: '' });
async function load() {
  const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
  rows.value = await api<any[]>(`/volunteers/tickets?${params}`);
}
onMounted(() => load().catch((e) => toast.error((e as Error).message)));
watch(() => ({ ...q }), load);
const open = ref<any>(null);
const reply = reactive({ reply: '', status: 'closed' as 'in_progress' | 'closed' });
function view(t: any) {
  open.value = t;
  reply.reply = t.reply ?? '';
  reply.status = 'closed';
}
async function send() {
  try {
    await api(`/volunteers/tickets/${open.value.id}/reply`, { method: 'POST', json: reply });
    toast.success('حُفظ الرد');
    open.value = null;
    load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const nw = reactive({ show: false, kind: 'complaint', senderName: '', senderMobile: '', senderType: 'volunteer', subject: '', body: '' });
async function create() {
  try {
    await api('/volunteers/tickets', { method: 'POST', json: { ...nw, senderMobile: nw.senderMobile || null } });
    nw.show = false;
    toast.success('سُجل الطلب');
    load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const kindOf = (k: string) => TICKET_KINDS.find((x) => x.value === k)!;
async function copyLink() {
  if (await copy(publicUrl(`/v/${session.user?.organizationSlug}?tab=contact`))) toast.success('نُسخ رابط نموذج الشكاوى والمقترحات العام');
}
</script>

<template>
  <div>
    <section class="pm-hero vt-hero">
      <div><p class="pm-kicker">التطوع</p><h1>الشكاوى والمقترحات والاستفسارات</h1>
        <p class="pm-sub">تصل من نموذج التطوع العام (للمتطوعين والمستفيدين وغيرهم) أو يسجلها الموظف. يتابع المرسل طلبه برقمه ورمز المتابعة.</p></div>
      <div class="pm-actions">
        <button v-if="session.can(P.tickets)" class="btn vt-glow" @click="nw.show = true">تسجيل طلب</button>
        <button class="btn vt-ghost" @click="copyLink">نسخ رابط النموذج العام</button>
      </div>
    </section>
    <div class="vt-toolbar">
      <div class="vt-tabs" style="margin: 0">
        <button :class="['vt-tab', { on: !q.kind }]" @click="q.kind = ''">الكل</button>
        <button v-for="k in TICKET_KINDS" :key="k.value" :class="['vt-tab', { on: q.kind === k.value }]" @click="q.kind = k.value">{{ k.label }}</button>
      </div>
      <span class="grow" />
      <select v-model="q.status" class="input"><option value="">كل الحالات</option><option value="open">جديدة</option><option value="in_progress">قيد المعالجة</option><option value="closed">مغلقة</option></select>
    </div>
    <section class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الرقم</th><th>النوع</th><th>الموضوع</th><th>المرسل</th><th>التاريخ</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="t in rows" :key="t.id" class="vt-row" @click="view(t)">
              <td class="vt-code">{{ t.ticketNo }}</td>
              <td><span class="pm-pill" :style="{ '--c': kindOf(t.kind).color }">{{ t.kindLabel }}</span></td>
              <td class="vt-wrap"><b>{{ t.subject }}</b><span v-if="t.eventTitle" class="pm-muted" style="display: block">فعالية: {{ t.eventTitle }}</span></td>
              <td>{{ t.senderName }}<span class="pm-muted" style="display: block">{{ { volunteer: 'متطوع', beneficiary: 'مستفيد', other: 'آخر' }[t.senderType as string] }} · {{ t.source === 'public' ? 'النموذج العام' : 'سجّله موظف' }}</span></td>
              <td>{{ fmtDateTime(t.createdAt) }}</td>
              <td><StatusPill :status="t.status" :label="t.statusLabel" /></td>
            </tr>
            <tr v-if="!rows.length"><td colspan="6" class="pm-empty">لا توجد طلبات</td></tr>
          </tbody>
        </table>
      </div>
    </section>
    <div v-if="open" class="modal-backdrop" @click.self="open = null">
      <form class="card modal" @submit.prevent="send">
        <h2>{{ open.kindLabel }} {{ open.ticketNo }}</h2>
        <p class="pm-muted">{{ open.senderName }} · <span class="vt-code">{{ open.senderMobile ?? open.senderEmail ?? '' }}</span> · {{ fmtDateTime(open.createdAt) }}</p>
        <h3 style="margin: 6px 0">{{ open.subject }}</h3>
        <p class="vt-pre" style="background: var(--surface-2); padding: 10px 12px; border-radius: 10px">{{ open.body }}</p>
        <p v-if="open.repliedAt" class="pm-muted">آخر رد من {{ open.repliedByName }} · {{ fmtDateTime(open.repliedAt) }}</p>
        <template v-if="session.can(P.tickets)">
          <label class="field"><span>الرد</span><textarea v-model="reply.reply" class="input" rows="3" required /></label>
          <label class="field"><span>الحالة بعد الرد</span><select v-model="reply.status" class="input"><option value="in_progress">قيد المعالجة</option><option value="closed">مغلقة</option></select></label>
          <div class="modal-actions"><button class="btn btn-primary">حفظ الرد</button><button type="button" class="btn" @click="open = null">إغلاق</button></div>
        </template>
        <p v-else-if="open.reply" class="vt-pre">{{ open.reply }}</p>
      </form>
    </div>
    <div v-if="nw.show" class="modal-backdrop" @click.self="nw.show = false">
      <form class="card modal" @submit.prevent="create">
        <h2>تسجيل شكوى أو مقترح أو استفسار</h2>
        <div class="pm-grid2">
          <label class="field"><span>النوع</span><select v-model="nw.kind" class="input"><option v-for="k in TICKET_KINDS" :key="k.value" :value="k.value">{{ k.label }}</option></select></label>
          <label class="field"><span>صفة المرسل</span><select v-model="nw.senderType" class="input"><option value="volunteer">متطوع</option><option value="beneficiary">مستفيد</option><option value="other">آخر</option></select></label>
          <label class="field"><span>الاسم</span><input v-model="nw.senderName" class="input" required /></label>
          <label class="field"><span>الجوال</span><input v-model="nw.senderMobile" class="input" dir="ltr" /></label>
        </div>
        <label class="field"><span>الموضوع</span><input v-model="nw.subject" class="input" required /></label>
        <label class="field"><span>التفاصيل</span><textarea v-model="nw.body" class="input" rows="3" required /></label>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="nw.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
