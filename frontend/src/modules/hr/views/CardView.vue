<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, STATUS_COLOR, fmtDate } from '../lib';
import '../../projects/projects.css';
import '../hr.css';

interface Obj { title: string; weight: number; target: string; achievement: number | null; note: string | null }
interface Comp { competencyId: string; name: string; requiredLevel: number; rating: number | null; levels: { level: number; description: string }[] }
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const router = useRouter();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const c = ref<any>(null);
const objectives = ref<Obj[]>([]);
const comps = ref<Comp[]>([]);
const managerNote = ref('');
const employeeNote = ref('');
function take(v: unknown) {
  c.value = v;
  objectives.value = c.value.objectives.map((o: Obj) => ({ ...o }));
  comps.value = c.value.competencies.map((x: Comp) => ({ ...x }));
  managerNote.value = c.value.managerNote ?? '';
  employeeNote.value = c.value.employeeNote ?? '';
}
onMounted(async () => take(await api(`/hr/performance/${props.id}`)));
const canEdit = computed(() => session.can(P.performance) && (c.value?.status === 'draft' || c.value?.status === 'agreed'));
const draft = computed(() => c.value?.status === 'draft');
const weightTotal = computed(() => objectives.value.reduce((s, o) => s + Number(o.weight || 0), 0));
const steps = computed(() => {
  const order = ['draft', 'agreed', 'evaluated', 'approved'];
  const i = order.indexOf(c.value?.status ?? 'draft');
  return ['إعداد الأهداف', 'اعتماد الأهداف', 'التقييم', 'الاعتماد النهائي'].map((l, k) => ({ l, done: k <= i }));
});
async function save(silent = false) {
  try {
    take(await api(`/hr/performance/${props.id}`, { method: 'PATCH', json: {
      objectives: objectives.value.map((o) => ({ ...o, weight: Number(o.weight), achievement: o.achievement === null || (o.achievement as unknown) === '' ? null : Number(o.achievement) })),
      competencies: comps.value.map((x) => ({ competencyId: x.competencyId, requiredLevel: x.requiredLevel, rating: x.rating })),
      managerNote: managerNote.value || null, employeeNote: employeeNote.value || null,
    } }));
    if (!silent) toast.success('تم الحفظ');
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  }
}
async function action(a: 'agree' | 'evaluate' | 'approve' | 'reopen') {
  if (canEdit.value && !(await save(true))) return;
  try {
    take(await api(`/hr/performance/${props.id}/action`, { method: 'POST', json: { action: a } }));
    toast.success({ agree: 'اعتُمدت الأهداف', evaluate: 'أُرسل التقييم للاعتماد', approve: 'اعتُمد التقييم', reopen: 'أُعيد فتح البطاقة' }[a]);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove() {
  if (!confirm('حذف البطاقة؟')) return;
  try {
    await api(`/hr/performance/${props.id}`, { method: 'DELETE' });
    router.push('/hr/performance');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const addComp = ref('');
function pushComp() {
  const x = c.value.allCompetencies.find((a: { id: string }) => a.id === addComp.value);
  if (x && !comps.value.some((k) => k.competencyId === x.id)) comps.value.push({ competencyId: x.id, name: x.name, requiredLevel: 3, rating: null, levels: [] });
  addComp.value = '';
}
const shownScore = computed(() => (c.value?.finalScore ?? c.value?.preview.finalScore ?? 0) as number);
const color = computed(() => (shownScore.value >= 90 ? '#10b981' : shownScore.value >= 80 ? '#14b8a6' : shownScore.value >= 70 ? '#6366f1' : shownScore.value >= 60 ? '#f59e0b' : '#ef4444'));
</script>

<template>
  <div v-if="c">
    <section class="pm-hero hr-hero">
      <div>
        <p class="pm-kicker">بطاقة الأداء {{ c.year }} · {{ c.employee.unitName }}</p>
        <h1>{{ c.employee.fullName }}</h1>
        <p class="pm-sub">{{ c.employee.jobTitle }}{{ c.employee.managerName ? ` · المدير المباشر ${c.employee.managerName}` : '' }}</p>
      </div>
      <div class="pm-actions">
        <span class="pm-pill" :style="{ '--c': STATUS_COLOR[c.status], background: 'rgba(255,255,255,.9)' }">{{ c.statusLabel }}</span>
        <button v-if="canEdit" class="btn hr-ghost" @click="save()">حفظ</button>
        <button v-if="c.status === 'draft' && session.can(P.performance)" class="btn hr-glow" @click="action('agree')">اعتماد الأهداف</button>
        <button v-if="c.status === 'agreed' && session.can(P.performance)" class="btn hr-glow" @click="action('evaluate')">إرسال التقييم</button>
        <button v-if="c.status === 'evaluated' && session.can(P.approvePerformance)" class="btn hr-glow" @click="action('approve')">الاعتماد النهائي</button>
        <button v-if="(c.status === 'agreed' && session.can(P.performance)) || (['evaluated', 'approved'].includes(c.status) && session.can(P.approvePerformance))" class="btn hr-ghost" @click="action('reopen')">إعادة فتح</button>
        <button v-if="c.status === 'draft' && session.can(P.performance)" class="btn hr-ghost" @click="remove">حذف</button>
      </div>
    </section>
    <div class="card pm-panel"><div class="hr-steps"><div v-for="s in steps" :key="s.l" :class="{ done: s.done }">{{ s.l }}</div></div></div>

    <div class="hr-grid" style="margin-top: 16px">
      <section class="card pm-panel">
        <h2>الأهداف ({{ c.objectivesWeight }}% من النتيجة) <span class="pm-tag" :style="{ color: weightTotal === 100 ? 'var(--success)' : 'var(--danger)' }">مجموع الأوزان {{ weightTotal }}%</span></h2>
        <table class="table">
          <thead><tr><th>الهدف</th><th style="width: 80px">الوزن %</th><th style="width: 120px">المستهدف</th><th v-if="!draft" style="width: 110px">الإنجاز %</th><th v-if="!draft">ملاحظة</th><th v-if="draft && canEdit" /></tr></thead>
          <tbody>
            <tr v-for="(o, i) in objectives" :key="i">
              <td><input v-if="draft && canEdit" v-model="o.title" class="input" /><span v-else>{{ o.title }}</span></td>
              <td><input v-if="draft && canEdit" v-model.number="o.weight" type="number" min="0" max="100" class="input" /><span v-else>{{ o.weight }}</span></td>
              <td><input v-if="draft && canEdit" v-model="o.target" class="input" /><span v-else>{{ o.target }}</span></td>
              <td v-if="!draft"><input v-if="canEdit" v-model.number="o.achievement" type="number" min="0" :max="c.maxAchievement" class="input" /><b v-else>{{ o.achievement ?? '—' }}</b></td>
              <td v-if="!draft"><input v-if="canEdit" v-model="o.note" class="input" /><span v-else class="pm-muted">{{ o.note }}</span></td>
              <td v-if="draft && canEdit"><button class="btn btn-sm" @click="objectives.splice(i, 1)">✕</button></td>
            </tr>
            <tr v-if="!objectives.length"><td colspan="5" class="pm-empty">لا توجد أهداف</td></tr>
          </tbody>
        </table>
        <button v-if="draft && canEdit" class="btn btn-sm" style="margin-top: 8px" @click="objectives.push({ title: '', weight: 0, target: '', achievement: null, note: null })">+ هدف</button>
        <p v-if="!draft" class="pm-muted">نسبة الإنجاز تُحسب حتى {{ c.maxAchievement }}% كحد أعلى.</p>

        <h2 style="margin-top: 18px">الجدارات ({{ 100 - c.objectivesWeight }}% من النتيجة)</h2>
        <div v-for="(x, i) in comps" :key="x.competencyId" style="padding: 10px 0; border-bottom: 1px dashed var(--border)">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap">
            <b>{{ x.name }}</b>
            <span v-if="draft && canEdit" style="display: flex; gap: 6px; align-items: center">المستوى المطلوب
              <select v-model.number="x.requiredLevel" class="input" style="width: 70px"><option v-for="l in 5" :key="l" :value="l">{{ l }}</option></select>
              <button class="btn btn-sm" @click="comps.splice(i, 1)">✕</button></span>
            <span v-else class="hr-stars">
              <button v-for="l in 5" :key="l" type="button" :class="{ on: (x.rating ?? 0) >= l, req: l === x.requiredLevel }" :disabled="!canEdit" :title="x.levels.find((v) => v.level === l)?.description" @click="x.rating = l">{{ l }}</button>
            </span>
          </div>
          <small class="pm-muted">المطلوب: المستوى {{ x.requiredLevel }}{{ x.levels.find((v) => v.level === (x.rating ?? x.requiredLevel))?.description ? ` · ${x.levels.find((v) => v.level === (x.rating ?? x.requiredLevel))?.description}` : '' }}</small>
        </div>
        <div v-if="draft && canEdit" style="display: flex; gap: 6px; margin-top: 8px">
          <select v-model="addComp" class="input"><option value="">أضف جدارة</option><option v-for="a in c.allCompetencies" :key="a.id" :value="a.id">{{ a.name }}</option></select>
          <button class="btn btn-sm" :disabled="!addComp" @click="pushComp">إضافة</button>
        </div>
      </section>

      <section class="card pm-panel">
        <h2>النتيجة {{ c.finalScore === null ? '(تقديرية)' : '' }}</h2>
        <div class="hr-score" :style="{ '--v': Math.min(100, shownScore), '--c': color }"><div><strong :style="{ color }">{{ shownScore }}</strong><span class="pm-muted">{{ c.rating ?? c.preview.rating }}</span></div></div>
        <dl class="pm-dl" style="margin-top: 14px">
          <div><dt>نتيجة الأهداف</dt><dd>{{ c.objectivesScore ?? c.preview.objectivesScore ?? '—' }}</dd></div>
          <div><dt>نتيجة الجدارات</dt><dd>{{ c.competenciesScore ?? c.preview.competenciesScore ?? '—' }}</dd></div>
        </dl>
        <div class="hr-chips" style="margin-top: 10px"><span v-for="b in c.bands" :key="b.label" class="hr-chip">{{ b.label }} ≥ {{ b.min }}</span></div>
        <label class="field" style="margin-top: 14px"><span>ملاحظات المدير</span><textarea v-model="managerNote" class="input" rows="3" :disabled="!canEdit" /></label>
        <label class="field"><span>ملاحظات الموظف</span><textarea v-model="employeeNote" class="input" rows="2" :disabled="!canEdit" /></label>
        <ul class="hr-list pm-muted">
          <li v-if="c.agreedAt">اعتُمدت الأهداف {{ fmtDate(c.agreedAt) }}</li>
          <li v-if="c.evaluatedAt">قيّمه {{ c.evaluatedByName }} في {{ fmtDate(c.evaluatedAt) }}</li>
          <li v-if="c.approvedAt">اعتمده {{ c.approvedByName }} في {{ fmtDate(c.approvedAt) }}</li>
        </ul>
      </section>
    </div>
  </div>
</template>
