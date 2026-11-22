<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import ActivityForm from '../components/ActivityForm.vue';
import ActivityTimeline from '../components/ActivityTimeline.vue';
import { ACTIVITY_ICON, CR, lookups } from '../lib';
import '../../../shared/module.css';
import '../crm.css';

/** أنشطتي وأنشطة الفريق: قائمة بالحالة، أو تقويم أسبوعي */
const session = useSession();
const toast = useToast();
const lk = ref<any>(null);
const rows = ref<any[]>([]);
const view = ref<'list' | 'week'>('list');
const f = ref({ status: 'open', owner: '', type: '' });
const weekStart = ref(startOfWeek(new Date()));
const adding = ref(false);
const selected = ref<any>(null);

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay()); // الأسبوع يبدأ الأحد
  return x;
}
const days = computed(() => Array.from({ length: 7 }, (_, i) => new Date(weekStart.value.getTime() + i * 86400_000)));
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const onDay = (d: Date) => rows.value.filter((a) => sameDay(new Date(a.dueAt ?? a.doneAt ?? a.createdAt), d));

async function load() {
  try {
    const q: Record<string, string> = { ...(f.value.owner ? { owner: f.value.owner } : {}), ...(f.value.type ? { type: f.value.type } : {}) };
    if (view.value === 'week') {
      q.from = weekStart.value.toISOString();
      q.to = new Date(weekStart.value.getTime() + 7 * 86400_000).toISOString();
    } else if (f.value.status) q.status = f.value.status;
    rows.value = await api(`/crm/activities?${new URLSearchParams(q)}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(async () => {
  lk.value = await lookups().catch(() => null);
  await load();
});
watch(() => [f.value.status, f.value.owner, f.value.type, view.value, weekStart.value], load);
const shift = (n: number) => (weekStart.value = new Date(weekStart.value.getTime() + n * 7 * 86400_000));
const COLORS: Record<string, string> = { call: '#0891b2', meeting: '#7c3aed', whatsapp: '#16a34a', email: '#0369a1', task: '#d97706', note: '#64748b' };
const late = (a: any) => !a.doneAt && a.dueAt && new Date(a.dueAt) < new Date();
const dayName = (d: Date) => d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long' });
const dayNum = (d: Date) => d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' });
const time = (s: string) => new Date(s).toLocaleTimeString('ar-SA-u-ca-gregory-nu-latn', { hour: 'numeric', minute: '2-digit' });
</script>

<template>
  <div v-if="lk">
    <div class="page-head">
      <div>
        <h1>الأنشطة والتقويم</h1>
        <p class="muted">المكالمات والزيارات والرسائل والمهام مع الجهات والعملاء المحتملين. المتأخر يظهر بالأحمر وفي جرس المهام حتى يُنجز.</p>
      </div>
      <button v-if="session.can(CR.manage)" class="btn btn-primary" @click="adding = true">نشاط جديد</button>
    </div>
    <div class="cr-toolbar">
      <div class="cr-chips">
        <button :class="['cr-chip', { on: view === 'list' }]" style="--c: #0891b2" @click="view = 'list'">قائمة</button>
        <button :class="['cr-chip', { on: view === 'week' }]" style="--c: #0891b2" @click="view = 'week'">أسبوع</button>
      </div>
      <select v-if="view === 'list'" v-model="f.status" class="input">
        <option value="open">المفتوحة</option><option value="today">اليوم والمتأخرة</option><option value="overdue">المتأخرة</option><option value="done">المنجزة</option>
      </select>
      <template v-else>
        <button class="btn btn-sm" @click="shift(-1)">→ السابق</button>
        <button class="btn btn-sm" @click="weekStart = startOfWeek(new Date())">هذا الأسبوع</button>
        <button class="btn btn-sm" @click="shift(1)">التالي ←</button>
      </template>
      <select v-model="f.type" class="input"><option value="">كل الأنواع</option><option v-for="(l, k) in lk.labels.activityTypes" :key="k" :value="k">{{ l }}</option></select>
      <select v-if="lk.can.all" v-model="f.owner" class="input"><option value="">كل الفريق</option><option v-for="u in lk.users" :key="u.id" :value="u.id">{{ u.fullName }}</option></select>
    </div>
    <section v-if="view === 'list'" class="card pm-panel">
      <ActivityTimeline :items="rows" :lk="lk" :can-manage="session.can(CR.manage)" show-target @changed="load" />
    </section>
    <div v-else class="cr-week">
      <div v-for="d in days" :key="d.toISOString()" :class="['cr-day', { today: sameDay(d, new Date()) }]">
        <h4><span>{{ dayName(d) }}</span><span>{{ dayNum(d) }}</span></h4>
        <span v-for="a in onDay(d)" :key="a.id" :class="['cr-ev', { done: a.doneAt, late: late(a) }]" :style="{ '--c': COLORS[a.type] }" @click="selected = a">
          {{ ACTIVITY_ICON[a.type] }} {{ a.dueAt ? time(a.dueAt) : '' }} {{ a.subject }}
          <small v-if="a.partyName || a.leadName" style="display: block; opacity: .75">{{ a.partyName ?? a.leadName }}</small>
        </span>
      </div>
    </div>
    <div v-if="selected" class="modal-backdrop" @click.self="selected = null">
      <div class="card modal cr-modal">
        <ActivityTimeline :items="[selected]" :lk="lk" :can-manage="session.can(CR.manage)" show-target @changed="selected = null; load()" />
        <div class="modal-actions"><button class="btn" @click="selected = null">إغلاق</button></div>
      </div>
    </div>
    <ActivityForm v-if="adding" :lk="lk" @close="adding = false" @saved="adding = false; load()" />
  </div>
</template>
