
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import HeatMap from '../components/HeatMap.vue';
import WorkflowBar from '../components/WorkflowBar.vue';
import {
  ACTION_STATUS, EFFECTIVENESS, fmtDate, levelOf, loadConfig, loadLookups, P, RESULTS, RISK_STATES, SOURCES, todayStr, TREATMENTS, type Lookups, type RiskConfig,
} from '../lib';
import '../../../shared/module.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id?: string }>();
const session = useSession();
const toast = useToast();
const router = useRouter();
const route = useRoute();
const cfg = ref<RiskConfig | null>(null);
const lk = ref<Lookups | null>(null);
const risk = ref<any>(null);
const blank = () => ({
  title: '', description: '', source: 'internal', category: '', productName: '', unitId: '', ownerName: '', causes: '', consequences: '',
  inherentLikelihood: 3, inherentImpact: 3, residualLikelihood: 2, residualImpact: 3, targetScore: null as number | null,
  treatment: 'reduce', treatmentNote: '', actions: [] as any[], kris: [] as any[], riskState: 'open', identifiedDate: todayStr(),
});
const form = reactive(blank());
const review = reactive({ show: false, reviewDate: todayStr(), likelihood: 2, impact: 3, note: '' });
const isNew = computed(() => !props.id);
const canEdit = computed(() => session.can(P.register) && (isNew.value || !['in_review', 'rejected'].includes(risk.value?.status)));
const inherent = computed(() => form.inherentLikelihood * form.inherentImpact);
const residual = computed(() => form.residualLikelihood * form.residualImpact);
const lvl = (s: number) => (cfg.value ? levelOf(cfg.value, s) : null);

function fill(r: any) {
  risk.value = r;
  Object.assign(form, {
    ...blank(), ...r, unitId: r.unitId ?? '', description: r.description ?? '', productName: r.productName ?? '', ownerName: r.ownerName ?? '', causes: r.causes ?? '',
    consequences: r.consequences ?? '', treatmentNote: r.treatmentNote ?? '', actions: r.actions.map((a: any) => ({ ...a })), kris: r.kris.map((k: any) => ({ ...k })),
  });
  review.likelihood = r.residualLikelihood;
  review.impact = r.residualImpact;
}
onMounted(async () => {
  const [c, l] = await Promise.all([loadConfig(), loadLookups()]);
  cfg.value = c.config;
  lk.value = l;
  if (props.id) fill(await api(`/risk/risks/${props.id}`));
  else if (route.query.title) {
    // إضافة خطر من دليل المخاطر: نعبئ العنوان والتصنيف والمصدر والأسباب، والمستخدم يكمل التقييم
    const q = route.query as Record<string, string | undefined>;
    Object.assign(form, { title: q.title ?? '', description: q.description ?? '', causes: q.causes ?? '', source: SOURCES[q.source ?? ''] ? q.source : 'internal' });
    form.category = q.category && c.config.categories.some((x) => x.code === q.category) ? q.category : c.config.categories[0]?.code ?? '';
  } else form.category = c.config.categories[0]?.code ?? '';
});
async function save() {
  try {
    const json = { ...form, unitId: form.unitId || null, targetScore: form.targetScore || null };
    const r = await api<any>(isNew.value ? '/risk/risks' : `/risk/risks/${props.id}`, { method: isNew.value ? 'POST' : 'PATCH', json });
    toast.success(isNew.value ? `سُجّل الخطر ${r.code}` : 'حُفظ الخطر');
    if (isNew.value) router.replace(`/risk/register/${r.id}`);
    fill(r);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function addReview() {
  try {
    fill(await api(`/risk/risks/${props.id}/reviews`, { method: 'POST', json: { reviewDate: review.reviewDate, likelihood: review.likelihood, impact: review.impact, note: review.note || null } }));
    review.show = false;
    review.note = '';
    toast.success('سُجّلت المراجعة وحُدد موعد المراجعة التالية');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove() {
  if (!confirm('حذف هذا الخطر نهائيًا؟')) return;
  try {
    await api(`/risk/risks/${props.id}`, { method: 'DELETE' });
    router.push('/risk/register');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const hintL = (v: number) => cfg.value?.likelihood.find((x) => x.value === v);
const hintI = (v: number) => cfg.value?.impact.find((x) => x.value === v);
</script>

<template>
  <div v-if="cfg && (isNew || risk)">
    <div class="page-head">
      <div>
        <h1><span v-if="risk" class="rk-code" style="font-size: 1rem">{{ risk.code }}</span> {{ isNew ? 'تسجيل خطر جديد' : form.title }}</h1>
        <p class="muted">
          <template v-if="risk">حُدد {{ fmtDate(risk.identifiedDate) }} · المراجعة القادمة <b :style="{ color: risk.reviewOverdue ? 'var(--danger)' : '' }">{{ fmtDate(risk.nextReviewDate) }}</b>
            <template v-if="risk.analysis"> · من تحليل <RouterLink :to="`/risk/analysis/${risk.analysis.id}`" class="pm-link">{{ risk.analysis.code }}</RouterLink></template></template>
          <template v-else>عرّف الخطر ومصدره، ثم قيّمه قبل الضوابط وبعدها، وحدد المعالجة.</template>
        </p>
      </div>
      <div class="pm-actions">
        <button v-if="risk && session.can(P.register) && risk.riskState !== 'closed'" class="btn" @click="review.show = true">مراجعة دورية</button>
        <button v-if="risk && session.can(P.register) && !risk.approvedAt" class="btn btn-danger" @click="remove">حذف</button>
      </div>
    </div>

    <div class="rk-grid">
      <fieldset :disabled="!canEdit" style="border: 0; padding: 0; margin: 0; min-width: 0; display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2>تعريف الخطر</h2>
          <label class="field"><span>عنوان الخطر</span><input v-model="form.title" class="input" placeholder="مثل: انخفاض التبرعات عن المستهدف" /></label>
          <div class="rk-sec">مصدر الخطر</div>
          <div class="rk-tabs">
            <button v-for="(s, k) in SOURCES" :key="k" type="button" :class="['rk-tab', { on: form.source === k }]" :title="s.hint" @click="form.source = k">{{ s.label }}</button>
          </div>
          <p class="pm-muted" style="margin-top: -6px">{{ SOURCES[form.source].hint }}</p>
          <div class="rk-fields">
            <label class="field"><span>التصنيف</span><select v-model="form.category" class="input"><option v-for="c in cfg.categories" :key="c.code" :value="c.code">{{ c.name }}</option></select></label>
            <label v-if="form.source === 'product'" class="field"><span>المنتج أو الخدمة أو البرنامج</span><input v-model="form.productName" class="input" /></label>
            <label class="field"><span>الجهة المسؤولة (من الهيكل)</span><select v-model="form.unitId" class="input"><option value="">—</option><option v-for="u in lk?.units" :key="u.id" :value="u.id">{{ '— '.repeat(u.level) }}{{ u.name }}</option></select></label>
            <label class="field"><span>مالك الخطر</span><input v-model="form.ownerName" class="input" list="rk-users" /></label>
            <label class="field"><span>تاريخ التحديد</span><input v-model="form.identifiedDate" type="date" class="input" /></label>
            <label v-if="!isNew" class="field"><span>حالة الخطر</span><select v-model="form.riskState" class="input"><option v-for="(s, k) in RISK_STATES" :key="k" :value="k">{{ s.label }}</option></select></label>
          </div>
          <datalist id="rk-users"><option v-for="u in lk?.users" :key="u.id" :value="u.fullName" /></datalist>
          <label class="field"><span>الوصف</span><textarea v-model="form.description" class="input" rows="2" /></label>
          <div class="pm-grid2">
            <label class="field"><span>الأسباب</span><textarea v-model="form.causes" class="input" rows="3" /></label>
            <label class="field"><span>النتائج المحتملة</span><textarea v-model="form.consequences" class="input" rows="3" /></label>
          </div>
        </section>

        <section class="card pm-panel">
          <h2>التقييم (الاحتمالية × الأثر) <span class="pm-muted">حد الرغبة {{ cfg.appetite }}</span></h2>
          <div class="pm-grid2">
            <div>
              <div class="rk-sec">الخطر الكامن (قبل الضوابط) <span class="rk-score" :style="{ '--c': lvl(inherent)?.color }">{{ inherent }}</span> {{ lvl(inherent)?.name }}</div>
              <HeatMap :config="cfg" pick :likelihood="form.inherentLikelihood" :impact="form.inherentImpact" @pick="(v) => { form.inherentLikelihood = v.likelihood; form.inherentImpact = v.impact; }" />
              <p class="pm-muted">الاحتمالية: <b>{{ hintL(form.inherentLikelihood)?.name }}</b> · الأثر: <b>{{ hintI(form.inherentImpact)?.name }}</b></p>
            </div>
            <div>
              <div class="rk-sec">الخطر المتبقي (بعد الضوابط) <span class="rk-score" :style="{ '--c': lvl(residual)?.color }">{{ residual }}</span> {{ lvl(residual)?.name }}</div>
              <HeatMap :config="cfg" pick :likelihood="form.residualLikelihood" :impact="form.residualImpact" @pick="(v) => { form.residualLikelihood = v.likelihood; form.residualImpact = v.impact; }" />
              <p class="pm-muted">{{ hintL(form.residualLikelihood)?.description }}</p>
            </div>
          </div>
          <div v-if="residual > inherent" class="rk-danger">الخطر المتبقي لا يكون أعلى من الكامن.</div>
          <div v-else-if="lvl(residual)" class="rk-note"><b>{{ lvl(residual)!.name }}:</b> {{ lvl(residual)!.action }} · مراجعة كل {{ lvl(residual)!.reviewDays }} يومًا</div>
        </section>

        <section class="card pm-panel">
          <h2>المعالجة</h2>
          <div class="rk-tabs"><button v-for="(t, k) in TREATMENTS" :key="k" type="button" :class="['rk-tab', { on: form.treatment === k }]" :title="t.hint" @click="form.treatment = k">{{ t.label }}</button></div>
          <p class="pm-muted" style="margin-top: -6px">{{ TREATMENTS[form.treatment].hint }}</p>
          <div class="rk-fields">
            <label class="field"><span>الخطر المستهدف (درجة)</span><input v-model.number="form.targetScore" type="number" min="1" max="25" class="input" /></label>
          </div>
          <label v-if="form.treatment === 'accept'" class="field"><span>مبرر القبول {{ residual > cfg.appetite ? '(إلزامي: الخطر فوق حد الرغبة)' : '' }}</span><textarea v-model="form.treatmentNote" class="input" rows="2" /></label>
          <div class="rk-sec">إجراءات المعالجة</div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>الإجراء</th><th>المسؤول</th><th>الموعد</th><th>الحالة</th><th /></tr></thead>
            <tbody><tr v-for="(a, i) in form.actions" :key="i">
              <td><input v-model="a.title" class="input" /></td><td><input v-model="a.ownerName" class="input" list="rk-users" /></td>
              <td><input v-model="a.dueDate" type="date" class="input" :style="{ borderColor: a.status !== 'done' && a.dueDate && a.dueDate < todayStr() ? 'var(--danger)' : '' }" /></td>
              <td><select v-model="a.status" class="input"><option v-for="(l, k) in ACTION_STATUS" :key="k" :value="k">{{ l }}</option></select></td>
              <td><button type="button" class="btn btn-sm" @click="form.actions.splice(i, 1)">✕</button></td>
            </tr></tbody>
          </table></div>
          <button type="button" class="btn btn-sm" @click="form.actions.push({ title: '', ownerName: form.ownerName, dueDate: null, status: 'planned' })">+ إجراء</button>
          <div class="rk-sec">مؤشرات الإنذار المبكر (KRI)</div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>المؤشر</th><th>الحد</th><th>القيمة الحالية</th><th>تجاوز الحد</th><th /></tr></thead>
            <tbody><tr v-for="(k, i) in form.kris" :key="i">
              <td><input v-model="k.name" class="input" /></td><td><input v-model="k.threshold" class="input" /></td><td><input v-model="k.current" class="input" /></td>
              <td><label class="check"><input v-model="k.breached" type="checkbox" /><span :style="{ color: k.breached ? 'var(--danger)' : '' }">{{ k.breached ? 'متجاوز' : 'ضمن الحد' }}</span></label></td>
              <td><button type="button" class="btn btn-sm" @click="form.kris.splice(i, 1)">✕</button></td>
            </tr></tbody>
          </table></div>
          <button type="button" class="btn btn-sm" @click="form.kris.push({ name: '', threshold: '', current: '', breached: false })">+ مؤشر</button>
          <div v-if="canEdit" class="modal-actions" style="margin-top: 16px"><button type="button" class="btn btn-primary" @click="save">{{ isNew ? 'تسجيل الخطر' : 'حفظ' }}</button></div>
          <p v-if="risk?.status === 'approved' && canEdit" class="pm-muted">تغيير التقييم أو خيار المعالجة يعيد الخطر للاعتماد. تحديث الإجراءات والمؤشرات لا يعيده.</p>
        </section>
      </fieldset>

      <div v-if="risk" style="display: grid; gap: 16px; align-content: start">
        <WorkflowBar :item="risk" :base="`/risk/risks/${risk.id}`" :can-submit="session.can(P.register)" @changed="fill" />
        <section class="card pm-panel">
          <h2>سجل المراجعات <span class="pm-tag">{{ risk.reviews.length }}</span></h2>
          <ul class="rk-log">
            <li v-for="r in risk.reviews" :key="r.id"><span class="rk-score" :style="{ '--c': lvl(r.score)?.color }">{{ r.score }}</span>
              <span>{{ fmtDate(r.reviewDate) }} · {{ r.byName }}<span class="pm-muted"> {{ r.likelihood }}×{{ r.impact }}{{ r.note ? ` — ${r.note}` : '' }}</span></span></li>
          </ul>
        </section>
        <section class="card pm-panel">
          <h2>الضوابط الرقابية <RouterLink to="/risk/controls" class="pm-link" style="font-size: .8rem">المكتبة</RouterLink></h2>
          <p v-if="!risk.controls.length" class="pm-muted">لا ضوابط مرتبطة. اربطها من مكتبة الضوابط.</p>
          <div v-for="c in risk.controls" :key="c.id" class="rk-chip" style="margin-bottom: 6px"><span class="rk-code">{{ c.code }}</span>{{ c.name }}
            <span class="pm-pill" :style="{ '--c': EFFECTIVENESS[c.effectiveness].color }">{{ EFFECTIVENESS[c.effectiveness].label }}</span></div>
          <template v-if="risk.obligations.length">
            <div class="rk-sec">متطلبات الالتزام المرتبطة</div>
            <div v-for="o in risk.obligations" :key="o.id" class="rk-chip" style="margin-bottom: 6px"><span class="rk-code">{{ o.code }}</span>{{ o.title }}
              <span v-if="o.lastResult" class="pm-pill" :style="{ '--c': RESULTS[o.lastResult].color }">{{ RESULTS[o.lastResult].label }}</span></div>
          </template>
        </section>
      </div>
    </div>

    <div v-if="review.show" class="modal-backdrop" @click.self="review.show = false">
      <form class="card modal" @submit.prevent="addReview">
        <h2>مراجعة دورية للخطر</h2>
        <p class="pm-muted">أعد تقييم الخطر المتبقي. يُحفظ في سجل المراجعات، ويُحسب موعد المراجعة التالية حسب المستوى الجديد، ولا يعيد الخطر للاعتماد.</p>
        <label class="field"><span>تاريخ المراجعة</span><input v-model="review.reviewDate" type="date" class="input" /></label>
        <HeatMap :config="cfg" pick :likelihood="review.likelihood" :impact="review.impact" @pick="(v) => { review.likelihood = v.likelihood; review.impact = v.impact; }" />
        <label class="field" style="margin-top: 10px"><span>ملاحظة</span><textarea v-model="review.note" class="input" rows="2" /></label>
        <div class="modal-actions"><button class="btn btn-primary">حفظ المراجعة ({{ review.likelihood * review.impact }})</button><button type="button" class="btn" @click="review.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
