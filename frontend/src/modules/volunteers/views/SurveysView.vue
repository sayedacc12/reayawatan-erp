<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import CountUp from '../../../shared/CountUp.vue';
import { P, copy, fmtDate, num, publicUrl } from '../lib';
import '../../../shared/module.css';
import '../volunteers.css';

interface Row {
  id: string; eventNo: string; title: string; kind: string; kindLabel: string; endDate: string; open: boolean; token: string;
  volunteer: { responses: number; satisfaction: number | null }; beneficiary: { responses: number; satisfaction: number | null };
}
const session = useSession();
const toast = useToast();
const rows = ref<Row[]>([]);
onMounted(async () => {
  try {
    rows.value = await api<Row[]>('/volunteers/surveys');
  } catch (e) {
    toast.error((e as Error).message);
  }
});
const avg = (k: 'volunteer' | 'beneficiary') => {
  const xs = rows.value.filter((r) => r[k].satisfaction !== null);
  const n = xs.reduce((a, r) => a + r[k].responses, 0);
  return n ? xs.reduce((a, r) => a + r[k].satisfaction! * r[k].responses, 0) / n : 0;
};
const totals = computed(() => ({
  vol: avg('volunteer'), ben: avg('beneficiary'),
  responses: rows.value.reduce((a, r) => a + r.volunteer.responses + r.beneficiary.responses, 0),
}));
async function copyLink(r: Row, a: 'volunteer' | 'beneficiary') {
  if (await copy(publicUrl(`/v/survey/${r.token}?a=${a}`))) toast.success('نُسخ رابط الاستبانة');
}
</script>

<template>
  <div>
    <section class="pm-hero vt-hero">
      <div><p class="pm-kicker">الفعاليات</p><h1>استبانات قياس الرضا</h1>
        <p class="pm-sub">تصدر الاستبانة مع تقرير إغلاق الفعالية برابطين: للمتطوعين المشاركين وللمستفيدين. الأسئلة تُعدّل من الإعدادات.</p></div>
      <div class="pm-actions"><RouterLink v-if="session.can(P.settings)" to="/volunteers/settings?tab=surveys" class="btn vt-ghost">تعديل أسئلة الاستبانة</RouterLink></div>
    </section>
    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #10b981; --i: 0"><span>رضا المتطوعين</span><strong><CountUp :value="totals.vol" :decimals="1" />%</strong><small>متوسط مرجّح بعدد الردود</small></div>
      <div class="pm-kpi" style="--a: #0ea5e9; --i: 1"><span>رضا المستفيدين</span><strong><CountUp :value="totals.ben" :decimals="1" />%</strong><small>متوسط مرجّح بعدد الردود</small></div>
      <div class="pm-kpi" style="--a: #facc15; --i: 2"><span>إجمالي الردود</span><strong><CountUp :value="totals.responses" /></strong><small>{{ rows.length }} استبانة</small></div>
    </div>
    <section class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الفعالية</th><th>المتطوعون</th><th>المستفيدون</th><th>الحالة</th><th>الروابط</th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id">
              <td class="vt-wrap"><RouterLink :to="`/volunteers/events/${r.id}`" class="pm-link">{{ r.title }}</RouterLink><span class="pm-muted" style="display: block">{{ r.eventNo }} · {{ r.kindLabel }} · {{ fmtDate(r.endDate) }}</span></td>
              <td><b>{{ r.volunteer.satisfaction !== null ? `${num(r.volunteer.satisfaction)}%` : '—' }}</b><span class="pm-muted" style="display: block">{{ r.volunteer.responses }} ردًا</span></td>
              <td><b>{{ r.beneficiary.satisfaction !== null ? `${num(r.beneficiary.satisfaction)}%` : '—' }}</b><span class="pm-muted" style="display: block">{{ r.beneficiary.responses }} ردًا</span></td>
              <td><span class="pm-pill" :style="{ '--c': r.open ? '#10b981' : '#94a3b8' }">{{ r.open ? 'تستقبل الردود' : 'متوقفة' }}</span></td>
              <td style="white-space: nowrap"><button class="btn btn-sm" @click="copyLink(r, 'volunteer')">رابط المتطوعين</button> <button class="btn btn-sm" @click="copyLink(r, 'beneficiary')">رابط المستفيدين</button></td>
            </tr>
            <tr v-if="!rows.length"><td colspan="5" class="pm-empty">لم تصدر استبانات بعد. تصدر عند إغلاق الفعالية بتقريرها</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
