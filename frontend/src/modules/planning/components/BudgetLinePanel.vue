<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { AVG_TYPES, DISTRIBUTION, errMsg, FUNDING, HIST_METHOD, LINE_KIND, money, MONTHS, num, SECTIONS } from '../lib';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** تفاصيل بند الموازنة: خطوات الاحتساب ومصدرها، والتاريخ الفعلي والاستبعادات، ومدخلات التقدير، والتعديل اليدوي بمبرر */
const props = defineProps<{ line: any; budget: any; lookups: any; editable: boolean }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>();
const toast = useToast();
const busy = ref(false);
const tab = ref<'calc' | 'edit'>('calc');
const l = computed(() => props.line);
const isHr = computed(() => l.value.section === 'hr' && ['employee', 'new_position'].includes(l.value.kind));
const isAct = computed(() => ['activity', 'project'].includes(l.value.kind));
const isHist = computed(() => !isHr.value && !isAct.value);
const p = reactive<any>({});
const f = reactive<any>({});
function reset() {
  const src = JSON.parse(JSON.stringify(l.value.params ?? {}));
  Object.keys(p).forEach((k) => delete p[k]);
  Object.assign(p, src);
  p.contracts ??= [];
  p.adjustments ??= [];
  p.excludedEntryIds ??= [];
  p.weights = p.weights?.length === 12 ? p.weights : Array(12).fill(1);
  Object.assign(f, {
    overrideAmount: l.value.overrideAmount, overrideNote: l.value.overrideNote ?? '', included: l.value.included, fundingType: l.value.fundingType ?? '',
    unitId: l.value.unitId ?? '', costCenterId: l.value.costCenterId ?? '', note: l.value.note ?? '', name: l.value.name,
  });
}
watch(() => props.line, reset, { immediate: true });
const formulas = computed(() => (props.lookups?.formulas ?? []).filter((x: any) => x.target === (l.value.section === 'revenue' ? 'revenue' : 'opex') || x.target === 'any'));
const hist = computed(() => l.value.history ?? {});
const histYears = computed(() => Object.entries(hist.value.years ?? {}).map(([y, v]) => ({ y, v: v as number, m: (hist.value.months?.[y] ?? []) as number[] })));
const maxMonth = computed(() => Math.max(1, ...l.value.monthly.map((x: number) => Math.abs(x))));

async function patch(body: any, msg: string) {
  busy.value = true;
  try {
    await api(`/planning/budget-lines/${l.value.id}`, { method: 'PATCH', json: body });
    toast.success(msg);
    emit('saved');
  } catch (e) {
    toast.error(errMsg(e));
  } finally {
    busy.value = false;
  }
}
const n = (v: any) => (v === '' || v === undefined || v === null ? null : Number(v));
function save() {
  const params = { ...p, growth: n(p.growth), volumeBase: n(p.volumeBase), volumeTarget: n(p.volumeTarget), manualAmount: n(p.manualAmount), raisePct: n(p.raisePct) };
  if (params.distribution !== 'custom') delete params.weights;
  const body: any = {
    name: f.name, params, included: f.included, note: f.note || null, unitId: f.unitId || null, costCenterId: f.costCenterId || null,
    overrideAmount: n(f.overrideAmount), overrideNote: f.overrideNote || null,
  };
  if (l.value.section !== 'revenue') body.fundingType = f.fundingType || null;
  patch(body, 'حُفظ البند وأُعيد احتسابه');
}
function toggleExclude(id: string) {
  const s = new Set<string>(p.excludedEntryIds);
  s.has(id) ? s.delete(id) : s.add(id);
  patch({ params: { excludedEntryIds: [...s] } }, s.has(id) ? 'استُبعد القيد من التاريخ' : 'أُعيد القيد للتاريخ');
}
async function refresh() {
  busy.value = true;
  try {
    await api(`/planning/budget-lines/${l.value.id}/refresh`, { method: 'POST', json: {} });
    toast.success('جُلب الفعلي من المحاسبة من جديد');
    emit('saved');
  } catch (e) { toast.error(errMsg(e)); } finally { busy.value = false; }
}
async function remove() {
  if (!confirm(`حذف البند «${l.value.name}»؟`)) return;
  try {
    await api(`/planning/budget-lines/${l.value.id}`, { method: 'DELETE' });
    toast.success('حُذف البند');
    emit('close');
    emit('saved');
  } catch (e) { toast.error(errMsg(e)); }
}
const fmtVar = (k: string, v: number) => (['raise', 'growth', 'inflation', 'hist_trend'].includes(k) || (Math.abs(v) < 1 && v !== 0 && !['is_saudi', 'is_new'].includes(k)) ? `${num(v * 100, 2)}%` : num(v, 2));
</script>

<template>
  <section class="card pm-panel bg-panel">
    <h2>
      <span><span class="pm-pill" :style="{ '--c': SECTIONS[l.section].color }">{{ LINE_KIND[l.kind] ?? l.kind }}</span> {{ l.name }}</span>
      <button class="btn btn-sm" @click="emit('close')">✕</button>
    </h2>
    <p class="pm-muted" style="margin-top: -6px">
      {{ l.unitName ?? 'على مستوى الشركة' }}<template v-if="l.accountCode"> · حساب {{ l.accountCode }} {{ l.accountName }}</template>
      <template v-if="l.costCenterName"> · {{ l.costCenterName }}</template><template v-if="l.fundingType"> · تمويل {{ FUNDING[l.fundingType] }}</template>
      <template v-if="l.sourceRef"> · المصدر {{ l.sourceRef }}</template>
    </p>
    <div class="bg-amounts">
      <div><small>التقدير الآلي</small><b>{{ money(l.auto) }}</b></div>
      <div v-if="l.overrideAmount !== null"><small>المقترح من الإدارة</small><b style="color: #b45309">{{ money(l.overrideAmount) }}</b></div>
      <div><small>{{ l.included ? 'في الموازنة' : 'مستبعد من الإجمالي' }}</small><b :style="{ color: l.included ? '#047857' : '#94a3b8' }">{{ money(l.amount) }}</b></div>
    </div>
    <div class="bg-months" :title="'التوزيع الشهري'">
      <span v-for="(m, i) in l.monthly" :key="i" :style="{ height: `${Math.max(2, (Math.abs(m) / maxMonth) * 46)}px`, '--c': SECTIONS[l.section].color }" :title="`${MONTHS[i]}: ${money(m)}`" />
    </div>
    <div v-if="l.warnings?.length" class="rk-warn" style="margin: 8px 0">{{ l.warnings.join(' · ') }}</div>
    <div v-if="l.note" class="pm-muted" style="margin-bottom: 6px">ملاحظة: {{ l.note }}</div>

    <div v-if="editable && !l.masked" class="rk-tabs pl-tabs" style="margin: 10px 0">
      <button :class="['rk-tab', { on: tab === 'calc' }]" @click="tab = 'calc'">كيف حُسب</button>
      <button :class="['rk-tab', { on: tab === 'edit' }]" @click="tab = 'edit'">تعديل التقدير</button>
    </div>

    <template v-if="tab === 'calc' || !editable">
      <div class="rk-sec">خطوات الاحتساب</div>
      <ol class="bg-trace">
        <li v-for="(t, i) in l.trace" :key="i">
          <div class="pl-flex" style="justify-content: space-between"><b>{{ t.label }}</b><span class="bg-val">{{ num(t.value, 2) }}</span></div>
          <code v-if="t.formula" class="bg-formula">{{ t.formula }}<em v-if="t.formulaCode"> · {{ t.formulaCode }} إصدار {{ t.formulaVersion }}</em></code>
          <div v-if="t.vars" class="bg-vars"><span v-for="(v, k) in t.vars" :key="k"><i>{{ k }}</i>{{ fmtVar(String(k), v as number) }}</span></div>
          <small v-if="t.source" class="pm-muted">المصدر: {{ t.source }}</small>
        </li>
      </ol>
      <template v-if="histYears.length">
        <div class="rk-sec pl-flex" style="justify-content: space-between">التاريخ الفعلي من المحاسبة
          <button v-if="editable && l.accountId" class="btn btn-sm" :disabled="busy" @click="refresh">تحديث من المحاسبة</button></div>
        <table class="table bg-hist">
          <thead><tr><th>السنة</th><th v-for="(m, i) in MONTHS" :key="i">{{ m.slice(0, 3) }}</th><th>الإجمالي</th></tr></thead>
          <tbody><tr v-for="h in histYears" :key="h.y"><td>{{ h.y }}</td><td v-for="(m, i) in h.m" :key="i">{{ m ? num(m, 0) : '' }}</td><td><b>{{ num(h.v, 0) }}</b></td></tr></tbody>
        </table>
        <small class="pm-muted">{{ hist.source }}</small>
        <template v-if="hist.entries?.length">
          <div class="rk-sec">أكبر القيود (استبعد غير المتكرر منها)</div>
          <div class="bg-entries">
            <label v-for="e in hist.entries" :key="e.id" :class="{ off: p.excludedEntryIds.includes(e.id) }">
              <input type="checkbox" :checked="p.excludedEntryIds.includes(e.id)" :disabled="!editable || busy" @change="toggleExclude(e.id)" />
              <span>{{ e.date }} · {{ e.description }}</span><b>{{ num(e.amount, 0) }}</b>
            </label>
          </div>
        </template>
      </template>
    </template>

    <form v-else @submit.prevent="save">
      <label class="field"><span>اسم البند</span><input v-model="f.name" class="input" /></label>
      <template v-if="isHr">
        <div class="rk-sec">بيانات الوظيفة</div>
        <div class="rk-fields">
          <label class="field"><span>الأساسي</span><input v-model.number="p.basic" type="number" step="any" class="input" /></label>
          <label class="field"><span>السكن</span><input v-model.number="p.housing" type="number" step="any" class="input" /></label>
          <label class="field"><span>النقل</span><input v-model.number="p.transport" type="number" step="any" class="input" /></label>
          <label class="field"><span>بدلات أخرى</span><input v-model.number="p.other" type="number" step="any" class="input" /></label>
          <label class="field"><span>العدد</span><input v-model.number="p.count" type="number" min="0" class="input" /></label>
          <label class="field"><span>من شهر</span><select v-model.number="p.startMonth" class="input"><option v-for="(m, i) in MONTHS" :key="i" :value="i + 1">{{ m }}</option></select></label>
          <label class="field"><span>إلى شهر</span><select v-model.number="p.endMonth" class="input"><option v-for="(m, i) in MONTHS" :key="i" :value="i + 1">{{ m }}</option></select></label>
          <label class="field"><span>علاوة خاصة للبند %</span><input v-model="p.raisePct" type="number" step="any" class="input" placeholder="حسب القواعد" /></label>
        </div>
        <label class="pl-flex"><input v-model="p.isSaudi" type="checkbox" /> سعودي (تأمينات حسب النظام)</label>
      </template>
      <template v-else-if="isAct">
        <div class="rk-fields">
          <label class="field"><span>تكلفة السنة</span><input v-model.number="p.cost" type="number" step="any" class="input" :disabled="l.kind === 'activity'" /></label>
          <label class="field"><span>التوزيع</span><select v-model="p.distribution" class="input"><option value="even">على أشهر التنفيذ بالتساوي</option><option value="custom">بأوزان أحددها</option></select></label>
        </div>
        <p v-if="l.kind === 'activity'" class="pm-muted">تكلفة النشاط تأتي من الخطة التشغيلية المعتمدة. لتغييرها عدّل الخطة ثم أعد استيراد الأنشطة، أو استخدم «المقترح من الإدارة».</p>
      </template>
      <template v-else-if="isHist">
        <div class="rk-fields">
          <label class="field"><span>طريقة التقدير</span><select v-model="p.method" class="input"><option v-for="(t, k) in HIST_METHOD" :key="k" :value="k">{{ t }}</option></select></label>
          <label v-if="p.method === 'formula'" class="field"><span>المعادلة</span><select v-model="p.formulaCode" class="input"><option v-for="x in formulas" :key="x.code" :value="x.code">{{ x.name }} ({{ x.code }})</option></select></label>
          <label v-if="p.method === 'manual'" class="field"><span>المبلغ السنوي</span><input v-model="p.manualAmount" type="number" step="any" class="input" /></label>
        </div>
        <template v-if="p.method === 'formula'">
          <div class="rk-fields">
            <label class="field"><span>عدد سنوات التاريخ</span><input v-model.number="p.years" type="number" min="1" max="10" class="input" /></label>
            <label class="field"><span>طريقة المتوسط</span><select v-model="p.avgType" class="input"><option v-for="(t, k) in AVG_TYPES" :key="k" :value="k">{{ t }}</option></select></label>
            <label class="field"><span>نسبة الزيادة للبند (0.05 = 5%)</span><input v-model="p.growth" type="number" step="any" class="input" placeholder="العامة من الافتراضات" /></label>
            <label class="field"><span>حجم العمل الحالي</span><input v-model="p.volumeBase" type="number" step="any" class="input" placeholder="مثل عدد المستفيدين" /></label>
            <label class="field"><span>حجم العمل المتوقع</span><input v-model="p.volumeTarget" type="number" step="any" class="input" /></label>
          </div>
          <label class="pl-flex"><input v-model="p.annualizeCurrent" type="checkbox" /> تحويل السنة الجارية لسنة كاملة من أشهرها المكتملة</label>
        </template>
        <label class="field"><span>التوزيع الشهري</span><select v-model="p.distribution" class="input"><option v-for="(t, k) in DISTRIBUTION" :key="k" :value="k">{{ t }}</option></select></label>
        <div class="rk-sec pl-flex" style="justify-content: space-between">عقود جديدة أو منتهية
          <button type="button" class="btn btn-sm" @click="p.contracts.push({ name: '', amount: 0, fromMonth: 1, toMonth: 12, kind: 'new' })">+ عقد</button></div>
        <div class="pl-mini-list">
          <div v-for="(c, i) in p.contracts" :key="i">
            <input v-model="c.name" class="input" placeholder="اسم العقد" />
            <input v-model.number="c.amount" type="number" class="input" placeholder="القيمة السنوية" />
            <select v-model="c.kind" class="input"><option value="new">جديد (يضيف)</option><option value="ending">ينتهي (يخصم)</option></select>
            <select v-model.number="c.fromMonth" class="input"><option v-for="(m, k) in MONTHS" :key="k" :value="k + 1">من {{ m }}</option></select>
            <select v-model.number="c.toMonth" class="input"><option v-for="(m, k) in MONTHS" :key="k" :value="k + 1">إلى {{ m }}</option></select>
            <button type="button" class="btn btn-sm" @click="p.contracts.splice(i, 1)">✕</button>
          </div>
        </div>
      </template>
      <div v-if="p.distribution === 'custom'" class="bg-weights">
        <label v-for="(m, i) in MONTHS" :key="i" class="field"><span>{{ m }}</span><input v-model.number="p.weights[i]" type="number" min="0" step="any" class="input" /></label>
      </div>
      <div class="rk-sec">الإدارة والتمويل</div>
      <div class="rk-fields">
        <label class="field"><span>الإدارة</span><select v-model="f.unitId" class="input"><option value="">الشركة</option><option v-for="u in lookups.units" :key="u.id" :value="u.id">{{ u.name }}</option></select></label>
        <label class="field"><span>مركز التكلفة</span><select v-model="f.costCenterId" class="input"><option value="">—</option><option v-for="c in lookups.costCenters" :key="c.id" :value="c.id">{{ c.code }} {{ c.name }}</option></select></label>
        <label v-if="l.section !== 'revenue'" class="field"><span>نوع التمويل</span><select v-model="f.fundingType" class="input"><option value="">—</option><option v-for="(t, k) in FUNDING" :key="k" :value="k">{{ t }}</option></select></label>
      </div>
      <div class="rk-sec">المقترح من الإدارة (يتجاوز التقدير الآلي)</div>
      <div class="rk-fields">
        <label class="field"><span>المبلغ</span><input v-model="f.overrideAmount" type="number" step="any" class="input" placeholder="فارغ = التقدير الآلي" /></label>
        <label class="field" style="grid-column: span 2"><span>المبرر (إلزامي)</span><input v-model="f.overrideNote" class="input" /></label>
      </div>
      <label class="pl-flex"><input v-model="f.included" type="checkbox" /> يدخل في إجمالي الموازنة</label>
      <label class="field"><span>ملاحظة</span><input v-model="f.note" class="input" /></label>
      <div class="pm-actions">
        <button class="btn btn-primary" :disabled="busy">حفظ وإعادة الاحتساب</button>
        <button type="button" class="btn" @click="reset">تراجع</button>
        <button type="button" class="btn btn-danger" style="margin-inline-start: auto" @click="remove">حذف البند</button>
      </div>
    </form>
  </section>
</template>
