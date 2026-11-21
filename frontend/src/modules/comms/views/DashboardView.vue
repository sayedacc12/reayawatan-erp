<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import CountUp from '../../../shared/CountUp.vue';
import ConfBadge from '../components/ConfBadge.vue';
import { PRIORITY_COLOR, dueText, fmtDate, money, type TaskRow, type TxnRow } from '../lib';
import '../../../shared/module.css';
import '../comms.css';

interface Dash {
  counts: { inbox: number; overdue: number; following: number; drafts: number; unread: number; tasks: { mine: number; overdue: number; supporting: number; assigned: number; done: number } };
  inbox: TxnRow[]; tasks: TaskRow[]; external: { id: string; system: string; refNo: string | null; title: string; dueDate: string; progress: number; overdue: boolean; link: string }[];
  registry?: { open: number; done: number; overdue: number; financial_open: number; financial_amount: number; decisions: number; avg_days: number | null; byHolder: { unit: string; open: number; overdue: number }[] };
  allTasks?: { open: number; overdue: number; done: number; from_meetings: number };
}
const router = useRouter();
const d = ref<Dash | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    d.value = await api<Dash>('/comms/dashboard');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const maxOpen = () => Math.max(1, ...(d.value?.registry?.byHolder ?? []).map((x) => x.open));
</script>

<template>
  <div>
    <section class="pm-hero cm-hero">
      <div style="display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: flex-end">
        <div>
          <p class="pm-kicker">الاتصالات الإدارية</p>
          <h1>المعاملات والقرارات والمهام</h1>
          <p class="pm-sub">معاملات إدارية ومالية تتنقل بين الإدارات والموظفين بدرجات سرية، وقرارات وتعاميم يُسجل الاطلاع عليها، ومهام لكل منها مسؤول وموعد.</p>
        </div>
        <div class="pm-actions">
          <RouterLink to="/comms/new" class="btn cm-glow">+ معاملة جديدة</RouterLink>
          <RouterLink to="/comms/tasks" class="btn cm-ghost">مهامي</RouterLink>
        </div>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="d">
      <div class="pm-kpis">
        <RouterLink to="/comms/inbox" class="pm-kpi" style="--a: #14b8a6; --i: 0"><span>معاملات عندي</span><strong><CountUp :value="d.counts.inbox" /></strong><small>بانتظار إجرائي</small></RouterLink>
        <RouterLink to="/comms/inbox?status=overdue" class="pm-kpi" style="--a: #e11d48; --i: 1"><span>متأخرة عندي</span><strong><CountUp :value="d.counts.overdue" /></strong><small>تجاوزت موعدها</small></RouterLink>
        <RouterLink to="/comms/decisions" class="pm-kpi" style="--a: #8b5cf6; --i: 2"><span>قرارات لم أطلع عليها</span><strong><CountUp :value="d.counts.unread" /></strong><small>قرارات وتعاميم</small></RouterLink>
        <RouterLink to="/comms/tasks" class="pm-kpi" style="--a: #6366f1; --i: 3"><span>مهامي المفتوحة</span><strong><CountUp :value="d.counts.tasks.mine" /></strong><small>{{ d.counts.tasks.overdue }} متأخرة</small></RouterLink>
        <RouterLink to="/comms/tasks?scope=supporting" class="pm-kpi" style="--a: #0ea5e9; --i: 4"><span>أساند فيها</span><strong><CountUp :value="d.counts.tasks.supporting" /></strong><small>للمتابعة فقط</small></RouterLink>
        <RouterLink to="/comms/inbox?box=following" class="pm-kpi" style="--a: #f59e0b; --i: 5"><span>أتابعها</span><strong><CountUp :value="d.counts.following" /></strong><small>معاملات جارية</small></RouterLink>
      </div>

      <div class="cm-grid">
        <section class="card pm-panel">
          <h2>معاملات بانتظاري <RouterLink to="/comms/inbox" class="pm-link">الكل</RouterLink></h2>
          <p v-if="!d.inbox.length" class="pm-empty">لا توجد معاملات عندك الآن</p>
          <div class="cm-list">
            <div v-for="(t, i) in d.inbox" :key="t.id" class="card cm-item" :style="{ '--c': PRIORITY_COLOR[t.priority], '--i': i }" @click="router.push(`/comms/t/${t.id}`)">
              <span class="bar" />
              <div>
                <h3>{{ t.subject }} <ConfBadge :level="t.confidentiality" :label="t.confidentialityLabel" /></h3>
                <div class="meta"><span class="cm-code">{{ t.refNo }}</span><span>{{ t.holderPurposeLabel }}</span><span>من {{ t.createdByName }}</span></div>
              </div>
              <div class="side"><span :class="['cm-due', { late: t.overdue }]">{{ t.dueDate ? fmtDate(t.dueDate) : '' }}</span></div>
            </div>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>مهامي القريبة <RouterLink to="/comms/tasks" class="pm-link">الكل</RouterLink></h2>
          <p v-if="!d.tasks.length && !d.external.length" class="pm-empty">لا توجد مهام مفتوحة</p>
          <div style="display: grid; gap: 10px">
            <RouterLink v-for="t in d.tasks" :key="t.id" :to="`/comms/tasks/${t.id}`" style="display: grid; gap: 5px; color: inherit">
              <span style="display: flex; justify-content: space-between; gap: 8px"><b style="font-size: .9rem">{{ t.title }}</b><span :class="['cm-due', { late: t.overdue, soon: !t.overdue && (t.daysLeft ?? 9) <= 3 }]">{{ dueText(t.daysLeft) }}</span></span>
              <div :class="['cm-track', { warn: t.overdue }]"><i :style="{ width: `${t.progress}%` }" /></div>
            </RouterLink>
            <template v-if="d.external.length">
              <p class="cm-sec">من الأنظمة الأخرى</p>
              <RouterLink v-for="x in d.external" :key="x.id" :to="x.link" style="display: flex; justify-content: space-between; gap: 8px; color: inherit; font-size: .88rem">
                <span>{{ x.title }} <span class="pm-tag">{{ x.system }}</span></span><span :class="['cm-due', { late: x.overdue }]">{{ fmtDate(x.dueDate) }}</span>
              </RouterLink>
            </template>
          </div>
        </section>

        <section v-if="d.registry" class="card pm-panel wide">
          <h2>نظرة على المعاملات <span class="pm-muted">على ما يحق لك الاطلاع عليه</span></h2>
          <dl class="pm-dl" style="margin-bottom: 16px">
            <div><dt>جارية</dt><dd>{{ d.registry.open }}</dd></div>
            <div><dt>متأخرة</dt><dd style="color: #e11d48">{{ d.registry.overdue }}</dd></div>
            <div><dt>منجزة أو محفوظة</dt><dd>{{ d.registry.done }}</dd></div>
            <div><dt>متوسط مدة الإنجاز</dt><dd>{{ d.registry.avg_days ?? '—' }} يوم</dd></div>
            <div><dt>معاملات مالية جارية</dt><dd>{{ d.registry.financial_open }} · {{ money(d.registry.financial_amount) }}</dd></div>
            <div><dt>قرارات وتعاميم صادرة</dt><dd>{{ d.registry.decisions }}</dd></div>
          </dl>
          <p class="cm-sec">المعاملات الجارية حسب الإدارة</p>
          <div class="au-bars" style="display: grid; gap: 10px">
            <div v-for="(r, i) in d.registry.byHolder" :key="r.unit" style="display: grid; grid-template-columns: 170px 1fr 70px; gap: 10px; align-items: center; font-size: .86rem">
              <span>{{ r.unit }}</span>
              <div class="cm-track" :class="{ warn: r.overdue > 0 }"><i :style="{ width: `${(r.open / maxOpen()) * 100}%`, animationDelay: `${i * 60}ms` }" /></div>
              <span class="pm-muted">{{ r.open }}{{ r.overdue ? ` · ${r.overdue} متأخرة` : '' }}</span>
            </div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
