<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import CountUp from '../../../shared/CountUp.vue';
import { LEVEL_COLOR, LEVELS, P, STATUS_COLOR, fmtDate, loadLookups, unitOptions, type ActionRow, type Lookups } from '../lib';
import '../../../shared/module.css';
import '../audit.css';

const session = useSession();
const route = useRoute();
const router = useRouter();
const data = ref<{ items: ActionRow[]; counts: { active: number; overdue: number; submitted: number; closed: number } } | null>(null);
const lookups = ref<Lookups | null>(null);
const error = ref('');
const f = reactive({ status: String(route.query.status ?? 'active'), unitId: '', priority: '', mine: false, q: '' });
const view = ref<'cards' | 'table'>('cards');
async function load() {
  try {
    const qs = new URLSearchParams();
    if (f.status) qs.set('status', f.status);
    if (f.unitId) qs.set('unitId', f.unitId);
    if (f.priority) qs.set('priority', f.priority);
    if (f.mine) qs.set('mine', '1');
    data.value = await api(`/audit/actions?${qs}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await load();
  lookups.value = await loadLookups().catch(() => null);
});
watch(() => [f.status, f.unitId, f.priority, f.mine], load);
const shown = computed(() => (data.value?.items ?? []).filter((a) => !f.q || `${a.code} ${a.title} ${a.responsibleUnitName} ${a.assigneeName ?? ''} ${a.engagementCode ?? ''}`.includes(f.q)));
const TABS = [
  { v: 'active', l: 'المفتوحة' }, { v: 'overdue', l: 'المتأخرة' }, { v: 'submitted', l: 'بانتظار التحقق' }, { v: 'closed', l: 'المغلقة' }, { v: '', l: 'الكل' },
];
const dueText = (a: ActionRow) => (a.daysLeft === null ? `أُغلقت ${fmtDate(a.closedAt)}` : a.daysLeft < 0 ? `متأخرة ${-a.daysLeft} يوم` : a.daysLeft === 0 ? 'موعدها اليوم' : `باقي ${a.daysLeft} يوم`);
const dueClass = (a: ActionRow) => (a.daysLeft === null ? '' : a.daysLeft < 0 ? 'late' : a.daysLeft <= 7 ? 'soon' : '');
</script>

<template>
  <div>
    <section class="pm-hero au-hero">
      <div><p class="pm-kicker">المتابعة</p><h1>متابعة التوصيات</h1>
        <p class="pm-sub">كل توصية مهمة مزمنة لجهة في الهيكل التنظيمي. تتابعها الجهة بنسبة الإنجاز، وتُغلق فقط بتقرير إغلاق موثق يتحقق منه المراجع.</p></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="data" class="pm-kpis">
      <div class="pm-kpi" style="--a: #0ea5e9; --i: 0"><span>مفتوحة</span><strong><CountUp :value="data.counts.active" /></strong><small>ضمن العرض الحالي</small></div>
      <div class="pm-kpi" style="--a: #e11d48; --i: 1"><span>متأخرة</span><strong><CountUp :value="data.counts.overdue" /></strong><small>تجاوزت موعدها</small></div>
      <div class="pm-kpi" style="--a: #f59e0b; --i: 2"><span>بانتظار التحقق</span><strong><CountUp :value="data.counts.submitted" /></strong><small>قُدم تقرير إغلاقها</small></div>
      <div class="pm-kpi" style="--a: #10b981; --i: 3"><span>مغلقة</span><strong><CountUp :value="data.counts.closed" /></strong><small>بتقرير إغلاق موثق</small></div>
    </div>
    <div class="pm-tabs">
      <button v-for="t in TABS" :key="t.v" :class="['pm-tab', { on: f.status === t.v }]" @click="f.status = t.v">{{ t.l }}</button>
    </div>
    <div class="au-toolbar">
      <input v-model="f.q" class="input grow" placeholder="ابحث بالرمز أو العنوان أو الجهة" />
      <select v-if="session.can(P.read)" v-model="f.unitId" class="input"><option value="">كل الجهات</option><option v-for="u in unitOptions(lookups)" :key="u.id" :value="u.id">{{ u.label }}</option></select>
      <select v-model="f.priority" class="input"><option value="">كل الخطورات</option><option v-for="l in LEVELS" :key="l.value" :value="l.value">{{ l.label }}</option></select>
      <label class="check"><input v-model="f.mine" type="checkbox" /> المسندة إليّ</label>
      <div class="au-seg"><button :class="{ on: view === 'cards' }" @click="view = 'cards'">بطاقات</button><button :class="{ on: view === 'table' }" @click="view = 'table'">جدول</button></div>
    </div>
    <p v-if="data && !shown.length" class="card pm-panel pm-empty">لا توجد توصيات في هذا العرض</p>
    <div v-if="view === 'cards'" class="au-cards">
      <div v-for="(a, k) in shown" :key="a.id" class="card au-card" :style="{ '--c': LEVEL_COLOR[a.priority], '--i': k }" @click="router.push(`/audit/actions/${a.id}`)">
        <div style="display: flex; justify-content: space-between; gap: 6px"><span class="au-code">{{ a.code }} · {{ a.engagementCode }}</span><span class="au-lvl" :style="{ '--c': LEVEL_COLOR[a.priority] }">{{ a.priorityLabel }}</span></div>
        <h3>{{ a.title }}</h3>
        <span class="pm-muted" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden">{{ a.description }}</span>
        <span><b>{{ a.responsibleUnitName }}</b><span class="pm-muted"> · {{ a.assigneeName ?? 'الجهة كلها' }}</span></span>
        <div class="au-track" :class="{ warn: a.overdue, ok: a.status === 'closed' }"><i :style="{ width: a.progress + '%' }" /></div>
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap">
          <span class="pm-pill" :style="{ '--c': a.overdue ? '#e11d48' : STATUS_COLOR[a.status] }">{{ a.statusLabel }}</span>
          <span :class="['au-due', dueClass(a)]">{{ dueText(a) }}</span>
        </div>
        <span class="pm-muted">الموعد {{ fmtDate(a.dueDate) }}{{ a.extended ? ` (مُدّد من ${fmtDate(a.originalDueDate)})` : '' }}</span>
      </div>
    </div>
    <section v-else class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>التوصية</th><th>الجهة المسؤولة</th><th>الخطورة</th><th>الموعد</th><th>الإنجاز</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="a in shown" :key="a.id" class="au-row" @click="router.push(`/audit/actions/${a.id}`)">
              <td><b>{{ a.title }}</b><span class="pm-muted">{{ a.code }} · {{ a.engagementCode }}</span></td>
              <td>{{ a.responsibleUnitName }}<span class="pm-muted">{{ a.assigneeName ?? 'الجهة كلها' }}</span></td>
              <td><span class="au-lvl" :style="{ '--c': LEVEL_COLOR[a.priority] }">{{ a.priorityLabel }}</span></td>
              <td>{{ fmtDate(a.dueDate) }}<span :class="['au-due', dueClass(a)]">{{ dueText(a) }}</span></td>
              <td class="au-num">{{ a.progress }}%</td>
              <td><span class="pm-pill" :style="{ '--c': a.overdue ? '#e11d48' : STATUS_COLOR[a.status] }">{{ a.statusLabel }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
