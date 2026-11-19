<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { errMsg, fmtDateTime, money, MONTHS, num, SECTIONS, short } from '../lib';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** سيناريوهات الموازنة: إنشاء ومقارنة وتحليل حساسية، ثم فتح السيناريو لتعديله أو تحويله لمشروع موازنة */
const props = defineProps<{ budget: any; canManage: boolean }>();
const router = useRouter();
const toast = useToast();
const data = ref<any>(null);
const picked = ref<string[]>([]);
const cmp = ref<any>(null);
const sens = reactive<any>({ id: '', step: 10, data: null, busy: false });
const form = reactive<any>({ open: false, title: '', description: '', copyFromId: '', busy: false });

async function load() {
  try {
    data.value = await api<any>(`/planning/budgets/${props.budget.id}/scenarios`);
    picked.value = picked.value.filter((id) => data.value.scenarios.some((s: any) => s.id === id));
    if (!picked.value.length) picked.value = data.value.scenarios.slice(0, 3).map((s: any) => s.id);
    if (picked.value.length) await compare();
  } catch (e) { toast.error(errMsg(e)); }
}
onMounted(async () => {
  sens.id = props.budget.id;
  await load();
  await runSens();
});

async function create() {
  form.busy = true;
  try {
    const s = await api<any>(`/planning/budgets/${props.budget.id}/scenarios`, { method: 'POST', json: { title: form.title, description: form.description || null, copyFromId: form.copyFromId || undefined } });
    toast.success('أُنشئ السيناريو بنسخة مستقلة من الموازنة. عدّل افتراضاته ومؤثراته');
    router.push(`/planning/budgets/${s.id}`);
  } catch (e) { toast.error(errMsg(e)); } finally { form.busy = false; }
}
async function remove(s: any) {
  if (!confirm(`حذف السيناريو ${s.code}؟`)) return;
  try { await api(`/planning/budgets/${s.id}`, { method: 'DELETE' }); await load(); } catch (e) { toast.error(errMsg(e)); }
}
async function compare() {
  if (!picked.value.length) { cmp.value = null; return; }
  try { cmp.value = await api<any>(`/planning/budgets/${props.budget.id}/scenarios/compare?ids=${picked.value.join(',')}`); } catch (e) { toast.error(errMsg(e)); }
}
function togglePick(id: string) {
  const i = picked.value.indexOf(id);
  if (i >= 0) picked.value.splice(i, 1); else if (picked.value.length < 5) picked.value.push(id); else toast.error('تُقارن حتى 5 سيناريوهات');
  compare();
}
async function runSens() {
  sens.busy = true;
  try { sens.data = await api<any>(`/planning/budgets/${sens.id}/sensitivity?step=${sens.step}`); } catch (e) { toast.error(errMsg(e)); } finally { sens.busy = false; }
}
const sensMax = computed(() => Math.max(1, ...(sens.data?.drivers ?? []).map((d: any) => Math.max(Math.abs(d.low.balance - sens.data.baseline.balance), Math.abs(d.high.balance - sens.data.baseline.balance)))));
const COLORS = ['#64748b', '#0ea5e9', '#a78bfa', '#f59e0b', '#10b981', '#ef4444'];
const monthMax = computed(() => Math.max(1, ...(cmp.value?.columns ?? []).flatMap((c: any) => c.byMonth.map(Math.abs))));
const sign = (v: number) => (Math.round(v) === 0 ? 'بلا تغيير' : `${v > 0 ? '+' : ''}${short(v)}`);
const leverText = (l: any) => `${l.name}: ${l.type === 'pct' ? `${l.value > 0 ? '+' : ''}${l.value}%` : `تأجيل ${l.value} شهر`}`;
const rowsSpec = [
  { k: 'revenues', label: 'الإيرادات المتوقعة', good: 1 },
  ...Object.entries(SECTIONS).filter(([k]) => k !== 'revenue').map(([k, s]) => ({ k: `s:${k}`, label: s.label, good: -1 })),
  { k: 'expenses', label: 'إجمالي المصروفات', good: -1 },
  { k: 'balance', label: 'الفائض أو العجز', good: 1 },
];
const val = (c: any, k: string) => (k.startsWith('s:') ? c.sections[k.slice(2)] : c[k]);
</script>

<template>
  <div v-if="data" class="sc-panel">
    <section class="card pm-panel">
      <h2><span>السيناريوهات ({{ data.scenarios.length }})</span><button v-if="canManage" class="btn btn-sm pl-glow" @click="form.open = true">+ سيناريو</button></h2>
      <p class="pm-muted">السيناريو نسخة مستقلة من هذه الموازنة تغيّر فيها الإيرادات والعلاوات والتوظيف والأنشطة دون المساس بالموازنة. قارن السيناريوهات ثم حوّل المختار منها إلى مشروع موازنة يمر بمسار الاعتماد.</p>
      <div class="sc-cards">
        <div class="sc-card base"><small>الموازنة الأساسية</small><b>{{ data.base.code }}</b>
          <div class="sc-nums"><span>الإيرادات <b>{{ short(data.base.revenues) }}</b></span><span>المصروفات <b>{{ short(data.base.expenses) }}</b></span>
            <span :class="data.base.balance < 0 ? 'neg' : 'pos'">{{ data.base.balance < 0 ? 'العجز' : 'الفائض' }} <b>{{ short(Math.abs(data.base.balance)) }}</b></span></div>
          <small class="pm-muted">القوى العاملة {{ data.base.headcount.current }} + {{ data.base.headcount.new }}</small>
        </div>
        <div v-for="(s, i) in data.scenarios" :key="s.id" :class="['sc-card', { on: picked.includes(s.id) }]" :style="{ '--c': COLORS[(picked.indexOf(s.id) + 1) % COLORS.length], '--i': i }">
          <div class="pl-flex"><label class="pl-flex"><input type="checkbox" :checked="picked.includes(s.id)" @change="togglePick(s.id)" /> <span class="rk-code">{{ s.code }}</span></label>
            <span v-if="s.promotedAt" class="pm-pill" style="--c: #10b981" :title="`${s.promotedByName} · ${fmtDateTime(s.promotedAt)}`">حُوّل إلى الموازنة</span></div>
          <b>{{ s.title }}</b>
          <div class="sc-nums"><span>الإيرادات <b>{{ short(s.revenues) }}</b><em>{{ sign(s.diff.revenues) }}</em></span><span>المصروفات <b>{{ short(s.expenses) }}</b><em>{{ sign(s.diff.expenses) }}</em></span>
            <span :class="s.balance < 0 ? 'neg' : 'pos'">{{ s.balance < 0 ? 'العجز' : 'الفائض' }} <b>{{ short(Math.abs(s.balance)) }}</b><em>{{ sign(s.diff.balance) }}</em></span></div>
          <div class="bg-vars"><span v-for="l in s.levers" :key="l.key">{{ leverText(l) }}</span><span v-if="!s.levers.length" class="pm-muted">بلا مؤثرات (تعديلات في الافتراضات أو البنود)</span></div>
          <div class="pl-flex"><small class="pm-muted">القوى العاملة {{ s.headcount.current }} + {{ s.headcount.new }} · {{ s.createdByName }}</small>
            <span style="margin-inline-start: auto" class="pl-flex"><button class="btn btn-sm" @click="router.push(`/planning/budgets/${s.id}`)">فتح وتعديل</button>
              <button v-if="canManage" class="btn btn-sm btn-danger" @click="remove(s)">حذف</button></span></div>
        </div>
      </div>
      <p v-if="!data.scenarios.length" class="pm-empty">لا توجد سيناريوهات بعد. أنشئ سيناريو متحفظًا وآخر توسعيًا للمقارنة.</p>
    </section>

    <section v-if="cmp" class="card pm-panel">
      <h2>المقارنة</h2>
      <div class="table-wrap">
        <table class="table sc-cmp">
          <thead><tr><th /><th v-for="(c, i) in cmp.columns" :key="c.id" :style="{ '--c': COLORS[i] }"><i class="sc-dot" />{{ c.isScenario ? c.title : 'الموازنة الأساسية' }}<small>{{ c.code }}</small></th></tr></thead>
          <tbody>
            <tr v-for="r in rowsSpec" :key="r.k" :class="{ total: r.k === 'balance' || r.k === 'expenses' }"><td><b>{{ r.label }}</b></td>
              <td v-for="(c, i) in cmp.columns" :key="c.id" class="num">{{ money(val(c, r.k)) }}
                <em v-if="i" :class="(val(c, r.k) - val(cmp.columns[0], r.k)) * r.good < 0 ? 'neg' : 'pos'">{{ sign(val(c, r.k) - val(cmp.columns[0], r.k)) }}</em></td></tr>
            <tr><td><b>القوى العاملة (حالي + جديد)</b></td><td v-for="c in cmp.columns" :key="c.id" class="num">{{ c.headcount.current }} + {{ c.headcount.new }}</td></tr>
            <tr><td><b>المؤثرات</b></td><td v-for="c in cmp.columns" :key="c.id"><div class="bg-vars"><span v-for="l in c.levers" :key="l.key">{{ leverText(l) }}</span></div></td></tr>
            <tr v-for="v in cmp.variables" :key="v.key + v.name"><td>{{ v.name }}</td><td v-for="(x, i) in v.values" :key="i" class="num">{{ x ?? '—' }}</td></tr>
          </tbody>
        </table>
      </div>

      <h3 class="rk-sec">صافي التدفق الشهري</h3>
      <div class="sc-months">
        <div v-for="(m, mi) in MONTHS" :key="mi" class="col">
          <div class="bars"><i v-for="(c, ci) in cmp.columns" :key="c.id" :class="{ neg: c.byMonth[mi] < 0 }" :style="{ '--c': COLORS[ci], height: `${(Math.abs(c.byMonth[mi]) / monthMax) * 100}%` }" :title="`${c.code}: ${money(c.byMonth[mi])}`" /></div>
          <small>{{ m }}</small>
        </div>
      </div>
      <p class="pm-muted">الأعمدة الباهتة عجز في الشهر، والممتلئة فائض.</p>

      <h3 class="rk-sec">البنود الأكثر اختلافًا</h3>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>القسم</th><th>البند</th><th v-for="(c, i) in cmp.columns" :key="c.id" :style="{ '--c': COLORS[i] }"><i class="sc-dot" />{{ c.code }}</th></tr></thead>
          <tbody>
            <tr v-for="r in cmp.lines.slice(0, 15)" :key="r.key"><td>{{ r.sectionName }}</td><td>{{ r.name }}</td>
              <td v-for="(v, i) in r.values" :key="i" class="num">{{ v === null ? 'غير موجود' : num(v, 0) }}<em v-if="i && v !== r.values[0]" class="pm-muted"> ({{ sign((v ?? 0) - (r.values[0] ?? 0)) }})</em></td></tr>
            <tr v-if="!cmp.lines.length"><td :colspan="2 + cmp.columns.length" class="pm-empty">لا فروق في البنود.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card pm-panel">
      <h2><span>تحليل الحساسية: أي المتغيرات أكثر تأثيرًا؟</span>
        <span class="pl-flex">
          <select v-model="sens.id" class="input" style="width: auto" @change="runSens"><option :value="budget.id">الموازنة الأساسية</option><option v-for="s in data.scenarios" :key="s.id" :value="s.id">{{ s.code }} {{ s.title }}</option></select>
          <select v-model.number="sens.step" class="input" style="width: auto" @change="runSens"><option :value="5">±5%</option><option :value="10">±10%</option><option :value="20">±20%</option></select>
        </span></h2>
      <p class="pm-muted">يُغيَّر كل متغير بالنسبة المختارة من قيمته ويُعاد احتساب البنود دون حفظ، وتُرتب المتغيرات بحجم أثرها على الفائض أو العجز.</p>
      <p v-if="sens.busy" class="pm-muted">جارٍ التحليل…</p>
      <div v-else-if="sens.data" class="sc-tornado">
        <div class="hd"><span /><small>عند خفض المتغير {{ sens.data.step }}%</small><small>عند زيادته {{ sens.data.step }}%</small><span /></div>
        <div v-for="d in sens.data.drivers" :key="d.key" class="row">
          <span class="nm" :title="d.key">{{ d.name }}</span>
          <div class="side l"><i :class="d.low.balance - sens.data.baseline.balance < 0 ? 'neg' : 'pos'" :style="{ width: `${(Math.abs(d.low.balance - sens.data.baseline.balance) / sensMax) * 100}%` }" /><small>{{ sign(d.low.balance - sens.data.baseline.balance) }}</small></div>
          <div class="side r"><i :class="d.high.balance - sens.data.baseline.balance < 0 ? 'neg' : 'pos'" :style="{ width: `${(Math.abs(d.high.balance - sens.data.baseline.balance) / sensMax) * 100}%` }" /><small>{{ sign(d.high.balance - sens.data.baseline.balance) }}</small></div>
          <b class="num">{{ short(d.impact) }}</b>
        </div>
        <p class="pm-muted">الأحمر يزيد العجز، والأخضر يحسّن الصافي. الصافي الحالي {{ money(sens.data.baseline.balance) }}.</p>
      </div>
    </section>

    <div v-if="form.open" class="modal-backdrop" @click.self="form.open = false">
      <form class="card modal" @submit.prevent="create">
        <h2>سيناريو جديد</h2>
        <label class="field"><span>اسم السيناريو</span><input v-model="form.title" class="input" required minlength="3" placeholder="مثل: متحفظ، انخفاض التبرعات 15%" /></label>
        <label class="field"><span>الوصف</span><textarea v-model="form.description" class="input" rows="2" /></label>
        <label class="field"><span>يبدأ من</span><select v-model="form.copyFromId" class="input"><option value="">الموازنة الأساسية كما هي الآن</option><option v-for="s in data.scenarios" :key="s.id" :value="s.id">نسخة من {{ s.code }} {{ s.title }}</option></select></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="form.busy">إنشاء وفتح</button><button type="button" class="btn" @click="form.open = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
