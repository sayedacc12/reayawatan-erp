<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { FREQUENCIES, P, STATUS_COLOR, errMsg, label, loadSettings, num, thisYear, type QSettings } from '../lib';
import '../../../shared/module.css';
import '../quality.css';

interface Obj {
  id: string; year: number; title: string; kpi: string; unit: string; baseline: number | null; target: number; direction: 'increase' | 'decrease'; frequency: string;
  autoMetric: string | null; metricLabel: string | null; department: string; departmentName: string; ownerName: string; plan: string | null; isActive: boolean;
  measurements: { period: string; value: number; note: string | null; byName: string }[]; current: number | null; progress: number | null; status: string; statusLabel: string;
}
const session = useSession();
const toast = useToast();
const year = ref(thisYear());
const rows = ref<Obj[]>([]);
const metrics = ref<{ value: string; label: string; unit: string; direction: 'increase' | 'decrease' }[]>([]);
const settings = ref<QSettings | null>(null);
async function load() {
  const r = await api<{ rows: Obj[]; metrics: typeof metrics.value }>(`/quality/objectives?year=${year.value}`);
  rows.value = r.rows;
  metrics.value = r.metrics;
}
onMounted(async () => {
  settings.value = await loadSettings();
  await load();
});
watch(year, load);
const empty = () => ({ id: '', title: '', kpi: '', unit: '%', baseline: null as number | null, target: 0, direction: 'increase' as 'increase' | 'decrease', frequency: 'quarterly', autoMetric: '' as string, department: 'QMS', ownerName: '', plan: '', isActive: true });
const form = reactive({ show: false, ...empty() });
function edit(o?: Obj) {
  Object.assign(form, empty(), o ? { ...o, autoMetric: o.autoMetric ?? '', plan: o.plan ?? '' } : {}, { show: true });
}
function pickMetric() {
  const m = metrics.value.find((x) => x.value === form.autoMetric);
  if (m) Object.assign(form, { kpi: m.label, unit: m.unit, direction: m.direction });
}
async function save() {
  try {
    const body = { year: year.value, title: form.title, kpi: form.kpi, unit: form.unit, baseline: form.baseline ?? null, target: form.target, direction: form.direction, frequency: form.frequency, autoMetric: form.autoMetric || null, department: form.department, ownerName: form.ownerName, plan: form.plan || null, isActive: form.isActive };
    await api(form.id ? `/quality/objectives/${form.id}` : '/quality/objectives', { method: form.id ? 'PUT' : 'POST', json: body });
    form.show = false;
    toast.success('حُفظ الهدف');
    await load();
  } catch (e) {
    toast.error(errMsg(e));
  }
}
const m = reactive({ show: false, id: '', title: '', period: `${thisYear()}-Q1`, value: 0, note: '' });
function measure(o: Obj) {
  Object.assign(m, { show: true, id: o.id, title: o.title, value: o.current ?? 0, note: '', period: `${o.year}-Q${Math.ceil(Number(new Date().getMonth() + 1) / 3)}` });
}
async function saveMeasure() {
  try {
    await api(`/quality/objectives/${m.id}/measurements`, { method: 'POST', json: { period: m.period, value: m.value, note: m.note || null } });
    m.show = false;
    toast.success('سُجل القياس');
    await load();
  } catch (e) {
    toast.error(errMsg(e));
  }
}
const spark = (o: Obj) => {
  const vals = o.measurements.map((x) => x.value);
  if (vals.length < 2) return '';
  const max = Math.max(...vals, o.target);
  const min = Math.min(...vals, o.target, 0);
  return vals.map((v, i) => `${(i / (vals.length - 1)) * 200},${40 - ((v - min) / (max - min || 1)) * 36 - 2}`).join(' ');
};
</script>

<template>
  <div>
    <section class="pm-hero q-hero">
      <div><p class="pm-kicker">البند 6.2</p><h1>أهداف الجودة ومؤشراتها</h1>
        <p class="pm-sub">أهداف قابلة للقياس بمستهدف ومسؤول وخطة. بعض المؤشرات تُحسب تلقائيًا من بيانات النظام (الرضا، الشكاوى، عدم المطابقة، المراجعات)، والباقي يُسجل دوريًا.</p></div>
      <div class="pm-actions">
        <select v-model.number="year" class="input" style="width: auto"><option v-for="y in [thisYear() + 1, thisYear(), thisYear() - 1]" :key="y" :value="y">{{ y }}</option></select>
        <button v-if="session.can(P.objectives)" class="btn q-glow" @click="edit()">هدف جديد</button>
      </div>
    </section>
    <div class="q-grid3">
      <section v-for="(o, i) in rows" :key="o.id" class="card pm-panel" :style="{ '--i': i, opacity: o.isActive ? 1 : .6 }">
        <div style="display: flex; justify-content: space-between; gap: 8px; align-items: flex-start">
          <b style="font-size: 1rem">{{ o.title }}</b><span class="pm-pill" :style="{ '--c': STATUS_COLOR[o.status] }">{{ o.statusLabel }}</span>
        </div>
        <p class="pm-muted" style="margin: 4px 0 10px">{{ o.kpi }} · {{ o.departmentName }} · {{ o.ownerName }}</p>
        <div style="display: flex; align-items: center; gap: 14px">
          <div class="q-ring sm" :style="{ '--v': o.progress ?? 0, '--c': STATUS_COLOR[o.status] }"><b>{{ o.progress === null ? '—' : Math.round(o.progress) + '%' }}</b></div>
          <div>
            <div style="font-size: 1.4rem; font-weight: 700">{{ num(o.current) }} <small class="pm-muted">{{ o.unit }}</small></div>
            <div class="pm-muted">المستهدف {{ o.direction === 'increase' ? '≥' : '≤' }} {{ num(o.target) }} {{ o.unit }}<template v-if="o.baseline !== null"> · خط الأساس {{ num(o.baseline) }}</template></div>
          </div>
        </div>
        <svg v-if="spark(o)" viewBox="0 0 200 42" width="100%" height="42" style="margin-top: 8px"><polyline :points="spark(o)" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <p v-if="o.autoMetric" class="pm-muted" style="margin-top: 8px">⚡ يُقاس تلقائيًا: {{ o.metricLabel }}</p>
        <p v-else class="pm-muted" style="margin-top: 8px">{{ label(FREQUENCIES, o.frequency) }} · {{ o.measurements.map((x) => `${x.period}: ${num(x.value)}`).join('، ') || 'لا توجد قياسات' }}</p>
        <p v-if="o.plan" class="pm-muted">الخطة: {{ o.plan }}</p>
        <div v-if="session.can(P.objectives)" style="display: flex; gap: 6px; margin-top: 10px">
          <button v-if="!o.autoMetric" class="btn btn-sm btn-primary" @click="measure(o)">تسجيل قياس</button><button class="btn btn-sm" @click="edit(o)">تعديل</button>
        </div>
      </section>
    </div>
    <p v-if="!rows.length" class="q-empty">لا توجد أهداف لعام {{ year }}</p>

    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" style="max-width: 680px" @submit.prevent="save">
        <h2>{{ form.id ? 'تعديل الهدف' : `هدف جودة جديد لعام ${year}` }}</h2>
        <label class="field"><span>الهدف</span><input v-model="form.title" class="input" required /></label>
        <label class="field"><span>طريقة القياس</span>
          <select v-model="form.autoMetric" class="input" @change="pickMetric"><option value="">إدخال يدوي دوري</option><option v-for="x in metrics" :key="x.value" :value="x.value">تلقائي: {{ x.label }}</option></select>
        </label>
        <div class="q-fields">
          <label class="field"><span>المؤشر</span><input v-model="form.kpi" class="input" required /></label>
          <label class="field"><span>الوحدة</span><input v-model="form.unit" class="input" required /></label>
          <label class="field"><span>الاتجاه</span><select v-model="form.direction" class="input"><option value="increase">الأعلى أفضل</option><option value="decrease">الأقل أفضل</option></select></label>
          <label class="field"><span>خط الأساس</span><input v-model.number="form.baseline" type="number" step="any" class="input" /></label>
          <label class="field"><span>المستهدف</span><input v-model.number="form.target" type="number" step="any" class="input" required /></label>
          <label class="field"><span>دورية القياس</span><select v-model="form.frequency" class="input"><option v-for="x in FREQUENCIES" :key="x.value" :value="x.value">{{ x.label }}</option></select></label>
          <label class="field"><span>الإدارة</span><select v-model="form.department" class="input"><option v-for="d in settings?.departments" :key="d.code" :value="d.code">{{ d.code }} · {{ d.name }}</option></select></label>
          <label class="field"><span>المسؤول</span><input v-model="form.ownerName" class="input" required /></label>
        </div>
        <label class="field"><span>خطة التحقيق (ماذا سيُعمل، والموارد، والمسؤول، والموعد)</span><textarea v-model="form.plan" class="input" rows="3" /></label>
        <label v-if="form.id" style="display: flex; gap: 8px"><input v-model="form.isActive" type="checkbox" /> هدف نشط</label>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="form.show = false">إلغاء</button></div>
      </form>
    </div>
    <div v-if="m.show" class="modal-backdrop" @click.self="m.show = false">
      <form class="card modal" @submit.prevent="saveMeasure">
        <h2>تسجيل قياس: {{ m.title }}</h2>
        <div class="pm-grid2">
          <label class="field"><span>الفترة</span><input v-model="m.period" class="input" dir="ltr" placeholder="2026-Q1 أو 2026-03" required /></label>
          <label class="field"><span>القيمة</span><input v-model.number="m.value" type="number" step="any" class="input" required /></label>
        </div>
        <label class="field"><span>ملاحظة</span><input v-model="m.note" class="input" /></label>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="m.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
