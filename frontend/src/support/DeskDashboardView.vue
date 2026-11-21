<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import '../modules/platform/platform.css';
import ScoreRing from './ScoreRing.vue';
import SlaBadge from './SlaBadge.vue';
import { PRIORITY, ROLE, STATUS, TASK_STATUS, fmtDT, remaining, scoreTone, type MemberScore, type SupportTask, type TicketSummary } from './support';

/** لوحة الدعم: ما ينتظرني الآن، وأدائي هذا الشهر، وحمل الفريق للمدير */
interface Dash {
  me: MemberScore | null; myTickets: TicketSummary[]; myTasks: SupportTask[]; unassigned: TicketSummary[];
  counts: { open: number; breached: number; escalate: number; tasksDueToday: number };
  team?: MemberScore[]; workload?: { id: string; fullName: string; role: string; openTickets: number; openTasks: number; overdueTasks: number; isActive: boolean }[];
}
const session = useSession();
const toast = useToast();
const router = useRouter();
const d = ref<Dash | null>(null);
const error = ref('');
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval>;
async function load() {
  try { d.value = await api<Dash>('/support-desk/dashboard'); } catch (e) { error.value = (e as Error).message; }
}
onMounted(() => { load(); timer = setInterval(() => (now.value = Date.now()), 30_000); });
onUnmounted(() => clearInterval(timer));

async function take(t: TicketSummary) {
  try {
    await api(`/support-desk/tickets/${t.id}`, { method: 'PATCH', json: { assigneeId: session.user!.id } });
    toast.success(`استلمت الطلب ${t.number}`);
    router.push(`/support-desk/tickets/${t.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const hour = new Date().getHours();
const greet = hour < 12 ? 'صباح الخير' : 'مساء الخير';
const maxLoad = () => Math.max(1, ...(d.value?.workload ?? []).map((w) => w.openTickets + w.openTasks));
</script>

<template>
  <div>
    <section class="p-hero hero">
      <div>
        <p class="p-kicker">الدعم الفني</p>
        <h1>{{ greet }}، {{ session.user?.fullName }}</h1>
        <p class="p-sub">ابدأ بالطلبات الحمراء والمهام المتأخرة. أداؤك هذا الشهر محسوب من الالتزام بساعات الرد والحل وإنجاز المهام في موعدها وتقييم الجمعيات.</p>
      </div>
      <div v-if="d" class="me">
        <ScoreRing :value="d.me?.score ?? null" :size="104" label="من 100" />
        <div><small>تقييمي هذا الشهر</small><b>{{ d.me?.grade ?? 'لا توجد بيانات' }}</b></div>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <template v-if="d">
      <div class="kpis">
        <RouterLink to="/support-desk/tickets" class="kpi"><b>{{ d.counts.open }}</b><span>طلب مفتوح في المنصة</span></RouterLink>
        <RouterLink to="/support-desk/tickets" class="kpi bad"><b>{{ d.counts.breached }}</b><span>تجاوز المهلة</span></RouterLink>
        <RouterLink to="/support-desk/tickets" class="kpi warn"><b>{{ d.counts.escalate }}</b><span>يحتاج تصعيدًا</span></RouterLink>
        <RouterLink to="/support-desk/tasks" class="kpi"><b>{{ d.counts.tasksDueToday }}</b><span>من مهامي تسليمها اليوم أو متأخرة</span></RouterLink>
      </div>

      <div class="p-grid">
        <section class="card p-panel">
          <h2>🎫 طلبات مسندة لي <small class="muted">({{ d.myTickets.length }})</small></h2>
          <RouterLink v-for="t in d.myTickets" :key="t.id" :to="`/support-desk/tickets/${t.id}`" class="row" :style="{ '--c': PRIORITY[t.priority].color }">
            <i class="dot" />
            <span class="grow"><b dir="ltr">{{ t.number }}</b> {{ t.subject }}<small class="muted block">{{ t.organization?.name }} · {{ STATUS[t.status].label }}</small></span>
            <SlaBadge :state="t.sla.resolution" :due="t.sla.resolutionDueAt" label="الحل" :now="now" />
          </RouterLink>
          <p v-if="!d.myTickets.length" class="muted">لا توجد طلبات مسندة لك.</p>
        </section>

        <section class="card p-panel">
          <h2>📥 طلبات بلا مسؤول <small class="muted">({{ d.unassigned.length }})</small></h2>
          <div v-for="t in d.unassigned" :key="t.id" class="row stack" :style="{ '--c': PRIORITY[t.priority].color }">
            <i class="dot" />
            <RouterLink :to="`/support-desk/tickets/${t.id}`" class="grow plain"><b dir="ltr">{{ t.number }}</b> {{ t.subject }}<small class="muted block">{{ PRIORITY[t.priority].label }} · {{ t.organization?.name }}</small></RouterLink>
            <SlaBadge :state="t.sla.response" :due="t.sla.responseDueAt" label="الرد" :now="now" />
            <button class="btn btn-sm btn-primary" @click="take(t)">استلام</button>
          </div>
          <p v-if="!d.unassigned.length" class="muted">كل الطلبات لها مسؤول. 👏</p>
        </section>

        <section class="card p-panel">
          <h2>🧩 مهامي المفتوحة <small class="muted">({{ d.myTasks.length }})</small></h2>
          <RouterLink v-for="k in d.myTasks" :key="k.id" :to="`/support-desk/tasks/${k.id}`" class="row" :style="{ '--c': PRIORITY[k.priority].color }">
            <i class="dot" />
            <span class="grow">{{ k.title }}<small class="muted block">{{ TASK_STATUS[k.status].label }} · {{ k.spentHours }} س · {{ fmtDT(k.dueAt) }}</small></span>
            <span :class="['tone', k.overdue ? 'tone-bad' : 'tone-muted']">{{ remaining(k.dueAt, now) }}</span>
          </RouterLink>
          <p v-if="!d.myTasks.length" class="muted">لا توجد مهام مفتوحة.</p>
        </section>
      </div>

      <div v-if="d.me" class="card p-panel mine">
        <h2>📈 مؤشراتي هذا الشهر</h2>
        <div class="metrics">
          <div><small>الالتزام بمهلة الرد</small><span :class="['tone', `tone-${scoreTone(d.me.responseCompliance)}`]">{{ d.me.responseCompliance === null ? '—' : d.me.responseCompliance + '%' }}</span><small class="muted">{{ d.me.responses }} رد · متوسط {{ d.me.avgResponseHours ?? '—' }} س</small></div>
          <div><small>الالتزام بمهلة الحل</small><span :class="['tone', `tone-${scoreTone(d.me.resolutionCompliance)}`]">{{ d.me.resolutionCompliance === null ? '—' : d.me.resolutionCompliance + '%' }}</span><small class="muted">{{ d.me.resolved }} طلب محلول</small></div>
          <div><small>المهام في موعدها</small><span :class="['tone', `tone-${scoreTone(d.me.taskCompliance)}`]">{{ d.me.taskCompliance === null ? '—' : d.me.taskCompliance + '%' }}</span><small class="muted">{{ d.me.tasksOnTime }} من {{ d.me.tasksDone }} · {{ d.me.tasksOverdue }} متأخرة</small></div>
          <div><small>تقييم الجمعيات</small><span class="gold">{{ d.me.avgRating ? '★ ' + d.me.avgRating : '—' }}</span><small class="muted">{{ d.me.ratings }} تقييم</small></div>
          <div><small>ساعات العمل المسجلة</small><b>{{ d.me.hoursLogged }}</b></div>
        </div>
      </div>

      <section v-if="d.workload" class="card p-panel">
        <h2>👥 حمل العمل على الفريق الآن <RouterLink to="/support-desk/performance" class="more">تقييم الأداء ←</RouterLink></h2>
        <div v-for="w in d.workload.filter((x) => x.isActive)" :key="w.id" class="load">
          <span class="who">{{ w.fullName }}<small class="muted block">{{ ROLE[w.role] }}</small></span>
          <div class="track">
            <div class="seg t" :style="{ width: (w.openTickets / maxLoad()) * 100 + '%' }" :title="`${w.openTickets} طلب`" />
            <div class="seg k" :style="{ width: (w.openTasks / maxLoad()) * 100 + '%' }" :title="`${w.openTasks} مهمة`" />
          </div>
          <small>{{ w.openTickets }} طلب · {{ w.openTasks }} مهمة<b v-if="w.overdueTasks" class="late"> · {{ w.overdueTasks }} متأخرة</b></small>
          <b :class="['score', `s-${scoreTone(d.team?.find((m) => m.id === w.id)?.score ?? null)}`]">{{ d.team?.find((m) => m.id === w.id)?.score ?? '—' }}</b>
        </div>
        <p class="legend"><i class="t" /> طلبات <i class="k" /> مهام · الرقم الأخير: درجة الأداء هذا الشهر</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.hero { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
.me { display: flex; align-items: center; gap: 14px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); border-radius: 18px; padding: 10px 16px; }
.me small { color: rgba(255,255,255,.7); display: block; }
.me b { font-size: 1.15rem; }
.me :deep(.c small) { color: rgba(255,255,255,.6); }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
@media (max-width: 800px) { .kpis { grid-template-columns: 1fr 1fr; } }
.kpi { --k: var(--primary); background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 14px 16px; display: flex; flex-direction: column; color: var(--text); transition: transform .2s var(--ease); animation: p-rise .5s var(--ease) both; }
.kpi:hover { transform: translateY(-2px); }
.kpi b { font-size: 1.8rem; color: var(--k); }
.kpi span { color: var(--muted); font-size: .88rem; }
.kpi.bad { --k: #b91c1c; } .kpi.warn { --k: #ea580c; }
.row { display: flex; align-items: center; gap: 10px; padding: 9px 6px; border-radius: 10px; color: var(--text); border-bottom: 1px solid var(--border); }
.row:hover { background: var(--surface-2); }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c); box-shadow: 0 0 8px var(--c); flex: none; }
.grow { flex: 1; min-width: 0; }
.plain { color: var(--text); }
.stack { flex-wrap: wrap; }
.stack .grow { flex: 1 1 calc(100% - 24px); }
.stack .btn { margin-inline-start: auto; }
.block { display: block; }
.mine { margin-top: 16px; }
.metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 900px) { .metrics { grid-template-columns: 1fr 1fr; } }
.metrics div { background: var(--surface-2); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 5px; align-items: flex-start; }
.metrics b { font-size: 1.3rem; }
.gold { color: #d69e2e; font-weight: 700; font-size: 1.1rem; }
.more { margin-inline-start: auto; font-size: .85rem; font-weight: 500; }
.load { display: grid; grid-template-columns: 170px 1fr 190px 44px; gap: 12px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); }
@media (max-width: 800px) { .load { grid-template-columns: 1fr; } }
.track { display: flex; height: 12px; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
.seg { height: 100%; animation: grow 1s var(--ease) both; transform-origin: right; }
@keyframes grow { from { transform: scaleX(0); } }
.seg.t, .legend .t { background: #2f7a57; }
.seg.k, .legend .k { background: #6366f1; }
.late { color: #b91c1c; }
.score { font-size: 1.15rem; text-align: center; }
.s-ok { color: #10b981; } .s-info { color: #2f7a57; } .s-warn { color: #d69e2e; } .s-bad { color: #ef4444; } .s-muted { color: var(--muted); }
.legend { color: var(--muted); font-size: .82rem; margin: 10px 0 0; display: flex; align-items: center; gap: 6px; }
.legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
</style>
