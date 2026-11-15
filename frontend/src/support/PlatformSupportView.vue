<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import '../modules/platform/platform.css';
import SlaBadge from './SlaBadge.vue';
import { CATEGORY, PRIORITY, STATUS, fmtDT, type TicketSummary } from './support';

/** صندوق طلبات الصيانة لدى مدير المنصة */
const router = useRouter();
const rows = ref<TicketSummary[]>([]);
const error = ref('');
const status = ref<'open' | ''>('open');
const priority = ref('');
const quick = ref<'' | 'breached' | 'escalate' | 'unassigned'>('');
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval>;

async function load() {
  try {
    const q = new URLSearchParams();
    if (status.value) q.set('status', status.value);
    rows.value = await api<TicketSummary[]>(`/platform/support/tickets?${q}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => { load(); timer = setInterval(() => { now.value = Date.now(); }, 30_000); });
onUnmounted(() => clearInterval(timer));
const setStatus = (s: 'open' | '') => { status.value = s; load(); };

const isOpen = (t: TicketSummary) => !['resolved', 'closed'].includes(t.status);
const breached = (t: TicketSummary) => isOpen(t) && (t.sla.response === 'breached' || t.sla.resolution === 'breached');
const open = computed(() => rows.value.filter(isOpen));
const kpi = computed(() => ({
  open: open.value.length,
  newOnes: open.value.filter((t) => t.status === 'new').length,
  breached: open.value.filter(breached).length,
  escalate: open.value.filter((t) => t.sla.needsEscalation).length,
  unassigned: open.value.filter((t) => !t.assigneeName).length,
}));
const countBy = (p: string) => rows.value.filter((t) => t.priority === p).length;
const shown = computed(() => rows.value.filter((t) => {
  if (priority.value && t.priority !== priority.value) return false;
  if (quick.value === 'breached') return breached(t);
  if (quick.value === 'escalate') return t.sla.needsEscalation;
  if (quick.value === 'unassigned') return isOpen(t) && !t.assigneeName;
  return true;
}));
</script>

<template>
  <div>
    <section class="p-hero">
      <div>
        <p class="p-kicker">خدمة العملاء</p>
        <h1>طلبات الصيانة</h1>
        <p class="p-sub">طلبات الجمعيات مرتبة حسب مستوى الخدمة ثم أقرب مهلة. ابدأ دائمًا بالأحمر، وصعّد ما تجاوز مهلته.</p>
      </div>
      <RouterLink to="/platform/sla" class="btn btn-ghost-light">مستويات الخدمة وآلية التعامل</RouterLink>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="kpis">
      <button :class="['kpi', { on: !quick }]" @click="quick = ''"><b>{{ kpi.open }}</b><span>طلب مفتوح</span><small>{{ kpi.newOnes }} جديد لم يُرد عليه</small></button>
      <button :class="['kpi bad', { on: quick === 'breached', pulse: kpi.breached }]" @click="quick = 'breached'"><b>{{ kpi.breached }}</b><span>تجاوز المهلة</span></button>
      <button :class="['kpi warn', { on: quick === 'escalate', pulse: kpi.escalate }]" @click="quick = 'escalate'"><b>{{ kpi.escalate }}</b><span>يحتاج تصعيدًا</span></button>
      <button :class="['kpi', { on: quick === 'unassigned' }]" @click="quick = 'unassigned'"><b>{{ kpi.unassigned }}</b><span>بدون مسؤول</span></button>
    </div>

    <div class="p-filters">
      <button :class="['p-chip', { on: status === 'open' }]" @click="setStatus('open')">المفتوحة</button>
      <button :class="['p-chip', { on: !status }]" @click="setStatus('')">كل الطلبات</button>
      <span class="sep" />
      <button :class="['p-chip', { on: !priority }]" @click="priority = ''">كل المستويات</button>
      <button v-for="(p, k) in PRIORITY" :key="k" :class="['p-chip', { on: priority === k }]" @click="priority = k">{{ p.icon }} {{ p.label }}<b>{{ countBy(k) }}</b></button>
    </div>

    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الطلب</th><th>الجمعية</th><th>المستوى</th><th>الحالة</th><th>المهل</th><th>المسؤول</th></tr></thead>
        <tbody>
          <tr v-for="t in shown" :key="t.id" :class="['clickable', { hot: t.sla.needsEscalation }]" :style="{ '--c': PRIORITY[t.priority].color }" @click="router.push(`/platform/support/${t.id}`)">
            <td class="first"><b dir="ltr">{{ t.number }}</b> {{ t.subject }}<br /><small class="muted">{{ CATEGORY[t.category] }} · {{ fmtDT(t.createdAt) }}</small></td>
            <td>{{ t.organization?.name }}</td>
            <td><span class="prio">{{ PRIORITY[t.priority].label }}</span><span v-if="t.escalatedAt" class="tone tone-bad esc">مُصعّد</span></td>
            <td><span :class="['tone', `tone-${STATUS[t.status].tone}`]">{{ STATUS[t.status].label }}</span></td>
            <td><div class="slas"><SlaBadge v-if="isOpen(t) && t.sla.response !== 'met'" :state="t.sla.response" :due="t.sla.responseDueAt" label="الرد" :now="now" /><SlaBadge v-if="isOpen(t)" :state="t.sla.resolution" :due="t.sla.resolutionDueAt" label="الحل" :now="now" /><span v-else-if="t.rating" class="gold">{{ '★'.repeat(t.rating) }}</span></div></td>
            <td>{{ t.assigneeName ?? '—' }}</td>
          </tr>
          <tr v-if="!shown.length"><td colspan="6" class="muted center">لا توجد طلبات مطابقة.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
@media (max-width: 800px) { .kpis { grid-template-columns: repeat(2, 1fr); } }
.kpi { --k: var(--primary); text-align: start; border: 1px solid var(--border); background: var(--surface); border-radius: 16px; padding: 14px 16px; cursor: pointer; font: inherit; display: flex; flex-direction: column; gap: 2px; transition: all .2s var(--ease); }
.kpi b { font-size: 1.8rem; color: var(--k); line-height: 1.1; }
.kpi small { color: var(--muted); }
.kpi.bad { --k: #b91c1c; }
.kpi.warn { --k: #ea580c; }
.kpi.on { border-color: var(--k); box-shadow: 0 0 0 3px color-mix(in srgb, var(--k) 16%, transparent); }
.kpi.pulse b { animation: p-blink 1.6s infinite; }
.sep { width: 1px; background: var(--border); margin: 0 4px; }
.clickable { cursor: pointer; }
.first { border-inline-start: 4px solid var(--c); }
.hot { background: color-mix(in srgb, #b91c1c 5%, transparent); }
.prio { font-weight: 700; color: var(--c); }
.esc { margin-inline-start: 6px; }
.slas { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
.center { text-align: center; }
.gold { color: #e8b04b; }
</style>
