<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import CountUp from '../../../shared/CountUp.vue';
import StatusPill from '../components/StatusPill.vue';
import { MONTHS, P, fmtDate, num } from '../lib';
import '../../../shared/module.css';
import '../volunteers.css';

interface Dash {
  year: number;
  volunteers: { active: number; pending: number; female: number; total: number };
  hours: number; activeVolunteers: number;
  events: { in_review: number; upcoming: number; to_close: number; closed: number; beneficiaries: number };
  satisfaction: { volunteer: number | null; beneficiary: number | null; responses: number };
  openTickets: number; unsignedContracts: number;
  upcoming: { id: string; eventNo: string; title: string; kind: string; kindLabel: string; startDate: string; endDate: string; status: string; statusLabel: string; volunteers: number; volunteersNeeded: number }[];
  top: { id: string; fullName: string; hours: number; events: number }[];
  monthly: number[];
}
const session = useSession();
const data = ref<Dash | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    data.value = await api<Dash>('/volunteers/dashboard');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const maxMonth = computed(() => Math.max(1, ...(data.value?.monthly ?? [1])));
const topMax = computed(() => Math.max(1, ...(data.value?.top.map((t) => t.hours) ?? [1])));
</script>

<template>
  <div>
    <section class="pm-hero vt-hero">
      <div>
        <p class="pm-kicker">التطوع</p>
        <h1>عطاء المتطوعين في لمحة</h1>
        <p class="pm-sub">سجل المتطوعين والفعاليات الميدانية وعن بعد، الساعات التطوعية والشهادات، ورضا المتطوعين والمستفيدين.</p>
      </div>
      <div class="pm-actions">
        <RouterLink v-if="session.can(P.events)" to="/volunteers/events/new" class="btn vt-glow">فعالية جديدة</RouterLink>
        <RouterLink v-if="session.can(P.volunteers)" to="/volunteers/list?new=1" class="btn vt-ghost">تسجيل متطوع</RouterLink>
        <RouterLink to="/volunteers/policy" class="btn vt-ghost">اللائحة والميثاق</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="data">
      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #10b981; --i: 0"><span>المتطوعون النشطون</span><strong><CountUp :value="data.volunteers.active" /></strong><small>{{ data.volunteers.female }} متطوعة · {{ data.volunteers.active - data.volunteers.female }} متطوع</small></div>
        <div class="pm-kpi" style="--a: #facc15; --i: 1"><span>ساعات التطوع {{ data.year }}</span><strong><CountUp :value="data.hours" /></strong><small>شارك فيها {{ data.activeVolunteers }} متطوعًا</small></div>
        <div class="pm-kpi" style="--a: #6366f1; --i: 2"><span>فعاليات منفذة {{ data.year }}</span><strong><CountUp :value="data.events.closed" /></strong><small>استفاد منها {{ num(data.events.beneficiaries) }} مستفيدًا</small></div>
        <div class="pm-kpi" style="--a: #0ea5e9; --i: 3"><span>رضا المستفيدين</span><strong><template v-if="data.satisfaction.beneficiary !== null"><CountUp :value="data.satisfaction.beneficiary" :decimals="1" />%</template><template v-else>—</template></strong><small>من {{ data.satisfaction.responses }} ردًا على الاستبانات</small></div>
        <div class="pm-kpi" style="--a: #f472b6; --i: 4"><span>رضا المتطوعين</span><strong><template v-if="data.satisfaction.volunteer !== null"><CountUp :value="data.satisfaction.volunteer" :decimals="1" />%</template><template v-else>—</template></strong><small>متوسط تقييم الفعاليات</small></div>
      </div>

      <div class="vt-grid">
        <section class="card pm-panel">
          <h2>الفعاليات القادمة <RouterLink to="/volunteers/events" class="pm-link">كل الفعاليات</RouterLink></h2>
          <p v-if="!data.upcoming.length" class="vt-empty">لا توجد فعاليات قادمة</p>
          <div class="table-wrap" v-else>
            <table class="table">
              <tbody>
                <tr v-for="e in data.upcoming" :key="e.id" class="vt-row" @click="$router.push(`/volunteers/events/${e.id}`)">
                  <td class="vt-wrap"><b>{{ e.title }}</b><span class="pm-muted" style="display: block">{{ e.eventNo }} · {{ fmtDate(e.startDate) }}</span></td>
                  <td><span :class="['vt-kind', e.kind]">{{ e.kindLabel }}</span></td>
                  <td style="min-width: 140px"><div class="vt-bar"><i :style="{ width: Math.min(100, (e.volunteers / Math.max(1, e.volunteersNeeded)) * 100) + '%' }" /></div><span class="pm-muted">{{ e.volunteers }} من {{ e.volunteersNeeded || '—' }} متطوع</span></td>
                  <td><StatusPill :status="e.status" :label="e.statusLabel" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>بانتظار إجراء</h2>
          <div class="vt-chips" style="flex-direction: column; align-items: stretch">
            <RouterLink to="/volunteers/list?status=pending" class="vt-chip">طلبات تسجيل جديدة <b style="margin-inline-start: auto">{{ data.volunteers.pending }}</b></RouterLink>
            <RouterLink to="/volunteers/approvals" class="vt-chip">فعاليات قيد الاعتماد <b style="margin-inline-start: auto">{{ data.events.in_review }}</b></RouterLink>
            <RouterLink to="/volunteers/events?status=approved" class="vt-chip">فعاليات انتهت وتحتاج تقرير إغلاق <b style="margin-inline-start: auto">{{ data.events.to_close }}</b></RouterLink>
            <RouterLink to="/volunteers/contracts" class="vt-chip">عقود بانتظار التوقيع <b style="margin-inline-start: auto">{{ data.unsignedContracts }}</b></RouterLink>
            <RouterLink to="/volunteers/tickets" class="vt-chip">شكاوى ومقترحات مفتوحة <b style="margin-inline-start: auto">{{ data.openTickets }}</b></RouterLink>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>الساعات التطوعية حسب الشهر {{ data.year }}</h2>
          <div class="vt-cols">
            <div v-for="(h, i) in data.monthly" :key="i" :title="`${MONTHS[i]}: ${num(h)} ساعة`"><span>{{ h ? num(h) : '' }}</span><i :style="{ height: (h / maxMonth) * 100 + '%', animationDelay: i * 40 + 'ms' }" /><span>{{ MONTHS[i].slice(0, 3) }}</span></div>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>الأكثر عطاءً</h2>
          <p v-if="!data.top.length" class="vt-empty">لم تُسجل ساعات بعد</p>
          <div class="vt-bars">
            <RouterLink v-for="(t, i) in data.top" :key="t.id" :to="`/volunteers/list/${t.id}`" class="r" style="color: inherit"><span>{{ i + 1 }}. {{ t.fullName }}</span><span class="vt-bar"><i :style="{ width: (t.hours / topMax) * 100 + '%' }" /></span><b class="vt-num">{{ num(t.hours) }}</b></RouterLink>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
