<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import StatusBadge from '../components/StatusBadge.vue';
import { color, fmtDateTime, label, TICKET_STATUSES, TICKET_TYPES } from '../labels';
import type { TicketRow } from '../types';

const toast = useToast();
const items = ref<TicketRow[]>([]);
const counts = ref<Record<string, number>>({});
const filter = reactive({ type: '', status: 'open' });
const error = ref('');
const replying = ref<string | null>(null);
const reply = ref('');
const busy = ref(false);

async function load() {
  try {
    const q = new URLSearchParams();
    if (filter.type) q.set('type', filter.type);
    if (filter.status) q.set('status', filter.status);
    const res = await api<{ items: TicketRow[]; counts: Record<string, number> }>(`/beneficiaries/tickets?${q}`);
    items.value = res.items;
    counts.value = res.counts;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(filter, load);

async function send(t: TicketRow, close: boolean) {
  busy.value = true;
  try {
    await api(`/beneficiaries/tickets/${t.id}/reply`, { method: 'POST', json: { reply: reply.value, close } });
    toast.success('تم إرسال الرد، وسيظهر للمستفيد في البوابة');
    replying.value = null;
    reply.value = '';
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-head"><div><h1>الشكاوى والمقترحات والاستفسارات</h1><p class="muted sub">رسائل المستفيدين من البوابة</p></div></div>
    <div class="card toolbar">
      <div class="chips">
        <button :class="['chip', { on: !filter.status }]" @click="filter.status = ''">الكل</button>
        <button v-for="s in TICKET_STATUSES" :key="s.value" :class="['chip', { on: filter.status === s.value }]" @click="filter.status = s.value">{{ s.label }} <b>{{ counts[s.value] ?? 0 }}</b></button>
      </div>
      <select v-model="filter.type" class="input type"><option value="">كل الأنواع</option><option v-for="t in TICKET_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option></select>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <p v-if="!items.length" class="card empty">لا توجد رسائل هنا 🌾</p>
    <div class="list">
      <article v-for="(t, i) in items" :key="t.id" class="card ticket" :style="{ '--c': color('ticket', t.type), '--i': i }">
        <header>
          <StatusBadge :value="t.type" kind="ticket" />
          <b>{{ t.subject }}</b>
          <StatusBadge :value="t.status" kind="ticketStatus" class="st" />
        </header>
        <p class="meta muted">#{{ t.ticketNo }} · <RouterLink v-if="t.beneficiary" :to="`/beneficiaries/files/${t.beneficiary.id}`">{{ t.beneficiary.fullName }}</RouterLink> · {{ fmtDateTime(t.createdAt) }}</p>
        <p class="msg">{{ t.message }}</p>
        <div v-if="t.reply" class="reply"><b>رد {{ t.repliedByName }}:</b> {{ t.reply }}</div>
        <div v-if="replying === t.id" class="reply-box">
          <textarea v-model="reply" class="input" rows="3" placeholder="اكتب الرد..." autofocus />
          <div class="ra">
            <button class="btn btn-primary btn-sm" :disabled="busy || reply.trim().length < 2" @click="send(t, false)">إرسال الرد</button>
            <button class="btn btn-sm" :disabled="busy || reply.trim().length < 2" @click="send(t, true)">إرسال وإغلاق</button>
            <button class="btn btn-sm" @click="replying = null">إلغاء</button>
          </div>
        </div>
        <button v-else-if="t.status !== 'closed'" class="btn btn-sm" @click="replying = t.id; reply = t.reply ?? ''">{{ t.reply ? 'تعديل الرد' : 'رد' }}</button>
      </article>
    </div>
  </div>
</template>

<style scoped>
.sub { margin: 2px 0 0; font-size: .88rem; }
.toolbar { display: flex; justify-content: space-between; gap: 10px; padding: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { font: inherit; font-size: .84rem; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; }
.chip b { color: var(--muted); margin-inline-start: 4px; }
.chip.on { background: var(--primary-soft); border-color: var(--primary); color: var(--primary); font-weight: 600; }
.type { width: 180px; }
.empty { padding: 30px; text-align: center; color: var(--muted); }
.list { display: flex; flex-direction: column; gap: 12px; }
.ticket { padding: 16px 18px; border-inline-start: 4px solid var(--c); animation: rise .4s calc(var(--i) * 50ms) var(--ease) both; }
.ticket header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.st { margin-inline-start: auto; }
.meta { font-size: .82rem; margin: 6px 0; }
.msg { margin: 8px 0; white-space: pre-wrap; }
.reply { padding: 10px 12px; border-radius: 10px; background: var(--success-soft); color: #064e3b; margin-bottom: 10px; font-size: .92rem; }
.reply-box { display: flex; flex-direction: column; gap: 8px; }
.ra { display: flex; gap: 6px; flex-wrap: wrap; }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
</style>
