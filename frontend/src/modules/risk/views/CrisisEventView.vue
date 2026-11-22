
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import TaskTable from '../components/TaskTable.vue';
import { fmtDateTime, loadLookups, P, SEVERITY, type Lookups } from '../lib';
import '../../../shared/module.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const e = ref<any>(null);
const lk = ref<Lookups | null>(null);
const logText = ref('');
const close = reactive({ show: false, lessons: '' });
async function load() { e.value = await api(`/risk/crisis-events/${props.id}`); }
onMounted(async () => { lk.value = await loadLookups(); await load(); });
async function addLog() {
  try {
    e.value = await api(`/risk/crisis-events/${props.id}/log`, { method: 'POST', json: { text: logText.value } });
    logText.value = '';
  } catch (err) {
    toast.error((err as Error).message);
  }
}
async function doClose() {
  try {
    e.value = await api(`/risk/crisis-events/${props.id}/close`, { method: 'POST', json: { lessons: close.lessons } });
    close.show = false;
    toast.success('أُعلن انتهاء الأزمة وسُحبت صلاحيات الطوارئ');
  } catch (err) {
    toast.error((err as Error).message);
  }
}
</script>

<template>
  <div v-if="e">
    <div v-if="!e.closedAt" class="rk-alarm">
      <span><span class="siren" /><b>{{ e.code }} · {{ e.title }}</b> — مفعّلة منذ {{ fmtDateTime(e.activatedAt) }} بقرار {{ e.activatedByName }}</span>
      <button v-if="session.can(P.activateCrisis)" class="btn btn-sm rk-ghost" @click="close.show = true">إعلان انتهاء الأزمة</button>
    </div>
    <div class="page-head">
      <div><h1>غرفة الأزمة: {{ e.title }}</h1>
        <p class="muted"><RouterLink :to="`/risk/crisis/${e.team.id}`" class="pm-link">{{ e.team.name }}</RouterLink> · <span class="pm-pill" :style="{ '--c': SEVERITY[e.severity].color }">{{ SEVERITY[e.severity].label }}</span>
          <template v-if="e.closedAt"> · انتهت {{ fmtDateTime(e.closedAt) }} ({{ e.closedByName }})</template></p></div>
    </div>
    <div class="rk-grid">
      <div style="display: grid; gap: 16px; align-content: start">
        <section v-if="e.scenario" class="card pm-panel"><h2>السيناريو</h2><p class="rk-pre">{{ e.scenario }}</p></section>
        <section class="card pm-panel">
          <h2>مهام الاستجابة</h2>
          <TaskTable :tasks="e.tasks" :add-path="e.closedAt ? undefined : `/risk/crisis-events/${e.id}/tasks`" :can-manage="session.can(P.activateCrisis)" :lookups="lk" @changed="load" />
        </section>
        <section class="card pm-panel">
          <h2>لائحة الصلاحيات السارية</h2>
          <table class="table"><thead><tr><th>الصلاحية</th><th>صاحبها</th><th>الحد</th></tr></thead>
            <tbody><tr v-for="(a, i) in e.team.authorities" :key="i"><td style="white-space: normal">{{ a.authority }}</td><td>{{ a.holder }}</td><td>{{ a.limit ?? '—' }}</td></tr></tbody></table>
        </section>
        <section v-if="e.lessons" class="card pm-panel"><h2>الدروس المستفادة</h2><p class="rk-pre">{{ e.lessons }}</p></section>
      </div>
      <section class="card pm-panel">
        <h2>سجل الأحداث</h2>
        <form v-if="!e.closedAt" style="display: flex; gap: 6px; margin-bottom: 12px" @submit.prevent="addLog">
          <input v-model="logText" class="input" placeholder="ماذا حدث؟ ما القرار المتخذ؟" /><button class="btn btn-primary">تسجيل</button>
        </form>
        <ul class="rk-log">
          <li v-for="(l, i) in [...e.log].reverse()" :key="i"><b>{{ fmtDateTime(l.at) }}</b><span>{{ l.text }}<span class="pm-muted"> — {{ l.byName }}</span></span></li>
        </ul>
        <div class="rk-sec">الأعضاء</div>
        <div class="rk-chips"><span v-for="m in e.team.members" :key="m.name" class="rk-chip">{{ m.name }} <span class="pm-muted">{{ m.teamRole }} {{ m.phone ?? '' }}</span></span></div>
      </section>
    </div>
    <div v-if="close.show" class="modal-backdrop" @click.self="close.show = false">
      <form class="card modal" @submit.prevent="doClose">
        <h2>إعلان انتهاء الأزمة</h2>
        <p class="pm-muted">تُسحب صلاحيات الطوارئ من الأعضاء فورًا (ولا تتأثر أدوارهم الأصلية).</p>
        <label class="field"><span>الدروس المستفادة</span><textarea v-model="close.lessons" class="input" rows="4" /></label>
        <div class="modal-actions"><button class="btn btn-primary">إنهاء الأزمة</button><button type="button" class="btn" @click="close.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
