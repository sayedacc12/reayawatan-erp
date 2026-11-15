<script setup lang="ts">
import { ref } from 'vue';
import { api, openProtectedFile } from '../api';
import { useToast } from '../stores/toast';
import { fmtDT, type TicketDetail } from './support';

/** محادثة الطلب ونموذج الرد، مشترك بين الجمعية ومدير المنصة */
const props = defineProps<{ ticket: TicketDetail; base: string; platform?: boolean }>();
const emit = defineEmits<{ (e: 'updated', t: TicketDetail): void }>();
const toast = useToast();
const body = ref('');
const internal = ref(false);
const status = ref('');
const file = ref<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const error = ref('');

const mine = (side: string) => (props.platform ? side === 'platform' : side === 'org');

async function send() {
  busy.value = true;
  error.value = '';
  try {
    const fd = new FormData();
    fd.append('body', body.value);
    if (props.platform) {
      fd.append('internal', internal.value ? 'true' : 'false');
      if (status.value && !internal.value) fd.append('status', status.value);
    }
    if (file.value) fd.append('file', file.value);
    const t = await api<TicketDetail>(`${props.base}/tickets/${props.ticket.id}/messages`, { method: 'POST', body: fd });
    body.value = '';
    status.value = '';
    internal.value = false;
    file.value = null;
    if (fileInput.value) fileInput.value.value = '';
    toast.success('تم إرسال الرد');
    emit('updated', t);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const open = (m: { id: string }) =>
  openProtectedFile(`${props.base}/tickets/${props.ticket.id}/messages/${m.id}/file`).catch((e) => toast.error((e as Error).message));
const pick = (e: Event) => { file.value = (e.target as HTMLInputElement).files?.[0] ?? null; };
</script>

<template>
  <section class="card p-panel">
    <h2>💬 المحادثة</h2>
    <div class="thread">
      <article v-for="m in ticket.messages" :key="m.id" :class="['msg', mine(m.side) ? 'me' : 'them', { internal: m.isInternal }]">
        <header>
          <b>{{ m.authorName }}</b>
          <small>{{ m.side === 'platform' ? 'فريق الدعم' : 'الجمعية' }} · {{ fmtDT(m.createdAt) }}</small>
          <span v-if="m.isInternal" class="tone tone-warn">ملاحظة داخلية</span>
        </header>
        <p>{{ m.body }}</p>
        <button v-if="m.file" class="att" type="button" @click="open(m)">📎 {{ m.file.name }}</button>
      </article>
    </div>

    <form v-if="ticket.status !== 'closed'" class="composer" @submit.prevent="send">
      <textarea v-model="body" class="input" rows="3" required minlength="2"
        :placeholder="platform ? (internal ? 'ملاحظة لفريق المنصة فقط، لا تراها الجمعية' : 'اكتب ردك للجمعية') : 'اكتب ردك أو معلومات إضافية لفريق الدعم'" />
      <div class="row">
        <label class="btn btn-sm file-btn">📎 {{ file ? file.name : 'إرفاق ملف' }}<input ref="fileInput" type="file" hidden @change="pick" /></label>
        <template v-if="platform">
          <label class="check"><input v-model="internal" type="checkbox" /> ملاحظة داخلية</label>
          <select v-if="!internal" v-model="status" class="input sel">
            <option value="">الحالة بعد الرد: قيد المعالجة</option>
            <option value="waiting_customer">بانتظار رد الجمعية (تتوقف المهلة)</option>
            <option value="resolved">تم الحل</option>
          </select>
        </template>
        <button class="btn btn-primary" :disabled="busy">{{ busy ? 'جارٍ الإرسال...' : 'إرسال' }}</button>
      </div>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
    </form>
    <p v-else class="muted">الطلب مغلق، ولا يمكن إضافة ردود.</p>
  </section>
</template>

<style scoped>
.thread { display: flex; flex-direction: column; gap: 10px; max-height: 520px; overflow-y: auto; padding: 4px; margin-bottom: 14px; }
.msg { max-width: 82%; border-radius: 14px; padding: 10px 14px; border: 1px solid var(--border); background: var(--surface-2); animation: p-rise .35s var(--ease) both; }
.msg.me { align-self: flex-start; background: var(--primary-soft); border-color: transparent; }
.msg.them { align-self: flex-end; }
.msg.internal { background: #fff8e6; border: 1px dashed #e8b04b; }
.msg header { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 4px; }
.msg header small { color: var(--muted); }
.msg p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.att { margin-top: 6px; border: 0; background: none; color: var(--primary); cursor: pointer; font: inherit; padding: 0; }
.composer textarea { width: 100%; resize: vertical; }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
.row .btn-primary { margin-inline-start: auto; }
.sel { width: auto; min-width: 220px; }
.file-btn { cursor: pointer; }
</style>
