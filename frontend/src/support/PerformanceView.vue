<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import '../modules/platform/platform.css';
import ScoreRing from './ScoreRing.vue';
import { ROLE, scoreTone, type MemberScore } from './support';

/** تقييم أداء فريق الدعم بناءً على ساعات الاستجابة والحل وإنجاز المهام وتقييم الجمعيات */
interface Perf { from: string; to: string; weights: Record<string, number>; members: MemberScore[] }
const p = ref<Perf | null>(null);
const error = ref('');
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const from = ref(iso(new Date(today.getFullYear(), today.getMonth(), 1)));
const to = ref(iso(today));

async function load() {
  error.value = '';
  try { p.value = await api<Perf>(`/support-desk/performance?from=${from.value}&to=${to.value}`); } catch (e) { error.value = (e as Error).message; }
}
onMounted(load);
function preset(kind: 'month' | 'last' | 'quarter') {
  const d = new Date();
  if (kind === 'month') { from.value = iso(new Date(d.getFullYear(), d.getMonth(), 1)); to.value = iso(d); }
  if (kind === 'last') { from.value = iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)); to.value = iso(new Date(d.getFullYear(), d.getMonth(), 0)); }
  if (kind === 'quarter') { from.value = iso(new Date(d.getFullYear(), d.getMonth() - 2, 1)); to.value = iso(d); }
  load();
}
const team = computed(() => {
  const ms = (p.value?.members ?? []).filter((m) => m.score !== null);
  return ms.length ? Math.round(ms.reduce((s, m) => s + m.score!, 0) / ms.length) : null;
});
const pctCell = (n: number | null) => (n === null ? '—' : `${n}%`);
</script>

<template>
  <div>
    <section class="p-hero hero">
      <div>
        <p class="p-kicker">الدعم الفني</p>
        <h1>تقييم أداء الفريق</h1>
        <p class="p-sub">درجة من 100 لكل عضو: الالتزام بمهلة الرد {{ p?.weights.response ?? 30 }}%، والالتزام بمهلة الحل {{ p?.weights.resolution ?? 30 }}%، وإنجاز المهام في موعدها {{ p?.weights.tasks ?? 20 }}%، وتقييم الجمعيات {{ p?.weights.rating ?? 20 }}%. الجزء الذي لا بيانات له في الفترة لا يُحسب ويُوزَّع وزنه على الباقي.</p>
      </div>
      <div class="team-score"><ScoreRing :value="team" :size="100" label="متوسط الفريق" /></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="p-filters period">
      <button class="p-chip" @click="preset('month')">هذا الشهر</button>
      <button class="p-chip" @click="preset('last')">الشهر الماضي</button>
      <button class="p-chip" @click="preset('quarter')">آخر 3 أشهر</button>
      <label>من <input v-model="from" class="input" type="date" @change="load" /></label>
      <label>إلى <input v-model="to" class="input" type="date" @change="load" /></label>
    </div>

    <div v-if="p" class="cards">
      <article v-for="(m, i) in p.members" :key="m.id" class="card mcard" :style="{ '--i': i }">
        <header>
          <span class="rank">{{ i + 1 }}</span>
          <div class="who"><b>{{ m.fullName }}</b><small class="muted">{{ ROLE[m.role] }}</small></div>
          <ScoreRing :value="m.score" :size="78" />
        </header>
        <p :class="['grade', `tone tone-${scoreTone(m.score)}`]">{{ m.grade }}</p>
        <dl>
          <dt>الالتزام بمهلة الرد</dt><dd><span :class="['tone', `tone-${scoreTone(m.responseCompliance)}`]">{{ pctCell(m.responseCompliance) }}</span><small>{{ m.responses }} رد · متوسط {{ m.avgResponseHours ?? '—' }} س</small></dd>
          <dt>الالتزام بمهلة الحل</dt><dd><span :class="['tone', `tone-${scoreTone(m.resolutionCompliance)}`]">{{ pctCell(m.resolutionCompliance) }}</span><small>{{ m.resolved }} طلب · متوسط {{ m.avgResolutionHours ?? '—' }} س</small></dd>
          <dt>المهام في موعدها</dt><dd><span :class="['tone', `tone-${scoreTone(m.taskCompliance)}`]">{{ pctCell(m.taskCompliance) }}</span><small>{{ m.tasksOnTime }}/{{ m.tasksDone }} منجزة · {{ m.tasksOverdue }} متأخرة</small></dd>
          <dt>تقييم الجمعيات</dt><dd><b class="gold">{{ m.avgRating ? '★ ' + m.avgRating : '—' }}</b><small>{{ m.ratings }} تقييم</small></dd>
          <dt>ساعات العمل</dt><dd><b>{{ m.hoursLogged }}</b><small>ساعة مسجلة على المهام</small></dd>
        </dl>
      </article>
      <p v-if="!p.members.length" class="muted">لا يوجد أعضاء في الفريق.</p>
    </div>
  </div>
</template>

<style scoped>
.hero { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
.team-score :deep(.c small) { color: rgba(255,255,255,.65); }
.period { align-items: center; }
.period label { display: flex; align-items: center; gap: 6px; font-size: .9rem; }
.period .input { width: auto; padding-block: 4px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
.mcard { padding: 16px 18px; animation: p-rise .5s var(--ease) both; animation-delay: calc(var(--i) * 70ms); }
.mcard header { display: flex; align-items: center; gap: 12px; }
.rank { width: 30px; height: 30px; border-radius: 50%; background: var(--grad); color: #fff; display: grid; place-items: center; font-weight: 700; flex: none; }
.who { flex: 1; display: flex; flex-direction: column; }
.grade { margin: 8px 0 10px; display: inline-flex; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 8px 12px; margin: 0; font-size: .9rem; }
dt { color: var(--muted); }
dd { margin: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
dd small { color: var(--muted); font-size: .78rem; }
.gold { color: #d69e2e; }
</style>
