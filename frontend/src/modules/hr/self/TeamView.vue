<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import ReqList from './ReqList.vue';
import { TODAY_COLOR, initials, loadTeam, team } from './team';

onMounted(loadTeam);
const tab = ref<'members' | 'requests'>('members');
const scope = ref<'all' | 'direct'>('all');
const q = ref('');
const members = computed(() => (team.data?.members ?? []).filter((m) => (scope.value === 'all' || m.direct) && (!q.value || `${m.fullName} ${m.jobTitle} ${m.employeeNo}`.includes(q.value.trim()))));
</script>

<template>
  <div>
    <div class="ess-head">
      <div>
        <p class="ess-kicker" style="color: var(--muted)">لوحة المدير</p>
        <h1>فريقي</h1>
      </div>
    </div>
    <div v-if="team.error" class="alert alert-error">{{ team.error }}</div>
    <div v-if="!team.data" class="ess-skeleton"><i /><i /></div>
    <section v-else class="card ess-card">
      <div class="pm-tabs">
        <button :class="['pm-tab', { on: tab === 'members' }]" @click="tab = 'members'">الموظفون <b>{{ team.data.members.length }}</b></button>
        <button :class="['pm-tab', { on: tab === 'requests' }]" @click="tab = 'requests'">طلبات الفريق <b>{{ team.data.requests.length }}</b></button>
      </div>
      <template v-if="tab === 'members'">
        <div class="hr-toolbar">
          <div class="ess-filters">
            <button :class="{ on: scope === 'all' }" @click="scope = 'all'">كل الفريق <b>{{ team.data.stats.team }}</b></button>
            <button :class="{ on: scope === 'direct' }" @click="scope = 'direct'">المباشرون <b>{{ team.data.stats.direct }}</b></button>
          </div>
          <span class="grow" />
          <input v-model="q" class="input" placeholder="بحث بالاسم أو الوظيفة" />
        </div>
        <div class="ess-team">
          <RouterLink v-for="(m, i) in members" :key="m.id" :to="`/me/team/${m.id}`" class="ess-member" :style="{ '--i': Math.min(i, 15), '--c': TODAY_COLOR[m.today.status] }">
            <span class="st" :title="m.today.label" />
            <div class="head"><span class="av">{{ initials(m.fullName) }}</span><div><b>{{ m.fullName }}</b><div class="pm-muted">{{ m.jobTitle }} · {{ m.unitName }}</div></div></div>
            <small class="pm-muted">{{ m.today.label }}</small>
            <small v-if="!m.direct && m.managerName" class="pm-muted">مديره المباشر: {{ m.managerName }}</small>
            <small v-if="m.pending" style="color: #b45309">{{ m.pending }} طلب قيد الاعتماد</small>
          </RouterLink>
        </div>
        <p v-if="!members.length" class="pm-empty">لا يوجد موظفون</p>
      </template>
      <ReqList v-else :rows="team.data.requests" show-employee />
    </section>
  </div>
</template>
