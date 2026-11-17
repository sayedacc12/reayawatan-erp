
<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { CHANGE_CLASSES, fmtDate, loadConfig, P, PHASES, PRIORITIES, WF_STATUS, type RiskConfig } from '../lib';
import '../../projects/projects.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const router = useRouter();
const rows = ref<any[] | null>(null);
const cfg = ref<RiskConfig | null>(null);
const f = reactive({ status: '', phase: '' });
async function load() {
  rows.value = await api<any[]>(`/risk/changes?${new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][])}`);
}
onMounted(async () => { cfg.value = (await loadConfig()).config; await load(); });
watch(f, load);
const typeName = (c: string) => cfg.value?.changeTypes.find((t) => t.code === c)?.name ?? c;
</script>

<template>
  <div>
    <section class="pm-hero rk-hero">
      <div><p class="pm-kicker">إدارة التغيير</p><h1>سجل التغيير</h1>
        <p class="pm-sub">كل تغيير يُرصد يُسجل هنا بمبرره وتقييم أثره ومخاطره، ويمر بمراحل الاعتماد، ثم يُتابع تنفيذه بمهام فرعية مزمنة مسندة لجهات الهيكل حتى المراجعة والإغلاق.</p></div>
      <div class="pm-actions">
        <RouterLink v-if="session.can(P.change)" to="/risk/changes/new" class="btn rk-glow">رصد تغيير جديد</RouterLink>
        <RouterLink to="/risk/tasks" class="btn rk-ghost">مهام المتابعة</RouterLink>
      </div>
    </section>
    <div class="pm-filters">
      <select v-model="f.status" class="input"><option value="">كل حالات الاعتماد</option><option v-for="(s, k) in WF_STATUS" :key="k" :value="k">{{ s.label }}</option></select>
      <select v-model="f.phase" class="input"><option value="">كل مراحل التنفيذ</option><option v-for="(s, k) in PHASES" :key="k" :value="k">{{ s.label }}</option></select>
    </div>
    <section class="card">
      <p v-if="rows && !rows.length" class="pm-empty">لا توجد طلبات تغيير</p>
      <div v-else class="table-wrap"><table class="table">
        <thead><tr><th>الرمز</th><th>التغيير</th><th>النوع</th><th>الأولوية</th><th>الاعتماد</th><th>التنفيذ</th><th>المهام</th><th>مقدم الطلب</th></tr></thead>
        <tbody><tr v-for="c in rows" :key="c.id" class="rk-row" @click="router.push(`/risk/changes/${c.id}`)">
          <td class="rk-code">{{ c.code }}</td>
          <td style="white-space: normal; min-width: 200px"><b>{{ c.title }}</b><span class="pm-muted">{{ CHANGE_CLASSES[c.changeClass].label }}{{ c.affectedUnits ? ` · ${c.affectedUnits}` : '' }}</span></td>
          <td>{{ typeName(c.changeType) }}</td>
          <td><span class="pm-pill" :style="{ '--c': PRIORITIES[c.priority].color }">{{ PRIORITIES[c.priority].label }}</span></td>
          <td><span class="pm-pill" :style="{ '--c': WF_STATUS[c.status].color }">{{ WF_STATUS[c.status].label }}</span><span v-if="c.stageName" class="pm-muted">{{ c.stageName }}</span></td>
          <td><span class="pm-pill" :style="{ '--c': PHASES[c.phase].color }">{{ PHASES[c.phase].label }}</span></td>
          <td style="min-width: 120px">{{ c.tasksDone }} / {{ c.tasksTotal }}<span v-if="c.tasksOverdue" class="pm-muted" style="color: var(--danger)">{{ c.tasksOverdue }} متأخرة</span>
            <div v-if="c.tasksTotal" class="pm-bar" style="margin-top: 4px"><i :style="{ width: c.progress + '%', background: '#0ea5e9' }" /></div></td>
          <td>{{ c.requestedBy }}<span class="pm-muted">{{ fmtDate(c.createdAt) }}</span></td>
        </tr></tbody>
      </table></div>
    </section>
  </div>
</template>
