<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import ScoreRing from '../components/ScoreRing.vue';
import PerformanceTable from '../components/PerformanceTable.vue';
import {
  EFFORT, fmtDate, itemPercent, loadCatalog, METHOD, num, OPINIONS, pctColor, reachableSteps, scoreColor, SIGNAL, STATUS,
  type AssessmentDetail, type Catalog, type CatalogItem, type ItemEval,
} from '../lib';
import '../../projects/projects.css';
import '../gov.css';

const props = defineProps<{ id: string }>();
const router = useRouter();
const toast = useToast();
const cat = ref<Catalog | null>(null);
const d = ref<AssessmentDetail | null>(null);
const tab = ref<'CMP' | 'TRN' | 'FIN' | 'ops'>('CMP');
const filter = ref<'all' | 'open' | 'gaps'>('all');
const busy = ref(false);
/** إجابات قيد التحرير لكل بند */
const draft = reactive<Record<string, (number | null)[]>>({});
const notes = reactive<Record<string, string>>({});

async function reload() {
  d.value = await api<AssessmentDetail>(`/governance/assessments/${props.id}`);
  for (const k of Object.keys(draft)) delete draft[k];
  for (const [k, v] of Object.entries(d.value.answers)) { draft[k] = [...v.choices]; notes[k] = v.evidence ?? ''; }
}
onMounted(async () => {
  try {
    cat.value = await loadCatalog();
    await reload();
  } catch (e) {
    toast.error((e as Error).message);
  }
});

const evalMap = computed(() => {
  const m = new Map<string, ItemEval>();
  for (const s of d.value?.evaluation.standards ?? []) for (const i of s.indicators) for (const p of i.practices) for (const it of p.items) m.set(it.code, it);
  return m;
});
const indEval = (code: string) => d.value?.evaluation.standards.flatMap((s) => s.indicators).find((i) => i.code === code);
const stdEval = (code: string) => d.value?.evaluation.standards.find((s) => s.code === code);
const standard = computed(() => cat.value?.standards.find((s) => s.code === (tab.value === 'FIN' ? 'FRG' : tab.value)));
const visible = (it: CatalogItem) => {
  const e = evalMap.value.get(it.code);
  if (filter.value === 'open') return !e?.answered;
  if (filter.value === 'gaps') return !e?.answered || (e.percent ?? 0) < 100;
  return true;
};
const editable = computed(() => !!d.value?.canEdit);

async function choose(it: CatalogItem, step: number, opt: number) {
  if (!editable.value) return;
  const cur = [...(draft[it.code] ?? [])];
  cur[step] = opt;
  cur.length = Math.max(cur.length, step + 1);
  const reach = reachableSteps(it, cur);
  const next = cur.slice(0, reach);
  draft[it.code] = next;
  if (itemPercent(it, next) === null) return;
  await save(it.code, next);
}
async function save(code: string, choices: (number | null)[]) {
  try {
    await api(`/governance/assessments/${props.id}/answers/${code}`, { method: 'PUT', json: { choices, evidence: notes[code] || null } });
    await reload();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function saveNote(code: string) {
  const a = d.value?.answers[code];
  if (!a || (a.evidence ?? '') === (notes[code] ?? '')) return;
  await save(code, a.choices);
}
async function clear(code: string) {
  await api(`/governance/assessments/${props.id}/answers/${code}`, { method: 'DELETE' });
  await reload();
}
async function adopt(it: CatalogItem) {
  const e = evalMap.value.get(it.code);
  if (e?.suggested) { draft[it.code] = [...e.suggested]; await save(it.code, e.suggested); }
}
async function act(path: string, msg: string, confirmText?: string) {
  if (confirmText && !confirm(confirmText)) return;
  busy.value = true;
  try {
    await api(`/governance/assessments/${props.id}/${path}`, { method: 'POST' });
    await reload();
    toast.success(msg);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function remove() {
  if (!confirm('حذف هذا التقييم وإجاباته؟')) return;
  try {
    await api(`/governance/assessments/${props.id}`, { method: 'DELETE' });
    router.push('/governance/assessments');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const meta = reactive({ show: false, opinion: 'unqualified', qualifiedItems: 0, notes: '' });
function editMeta() {
  if (!d.value) return;
  Object.assign(meta, { show: true, opinion: d.value.assessment.opinion, qualifiedItems: d.value.assessment.qualifiedItems, notes: d.value.assessment.notes ?? '' });
}
async function saveMeta() {
  try {
    await api(`/governance/assessments/${props.id}`, { method: 'PUT', json: { opinion: meta.opinion, qualifiedItems: Number(meta.qualifiedItems) || 0, notes: meta.notes || null } });
    meta.show = false;
    await reload();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const figs = reactive<{ show: boolean; values: Record<string, number> }>({ show: false, values: {} });
function editFigures() {
  figs.values = Object.fromEntries((cat.value?.figures ?? []).map((f) => [f.key, d.value?.assessment.figures?.[f.key] ?? 0]));
  figs.show = true;
}
async function saveFigures() {
  try {
    await api(`/governance/assessments/${props.id}/figures`, { method: 'PUT', json: { figures: figs.values } });
    figs.show = false;
    await reload();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const unanswered = computed(() => [...evalMap.value.values()].filter((x) => !x.answered).length);
const suggestable = computed(() => [...evalMap.value.values()].filter((x) => !x.answered && x.suggested).length);
const optColor = (pct: number | null) => (pct === null ? '#6366f1' : pctColor(pct));
</script>

<template>
  <div v-if="d && cat">
    <section class="pm-hero gv-hero">
      <div>
        <p class="pm-kicker"><span class="gv-code" style="color: inherit">{{ d.assessment.code }}</span> · {{ d.assessment.kindLabel }} · {{ d.assessment.periodLabel }}</p>
        <h1>{{ d.assessment.title }}</h1>
        <p class="pm-sub">
          الفترة {{ fmtDate(d.assessment.periodFrom) }} — {{ fmtDate(d.assessment.periodTo) }} ·
          <span class="gv-pill" :style="{ '--c': STATUS[d.assessment.status].color }">{{ d.assessment.statusLabel }}</span>
          <template v-if="d.assessment.approvedByName"> · اعتمده {{ d.assessment.approvedByName }}</template>
        </p>
      </div>
      <div class="pm-actions">
        <template v-if="d.canEdit">
          <button v-if="suggestable" class="btn gv-glow" :disabled="busy" @click="act('apply-suggestions', 'اعتُمدت اقتراحات الإشارات الآلية، راجعها قبل الرفع')">اعتماد الاقتراحات الآلية ({{ suggestable }})</button>
          <button class="btn gv-ghost" :disabled="busy" @click="act('submit', 'رُفع التقييم للاعتماد')">رفع للاعتماد</button>
          <button class="btn gv-ghost" @click="editMeta">رأي المحاسب والملاحظات</button>
          <button class="btn gv-ghost" @click="remove">حذف</button>
        </template>
        <button v-if="d.canApprove && d.assessment.status === 'submitted'" class="btn gv-glow" :disabled="busy" @click="act('approve', 'اعتُمد التقييم')">اعتماد</button>
        <button v-if="d.canApprove && d.assessment.status !== 'draft'" class="btn gv-ghost" :disabled="busy" @click="act('reopen', 'أُعيد فتح التقييم للتعديل', 'إعادة فتح التقييم للتعديل؟')">إعادة فتح</button>
      </div>
    </section>

    <div class="gv-grid" style="margin-bottom: 16px">
      <section class="card pm-panel" style="display: flex; gap: 20px; align-items: center; flex-wrap: wrap">
        <ScoreRing :value="d.evaluation.overall" :predicted="d.evaluation.predicted" :size="150" label="الدرجة" :sub="d.evaluation.grade" />
        <div style="flex: 1; min-width: 240px">
          <div class="gv-axes">
            <div v-for="a in d.evaluation.axes" :key="a.code" class="gv-axis" :style="{ '--c': scoreColor(a.score) }">
              <span>{{ a.title }} <span class="pm-muted">({{ a.weight }}%)</span></span>
              <div class="bar"><i class="p" :style="{ width: `${a.predicted}%` }" /><i :style="{ width: `${a.score}%` }" /><span class="t" :style="{ insetInlineStart: `${d.target}%` }" /></div>
              <b>{{ num(a.score) }}%</b>
            </div>
          </div>
          <p class="pm-muted" style="margin: 12px 0 0">
            المتوقع عند التقييم الفعلي <b :style="{ color: scoreColor(d.evaluation.predicted) }">{{ num(d.evaluation.predicted) }}% ({{ d.evaluation.predictedGrade }})</b>
            · الاكتمال {{ num(d.evaluation.coverage) }}% · {{ unanswered }} بنداً بلا إجابة · رأي المحاسب: {{ OPINIONS[d.assessment.opinion] }} (معامل {{ d.assessment.factor }})
          </p>
        </div>
      </section>
      <section class="card pm-panel">
        <h2>كيف تُحسب الدرجة</h2>
        <p class="pm-muted" style="margin: 0; line-height: 1.9">
          الدرجة الكلية = الامتثال والالتزام × 40% + الشفافية والإفصاح × 20% + السلامة المالية × 40%.
          والسلامة المالية = الأداء المالي (من الدفاتر) × معامل رأي المحاسب × 50% + التنظيم المالي × 50%.
          ودرجة كل بند = درجته في البطاقة × نسبة الحالة المختارة. والدرجة المتوقعة تكمل البنود غير المجاب عليها بآخر تقييم معتمد أو بالإشارات الآلية، وتستخدم الأداء المالي المقدّر لنهاية السنة.
        </p>
        <p class="pm-muted" style="margin: 8px 0 0">التقدير: ممتاز ≥ 90، جيد جداً 80–89، جيد 70–79، متوسط 50–69، ضعيف &lt; 50.</p>
      </section>
    </div>

    <div class="gv-tabs">
      <button v-for="s in cat.standards.filter((x) => x.code !== 'FRG')" :key="s.code" :class="['gv-tab', { on: tab === s.code }]" @click="tab = s.code as 'CMP' | 'TRN'">
        {{ s.title }}<b>{{ num(stdEval(s.code)?.score) }}%</b>
      </button>
      <button :class="['gv-tab', { on: tab === 'FIN' }]" @click="tab = 'FIN'">السلامة المالية<b>{{ num(d.evaluation.financialSafety) }}%</b></button>
      <button :class="['gv-tab', { on: tab === 'ops' }]" @click="tab = 'ops'">فرص التحسين<b>{{ d.evaluation.opportunities.length }}</b></button>
    </div>

    <template v-if="tab === 'FIN'">
      <section class="card pm-panel" style="margin-bottom: 14px">
        <h2>الأداء المالي (50% من السلامة المالية)
          <span v-if="d.canEdit" class="pm-actions">
            <button class="btn btn-sm" :disabled="busy" @click="act('refresh-figures', 'حُدّثت الأرقام من الدفاتر')">تحديث من الدفاتر</button>
            <button class="btn btn-sm btn-ghost" @click="editFigures">إدخال يدوي من القوائم المدققة</button>
          </span>
        </h2>
        <p v-if="!d.performance" class="gv-warn">لا توجد أرقام مالية لهذه الفترة. حدّثها من الدفاتر أو أدخلها يدوياً من القوائم المالية المدققة.</p>
        <template v-else>
          <p class="pm-muted" style="margin-top: 0">
            مصدر الأرقام: {{ d.assessment.figuresSource === 'ledger' ? 'القيود المرحّلة في النظام المالي' : 'إدخال يدوي' }} · درجة الأداء {{ num(d.performance.score) }}% × معامل الرأي {{ d.performance.factor }} = <b>{{ num(d.performance.final) }}%</b>
            <template v-if="d.forecast && d.forecast !== d.performance"> · المتوقع لنهاية السنة {{ num(d.forecast.final) }}%</template>
          </p>
          <PerformanceTable :actual="d.performance" :forecast="d.forecast" />
        </template>
      </section>
      <h3 style="margin: 4px 0 10px">التنظيم المالي (50% من السلامة المالية) <span class="pm-muted">{{ num(stdEval('FRG')?.score) }}%</span></h3>
    </template>

    <template v-if="tab !== 'ops' && standard">
      <div class="gv-tabs">
        <button :class="['gv-tab', { on: filter === 'all' }]" @click="filter = 'all'">كل البنود</button>
        <button :class="['gv-tab', { on: filter === 'open' }]" @click="filter = 'open'">بلا إجابة</button>
        <button :class="['gv-tab', { on: filter === 'gaps' }]" @click="filter = 'gaps'">الفجوات فقط</button>
      </div>
      <details v-for="ind in standard.indicators" :key="ind.code" class="gv-ind">
        <summary>
          <span><span class="gv-code">{{ ind.code }}</span> <b>{{ ind.title }}</b> <span class="pm-muted">· {{ ind.domain }}</span></span>
          <span class="gv-axis" style="grid-template-columns: 1fr 60px" :style="{ '--c': scoreColor(indEval(ind.code)?.percent) }"><span class="bar"><i :style="{ width: `${indEval(ind.code)?.percent ?? 0}%` }" /></span><b>{{ num(indEval(ind.code)?.earned, 2) }}/{{ ind.weight }}</b></span>
          <span class="pm-muted">متوقع {{ num(indEval(ind.code)?.predicted, 2) }}</span>
        </summary>
        <div class="body">
          <article v-for="pr in ind.practices" :key="pr.code" class="gv-prac">
            <header><h3><span class="gv-code">{{ pr.code }}</span> {{ pr.title }}</h3><span class="pm-muted">بطاقة {{ pr.no }}</span></header>
            <p class="pm-muted" style="margin: 0">{{ pr.requirement }}</p>
            <p v-if="pr.refs?.length" class="pm-muted" style="margin: 4px 0 0">المصدر: {{ pr.refs.join('، ') }}</p>
            <template v-for="it in pr.items" :key="it.code">
              <div v-if="visible(it)" class="gv-item">
                <div class="hd">
                  <span><span class="gv-code">{{ it.code }}</span> <span class="pm-muted">الدرجة {{ it.points }}</span></span>
                  <span>
                    <span v-if="evalMap.get(it.code)?.answered" class="gv-pill" :style="{ '--c': pctColor(evalMap.get(it.code)!.percent) }">{{ num(evalMap.get(it.code)!.percent) }}% · {{ num(evalMap.get(it.code)!.earned, 2) }} من {{ it.points }}</span>
                    <span v-else class="gv-pill" style="--c: #94a3b8">بلا إجابة · متوقع {{ num(evalMap.get(it.code)?.predictedPercent) }}%</span>
                    <span v-if="d.answers[it.code]?.fromSignal" class="gv-pill" style="--c: #6366f1">من الإشارة الآلية</span>
                  </span>
                </div>
                <div v-for="(st, si) in it.steps.slice(0, reachableSteps(it, draft[it.code] ?? []))" :key="si" class="gv-step">
                  <div class="q">{{ st.q }} <span class="pm-muted">({{ METHOD[st.m] }})</span></div>
                  <div v-if="st.ev.length" class="ev">التحقق: {{ st.ev.join('، ') }}</div>
                  <div class="gv-opts">
                    <button v-for="(o, oi) in st.o" :key="oi" type="button" :disabled="!editable"
                      :class="['gv-opt', { on: draft[it.code]?.[si] === oi, sug: evalMap.get(it.code)?.suggested?.[si] === oi }]" :style="{ '--c': optColor(o[1]) }" @click="choose(it, si, oi)">
                      {{ o[0] }}<i>{{ o[1] === null ? 'السؤال التالي' : `${o[1]}%` }}</i>
                    </button>
                  </div>
                </div>
                <div v-if="evalMap.get(it.code)?.signal" class="gv-signal">
                  <span class="gv-pill" :style="{ '--c': SIGNAL[evalMap.get(it.code)!.signal!.status].color }">{{ SIGNAL[evalMap.get(it.code)!.signal!.status].label }}</span>
                  <span>{{ evalMap.get(it.code)!.signal!.source }}: {{ evalMap.get(it.code)!.signal!.text }}</span>
                  <button v-if="editable && evalMap.get(it.code)!.suggested && !evalMap.get(it.code)!.answered" class="btn btn-sm" style="margin-inline-start: auto" @click="adopt(it)">اعتماد الاقتراح</button>
                </div>
                <div v-if="d.answers[it.code]" style="display: flex; gap: 8px; align-items: center">
                  <input v-model="notes[it.code]" class="input" :disabled="!editable" placeholder="الشاهد أو المرجع (رقم المحضر، رابط النشر…)" @blur="saveNote(it.code)" />
                  <button v-if="editable" class="btn btn-sm btn-ghost" @click="clear(it.code)">مسح</button>
                </div>
              </div>
            </template>
          </article>
        </div>
      </details>
    </template>

    <section v-if="tab === 'ops'" class="card pm-panel">
      <h2>فرص التحسين مرتبة حسب أثرها على الدرجة الكلية <RouterLink to="/governance/actions" class="pm-link" style="font-size: .8rem">تحويلها لخطة تحسين</RouterLink></h2>
      <p v-if="!d.evaluation.opportunities.length" class="pm-empty">لا توجد فرص تحسين</p>
      <table v-else class="table">
        <thead><tr><th>الأثر</th><th>البند</th><th>الوضع الحالي</th><th>المقترح من الدليل</th></tr></thead>
        <tbody><tr v-for="o in d.evaluation.opportunities" :key="o.code">
          <td class="gv-num" style="color: #059669">+{{ num(o.impact, 2) }}</td>
          <td style="white-space: normal"><span class="gv-code">{{ o.code }}</span> {{ o.title }}<div class="pm-muted">{{ o.practice ?? o.indicator }} · {{ EFFORT[o.effort] }}</div></td>
          <td>{{ o.current === null ? 'بلا إجابة' : o.kind === 'finance' ? `درجة ${num(o.current)}%` : `${num(o.current)}%` }}</td>
          <td style="white-space: normal"><ul style="margin: 0; padding-inline-start: 18px"><li v-for="(r, i) in o.recommendations.slice(0, 3)" :key="i" class="pm-muted">{{ r }}</li></ul></td>
        </tr></tbody>
      </table>
    </section>

    <div v-if="meta.show" class="modal-backdrop" @click.self="meta.show = false">
      <form class="card modal" @submit.prevent="saveMeta">
        <h2>رأي المحاسب القانوني والملاحظات</h2>
        <label class="field"><span>رأي المحاسب القانوني على آخر قوائم مالية</span><select v-model="meta.opinion" class="input"><option v-for="(l, k) in OPINIONS" :key="k" :value="k">{{ l }}</option></select></label>
        <label v-if="meta.opinion === 'qualified'" class="field"><span>عدد بنود التحفظ (يخصم 10% من الأداء المالي لكل بند)</span><input v-model.number="meta.qualifiedItems" type="number" min="1" max="20" class="input" /></label>
        <label class="field"><span>ملاحظات</span><textarea v-model="meta.notes" class="input" rows="3" /></label>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="meta.show = false">إلغاء</button></div>
      </form>
    </div>
    <div v-if="figs.show" class="modal-backdrop" @click.self="figs.show = false">
      <form class="card modal" style="max-width: 720px" @submit.prevent="saveFigures">
        <h2>أرقام القوائم المالية</h2>
        <p class="pm-muted">أدخل المبالغ بالريال من القوائم المالية المدققة وتقرير التصنيف الوظيفي للمصروفات.</p>
        <div class="pm-grid2">
          <label v-for="f in cat.figures" :key="f.key" class="field"><span>{{ f.label }}</span><input v-model.number="figs.values[f.key]" type="number" step="0.01" class="input" /><small class="pm-muted">{{ f.source }}</small></label>
        </div>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="figs.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
  <p v-else class="pm-empty">جارٍ التحميل…</p>
</template>
