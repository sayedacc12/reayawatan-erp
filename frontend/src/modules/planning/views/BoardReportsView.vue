<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError, token } from '../../../api';
import { useToast } from '../../../stores/toast';
import { errMsg, KIND } from '../lib';
import '../../../shared/module.css';
import '../../risk/risk.css';
import '../planning.css';

/**
 * تقارير مجلس المديرين: نماذج الاعتماد وتقييم الأداء للخطط والموازنات (QF-PLN-01 إلى QF-PLN-06).
 * الخادم يبني الوثيقة من بيانات النظام ويهرّب كل قيمة؛ والمعاينة في إطار معزول بلا سكربتات.
 */
type Type = 'plan-approval' | 'plan-performance' | 'budget-approval' | 'budget-performance';
interface Form { code: string; type: Type; kind: 'strategic' | 'operational' | null; title: string; purpose: string }
interface PlanOpt { id: string; code: string; kind: string; title: string; startYear: number; endYear: number; status: string; statusName: string; version: number }
interface BudgetOpt { id: string; code: string; title: string; fiscalYear: number; status: string; statusName: string; version: number }
interface Catalog { forms: Form[]; plans: PlanOpt[]; budgets: BudgetOpt[]; today: string; pdf: boolean }

const route = useRoute();
const router = useRouter();
const toast = useToast();
const cat = ref<Catalog | null>(null);
const error = ref('');
const busy = ref<'' | 'preview' | 'pdf' | 'print'>('');
const html = ref('');
const frame = ref<HTMLIFrameElement | null>(null);
const sel = reactive({ form: '', planId: '', budgetId: '', year: 0, span: 'Q', part: '1', meetingNo: '' });

const form = computed(() => cat.value?.forms.find((f) => f.code === sel.form) ?? null);
const isPlan = computed(() => !!form.value?.type.startsWith('plan'));
const isPerf = computed(() => !!form.value?.type.endsWith('performance'));
const plans = computed(() => (cat.value?.plans ?? []).filter((p) => !form.value?.kind || p.kind === form.value.kind)
  .filter((p) => !isPerf.value || p.version > 0));
const budgets = computed(() => (cat.value?.budgets ?? []).filter((b) => !isPerf.value || b.version > 0));
const groups = computed(() => [
  { title: 'تقارير الاعتماد', hint: 'تُرفع قبل الاعتماد مع صفحة القرار والتوقيعات', forms: (cat.value?.forms ?? []).filter((f) => f.type.endsWith('approval')) },
  { title: 'تقارير تقييم الأداء الدورية', hint: 'المخطط مقابل الفعلي والانحرافات والتوصيات لفترة تختارها', forms: (cat.value?.forms ?? []).filter((f) => f.type.endsWith('performance')) },
].filter((g) => g.forms.length));

const SPANS: Record<string, { label: string; parts: [string, string][] }> = {
  Y: { label: 'سنوي', parts: [] },
  H: { label: 'نصف سنوي', parts: [['1', 'النصف الأول'], ['2', 'النصف الثاني']] },
  Q: { label: 'ربع سنوي', parts: [['1', 'الربع الأول'], ['2', 'الربع الثاني'], ['3', 'الربع الثالث'], ['4', 'الربع الرابع']] },
  M: { label: 'شهري', parts: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'].map((m, i) => [String(i + 1).padStart(2, '0'), m]) },
};
const period = computed(() => {
  if (sel.span === 'Y') return String(sel.year);
  if (sel.span === 'M') return `${sel.year}-${sel.part}`;
  return `${sel.year}-${sel.span}${sel.part}`;
});
const target = computed(() => (isPlan.value ? sel.planId : sel.budgetId));
const ready = computed(() => !!form.value && !!target.value);

function query(format: 'html' | 'pdf') {
  const q = new URLSearchParams({ format });
  if (isPlan.value) q.set('planId', sel.planId); else q.set('budgetId', sel.budgetId);
  if (isPerf.value) q.set('period', period.value);
  if (sel.meetingNo.trim()) q.set('meetingNo', sel.meetingNo.trim().slice(0, 40));
  return `/api/planning/board-reports/${form.value!.type}?${q}`;
}
async function fetchDoc(format: 'html' | 'pdf') {
  const t = token.get();
  const res = await fetch(query(format), { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (Array.isArray(data.message) ? data.message.join('، ') : data.message) || 'تعذر إصدار التقرير');
  }
  return res;
}

async function preview() {
  if (!ready.value) return;
  busy.value = 'preview';
  try { html.value = await (await fetchDoc('html')).text(); } catch (e) { toast.error(errMsg(e)); html.value = ''; } finally { busy.value = ''; }
}
async function pdf() {
  busy.value = 'pdf';
  try {
    const res = await fetchDoc('pdf');
    const m = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('Content-Disposition') ?? '');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = m ? decodeURIComponent(m[1]) : `${form.value!.code}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    toast.success('تم تنزيل الملف');
  } catch (e) {
    if (e instanceof ApiError && e.status === 503) { toast.success('تصدير PDF غير متاح على الخادم، اختر «حفظ كملف PDF» من نافذة الطباعة'); await print(); } else toast.error(errMsg(e));
  } finally { busy.value = busy.value === 'pdf' ? '' : busy.value; }
}
async function print() {
  busy.value = 'print';
  try {
    if (!html.value) html.value = await (await fetchDoc('html')).text();
    await new Promise((r) => setTimeout(r, 50));
    const win = frame.value?.contentWindow;
    await (win?.document as (Document & { fonts?: FontFaceSet }) | undefined)?.fonts?.ready;
    win?.focus();
    win?.print();
  } catch (e) { toast.error(errMsg(e)); } finally { busy.value = ''; }
}

function pick(code: string) {
  sel.form = code;
  html.value = '';
}
// المعاينة القديمة لا تبقى بعد تغيير أي اختيار
watch(() => [sel.planId, sel.budgetId, period.value, sel.meetingNo], () => { html.value = ''; });
watch(() => sel.span, (s) => { sel.part = s === 'M' ? String(new Date().getMonth() + 1).padStart(2, '0') : '1'; });
watch(form, () => {
  if (isPlan.value && !plans.value.some((p) => p.id === sel.planId)) sel.planId = plans.value[0]?.id ?? '';
  if (!isPlan.value && !budgets.value.some((b) => b.id === sel.budgetId)) sel.budgetId = budgets.value[0]?.id ?? '';
  const y = isPlan.value ? null : budgets.value.find((b) => b.id === sel.budgetId)?.fiscalYear;
  if (y) sel.year = y;
  router.replace({ query: { ...route.query, type: form.value?.type, form: sel.form } });
});
watch(() => sel.budgetId, (id) => { const y = budgets.value.find((b) => b.id === id)?.fiscalYear; if (y && !isPlan.value) sel.year = y; });

onMounted(async () => {
  try {
    cat.value = await api<Catalog>('/planning/board-reports');
    const t = cat.value.today;
    sel.year = Number(t.slice(0, 4));
    sel.part = String(Math.ceil(Number(t.slice(5, 7)) / 3));
    const q = route.query;
    sel.planId = typeof q.planId === 'string' ? q.planId : '';
    sel.budgetId = typeof q.budgetId === 'string' ? q.budgetId : '';
    const plan = cat.value.plans.find((p) => p.id === sel.planId);
    const byCode = cat.value.forms.find((f) => f.code === q.form);
    const byType = cat.value.forms.find((f) => f.type === q.type && (!f.kind || !plan || f.kind === plan.kind));
    sel.form = byCode?.code ?? byType?.code ?? cat.value.forms[0]?.code ?? '';
  } catch (e) { error.value = errMsg(e); }
});
</script>

<template>
  <div>
    <div class="page-head"><div><h1>تقارير المجلس</h1>
      <p class="muted">نماذج مرمّزة بهوية الشركة تُرفع لمجلس المديرين: للاعتماد مع صفحة القرار والتوقيعات، وللتقييم الدوري للأداء. تُولّد كلها من بيانات النظام وقت الإصدار.</p></div></div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="cat">
      <p v-if="!cat.forms.length" class="pm-empty">لا توجد تقارير متاحة لصلاحياتك</p>
      <div class="br-groups">
        <section v-for="g in groups" :key="g.title" class="card pm-panel">
          <h2>{{ g.title }}<span class="pm-muted">{{ g.hint }}</span></h2>
          <div class="br-forms">
            <button v-for="f in g.forms" :key="f.code" type="button" class="br-form" :class="{ on: sel.form === f.code }" @click="pick(f.code)">
              <span class="rk-code">{{ f.code }}</span><b>{{ f.title }}</b><span class="pm-muted">{{ f.purpose }}</span>
            </button>
          </div>
        </section>
      </div>

      <section v-if="form" class="card pm-panel">
        <h2>{{ form.code }} · {{ form.title }}</h2>
        <div class="br-params">
          <label v-if="isPlan" class="field"><span>{{ form.kind ? `الخطة ${KIND[form.kind]}` : 'الخطة' }}</span>
            <select v-model="sel.planId" class="input">
              <option v-if="!plans.length" value="">{{ isPerf ? 'لا توجد خطط معتمدة من هذا النوع' : 'لا توجد خطط من هذا النوع' }}</option>
              <option v-for="p in plans" :key="p.id" :value="p.id">{{ p.code }} {{ p.title }} ({{ p.startYear }}{{ p.endYear !== p.startYear ? `-${p.endYear}` : '' }}) · {{ p.statusName }}</option>
            </select></label>
          <label v-else class="field"><span>الموازنة</span>
            <select v-model="sel.budgetId" class="input">
              <option v-if="!budgets.length" value="">{{ isPerf ? 'لا توجد موازنات معتمدة' : 'لا توجد موازنات' }}</option>
              <option v-for="b in budgets" :key="b.id" :value="b.id">{{ b.code }} {{ b.title }} ({{ b.fiscalYear }}) · {{ b.statusName }}</option>
            </select></label>
          <template v-if="isPerf">
            <label class="field br-narrow"><span>السنة</span><input v-model.number="sel.year" type="number" min="2000" max="2100" class="input" :disabled="!isPlan" /></label>
            <label class="field br-narrow"><span>نوع الفترة</span>
              <select v-model="sel.span" class="input"><option v-for="(s, k) in SPANS" :key="k" :value="k">{{ s.label }}</option></select></label>
            <label v-if="sel.span !== 'Y'" class="field br-narrow"><span>الفترة</span>
              <select v-model="sel.part" class="input"><option v-for="[v, l] in SPANS[sel.span].parts" :key="v" :value="v">{{ l }}</option></select></label>
          </template>
          <label class="field br-narrow"><span>رقم اجتماع المجلس (اختياري)</span><input v-model="sel.meetingNo" class="input" maxlength="40" placeholder="مثل 3/2027" /></label>
        </div>
        <p v-if="isPerf" class="pm-muted">يُحسب الأداء حتى نهاية الفترة المختارة أو حتى اليوم إن لم تنته بعد.</p>
        <div class="br-actions">
          <button class="btn btn-primary" :disabled="!ready || !!busy" @click="preview"><span v-if="busy === 'preview'" class="spin" />معاينة</button>
          <button class="btn" :disabled="!ready || !!busy" @click="pdf"><span v-if="busy === 'pdf'" class="spin" />تنزيل PDF</button>
          <button class="btn" :disabled="!ready || !!busy" @click="print"><span v-if="busy === 'print'" class="spin" />طباعة</button>
        </div>
      </section>

      <section v-show="html" class="card br-preview">
        <iframe ref="frame" title="معاينة التقرير" sandbox="allow-same-origin allow-modals" :srcdoc="html" />
      </section>
    </template>
  </div>
</template>

<style scoped>
.br-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; margin-bottom: 14px; }
.br-groups h2 { flex-wrap: wrap; }
.br-forms { display: grid; gap: 8px; }
.br-form { text-align: right; display: grid; gap: 2px; padding: 10px 12px; border: 1px solid var(--border, #e2e8f0); border-radius: 12px; background: var(--surface, #fff); cursor: pointer; font: inherit; color: inherit; }
.br-form:hover { border-color: var(--primary, #164e38); }
.br-form.on { border-color: var(--primary, #164e38); box-shadow: inset 0 0 0 1px var(--primary, #164e38); background: color-mix(in srgb, var(--primary, #164e38) 6%, transparent); }
.br-params { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.br-params .field { flex: 1 1 320px; }
.br-params .br-narrow { flex: 0 1 170px; }
.br-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.br-actions .btn { display: inline-flex; align-items: center; gap: 6px; }
.br-preview { margin-top: 14px; padding: 0; overflow: hidden; }
.br-preview iframe { width: 100%; height: 80vh; border: 0; background: #fff; display: block; }
.spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid currentColor; border-top-color: transparent; animation: br-spin .7s linear infinite; }
@keyframes br-spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) { .br-params .br-narrow { flex: 1 1 100%; } }
</style>
