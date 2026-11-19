<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { errMsg, fmtDateTime, FORMULA_TARGET, num, P } from '../lib';
import '../../projects/projects.css';
import '../../risk/risk.css';
import '../planning.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const toast = useToast();
const data = ref<any>(null);
const error = ref('');
const canManage = computed(() => session.can(P.formulas));
const STATUS: Record<string, { label: string; color: string }> = { active: { label: 'فعالة', color: '#10b981' }, draft: { label: 'تحت التجربة', color: '#f59e0b' }, archived: { label: 'موقوفة', color: '#94a3b8' } };
const hist = ref<string | null>(null);

async function load() {
  try { data.value = await api<any>('/planning/formulas'); } catch (e) { error.value = errMsg(e); }
}
onMounted(load);

// المحرر والتجربة
const ed = reactive<any>({ open: false, id: null, code: '', name: '', target: 'opex', expression: '', description: '', status: 'active', note: '', isSystem: false });
const test = reactive<any>({ vars: {} as Record<string, number>, result: null, busy: false });
const vars = computed(() => {
  if (!data.value) return [];
  const b = ed.target === 'any' ? Object.values(data.value.builtins).flat() : data.value.builtins[ed.target] ?? [];
  return [...b, ...data.value.defaultVariables.map((v: any) => ({ key: v.key, name: v.name }))];
});
const SAMPLE: Record<string, number> = {
  basic: 8000, housing: 2000, transport: 800, other: 0, gross: 10800, raise: 0.05, gosi: 1170, eos: 375, month: 1, is_saudi: 1, service_years: 3, is_new: 0,
  active_months: 12, rating_score: 85, hist_avg: 120000, hist_last: 130000, hist_trend: 0.06, growth: 0.03, volume_ratio: 1.1,
};
function open(f: any | null) {
  Object.assign(ed, f
    ? { open: true, id: f.id, code: f.code, name: f.name, target: f.target, expression: f.expression, description: f.description ?? '', status: f.status, note: '', isSystem: f.isSystem }
    : { open: true, id: null, code: '', name: '', target: 'opex', expression: '', description: '', status: 'draft', note: '', isSystem: false });
  test.vars = { ...SAMPLE, ...Object.fromEntries(data.value.defaultVariables.map((v: any) => [v.key, v.value])) };
  test.result = null;
  runTest();
}
function insert(t: string) { ed.expression = `${ed.expression}${ed.expression && !/\s$/.test(ed.expression) ? ' ' : ''}${t}`; runTest(); }
let timer: ReturnType<typeof setTimeout> | null = null;
function runTest() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!ed.expression.trim()) { test.result = null; return; }
    try {
      const used = Object.fromEntries(Object.entries(test.vars).filter(([, v]) => v !== '' && v !== null).map(([k, v]) => [k, Number(v)]));
      test.result = await api<any>('/planning/formulas/test', { method: 'POST', json: { expression: ed.expression, target: ed.target, vars: used } });
    } catch (e) {
      test.result = { error: errMsg(e) };
    }
  }, 350);
}
async function save() {
  try {
    const body: any = { name: ed.name, expression: ed.expression, description: ed.description || null, status: ed.status };
    const r = ed.id
      ? await api<any>(`/planning/formulas/${ed.id}`, { method: 'PATCH', json: { ...body, note: ed.note || null } })
      : await api<any>('/planning/formulas', { method: 'POST', json: { ...body, code: ed.code, target: ed.target } });
    toast.success(r.unknownVariables?.length ? `حُفظت المعادلة. متغيرات تحتاج تعريفًا في افتراضات الموازنة: ${r.unknownVariables.join('، ')}` : 'حُفظت المعادلة');
    ed.open = false;
    load();
  } catch (e) { toast.error(errMsg(e)); }
}
async function remove(f: any) {
  if (!confirm(`حذف المعادلة ${f.code}؟`)) return;
  try { await api(`/planning/formulas/${f.id}`, { method: 'DELETE' }); load(); } catch (e) { toast.error(errMsg(e)); }
}
const groups = computed(() => Object.keys(FORMULA_TARGET).map((t) => ({ t, list: (data.value?.formulas ?? []).filter((f: any) => f.target === t) })).filter((g) => g.list.length));
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>المعادلات والافتراضات</h1>
        <p class="muted">معادلات احتساب الموازنة مكتوبة بصيغة بسيطة وآمنة، ولكل معادلة إصدارات موثقة. الموازنة المعتمدة تحتفظ بنتائجها وبرقم إصدار المعادلة التي حُسبت بها، فتعديل المعادلة لا يغير الماضي.</p></div>
      <button v-if="canManage && data" class="btn pl-glow" @click="open(null)">+ معادلة</button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="data">
      <section v-for="g in groups" :key="g.t" class="card pm-panel">
        <h2>{{ FORMULA_TARGET[g.t] }}</h2>
        <div class="bg-flist">
          <div v-for="f in g.list" :key="f.id" class="bg-fcard">
            <div class="pl-flex"><span class="rk-code">{{ f.code }}</span><b>{{ f.name }}</b>
              <span class="pm-pill" :style="{ '--c': STATUS[f.status].color }">{{ STATUS[f.status].label }}</span>
              <span class="pm-tag">إصدار {{ f.version }}</span><span v-if="f.isSystem" class="pm-tag">أساسية</span>
              <span class="pm-muted" style="margin-inline-start: auto">مستخدمة في {{ f.budgets }} موازنة</span></div>
            <code class="bg-formula big" dir="ltr">{{ f.expression }}</code>
            <p v-if="f.description" class="pm-muted" style="margin: 0">{{ f.description }}</p>
            <div class="pl-flex">
              <button v-if="canManage" class="btn btn-sm" @click="open(f)">تعديل وتجربة</button>
              <button class="btn btn-sm" @click="hist = hist === f.id ? null : f.id">سجل الإصدارات ({{ f.history.length }})</button>
              <button v-if="canManage && !f.isSystem && !f.budgets" class="btn btn-sm btn-danger" @click="remove(f)">حذف</button>
            </div>
            <ul v-if="hist === f.id" class="rk-log">
              <li v-for="h in [...f.history].reverse()" :key="h.version"><b>إصدار {{ h.version }}</b>
                <span><code dir="ltr">{{ h.expression }}</code> · {{ h.byName }} · {{ fmtDateTime(h.at) }}<span v-if="h.note" class="pm-muted"> — {{ h.note }}</span></span></li>
            </ul>
          </div>
        </div>
      </section>
      <section class="card pm-panel">
        <h2>الدوال المتاحة</h2>
        <div class="bg-vars"><span v-for="fn in data.functions" :key="fn.name">{{ fn.label }}</span></div>
        <p class="pm-muted">العمليات: + − × ÷ ^ والمقارنة (&lt; &gt; = &lt;&gt;). تُقبل الأرقام العربية والفاصلة العشرية العربية. القسمة على صفر تعطي صفرًا مع تنبيه.</p>
      </section>
    </template>

    <div v-if="ed.open" class="modal-backdrop" @click.self="ed.open = false">
      <form class="card modal modal-wide" @submit.prevent="save">
        <h2>{{ ed.id ? `تعديل ${ed.code}` : 'معادلة جديدة' }}</h2>
        <div class="rk-fields">
          <label v-if="!ed.id" class="field"><span>الرمز (إنجليزي)</span><input v-model="ed.code" class="input bg-code" dir="ltr" required placeholder="OPEX_FUEL" /></label>
          <label class="field"><span>الاسم</span><input v-model="ed.name" class="input" required /></label>
          <label class="field"><span>تُستخدم في</span><select v-model="ed.target" class="input" :disabled="!!ed.id" @change="runTest"><option v-for="(l, k) in FORMULA_TARGET" :key="k" :value="k">{{ l }}</option></select></label>
          <label class="field"><span>الحالة</span><select v-model="ed.status" class="input" :disabled="ed.isSystem"><option v-for="(s, k) in STATUS" :key="k" :value="k">{{ s.label }}</option></select></label>
        </div>
        <label class="field"><span>المعادلة</span><textarea v-model="ed.expression" class="input bg-code" dir="ltr" rows="3" required @input="runTest" /></label>
        <div class="bg-chips" dir="ltr">
          <button v-for="v in vars" :key="v.key" type="button" :title="v.name" @click="insert(v.key)">{{ v.key }}</button>
          <button v-for="fn in data.functions" :key="fn.name" type="button" class="fn" :title="fn.label" @click="insert(`${fn.name}(`)">{{ fn.name }}()</button>
        </div>
        <div class="bg-test">
          <div>
            <div class="rk-sec">قيم التجربة</div>
            <div class="bg-tvars">
              <label v-for="v in vars" :key="v.key" :title="v.name"><span dir="ltr">{{ v.key }}</span><input v-model="test.vars[v.key]" type="number" step="any" class="input" @input="runTest" /></label>
            </div>
          </div>
          <div class="bg-result">
            <small>النتيجة</small>
            <b v-if="test.result && test.result.value !== null && !test.result.error">{{ num(test.result.value, 2) }}</b>
            <p v-else-if="test.result?.error" class="bg-err">{{ test.result.error }}</p>
            <p v-else class="pm-muted">اكتب المعادلة لترى النتيجة</p>
            <div v-if="test.result?.used" class="bg-vars"><span v-for="(v, k) in test.result.used" :key="k"><i>{{ k }}</i>{{ num(v as number, 4) }}</span></div>
            <p v-if="test.result?.warnings?.length" class="rk-warn">{{ test.result.warnings.join(' · ') }}</p>
            <p v-if="test.result?.unknownVariables?.length" class="rk-warn">متغيرات غير معرّفة في النظام: {{ test.result.unknownVariables.join('، ') }}. عرّفها في افتراضات الموازنة بنفس الرمز.</p>
          </div>
        </div>
        <label class="field"><span>الوصف</span><textarea v-model="ed.description" class="input" rows="2" /></label>
        <label v-if="ed.id" class="field"><span>سبب التعديل (يُحفظ في سجل الإصدارات)</span><input v-model="ed.note" class="input" /></label>
        <p v-if="ed.id" class="pm-muted">حفظ صيغة جديدة يرفع إصدار المعادلة. الموازنات المحتسبة تُنبّه بأن بنودها حُسبت بإصدار سابق حتى يُعاد احتسابها.</p>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="ed.open = false">إغلاق</button></div>
      </form>
    </div>
  </div>
</template>
