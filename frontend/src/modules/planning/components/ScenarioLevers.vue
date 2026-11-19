<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { errMsg, FUNDING, money, MONTHS, SECTIONS } from '../lib';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** مؤثرات السيناريو: نسب تغيير وتأجيلات على البنود المطابقة، تُطبّق بعد الاحتساب وتظهر في خطوات كل بند */
const props = defineProps<{ budget: any; lookups: any; editable: boolean }>();
const emit = defineEmits<{ (e: 'saved', v: any): void }>();
const toast = useToast();
const busy = ref(false);
const s = reactive<{ levers: any[] }>({ levers: [] });
function reset() {
  s.levers = JSON.parse(JSON.stringify(props.budget.levers ?? [])).map((l: any) => ({ ...l, scope: { sections: [], unitId: null, fundingType: null, accountId: null, lineIds: [], ...l.scope } }));
}
watch(() => props.budget, reset, { immediate: true });

const PRESETS = [
  { label: 'انخفاض الإيرادات', lever: { name: 'انخفاض الإيرادات', type: 'pct', value: -20, scope: { sections: ['revenue'] } } },
  { label: 'تضخم المصروفات التشغيلية', lever: { name: 'ارتفاع الأسعار', type: 'pct', value: 5, fromMonth: 7, scope: { sections: ['opex'] } } },
  { label: 'تخفيض الأنشطة', lever: { name: 'تخفيض الأنشطة', type: 'pct', value: -15, scope: { sections: ['activity'] } } },
  { label: 'تأجيل الأنشطة', lever: { name: 'تأجيل الأنشطة', type: 'shift', value: 3, scope: { sections: ['activity'] } } },
  { label: 'تأخر تحصيل الإيرادات', lever: { name: 'تأخر تحصيل الإيرادات', type: 'shift', value: 2, scope: { sections: ['revenue'] } } },
];
function addLever(p?: any) {
  s.levers.push({
    key: `lv${Date.now()}`, name: '', type: 'pct', value: 0, fromMonth: 1, note: '',
    ...(p ? JSON.parse(JSON.stringify(p)) : {}),
    scope: { sections: [], unitId: null, fundingType: null, accountId: null, lineIds: [], ...(p?.scope ?? {}) },
  });
}
const lineOptions = computed(() => (props.budget.lines ?? []).filter((l: any) => !l.masked).map((l: any) => ({ id: l.id, label: `${SECTIONS[l.section]?.label}: ${l.name}` })));
const lineName = (id: string) => {
  const l = (props.budget.lines ?? []).find((x: any) => x.id === id || x.baseLineId === id);
  return l ? `${SECTIONS[l.section]?.label}: ${l.name}` : 'بند';
};
function toggleSection(l: any, k: string) {
  const i = l.scope.sections.indexOf(k);
  if (i >= 0) l.scope.sections.splice(i, 1); else l.scope.sections.push(k);
}
function addLine(l: any, e: Event) {
  const el = e.target as HTMLSelectElement;
  if (el.value && !l.scope.lineIds.includes(el.value)) l.scope.lineIds.push(el.value);
  el.value = '';
}
async function save() {
  busy.value = true;
  try {
    const body = s.levers.map((l) => ({ ...l, value: Number(l.value), scope: { ...l.scope, unitId: l.scope.unitId || null, fundingType: l.scope.fundingType || null, accountId: l.scope.accountId || null } }));
    emit('saved', await api(`/planning/budgets/${props.budget.id}`, { method: 'PATCH', json: { levers: body } }));
    toast.success('حُفظت المؤثرات وأُعيد احتساب السيناريو');
  } catch (e) {
    toast.error(errMsg(e));
  } finally {
    busy.value = false;
  }
}
/** أثر كل مؤثر من خطوات احتساب البنود */
const impact = computed(() => {
  const out: Record<string, { lines: number; diff: number }> = {};
  for (const l of props.budget.lines ?? []) {
    let prev: number | null = null;
    for (const t of l.trace ?? []) {
      const m = /^مؤثر السيناريو «(.+?)»/.exec(t.label);
      if (m) {
        const before = prev ?? t.value;
        const o = (out[m[1]] ??= { lines: 0, diff: 0 });
        o.lines++;
        o.diff += (t.value - before) * (l.section === 'revenue' ? 1 : -1) * (l.included ? 1 : 0);
      }
      prev = t.value;
    }
  }
  return out;
});
</script>

<template>
  <section class="card pm-panel">
    <h2><span>مؤثرات السيناريو</span>
      <span v-if="editable" class="pl-flex"><button v-for="p in PRESETS" :key="p.label" class="btn btn-sm" @click="addLever(p.lever)">+ {{ p.label }}</button>
        <button class="btn btn-sm" @click="addLever()">+ مؤثر</button></span></h2>
    <p class="pm-muted">المؤثر يغيّر نتيجة البنود المطابقة بعد احتسابها: نسبة زيادة أو خفض من شهر معين، أو تأجيل عدد من الأشهر (ما يتجاوز ديسمبر ينتقل للسنة التالية).
      ولتغيير العلاوات أو التضخم أو التوظيف عدّل «الافتراضات والعلاوات» أو البنود نفسها في هذا السيناريو.</p>
    <div v-for="(l, i) in s.levers" :key="l.key" class="bg-rule sc-lever">
      <div class="rk-fields">
        <label class="field"><span>اسم المؤثر</span><input v-model="l.name" class="input" :disabled="!editable" /></label>
        <label class="field"><span>النوع</span><select v-model="l.type" class="input" :disabled="!editable"><option value="pct">نسبة زيادة أو خفض</option><option value="shift">تأجيل بالأشهر</option></select></label>
        <label class="field"><span>{{ l.type === 'pct' ? 'النسبة % (بالسالب للخفض)' : 'عدد أشهر التأجيل' }}</span><input v-model="l.value" type="number" step="any" class="input" :disabled="!editable" /></label>
        <label v-if="l.type === 'pct'" class="field"><span>يسري من</span><select v-model.number="l.fromMonth" class="input" :disabled="!editable"><option v-for="(m, j) in MONTHS" :key="j" :value="j + 1">{{ m }}</option></select></label>
        <label class="field"><span>الإدارة</span><select v-model="l.scope.unitId" class="input" :disabled="!editable"><option :value="null">الكل</option><option v-for="u in lookups.units" :key="u.id" :value="u.id">{{ u.name }}</option></select></label>
        <label class="field"><span>التمويل</span><select v-model="l.scope.fundingType" class="input" :disabled="!editable"><option :value="null">الكل</option><option v-for="(f, k) in FUNDING" :key="k" :value="k">{{ f }}</option></select></label>
        <label class="field"><span>الحساب</span><select v-model="l.scope.accountId" class="input" :disabled="!editable"><option :value="null">الكل</option><option v-for="a in lookups.accounts" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select></label>
      </div>
      <div class="pl-flex">
        <span class="pm-muted">الأقسام:</span>
        <label v-for="(sec, k) in SECTIONS" :key="k" class="pl-flex"><input type="checkbox" :checked="l.scope.sections.includes(k)" :disabled="!editable" @change="toggleSection(l, String(k))" /> {{ sec.label }}</label>
        <span v-if="!l.scope.sections.length" class="pm-muted">(كل الأقسام)</span>
      </div>
      <div class="pl-flex">
        <span class="pm-muted">بنود محددة:</span>
        <span v-for="(id, j) in l.scope.lineIds" :key="id" class="pm-tag">{{ lineName(id) }}<button v-if="editable" type="button" class="sc-x" @click="l.scope.lineIds.splice(j, 1)">✕</button></span>
        <template v-if="editable"><select value="" class="input" style="width: auto; max-width: 320px" @change="addLine(l, $event)"><option value="">+ اختر بندًا</option><option v-for="o in lineOptions" :key="o.id" :value="o.id">{{ o.label }}</option></select></template>
        <span v-if="!l.scope.lineIds.length" class="pm-muted">(عند تحديد بنود يُطبّق عليها فقط وتُهمل الشروط الأخرى)</span>
      </div>
      <div class="pl-flex">
        <input v-model="l.note" class="input" placeholder="سبب المؤثر أو مصدره" style="flex: 1" :disabled="!editable" />
        <span v-if="impact[l.name]" class="pm-pill" :style="{ '--c': impact[l.name].diff < 0 ? '#dc2626' : '#059669' }">أثره على الصافي {{ money(impact[l.name].diff) }} · {{ impact[l.name].lines }} بند</span>
        <button v-if="editable" class="btn btn-sm" @click="s.levers.splice(i, 1)">حذف</button>
      </div>
    </div>
    <p v-if="!s.levers.length" class="pm-empty">لا توجد مؤثرات. أضف مؤثرًا جاهزًا من الأزرار أعلاه.</p>
    <div v-if="editable" class="pm-actions" style="margin-top: 12px">
      <button class="btn btn-primary" :disabled="busy" @click="save">حفظ وإعادة احتساب السيناريو</button>
      <button class="btn" :disabled="busy" @click="reset">تراجع</button>
    </div>
  </section>
</template>
