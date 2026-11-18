<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import CountUp from '../../beneficiaries/components/CountUp.vue';
import MeetingCard from '../components/MeetingCard.vue';
import { KINDS, fmtDate, type DecisionRow, type MeetingRow } from '../lib';
import '../../projects/projects.css';
import '../../comms/comms.css';
import '../meetings.css';

interface Dash {
  counts: { upcoming: number; myInvites: number; toSign: number; signing: number; drafting: number; adopted: number; recs: number; recsOpen: number; recsOverdue: number; recsDone: number };
  upcoming: MeetingRow[]; awaiting: MeetingRow[]; byKind: { kind: string; label: string; total: number; adopted: number; upcoming: number }[]; recent: DecisionRow[];
}
const session = useSession();
const d = ref<Dash | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    d.value = await api<Dash>('/meetings/dashboard');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const kinds = computed(() => KINDS.filter((k) => session.can(k.perm)).map((k) => ({ ...k, stat: d.value?.byKind.find((b) => b.kind === k.value) })));
const TASK_AR: Record<string, string> = { open: 'لم تبدأ', in_progress: 'قيد التنفيذ', done: 'منجزة', cancelled: 'ملغاة' };
</script>

<template>
  <div>
    <section class="pm-hero mt-hero">
      <div style="display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: flex-end">
        <div>
          <p class="pm-kicker">الاجتماعات واللجان</p>
          <h1>لوحة الاجتماعات</h1>
          <p class="pm-sub">من التخطيط والاعتماد والدعوات، إلى جدول الأعمال والنقاش والتوصيات، ثم محضر يوقّعه الحاضرون إلكترونيًا، وتتحول توصياته إلى مهام لها مسؤول وموعد.</p>
        </div>
        <div class="pm-actions"><RouterLink to="/meetings/decisions" class="btn cm-ghost">سجل القرارات</RouterLink></div>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="d">
      <div class="mt-kinds">
        <RouterLink v-for="(k, i) in kinds" :key="k.value" :to="`/meetings/k/${k.value}`" class="mt-kind" :style="{ '--c': k.color, '--i': i }">
          <b>{{ k.label }}</b>
          <strong><CountUp :value="k.stat?.total ?? 0" /></strong>
          <small>{{ k.stat?.upcoming ?? 0 }} قادمة · {{ k.stat?.adopted ?? 0 }} محضرًا معتمدًا</small>
        </RouterLink>
      </div>
      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #e11d48"><span>دعوات بانتظار ردي</span><strong><CountUp :value="d.counts.myInvites" /></strong><small>أكّد حضورك أو اعتذر</small></div>
        <div class="pm-kpi" style="--a: #6366f1"><span>محاضر بانتظار توقيعي</span><strong><CountUp :value="d.counts.toSign" /></strong><small>بكلمة المرور</small></div>
        <div class="pm-kpi" style="--a: #0ea5e9"><span>اجتماعات قادمة</span><strong><CountUp :value="d.counts.upcoming" /></strong><small>{{ d.counts.drafting }} محضرًا قيد التحرير</small></div>
        <RouterLink to="/meetings/decisions" class="pm-kpi" style="--a: #10b981"><span>التوصيات والقرارات</span><strong><CountUp :value="d.counts.recs" /></strong>
          <small>{{ d.counts.recsOpen }} قيد التنفيذ · {{ d.counts.recsOverdue }} متأخرة · {{ d.counts.recsDone }} منجزة</small></RouterLink>
      </div>
      <div class="cm-grid">
        <section class="card pm-panel">
          <h2>الاجتماعات القادمة</h2>
          <p v-if="!d.upcoming.length" class="pm-empty">لا توجد اجتماعات قادمة</p>
          <div class="mt-list"><MeetingCard v-for="(m, i) in d.upcoming" :key="m.id" :m="m" :i="i" /></div>
          <template v-if="d.awaiting.length">
            <h2 style="margin-top: 18px">محاضر قيد التحرير أو التوقيع</h2>
            <div class="mt-list"><MeetingCard v-for="(m, i) in d.awaiting" :key="m.id" :m="m" :i="i" /></div>
          </template>
        </section>
        <section class="card pm-panel">
          <h2>أحدث التوصيات والقرارات <RouterLink to="/meetings/decisions" class="pm-link">الكل</RouterLink></h2>
          <p v-if="!d.recent.length" class="pm-empty">لا توجد توصيات بعد</p>
          <RouterLink v-for="r in d.recent" :key="r.id" :to="r.taskId ? `/comms/tasks/${r.taskId}` : `/meetings/m/${r.meetingId}`" class="mt-rec"
            :style="{ '--c': r.kind === 'decision' ? '#e8b04b' : '#6366f1', 'grid-template-columns': '1fr auto' }">
            <div><span class="tag">{{ r.kind === 'decision' ? 'قرار' : 'توصية' }} · {{ r.bodyName }}</span><p>{{ r.text }}</p>
              <small>{{ r.ownerName ?? 'بلا مسؤول' }}<template v-if="r.dueDate"> · {{ fmtDate(r.dueDate) }}</template></small></div>
            <span v-if="r.taskStatus" :class="['cm-due', { late: r.overdue }]">{{ r.overdue ? 'متأخرة' : TASK_AR[r.taskStatus] }}<template v-if="r.progress !== null"> {{ r.progress }}%</template></span>
          </RouterLink>
        </section>
      </div>
    </template>
  </div>
</template>
