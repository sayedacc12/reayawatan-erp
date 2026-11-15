<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import AnswersList from '../components/AnswersList.vue';
import DynamicFields from '../components/DynamicFields.vue';
import StageStepper from '../components/StageStepper.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { color, fmtDateTime, label } from '../labels';
import type { RequestDetail } from '../types';

const route = useRoute();
const session = useSession();
const toast = useToast();
const id = route.params.id as string;
const r = ref<RequestDetail | null>(null);
const error = ref('');

async function load() {
  try {
    r.value = await api<RequestDetail>(`/beneficiaries/requests/${id}`);
    decision.formData = {};
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

const stage = computed(() => r.value?.workflow?.stages.find((s) => s.id === r.value?.currentStageId) ?? null);
const isLast = computed(() => {
  const st = r.value?.workflow?.stages ?? [];
  return !!stage.value && st[st.length - 1]?.id === stage.value.id;
});
const isFirst = computed(() => r.value?.workflow?.stages[0]?.id === stage.value?.id);

const decision = reactive({ decision: '' as '' | 'approve' | 'reject' | 'return', notes: '', formData: {} as Record<string, unknown> });
const busy = ref(false);
const decisionError = ref('');

async function decide() {
  decisionError.value = '';
  if (!decision.decision) { decisionError.value = 'اختر القرار'; return; }
  busy.value = true;
  try {
    r.value = await api<RequestDetail>(`/beneficiaries/requests/${id}/decision`, {
      method: 'POST',
      json: { decision: decision.decision, notes: decision.notes, formData: decision.decision === 'approve' ? decision.formData : undefined },
    });
    const msg = { approve: isLastBefore.value ? 'تم الاعتماد النهائي للطلب 🎉' : 'تم القبول وانتقل الطلب للمرحلة التالية', reject: 'تم رفض الطلب', return: 'تم إرجاع الطلب' }[decision.decision];
    toast.success(msg);
    Object.assign(decision, { decision: '', notes: '', formData: {} });
  } catch (e) {
    decisionError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
// نحفظ هل كانت المرحلة الأخيرة قبل ما الرد يغيّرها
const isLastBefore = ref(false);
function choose(d: 'approve' | 'reject' | 'return') {
  decision.decision = d;
  isLastBefore.value = isLast.value;
}

async function resubmit() {
  try {
    r.value = await api<RequestDetail>(`/beneficiaries/requests/${id}/resubmit`, { method: 'POST', json: { notes: 'أعاد الموظف تقديم الطلب بعد استكمال البيانات' } });
    toast.success('تمت إعادة تقديم الطلب');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <RouterLink to="/beneficiaries/requests" class="back">→ كل الطلبات</RouterLink>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <template v-if="r">
      <section class="head card">
        <div class="head-top">
          <div>
            <p class="crumbs"><span v-for="(p, i) in r.project.path" :key="i">{{ p }}</span></p>
            <h1>طلب رقم {{ r.requestNo }} <StatusBadge :value="r.status" kind="request" /></h1>
            <p class="muted small">
              قُدِّم {{ fmtDateTime(r.createdAt) }} من {{ r.source === 'portal' ? 'بوابة المستفيد' : 'الموظف' }}
              <template v-if="r.workflow"> · {{ r.workflow.name }}</template>
            </p>
          </div>
          <RouterLink v-if="r.beneficiary" :to="`/beneficiaries/files/${r.beneficiary.id}`" class="who">
            <span class="av">{{ r.beneficiary.fullName.charAt(0) }}</span>
            <span><b>{{ r.beneficiary.fullName }}</b><small class="muted">ملف {{ r.beneficiary.fileNo }} · {{ label('category', r.beneficiary.category) }}</small></span>
          </RouterLink>
        </div>
        <StageStepper v-if="r.workflow" :stages="r.workflow.stages" :current-id="r.currentStageId" :status="r.status" />
      </section>

      <div class="cols">
        <div class="main">
          <!-- لوحة القرار -->
          <section v-if="r.status === 'in_progress' && stage" :class="['card decision', { can: r.canDecide }]">
            <div class="d-head">
              <span class="pulse" />
              <div>
                <h2>المرحلة الحالية: {{ stage.name }}</h2>
                <p v-if="stage.instructions" class="muted small">{{ stage.instructions }}</p>
                <p v-if="stage.roleName" class="muted small">المسؤول: {{ stage.roleName }}</p>
              </div>
            </div>
            <form v-if="r.canDecide" @submit.prevent="decide">
              <div v-if="decisionError" class="alert alert-error">{{ decisionError }}</div>
              <div class="choices">
                <button type="button" :class="['choice approve', { on: decision.decision === 'approve' }]" @click="choose('approve')">✓ {{ isLast ? 'اعتماد نهائي' : 'قبول وتحويل للمرحلة التالية' }}</button>
                <button v-if="stage.canReturn" type="button" :class="['choice ret', { on: decision.decision === 'return' }]" @click="choose('return')">↩ {{ isFirst ? 'إرجاع لمقدم الطلب' : 'إرجاع للمرحلة السابقة' }}</button>
                <button v-if="stage.canReject" type="button" :class="['choice reject', { on: decision.decision === 'reject' }]" @click="choose('reject')">✕ رفض</button>
              </div>
              <Transition name="page">
                <div v-if="decision.decision" class="d-body">
                  <div v-if="decision.decision === 'approve' && stage.form" class="stage-form">
                    <p class="form-title">{{ stage.form.name }}</p>
                    <DynamicFields v-model="decision.formData" :fields="stage.form.fields" />
                  </div>
                  <div class="field">
                    <label>{{ decision.decision === 'approve' ? 'ملاحظات (اختياري)' : decision.decision === 'reject' ? 'سبب الرفض *' : 'سبب الإرجاع *' }}</label>
                    <textarea v-model="decision.notes" class="input" rows="3" :required="decision.decision !== 'approve'" />
                    <small v-if="decision.decision !== 'approve'" class="muted">السبب هيظهر للمستفيد في البوابة</small>
                  </div>
                  <button class="btn btn-primary" :disabled="busy">{{ busy ? 'جارٍ الحفظ...' : 'تأكيد القرار' }}</button>
                </div>
              </Transition>
            </form>
            <p v-else class="muted">القرار في هذه المرحلة لـ {{ stage.roleName ?? 'المختصين بمعالجة الطلبات' }}.</p>
          </section>

          <section v-else-if="r.status === 'returned'" class="card decision returned">
            <h2>الطلب عند مقدمه لاستكمال البيانات</h2>
            <p class="muted small">المستفيد يقدر يعدّل ويعيد التقديم من البوابة، أو تعيد تقديمه أنت بعد ما تستكمل البيانات معاه.</p>
            <button v-if="session.can('beneficiaries.requests.create')" class="btn btn-sm" @click="resubmit">إعادة التقديم الآن</button>
          </section>

          <section v-else-if="r.status === 'approved'" class="card done-card">
            <span class="trophy">★</span>
            <div>
              <h2>معتمد اعتمادًا نهائيًا</h2>
              <p class="muted small">{{ fmtDateTime(r.closedAt) }}. يمكن صرف المساعدة من ملف المستفيد وربطها بهذا الطلب.</p>
            </div>
          </section>

          <!-- بيانات الطلب -->
          <section class="card block">
            <h2>بيانات الطلب</h2>
            <AnswersList v-if="r.workflow?.applicationForm" :fields="r.workflow.applicationForm.fields" :data="r.applicationData" />
            <p v-if="r.description" class="pre desc">{{ r.description }}</p>
            <p v-if="!r.workflow?.applicationForm && !r.description" class="muted">لا توجد بيانات إضافية.</p>
          </section>
        </div>

        <!-- سجل الحركة -->
        <aside class="card block history">
          <h2>سجل الطلب</h2>
          <ol class="timeline">
            <li v-for="a in [...r.actions].reverse()" :key="a.id" :style="{ '--c': color('action', a.decision) }">
              <div class="t-head">
                <b>{{ label('action', a.decision) }}</b>
                <span v-if="a.stageName" class="muted"> · {{ a.stageName }}</span>
              </div>
              <p class="muted small">{{ a.actorName }} · {{ fmtDateTime(a.createdAt) }}</p>
              <p v-if="a.notes" class="note">{{ a.notes }}</p>
              <details v-if="a.formData && a.formFields" class="form-answers">
                <summary>{{ a.formName }}</summary>
                <AnswersList :fields="a.formFields" :data="a.formData" />
              </details>
            </li>
          </ol>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.back { display: inline-block; margin-bottom: 12px; color: var(--muted); font-size: .9rem; }
.head { padding: 20px; margin-bottom: 16px; position: relative; overflow: hidden; }
.head::before { content: ''; position: absolute; inset: 0 0 auto; height: 4px; background: linear-gradient(90deg, #2dd4bf, var(--gold), #2dd4bf); background-size: 200% 100%; animation: line 6s linear infinite; }
@keyframes line { to { background-position: 200% 0; } }
.head-top { display: flex; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
.crumbs { margin: 0 0 4px; font-size: .8rem; color: var(--primary); display: flex; flex-wrap: wrap; gap: 4px; }
.crumbs span:not(:last-child)::after { content: '‹'; margin-inline-start: 6px; color: var(--muted); }
.head h1 { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.small { font-size: .84rem; margin: 4px 0 0; }
.who { display: flex; align-items: center; gap: 10px; color: var(--text); padding: 8px 12px; border-radius: 12px; border: 1px solid var(--border); align-self: flex-start; transition: border-color .2s; }
.who:hover { border-color: var(--primary); }
.who small { display: block; font-size: .78rem; }
.av { width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; color: #fff; font-weight: 700; background: var(--grad); }

.cols { display: grid; grid-template-columns: 1fr 340px; gap: 16px; align-items: start; }
.main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.block { padding: 18px; }
.block h2 { font-size: 1rem; margin-bottom: 12px; }
.desc { margin: 12px 0 0; padding-top: 12px; border-top: 1px dashed var(--border); }
.pre { white-space: pre-wrap; }

.decision { padding: 18px; border: 1px solid var(--border); }
.decision.can { border-color: color-mix(in srgb, var(--primary) 40%, var(--border)); box-shadow: 0 12px 34px rgba(20,184,166,.14); }
.decision.returned { background: #fffbeb; border-color: #fcd34d; }
.d-head { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 14px; }
.d-head h2 { font-size: 1.02rem; }
.pulse { width: 12px; height: 12px; margin-top: 6px; border-radius: 50%; background: #14b8a6; box-shadow: 0 0 0 0 rgba(20,184,166,.6); animation: pulse 1.8s infinite; flex-shrink: 0; }
@keyframes pulse { 70% { box-shadow: 0 0 0 10px rgba(20,184,166,0); } 100% { box-shadow: 0 0 0 0 rgba(20,184,166,0); } }
.choices { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.choice { --c: var(--primary); font: inherit; font-weight: 600; padding: 10px 16px; border-radius: 12px; border: 1.5px solid var(--border); background: var(--surface); cursor: pointer; transition: all .2s; }
.choice.approve { --c: #059669; } .choice.ret { --c: #d97706; } .choice.reject { --c: #dc2626; }
.choice:hover { border-color: var(--c); color: var(--c); }
.choice.on { background: var(--c); border-color: var(--c); color: #fff; box-shadow: 0 8px 20px color-mix(in srgb, var(--c) 35%, transparent); }
.stage-form { padding: 14px; border-radius: 12px; background: var(--surface-2); margin-bottom: 14px; border: 1px solid var(--border); }
.form-title { margin: 0 0 10px; font-weight: 700; color: var(--primary); }
.done-card { padding: 18px; display: flex; gap: 14px; align-items: center; background: linear-gradient(135deg, #fffbeb, #fef3c7); border-color: #fcd34d; }
.trophy { width: 50px; height: 50px; border-radius: 50%; display: grid; place-items: center; font-size: 1.5rem; color: #fff; background: linear-gradient(135deg, #f5c66b, #d99a2b); box-shadow: 0 0 24px rgba(232,176,75,.7); flex-shrink: 0; }

.history { position: sticky; top: 80px; max-height: calc(100vh - 100px); overflow-y: auto; }
.timeline { list-style: none; margin: 0; padding: 0 18px 0 0; position: relative; }
.timeline::before { content: ''; position: absolute; right: 5px; top: 6px; bottom: 6px; width: 2px; background: var(--border); }
.timeline li { position: relative; margin-bottom: 16px; animation: rise .4s var(--ease) both; }
.timeline li::before { content: ''; position: absolute; right: -18px; top: 6px; width: 10px; height: 10px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 22%, transparent); }
.note { margin: 6px 0 0; padding: 8px 10px; border-radius: 8px; background: var(--surface-2); font-size: .88rem; white-space: pre-wrap; }
.form-answers { margin-top: 6px; font-size: .86rem; }
.form-answers summary { cursor: pointer; color: var(--primary); font-weight: 600; margin-bottom: 8px; }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
@media (max-width: 1000px) { .cols { grid-template-columns: 1fr; } .history { position: static; max-height: none; } }
</style>
