
<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import TaskTable from '../components/TaskTable.vue';
import { loadLookups, P, TASK_STATUS, type Lookups } from '../lib';
import '../../../shared/module.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const rows = ref<any[]>([]);
const lk = ref<Lookups | null>(null);
const f = reactive({ mine: '', status: 'open', unitId: '' });
async function load() {
  rows.value = await api<any[]>(`/risk/tasks?${new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][])}`);
}
onMounted(async () => { lk.value = await loadLookups(); await load(); });
watch(f, load);
const overdue = computed(() => rows.value.filter((t) => t.overdue).length);
</script>

<template>
  <div>
    <div class="page-head"><div><h1>مهام المتابعة</h1><p class="muted">المهام الفرعية المزمنة الناتجة عن التغييرات وحالات الأزمات، موزعة على جهات الهيكل التنظيمي. {{ overdue ? `${overdue} مهمة متأخرة.` : '' }}</p></div></div>
    <div class="pm-filters">
      <div class="rk-tabs" style="margin: 0"><button :class="['rk-tab', { on: !f.mine }]" @click="f.mine = ''">كل المهام</button><button :class="['rk-tab', { on: f.mine === '1' }]" @click="f.mine = '1'">مهامي</button></div>
      <select v-model="f.status" class="input"><option value="open">المفتوحة</option><option value="">كل الحالات</option><option v-for="(s, k) in TASK_STATUS" :key="k" :value="k">{{ s.label }}</option></select>
      <select v-model="f.unitId" class="input"><option value="">كل الجهات</option><option v-for="u in lk?.units" :key="u.id" :value="u.id">{{ '— '.repeat(u.level) }}{{ u.name }}</option></select>
    </div>
    <section class="card pm-panel">
      <TaskTable :tasks="rows" :can-manage="session.can(P.change)" :lookups="lk" show-source @changed="load" />
    </section>
  </div>
</template>
