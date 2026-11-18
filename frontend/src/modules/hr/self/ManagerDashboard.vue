<script setup lang="ts">
import { onMounted } from 'vue';
import CountUp from '../../beneficiaries/components/CountUp.vue';
import ReqList from './ReqList.vue';
import { TODAY_COLOR, initials, loadTeam, team } from './team';

onMounted(loadTeam);
</script>

<template>
  <div>
    <div v-if="team.error" class="alert alert-error">{{ team.error }}</div>
    <div v-if="!team.data" class="ess-skeleton"><i /><i /><i /></div>
    <template v-else>
      <section class="ess-hero ess-hero-mgr">
        <div class="ess-hero-top">
          <div>
            <p class="ess-kicker">لوحة المدير</p>
            <h1>{{ team.data.position.fullName }}</h1>
            <div class="ess-position">
              <span class="ess-badge-mgr">👔 {{ team.data.position.jobTitle || 'مدير' }}</span>
              <span v-for="u in team.data.position.managedUnits" :key="u" class="ess-badge-mgr">🏢 مدير {{ u }}</span>
              <span v-if="!team.data.position.managedUnits.length" class="ess-badge-mgr">🏢 {{ team.data.position.unitName }}</span>
              <span v-if="team.data.position.managerName" class="ess-badge-mgr">⬆️ يرفع إلى {{ team.data.position.managerName }}</span>
            </div>
          </div>
          <RouterLink to="/me/approvals" class="btn ess-cta">بانتظار اعتمادي ({{ team.data.stats.awaiting }})</RouterLink>
        </div>
      </section>

      <div class="ess-kpis">
        <div class="ess-kpi" style="--a: #6366f1; --i: 0"><span class="ic">👥</span><span>فريقي</span><strong><CountUp :value="team.data.stats.team" /></strong><small>{{ team.data.stats.direct }} يتبعونك مباشرة</small></div>
        <div class="ess-kpi" style="--a: #10b981; --i: 1"><span class="ic">✅</span><span>حاضرون اليوم</span><strong><CountUp :value="team.data.stats.present" /></strong><small>حسب البصمة</small></div>
        <div class="ess-kpi" style="--a: #a78bfa; --i: 2"><span class="ic">🌴</span><span>في إجازة</span><strong><CountUp :value="team.data.stats.onLeave" /></strong><small>اليوم</small></div>
        <div class="ess-kpi" style="--a: #f59e0b; --i: 3"><span class="ic">⏳</span><span>بانتظار قرارك</span><strong><CountUp :value="team.data.stats.awaiting" /></strong><small>{{ team.data.stats.pending }} طلب للفريق قيد الاعتماد</small></div>
      </div>

      <div class="ess-grid">
        <section class="card ess-card">
          <h2>بانتظار اعتمادي <RouterLink to="/me/approvals">الكل</RouterLink></h2>
          <ReqList :rows="team.data.awaiting.slice(0, 8)" show-employee empty="لا توجد طلبات بانتظارك 🎉" />
        </section>
        <section class="card ess-card">
          <h2>آخر طلبات الفريق</h2>
          <ReqList :rows="team.data.requests.slice(0, 8)" show-employee empty="لم يقدّم فريقك طلبات بعد" />
        </section>
        <section class="card ess-card wide">
          <h2>الموظفون تحت إدارتي <RouterLink to="/me/team">عرض الفريق</RouterLink></h2>
          <div class="ess-team">
            <RouterLink v-for="(m, i) in team.data.members.slice(0, 8)" :key="m.id" :to="`/me/team/${m.id}`" class="ess-member" :style="{ '--i': i, '--c': TODAY_COLOR[m.today.status] }">
              <span class="st" :title="m.today.label" />
              <div class="head"><span class="av">{{ initials(m.fullName) }}</span><div><b>{{ m.fullName }}</b><div class="pm-muted">{{ m.jobTitle }}</div></div></div>
              <small class="pm-muted">{{ m.today.label }}<template v-if="m.pending"> · {{ m.pending }} طلب معلق</template></small>
            </RouterLink>
          </div>
          <p v-if="!team.data.members.length" class="pm-empty">لا يوجد موظفون تحت إدارتك في الهيكل</p>
        </section>
      </div>
    </template>
  </div>
</template>
