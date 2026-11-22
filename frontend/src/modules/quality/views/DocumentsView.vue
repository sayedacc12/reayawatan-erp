<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { DOC_TYPES, ISO_CLAUSES, P, STATUS_COLOR, errMsg, fmtDate, loadSettings, type DocRow, type QSettings } from '../lib';
import '../../../shared/module.css';
import '../quality.css';

const props = defineProps<{ procedures?: boolean }>();
const session = useSession();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const rows = ref<DocRow[]>([]);
const counts = ref({ total: 0, approved: 0, pending: 0, due: 0, obsolete: 0, external: 0 });
const settings = ref<QSettings | null>(null);
const f = reactive({ type: props.procedures ? 'procedure' : '', status: String(route.query.status ?? 'active'), department: '', search: '', source: '' });
const error = ref('');

async function load() {
  try {
    const q = new URLSearchParams();
    if (f.type) q.set('type', f.type);
    if (f.status && f.status !== 'all') q.set('status', f.status === 'review' ? '' : f.status);
    if (f.department) q.set('department', f.department);
    if (f.search) q.set('search', f.search);
    const r = await api<{ rows: DocRow[]; counts: typeof counts.value }>(`/quality/documents?${q}`);
    rows.value = f.status === 'review' ? r.rows.filter((x) => x.status === 'review' || x.status === 'approval') : r.rows;
    counts.value = r.counts;
  } catch (e) {
    error.value = errMsg(e);
  }
}
onMounted(async () => {
  settings.value = await loadSettings();
  await load();
});
let t: ReturnType<typeof setTimeout>;
watch(() => [f.type, f.status, f.department], load);
watch(() => f.search, () => { clearTimeout(t); t = setTimeout(load, 300); });
const shown = computed(() => rows.value.filter((r) => !f.source || (f.source === 'quality' ? r.source === 'quality' : r.source !== 'quality')));

const form = reactive({ show: route.query.new === '1', title: '', docType: props.procedures ? 'procedure' : 'procedure', department: 'QMS', code: '', ownerName: '', isoClauses: [] as string[] });
const suggested = ref('');
watch(() => [form.docType, form.department, form.show], async () => {
  if (!form.show || !session.can(P.documents)) return;
  suggested.value = (await api<{ code: string }>(`/quality/codes/next?type=${form.docType}&department=${form.department}`).catch(() => ({ code: '' }))).code;
}, { immediate: true });
async function create() {
  try {
    const d = await api<{ id: string }>('/quality/documents', {
      method: 'POST', json: { title: form.title, docType: form.docType, department: form.department, code: form.code || null, ownerName: form.ownerName || null, isoClauses: form.isoClauses, sections: [] },
    });
    toast.success('أُنشئت الوثيقة مسودة، اكتب محتواها ثم ارفعها للمراجعة');
    router.push(`/quality/documents/${d.id}`);
  } catch (e) {
    toast.error(errMsg(e));
  }
}
function toggleClause(c: string) {
  const i = form.isoClauses.indexOf(c);
  if (i >= 0) form.isoClauses.splice(i, 1);
  else form.isoClauses.push(c);
}
function open(r: DocRow) {
  if (r.source === 'quality') router.push(r.path);
  else router.push(r.path);
}
</script>

<template>
  <div>
    <section class="pm-hero q-hero">
      <div>
        <p class="pm-kicker">المعلومات الموثقة · البند 7.5</p>
        <h1>{{ procedures ? 'سجل الإجراءات' : 'السجل الرئيسي للوثائق المضبوطة' }}</h1>
        <p class="pm-sub" v-if="procedures">كل إجراءات الشركة الموثقة بإصداراتها السارية وخرائطها. التعديل يكون بإصدار جديد يمر بمراجعة الجودة والاعتماد، ويُحفظ الإصدار السابق.</p>
        <p class="pm-sub" v-else>الترميز الموحد لكل الأنظمة: وثائق الجودة، ونماذج العملاء، والأوصاف الوظيفية. لكل وثيقة كود فريد ورقم إصدار ومسار اعتماد وتوزيع مضبوط وسحب للملغى.</p>
      </div>
      <div class="pm-actions"><button v-if="session.can(P.documents)" class="btn q-glow" @click="form.show = true">{{ procedures ? 'إجراء جديد' : 'وثيقة جديدة' }}</button></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #0ea5e9"><span>كل الوثائق</span><strong>{{ counts.total }}</strong><small>منها {{ counts.external }} من الأنظمة الأخرى</small></div>
      <div class="pm-kpi" style="--a: #10b981"><span>معتمدة سارية</span><strong>{{ counts.approved }}</strong></div>
      <div class="pm-kpi" style="--a: #6366f1; cursor: pointer" @click="f.status = 'review'"><span>بانتظار المراجعة أو الاعتماد</span><strong>{{ counts.pending }}</strong></div>
      <div class="pm-kpi" style="--a: #f59e0b; cursor: pointer" @click="f.status = 'due'"><span>مراجعتها الدورية خلال 30 يومًا</span><strong>{{ counts.due }}</strong></div>
      <div class="pm-kpi" style="--a: #ef4444; cursor: pointer" @click="f.status = 'obsolete'"><span>ملغاة (أرشيف)</span><strong>{{ counts.obsolete }}</strong></div>
    </div>
    <section class="card pm-panel">
      <div class="q-toolbar">
        <input v-model="f.search" class="input grow" placeholder="ابحث بالكود أو العنوان" />
        <select v-if="!procedures" v-model="f.type" class="input"><option value="">كل الأنواع</option><option v-for="t in DOC_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option></select>
        <select v-model="f.department" class="input"><option value="">كل الإدارات</option><option v-for="d in settings?.departments" :key="d.code" :value="d.code">{{ d.code }} · {{ d.name }}</option></select>
        <select v-model="f.status" class="input">
          <option value="active">السارية والمسودات</option><option value="approved">المعتمدة</option><option value="draft">المسودات</option><option value="review">بانتظار المراجعة أو الاعتماد</option>
          <option value="due">حان موعد مراجعتها</option><option value="obsolete">الملغاة</option><option value="all">الكل</option>
        </select>
        <select v-model="f.source" class="input"><option value="">كل الأنظمة</option><option value="quality">الجودة فقط</option><option value="other">الأنظمة الأخرى</option></select>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الكود</th><th>العنوان</th><th>النوع</th><th>الإدارة</th><th>الإصدار</th><th>الحالة</th><th>السريان / المراجعة القادمة</th><th>البنود</th></tr></thead>
          <tbody>
            <tr v-for="r in shown" :key="r.source + r.id" class="q-row" @click="open(r)">
              <td><span class="q-code">{{ r.code }}</span></td>
              <td><b>{{ r.title }}</b><span class="pm-muted">{{ r.ownerName ?? '' }}<template v-if="r.source !== 'quality'"> · من نظام {{ r.sourceLabel }}</template><template v-if="r.mapId"> · لها خريطة إجراء</template></span></td>
              <td>{{ r.typeLabel }}</td>
              <td><span class="pm-tag">{{ r.department }}</span></td>
              <td><span class="q-rev">{{ r.revisionLabel }}</span><span v-if="r.workingRevision" class="pm-muted">قيد الإعداد {{ r.workingRevision }}</span></td>
              <td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[r.status] }">{{ r.statusLabel }}</span></td>
              <td class="q-num">{{ fmtDate(r.effectiveDate) }}<span v-if="r.nextReviewDate" class="pm-muted" :style="{ color: r.reviewOverdue ? 'var(--danger)' : r.reviewDue ? '#b45309' : '' }">المراجعة {{ fmtDate(r.nextReviewDate) }}</span></td>
              <td><span v-for="c in r.isoClauses.slice(0, 3)" :key="c" class="pm-tag" style="margin-inline-end: 3px">{{ c }}</span></td>
            </tr>
            <tr v-if="!shown.length"><td colspan="8" class="pm-empty">لا توجد وثائق</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" style="max-width: 620px" @submit.prevent="create">
        <h2>{{ procedures ? 'إجراء جديد' : 'وثيقة جديدة' }}</h2>
        <label class="field"><span>العنوان</span><input v-model="form.title" class="input" required placeholder="مثال: إجراء استقبال الطلبات" /></label>
        <div class="pm-grid2">
          <label class="field"><span>النوع</span><select v-model="form.docType" class="input"><option v-for="t in DOC_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option></select></label>
          <label class="field"><span>الإدارة / النظام</span><select v-model="form.department" class="input"><option v-for="d in settings?.departments" :key="d.code" :value="d.code">{{ d.code }} · {{ d.name }}</option></select></label>
        </div>
        <div class="pm-grid2">
          <label class="field"><span>الكود</span><input v-model="form.code" class="input" dir="ltr" :placeholder="suggested" /><small class="pm-muted">اتركه فارغًا ليأخذ الكود المقترح {{ suggested }}</small></label>
          <label class="field"><span>الجهة المالكة</span><input v-model="form.ownerName" class="input" placeholder="مثال: قسم الجودة" /></label>
        </div>
        <div class="field"><span>بنود المواصفة التي تغطيها</span>
          <div class="q-chips"><button v-for="c in ISO_CLAUSES" :key="c" type="button" :class="['q-chip', { on: form.isoClauses.includes(c) }]" @click="toggleClause(c)">{{ c }}</button></div>
        </div>
        <p class="pm-muted">ستُنشأ الوثيقة مسودة بقالب أقسام مناسب لنوعها (الغرض، النطاق، المسؤوليات، الخطوات...).</p>
        <div class="modal-actions"><button class="btn btn-primary">إنشاء</button><button type="button" class="btn" @click="form.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
