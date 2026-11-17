
<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { fmtDateTime, WF_ACTION, WF_STATUS, type WfFields } from '../lib';

/** شريط الاعتماد الموحد: الحالة، مراحل الاعتماد من الإعدادات، الرفع والقرار، وسجل القرارات */
const props = defineProps<{ item: WfFields & { approvedAt?: string | null }; base: string; canSubmit: boolean; editable?: boolean }>();
const emit = defineEmits<{ (e: 'changed', v: unknown): void }>();
const toast = useToast();
const note = ref('');
const busy = ref(false);
const showLog = ref(false);

async function run(path: string, json?: unknown, msg = 'تم') {
  busy.value = true;
  try {
    emit('changed', await api(`${props.base}/${path}`, { method: 'POST', json: json ?? {} }));
    note.value = '';
    toast.success(msg);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const decide = (decision: 'approve' | 'return' | 'reject') =>
  run('decision', { decision, note: note.value || null }, decision === 'approve' ? 'تم الاعتماد' : decision === 'return' ? 'أُرجع للتعديل' : 'تم الرفض');
const stageState = (i: number) => {
  const it = props.item;
  if (it.status === 'approved') return 'done';
  if (it.status === 'in_review' && it.stageIndex !== null) return i < it.stageIndex ? 'done' : i === it.stageIndex ? 'cur' : '';
  return '';
};
</script>

<template>
  <section class="card pm-panel">
    <h2>
      <span>الاعتماد <span class="pm-pill" :style="{ '--c': WF_STATUS[item.status]?.color }">{{ WF_STATUS[item.status]?.label }}</span>
        <span v-if="item.revision" class="pm-tag" style="margin-inline-start: 6px">المراجعة {{ item.revision }}</span></span>
      <button v-if="item.approvals.length" type="button" class="btn btn-sm" @click="showLog = !showLog">سجل القرارات ({{ item.approvals.length }})</button>
    </h2>
    <div v-if="item.stages.length" class="rk-wf">
      <template v-for="(s, i) in item.stages" :key="i">
        <span v-if="i" :class="['ln', stageState(i - 1)]" />
        <span :class="['st', stageState(i)]"><i>{{ stageState(i) === 'done' ? '✓' : i + 1 }}</i>{{ s }}</span>
      </template>
    </div>
    <p v-else class="pm-muted">لا توجد مراحل اعتماد لهذا الإجراء في الإعدادات، فيُعتمد مباشرة عند رفعه.</p>
    <div v-if="item.status === 'returned' || item.status === 'rejected'" class="rk-warn" style="margin-top: 8px">
      {{ item.status === 'returned' ? 'أُرجع للتعديل' : 'رُفض' }}: {{ [...item.approvals].reverse().find((a) => a.action === (item.status === 'returned' ? 'return' : 'reject'))?.note }}
    </div>
    <div v-if="item.canDecide" style="margin-top: 12px">
      <label class="field"><span>ملاحظة القرار (إلزامية عند الإرجاع أو الرفض)</span><textarea v-model="note" class="input" rows="2" /></label>
      <div class="pm-actions">
        <button class="btn btn-primary" :disabled="busy" @click="decide('approve')">اعتماد «{{ item.stageName }}»</button>
        <button class="btn" :disabled="busy" @click="decide('return')">إرجاع للتعديل</button>
        <button class="btn btn-danger" :disabled="busy" @click="decide('reject')">رفض</button>
      </div>
    </div>
    <div v-else-if="canSubmit && (item.status === 'draft' || item.status === 'returned')" class="pm-actions" style="margin-top: 12px">
      <button class="btn btn-primary" :disabled="busy" @click="run('submit', {}, item.stages.length ? 'رُفع للاعتماد' : 'اعتُمد')">رفع للاعتماد</button>
      <span v-if="item.approvedAt" class="pm-muted">سبق اعتماده، وأُعيد مسودة بعد التعديل</span>
    </div>
    <p v-else-if="item.status === 'in_review'" class="pm-muted" style="margin-top: 8px">بانتظار قرار «{{ item.stageName }}».</p>
    <ul v-if="showLog" class="rk-log" style="margin-top: 12px">
      <li v-for="(a, i) in [...item.approvals].reverse()" :key="i">
        <b>{{ WF_ACTION[a.action] ?? a.action }}</b>
        <span>{{ a.stage ? `«${a.stage}» · ` : '' }}{{ a.byName }} · {{ fmtDateTime(a.at) }}<span v-if="a.note" class="pm-muted"> — {{ a.note }}</span></span>
      </li>
    </ul>
  </section>
</template>
