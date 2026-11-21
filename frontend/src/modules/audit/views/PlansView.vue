<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import PlanForm from '../components/PlanForm.vue';
import { P, STATUS_COLOR, fmtDate, thisYear, type Plan } from '../lib';
import '../../../shared/module.css';
import '../audit.css';

type Master = Plan & { subs: Plan[]; overall: { total: number; done: number; progress: number; hours: number } };
const session = useSession();
const route = useRoute();
const router = useRouter();
const year = ref(thisYear());
const data = ref<Master[]>([]);
const error = ref('');
const showForm = ref(false);
const formKind = ref<'master' | 'sub'>('master');
const formParent = ref<string | undefined>();
async function load() {
  try {
    data.value = await api<Master[]>(`/audit/plans?year=${year.value}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await load();
  if (route.query.new && session.can(P.plans)) open('master');
});
watch(year, load);
function open(kind: 'master' | 'sub', parentId?: string) {
  formKind.value = kind;
  formParent.value = parentId;
  showForm.value = true;
}
</script>

<template>
  <div>
    <section class="pm-hero au-hero">
      <div><p class="pm-kicker">التخطيط</p><h1>خطط المراجعة {{ year }}</h1>
        <p class="pm-sub">خطة رئيسية سنوية تعتمدها لجنة المراجعة، وتحتها خطط فرعية لإدارات الهيكل التنظيمي أو لجهات خارجه (الشركاء والفروع والموردين)، وكلها مرتبطة بالمخاطر.</p></div>
      <div class="pm-actions">
        <select v-model.number="year" class="input" style="width: auto"><option v-for="y in [thisYear() - 1, thisYear(), thisYear() + 1]" :key="y" :value="y">{{ y }}</option></select>
        <button v-if="session.can(P.plans) && !data.length" class="btn au-glow" @click="open('master')">خطة رئيسية</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <p v-if="!data.length && !error" class="card pm-panel pm-empty">لا توجد خطة مراجعة لهذه السنة بعد</p>
    <section v-for="m in data" :key="m.id" class="card au-plan">
      <div style="display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: flex-start">
        <div style="cursor: pointer" @click="router.push(`/audit/plans/${m.id}`)">
          <span class="au-code">{{ m.code }}</span>
          <h2 style="margin: 2px 0">{{ m.title }}</h2>
          <span class="pm-muted">{{ fmtDate(m.periodFrom) }} ← {{ fmtDate(m.periodTo) }} · {{ m.availableHours }} ساعة متاحة<template v-if="m.approvedByName"> · اعتمدها {{ m.approvedByName }}</template></span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center">
          <span class="pm-pill" :style="{ '--c': STATUS_COLOR[m.status] }">{{ m.statusLabel }}</span>
          <RouterLink :to="`/audit/plans/${m.id}`" class="btn btn-sm">فتح</RouterLink>
          <button v-if="session.can(P.plans) && m.status !== 'closed'" class="btn btn-sm btn-primary" @click="open('sub', m.id)">+ خطة فرعية</button>
        </div>
      </div>
      <div style="display: flex; gap: 18px; align-items: center; margin-top: 14px; flex-wrap: wrap">
        <div class="au-ring" :style="{ '--v': m.overall.progress, '--c': '#6366f1', width: '96px', height: '96px' }"><b>{{ m.overall.progress }}%</b></div>
        <dl class="pm-dl" style="flex: 1">
          <div><dt>المهام في الخطة كلها</dt><dd>{{ m.overall.total }}</dd></div>
          <div><dt>صدرت تقاريرها</dt><dd>{{ m.overall.done }}</dd></div>
          <div><dt>الساعات المقدرة</dt><dd>{{ m.overall.hours }}</dd></div>
          <div><dt>الخطط الفرعية</dt><dd>{{ m.subs.length }}</dd></div>
        </dl>
      </div>
      <div class="subs">
        <div v-for="s in m.subs" :key="s.id" class="au-sub" @click="router.push(`/audit/plans/${s.id}`)">
          <div style="display: flex; justify-content: space-between; gap: 6px"><span class="au-code">{{ s.code }}</span><span class="pm-pill" :style="{ '--c': STATUS_COLOR[s.status] }">{{ s.statusLabel }}</span></div>
          <b style="display: block; margin: 4px 0">{{ s.title }}</b>
          <span class="pm-muted">{{ s.scopeType === 'outside' ? 'خارج الهيكل: ' : '' }}{{ s.scopeLabel }}</span>
          <div class="au-track" style="margin-top: 8px"><i :style="{ width: s.stats.progress + '%' }" /></div>
          <span class="pm-muted">{{ s.stats.done }} من {{ s.stats.total }} مهمة · {{ s.stats.findings }} ملاحظة</span>
        </div>
      </div>
    </section>
    <PlanForm v-if="showForm" :masters="data.map((m) => ({ id: m.id, code: m.code, title: m.title, year: m.year, periodFrom: m.periodFrom, periodTo: m.periodTo }))" :kind="formKind" :parent-id="formParent" :year="year"
      @close="showForm = false" @saved="(id) => router.push(`/audit/plans/${id}`)" />
  </div>
</template>
