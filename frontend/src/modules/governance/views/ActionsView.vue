<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { ACTION_STATUS, addDays, EFFORT, fmtDate, num, P, PRIORITIES, type Opportunity } from '../lib';
import '../../../shared/module.css';
import '../gov.css';

interface Action {
  id: string; code: string; title: string; description: string | null; ownerName: string | null; dueDate: string | null; priority: string; status: string;
  progress: number; itemCode: string | null; practiceTitle: string | null; expectedGain: number; source: string; note: string | null; overdue: boolean; completedAt: string | null;
}
const session = useSession();
const toast = useToast();
const tab = ref<'plan' | 'ops'>('plan');
const actions = ref<Action[]>([]);
const ops = ref<{ assessment: { id: string; code: string; title: string } | null; items: Opportunity[] }>({ assessment: null, items: [] });
const picked = ref<string[]>([]);
const status = ref('');
const can = computed(() => session.can(P.actions));
async function load() {
  [actions.value, ops.value] = await Promise.all([api<Action[]>('/governance/actions'), api<typeof ops.value>('/governance/opportunities')]);
}
onMounted(load);
const list = computed(() => actions.value.filter((a) => !status.value || (status.value === 'overdue' ? a.overdue : a.status === status.value)));
const totals = computed(() => ({
  open: actions.value.filter((a) => ['planned', 'in_progress'].includes(a.status)).length,
  done: actions.value.filter((a) => a.status === 'done').length,
  overdue: actions.value.filter((a) => a.overdue).length,
  gain: actions.value.filter((a) => ['planned', 'in_progress'].includes(a.status)).reduce((t, a) => t + a.expectedGain, 0),
  pickedGain: ops.value.items.filter((o) => picked.value.includes(o.code)).reduce((t, o) => t + o.impact, 0),
}));

const gap = reactive({ ownerName: '', dueDate: addDays(60) });
async function fromGaps() {
  try {
    const r = await api<{ created: number }>('/governance/actions/from-gaps', { method: 'POST', json: { codes: picked.value, ownerName: gap.ownerName || null, dueDate: gap.dueDate || null } });
    toast.success(`أُنشئ ${r.created} إجراء تحسين`);
    picked.value = [];
    tab.value = 'plan';
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const blank = () => ({ show: false, id: '', title: '', description: '', ownerName: '', dueDate: '', priority: 'medium', status: 'planned', progress: 0, itemCode: '', note: '' });
const form = reactive(blank());
function edit(a?: Action) {
  Object.assign(form, blank(), a ? {
    id: a.id, title: a.title, description: a.description ?? '', ownerName: a.ownerName ?? '', dueDate: a.dueDate ?? '', priority: a.priority,
    status: a.status, progress: a.progress, itemCode: a.itemCode ?? '', note: a.note ?? '',
  } : {}, { show: true });
}
async function save() {
  const json = {
    title: form.title, description: form.description || null, ownerName: form.ownerName || null, dueDate: form.dueDate || null, priority: form.priority,
    status: form.status, progress: Number(form.progress) || 0, note: form.note || null, ...(form.id ? {} : { itemCode: form.itemCode || null }),
  };
  try {
    await api(form.id ? `/governance/actions/${form.id}` : '/governance/actions', { method: form.id ? 'PUT' : 'POST', json });
    form.show = false;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove() {
  if (!confirm('حذف الإجراء؟')) return;
  await api(`/governance/actions/${form.id}`, { method: 'DELETE' });
  form.show = false;
  await load();
}
</script>

<template>
  <div>
    <section class="pm-hero gv-hero">
      <div>
        <p class="pm-kicker">فرص وخطة التحسين</p>
        <h1>من الفجوة إلى الإجراء</h1>
        <p class="pm-sub">كل بند لم يتحقق كاملاً فرصة تحسين، مرتبة بأثرها على الدرجة الكلية والجهد المتوقع، ومعها الأنشطة المقترحة من بطاقة الممارسة في الدليل. اختر الفرص وحوّلها إلى إجراءات بمسؤول وموعد.</p>
      </div>
      <div class="pm-actions"><button v-if="can" class="btn gv-glow" @click="edit()">إجراء جديد</button></div>
    </section>
    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #0ea5e9; --i: 0"><span>إجراءات مفتوحة</span><strong>{{ totals.open }}</strong><small>أثر متوقع +{{ num(totals.gain, 2) }} درجة</small></div>
      <div class="pm-kpi" style="--a: #10b981; --i: 1"><span>منجزة</span><strong>{{ totals.done }}</strong></div>
      <div class="pm-kpi" style="--a: #ef4444; --i: 2"><span>متأخرة</span><strong>{{ totals.overdue }}</strong></div>
      <div class="pm-kpi" style="--a: #eab308; --i: 3"><span>فرص التحسين</span><strong>{{ ops.items.length }}</strong><small>{{ ops.assessment ? `من ${ops.assessment.code}` : 'لا يوجد تقييم' }}</small></div>
    </div>
    <div class="gv-tabs">
      <button :class="['gv-tab', { on: tab === 'plan' }]" @click="tab = 'plan'">خطة التحسين<b>{{ actions.length }}</b></button>
      <button :class="['gv-tab', { on: tab === 'ops' }]" @click="tab = 'ops'">فرص التحسين<b>{{ ops.items.length }}</b></button>
    </div>

    <section v-if="tab === 'plan'" class="card pm-panel">
      <div class="pm-filters">
        <select v-model="status" class="input"><option value="">كل الحالات</option><option v-for="(s, k) in ACTION_STATUS" :key="k" :value="k">{{ s.label }}</option><option value="overdue">المتأخرة</option></select>
      </div>
      <p v-if="!list.length" class="pm-empty">لا توجد إجراءات. ابدأ من تبويب فرص التحسين.</p>
      <table v-else class="table">
        <thead><tr><th>الرمز</th><th>الإجراء</th><th>المسؤول</th><th>الموعد</th><th>الأولوية</th><th>الحالة</th><th>الإنجاز</th><th>الأثر</th></tr></thead>
        <tbody><tr v-for="a in list" :key="a.id" :class="{ 'gv-row': can }" @click="can && edit(a)">
          <td class="gv-code">{{ a.code }}</td>
          <td style="white-space: normal">{{ a.title }}<div v-if="a.practiceTitle" class="pm-muted">{{ a.practiceTitle }}</div></td>
          <td>{{ a.ownerName ?? '—' }}</td>
          <td :style="{ color: a.overdue ? 'var(--danger)' : undefined }">{{ fmtDate(a.dueDate) }}<div v-if="a.overdue" class="pm-muted" style="color: var(--danger)">متأخر</div></td>
          <td><span class="gv-pill" :style="{ '--c': PRIORITIES[a.priority].color }">{{ PRIORITIES[a.priority].label }}</span></td>
          <td><span class="gv-pill" :style="{ '--c': ACTION_STATUS[a.status].color }">{{ ACTION_STATUS[a.status].label }}</span></td>
          <td style="min-width: 90px"><div class="pm-bar"><i :style="{ width: `${a.progress}%`, background: ACTION_STATUS[a.status].color }" /></div><small class="pm-muted">{{ a.progress }}%</small></td>
          <td class="gv-num" style="color: #059669">{{ a.expectedGain ? `+${num(a.expectedGain, 2)}` : '—' }}</td>
        </tr></tbody>
      </table>
    </section>

    <section v-else class="card pm-panel">
      <div v-if="can" class="pm-filters">
        <input v-model="gap.ownerName" class="input" placeholder="المسؤول (اختياري)" />
        <input v-model="gap.dueDate" type="date" class="input" />
        <button class="btn btn-primary" :disabled="!picked.length" @click="fromGaps">إنشاء {{ picked.length }} إجراء (أثر +{{ num(totals.pickedGain, 2) }})</button>
      </div>
      <p v-if="!ops.items.length" class="pm-empty">لا توجد فرص تحسين</p>
      <table v-else class="table">
        <thead><tr><th v-if="can" /><th>الأثر</th><th>البند</th><th>الوضع</th><th>الأنشطة المقترحة من الدليل</th></tr></thead>
        <tbody><tr v-for="o in ops.items" :key="o.code">
          <td v-if="can"><input v-model="picked" type="checkbox" :value="o.code" :disabled="o.planned" /></td>
          <td class="gv-num" style="color: #059669">+{{ num(o.impact, 2) }}</td>
          <td style="white-space: normal"><span class="gv-code">{{ o.code }}</span> {{ o.title }}<div class="pm-muted">{{ o.practice ?? o.indicator }} · {{ EFFORT[o.effort] }}<template v-if="o.planned"> · <b>في الخطة</b></template></div></td>
          <td>{{ o.current === null ? 'بلا إجابة' : `${num(o.current)}%` }}</td>
          <td style="white-space: normal"><ul style="margin: 0; padding-inline-start: 18px"><li v-for="(r, i) in o.recommendations.slice(0, 3)" :key="i" class="pm-muted">{{ r }}</li></ul></td>
        </tr></tbody>
      </table>
    </section>

    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" @submit.prevent="save">
        <h2>{{ form.id ? 'تعديل إجراء التحسين' : 'إجراء تحسين جديد' }}</h2>
        <label class="field"><span>الإجراء</span><input v-model="form.title" class="input" required /></label>
        <label class="field"><span>التفاصيل والأنشطة</span><textarea v-model="form.description" class="input" rows="4" /></label>
        <div class="pm-grid2">
          <label class="field"><span>المسؤول</span><input v-model="form.ownerName" class="input" /></label>
          <label class="field"><span>الموعد</span><input v-model="form.dueDate" type="date" class="input" /></label>
          <label class="field"><span>الأولوية</span><select v-model="form.priority" class="input"><option v-for="(p, k) in PRIORITIES" :key="k" :value="k">{{ p.label }}</option></select></label>
          <label class="field"><span>الحالة</span><select v-model="form.status" class="input"><option v-for="(s, k) in ACTION_STATUS" :key="k" :value="k">{{ s.label }}</option></select></label>
          <label class="field"><span>نسبة الإنجاز</span><input v-model.number="form.progress" type="number" min="0" max="100" class="input" /></label>
          <label v-if="!form.id" class="field"><span>رمز البند في الدليل (اختياري)</span><input v-model="form.itemCode" class="input" placeholder="CMP-P13-1" dir="ltr" /></label>
        </div>
        <label class="field"><span>ملاحظات</span><textarea v-model="form.note" class="input" rows="2" /></label>
        <div class="modal-actions">
          <button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="form.show = false">إلغاء</button>
          <button v-if="form.id" type="button" class="btn btn-ghost" style="margin-inline-start: auto" @click="remove">حذف</button>
        </div>
      </form>
    </div>
  </div>
</template>
