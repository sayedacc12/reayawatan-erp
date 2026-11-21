<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import CountUp from '../../../shared/CountUp.vue';
import { P, STATUS_COLOR, thisYear } from '../lib';
import '../../../shared/module.css';
import '../hr.css';

/** التطوير والتدريب: خطط التطوير، فجوة الجدارات، والصف الثاني (البدلاء) */
interface Plan {
  id: string; serial: number; year: number; kind: 'individual' | 'succession'; title: string; employeeId: string; employeeName: string; jobTitle: string; targetJobTitle: string | null;
  status: string; statusLabel: string; stageName: string | null; items: number; done: number; percent: number; cost: number; hours: number; closedGaps: number;
}
interface GapComp { competencyId: string; name: string; required: number; actual: number | null; gap: number | null }
interface GapRow {
  employeeId: string; employeeNo: number; fullName: string; jobTitle: string; unitName: string; evaluatedYear: number | null; competencies: GapComp[]; totalGap: number; withGap: number; unrated: number;
  plan: { id: string; serial: number; status: string; statusLabel: string } | null;
}
interface Cand { id: string; employeeId: string; fullName: string; jobTitle: string; readiness: 'now' | '1y' | '2y'; readinessLabel: string; note: string | null; plan: { id: string; serial: number; status: string; statusLabel: string; percent: number } | null }
interface SRow {
  jobId: string; code: string; title: string; unitName: string; headcount: number; holders: { id: string; fullName: string }[]; leader: boolean; backupJobId: string | null; backupJobTitle: string | null;
  backupHolders: { id: string; fullName: string }[]; candidates: Cand[]; status: 'none' | 'developing' | 'ready';
}
interface Succ { rows: SRow[]; totals: { jobs: number; none: number; ready: number; candidates: number; leadersWithout: number }; employees: { id: string; fullName: string; jobId: string; jobTitle: string }[] }

type Tab = 'plans' | 'gaps' | 'succession';
const session = useSession();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const pick = (): Tab => (['plans', 'gaps', 'succession'].includes(String(route.query.tab)) ? route.query.tab : 'plans') as Tab;
const tab = ref<Tab>(pick());
watch(() => route.query.tab, () => (tab.value = pick()));
function go(t: Tab) {
  router.replace({ query: t === 'plans' ? {} : { tab: t } });
}
const canManage = computed(() => session.can(P.development));

const year = ref(thisYear());
const plans = ref<Plan[]>([]);
const gaps = ref<{ rows: GapRow[]; topGaps: { competencyId: string; name: string; employees: number; totalGap: number }[] } | null>(null);
const succ = ref<Succ | null>(null);
async function loadPlans() {
  try {
    plans.value = await api<Plan[]>(`/hr/dev-plans?year=${year.value}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function loadGaps() {
  try {
    gaps.value = await api('/hr/development/gaps');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function loadSucc() {
  try {
    succ.value = await api<Succ>('/hr/succession');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(() => Promise.all([loadPlans(), loadGaps(), loadSucc()]));
watch(year, loadPlans);

const live = computed(() => plans.value.filter((p) => p.status !== 'cancelled'));
const kpi = computed(() => ({
  plans: live.value.length,
  pending: live.value.filter((p) => p.status === 'pending').length,
  progress: live.value.length ? Math.round(live.value.reduce((s, p) => s + p.percent, 0) / live.value.length) : 0,
  cost: live.value.reduce((s, p) => s + p.cost, 0),
  withGap: gaps.value?.rows.filter((r) => r.withGap > 0).length ?? 0,
  noPlan: gaps.value?.rows.filter((r) => r.withGap > 0 && !r.plan).length ?? 0,
}));

// إنشاء خطة
const nf = reactive({ show: false, employeeId: '', kind: 'individual' as 'individual' | 'succession', targetJobId: '', year: thisYear(), busy: false });
function openNew(employeeId = '', kind: 'individual' | 'succession' = 'individual', targetJobId = '') {
  Object.assign(nf, { show: true, employeeId, kind, targetJobId, year: year.value, busy: false });
}
const jobs = computed(() => succ.value?.rows.map((r) => ({ id: r.jobId, title: r.title })) ?? []);
async function create() {
  nf.busy = true;
  try {
    const r = await api<{ id: string }>('/hr/dev-plans', {
      method: 'POST', json: { employeeId: nf.employeeId, kind: nf.kind, targetJobId: nf.kind === 'succession' ? nf.targetJobId || null : null, year: Number(nf.year) },
    });
    router.push(`/hr/development/plans/${r.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    nf.busy = false;
  }
}

// فجوة الجدارات
const gq = ref('');
const onlyGap = ref(true);
const gapRows = computed(() =>
  (gaps.value?.rows ?? [])
    .filter((r) => !onlyGap.value || r.withGap > 0 || r.unrated > 0)
    .filter((r) => !gq.value || r.fullName.includes(gq.value) || r.jobTitle.includes(gq.value) || r.unitName.includes(gq.value)),
);
const maxTop = computed(() => Math.max(1, ...(gaps.value?.topGaps ?? []).map((g) => g.totalGap)));
const gapColor = (g: number | null) => (g === null ? '#94a3b8' : g === 0 ? '#10b981' : g === 1 ? '#f59e0b' : '#ef4444');

// الصف الثاني
const SUCC = { none: { l: 'بلا بديل', c: '#ef4444' }, developing: { l: 'بديل قيد الإعداد', c: '#f59e0b' }, ready: { l: 'بديل جاهز', c: '#10b981' } } as const;
const READY_COLOR = { now: '#10b981', '1y': '#0ea5e9', '2y': '#a78bfa' } as const;
const sFilter = ref<'all' | 'none' | 'leaders'>('all');
const sRows = computed(() => (succ.value?.rows ?? []).filter((r) => sFilter.value === 'all' || (sFilter.value === 'none' ? r.status === 'none' : r.leader)));
async function setBackup(r: SRow, v: string) {
  try {
    succ.value = await api<Succ>(`/hr/succession/jobs/${r.jobId}`, { method: 'PUT', json: { backupJobId: v || null } });
  } catch (e) {
    toast.error((e as Error).message);
    await loadSucc();
  }
}
const cf = reactive({ show: false, row: null as SRow | null, employeeId: '', readiness: '1y' as 'now' | '1y' | '2y', note: '' });
function openCand(r: SRow, c?: Cand) {
  Object.assign(cf, { show: true, row: r, employeeId: c?.employeeId ?? '', readiness: c?.readiness ?? '1y', note: c?.note ?? '' });
}
const candOptions = computed(() => (succ.value?.employees ?? []).filter((e) => e.jobId !== cf.row?.jobId));
async function saveCand() {
  if (!cf.row) return;
  try {
    succ.value = await api<Succ>(`/hr/succession/jobs/${cf.row.jobId}/candidates`, { method: 'POST', json: { employeeId: cf.employeeId, readiness: cf.readiness, note: cf.note.trim() || null } });
    cf.show = false;
    toast.success('حُفظ المرشح');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function removeCand(c: Cand) {
  if (!confirm(`إزالة ${c.fullName} من مرشحي هذه الوظيفة؟`)) return;
  try {
    succ.value = await api<Succ>(`/hr/succession/candidates/${c.id}`, { method: 'DELETE' });
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <section class="pm-hero hr-hero">
      <div>
        <p class="pm-kicker">الأداء والتطوير</p>
        <h1>التطوير والتدريب والصف الثاني</h1>
        <p class="pm-sub">تُبنى خطة كل موظف من الفجوة بين مستوى الجدارات المطلوب في وصفه الوظيفي والمستوى الفعلي في آخر تقييم أداء، بمستهدفات وأنشطة تمر بمراحل الاعتماد ثم تُتابع حتى الإغلاق. ولكل وظيفة وظيفة بديلة ومرشحون يُعدّون لها.</p>
      </div>
      <div v-if="canManage" class="pm-actions"><button class="btn hr-glow" @click="openNew()">+ خطة تطوير</button></div>
    </section>

    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #a78bfa; --i: 0"><span>خطط {{ year }}</span><strong><CountUp :value="kpi.plans" /></strong><small>{{ kpi.pending ? `${kpi.pending} قيد الاعتماد` : 'لا خطط معلقة' }}</small></div>
      <div class="pm-kpi" style="--a: #10b981; --i: 1"><span>متوسط الإنجاز</span><strong><CountUp :value="kpi.progress" />%</strong><small>من أنشطة الخطط</small></div>
      <div class="pm-kpi" style="--a: #f472b6; --i: 2"><span>موظفون لديهم فجوة</span><strong><CountUp :value="kpi.withGap" /></strong><small>{{ kpi.noPlan ? `${kpi.noPlan} منهم بلا خطة` : 'كلهم لهم خطط' }}</small></div>
      <div class="pm-kpi" :style="{ '--a': (succ?.totals.none ?? 0) ? '#ef4444' : '#10b981', '--i': 3 }"><span>وظائف بلا بديل</span><strong><CountUp :value="succ?.totals.none ?? 0" /></strong><small>من {{ succ?.totals.jobs ?? 0 }} وظيفة</small></div>
    </div>

    <div class="hr-tabs">
      <button :class="['hr-tab', { on: tab === 'plans' }]" @click="go('plans')">خطط التطوير</button>
      <button :class="['hr-tab', { on: tab === 'gaps' }]" @click="go('gaps')">فجوة الجدارات</button>
      <button :class="['hr-tab', { on: tab === 'succession' }]" @click="go('succession')">الصف الثاني <span v-if="succ?.totals.none" class="pm-tag" style="background: #ef4444; color: #fff">{{ succ.totals.none }}</span></button>
    </div>

    <!-- الخطط -->
    <section v-if="tab === 'plans'" class="card pm-panel">
      <div class="hr-toolbar">
        <label class="field" style="margin: 0; flex-direction: row; gap: 8px; align-items: center"><span>العام</span><input v-model.number="year" type="number" class="input" style="width: 100px" /></label>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>#</th><th>الخطة</th><th>الموظف</th><th>النوع</th><th>الحالة</th><th>الإنجاز</th><th>الأنشطة</th><th>التكلفة</th><th></th></tr></thead>
          <tbody>
            <tr v-for="p in plans" :key="p.id" :style="{ opacity: p.status === 'cancelled' ? 0.5 : 1 }">
              <td class="hr-num">{{ p.serial }}</td>
              <td><RouterLink :to="`/hr/development/plans/${p.id}`" class="pm-link"><b>{{ p.title }}</b></RouterLink></td>
              <td>{{ p.employeeName }}<span class="hr-mini">{{ p.jobTitle }}</span></td>
              <td>{{ p.kind === 'succession' ? 'صف ثانٍ' : 'فردية' }}<span v-if="p.targetJobTitle" class="hr-mini">لوظيفة: {{ p.targetJobTitle }}</span></td>
              <td>
                <span class="pm-tag" :style="{ background: `${STATUS_COLOR[p.status]}22`, color: STATUS_COLOR[p.status] }">{{ p.statusLabel }}</span>
                <span v-if="p.stageName" class="hr-mini">لدى: {{ p.stageName }}</span>
              </td>
              <td style="min-width: 120px">
                <div class="hr-range"><i :style="{ insetInlineStart: 0, width: `${p.percent}%` }" /></div>
                <span class="hr-mini">{{ p.percent }}%<template v-if="p.closedGaps"> · {{ p.closedGaps }} فجوة سُدّت</template></span>
              </td>
              <td class="hr-num">{{ p.done }} / {{ p.items }}</td>
              <td class="pm-money">{{ p.cost.toLocaleString('ar-SA') }}</td>
              <td><RouterLink :to="`/hr/development/plans/${p.id}`" class="btn btn-sm">فتح</RouterLink></td>
            </tr>
            <tr v-if="!plans.length"><td colspan="9" class="pm-empty">لا خطط تطوير لعام {{ year }}. ابدأ من تبويب «فجوة الجدارات» لترى من يحتاج خطة.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- فجوة الجدارات -->
    <div v-else-if="tab === 'gaps'" class="hr-grid">
      <section class="card pm-panel">
        <div class="hr-toolbar">
          <input v-model="gq" class="input grow" placeholder="بحث بالاسم أو الوظيفة أو الوحدة" />
          <label style="display: flex; gap: 6px; align-items: center"><input v-model="onlyGap" type="checkbox" /> من لديهم فجوة أو جدارات لم تُقيَّم</label>
        </div>
        <p class="pm-muted">المطلوب من الوصف الوظيفي، والفعلي من آخر بطاقة أداء مُقيَّمة. اللون الأحمر فجوة مستويين أو أكثر، والبرتقالي مستوى واحد، والرمادي جدارة لم تُقيَّم.</p>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>الموظف</th><th>الجدارات (الفعلي / المطلوب)</th><th>الفجوة</th><th>الخطة</th></tr></thead>
            <tbody>
              <tr v-for="r in gapRows" :key="r.employeeId">
                <td><b>{{ r.fullName }}</b><span class="hr-mini">{{ r.jobTitle }} · {{ r.unitName }}</span><span class="hr-mini">{{ r.evaluatedYear ? `تقييم ${r.evaluatedYear}` : 'لم يُقيَّم بعد' }}</span></td>
                <td>
                  <div class="hr-chips">
                    <span v-for="c in r.competencies" :key="c.competencyId" class="hr-chip" :style="{ borderColor: gapColor(c.gap), color: gapColor(c.gap) }" :title="c.gap === null ? 'لم تُقيَّم' : `فجوة ${c.gap}`">
                      {{ c.name }} <b class="hr-num">{{ c.actual ?? '؟' }}/{{ c.required }}</b>
                    </span>
                    <span v-if="!r.competencies.length" class="pm-muted">لا جدارات في الوصف الوظيفي</span>
                  </div>
                </td>
                <td class="hr-num"><b :style="{ color: r.totalGap ? '#ef4444' : '#10b981' }">{{ r.totalGap }}</b><span v-if="r.unrated" class="hr-mini">{{ r.unrated }} بلا تقييم</span></td>
                <td>
                  <RouterLink v-if="r.plan" :to="`/hr/development/plans/${r.plan.id}`" class="pm-tag" :style="{ background: `${STATUS_COLOR[r.plan.status]}22`, color: STATUS_COLOR[r.plan.status] }">#{{ r.plan.serial }} {{ r.plan.statusLabel }}</RouterLink>
                  <button v-else-if="canManage && (r.withGap || r.unrated)" class="btn btn-sm" @click="openNew(r.employeeId)">إعداد خطة</button>
                  <span v-else class="pm-muted">—</span>
                </td>
              </tr>
              <tr v-if="gaps && !gapRows.length"><td colspan="4" class="pm-empty">لا فجوات حاليًا.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="card pm-panel">
        <h2>الجدارات الأكثر احتياجًا</h2>
        <p class="pm-muted">مجموع الفجوات على مستوى الشركة، يفيد في تخطيط برامج تدريب جماعية.</p>
        <div class="hr-bars">
          <div v-for="g in gaps?.topGaps ?? []" :key="g.competencyId" class="r">
            <span>{{ g.name }}<span class="hr-mini">{{ g.employees }} موظف</span></span>
            <i :style="{ width: `${(g.totalGap / maxTop) * 100}%` }" />
            <b class="hr-num">{{ g.totalGap }}</b>
          </div>
          <p v-if="gaps && !gaps.topGaps.length" class="pm-muted">لا فجوات مسجلة.</p>
        </div>
      </section>
    </div>

    <!-- الصف الثاني -->
    <section v-else class="card pm-panel">
      <div class="pm-row-head">
        <div>
          <h2>الصف الثاني (البدلاء)</h2>
          <p class="pm-muted">لكل وظيفة وظيفة بديلة يتولى شاغلها المهام عند الغياب أو الشغور، ومرشحون يُعدّون لها بخطة تطوير. الوظيفة المعلَّمة بالأحمر ليس لها بديل: لا وظيفة بديلة مشغولة ولا مرشح.</p>
        </div>
        <div class="hr-chips">
          <button :class="['hr-tab', { on: sFilter === 'all' }]" @click="sFilter = 'all'">الكل</button>
          <button :class="['hr-tab', { on: sFilter === 'none' }]" @click="sFilter = 'none'">بلا بديل ({{ succ?.totals.none ?? 0 }})</button>
          <button :class="['hr-tab', { on: sFilter === 'leaders' }]" @click="sFilter = 'leaders'">الوظائف القيادية</button>
        </div>
      </div>
      <p v-if="succ?.totals.leadersWithout" class="alert alert-error">{{ succ.totals.leadersWithout }} من الوظائف القيادية بلا بديل. ابدأ بها.</p>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th></th><th>الوظيفة</th><th>شاغلها</th><th>الوظيفة البديلة</th><th>المرشحون وجاهزيتهم</th></tr></thead>
          <tbody>
            <tr v-for="r in sRows" :key="r.jobId" :style="r.status === 'none' ? { background: '#ef444410' } : undefined">
              <td><span class="pm-tag" :style="{ background: `${SUCC[r.status].c}22`, color: SUCC[r.status].c, whiteSpace: 'nowrap' }"><b :style="{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: SUCC[r.status].c, marginInlineEnd: '4px' }" />{{ SUCC[r.status].l }}</span></td>
              <td><b>{{ r.title }}</b><span class="hr-mini"><span class="hr-code">{{ r.code }}</span> · {{ r.unitName }}<template v-if="r.leader"> · قيادية</template></span></td>
              <td>{{ r.holders.map((h) => h.fullName).join('، ') || 'شاغرة' }}</td>
              <td style="min-width: 190px">
                <select v-if="canManage" class="input" :value="r.backupJobId ?? ''" @change="setBackup(r, ($event.target as HTMLSelectElement).value)">
                  <option value="">— لا يوجد —</option>
                  <option v-for="j in jobs.filter((x) => x.id !== r.jobId)" :key="j.id" :value="j.id">{{ j.title }}</option>
                </select>
                <span v-else>{{ r.backupJobTitle ?? '—' }}</span>
                <span v-if="r.backupJobId" class="hr-mini" :style="{ color: r.backupHolders.length ? undefined : '#ef4444' }">{{ r.backupHolders.length ? r.backupHolders.map((h) => h.fullName).join('، ') : 'الوظيفة البديلة شاغرة' }}</span>
              </td>
              <td>
                <div class="hr-chips">
                  <span v-for="c in r.candidates" :key="c.id" class="hr-chip" :style="{ borderColor: READY_COLOR[c.readiness] }">
                    <b>{{ c.fullName }}</b>
                    <span :style="{ color: READY_COLOR[c.readiness] }">{{ c.readinessLabel }}</span>
                    <RouterLink v-if="c.plan" :to="`/hr/development/plans/${c.plan.id}`" class="pm-link">خطة #{{ c.plan.serial }} · {{ c.plan.percent }}%</RouterLink>
                    <a v-else-if="canManage" href="#" class="pm-link" @click.prevent="openNew(c.employeeId, 'succession', r.jobId)">إعداد خطة</a>
                    <template v-if="canManage">
                      <a href="#" title="تعديل" @click.prevent="openCand(r, c)">✎</a>
                      <a href="#" title="إزالة" @click.prevent="removeCand(c)">✕</a>
                    </template>
                  </span>
                  <button v-if="canManage" class="btn btn-sm" @click="openCand(r)">+ مرشح</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="nf.show" class="modal-backdrop" @click.self="nf.show = false">
      <form class="card modal" style="max-width: 560px" @submit.prevent="create">
        <h2>خطة تطوير جديدة</h2>
        <p class="pm-muted">تُقترح الأنشطة تلقائيًا من فجوة الجدارات، ثم تعدّلها قبل الرفع للاعتماد.</p>
        <label class="field"><span>نوع الخطة</span>
          <select v-model="nf.kind" class="input"><option value="individual">فردية: سد فجوة جدارات وظيفته الحالية</option><option value="succession">صف ثانٍ: إعداده لتولي وظيفة أخرى</option></select>
        </label>
        <label class="field"><span>الموظف</span>
          <select v-model="nf.employeeId" class="input" required><option value="">—</option><option v-for="e in succ?.employees ?? []" :key="e.id" :value="e.id">{{ e.fullName }} · {{ e.jobTitle }}</option></select>
        </label>
        <label v-if="nf.kind === 'succession'" class="field"><span>الوظيفة التي يُعد لها</span>
          <select v-model="nf.targetJobId" class="input" required><option value="">—</option><option v-for="j in jobs" :key="j.id" :value="j.id">{{ j.title }}</option></select>
        </label>
        <label class="field"><span>العام</span><input v-model.number="nf.year" type="number" class="input" min="2000" max="2100" /></label>
        <div class="modal-actions">
          <button class="btn btn-primary" :disabled="nf.busy">{{ nf.busy ? 'جارٍ الإعداد…' : 'إنشاء الخطة' }}</button>
          <button type="button" class="btn" @click="nf.show = false">إلغاء</button>
        </div>
      </form>
    </div>

    <div v-if="cf.show && cf.row" class="modal-backdrop" @click.self="cf.show = false">
      <form class="card modal" style="max-width: 520px" @submit.prevent="saveCand">
        <h2>مرشح لوظيفة «{{ cf.row.title }}»</h2>
        <label class="field"><span>الموظف</span>
          <select v-model="cf.employeeId" class="input" required><option value="">—</option><option v-for="e in candOptions" :key="e.id" :value="e.id">{{ e.fullName }} · {{ e.jobTitle }}</option></select>
        </label>
        <label class="field"><span>الجاهزية</span>
          <select v-model="cf.readiness" class="input"><option value="now">جاهز الآن</option><option value="1y">جاهز خلال سنة</option><option value="2y">جاهز خلال سنتين</option></select>
        </label>
        <label class="field"><span>ملاحظة</span><input v-model="cf.note" class="input" placeholder="ما يحتاجه ليكون جاهزًا" /></label>
        <div class="modal-actions">
          <button class="btn btn-primary">حفظ</button>
          <button type="button" class="btn" @click="cf.show = false">إلغاء</button>
        </div>
      </form>
    </div>
  </div>
</template>
