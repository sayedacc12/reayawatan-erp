<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import AnswersList from '../modules/beneficiaries/components/AnswersList.vue';
import DynamicFields from '../modules/beneficiaries/components/DynamicFields.vue';
import StageStepper from '../modules/beneficiaries/components/StageStepper.vue';
import StatusBadge from '../modules/beneficiaries/components/StatusBadge.vue';
import { color, fmtDateTime, label, money } from '../modules/beneficiaries/labels';
import type { RequestDetail } from '../modules/beneficiaries/types';
import { useToast } from '../stores/toast';
import { portalApi } from './portal';

const route = useRoute();
const toast = useToast();
const slug = route.params.slug as string;
const id = route.params.id as string;
const isNew = route.query.new === '1';
const r = ref<RequestDetail | null>(null);
const error = ref('');
const editing = ref(false);
const form = reactive({ applicationData: {} as Record<string, unknown>, description: '', notes: '' });

async function load() {
  try {
    r.value = await portalApi<RequestDetail>(`/requests/${id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

const isContribution = computed(() => r.value?.workflow?.stages.find((s) => s.id === r.value?.currentStageId)?.kind === 'contribution');
const proof = reactive({ amount: '' as number | '', file: null as File | null, busy: false });
function onFile(e: Event) {
  proof.file = (e.target as HTMLInputElement).files?.[0] ?? null;
}
async function sendContribution() {
  if (!proof.amount || !proof.file) { toast.error('اكتب المبلغ وارفع صورة الإيصال'); return; }
  proof.busy = true;
  try {
    const body = new FormData();
    body.append('amount', String(proof.amount));
    body.append('file', proof.file);
    r.value = await portalApi<RequestDetail>(`/requests/${id}/contribution`, { method: 'POST', body });
    Object.assign(proof, { amount: '', file: null });
    toast.success('تم رفع إثبات المساهمة، والجمعية هتراجعه');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    proof.busy = false;
  }
}
const returnReason = computed(() => [...(r.value?.actions ?? [])].reverse().find((a) => a.decision === 'return')?.notes);
const rejectReason = computed(() => r.value?.actions.find((a) => a.decision === 'reject')?.notes);

function startEdit() {
  form.applicationData = { ...(r.value?.applicationData ?? {}) };
  form.description = r.value?.description ?? '';
  form.notes = '';
  editing.value = true;
}
async function resubmit() {
  try {
    r.value = await portalApi<RequestDetail>(`/requests/${id}/resubmit`, { method: 'POST', json: form });
    editing.value = false;
    toast.success('تمت إعادة تقديم الطلب');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function cancel() {
  if (!confirm('متأكد إنك عايز تلغي الطلب؟')) return;
  try {
    r.value = await portalApi<RequestDetail>(`/requests/${id}/cancel`, { method: 'POST' });
    toast.success('تم إلغاء الطلب');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <RouterLink :to="`/portal/${slug}/home`" class="back">→ طلباتي</RouterLink>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="r">
      <div v-if="isNew" class="celebrate card">
        <span class="spark">✓</span>
        <div><b>تم استلام طلبك بنجاح</b><p class="muted">رقم الطلب {{ r.requestNo }}. هتقدر تتابع كل مرحلة من هنا.</p></div>
      </div>

      <section class="card head">
        <div class="top">
          <div>
            <p class="crumbs">{{ r.project.path.join(' ‹ ') }}</p>
            <h1>طلب رقم {{ r.requestNo }}</h1>
            <p class="muted small">قُدّم {{ fmtDateTime(r.createdAt) }}</p>
          </div>
          <StatusBadge :value="r.status" kind="request" />
        </div>
        <StageStepper v-if="r.workflow" :stages="r.workflow.stages" :current-id="r.currentStageId" :status="r.status" />
      </section>

      <section v-if="r.status === 'in_progress' && isContribution" :class="['card notice contrib', r.contribution.status]">
        <h2>💰 {{ r.contribution.status === 'submitted' ? 'إثبات مساهمتك وصل للجمعية' : 'مطلوب منك تأكيد مساهمتك' }}</h2>
        <div class="c-grid">
          <div><small>نسبة مساهمتك</small><b>{{ r.contribution.percent }}%</b></div>
          <div v-if="r.contribution.requiredAmount !== null"><small>المبلغ المطلوب</small><b>{{ money(r.contribution.requiredAmount) }} جنيه</b></div>
          <div v-if="r.contribution.amount !== null"><small>اللي رفعته</small><b>{{ money(r.contribution.amount) }} جنيه</b></div>
        </div>
        <p v-if="r.contribution.status === 'submitted'" class="muted">الجمعية بتراجع الإيصال دلوقتي، وهيتحول طلبك للمرحلة اللي بعدها بعد التأكيد.</p>
        <template v-else>
          <p v-if="returnReason && r.actions.at(-1)?.decision === 'return'"><b>ملاحظة الجمعية:</b> {{ returnReason }}</p>
          <p class="muted">ادفع مساهمتك وارفع صورة الإيصال أو التحويل هنا.</p>
          <form class="up" @submit.prevent="sendContribution">
            <div class="field"><label>المبلغ اللي دفعته (جنيه)</label><input v-model.number="proof.amount" type="number" min="1" step="0.01" class="input" :placeholder="r.contribution.requiredAmount ? String(r.contribution.requiredAmount) : ''" required /></div>
            <label class="drop"><input type="file" accept="image/png,image/jpeg,application/pdf" @change="onFile" /><span>📎 {{ proof.file?.name ?? 'اختار صورة الإيصال (صورة أو PDF)' }}</span></label>
            <button class="btn btn-primary" :disabled="proof.busy">{{ proof.busy ? 'جارٍ الرفع...' : 'رفع إثبات المساهمة' }}</button>
          </form>
        </template>
      </section>
      <section v-if="r.status === 'returned'" class="card notice warn">
        <h2>⚠ طلبك محتاج استكمال</h2>
        <p v-if="returnReason"><b>ملاحظة الجمعية:</b> {{ returnReason }}</p>
        <template v-if="editing">
          <DynamicFields v-if="r.workflow?.applicationForm" v-model="form.applicationData" :fields="r.workflow.applicationForm.fields" />
          <div class="field"><label>تفاصيل إضافية</label><textarea v-model="form.description" class="input" rows="2" /></div>
          <div class="field"><label>رسالة للجمعية</label><input v-model="form.notes" class="input" placeholder="مثال: تم إرسال المستندات المطلوبة" /></div>
          <div class="acts"><button class="btn btn-primary" @click="resubmit">إعادة التقديم</button><button class="btn" @click="editing = false">إلغاء</button></div>
        </template>
        <button v-else class="btn btn-primary" @click="startEdit">استكمال وإعادة التقديم</button>
      </section>
      <section v-else-if="r.status === 'approved'" class="card notice ok">
        <span class="star">★</span><div><h2>مبروك! تم اعتماد طلبك نهائيًا</h2><p class="muted">هتتواصل معاك الجمعية بخصوص الصرف.</p></div>
      </section>
      <section v-else-if="r.status === 'rejected'" class="card notice bad">
        <h2>نأسف، لم يتم قبول الطلب</h2>
        <p v-if="rejectReason"><b>السبب:</b> {{ rejectReason }}</p>
        <p class="muted small">لو عندك استفسار تقدر تبعت رسالة من صفحة الشكاوى والاستفسارات.</p>
      </section>

      <div class="cols">
        <section class="card block">
          <h2>بيانات الطلب</h2>
          <AnswersList v-if="r.workflow?.applicationForm" :fields="r.workflow.applicationForm.fields" :data="r.applicationData" />
          <p v-if="r.description" class="desc">{{ r.description }}</p>
          <button v-if="r.status === 'in_progress' || r.status === 'returned'" class="btn btn-sm btn-danger cancel" @click="cancel">إلغاء الطلب</button>
        </section>
        <section class="card block">
          <h2>سجل الطلب</h2>
          <ol class="tl">
            <li v-for="a in [...r.actions].reverse()" :key="a.id" :style="{ '--c': color('action', a.decision) }">
              <b>{{ label('action', a.decision) }}</b><span v-if="a.stageName" class="muted"> · {{ a.stageName }}</span>
              <p class="muted small">{{ a.actorName }} · {{ fmtDateTime(a.createdAt) }}</p>
              <p v-if="a.notes" class="note">{{ a.notes }}</p>
            </li>
          </ol>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.back { display: inline-block; margin-bottom: 12px; color: var(--muted); }
.celebrate { display: flex; gap: 14px; align-items: center; padding: 16px 18px; margin-bottom: 14px; background: linear-gradient(135deg, #ecfdf5, #d1fae5); border-color: #6ee7b7; animation: pop .5s var(--ease) both; }
.celebrate p { margin: 2px 0 0; }
.spark { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 1.3rem; background: linear-gradient(135deg, #34d399, #059669); box-shadow: 0 0 22px rgba(16,185,129,.6); animation: ring 1.6s ease-out 2; }
@keyframes ring { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,.6); } 100% { box-shadow: 0 0 0 18px rgba(16,185,129,0); } }
@keyframes pop { from { opacity: 0; transform: scale(.96); } }
.head { padding: 20px; margin-bottom: 14px; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 18px; }
.crumbs { margin: 0 0 4px; color: var(--primary); font-size: .82rem; }
.small { font-size: .84rem; margin: 2px 0 0; }
.notice { padding: 18px; margin-bottom: 14px; }
.notice h2 { font-size: 1.05rem; margin-bottom: 6px; }
.notice.warn { background: #fffbeb; border-color: #fcd34d; }
.notice.ok { display: flex; gap: 14px; align-items: center; background: linear-gradient(135deg, #fffbeb, #fef3c7); border-color: #fcd34d; }
.notice.bad { background: var(--danger-soft); border-color: #fca5a5; }
.star { width: 50px; height: 50px; border-radius: 50%; display: grid; place-items: center; font-size: 1.5rem; color: #fff; background: linear-gradient(135deg, #f5c66b, #d99a2b); box-shadow: 0 0 24px rgba(232,176,75,.7); flex-shrink: 0; }
.acts { display: flex; gap: 8px; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.block { padding: 18px; }
.block h2 { font-size: 1rem; margin-bottom: 12px; }
.desc { white-space: pre-wrap; margin: 12px 0 0; }
.cancel { margin-top: 16px; }
.tl { list-style: none; margin: 0; padding: 0 16px 0 0; position: relative; }
.tl::before { content: ''; position: absolute; right: 4px; top: 6px; bottom: 6px; width: 2px; background: var(--border); }
.tl li { position: relative; margin-bottom: 14px; }
.tl li::before { content: ''; position: absolute; right: -16px; top: 7px; width: 10px; height: 10px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 22%, transparent); }
.note { margin: 6px 0 0; padding: 8px 10px; border-radius: 8px; background: var(--surface-2); white-space: pre-wrap; }
textarea.input { resize: vertical; }
.notice.contrib { border: 1.5px dashed #f59e0b; background: linear-gradient(135deg, #fffbeb, #fff); }
.notice.contrib.submitted { border-color: #0ea5e9; background: linear-gradient(135deg, #f0f9ff, #fff); }
.c-grid { display: flex; flex-wrap: wrap; gap: 20px; margin: 10px 0; }
.c-grid small { display: block; color: var(--muted); font-size: .8rem; }
.c-grid b { font-size: 1.2rem; }
.up { display: grid; gap: 10px; max-width: 460px; }
.drop { display: block; padding: 16px; border: 2px dashed var(--border); border-radius: 12px; text-align: center; cursor: pointer; color: var(--primary); font-weight: 600; transition: all .2s; }
.drop:hover { border-color: var(--primary); background: var(--primary-soft); }
.drop input { display: none; }
@media (max-width: 760px) { .cols { grid-template-columns: 1fr; } }
</style>
