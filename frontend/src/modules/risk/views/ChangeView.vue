
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import RiskPicker from '../components/RiskPicker.vue';
import TaskTable from '../components/TaskTable.vue';
import WorkflowBar from '../components/WorkflowBar.vue';
import { CHANGE_CLASSES, fmtDate, IMPACT_AREAS, loadConfig, loadLookups, P, PHASES, PRIORITIES, type Lookups, type RiskConfig } from '../lib';
import '../../projects/projects.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id?: string }>();
const session = useSession();
const toast = useToast();
const router = useRouter();
const cfg = ref<RiskConfig | null>(null);
const lk = ref<Lookups | null>(null);
const data = ref<any>(null);
const blank = () => ({
  title: '', changeType: '', changeClass: 'normal', priority: 'medium', reason: '', description: '', affectedUnits: '', benefits: '', costEstimate: null as number | null,
  impacts: IMPACT_AREAS.map((area) => ({ area, level: 0, note: '' })), riskIds: [] as string[], communication: '', plannedStart: '', plannedEnd: '',
});
const form = reactive(blank());
const phase = reactive({ reviewResult: '', lessons: '' });
const isNew = computed(() => !props.id);
const canEdit = computed(() => session.can(P.change) && (isNew.value || (!['in_review', 'rejected'].includes(data.value?.status) && data.value?.phase === 'request')));
const LEVELS = ['لا أثر', 'ضئيل', 'طفيف', 'متوسط', 'كبير', 'جسيم'];

function fill(c: any) {
  data.value = c;
  const impacts = IMPACT_AREAS.map((area) => c.impacts.find((i: any) => i.area === area) ?? { area, level: 0, note: '' });
  for (const i of c.impacts) if (!IMPACT_AREAS.includes(i.area)) impacts.push(i);
  Object.assign(form, {
    ...blank(), ...c, description: c.description ?? '', affectedUnits: c.affectedUnits ?? '', benefits: c.benefits ?? '', communication: c.communication ?? '',
    plannedStart: c.plannedStart ?? '', plannedEnd: c.plannedEnd ?? '', impacts: impacts.map((i: any) => ({ ...i, note: i.note ?? '' })), riskIds: [...c.riskIds],
  });
  phase.reviewResult = c.reviewResult ?? '';
  phase.lessons = c.lessons ?? '';
}
async function reload() { fill(await api(`/risk/changes/${props.id}`)); }
onMounted(async () => {
  const [c, l] = await Promise.all([loadConfig(), loadLookups()]);
  cfg.value = c.config;
  lk.value = l;
  if (props.id) await reload();
  else form.changeType = c.config.changeTypes[0]?.code ?? '';
});
async function save() {
  try {
    const json = {
      ...form, impacts: form.impacts.filter((i) => i.level > 0).map((i) => ({ ...i, note: i.note || null })), costEstimate: form.costEstimate || null,
      plannedStart: form.plannedStart || null, plannedEnd: form.plannedEnd || null,
    };
    const c = await api<any>(isNew.value ? '/risk/changes' : `/risk/changes/${props.id}`, { method: isNew.value ? 'POST' : 'PATCH', json });
    toast.success(isNew.value ? `سُجل طلب التغيير ${c.code}` : 'حُفظ الطلب');
    if (isNew.value) router.replace(`/risk/changes/${c.id}`);
    fill(c);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const nextPhase = computed(() => ({ request: 'implementing', implementing: 'completed', completed: 'closed' } as Record<string, string>)[data.value?.phase]);
const canStart = computed(() => data.value && (data.value.status === 'approved' || (data.value.changeClass === 'emergency' && data.value.status !== 'rejected')));
async function advance() {
  try {
    fill(await api(`/risk/changes/${props.id}/progress`, { method: 'POST', json: { phase: nextPhase.value, reviewResult: phase.reviewResult || null, lessons: phase.lessons || null } }));
    toast.success(`انتقل الطلب إلى «${PHASES[data.value.phase].label}»`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div v-if="cfg && (isNew || data)">
    <div class="page-head">
      <div><h1><span v-if="data" class="rk-code" style="font-size: 1rem">{{ data.code }}</span> {{ isNew ? 'رصد تغيير جديد' : form.title }}</h1>
        <p class="muted"><template v-if="data">قدّمه {{ data.requestedBy }} في {{ fmtDate(data.createdAt) }} · <span class="pm-pill" :style="{ '--c': PHASES[data.phase].color }">{{ PHASES[data.phase].label }}</span></template>
          <template v-else>صف التغيير ومبرره، وقيّم أثره على كل مجال، واربطه بالمخاطر الناتجة عنه.</template></p></div>
    </div>
    <div class="rk-grid">
      <fieldset :disabled="!canEdit" style="border: 0; padding: 0; margin: 0; min-width: 0; display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2>الطلب</h2>
          <label class="field"><span>عنوان التغيير</span><input v-model="form.title" class="input" /></label>
          <div class="rk-fields">
            <label class="field"><span>النوع</span><select v-model="form.changeType" class="input"><option v-for="t in cfg.changeTypes" :key="t.code" :value="t.code">{{ t.name }}</option></select></label>
            <label class="field"><span>التصنيف</span><select v-model="form.changeClass" class="input"><option v-for="(c, k) in CHANGE_CLASSES" :key="k" :value="k">{{ c.label }}</option></select></label>
            <label class="field"><span>الأولوية</span><select v-model="form.priority" class="input"><option v-for="(p, k) in PRIORITIES" :key="k" :value="k">{{ p.label }}</option></select></label>
            <label class="field"><span>التكلفة التقديرية (ريال)</span><input v-model.number="form.costEstimate" type="number" min="0" class="input" /></label>
            <label class="field"><span>البداية المخططة</span><input v-model="form.plannedStart" type="date" class="input" /></label>
            <label class="field"><span>النهاية المخططة</span><input v-model="form.plannedEnd" type="date" class="input" /></label>
          </div>
          <p class="pm-muted" style="margin-top: -6px">{{ CHANGE_CLASSES[form.changeClass].hint }}</p>
          <label class="field"><span>مبرر التغيير</span><textarea v-model="form.reason" class="input" rows="2" /></label>
          <label class="field"><span>الوصف</span><textarea v-model="form.description" class="input" rows="3" /></label>
          <label class="field"><span>الإدارات والجهات المتأثرة</span><input v-model="form.affectedUnits" class="input" /></label>
          <label class="field"><span>المنافع المتوقعة</span><textarea v-model="form.benefits" class="input" rows="2" /></label>
        </section>
        <section class="card pm-panel">
          <h2>تقييم الأثر</h2>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>المجال</th><th>درجة الأثر</th><th>ملاحظة</th></tr></thead>
            <tbody><tr v-for="i in form.impacts" :key="i.area">
              <td>{{ i.area }}</td>
              <td><select v-model.number="i.level" class="input" :style="{ borderColor: i.level >= 4 ? 'var(--danger)' : '' }"><option v-for="(l, n) in LEVELS" :key="n" :value="n">{{ n }} - {{ l }}</option></select></td>
              <td><input v-model="i.note" class="input" /></td>
            </tr></tbody>
          </table></div>
          <div class="rk-sec">المخاطر الناتجة أو المرتبطة (من السجل المؤسسي)</div>
          <RiskPicker v-model="form.riskIds" :options="lk?.risks ?? []" :disabled="!canEdit" />
          <label class="field" style="margin-top: 12px"><span>خطة التواصل وإدارة الجانب البشري (الوعي، الرغبة، المعرفة، القدرة، التعزيز)</span><textarea v-model="form.communication" class="input" rows="3" /></label>
          <div v-if="canEdit" class="modal-actions"><button type="button" class="btn btn-primary" @click="save">{{ isNew ? 'تسجيل الطلب' : 'حفظ' }}</button></div>
        </section>
      </fieldset>
      <div v-if="data" style="display: grid; gap: 16px; align-content: start">
        <WorkflowBar :item="data" :base="`/risk/changes/${data.id}`" :can-submit="session.can(P.change)" @changed="fill" />
        <section class="card pm-panel">
          <h2>مراحل التنفيذ</h2>
          <div class="rk-wf">
            <template v-for="(p, k, i) in PHASES" :key="k">
              <span v-if="i" class="ln" :class="{ done: Object.keys(PHASES).indexOf(data.phase) >= i }" />
              <span :class="['st', { done: Object.keys(PHASES).indexOf(data.phase) > i || data.phase === 'closed', cur: data.phase === k && k !== 'closed' }]"><i>{{ i + 1 }}</i>{{ p.label }}</span>
            </template>
          </div>
          <div v-if="session.can(P.change) && nextPhase" style="margin-top: 12px">
            <template v-if="!canStart"><p class="pm-muted">يبدأ التنفيذ بعد اعتماد الطلب (التغيير الطارئ يبدأ قبل اكتمال اعتماده).</p></template>
            <template v-else>
              <template v-if="nextPhase === 'completed'">
                <label class="field"><span>نتيجة المراجعة بعد التنفيذ (هل تحققت المنافع؟)</span><textarea v-model="phase.reviewResult" class="input" rows="2" /></label>
                <label class="field"><span>الدروس المستفادة</span><textarea v-model="phase.lessons" class="input" rows="2" /></label>
              </template>
              <button class="btn btn-primary" @click="advance">{{ nextPhase === 'implementing' ? 'بدء التنفيذ' : nextPhase === 'completed' ? 'اعتبار التغيير مكتملًا' : 'إغلاق التغيير' }}</button>
            </template>
          </div>
          <template v-if="data.reviewResult"><div class="rk-sec">المراجعة بعد التنفيذ</div><p class="rk-pre">{{ data.reviewResult }}</p><p v-if="data.lessons" class="pm-muted">الدروس: {{ data.lessons }}</p></template>
        </section>
      </div>
      <section v-if="data" class="card pm-panel wide">
        <h2>مهام المتابعة الفرعية <span class="pm-tag">{{ data.tasksDone }} / {{ data.tasksTotal }} · {{ data.progress }}%</span></h2>
        <p class="pm-muted">كل مهمة تُسند لجهة من الهيكل التنظيمي ومسؤول بموعد، ويحدّث المسؤول إنجازها، ولا يكتمل التغيير قبل إنجازها كلها.</p>
        <TaskTable :tasks="data.tasks" :add-path="data.phase !== 'closed' && data.status !== 'rejected' ? `/risk/changes/${data.id}/tasks` : undefined" :can-manage="session.can(P.change)" :lookups="lk" @changed="reload" />
      </section>
    </div>
  </div>
</template>
