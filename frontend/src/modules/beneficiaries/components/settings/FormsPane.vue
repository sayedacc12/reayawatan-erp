<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../../api';
import { useToast } from '../../../../stores/toast';
import { FIELD_TYPES, OUTCOMES, color, label, scoreOf } from '../../labels';
import type { DynamicForm, FormField, ScoreRule } from '../../types';
import DynamicFields from '../DynamicFields.vue';

const toast = useToast();
const forms = ref<DynamicForm[]>([]);
const error = ref('');

async function load() {
  try {
    forms.value = await api<DynamicForm[]>('/beneficiaries/settings/forms');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

type EditField = FormField & { optionsText: string; scoresText: string[] };
const open = ref(false);
const editing = ref<DynamicForm | null>(null);
const formError = ref('');
const form = reactive({ name: '', description: '', scored: false, fields: [] as EditField[], rules: [] as ScoreRule[] });
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
    name: f?.name ?? '', description: f?.description ?? '', scored: !!f?.scored, rules: (f?.rules ?? []).map((r) => ({ ...r })),
    fields: f ? f.fields.map(toEdit) : [toEdit({ key: '', label: '', type: 'text', required: false })],
  });
  open.value = true;
}
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
    if (!weightOk.value) {
      formError.value = `إجمالي الأهمية النسبية لازم يكون 100%، الإجمالي دلوقتي ${totalWeight.value}%`;
      return;
    }
    const body = {
      name: form.name, description: form.description, scored: form.scored, fields: cleanFields(),
      rules: form.scored ? form.rules.map((r) => ({ ...r, contributionPercent: r.outcome === 'contribution' ? r.contributionPercent : undefined })) : [],
    };
    if (editing.value) await api(`/beneficiaries/settings/forms/${editing.value.id}`, { method: 'PUT', json: body });
    else await api('/beneficiaries/settings/forms', { method: 'POST', json: body });
    open.value = false;
    toast.success('تم حفظ النموذج');
    await load();
  } catch (e) {
    formError.value = (e as Error).message;
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
      <p class="muted">النماذج بتتربط بمراحل سير العمل (زي نموذج البحث الاجتماعي) أو بتقديم الطلب. ضيف الحقول اللي محتاجها وغيّرها في أي وقت.</p>
      <button class="btn btn-primary btn-sm" @click="openForm()">+ نموذج جديد</button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <p v-if="!forms.length && !error" class="card empty">لا توجد نماذج بعد.</p>
    <div class="grid">
      <article v-for="(f, i) in forms" :key="f.id" class="card fcard" :style="{ '--i': i }">
        <h3>{{ f.name }} <span v-if="f.scored" class="sbadge">تقييم آلي</span></h3>
        <p v-if="f.description" class="muted small">{{ f.description }}</p>
        <ul class="fields"><li v-for="x in f.fields" :key="x.key">{{ x.label }}<span class="muted"> · {{ label('field', x.type) }}</span><b v-if="x.required" class="req">*</b><span v-if="x.weight" class="wchip">{{ x.weight }}%</span></li></ul>
        <div v-if="f.scored && f.rules?.length" class="rchips">
          <span v-for="(r, j) in f.rules" :key="j" class="rchip" :style="{ '--c': color('outcome', r.outcome) }">{{ r.min }}–{{ r.max }}%: {{ label('outcome', r.outcome) }}<template v-if="r.contributionPercent"> {{ r.contributionPercent }}%</template></span>
        </div>
        <div class="acts"><button class="btn btn-sm" @click="openForm(f)">تعديل</button><button class="btn btn-sm btn-danger" @click="remove(f)">حذف</button></div>
      </article>
    </div>

    <div v-if="open" class="modal-backdrop" @click.self="open = false">
      <form class="card modal builder" @submit.prevent="save">
        <h2 class="mt">{{ editing ? 'تعديل النموذج' : 'نموذج جديد' }}</h2>
        <div v-if="formError" class="alert alert-error">{{ formError }}</div>
        <div class="cols">
          <div>
            <div class="field"><label>اسم النموذج *</label><input v-model="form.name" class="input" required placeholder="مثال: نموذج البحث الاجتماعي" /></div>
            <div class="field"><label>الوصف</label><input v-model="form.description" class="input" /></div>
            <label class="scored-toggle">
              <input v-model="form.scored" type="checkbox" @change="toggleScored" />
              <span><b>نموذج تقييم آلي</b><br /><small class="muted">كل بند ليه أهمية نسبية، والنظام بيحسب نتيجة من 100 ويقترح القرار ونسبة مساهمة المستفيد</small></span>
            </label>
            <div v-if="form.scored" :class="['wmeter', { ok: weightOk, over: totalWeight > 100 }]">
              <div class="wbar"><i :style="{ width: `${Math.min(totalWeight, 100)}%` }" /></div>
              <span>إجمالي الأهمية النسبية: <b>{{ totalWeight }}%</b> <template v-if="!weightOk">(لازم يكون 100%)</template><template v-else>✓</template></span>
            </div>
            <p class="sec">الحقول</p>
            <TransitionGroup name="list" tag="div" class="flist">
              <div v-for="(f, i) in form.fields" :key="f.key || `n${i}`" class="frow">
                <div class="r1">
                  <input v-model="f.label" class="input" placeholder="اسم الحقل" required />
                  <select v-model="f.type" class="input type"><option v-for="t in FIELD_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option></select>
                </div>
                <textarea v-if="f.type === 'select'" v-model="f.optionsText" class="input" rows="2" placeholder="الخيارات: كل خيار في سطر" required />
                <div v-if="form.scored && scorable(f)" class="wrow">
                  <label class="wlabel">الأهمية النسبية <input v-model.number="f.weight" type="number" min="0" max="100" step="0.01" class="input wnum" placeholder="0" /> %</label>
                  <div v-if="f.type === 'select' && f.weight && optionsOf(f).length" class="oscores">
                    <span class="muted small">درجة كل اختيار (من 100):</span>
                    <label v-for="(o, j) in optionsOf(f)" :key="o" class="oscore">{{ o }} <input v-model="f.scoresText[j]" type="number" min="0" max="100" class="input wnum" placeholder="0" /></label>
                  </div>
                  <span v-if="f.type === 'checkbox' && f.weight" class="muted small">لو متعلم ياخد الدرجة كاملة</span>
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
              <p class="muted small">حدد النتيجة لكل نطاق: مثلا أقل من 40% رفض، من 40% لـ 70% قبول بمساهمة من المستفيد، وأعلى قبول.</p>
              <div class="rules">
                <div v-for="(r, j) in form.rules" :key="j" class="rule" :style="{ '--c': color('outcome', r.outcome) }">
                  <span>من</span><input v-model.number="r.min" type="number" min="0" max="100" step="0.01" class="input wnum" />
                  <span>لـ</span><input v-model.number="r.max" type="number" min="0" max="100" step="0.01" class="input wnum" />
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
          </div>
          <div class="preview">
            <p class="sec">معاينة</p>
            <div class="pv card">
              <p class="pv-title">{{ form.name || 'اسم النموذج' }}</p>
              <DynamicFields v-model="preview" :fields="cleanFields().filter((f) => f.label)" />
              <div v-if="previewScore" class="pscore" :style="{ '--c': color('outcome', previewScore.rule?.outcome) }">
                <span>النتيجة المقترحة</span>
                <b>{{ previewScore.score }}%</b>
                <span v-if="previewScore.rule">{{ label('outcome', previewScore.rule.outcome) }}<template v-if="previewScore.rule.contributionPercent"> · يتحمل المستفيد {{ previewScore.rule.contributionPercent }}%</template></span>
                <span v-else class="muted">مفيش قاعدة للنتيجة دي</span>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-actions"><button class="btn btn-primary">حفظ النموذج</button><button type="button" class="btn" @click="open = false">إلغاء</button></div>
      </form>
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
.acts { display: flex; gap: 6px; }
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
@media (max-width: 800px) { .cols { grid-template-columns: 1fr; } .r1 { grid-template-columns: 1fr; } }
</style>
