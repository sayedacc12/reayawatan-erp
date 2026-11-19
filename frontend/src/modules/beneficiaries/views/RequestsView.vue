<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import DynamicFields from '../components/DynamicFields.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { fmtDateTime, REQUEST_STATUSES } from '../labels';
import type { ActivityRow, BeneficiaryRow, Page, RequestDetail, RequestRow, WorkflowRow } from '../types';

const session = useSession();
const toast = useToast();
const route = useRoute();
const router = useRouter();

interface Board { byStatus: Record<string, number>; workflows: { id: string; name: string; stages: { id: string; name: string; count: number }[] }[] }
const board = ref<Board | null>(null);
const data = ref<Page<RequestRow> | null>(null);
const activities = ref<ActivityRow[]>([]);
const workflows = ref<WorkflowRow[]>([]);
const error = ref('');
const loading = ref(false);

const filter = reactive({
  status: (route.query.status as string) ?? 'open',
  stageId: '',
  projectId: (route.query.projectId as string) ?? '',
  search: '',
  mine: route.query.mine === 'true',
  page: 1,
});

async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams({ page: String(filter.page), pageSize: '25' });
    if (filter.status) q.set('status', filter.status);
    if (filter.stageId) q.set('stageId', filter.stageId);
    if (filter.projectId) q.set('projectId', filter.projectId);
    if (filter.search.trim()) q.set('search', filter.search.trim());
    if (filter.mine) q.set('mine', 'true');
    [data.value, board.value] = await Promise.all([
      api<Page<RequestRow>>(`/beneficiaries/requests?${q}`),
      api<Board>('/beneficiaries/requests/board'),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  await load();
  try {
    [activities.value, workflows.value] = await Promise.all([
      api<ActivityRow[]>('/beneficiaries/settings/activities'),
      api<WorkflowRow[]>('/beneficiaries/settings/workflows'),
    ]);
  } catch { /* الفلاتر اختيارية */ }
});

let t: ReturnType<typeof setTimeout> | undefined;
watch(() => filter.search, () => { clearTimeout(t); t = setTimeout(() => { filter.page = 1; load(); }, 300); });
watch(() => [filter.status, filter.projectId, filter.mine], () => { filter.page = 1; filter.stageId = ''; load(); });

function pickStage(id: string) {
  filter.stageId = filter.stageId === id ? '' : id;
  filter.status = filter.stageId ? '' : 'open';
  filter.page = 1;
  load();
}
const projects = computed(() => activities.value.filter((a) => a.level === 'project'));
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / 25)));
const statusTabs = computed(() => [
  { value: 'open', label: 'المفتوحة', count: (board.value?.byStatus.in_progress ?? 0) + (board.value?.byStatus.returned ?? 0) },
  ...REQUEST_STATUSES.map((s) => ({ value: s.value, label: s.label, count: board.value?.byStatus[s.value] ?? 0 })),
  { value: '', label: 'الكل', count: Object.values(board.value?.byStatus ?? {}).reduce((a, b) => a + b, 0) },
]);
const maxStage = computed(() => Math.max(1, ...(board.value?.workflows.flatMap((w) => w.stages.map((s) => s.count)) ?? [1])));

// ---------- طلب جديد نيابة عن مستفيد ----------
const creating = ref(false);
const createError = ref('');
const saving = ref(false);
const beneficiaryQuery = ref('');
const beneficiaryResults = ref<BeneficiaryRow[]>([]);
const picked = ref<BeneficiaryRow | null>(null);
const form = reactive({ projectId: '', description: '', applicationData: {} as Record<string, unknown> });

const appFields = computed(() => {
  const p = projects.value.find((x) => x.id === form.projectId);
  if (!p) return null;
  const wf = workflows.value.find((w) => w.id === p.workflowId) ?? workflows.value.find((w) => w.isDefault);
  return wf?.applicationFormFields ?? null;
});

let bt: ReturnType<typeof setTimeout> | undefined;
watch(beneficiaryQuery, (q) => {
  clearTimeout(bt);
  if (!q.trim()) { beneficiaryResults.value = []; return; }
  bt = setTimeout(async () => {
    beneficiaryResults.value = (await api<Page<BeneficiaryRow>>(`/beneficiaries?pageSize=6&search=${encodeURIComponent(q.trim())}`)).items;
  }, 250);
});

function openCreate() {
  Object.assign(form, { projectId: '', description: '', applicationData: {} });
  picked.value = null;
  beneficiaryQuery.value = '';
  createError.value = '';
  creating.value = true;
}

async function create() {
  if (!picked.value) { createError.value = 'اختر المستفيد'; return; }
  saving.value = true;
  createError.value = '';
  try {
    const r = await api<RequestDetail>('/beneficiaries/requests', { method: 'POST', json: { ...form, beneficiaryId: picked.value.id } });
    toast.success(`تم تسجيل الطلب رقم ${r.requestNo}`);
    router.push(`/beneficiaries/requests/${r.id}`);
  } catch (e) {
    createError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>طلبات المستفيدين</h1>
        <p class="muted sub">كل طلب يمر بمراحل سير العمل حتى الاعتماد النهائي</p>
      </div>
      <div class="head-actions">
        <label class="mine"><input v-model="filter.mine" type="checkbox" /> المطلوب مني فقط</label>
        <button v-if="session.can('beneficiaries.requests.create')" class="btn btn-primary" @click="openCreate">+ طلب جديد</button>
      </div>
    </div>

    <!-- مسار المراحل: عدد الطلبات في كل مرحلة -->
    <section v-for="w in board?.workflows ?? []" :key="w.id" class="pipeline card">
      <p class="pipe-title">{{ w.name }}</p>
      <div class="pipe">
        <button v-for="(s, i) in w.stages" :key="s.id" :class="['pipe-stage', { on: filter.stageId === s.id, empty: !s.count }]"
          :style="{ '--i': i, '--h': (s.count / maxStage) * 100 + '%' }" @click="pickStage(s.id)">
          <span class="pipe-count">{{ s.count.toLocaleString('ar-EG') }}</span>
          <span class="pipe-name">{{ s.name }}</span>
          <span class="pipe-fill" />
        </button>
        <div class="pipe-stage final">
          <span class="pipe-count">{{ (board?.byStatus.approved ?? 0).toLocaleString('ar-EG') }}</span>
          <span class="pipe-name">معتمد نهائيًا</span>
        </div>
      </div>
    </section>
    <div v-if="board && !board.workflows.length" class="alert alert-error">
      لم يتم إعداد سير عمل بعد.
      <RouterLink v-if="session.can('beneficiaries.settings.manage')" to="/beneficiaries/settings">افتح الإعدادات</RouterLink>
    </div>

    <div class="toolbar card">
      <div class="tabs-row">
        <button v-for="s in statusTabs" :key="s.value" :class="['chip', { on: filter.status === s.value && !filter.stageId }]" @click="filter.stageId = ''; filter.status = s.value">
          {{ s.label }} <b>{{ s.count.toLocaleString('ar-EG') }}</b>
        </button>
      </div>
      <div class="filters">
        <input v-model="filter.search" class="input" placeholder="بحث باسم المستفيد أو رقم الهوية أو رقم الطلب" />
        <select v-model="filter.projectId" class="input"><option value="">كل المشاريع</option><option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option></select>
      </div>
    </div>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="card table-wrap" :class="{ dim: loading }">
      <table class="table">
        <thead><tr><th>رقم الطلب</th><th>المستفيد</th><th>المشروع</th><th>المرحلة الحالية</th><th>الحالة</th><th>المصدر</th><th>آخر تحديث</th></tr></thead>
        <tbody>
          <tr v-for="r in data?.items ?? []" :key="r.id" class="clickable" tabindex="0" @click="router.push(`/beneficiaries/requests/${r.id}`)" @keydown.enter="router.push(`/beneficiaries/requests/${r.id}`)">
            <td><span class="no">#{{ r.requestNo }}</span></td>
            <td><b>{{ r.beneficiary.fullName }}</b> <small class="muted">ملف {{ r.beneficiary.fileNo }}</small> <span v-if="r.ruleDeviation" class="dev" title="قرار الباحث مختلف عن قاعدة التقييم">⚑ مخالف للقاعدة</span></td>
            <td>{{ r.project.name }}</td>
            <td><span v-if="r.stage" class="stage-pill">{{ r.stage.name }}</span><span v-else class="muted">—</span></td>
            <td><StatusBadge :value="r.status" kind="request" /></td>
            <td><span :class="['src', r.source]">{{ r.source === 'portal' ? 'البوابة' : 'الموظف' }}</span></td>
            <td class="muted">{{ fmtDateTime(r.updatedAt) }}</td>
          </tr>
          <tr v-if="data && !data.items.length"><td colspan="7" class="empty">لا توجد طلبات هنا</td></tr>
        </tbody>
      </table>
    </div>
    <div v-if="pages > 1" class="pager">
      <button class="btn btn-sm" :disabled="filter.page <= 1" @click="filter.page--; load()">السابق</button>
      <span class="muted">صفحة {{ filter.page }} من {{ pages }}</span>
      <button class="btn btn-sm" :disabled="filter.page >= pages" @click="filter.page++; load()">التالي</button>
    </div>

    <div v-if="creating" class="modal-backdrop" @click.self="creating = false">
      <form class="card modal modal-wide" @submit.prevent="create">
        <h2 class="mtitle">طلب جديد نيابة عن مستفيد</h2>
        <div v-if="createError" class="alert alert-error">{{ createError }}</div>
        <div class="field">
          <label>المستفيد *</label>
          <div v-if="picked" class="picked"><b>{{ picked.fullName }}</b> <span class="muted">ملف {{ picked.fileNo }}</span><button type="button" class="btn btn-sm" @click="picked = null">تغيير</button></div>
          <template v-else>
            <input v-model="beneficiaryQuery" class="input" placeholder="ابحث بالاسم أو رقم الهوية أو رقم الملف" autofocus />
            <div v-if="beneficiaryResults.length" class="results">
              <button v-for="b in beneficiaryResults" :key="b.id" type="button" @click="picked = b">{{ b.fullName }} <small class="muted">ملف {{ b.fileNo }}</small></button>
            </div>
          </template>
        </div>
        <div class="field">
          <label>المشروع *</label>
          <select v-model="form.projectId" class="input" required><option value="" disabled>اختر المشروع</option><option v-for="p in projects.filter((x) => x.isActive)" :key="p.id" :value="p.id">{{ p.name }}</option></select>
        </div>
        <DynamicFields v-if="appFields" v-model="form.applicationData" :fields="appFields" />
        <div class="field"><label>ملاحظات</label><textarea v-model="form.description" class="input" rows="2" /></div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="saving">تسجيل الطلب</button><button type="button" class="btn" @click="creating = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.sub { margin: 2px 0 0; font-size: .88rem; }
.head-actions { display: flex; gap: 12px; align-items: center; }
.mine { display: flex; align-items: center; gap: 6px; font-size: .9rem; cursor: pointer; }
.mine input { accent-color: var(--primary); width: 16px; height: 16px; }

.pipeline { padding: 14px 16px; margin-bottom: 14px; }
.pipe-title { margin: 0 0 10px; font-size: .82rem; color: var(--muted); font-weight: 600; }
.pipe { display: flex; gap: 8px; overflow-x: auto; }
.pipe-stage { position: relative; overflow: hidden; flex: 1; min-width: 120px; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface-2);
  font: inherit; cursor: pointer; text-align: right; display: flex; flex-direction: column; gap: 2px; transition: transform .2s, border-color .2s, box-shadow .2s;
  animation: rise .45s calc(var(--i, 0) * 70ms) var(--ease) both; clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%, 10px 50%); }
.pipe-stage:hover { transform: translateY(-2px); border-color: var(--primary); }
.pipe-stage.on { background: var(--primary-soft); border-color: var(--primary); box-shadow: 0 8px 20px rgba(20,184,166,.25); }
.pipe-count { font-size: 1.4rem; font-weight: 700; color: var(--primary); position: relative; z-index: 1; }
.pipe-stage.empty .pipe-count { color: var(--muted); }
.pipe-name { font-size: .82rem; position: relative; z-index: 1; padding-inline-start: 8px; }
.pipe-count { padding-inline-start: 8px; }
.pipe-fill { position: absolute; bottom: 0; inset-inline: 0; height: var(--h); background: linear-gradient(0deg, rgba(20,184,166,.18), transparent); transition: height .6s var(--ease); }
.pipe-stage.final { cursor: default; background: linear-gradient(135deg, #fff8e6, #fdecc8); border-color: #f5c66b; }
.pipe-stage.final .pipe-count { color: #b7791f; }

.toolbar { padding: 12px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 10px; }
.tabs-row { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { font: inherit; font-size: .84rem; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; transition: all .2s; }
.chip b { margin-inline-start: 4px; color: var(--muted); font-weight: 600; }
.chip.on { background: var(--primary-soft); border-color: var(--primary); color: var(--primary); font-weight: 600; }
.chip.on b { color: var(--primary); }
.filters { display: grid; grid-template-columns: 1fr 220px; gap: 10px; }
.clickable { cursor: pointer; }
.no { font-weight: 700; color: var(--primary); }
.stage-pill { font-size: .8rem; padding: 2px 10px; border-radius: 999px; background: #eef2ff; color: #4338ca; }
.dev { font-size: .72rem; font-weight: 700; padding: 1px 8px; border-radius: 99px; background: #f3e8ff; color: #7e22ce; border: 1px solid #d8b4fe; white-space: nowrap; }
.src { font-size: .78rem; padding: 1px 8px; border-radius: 6px; background: var(--surface-2); }
.src.portal { background: #fdf4ff; color: #a21caf; }
.dim { opacity: .55; transition: opacity .2s; }
.empty { text-align: center; color: var(--muted); padding: 30px !important; }
.pager { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 14px; }
.mtitle { margin-bottom: 14px; }
.picked { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid var(--primary); background: var(--primary-soft); border-radius: 8px; }
.picked .btn { margin-inline-start: auto; }
.results { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.results button { display: block; width: 100%; text-align: right; padding: 8px 12px; background: var(--surface); border: 0; border-bottom: 1px solid var(--border); font: inherit; cursor: pointer; }
.results button:hover { background: var(--primary-soft); }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } }
@media (max-width: 700px) { .filters { grid-template-columns: 1fr; } .head-actions { width: 100%; justify-content: space-between; } }
</style>
