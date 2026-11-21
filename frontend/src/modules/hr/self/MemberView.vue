<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { fmtDate, num } from '../lib';
import { DAY_AR, DAY_COLOR, type ReqRow } from './ess';
import ReqList from './ReqList.vue';
import { initials } from './team';

interface MemberData {
  employee: { fullName: string; employeeNo: number; jobTitle: string; unitName: string; gradeName: string | null; managerName: string | null; hireDate: string; nationality: string; contractTypeLabel: string; email: string | null; phone: string | null };
  service: { years: number; months: number; days: number; hireDate: string };
  balances: { code: string; name: string; entitlement: number | null; taken: number; pending: number; available: number | null }[];
  attendance: { enabled: boolean; tracked: boolean; totals: { workDays: number; presentDays: number; absentDays: number; lateMinutes: number }; recent: { date: string; status: string; checkIn: string | null; late: number }[] };
  performance: { id: string; year: number; statusLabel: string; finalScore: number | null; rating: string | null }[];
  requests: ReqRow[];
}
const props = defineProps<{ id: string }>();
const m = ref<MemberData | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    m.value = await api<MemberData>(`/hr/me/team/${props.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>

<template>
  <div>
    <RouterLink to="/me/team" class="btn btn-sm" style="margin-bottom: 12px">→ فريقي</RouterLink>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-else-if="!m" class="ess-skeleton"><i /><i /></div>
    <template v-else>
      <section class="ess-hero ess-hero-mgr">
        <div class="ess-hero-top">
          <div style="display: flex; gap: 14px; align-items: center">
            <span class="ess-avatar" style="width: 58px; height: 58px; font-size: 1.1rem">{{ initials(m.employee.fullName) }}</span>
            <div>
              <p class="ess-kicker">عضو في فريقك · الرقم {{ m.employee.employeeNo }}</p>
              <h1>{{ m.employee.fullName }}</h1>
              <p class="sub">{{ m.employee.jobTitle }} · {{ m.employee.unitName }}</p>
            </div>
          </div>
          <div class="ess-badge-mgr">⏳ في الشركة منذ {{ m.service.years }} سنة و{{ m.service.months }} شهر و{{ m.service.days }} يوم</div>
        </div>
      </section>
      <div class="ess-grid">
        <section class="card ess-card">
          <h2>البيانات الوظيفية</h2>
          <div class="ess-kv">
            <div><span>المدير المباشر</span><b>{{ m.employee.managerName ?? '—' }}</b></div>
            <div><span>المرتبة</span><b>{{ m.employee.gradeName ?? '—' }}</b></div>
            <div><span>تاريخ المباشرة</span><b>{{ fmtDate(m.employee.hireDate) }}</b></div>
            <div><span>نوع العقد</span><b>{{ m.employee.contractTypeLabel }}</b></div>
            <div><span>الجنسية</span><b>{{ m.employee.nationality }}</b></div>
            <div><span>التواصل</span><b dir="ltr">{{ m.employee.phone ?? m.employee.email ?? '—' }}</b></div>
          </div>
        </section>
        <section class="card ess-card">
          <h2>أرصدة الإجازات</h2>
          <div class="ess-bal">
            <div v-for="b in m.balances" :key="b.code" class="r">
              <b>{{ b.name }}</b><span class="pm-muted">{{ b.available === null ? 'بلا حد' : `متاح ${num(b.available)} يوم` }}</span>
              <div v-if="b.entitlement" class="bar">
                <i class="t" :style="{ width: `${Math.min(100, (b.taken / b.entitlement) * 100)}%` }" />
                <i class="p" :style="{ width: `${Math.min(100, (b.pending / b.entitlement) * 100)}%` }" />
              </div>
            </div>
          </div>
          <p v-if="!m.balances.length" class="pm-empty">لا توجد أرصدة</p>
        </section>
        <section class="card ess-card">
          <h2>الحضور هذا الشهر</h2>
          <p v-if="!m.attendance.enabled" class="pm-empty">نظام البصمة غير مفعل</p>
          <template v-else>
            <p class="pm-muted">حضر {{ m.attendance.totals.presentDays }} من {{ m.attendance.totals.workDays }} يوم · غياب {{ m.attendance.totals.absentDays }} · تأخير {{ m.attendance.totals.lateMinutes }} دقيقة</p>
            <div class="ess-days">
              <span v-for="(d, i) in m.attendance.recent" :key="d.date" class="ess-day" :style="{ '--c': DAY_COLOR[d.status] ?? '#94a3b8', '--i': i }" :title="`${fmtDate(d.date)}: ${DAY_AR[d.status] ?? d.status}`">{{ Number(d.date.slice(8)) }}</span>
            </div>
          </template>
        </section>
        <section class="card ess-card">
          <h2>تقييم الأداء</h2>
          <div class="ess-list">
            <div v-for="(c, i) in m.performance" :key="c.id" class="ess-item" :style="{ '--i': i, '--c': '#6366f1' }">
              <span class="em">⭐</span><span class="tx"><b>بطاقة {{ c.year }}</b><span>{{ c.statusLabel }}{{ c.rating ? ` · ${c.rating}` : '' }}</span></span>
              <b class="hr-num">{{ c.finalScore === null ? '—' : `${num(c.finalScore)}%` }}</b>
            </div>
          </div>
          <p v-if="!m.performance.length" class="pm-empty">لا توجد بطاقات أداء</p>
        </section>
        <section class="card ess-card wide">
          <h2>طلباته</h2>
          <ReqList :rows="m.requests" />
        </section>
      </div>
    </template>
  </div>
</template>
