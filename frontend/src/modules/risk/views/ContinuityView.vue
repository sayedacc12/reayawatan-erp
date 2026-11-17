
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { fmtDate, fmtDateTime, hours, P, SEVERITY, TEAM_KINDS, WF_STATUS } from '../lib';
import '../../projects/projects.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const route = useRoute();
const router = useRouter();
const tab = ref<'bia' | 'teams'>(route.path.startsWith('/risk/crisis') ? 'teams' : 'bia');
const bia = ref<any[] | null>(null);
const teams = ref<any[] | null>(null);
onMounted(async () => { [bia.value, teams.value] = await Promise.all([api<any[]>('/risk/continuity'), api<any[]>('/risk/crisis-teams')]); });
const CRIT = ['', '#10b981', '#f59e0b', '#f97316', '#ef4444'];
function go(t: 'bia' | 'teams') { tab.value = t; router.replace(t === 'teams' ? '/risk/crisis' : '/risk/continuity'); }
</script>

<template>
  <div>
    <section class="pm-hero rk-hero">
      <div><p class="pm-kicker">ضمان استمرارية الأعمال</p><h1>الاستمرارية والأزمات</h1>
        <p class="pm-sub">تحليل أثر توقف كل نشاط وخطط التعافي بأهداف زمنية، وفرق الأزمات والكوارث بلائحة صلاحيات تفصيلية تُفعَّل في النظام مباشرة عند إعلان الأزمة وتُسحب عند انتهائها.</p></div>
      <div class="pm-actions">
        <RouterLink v-if="session.can(P.continuity)" to="/risk/continuity/new" class="btn rk-glow">نشاط جديد (BIA)</RouterLink>
        <RouterLink v-if="session.can(P.continuity)" to="/risk/crisis/new" class="btn rk-ghost">تشكيل فريق أزمة</RouterLink>
      </div>
    </section>
    <template v-for="t in teams ?? []" :key="t.id">
      <RouterLink v-if="t.activeEvent" :to="`/risk/crisis/event/${t.activeEvent.id}`" class="rk-alarm">
        <span><span class="siren" /><b>{{ t.activeEvent.title }}</b> — {{ t.name }} مفعّل منذ {{ fmtDateTime(t.activeEvent.activatedAt) }}</span>
        <span class="pm-pill" :style="{ '--c': '#fff' }">{{ SEVERITY[t.activeEvent.severity].label }}</span>
      </RouterLink>
    </template>
    <div class="rk-tabs">
      <button :class="['rk-tab', { on: tab === 'bia' }]" @click="go('bia')">تحليل أثر التوقف وخطط التعافي</button>
      <button :class="['rk-tab', { on: tab === 'teams' }]" @click="go('teams')">فرق الأزمات والطوارئ</button>
    </div>
    <section v-if="tab === 'bia'" class="card">
      <p v-if="bia && !bia.length" class="pm-empty">لم تُحلل الأنشطة بعد</p>
      <div v-else class="table-wrap"><table class="table">
        <thead><tr><th>الرمز</th><th>النشاط</th><th>الأهمية</th><th>أقصى توقف (MTPD)</th><th>الاستعادة (RTO)</th><th>فقد البيانات (RPO)</th><th>آخر اختبار</th><th>الاعتماد</th></tr></thead>
        <tbody><tr v-for="b in bia" :key="b.id" class="rk-row" @click="router.push(`/risk/continuity/${b.id}`)">
          <td class="rk-code">{{ b.code }}</td><td style="white-space: normal"><b>{{ b.activity }}</b><span class="pm-muted">{{ b.unitName ?? '' }} {{ b.ownerName ? `· ${b.ownerName}` : '' }}</span></td>
          <td><span class="pm-pill" :style="{ '--c': CRIT[b.criticality.value] }">{{ b.criticality.name }}</span></td>
          <td>{{ hours(b.mtpdHours) }}</td><td><b>{{ hours(b.rtoHours) }}</b></td><td>{{ hours(b.rpoHours) }}</td>
          <td :style="{ color: b.testOverdue ? 'var(--danger)' : '' }">{{ fmtDate(b.lastTestDate) }}</td>
          <td><span class="pm-pill" :style="{ '--c': WF_STATUS[b.status].color }">{{ WF_STATUS[b.status].label }}</span></td>
        </tr></tbody>
      </table></div>
    </section>
    <div v-else class="rk-grid3">
      <p v-if="teams && !teams.length" class="pm-empty wide card">لم تُشكل فرق أزمات بعد</p>
      <RouterLink v-for="(t, i) in teams" :key="t.id" :to="`/risk/crisis/${t.id}`" class="card pm-panel" :style="{ '--i': i, borderColor: t.activeEvent ? '#ef4444' : '' }">
        <h2><span><span class="rk-code">{{ t.code }}</span> {{ t.name }}</span><span class="pm-pill" :style="{ '--c': WF_STATUS[t.status].color }">{{ WF_STATUS[t.status].label }}</span></h2>
        <p class="pm-muted">{{ TEAM_KINDS[t.kind] }} · {{ t.members.length }} أعضاء · {{ t.authorities.length }} صلاحية · {{ t.systemPermissions.length }} صلاحية نظام</p>
        <div class="rk-chips" style="margin-top: 8px"><span v-for="m in t.members.slice(0, 4)" :key="m.name" class="rk-chip">{{ m.name }} <span class="pm-muted">{{ m.teamRole }}</span></span></div>
        <p v-if="t.activeEvent" style="color: var(--danger); font-weight: 700; margin: 10px 0 0">● مفعّل الآن</p>
      </RouterLink>
    </div>
  </div>
</template>
