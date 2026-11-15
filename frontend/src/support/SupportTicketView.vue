<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import { useToast } from '../stores/toast';
import '../modules/platform/platform.css';
import SlaBadge from './SlaBadge.vue';
import TicketThread from './TicketThread.vue';
import { CATEGORY, PRIORITY, STATUS, fmtDT, historyLabel, historyNote, hoursLabel, type TicketDetail } from './support';

/** تفاصيل طلب الصيانة لدى الجمعية */
const route = useRoute();
const toast = useToast();
const t = ref<TicketDetail | null>(null);
const error = ref('');
const now = ref(Date.now());
const rating = ref(0);
const note = ref('');
const reopenNote = ref('');
const busy = ref(false);
let timer: ReturnType<typeof setInterval>;
const id = route.params.id as string;

async function load() {
  try { t.value = await api<TicketDetail>(`/support/tickets/${id}`); } catch (e) { error.value = (e as Error).message; }
}
onMounted(() => { load(); timer = setInterval(() => (now.value = Date.now()), 30_000); });
onUnmounted(() => clearInterval(timer));

async function act(path: string, json: unknown, msg: string) {
  busy.value = true;
  try {
    t.value = await api<TicketDetail>(`/support/tickets/${id}/${path}`, { method: 'POST', json });
    toast.success(msg);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const close = () => act('close', { rating: rating.value || undefined, note: note.value || undefined }, 'تم إغلاق الطلب، شكرًا لتقييمك');
const reopen = () => act('reopen', { note: reopenNote.value }, 'تمت إعادة فتح الطلب');
</script>

<template>
  <div v-if="t">
    <section class="p-hero">
      <div>
        <p class="p-kicker"><RouterLink to="/settings/support" class="back">الدعم الفني</RouterLink> / <span dir="ltr">{{ t.number }}</span></p>
        <h1>{{ t.subject }}</h1>
        <p class="p-sub">{{ CATEGORY[t.category] }}<template v-if="t.screen"> · الشاشة: {{ t.screen }}</template> · قُدّم {{ fmtDT(t.createdAt) }} بواسطة {{ t.createdByName }}</p>
      </div>
      <div class="hero-tags">
        <span class="prio-big" :style="{ '--c': PRIORITY[t.priority].color }">{{ PRIORITY[t.priority].label }}</span>
        <span :class="['tone', `tone-${STATUS[t.status].tone}`]">{{ STATUS[t.status].label }}</span>
      </div>
    </section>

    <div class="layout">
      <div>
        <section v-if="t.status === 'resolved'" class="card p-panel resolved">
          <h2>✅ أفاد فريق الدعم بحل الطلب</h2>
          <p class="muted">إن كانت المشكلة قد حُلّت فأغلق الطلب وقيّم الخدمة، وإن لم تُحل فأعد فتحه مع ذكر السبب.</p>
          <div class="stars">
            <button v-for="n in 5" :key="n" type="button" :class="{ on: n <= rating }" :aria-label="`${n} من 5`" @click="rating = n">★</button>
          </div>
          <input v-model="note" class="input" maxlength="1000" placeholder="ملاحظة على الخدمة (اختياري)" />
          <div class="actions">
            <button class="btn btn-primary" :disabled="busy" @click="close">إغلاق الطلب</button>
          </div>
        </section>
        <section v-if="t.canReopen" class="card p-panel">
          <h2>↩️ المشكلة لم تُحل؟</h2>
          <form class="inline" @submit.prevent="reopen">
            <input v-model="reopenNote" class="input" required minlength="3" placeholder="اذكر سبب إعادة الفتح" />
            <button class="btn" :disabled="busy">إعادة فتح الطلب</button>
          </form>
        </section>
        <TicketThread :ticket="t" base="/support" @updated="t = $event" />
        <button v-if="!['resolved', 'closed'].includes(t.status)" class="btn btn-sm link-close" :disabled="busy" @click="close">إغلاق الطلب (لم أعد بحاجة إليه)</button>
      </div>

      <aside>
        <section class="card p-panel">
          <h2>⏱️ التزام الخدمة</h2>
          <dl class="p-dl">
            <dt>المستوى</dt><dd>{{ t.level.name }}</dd>
            <dt>أول رد</dt>
            <dd>
              <SlaBadge :state="t.sla.response" :due="t.sla.responseDueAt" label="الرد" :now="now" />
              <small class="muted block">خلال {{ hoursLabel(t.level.responseHours) }}، الموعد {{ fmtDT(t.sla.responseDueAt) }}</small>
            </dd>
            <dt>الحل</dt>
            <dd>
              <SlaBadge :state="t.sla.resolution" :due="t.sla.resolutionDueAt" label="الحل" :now="now" />
              <small class="muted block">خلال {{ hoursLabel(t.level.resolutionHours) }}، الموعد {{ fmtDT(t.sla.resolutionDueAt) }}</small>
            </dd>
            <dt>المسؤول</dt><dd>{{ t.assigneeName ?? 'لم يُسند بعد' }}</dd>
            <template v-if="t.requestedPriority !== t.priority"><dt>المستوى المطلوب</dt><dd>{{ PRIORITY[t.requestedPriority].label }} (عدّله فريق الدعم)</dd></template>
            <template v-if="t.rating"><dt>تقييمك</dt><dd class="gold">{{ '★'.repeat(t.rating) }}</dd></template>
          </dl>
          <p v-if="t.status === 'waiting_customer'" class="alert alert-error wait">فريق الدعم ينتظر ردك، والمهلة متوقفة حتى ترد.</p>
        </section>
        <section class="card p-panel">
          <h2>آلية التعامل مع هذا المستوى</h2>
          <ol class="steps"><li v-for="h in t.level.handling" :key="h">{{ h }}</li></ol>
          <p class="muted small"><b>التصعيد:</b> {{ t.level.escalation }}</p>
        </section>
        <section class="card p-panel">
          <h2>سجل الطلب</h2>
          <ul class="p-timeline">
            <li v-for="(h, i) in t.history" :key="i">{{ historyLabel(h) }}<small>{{ h.by }} · {{ fmtDT(h.at) }}</small><small v-if="historyNote(h)">{{ historyNote(h) }}</small></li>
          </ul>
        </section>
      </aside>
    </div>
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
</template>

<style scoped>
.back { color: inherit; }
.hero-tags { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.prio-big { background: var(--c); color: #fff; padding: 5px 14px; border-radius: 999px; font-weight: 700; box-shadow: 0 0 18px color-mix(in srgb, var(--c) 60%, transparent); }
.layout { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 960px) { .layout { grid-template-columns: 1fr; } }
.block { display: block; margin-top: 4px; }
.gold { color: #e8b04b; }
.small { font-size: .85rem; }
.steps { margin: 0; padding-inline-start: 20px; display: grid; gap: 4px; }
.resolved { border: 1.5px solid var(--success); }
.stars { display: flex; gap: 4px; margin: 6px 0 10px; }
.stars button { font-size: 1.8rem; border: 0; background: none; cursor: pointer; color: var(--border); transition: transform .15s; }
.stars button.on { color: #e8b04b; }
.stars button:hover { transform: scale(1.15); }
.actions { margin-top: 10px; }
.inline { display: flex; gap: 8px; }
.inline .input { flex: 1; }
.wait { margin: 12px 0 0; }
.link-close { margin-top: -6px; }
</style>
