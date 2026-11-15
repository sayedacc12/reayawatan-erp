<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import StatusBadge from '../modules/beneficiaries/components/StatusBadge.vue';
import { color, fmtDateTime, TICKET_TYPES } from '../modules/beneficiaries/labels';
import type { TicketRow } from '../modules/beneficiaries/types';
import { useToast } from '../stores/toast';
import { portalApi, type PortalRequestRow } from './portal';

const toast = useToast();
const items = ref<TicketRow[]>([]);
const requests = ref<PortalRequestRow[]>([]);
const form = reactive({ type: 'inquiry', subject: '', message: '', requestId: null as string | null });
const error = ref('');
const busy = ref(false);

async function load() {
  [items.value, requests.value] = await Promise.all([portalApi<TicketRow[]>('/tickets'), portalApi<PortalRequestRow[]>('/requests')]);
}
onMounted(load);

async function send() {
  busy.value = true;
  error.value = '';
  try {
    await portalApi('/tickets', { method: 'POST', json: form });
    toast.success('تم إرسال رسالتك، وهيظهر رد الجمعية هنا');
    Object.assign(form, { subject: '', message: '', requestId: null });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="wrap">
    <form class="card compose" @submit.prevent="send">
      <h2>رسالة جديدة للجمعية</h2>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <div class="types">
        <label v-for="t in TICKET_TYPES" :key="t.value" :class="{ on: form.type === t.value }" :style="{ '--c': t.color }">
          <input v-model="form.type" type="radio" :value="t.value" />{{ t.label }}
        </label>
      </div>
      <div class="field"><label>العنوان</label><input v-model="form.subject" class="input" required minlength="3" /></div>
      <div class="field"><label>الرسالة</label><textarea v-model="form.message" class="input" rows="4" required minlength="5" /></div>
      <div v-if="requests.length" class="field"><label>بخصوص طلب (اختياري)</label>
        <select v-model="form.requestId" class="input"><option :value="null">—</option><option v-for="r in requests" :key="r.id" :value="r.id">طلب #{{ r.requestNo }} · {{ r.project }}</option></select>
      </div>
      <button class="btn btn-primary" :disabled="busy">إرسال</button>
    </form>

    <section>
      <h2 class="h">رسائلي</h2>
      <p v-if="!items.length" class="card empty">لا توجد رسائل بعد.</p>
      <article v-for="(t, i) in items" :key="t.id" class="card msg" :style="{ '--c': color('ticket', t.type), '--i': i }">
        <header><StatusBadge :value="t.type" kind="ticket" /><b>{{ t.subject }}</b><StatusBadge :value="t.status" kind="ticketStatus" class="st" /></header>
        <p class="muted small">#{{ t.ticketNo }} · {{ fmtDateTime(t.createdAt) }}</p>
        <p class="body">{{ t.message }}</p>
        <div v-if="t.reply" class="reply"><b>رد الجمعية:</b> {{ t.reply }}<small class="muted"> · {{ fmtDateTime(t.repliedAt) }}</small></div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.wrap { display: grid; grid-template-columns: 380px 1fr; gap: 18px; align-items: start; }
.compose { padding: 20px; position: sticky; top: 80px; }
.compose h2, .h { font-size: 1.08rem; margin-bottom: 12px; }
.types { display: flex; gap: 6px; margin-bottom: 12px; }
.types label { --c: var(--primary); flex: 1; text-align: center; padding: 8px; border-radius: 10px; border: 1px solid var(--border); cursor: pointer; font-weight: 600; transition: all .2s; }
.types label.on { background: color-mix(in srgb, var(--c) 14%, transparent); border-color: var(--c); color: color-mix(in srgb, var(--c) 80%, #000); }
.types input { display: none; }
textarea.input { resize: vertical; }
.empty { padding: 26px; text-align: center; color: var(--muted); }
.msg { padding: 16px; margin-bottom: 12px; border-inline-start: 4px solid var(--c); animation: rise .4s calc(var(--i) * 50ms) var(--ease) both; }
.msg header { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.st { margin-inline-start: auto; }
.small { font-size: .8rem; margin: 4px 0; }
.body { white-space: pre-wrap; margin: 6px 0; }
.reply { padding: 10px 12px; border-radius: 10px; background: var(--success-soft); color: #064e3b; }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
@media (max-width: 820px) { .wrap { grid-template-columns: 1fr; } .compose { position: static; } }
</style>
