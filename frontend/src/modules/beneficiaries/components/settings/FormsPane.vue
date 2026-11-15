<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../../api';
import { useToast } from '../../../../stores/toast';
import { useSession } from '../../../../stores/session';
import { FIELD_TYPES, OUTCOMES, color, label, scoreOf } from '../../labels';
import type { DynamicForm, FormField, ScoreRule, WorkflowRow } from '../../types';
import DynamicFields from '../DynamicFields.vue';

/** approval = شاشة "اعتماد النماذج" لمراجع الجودة ومدير الشاشة: عرض ومراجعة واعتماد فقط */
const props = withDefaults(defineProps<{ mode?: 'manage' | 'approval' }>(), { mode: 'manage' });
const toast = useToast();
const session = useSession();
const canApprove = computed(() => session.can('beneficiaries.forms.approve'));
const canReview = computed(() => session.can('beneficiaries.forms.review'));
/** مسار الاعتماد (ضبط الوثائق ISO 9001) */
const FLOW = [
  { key: 'draft', label: 'إنشاء', icon: '✎' },
  { key: 'review', label: 'مراجعة الجودة', icon: '⚑' },
  { key: 'reviewed', label: 'اعتماد مدير الشاشة', icon: '✓' },
] as const;
const ORDER = ['draft', 'review', 'reviewed', 'approved'] as const;
const flowState = (f: DynamicForm, i: number) => {
  const at = ORDER.indexOf(f.status ?? 'approved');
  return at > i ? 'done' : at === i ? 'now' : 'todo';
};
const STATUS_TEXT: Record<string, string> = { draft: '✎ مسودة', review: '⚑ عند مراجع الجودة', reviewed: '⏳ بانتظار اعتماد مدير الشاشة', approved: '✓ معتمد' };
const STEP_TEXT: Record<string, string> = { created: 'إنشاء النموذج', edited: 'تعديل (أُعيد إلى المسودة)', submitted: 'إرسال للمراجعة', reviewed: 'مراجعة الجودة', approved: 'اعتماد مدير الشاشة', returned: 'إرجاع للمسودة' };
const rev = (n?: number) => `Rev.${String(n ?? 0).padStart(2, '0')}`;
const fmt = (d: string) => new Date(d).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
const showHistory = ref<string | null>(null);
const forms = ref<DynamicForm[]>([]);
const workflows = ref<WorkflowRow[]>([]);
const error = ref('');

async function load() {
  try {
    if (props.mode === 'approval') {
      const all = await api<DynamicForm[]>('/beneficiaries/settings/forms');
      // النماذج اللي مستنية إجراء من المستخدم الحالي تظهر الأول
      const mine = (f: DynamicForm) => (f.status === 'review' && canReview.value) || (f.status === 'reviewed' && canApprove.value);
      forms.value = [...all.filter(mine), ...all.filter((f) => !mine(f))];
      return;
    }
    [forms.value, workflows.value] = await Promise.all([
      api<DynamicForm[]>('/beneficiaries/settings/forms'),
      api<WorkflowRow[]>('/beneficiaries/settings/workflows'),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

type EditField = FormField & { optionsText: string; scoresText: string[] };
const open = ref(false);
const editing = ref<DynamicForm | null>(null);
const formError = ref('');
const target = reactive({ workflowId: '', stageId: '' });
const pickWf = computed(() => workflows.value.find((w) => w.id === target.workflowId));
const form = reactive({ name: '', qualityCode: '', description: '', scored: false, fields: [] as EditField[], rules: [] as ScoreRule[] });
const preview = ref<Record<string, unknown>>({});

const toEdit = (f: FormField): EditField => ({
  ...f, optionsText: (f.options ?? []).join('\n'), scoresText: (f.optionScores ?? []).map(String),
});
const optionsOf = (f: EditField) => f.optionsText.split('\n').map((o) => o.trim()).filter(Boolean);
const scorable = (f: EditField) => f.type === 'select' || f.type === 'checkbox';
const totalWeight = computed(() => Math.round(form.fields.reduce((a, f) => a + (scorable(f) ? Number(f.weight) || 0 : 0), 0) * 100) / 100);
const weightOk = computed(() => !form.scored || Math.abs(totalWeight.value - 100) < 0.001);
const DEFAULT_RULES: ScoreRule[] = [
  { min: 0, max: 39.99, outcome: 'reject' },
  { min: 40, max: 69.99, outcome: 'contribution', contributionPercent: 30 },
  { min: 70, max: 100, outcome: 'approve' },
];
function toggleScored() {
  if (form.scored && !form.rules.length) form.rules = DEFAULT_RULES.map((r) => ({ ...r }));
}
function addRule() {
  const last = form.rules.at(-1);
  const min = last ? Math.min(100, Math.round((last.max + 0.01) * 100) / 100) : 0;
  form.rules.push({ min, max: 100, outcome: 'approve' });
}
function openForm(f?: DynamicForm) {
  editing.value = f ?? null;
  formError.value = '';
  preview.value = {};
  Object.assign(form, {
    name: f?.name ?? '', qualityCode: f?.qualityCode ?? '', description: f?.description ?? '', scored: !!f?.scored, rules: (f?.rules ?? []).map((r) => ({ ...r })),
    fields: f ? f.fields.map(toEdit) : [toEdit({ key: '', label: '', type: 'text', required: false })],
  });
  if (!f) {
    const wf = workflows.value.find((w) => w.isDefault) ?? workflows.value[0];
    target.workflowId = wf?.id ?? '';
    target.stageId = firstFree(wf);
  }
  open.value = true;
}
function firstFree(w?: WorkflowRow) {
  const st = w?.stages.find((s) => !s.formId);
  return st?.id ?? (w && !w.applicationFormId ? 'application' : '');
}
function onWfChange() { target.stageId = firstFree(pickWf.value); }
function addField() { form.fields.push(toEdit({ key: '', label: '', type: 'text', required: false })); }
function move(i: number, d: number) { const s = form.fields; [s[i], s[i + d]] = [s[i + d], s[i]]; }
const cleanFields = () => form.fields.map((f, i): FormField => {
  const options = f.type === 'select' ? optionsOf(f) : undefined;
  const weight = form.scored && scorable(f) ? Number(f.weight) || 0 : undefined;
  return {
    key: f.key || `f${i + 1}`, label: f.label, type: f.type, required: f.required, placeholder: f.placeholder, options,
    weight: weight || undefined,
    optionScores: weight && options ? options.map((_, j) => Number(f.scoresText[j] ?? 0) || 0) : undefined,
  };
});
const previewScore = computed(() => (form.scored ? scoreOf({ fields: cleanFields(), rules: form.rules }, preview.value) : null));

async function save() {
  formError.value = '';
  try {
    if (!editing.value && (!target.workflowId || !target.stageId)) {
      formError.value = 'اختر سير العمل والمرحلة التي سيرتبط بها النموذج';
      return;
    }
    if (!weightOk.value) {
      formError.value = `يجب أن يساوي إجمالي الأهمية النسبية 100%، والإجمالي الحالي ${totalWeight.value}%`;
      return;
    }
    const body = {
      name: form.name, qualityCode: form.qualityCode.trim().toUpperCase(), description: form.description, scored: form.scored, fields: cleanFields(),
      rules: form.scored ? form.rules.map((r) => ({ ...r, contributionPercent: r.outcome === 'contribution' ? r.contributionPercent : undefined })) : [],
    };
    if (editing.value) await api(`/beneficiaries/settings/forms/${editing.value.id}`, { method: 'PUT', json: body });
    else {
      await api('/beneficiaries/settings/forms', {
        method: 'POST', json: { ...body, workflowId: target.workflowId, stageId: target.stageId === 'application' ? null : target.stageId },
      });
    }
    const wasApproved = !!editing.value && editing.value.status !== 'draft';
    open.value = false;
    toast.success(wasApproved ? 'تم الحفظ وأُعيد النموذج إلى المسودة. أرسله للمراجعة مرة أخرى' : 'تم حفظ النموذج مسودةً. أرسله للمراجعة عند اكتماله');
    await load();
  } catch (e) {
    formError.value = (e as Error).message;
  }
}
const ACTIONS = {
  submit: { ask: 'إرسال النموذج "%s" لمراجع الجودة؟', done: 'تم الإرسال إلى مراجع الجودة' },
  review: { ask: 'تأكيد مراجعة الجودة للنموذج "%s"؟ سيُحال إلى مدير الشاشة لاعتماده.', done: 'تمت مراجعة الجودة' },
  approve: { ask: 'اعتماد النموذج "%s"؟ بعد الاعتماد لن يمكن حذف المرحلة المرتبطة به.', done: 'تم اعتماد النموذج' },
} as const;
/** العرض الكامل للنموذج قبل اتخاذ القرار */
const viewing = ref<DynamicForm | null>(null);
const viewData = ref<Record<string, unknown>>({});
const viewScore = computed(() => (viewing.value?.scored ? scoreOf({ fields: viewing.value.fields, rules: viewing.value.rules ?? [] }, viewData.value) : null));
const awaitsMe = (f: DynamicForm) => (f.status === 'review' && canReview.value) || (f.status === 'reviewed' && canApprove.value);
function openView(f: DynamicForm) { viewing.value = f; viewData.value = {}; }
async function act(f: DynamicForm, action: keyof typeof ACTIONS) {
  if (!confirm(ACTIONS[action].ask.replace('%s', f.name))) return;
  try {
    await api(`/beneficiaries/settings/forms/${f.id}/${action}`, { method: 'POST' });
    viewing.value = null;
    toast.success(ACTIONS[action].done);
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function sendBack(f: DynamicForm) {
  const note = prompt(`سبب إعادة "${f.name}" إلى المسودة:`);
  if (!note?.trim()) return;
  try {
    await api(`/beneficiaries/settings/forms/${f.id}/return`, { method: 'POST', json: { note } });
    viewing.value = null;
    toast.success('أُعيد النموذج إلى المسودة');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove(f: DynamicForm) {
  if (!confirm(`حذف النموذج "${f.name}"؟`)) return;
  try {
    await api(`/beneficiaries/settings/forms/${f.id}`, { method: 'DELETE' });
    toast.success('تم الحذف');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <section>
    <div class="pane-head">
      <p v-if="mode === 'approval'" class="muted">النماذج التي تنتظر إجراءً منك تظهر أولًا. يراجع مراجع الجودة النموذج وكوده وفق دليل الجودة (ISO 9001)، ثم يعتمده مدير الشاشة، ويمكن لكل منهما إعادته إلى المسودة مع ذكر السبب.</p>
      <p v-else class="muted">يرتبط كل نموذج بمرحلة من مراحل سير العمل أو بتقديم الطلب، وله كود جودة (ISO 9001) ورقم إصدار. يمر النموذج بالخطوات: إنشاء ← مراجعة الجودة ← اعتماد مدير الشاشة، ولا يُعمل به إلا بعد الاعتماد.</p>
      <button v-if="mode === 'manage'" class="btn btn-primary btn-sm" @click="openForm()">+ نموذج جديد</button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <p v-if="!forms.length && !error" class="card empty">لا توجد نماذج بعد.</p>
    <div class="grid">
      <article v-for="(f, i) in forms" :key="f.id" class="card fcard" :style="{ '--i': i }">
        <div class="qrow"><span v-if="f.qualityCode" class="qcode">{{ f.qualityCode }} · {{ rev(f.revision) }}</span><span v-else class="qcode missing">بدون كود جودة</span></div>
        <h3>{{ f.name }} <span v-if="f.scored" class="sbadge">تقييم آلي</span></h3>
        <ol class="flowbar">
          <li v-for="(st, k) in FLOW" :key="st.key" :class="flowState(f, k)"><i>{{ flowState(f, k) === 'done' ? '✓' : st.icon }}</i><span>{{ st.label }}</span></li>
        </ol>
        <div class="meta">
          <span :class="['st', f.status ?? 'approved']">{{ STATUS_TEXT[f.status ?? 'approved'] }}</span>
          <span v-for="p in f.placements" :key="`${p.workflowId}-${p.stageId}`" class="place">📍 {{ p.workflowName }} ← {{ p.stageName }}</span>
        </div>
        <p class="muted small who">{{ [f.createdByName && `أنشأه: ${f.createdByName}`, f.reviewedByName && `راجعه: ${f.reviewedByName}`, f.status === 'approved' && f.approvedByName && `اعتمده: ${f.approvedByName}`].filter(Boolean).join(' · ') }}</p>
        <p v-if="f.description" class="muted small">{{ f.description }}</p>
        <ul class="fields"><li v-for="x in f.fields" :key="x.key">{{ x.label }}<span class="muted"> · {{ label('field', x.type) }}</span><b v-if="x.required" class="req">*</b><span v-if="x.weight" class="wchip">{{ x.weight }}%</span></li></ul>
        <div v-if="f.scored && f.rules?.length" class="rchips">
          <span v-for="(r, j) in f.rules" :key="j" class="rchip" :style="{ '--c': color('outcome', r.outcome) }">{{ r.min }}–{{ r.max }}%: {{ label('outcome', r.outcome) }}<template v-if="r.contributionPercent"> {{ r.contributionPercent }}%</template></span>
        </div>
        <div class="acts">
          <button v-if="f.status === 'draft' && mode === 'manage'" class="btn btn-sm btn-primary" @click="act(f, 'submit')">إرسال للمراجعة</button>
          <button v-if="awaitsMe(f)" class="btn btn-sm btn-primary" @click="openView(f)">عرض النموذج كاملًا واتخاذ القرار</button>
          <button v-else class="btn btn-sm" @click="openView(f)">عرض كامل</button>
          <button v-if="mode === 'manage'" class="btn btn-sm" @click="openForm(f)">تعديل</button>
          <button v-if="mode === 'manage' && f.status !== 'approved' && !f.history?.some((h) => h.step === 'approved')" class="btn btn-sm btn-danger" @click="remove(f)">حذف</button>
          <button v-if="f.history?.length" class="btn btn-sm hbtn" @click="showHistory = showHistory === f.id ? null : f.id">سجل الاعتماد</button>
        </div>
        <ol v-if="showHistory === f.id" class="hist">
          <li v-for="(h, k) in [...(f.history ?? [])].reverse()" :key="k" :class="h.step">
            <b>{{ STEP_TEXT[h.step] }}<template v-if="h.revision !== undefined"> · {{ rev(h.revision) }}</template></b>
            <span class="muted">{{ h.by }} · {{ fmt(h.at) }}</span>
            <q v-if="h.note">{{ h.note }}</q>
          </li>
        </ol>
      </article>
    </div>

    <div v-if="open" class="modal-backdrop" @click.self="open = false">
      <div class="card modal builder">
        <h2 class="mt">{{ editing ? 'تعديل النموذج' : 'نموذج جديد' }}</h2>
        <div v-if="formError" class="alert alert-error">{{ formError }}</div>
        <div v-if="editing && editing.status !== 'draft'" class="alert alert-warn">هذا النموذج {{ editing.status === 'approved' ? 'معتمد' : 'في مسار الاعتماد' }}. أي تعديل سيعيده إلى المسودة، ويجب أن يمر بمراجعة الجودة واعتماد مدير الشاشة من جديد، وتتوقف قرارات المرحلة حتى ذلك الحين.</div>
        <div v-if="!editing" class="target">
          <p class="sec">سيرتبط هذا النموذج بـ</p>
          <div class="two">
            <div class="field"><label>سير العمل *</label>
              <select v-model="target.workflowId" form="form-builder" class="input" required @change="onWfChange"><option value="" disabled>اختر سير العمل</option><option v-for="w in workflows" :key="w.id" :value="w.id">{{ w.name }}</option></select>
            </div>
            <div class="field"><label>المرحلة *</label>
              <select v-model="target.stageId" form="form-builder" class="input" required>
                <option value="" disabled>اختر المرحلة</option>
                <option value="application" :disabled="!!pickWf?.applicationFormId">تقديم الطلب (يعبّئه مقدم الطلب){{ pickWf?.applicationFormId ? ' · مرتبط بنموذج' : '' }}</option>
                <option v-for="(s, i) in pickWf?.stages ?? []" :key="s.id" :value="s.id" :disabled="!!s.formId">{{ i + 1 }}. {{ s.name }}{{ s.formId ? ` · مرتبطة بنموذج (${s.formName})` : '' }}</option>
              </select>
            </div>
          </div>
          <p v-if="!workflows.length" class="muted small">أنشئ سير عمل أولًا من تبويب "سير العمل".</p>
        </div>
        <div class="cols">
          <form id="form-builder" class="bcol" @submit.prevent="save">
            <div class="namecode">
              <div class="field"><label>اسم النموذج *</label><input v-model="form.name" class="input" required placeholder="مثال: نموذج البحث الاجتماعي" /></div>
              <div class="field"><label>كود الجودة (ISO 9001) *</label><input v-model="form.qualityCode" class="input ltr" required pattern="[A-Za-z0-9][A-Za-z0-9._/\-]{1,49}" title="حروف إنجليزية وأرقام وشَرطة، مثل QF-BEN-01" placeholder="QF-BEN-01" /></div>
            </div>
            <p v-if="editing" class="muted small">الإصدار الحالي {{ rev(editing.revision) }}، وسيصبح بعد الاعتماد القادم {{ editing.history?.some((h) => h.step === 'approved') ? rev((editing.revision ?? 0) + 1) : rev(0) }}.</p>
            <div class="field"><label>الوصف</label><input v-model="form.description" class="input" /></div>
            <label class="scored-toggle">
              <input v-model="form.scored" type="checkbox" @change="toggleScored" />
              <span><b>نموذج تقييم آلي</b><br /><small class="muted">لكل بند أهمية نسبية، ويحسب النظام نتيجة من 100 ويقترح القرار ونسبة مساهمة المستفيد</small></span>
            </label>
            <div v-if="form.scored" :class="['wmeter', { ok: weightOk, over: totalWeight > 100 }]">
              <div class="wbar"><i :style="{ width: `${Math.min(totalWeight, 100)}%` }" /></div>
              <span>إجمالي الأهمية النسبية: <b>{{ totalWeight }}%</b> <template v-if="!weightOk">(يجب أن يساوي 100%)</template><template v-else>✓</template></span>
            </div>
            <p class="sec">الحقول</p>
            <TransitionGroup name="list" tag="div" class="flist">
              <div v-for="(f, i) in form.fields" :key="f.key || `n${i}`" class="frow">
                <div class="r1">
                  <input v-model="f.label" class="input" placeholder="اسم الحقل" required />
                  <select v-model="f.type" class="input type"><option v-for="t in FIELD_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option></select>
                </div>
                <textarea v-if="f.type === 'select'" v-model="f.optionsText" class="input" rows="2" placeholder="الخيارات: كل خيار في سطر مستقل" required />
                <div v-if="form.scored && scorable(f)" class="wrow">
                  <label class="wlabel">الأهمية النسبية <input v-model.number="f.weight" type="number" min="0" max="100" step="0.01" class="input wnum" placeholder="0" /> %</label>
                  <div v-if="f.type === 'select' && f.weight && optionsOf(f).length" class="oscores">
                    <span class="muted small">درجة كل خيار (من 100):</span>
                    <label v-for="(o, j) in optionsOf(f)" :key="o" class="oscore">{{ o }} <input v-model="f.scoresText[j]" type="number" min="0" max="100" class="input wnum" placeholder="0" /></label>
                  </div>
                  <span v-if="f.type === 'checkbox' && f.weight" class="muted small">عند تحديده يأخذ الدرجة كاملة</span>
                </div>
                <div class="r2">
                  <label class="check"><input v-model="f.required" type="checkbox" /> مطلوب</label>
                  <span class="mv">
                    <button type="button" class="icon" :disabled="i === 0" @click="move(i, -1)">▲</button>
                    <button type="button" class="icon" :disabled="i === form.fields.length - 1" @click="move(i, 1)">▼</button>
                    <button type="button" class="icon danger" @click="form.fields.splice(i, 1)">✕</button>
                  </span>
                </div>
              </div>
            </TransitionGroup>
            <button type="button" class="btn btn-sm" @click="addField">+ إضافة حقل</button>

            <template v-if="form.scored">
              <p class="sec">قواعد التعامل مع النتيجة</p>
              <p class="muted small">حدّد النتيجة لكل نطاق، مثلًا: أقل من 40% رفض، ومن 40% إلى 70% قبول بمساهمة من المستفيد، وما فوق ذلك قبول.</p>
              <div class="rules">
                <div v-for="(r, j) in form.rules" :key="j" class="rule" :style="{ '--c': color('outcome', r.outcome) }">
                  <span>من</span><input v-model.number="r.min" type="number" min="0" max="100" step="0.01" class="input wnum" />
                  <span>إلى</span><input v-model.number="r.max" type="number" min="0" max="100" step="0.01" class="input wnum" />
                  <span>%</span>
                  <select v-model="r.outcome" class="input outsel"><option v-for="o in OUTCOMES" :key="o.value" :value="o.value">{{ o.label }}</option></select>
                  <template v-if="r.outcome === 'contribution'">
                    <span>يتحمل</span><input v-model.number="r.contributionPercent" type="number" min="1" max="100" class="input wnum" /><span>%</span>
                  </template>
                  <button type="button" class="icon danger" @click="form.rules.splice(j, 1)">✕</button>
                </div>
              </div>
              <button type="button" class="btn btn-sm" @click="addRule">+ إضافة قاعدة</button>
            </template>
          </form>
          <div class="preview">
            <p class="sec">معاينة</p>
            <div class="pv card">
              <p class="pv-title">{{ form.name || 'اسم النموذج' }}<span class="qcode">{{ (form.qualityCode || 'QF-…').toUpperCase() }}</span></p>
              <DynamicFields v-model="preview" :fields="cleanFields().filter((f) => f.label)" />
              <div v-if="previewScore" class="pscore" :style="{ '--c': color('outcome', previewScore.rule?.outcome) }">
                <span>النتيجة المقترحة</span>
                <b>{{ previewScore.score }}%</b>
                <span v-if="previewScore.rule">{{ label('outcome', previewScore.rule.outcome) }}<template v-if="previewScore.rule.contributionPercent"> · يتحمل المستفيد {{ previewScore.rule.contributionPercent }}%</template></span>
                <span v-else class="muted">لا توجد قاعدة لهذه النتيجة</span>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" form="form-builder">حفظ النموذج</button><button type="button" class="btn" @click="open = false">إلغاء</button></div>
      </div>
    </div>

    <div v-if="viewing" class="modal-backdrop" @click.self="viewing = null">
      <div class="card modal builder fullview">
        <div class="fv-head">
          <div>
            <span v-if="viewing.qualityCode" class="qcode">{{ viewing.qualityCode }} · {{ rev(viewing.revision) }}</span>
            <h2 class="mt">{{ viewing.name }} <span v-if="viewing.scored" class="sbadge">تقييم آلي</span></h2>
            <span :class="['st', viewing.status ?? 'approved']">{{ STATUS_TEXT[viewing.status ?? 'approved'] }}</span>
          </div>
          <button type="button" class="btn btn-sm" @click="viewing = null">✕</button>
        </div>
        <p v-if="viewing.description" class="muted">{{ viewing.description }}</p>
        <div class="meta">
          <span v-for="p in viewing.placements" :key="`${p.workflowId}-${p.stageId}`" class="place">📍 {{ p.workflowName }} ← {{ p.stageName }}</span>
          <span v-if="!viewing.placements?.length" class="muted small">غير مرتبط بأي مرحلة حاليًا</span>
        </div>
        <p class="muted small">{{ [viewing.createdByName && `أنشأه: ${viewing.createdByName}`, viewing.reviewedByName && `راجعه: ${viewing.reviewedByName}`, viewing.status === 'approved' && viewing.approvedByName && `اعتمده: ${viewing.approvedByName}`].filter(Boolean).join(' · ') }}</p>

        <div class="cols">
          <div class="bcol">
            <p class="sec">بنود النموذج ({{ viewing.fields.length }})</p>
            <div class="tbl-wrap">
              <table class="fv-table">
                <thead><tr><th>#</th><th>البند</th><th>النوع</th><th>إلزامي</th><th>الخيارات</th><th v-if="viewing.scored">الأهمية</th></tr></thead>
                <tbody>
                  <tr v-for="(x, k) in viewing.fields" :key="x.key">
                    <td>{{ k + 1 }}</td>
                    <td><b>{{ x.label }}</b><div v-if="x.placeholder" class="muted small">{{ x.placeholder }}</div></td>
                    <td>{{ label('field', x.type) }}</td>
                    <td>{{ x.required ? 'نعم' : 'لا' }}</td>
                    <td>
                      <template v-if="x.options?.length">
                        <span v-for="(o, j) in x.options" :key="j" class="opt">{{ o }}<template v-if="x.optionScores?.length"> ({{ x.optionScores[j] ?? 0 }})</template></span>
                      </template>
                      <span v-else class="muted">—</span>
                    </td>
                    <td v-if="viewing.scored">{{ x.weight ? `${x.weight}%` : '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <template v-if="viewing.scored && viewing.rules?.length">
              <p class="sec">قواعد النتيجة</p>
              <div class="rchips">
                <span v-for="(r, j) in viewing.rules" :key="j" class="rchip" :style="{ '--c': color('outcome', r.outcome) }">{{ r.min }}–{{ r.max }}%: {{ label('outcome', r.outcome) }}<template v-if="r.contributionPercent"> {{ r.contributionPercent }}%</template></span>
              </div>
            </template>
            <template v-if="viewing.history?.length">
              <p class="sec">سجل الاعتماد</p>
              <ol class="hist">
                <li v-for="(h, k) in [...viewing.history].reverse()" :key="k" :class="h.step">
                  <b>{{ STEP_TEXT[h.step] }}<template v-if="h.revision !== undefined"> · {{ rev(h.revision) }}</template></b>
                  <span class="muted">{{ h.by }} · {{ fmt(h.at) }}</span>
                  <q v-if="h.note">{{ h.note }}</q>
                </li>
              </ol>
            </template>
          </div>
          <div class="preview">
            <p class="sec">النموذج كما سيظهر لمن يعبّئه (يمكنك تجربته)</p>
            <DynamicFields v-model="viewData" :fields="viewing.fields" />
            <div v-if="viewScore" class="pscore" :style="{ '--c': color('outcome', viewScore.rule?.outcome) }">
              <span>النتيجة التجريبية</span>
              <b>{{ viewScore.score }}%</b>
              <span v-if="viewScore.rule">{{ label('outcome', viewScore.rule.outcome) }}<template v-if="viewScore.rule.contributionPercent"> · يتحمل المستفيد {{ viewScore.rule.contributionPercent }}%</template></span>
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <template v-if="awaitsMe(viewing)">
            <button v-if="viewing.status === 'review'" class="btn btn-primary" @click="act(viewing, 'review')">تمت مراجعة الجودة</button>
            <button v-if="viewing.status === 'reviewed'" class="btn btn-primary" @click="act(viewing, 'approve')">اعتماد النموذج</button>
            <button class="btn" @click="sendBack(viewing)">إرجاع إلى المسودة</button>
          </template>
          <button v-if="viewing.status === 'draft' && mode === 'manage'" class="btn btn-primary" @click="act(viewing, 'submit')">إرسال للمراجعة</button>
          <button type="button" class="btn" @click="viewing = null">إغلاق</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pane-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.pane-head p { margin: 0; max-width: 720px; }
.empty { padding: 26px; text-align: center; color: var(--muted); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.fcard { padding: 16px; display: flex; flex-direction: column; animation: rise .45s calc(var(--i) * 60ms) var(--ease) both; border-top: 3px solid #818cf8; }
.fcard h3 { font-size: 1rem; }
.small { font-size: .82rem; margin: 4px 0 0; }
.fields { margin: 10px 0; padding-inline-start: 18px; font-size: .88rem; flex: 1; }
.req { color: var(--danger); margin-inline-start: 4px; }
.acts { display: flex; gap: 6px; flex-wrap: wrap; }
.qrow { margin-bottom: 6px; }
.qcode { direction: ltr; display: inline-block; font-size: .72rem; font-weight: 700; letter-spacing: .03em; padding: 2px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); }
.pv-title .qcode { float: inline-end; }
.qcode.missing { color: var(--danger); border-color: var(--danger); direction: rtl; }
.flowbar { list-style: none; display: flex; gap: 4px; padding: 0; margin: 10px 0 2px; }
.flowbar li { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: .68rem; color: var(--muted); position: relative; text-align: center; }
.flowbar li:not(:last-child)::after { content: ''; position: absolute; top: 12px; inset-inline-start: calc(50% + 14px); width: calc(100% - 28px); height: 2px; background: var(--border); }
.flowbar li.done:not(:last-child)::after { background: #10b981; }
.flowbar i { font-style: normal; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--surface-2); border: 2px solid var(--border); font-size: .75rem; }
.flowbar .done i { background: #10b981; border-color: #10b981; color: #fff; }
.flowbar .now i { border-color: #f59e0b; color: #b45309; box-shadow: 0 0 0 4px #f59e0b33; animation: pulse 1.6s infinite; }
.flowbar .now span { color: #b45309; font-weight: 700; }
@keyframes pulse { 50% { box-shadow: 0 0 0 7px #f59e0b11; } }
.hbtn { margin-inline-start: auto; }
.hist { list-style: none; padding: 10px 0 0; margin: 10px 0 0; border-top: 1px dashed var(--border); display: flex; flex-direction: column; gap: 8px; font-size: .8rem; }
.hist li { display: flex; flex-direction: column; padding-inline-start: 10px; border-inline-start: 3px solid #818cf8; }
.hist li.approved { border-color: #10b981; } .hist li.returned { border-color: var(--danger); } .hist li.reviewed { border-color: #0ea5e9; }
.hist q { color: var(--danger); }
.namecode { display: grid; grid-template-columns: 1fr 180px; gap: 10px; }
.ltr { direction: ltr; text-align: left; }
.meta { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.st { font-size: .72rem; font-weight: 700; padding: 2px 8px; border-radius: 99px; }
.st.draft { background: #f1f5f9; color: #475569; } .st.review, .st.reviewed { background: #fef3c7; color: #92400e; } .st.approved { background: #dcfce7; color: #166534; }
.place { font-size: .72rem; padding: 2px 8px; border-radius: 99px; background: var(--primary-soft); color: var(--primary); }
.who { min-height: 1em; }
.target { padding: 12px; border: 1px dashed var(--primary); border-radius: 12px; margin-bottom: 14px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.alert-warn { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
.builder { max-width: 1000px; }
.mt { margin-bottom: 14px; }
.cols { display: grid; grid-template-columns: 1.1fr 1fr; gap: 18px; }
.sec { font-weight: 700; color: var(--primary); margin: 6px 0 10px; }
.flist { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.frow { padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); display: flex; flex-direction: column; gap: 8px; }
.r1 { display: grid; grid-template-columns: 1fr 160px; gap: 8px; }
.r2 { display: flex; justify-content: space-between; align-items: center; font-size: .88rem; }
.mv { display: flex; gap: 2px; }
.icon { background: var(--surface); border: 1px solid var(--border); cursor: pointer; width: 30px; height: 30px; border-radius: 8px; color: var(--muted); }
.icon:disabled { opacity: .35; }
.icon.danger:hover { background: var(--danger-soft); color: var(--danger); }
.preview { position: sticky; top: 0; align-self: start; }
.pv { padding: 16px; border-style: dashed; }
.pv-title { font-weight: 700; margin: 0 0 12px; }
textarea.input { resize: vertical; }
.sbadge { font-size: .7rem; font-weight: 700; background: linear-gradient(135deg, #f59e0b, #ec4899); color: #fff; padding: 2px 8px; border-radius: 99px; vertical-align: middle; }
.wchip { margin-inline-start: 6px; font-size: .72rem; font-weight: 700; color: var(--primary); background: var(--primary-soft); padding: 1px 6px; border-radius: 99px; }
.rchips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
.rchip { font-size: .72rem; padding: 2px 8px; border-radius: 99px; border: 1px solid var(--c); color: var(--c); }
.scored-toggle { display: flex; gap: 10px; align-items: flex-start; padding: 12px; border: 1px dashed var(--primary); border-radius: 12px; background: var(--primary-soft); cursor: pointer; margin-bottom: 10px; }
.scored-toggle input { margin-top: 4px; }
.wmeter { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; font-size: .88rem; color: var(--warning, #f59e0b); }
.wmeter.ok { color: var(--success, #10b981); }
.wmeter.over { color: var(--danger); }
.wbar { height: 8px; border-radius: 99px; background: var(--surface-2); overflow: hidden; }
.wbar i { display: block; height: 100%; background: currentColor; border-radius: inherit; transition: width .4s var(--ease); box-shadow: 0 0 12px currentColor; }
.wrow { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); }
.wlabel { display: flex; align-items: center; gap: 6px; font-size: .88rem; font-weight: 600; }
.wnum { width: 80px; padding: 4px 8px; }
.oscores { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.oscore { display: flex; align-items: center; gap: 4px; font-size: .85rem; }
.rules { display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }
.rule { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px; border-radius: 10px; border: 1px solid var(--border); border-inline-start: 4px solid var(--c); font-size: .88rem; }
.outsel { width: auto; flex: 1; min-width: 150px; padding: 4px 8px; }
.pscore { margin-top: 14px; padding: 12px; border-radius: 12px; border: 1px solid var(--c); display: flex; flex-direction: column; align-items: center; gap: 2px; color: var(--c); }
.pscore b { font-size: 1.8rem; }
.pscore span:first-child { font-size: .8rem; color: var(--muted); }
.list-move, .list-enter-active, .list-leave-active { transition: all .3s var(--ease); }
.list-enter-from, .list-leave-to { opacity: 0; transform: translateX(-16px); }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } }
.fv-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.fv-head .mt { margin: 6px 0; }
.fullview .meta { margin: 8px 0; }
.tbl-wrap { overflow-x: auto; }
.fv-table { width: 100%; border-collapse: collapse; font-size: .85rem; }
.fv-table th, .fv-table td { padding: 7px 8px; border-bottom: 1px solid var(--border); text-align: start; vertical-align: top; }
.fv-table th { color: var(--muted); font-weight: 600; background: var(--surface-2); }
.opt { display: inline-block; margin: 2px; padding: 1px 7px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); font-size: .76rem; }
@media (max-width: 800px) { .cols { grid-template-columns: 1fr; } .r1 { grid-template-columns: 1fr; } }
</style>
