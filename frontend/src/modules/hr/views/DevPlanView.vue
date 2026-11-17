<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { STATUS_COLOR, fmtDate, sar } from '../lib';
import '../../projects/projects.css';
import '../hr.css';

/** خطة تطوير واحدة: الفجوة، المستهدفات، الأنشطة، الاعتماد، ومتابعة التنفيذ */
interface Item {
  id: string; competencyId: string | null; name: string; requiredLevel: number | null; currentLevel: number | null; targetLevel: number | null; activityType: string; activityTypeName?: string;
  activity: string; provider: string | null; dueDate: string | null; cost: number; hours: number; status: 'planned' | 'in_progress' | 'done' | 'cancelled'; statusLabel?: string;
  achievedLevel: number | null; note: string | null; levelDescription?: string | null;
}
interface Plan {
  id: string; serial: number; year: number; kind: 'individual' | 'succession'; title: string; goals: string[]; status: string; statusLabel: string;
  employee: { id: string; fullName: string; employeeNo: number; unitName: string; jobTitle: string }; targetJob: { id: string; title: string } | null; evaluatedYear: number | null;
  gaps: { competencyId: string; name: string; required: number; actual: number | null; gap: number | null }[]; items: Item[];
  progress: { items: number; done: number; percent: number; cost: number; hours: number; closedGaps: number };
  stages: { name: string; current: boolean; done: boolean }[]; stageName: string | null; activityTypes: { code: string; name: string }[];
  competencies: { id: string; name: string; levels: { level: number; description: string }[] }[];
  history: { label: string; stageName: string | null; note: string | null; actorName: string; at: string }[];
  createdByName: string; approvedAt: string | null; completedAt: string | null;
  can: { edit: boolean; submit: boolean; decide: boolean; progress: boolean; complete: boolean; cancel: boolean };
}
const props = defineProps<{ id: string }>();
const toast = useToast();
const p = ref<Plan | null>(null);
const title = ref('');
const goals = ref<string[]>([]);
const items = ref<Item[]>([]);
const dirty = ref(false);
const busy = ref(false);
function fill(r: Plan) {
  p.value = r;
  title.value = r.title;
  goals.value = [...r.goals];
  items.value = r.items.map((i) => ({ ...i }));
  setTimeout(() => (dirty.value = false));
}
async function load() {
  try {
    fill(await api<Plan>(`/hr/dev-plans/${props.id}`));
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
watch([title, goals, items], () => (dirty.value = true), { deep: true });

const ITEM_COLOR = { planned: '#94a3b8', in_progress: '#0ea5e9', done: '#10b981', cancelled: '#ef4444' } as const;
const gapColor = (g: number | null) => (g === null ? '#94a3b8' : g === 0 ? '#10b981' : g === 1 ? '#f59e0b' : '#ef4444');
const editing = computed(() => !!p.value?.can.edit);
const totals = computed(() => {
  const live = items.value.filter((i) => i.status !== 'cancelled');
  return { cost: live.reduce((s, i) => s + Number(i.cost || 0), 0), hours: live.reduce((s, i) => s + Number(i.hours || 0), 0) };
});

async function run(fn: () => Promise<Plan>, ok: string) {
  busy.value = true;
  try {
    fill(await fn());
    toast.success(ok);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const body = () => ({
  title: title.value.trim(), goals: goals.value.map((g) => g.trim()).filter(Boolean),
  items: items.value.map((i) => ({
    id: i.id || undefined, competencyId: i.competencyId || null, name: i.name, requiredLevel: i.requiredLevel ?? null, currentLevel: i.currentLevel ?? null,
    targetLevel: i.targetLevel || null, activityType: i.activityType, activity: i.activity, provider: i.provider || null, dueDate: i.dueDate || null,
    cost: Number(i.cost || 0), hours: Number(i.hours || 0), note: i.note || null,
  })),
});
const save = () => run(() => api<Plan>(`/hr/dev-plans/${props.id}`, { method: 'PUT', json: body() }), 'حُفظت الخطة');
async function submit() {
  busy.value = true;
  try {
    if (dirty.value) fill(await api<Plan>(`/hr/dev-plans/${props.id}`, { method: 'PUT', json: body() }));
    fill(await api<Plan>(`/hr/dev-plans/${props.id}/submit`, { method: 'POST' }));
    toast.success('رُفعت الخطة للاعتماد');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const note = ref('');
const decide = (decision: 'approve' | 'return') =>
  run(() => api<Plan>(`/hr/dev-plans/${props.id}/decision`, { method: 'POST', json: { decision, note: note.value.trim() || null } }), decision === 'approve' ? 'سُجلت الموافقة' : 'أُعيدت الخطة للتعديل').then(() => (note.value = ''));
const saveProgress = () =>
  run(() => api<Plan>(`/hr/dev-plans/${props.id}/progress`, {
    method: 'POST', json: { items: items.value.map((i) => ({ id: i.id, status: i.status, achievedLevel: i.achievedLevel ?? null, note: i.note || null })) },
  }), 'حُفظ التنفيذ');
const complete = () => run(() => api<Plan>(`/hr/dev-plans/${props.id}/complete`, { method: 'POST', json: { note: null } }), 'أُغلقت الخطة');
function cancel() {
  const n = prompt('سبب إلغاء الخطة');
  if (!n?.trim()) return;
  run(() => api<Plan>(`/hr/dev-plans/${props.id}/cancel`, { method: 'POST', json: { note: n.trim() } }), 'أُلغيت الخطة');
}

function addItem(compId = '') {
  const g = p.value?.gaps.find((x) => x.competencyId === compId);
  const c = p.value?.competencies.find((x) => x.id === compId);
  items.value.push({
    id: '', competencyId: compId || null, name: c?.name ?? '', requiredLevel: g?.required ?? null, currentLevel: g?.actual ?? null, targetLevel: g?.required ?? null,
    activityType: p.value?.activityTypes[0]?.code ?? 'course', activity: '', provider: null, dueDate: `${p.value?.year}-12-31`, cost: 0, hours: 0, status: 'planned', achievedLevel: null, note: null,
  });
}
function pickComp(i: Item) {
  const g = p.value?.gaps.find((x) => x.competencyId === i.competencyId);
  const c = p.value?.competencies.find((x) => x.id === i.competencyId);
  if (c) i.name = c.name;
  i.requiredLevel = g?.required ?? null;
  i.currentLevel = g?.actual ?? null;
  if (g) i.targetLevel = g.required;
}
const levels = (min = 1) => [1, 2, 3, 4, 5].filter((n) => n >= min);
</script>

<template>
  <div v-if="p">
    <section class="pm-hero hr-hero">
      <div>
        <p class="pm-kicker"><RouterLink to="/hr/development" style="color: inherit">التطوير والتدريب</RouterLink> · خطة رقم {{ p.serial }} · {{ p.year }}</p>
        <h1>{{ p.title }}</h1>
        <p class="pm-sub">
          {{ p.employee.fullName }} · {{ p.employee.jobTitle }} · {{ p.employee.unitName }}
          <template v-if="p.targetJob"><br />خطة صف ثانٍ لإعداده لوظيفة <b>{{ p.targetJob.title }}</b></template>
        </p>
      </div>
      <div class="pm-actions" style="flex-direction: column; align-items: flex-end; gap: 6px">
        <span class="pm-tag" :style="{ background: `${STATUS_COLOR[p.status]}33`, color: '#fff', fontSize: '.9rem' }">{{ p.statusLabel }}</span>
        <span v-if="p.stageName" class="hr-mini" style="color: #ddd">لدى: {{ p.stageName }}</span>
      </div>
    </section>

    <div v-if="p.stages.length" class="card pm-panel">
      <div class="hr-steps">
        <div :class="{ done: true }">الإعداد</div>
        <div v-for="s in p.stages" :key="s.name" :class="{ done: s.done, cur: s.current }">{{ s.name }}</div>
        <div :class="{ done: p.status === 'completed' }">الإغلاق</div>
      </div>
    </div>

    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #10b981; --i: 0"><span>الإنجاز</span><strong>{{ p.progress.percent }}%</strong><small>{{ p.progress.done }} من {{ p.progress.items }} نشاط</small></div>
      <div class="pm-kpi" style="--a: #a78bfa; --i: 1"><span>فجوات سُدّت</span><strong>{{ p.progress.closedGaps }}</strong><small>وصلت للمستوى المستهدف</small></div>
      <div class="pm-kpi" style="--a: #f472b6; --i: 2"><span>التكلفة التقديرية</span><strong>{{ sar(editing ? totals.cost : p.progress.cost) }}</strong><small>{{ editing ? totals.hours : p.progress.hours }} ساعة تدريب</small></div>
    </div>

    <div class="hr-grid">
      <section class="card pm-panel">
        <h2>فجوة الجدارات {{ p.targetJob ? `لوظيفة ${p.targetJob.title}` : '' }}</h2>
        <p class="pm-muted">{{ p.evaluatedYear ? `المستوى الفعلي من تقييم أداء ${p.evaluatedYear}.` : 'لا يوجد تقييم أداء معتمد للموظف بعد، فحدّد المستوى الفعلي في كل نشاط.' }}</p>
        <table class="table">
          <thead><tr><th>الجدارة</th><th>المطلوب</th><th>الفعلي</th><th>الفجوة</th><th v-if="editing"></th></tr></thead>
          <tbody>
            <tr v-for="g in p.gaps" :key="g.competencyId">
              <td>{{ g.name }}</td>
              <td class="hr-num">{{ g.required }}</td>
              <td class="hr-num">{{ g.actual ?? '—' }}</td>
              <td><span class="pm-tag" :style="{ background: `${gapColor(g.gap)}22`, color: gapColor(g.gap) }">{{ g.gap === null ? 'لم تُقيَّم' : g.gap === 0 ? 'لا فجوة' : `${g.gap} مستوى` }}</span></td>
              <td v-if="editing"><button v-if="!items.some((i) => i.competencyId === g.competencyId)" class="btn btn-sm" @click="addItem(g.competencyId)">+ نشاط</button></td>
            </tr>
            <tr v-if="!p.gaps.length"><td colspan="5" class="pm-empty">لا جدارات في الوصف الوظيفي.</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card pm-panel">
        <h2>المستهدفات</h2>
        <template v-if="editing">
          <label class="field"><span>عنوان الخطة</span><input v-model="title" class="input" /></label>
          <div v-for="(g, i) in goals" :key="i" style="display: flex; gap: 6px; margin-bottom: 6px">
            <input v-model="goals[i]" class="input" />
            <button class="btn btn-sm" @click="goals.splice(i, 1)">✕</button>
          </div>
          <button class="btn btn-sm" @click="goals.push('')">+ مستهدف</button>
        </template>
        <ul v-else class="hr-list"><li v-for="g in p.goals" :key="g">{{ g }}</li></ul>
      </section>
    </div>

    <section class="card pm-panel">
      <div class="pm-row-head">
        <div>
          <h2>الأنشطة التطويرية</h2>
          <p class="pm-muted">{{ editing ? 'اقترحها النظام من الفجوة، ويمكنك تعديلها أو إضافة غيرها. لكل نشاط مستوى مستهدف وموعد إنجاز.' : p.can.progress ? 'حدّث حالة كل نشاط، وعند إنجازه سجّل المستوى المحقق.' : '' }}</p>
        </div>
        <button v-if="editing" class="btn btn-sm" @click="addItem()">+ نشاط</button>
      </div>
      <div v-if="editing" style="display: grid; gap: 10px">
        <div v-for="(i, k) in items" :key="i.id || k" class="card" style="padding: 12px; margin: 0; border-inline-start: 4px solid #a78bfa">
          <div class="hr-line-edit">
            <label class="field"><span>الجدارة / المهارة</span>
              <select v-model="i.competencyId" class="input" @change="pickComp(i)"><option :value="null">مهارة أخرى (خارج الجدارات)</option><option v-for="c in p.competencies" :key="c.id" :value="c.id">{{ c.name }}</option></select>
            </label>
            <label v-if="!i.competencyId" class="field"><span>اسم المهارة</span><input v-model="i.name" class="input" /></label>
            <label class="field"><span>المستوى الفعلي{{ i.requiredLevel ? ` (المطلوب ${i.requiredLevel})` : '' }}</span>
              <select v-model.number="i.currentLevel" class="input"><option :value="null">غير محدد</option><option v-for="n in [0, 1, 2, 3, 4, 5]" :key="n" :value="n">{{ n }}</option></select>
            </label>
            <label class="field"><span>المستوى المستهدف</span>
              <select v-model.number="i.targetLevel" class="input"><option :value="null">—</option><option v-for="n in levels((i.currentLevel ?? 0) + 1)" :key="n" :value="n">{{ n }}</option></select>
            </label>
            <label class="field"><span>نوع النشاط</span><select v-model="i.activityType" class="input"><option v-for="t in p.activityTypes" :key="t.code" :value="t.code">{{ t.name }}</option></select></label>
          </div>
          <div class="hr-line-edit">
            <label class="field" style="grid-column: span 2"><span>النشاط التطويري</span><input v-model="i.activity" class="input" placeholder="مثل: دورة إدارة المشاريع الاحترافية" /></label>
            <label class="field"><span>الجهة المنفذة</span><input v-model="i.provider" class="input" placeholder="اختياري" /></label>
            <label class="field"><span>موعد الإنجاز</span><input v-model="i.dueDate" type="date" class="input" /></label>
            <label class="field"><span>التكلفة (ر.س)</span><input v-model.number="i.cost" type="number" min="0" step="0.01" class="input" /></label>
            <label class="field"><span>الساعات</span><input v-model.number="i.hours" type="number" min="0" step="0.5" class="input" /></label>
          </div>
          <div style="display: flex; gap: 8px; align-items: flex-end">
            <label class="field" style="flex: 1; margin: 0"><span>ملاحظة</span><input v-model="i.note" class="input" /></label>
            <button class="btn btn-sm btn-danger" @click="items.splice(k, 1)">حذف النشاط</button>
          </div>
        </div>
        <p v-if="!items.length" class="pm-empty">لا أنشطة بعد.</p>
      </div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr><th>الجدارة / المهارة</th><th>المستوى</th><th>النشاط</th><th>الموعد</th><th>التكلفة والساعات</th><th>التنفيذ</th></tr>
          </thead>
          <tbody>
            <tr v-for="(i, k) in items" :key="i.id || k" :style="{ opacity: i.status === 'cancelled' ? 0.5 : 1 }">
              <td style="min-width: 170px"><b>{{ i.name }}</b><span v-if="i.levelDescription" class="hr-mini">المستهدف: {{ i.levelDescription }}</span></td>
              <td><span class="hr-num">{{ i.currentLevel ?? '؟' }} ← <b>{{ i.targetLevel ?? '—' }}</b></span><span v-if="i.requiredLevel" class="hr-mini">المطلوب {{ i.requiredLevel }}</span></td>
              <td style="min-width: 220px"><b>{{ i.activity }}</b><span class="hr-mini">{{ i.activityTypeName }}<template v-if="i.provider"> · {{ i.provider }}</template></span></td>
              <td>{{ fmtDate(i.dueDate) }}</td>
              <td>{{ sar(i.cost) }}<span class="hr-mini">{{ i.hours }} ساعة</span></td>
              <td style="min-width: 170px">
                <template v-if="p.can.progress">
                  <select v-model="i.status" class="input"><option value="planned">مخطط</option><option value="in_progress">جارٍ التنفيذ</option><option value="done">منجز</option><option value="cancelled">ملغى</option></select>
                  <select v-if="i.status === 'done' && i.competencyId" v-model.number="i.achievedLevel" class="input" style="margin-top: 4px"><option :value="null">المستوى المحقق</option><option v-for="n in levels()" :key="n" :value="n">المحقق: {{ n }}</option></select>
                  <input v-model="i.note" class="input" placeholder="ملاحظة" style="margin-top: 4px" />
                </template>
                <template v-else>
                  <span class="pm-tag" :style="{ background: `${ITEM_COLOR[i.status]}22`, color: ITEM_COLOR[i.status] }">{{ i.statusLabel ?? 'مخطط' }}</span>
                  <span v-if="i.achievedLevel !== null" class="hr-mini" :style="{ color: i.targetLevel && i.achievedLevel >= i.targetLevel ? '#10b981' : '#f59e0b' }">المحقق: {{ i.achievedLevel }}</span>
                  <span v-if="i.note" class="hr-mini">{{ i.note }}</span>
                </template>
              </td>
            </tr>
            <tr v-if="!items.length"><td colspan="6" class="pm-empty">لا أنشطة بعد.</td></tr>
          </tbody>
        </table>
      </div>
      <div class="modal-actions">
        <template v-if="editing">
          <button class="btn" :disabled="busy" @click="save">حفظ</button>
          <button v-if="p.can.submit" class="btn hr-glow" :disabled="busy" @click="submit">رفع للاعتماد</button>
        </template>
        <button v-if="p.can.progress" class="btn btn-primary" :disabled="busy" @click="saveProgress">حفظ التنفيذ</button>
        <button v-if="p.can.complete && !dirty" class="btn hr-glow" :disabled="busy" @click="complete">إغلاق الخطة</button>
        <button v-if="p.can.cancel" class="btn btn-danger" :disabled="busy" @click="cancel">إلغاء الخطة</button>
      </div>
    </section>

    <div class="hr-grid">
      <section v-if="p.can.decide" class="card pm-panel">
        <h2>قرار {{ p.stageName ?? 'الاعتماد' }}</h2>
        <label class="field"><span>ملاحظة (إلزامية عند الإرجاع)</span><textarea v-model="note" class="input" rows="3" /></label>
        <div class="modal-actions">
          <button class="btn btn-primary" :disabled="busy" @click="decide('approve')">موافقة</button>
          <button class="btn btn-danger" :disabled="busy" @click="decide('return')">إرجاع للتعديل</button>
        </div>
      </section>
      <section class="card pm-panel" :class="{ wide: !p.can.decide }">
        <h2>سجل الخطة</h2>
        <div class="hr-alerts">
          <div v-for="(h, k) in [...p.history].reverse()" :key="k" class="hr-alert" style="--c: #a78bfa">
            <span class="dot" />
            <div><b>{{ h.label }}</b><template v-if="h.stageName"> · {{ h.stageName }}</template> — {{ h.actorName }}<span class="pm-muted">{{ fmtDate(h.at) }}<template v-if="h.note"> · {{ h.note }}</template></span></div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
