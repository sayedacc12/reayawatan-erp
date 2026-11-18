<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import ConfBadge from '../components/ConfBadge.vue';
import { CONF, PRIORITY_COLOR, STATUS_COLOR, fmtDate, fmtDateTime, money, type TxnRow } from '../lib';
import '../../projects/projects.css';
import '../comms.css';

/** صناديق المعاملات: عندي، المرسلة، شاركت فيها، أتابعها، المسودات، والسجل العام، والقرارات والتعاميم */
const props = defineProps<{ box: 'inbox' | 'registry' | 'decisions' }>();
const route = useRoute();
const router = useRouter();
const data = ref<{ items: TxnRow[]; counts: { inbox: number; overdue: number; following: number; drafts: number; unread: number } } | null>(null);
const error = ref('');
const sub = ref(String(route.query.box ?? (props.box === 'inbox' ? 'inbox' : props.box)));
const f = reactive({ status: String(route.query.status ?? ''), kind: '', confidentiality: '', docType: '', q: '' });
const TABS = computed(() => props.box === 'inbox'
  ? [{ v: 'inbox', l: 'عندي الآن', n: data.value?.counts.inbox }, { v: 'sent', l: 'أنشأتها' }, { v: 'involved', l: 'شاركت فيها' }, { v: 'following', l: 'أتابعها', n: data.value?.counts.following }]
  : []);
const title = computed(() => ({ inbox: 'معاملاتي', registry: 'سجل المعاملات', decisions: 'القرارات والتعاميم' })[props.box]);
const sub2 = computed(() => ({
  inbox: 'كل معاملة عند شخص واحد في كل وقت. ما عندك الآن ينتظر إجراءك، وما تتابعه تطلع عليه دون أن تتدخل في إجراءاته.',
  registry: 'الوارد والصادر والداخلي حسب صلاحيتك: المعاملات السرية والعالية السرية لا تظهر هنا إلا لأطرافها.',
  decisions: 'القرارات الإدارية والتعاميم الموجهة إليك أو التي يحق لك الاطلاع عليها، مع تسجيل اطلاع كل موجه إليه.',
})[props.box]);

async function load() {
  try {
    const qs = new URLSearchParams({ box: sub.value === 'drafts' ? 'sent' : sub.value });
    if (sub.value === 'drafts') qs.set('status', 'draft');
    else if (f.status) qs.set('status', f.status);
    for (const k of ['kind', 'confidentiality', 'docType', 'q'] as const) if (f[k]) qs.set(k, f[k]);
    data.value = await api(`/comms/transactions?${qs}`);
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(() => [sub.value, f.status, f.kind, f.confidentiality, f.docType], load);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(() => f.q, () => {
  clearTimeout(timer);
  timer = setTimeout(load, 350);
});
const open = (t: TxnRow) => router.push(t.status === 'draft' ? `/comms/edit/${t.id}` : `/comms/t/${t.id}`);
</script>

<template>
  <div>
    <section class="pm-hero cm-hero">
      <div style="display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: flex-end">
        <div><p class="pm-kicker">الاتصالات الإدارية</p><h1>{{ title }}</h1><p class="pm-sub">{{ sub2 }}</p></div>
        <div class="pm-actions"><RouterLink to="/comms/new" class="btn cm-glow">+ {{ box === 'decisions' ? 'قرار أو تعميم' : 'معاملة جديدة' }}</RouterLink></div>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="TABS.length" class="pm-tabs">
      <button v-for="t in TABS" :key="t.v" :class="['pm-tab', { on: sub === t.v }]" @click="sub = t.v">{{ t.l }} <b v-if="t.n">{{ t.n }}</b></button>
      <button :class="['pm-tab', { on: sub === 'drafts' }]" @click="sub = 'drafts'">المسودات <b v-if="data?.counts.drafts">{{ data.counts.drafts }}</b></button>
    </div>
    <div class="cm-toolbar">
      <input v-model="f.q" class="input grow" placeholder="ابحث بالموضوع أو الرقم أو الجهة الخارجية" />
      <select v-if="sub !== 'drafts' && box !== 'decisions'" v-model="f.status" class="input">
        <option value="">كل الحالات</option><option value="open">جارية</option><option value="overdue">متأخرة</option><option value="closed">منجزة</option><option value="archived">محفوظة</option><option value="cancelled">ملغاة</option>
      </select>
      <select v-if="box === 'registry'" v-model="f.docType" class="input"><option value="">معاملات وقرارات</option><option value="transaction">المعاملات</option><option value="decision">القرارات</option><option value="circular">التعاميم</option></select>
      <select v-if="box !== 'decisions'" v-model="f.kind" class="input"><option value="">إدارية ومالية</option><option value="admin">إدارية</option><option value="financial">مالية</option></select>
      <select v-model="f.confidentiality" class="input"><option value="">كل درجات السرية</option><option v-for="c in CONF" :key="c.value" :value="c.value">{{ c.label }}</option></select>
    </div>
    <p v-if="data && !data.items.length" class="card pm-panel pm-empty">لا توجد معاملات في هذا العرض</p>
    <div class="cm-list">
      <div v-for="(t, i) in data?.items ?? []" :key="t.id" :class="['card cm-item', { unread: t.unread }]" :style="{ '--c': t.overdue ? '#e11d48' : PRIORITY_COLOR[t.priority], '--i': Math.min(i, 20) }" @click="open(t)">
        <span class="bar" />
        <div style="min-width: 0">
          <h3>{{ t.subject }} <ConfBadge :level="t.confidentiality" :label="t.confidentialityLabel" /><span v-if="t.priority !== 'normal'" class="pm-pill" :style="{ '--c': PRIORITY_COLOR[t.priority] }">{{ t.priorityLabel }}</span></h3>
          <div class="meta">
            <span class="cm-code">{{ t.refNo.startsWith('DRAFT') ? 'مسودة' : t.refNo }}</span>
            <span>{{ t.docLabel }}{{ t.docType === 'transaction' ? ` ${t.kindLabel}` : '' }}{{ t.direction !== 'internal' ? ` · ${t.directionLabel}` : '' }}</span>
            <span v-if="t.categoryName">{{ t.categoryName }}</span>
            <span v-if="t.externalParty">{{ t.externalParty }}</span>
            <span>من {{ t.createdByName }}{{ t.originUnitName ? ` (${t.originUnitName})` : '' }}</span>
            <span v-if="t.amount" class="pm-money">{{ money(t.amount) }}</span>
          </div>
        </div>
        <div class="side">
          <span class="pm-pill" :style="{ '--c': t.overdue ? '#e11d48' : STATUS_COLOR[t.status] }">{{ t.overdue ? 'متأخرة' : t.statusLabel }}</span>
          <span v-if="t.status === 'open' && t.holderName" class="pm-muted">{{ t.isHolder ? 'عندك' : `عند ${t.holderName}` }} · {{ t.holderPurposeLabel }}</span>
          <span v-if="t.docType !== 'transaction' && t.status === 'issued'" class="pm-muted">اطلع {{ t.readCount }} من {{ t.recipientsCount }}</span>
          <span v-if="t.dueDate && t.status === 'open'" :class="['cm-due', { late: t.overdue }]">الموعد {{ fmtDate(t.dueDate) }}</span>
          <span v-else class="pm-muted">{{ fmtDateTime(t.updatedAt) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
