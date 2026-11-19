<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { errMsg, fmtDateTime, WF_ACTION, WF_STATUS } from '../lib';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** الاعتماد: مراحل المسار، الرفع مع سبب التعديل، القرار، إلغاء التعديل، وسجل القرارات */
const props = defineProps<{ plan: any; canManage: boolean }>();
const emit = defineEmits<{ (e: 'changed', v: any): void }>();
const toast = useToast();
const note = ref('');
const busy = ref(false);
const showLog = ref(false);

async function run(path: string, json: unknown, msg: string) {
  busy.value = true;
  try {
    emit('changed', await api(`/planning/plans/${props.plan.id}/${path}`, { method: 'POST', json }));
    note.value = '';
    toast.success(msg);
  } catch (e) {
    toast.error(errMsg(e));
  } finally {
    busy.value = false;
  }
}
const submit = () => run('submit', { note: note.value || null }, props.plan.stages.length ? 'رُفعت الخطة للاعتماد' : 'اعتُمدت الخطة');
const decide = (decision: 'approve' | 'return' | 'reject') =>
  run('decision', { decision, note: note.value || null }, decision === 'approve' ? 'تم الاعتماد' : decision === 'return' ? 'أُعيدت للتعديل' : 'رُفضت الخطة');
function discard() {
  if (confirm(`إلغاء كل التعديلات والعودة إلى الإصدار المعتمد ${props.plan.version}؟`)) run('discard', {}, 'أُلغي التعديل');
}
const stageState = (i: number) => {
  const p = props.plan;
  if (p.status === 'approved') return 'done';
  if (p.status === 'in_review' && p.stageIndex !== null) return i < p.stageIndex ? 'done' : i === p.stageIndex ? 'cur' : '';
  return '';
};
const editingApproved = () => props.plan.version > 0 && (props.plan.status === 'draft' || props.plan.status === 'returned');
</script>

<template>
  <section class="card pm-panel">
    <h2>
      <span>الاعتماد <span class="pm-pill" :style="{ '--c': WF_STATUS[plan.status]?.color }">{{ WF_STATUS[plan.status]?.label }}</span>
        <span v-if="plan.version" class="pm-tag" style="margin-inline-start: 6px">الإصدار المعتمد {{ plan.version }}</span></span>
      <button v-if="plan.approvals.length" type="button" class="btn btn-sm" @click="showLog = !showLog">سجل القرارات ({{ plan.approvals.length }})</button>
    </h2>
    <div v-if="plan.stages.length" class="rk-wf">
      <template v-for="(s, i) in plan.stages" :key="i">
        <span v-if="i" :class="['ln', stageState(i - 1)]" />
        <span :class="['st', stageState(i)]"><i>{{ stageState(i) === 'done' ? '✓' : i + 1 }}</i>{{ s }}</span>
      </template>
    </div>
    <p v-else class="pm-muted">لا توجد مراحل اعتماد لهذه الخطة في الإعدادات، فتُعتمد مباشرة عند رفعها.</p>
    <p v-if="plan.routeName && plan.status === 'in_review'" class="pm-muted">المسار: {{ plan.routeName }}</p>
    <div v-if="editingApproved()" class="rk-warn" style="margin-top: 8px">
      هذه مسودة تعديل على الإصدار المعتمد {{ plan.version }}. يبقى الإصدار المعتمد هو المرجع حتى يُعتمد التعديل.
      <span v-if="plan.revisionNote"> سبب التعديل: {{ plan.revisionNote }}</span>
    </div>
    <div v-if="plan.status === 'returned' || plan.status === 'rejected'" class="rk-warn" style="margin-top: 8px">
      {{ plan.status === 'returned' ? 'أُعيدت للتعديل' : 'رُفضت' }}: {{ [...plan.approvals].reverse().find((a: any) => a.action === (plan.status === 'returned' ? 'return' : 'reject'))?.note }}
    </div>
    <div v-if="plan.canDecide" style="margin-top: 12px">
      <p v-if="plan.revisionNote && plan.version" class="pm-muted">سبب التعديل: {{ plan.revisionNote }}</p>
      <label class="field"><span>ملاحظة القرار (إلزامية عند الإعادة أو الرفض)</span><textarea v-model="note" class="input" rows="2" /></label>
      <div class="pm-actions">
        <button class="btn btn-primary" :disabled="busy" @click="decide('approve')">اعتماد «{{ plan.stageName }}»</button>
        <button class="btn" :disabled="busy" @click="decide('return')">إعادة للتعديل</button>
        <button class="btn btn-danger" :disabled="busy" @click="decide('reject')">رفض</button>
      </div>
    </div>
    <div v-else-if="canManage && (plan.status === 'draft' || plan.status === 'returned')" style="margin-top: 12px">
      <label v-if="plan.version" class="field"><span>سبب التعديل (يظهر للمعتمدين وفي سجل الإصدارات)</span>
        <textarea v-model="note" class="input" rows="2" :placeholder="plan.revisionNote ?? 'مثل: إضافة مبادرة جديدة وتعديل مستهدفات المؤشرات'" /></label>
      <div class="pm-actions">
        <button class="btn btn-primary" :disabled="busy" @click="submit">رفع للاعتماد</button>
        <button v-if="plan.version" class="btn" :disabled="busy" @click="discard">إلغاء التعديل</button>
      </div>
    </div>
    <p v-else-if="plan.status === 'in_review'" class="pm-muted" style="margin-top: 8px">بانتظار قرار «{{ plan.stageName }}».</p>
    <p v-else-if="plan.status === 'approved' && canManage" class="pm-muted" style="margin-top: 8px">أي تعديل على الخطة يفتح مسودة تعديل جديدة، ويبقى الإصدار الحالي محفوظًا.</p>
    <ul v-if="showLog" class="rk-log" style="margin-top: 12px">
      <li v-for="(a, i) in [...plan.approvals].reverse()" :key="i">
        <b>{{ WF_ACTION[a.action] ?? a.action }}</b>
        <span>{{ a.stage ? `«${a.stage}» · ` : '' }}{{ a.byName }} · {{ fmtDateTime(a.at) }}<span v-if="a.note" class="pm-muted"> — {{ a.note }}</span></span>
      </li>
    </ul>
  </section>
</template>
