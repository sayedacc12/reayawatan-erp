<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { STATUS_COLOR, errMsg, fmtDateTime } from '../lib';
import '../website.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const toast = useToast();
const rows = ref<any[]>([]);
const tab = ref('open');
const sel = ref<any>(null);
const reply = ref('');
const TOPIC_COLOR: Record<string, string> = { inquiry: '#0ea5e9', suggestion: '#8b5cf6', complaint: '#ef4444', partnership: '#10b981', other: '#64748b' };
async function load() {
  try {
    rows.value = await api('/website/messages');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
onMounted(load);
const shown = computed(() => rows.value.filter((r) => (tab.value === 'open' ? r.status !== 'closed' : tab.value === 'all' ? true : r.status === tab.value)));
const count = (t: string) => rows.value.filter((r) => (t === 'open' ? r.status !== 'closed' : t === 'all' ? true : r.status === t)).length;
function open(r: any) {
  sel.value = r;
  reply.value = r.replyNote ?? '';
}
async function update(status: string) {
  try {
    await api(`/website/messages/${sel.value.id}`, { method: 'PUT', json: { status, replyNote: reply.value || null } });
    toast.success(status === 'closed' ? 'أُغلقت الرسالة' : 'حُدثت الرسالة');
    sel.value = null;
    load();
  } catch (e) {
    toast.error(errMsg(e));
  }
}
</script>

<template>
  <div>
    <div class="page-head"><div><h1>رسائل الزوار</h1><p class="muted">ما يرسله الزوار من صفحة «تواصل معنا»: استفسارات واقتراحات وشكاوى وطلبات شراكة.</p></div></div>
    <div class="ws-tabs">
      <button v-for="[k, l] in [['open', 'المفتوحة'], ['new', 'جديدة'], ['in_progress', 'قيد المتابعة'], ['closed', 'مغلقة'], ['all', 'الكل']]" :key="k" :class="['ws-tab', { on: tab === k }]" @click="tab = k">{{ l }}<span :class="['count', { warn: k === 'new' && count(k) }]">{{ count(k) }}</span></button>
    </div>
    <div v-if="!shown.length" class="card ws-empty"><strong>لا توجد رسائل هنا</strong></div>
    <div class="ms-list">
      <article v-for="r in shown" :key="r.id" class="card ms-item ws-click" @click="open(r)">
        <div class="ws-row" style="justify-content: space-between; margin: 0">
          <div class="ws-row" style="margin: 0"><strong>{{ r.name }}</strong><span class="ws-pill" :style="{ '--c': TOPIC_COLOR[r.topic] }">{{ r.topicLabel }}</span></div>
          <span class="ws-pill" :style="{ '--c': STATUS_COLOR[r.status] }">{{ r.statusLabel }}</span>
        </div>
        <p>{{ r.body }}</p>
        <small class="muted">{{ fmtDateTime(r.createdAt) }}<template v-if="r.handledByName"> · تابعها {{ r.handledByName }}</template></small>
      </article>
    </div>
    <div v-if="sel" class="modal-backdrop" @click.self="sel = null">
      <div class="modal card">
        <h2>رسالة من {{ sel.name }}</h2>
        <p class="muted"><span class="ws-pill" :style="{ '--c': TOPIC_COLOR[sel.topic] }">{{ sel.topicLabel }}</span> · {{ fmtDateTime(sel.createdAt) }}</p>
        <div class="ws-box" style="white-space: pre-line">{{ sel.body }}</div>
        <p><template v-if="sel.phone">الجوال: <a :href="`tel:${sel.phone}`" class="ws-code">{{ sel.phone }}</a></template><template v-if="sel.email"> · البريد: <a :href="`mailto:${sel.email}`" class="ws-code">{{ sel.email }}</a></template></p>
        <label class="field"><span>ملاحظة المتابعة (داخلية)</span><textarea v-model="reply" class="input" rows="3" placeholder="ماذا تم مع هذه الرسالة؟" /></label>
        <div class="modal-actions">
          <button v-if="sel.status !== 'in_progress'" class="btn" @click="update('in_progress')">قيد المتابعة</button>
          <button v-if="sel.status !== 'closed'" class="btn btn-primary" @click="update('closed')">إغلاق</button>
          <button v-else class="btn" @click="update('in_progress')">إعادة فتح</button>
          <button class="btn" @click="sel = null">إلغاء</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ms-list { display: grid; gap: 10px; }
.ms-item { padding: 14px 16px; transition: transform .2s, box-shadow .2s; }
.ms-item:hover { transform: translateY(-2px); box-shadow: 0 10px 22px rgba(15,23,42,.08); }
.ms-item p { margin: 8px 0; }
</style>
