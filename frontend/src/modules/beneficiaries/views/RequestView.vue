<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, openProtectedFile } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import AnswersList from '../components/AnswersList.vue';
import DynamicFields from '../components/DynamicFields.vue';
import StageStepper from '../components/StageStepper.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { color, fmtDate, fmtDateTime, label, money, scoreOf } from '../labels';
import type { RequestDetail, SupportAnswer } from '../types';

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

const decision = reactive({
  decision: '' as '' | 'approve' | 'reject' | 'return', notes: '', formData: {} as Record<string, unknown>,
  estimatedCost: '' as number | '', contributionAmount: '' as number | '',
});
const isContribution = computed(() => stage.value?.kind === 'contribution');
const formDraft = computed(() => !!stage.value?.form && stage.value.form.status !== 'approved');
/** معاينة نتيجة التقييم الآلي وهو بيعبّي النموذج */
const liveScore = computed(() => (stage.value?.form?.scored ? scoreOf(stage.value.form, decision.formData) : null));
/** قرار الباحث من حقل تقييم الباحث (لو موجود) */
const researcherPick = computed(() => {
  const f = stage.value?.form?.fields.find((x) => x.type === 'support');
  return f ? ((decision.formData[f.key] as SupportAnswer | undefined) ?? null) : null;
});
/** القواعد استرشادية: هل قرار الباحث مختلف عن اقتراحها؟ */
const deviates = computed(() => {
  const rule = liveScore.value?.rule;
  if (!rule || !decision.decision || decision.decision === 'return') return false;
  if (decision.decision === 'reject') return rule.outcome !== 'reject';
  const pick = researcherPick.value;
  const support = pick ? (pick.decision === 'full' ? 100 : pick.decision === 'partial' ? Number(pick.percent) || 0 : 0)
    : rule.outcome === 'contribution' ? 100 - (rule.contributionPercent ?? 0) : 100;
  const outcome = support >= 100 ? 'approve' : 'contribution';
  if (outcome !== rule.outcome) return true;
  return outcome === 'contribution' && Math.abs(100 - support - (rule.contributionPercent ?? 0)) > 0.001;
});
const showForm = computed(() => !!stage.value?.form && (decision.decision === 'approve' || (decision.decision === 'reject' && !!stage.value.form.scored)));
const liveRequired = computed(() => {
  const cost = decision.estimatedCost === '' ? r.value?.estimatedCost : decision.estimatedCost;
  const pick = researcherPick.value;
  const pct = pick?.decision === 'partial' && pick.percent ? 100 - pick.percent : pick?.decision === 'full' ? 0 : liveScore.value?.rule?.contributionPercent;
  return cost && pct ? Math.round(cost * pct) / 100 : null;
});
async function openProof() {
  try {
    await openProtectedFile(`/beneficiaries/${r.value!.beneficiary!.id}/documents/${r.value!.contribution.documentId}/file`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const busy = ref(false);
const decisionError = ref('');

async function decide() {
  decisionError.value = '';
  if (!decision.decision) { decisionError.value = 'اختر القرار'; return; }
  busy.value = true;
  try {
    r.value = await api<RequestDetail>(`/beneficiaries/requests/${id}/decision`, {
      method: 'POST',
      json: {
        decision: decision.decision, notes: decision.notes, formData: showForm.value ? decision.formData : undefined,
        estimatedCost: decision.estimatedCost === '' ? undefined : decision.estimatedCost,
        contributionAmount: decision.decision === 'approve' && isContribution.value && decision.contributionAmount !== '' ? decision.contributionAmount : undefined,
      },
    });
    const msg = { approve: isLastBefore.value ? 'تم الاعتماد النهائي للطلب 🎉' : 'تم القبول وانتقل الطلب للمرحلة التالية', reject: 'تم رفض الطلب', return: 'تم إرجاع الطلب' }[decision.decision];
    toast.success(msg);
    Object.assign(decision, { decision: '', notes: '', formData: {}, estimatedCost: '', contributionAmount: '' });
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
            <h1>طلب رقم {{ r.requestNo }} <StatusBadge :value="r.status" kind="request" /><span v-if="r.research?.deviation" class="devchip">⚑ قرار الباحث مخالف للقاعدة</span></h1>
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
            <div v-if="isContribution" :class="['contrib', r.contribution.status]">
              <div class="c-grid">
                <div><small>نسبة مساهمة المستفيد</small><b>{{ r.contribution.percent ?? 0 }}%</b></div>
                <div><small>المبلغ المطلوب</small><b>{{ r.contribution.requiredAmount !== null ? `${money(r.contribution.requiredAmount)} ريال` : 'حدد التكلفة' }}</b></div>
                <div><small>المبلغ الذي رفعه المستفيد</small><b>{{ r.contribution.amount !== null ? `${money(r.contribution.amount)} ريال` : '—' }}</b></div>
              </div>
              <p class="c-status"><span class="dot" />{{ label('contribution', r.contribution.status) }}<template v-if="r.contribution.submittedAt"> · {{ fmtDateTime(r.contribution.submittedAt) }}</template></p>
              <button v-if="r.contribution.documentId" type="button" class="btn btn-sm" @click="openProof">📎 عرض إثبات المساهمة</button>
            </div>
            <form v-if="r.canDecide" @submit.prevent="decide">
              <div v-if="decisionError" class="alert alert-error">{{ decisionError }}</div>
              <div v-if="formDraft" class="alert draft-alert">⏳ نموذج "{{ stage.form?.name }}" في هذه المرحلة لم يُعتمد بعد (يمر بمراجعة الجودة ثم اعتماد مدير الشاشة). سيُتاح القبول والرفض بعد الاعتماد، أما الإرجاع فمتاح.</div>
              <div class="choices">
                <button type="button" :disabled="formDraft" :class="['choice approve', { on: decision.decision === 'approve' }]" @click="choose('approve')">✓ {{ isContribution ? 'تأكيد المساهمة' : isLast ? 'اعتماد نهائي' : 'قبول وتحويل للمرحلة التالية' }}</button>
                <button v-if="stage.canReturn" type="button" :class="['choice ret', { on: decision.decision === 'return' }]" @click="choose('return')">↩ {{ isContribution ? 'إرجاع للمستفيد لإعادة الرفع' : isFirst ? 'إرجاع لمقدم الطلب' : 'إرجاع للمرحلة السابقة' }}</button>
                <button v-if="stage.canReject" type="button" :disabled="formDraft" :class="['choice reject', { on: decision.decision === 'reject' }]" @click="choose('reject')">✕ رفض</button>
              </div>
              <Transition name="page">
                <div v-if="decision.decision" class="d-body">
                  <div v-if="showForm && stage.form" class="stage-form">
                    <p class="form-title">{{ stage.form.name }}<span v-if="stage.form.qualityCode" class="qcode">{{ stage.form.qualityCode }} · Rev.{{ String(stage.form.revision ?? 0).padStart(2, '0') }}</span></p>
                    <DynamicFields v-model="decision.formData" :fields="stage.form.fields" />
                    <div v-if="liveScore" class="live" :style="{ '--c': color('outcome', liveScore.rule?.outcome) }">
                      <div class="ring" :style="{ '--p': liveScore.score }"><b>{{ liveScore.score }}%</b></div>
                      <div>
                        <small class="muted">نتيجة التقييم الآلي · اقتراح استرشادي للباحث</small>
                        <p class="lv">{{ liveScore.rule ? label('outcome', liveScore.rule.outcome) : 'لا توجد قاعدة لهذه النتيجة' }}</p>
                        <p v-if="liveScore.rule?.contributionPercent" class="muted small">يتحمل المستفيد {{ liveScore.rule.contributionPercent }}%<template v-if="liveRequired"> = {{ money(liveRequired) }} ريال</template></p>

                      </div>
                    </div>
                  </div>
                  <div v-if="decision.decision === 'approve' && (stage.form?.scored || r.estimatedCost === null)" class="field">
                    <label>التكلفة التقديرية للحالة (ريال)</label>
                    <input v-model.number="decision.estimatedCost" type="number" min="0" class="input" :placeholder="r.estimatedCost !== null ? String(r.estimatedCost) : 'مثال: 25000'" />
                    <small class="muted">تُحتسب منها قيمة مساهمة المستفيد</small>
                  </div>
                  <div v-if="decision.decision === 'approve' && isContribution" class="field">
                    <label>المبلغ المحصّل {{ r.contribution.status === 'submitted' ? '(اتركه فارغًا إذا كان المبلغ الذي رفعه المستفيد صحيحًا)' : '(إذا دفع المستفيد في مقر الجمعية)' }}</label>
                    <input v-model.number="decision.contributionAmount" type="number" min="0" step="0.01" class="input" :placeholder="r.contribution.amount !== null ? String(r.contribution.amount) : ''" />
                    <small class="muted">يُجهّز التأكيدُ القيد المحاسبي حسب التوجيه في الإعدادات</small>
                  </div>
                  <div class="field">
                    <div v-if="deviates" class="devwarn">⚑ قرارك مختلف عن اقتراح القاعدة. يمكنك المتابعة، لكن يجب كتابة سبب الاختلاف، وستُميَّز الحالة بعلامة للمعتمد النهائي.</div>
                    <label>{{ deviates ? 'سبب الاختلاف عن القاعدة *' : decision.decision === 'approve' ? 'ملاحظات (اختياري)' : decision.decision === 'reject' ? 'سبب الرفض *' : 'سبب الإرجاع *' }}</label>
                    <textarea v-model="decision.notes" class="input" rows="3" :required="decision.decision !== 'approve' || deviates" />
                    <small v-if="decision.decision !== 'approve'" class="muted">سيظهر السبب للمستفيد في البوابة</small>
                  </div>
                  <button class="btn btn-primary" :disabled="busy">{{ busy ? 'جارٍ الحفظ...' : 'تأكيد القرار' }}</button>
                </div>
              </Transition>
            </form>
            <p v-else class="muted">القرار في هذه المرحلة لـ {{ stage.roleName ?? 'المختصين بمعالجة الطلبات' }}.</p>
          </section>

          <section v-else-if="r.status === 'returned'" class="card decision returned">
            <h2>الطلب عند مقدمه لاستكمال البيانات</h2>
            <p class="muted small">يستطيع المستفيد التعديل وإعادة التقديم من البوابة، أو يمكنك إعادة تقديمه بنفسك بعد استكمال البيانات معه.</p>
            <button v-if="session.can('beneficiaries.requests.create')" class="btn btn-sm" @click="resubmit">إعادة التقديم الآن</button>
          </section>

          <section v-else-if="r.status === 'approved'" class="card done-card">
            <span class="trophy">★</span>
            <div>
              <h2>معتمد اعتمادًا نهائيًا</h2>
              <p class="muted small">{{ fmtDateTime(r.closedAt) }}. يمكن صرف المساعدة من ملف المستفيد وربطها بهذا الطلب.</p>
            </div>
          </section>

          <!-- نتيجة البحث والمساهمة -->
          <section v-if="r.research?.deviation" class="card devcard">
            <span class="flag">⚑</span>
            <div>
              <h2>قرار الباحث مختلف عن قاعدة التقييم</h2>
              <p v-if="r.research.suggestion" class="small">كانت القاعدة تقترح <b>{{ label('outcome', r.research.suggestion.outcome) }}<template v-if="r.research.suggestion.contributionPercent"> بمساهمة {{ r.research.suggestion.contributionPercent }}%</template></b> (النتيجة {{ r.research.suggestion.score }}%)، وقرر الباحث <b>{{ label('outcome', r.research.outcome) }}<template v-if="r.research.contributionPercent"> بمساهمة {{ r.research.contributionPercent }}%</template></b>.</p>
              <p v-if="r.research.deviationReason" class="reason"><b>سبب الباحث:</b> {{ r.research.deviationReason }}</p>
            </div>
          </section>

          <section v-if="r.research || r.services.length || r.estimatedCost !== null" class="card block facts">
            <div v-if="r.research?.score !== null && r.research?.score !== undefined" class="fact score" :style="{ '--c': color('outcome', r.research.suggestion?.outcome ?? r.research.outcome) }">
              <div class="ring" :style="{ '--p': r.research.score }"><b>{{ r.research.score }}%</b></div>
              <div><small class="muted">نتيجة التقييم (اقتراح القاعدة)</small><p class="lv">{{ r.research.suggestion ? label('outcome', r.research.suggestion.outcome) : '—' }}</p></div>
            </div>
            <div v-if="r.research" class="fact" :style="{ '--c': color('outcome', r.research.outcome) }">
              <small class="muted">قرار الباحث</small><p class="lv">{{ label('outcome', r.research.outcome) }}</p>
            </div>
            <div v-if="r.research?.supportPercent !== null && r.research?.supportPercent !== undefined" class="fact">
              <small class="muted">دعم الجمعية</small><p class="lv">{{ r.research.supportPercent }}%<template v-if="r.research.supportAmount !== null"> · {{ money(r.research.supportAmount) }} ريال</template></p>
              <small v-if="r.research.contributionPercent" class="muted">الباقي على المستفيد {{ r.research.contributionPercent }}%</small>
            </div>
            <div v-if="r.services.length" class="fact"><small class="muted">الخدمات المطلوبة</small><p class="chips"><span v-for="s in r.services" :key="s" class="chip">{{ s }}</span></p></div>
            <div v-if="r.estimatedCost !== null" class="fact"><small class="muted">التكلفة التقديرية</small><p class="lv">{{ money(r.estimatedCost) }} ريال</p></div>
          </section>

          <section v-if="r.contribution.journal" class="card block journal">
            <h2>قيد مساهمة المستفيد <span class="muted small">{{ fmtDate(r.contribution.journal.date) }}</span></h2>
            <table>
              <tr><th>الحساب</th><th>مدين</th><th>دائن</th></tr>
              <tr><td>{{ r.contribution.journal.debit.code }} {{ r.contribution.journal.debit.name ?? 'لم يحدد' }}</td><td>{{ money(r.contribution.journal.amount) }}</td><td /></tr>
              <tr><td>{{ r.contribution.journal.credit.code }} {{ r.contribution.journal.credit.name ?? 'لم يحدد' }}</td><td /><td>{{ money(r.contribution.journal.amount) }}</td></tr>
            </table>
            <p class="muted small">{{ r.contribution.journal.description }}</p>
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
                <span v-if="a.score !== null && a.score !== undefined" class="sc">{{ a.score }}%</span>
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
.draft-alert { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
.choice:disabled { opacity: .4; cursor: not-allowed; }
.stage-form { padding: 14px; border-radius: 12px; background: var(--surface-2); margin-bottom: 14px; border: 1px solid var(--border); }
.form-title { margin: 0 0 10px; font-weight: 700; color: var(--primary); }
.qcode { float: inline-end; font-size: .72rem; font-weight: 600; color: var(--muted); direction: ltr; border: 1px solid var(--border); padding: 1px 8px; border-radius: 6px; }
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
.live { margin-top: 14px; display: flex; gap: 14px; align-items: center; padding: 12px; border-radius: 12px; border: 1px solid var(--c); background: var(--surface); }
.ring { --p: 0; width: 74px; height: 74px; border-radius: 50%; flex-shrink: 0; display: grid; place-items: center;
  background: conic-gradient(var(--c) calc(var(--p) * 1%), var(--surface-2) 0); position: relative; box-shadow: 0 0 18px color-mix(in srgb, var(--c) 40%, transparent); transition: all .4s; }
.ring::before { content: ''; position: absolute; inset: 7px; border-radius: 50%; background: var(--surface); }
.ring b { position: relative; font-size: .95rem; color: var(--c); }
.lv { margin: 2px 0 0; font-weight: 700; font-size: 1.05rem; color: var(--c, var(--text)); }
.facts { display: flex; flex-wrap: wrap; gap: 22px; align-items: center; }
.fact { display: flex; flex-direction: column; gap: 2px; }
.fact.score { flex-direction: row; gap: 12px; align-items: center; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 0; }
.chip { font-size: .8rem; padding: 2px 10px; border-radius: 99px; background: var(--primary-soft); color: var(--primary); }
.contrib { padding: 14px; border-radius: 12px; margin-bottom: 14px; border: 1px dashed #f59e0b; background: linear-gradient(135deg, rgba(245,158,11,.08), transparent); }
.contrib.submitted { border-color: #0ea5e9; background: linear-gradient(135deg, rgba(14,165,233,.08), transparent); }
.c-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.c-grid small { display: block; color: var(--muted); font-size: .78rem; }
.c-grid b { font-size: 1.1rem; }
.c-status { display: flex; align-items: center; gap: 6px; margin: 10px 0; font-size: .88rem; font-weight: 600; }
.c-status .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; animation: pulse 1.8s infinite; }
.journal table { width: 100%; border-collapse: collapse; font-size: .9rem; margin-bottom: 8px; }
.journal th, .journal td { border: 1px solid var(--border); padding: 7px 10px; text-align: right; }
.journal th { background: var(--surface-2); }
.devwarn { margin-bottom: 8px; padding: 10px 12px; border-radius: 10px; background: #faf5ff; border: 1px solid #d8b4fe; color: #6b21a8; font-size: .88rem; font-weight: 600; }
.devchip { font-size: .78rem; font-weight: 700; padding: 3px 10px; border-radius: 99px; background: #f3e8ff; color: #7e22ce; border: 1px solid #d8b4fe; animation: glow 2.4s ease-in-out infinite; }
@keyframes glow { 50% { box-shadow: 0 0 14px rgba(168,85,247,.45); } }
.devcard { padding: 16px 18px; display: flex; gap: 14px; align-items: flex-start; background: linear-gradient(135deg, #faf5ff, #f3e8ff); border-color: #c084fc; }
.devcard h2 { font-size: 1rem; color: #6b21a8; margin-bottom: 4px; }
.devcard .flag { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; font-size: 1.3rem; color: #fff; background: linear-gradient(135deg, #a855f7, #7e22ce); box-shadow: 0 0 18px rgba(168,85,247,.5); flex-shrink: 0; }
.devcard .reason { margin: 8px 0 0; padding: 8px 10px; border-radius: 8px; background: rgba(255,255,255,.7); }
.sc { margin-inline-start: 6px; font-size: .74rem; font-weight: 700; padding: 1px 7px; border-radius: 99px; background: var(--primary-soft); color: var(--primary); }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
@media (max-width: 1000px) { .cols { grid-template-columns: 1fr; } .history { position: static; max-height: none; } }
</style>
