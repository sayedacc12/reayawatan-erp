<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import { sar } from '../lib';

/** اختيار مصدر الصرف: مصدر التمويل (يُفحص أولًا) وبند الموازنة، مع فحص المتاح مباشرة */
const budgetLineId = defineModel<string>('budgetLineId', { default: '' });
const fundingBatchId = defineModel<string>('fundingBatchId', { default: '' });
const props = defineProps<{ amount: number; projectId?: string | null; kind?: string }>();

const year = ref(new Date().getFullYear());
const opts = ref<any>(null);
const check = ref<any>(null);
const checking = ref(false);
async function loadOpts() {
  opts.value = await api(`/procurement/budget-options?year=${year.value}`).catch(() => ({ budget: null, lines: [], funding: [] }));
}
onMounted(loadOpts);
watch(year, loadOpts);

let t: ReturnType<typeof setTimeout>;
watch(() => [budgetLineId.value, fundingBatchId.value, props.amount, props.projectId, props.kind], () => {
  clearTimeout(t);
  t = setTimeout(run, 350);
}, { immediate: true });
async function run() {
  if (!(props.amount > 0) || (!budgetLineId.value && !fundingBatchId.value)) {
    check.value = null;
    return;
  }
  checking.value = true;
  try {
    check.value = await api('/procurement/budget-check', {
      method: 'POST', json: { amount: props.amount, budgetLineId: budgetLineId.value || null, fundingBatchId: fundingBatchId.value || null, projectId: props.projectId || null, kind: props.kind },
    });
  } catch (e) {
    check.value = { allowed: false, message: (e as Error).message, warnings: [] };
  } finally {
    checking.value = false;
  }
}
const KIND: Record<string, string> = { operational: 'تشغيلي', program: 'مشروع', case: 'حالة مستفيد', waqf: 'وقف' };
const lineLabel = (l: any) => `${l.name}${l.unitName ? ` · ${l.unitName}` : ''} — المتاح ${sar(l.available)}`;
const batchLabel = (b: any) => `الدفعة ${b.batchNo} · ${b.targetName} (${KIND[b.targetKind] ?? b.targetKind}${b.isZakat ? '، زكاة' : ''}) — المتاح ${sar(b.available)}`;
const selectedBatch = computed(() => opts.value?.funding.find((b: any) => b.id === fundingBatchId.value));
</script>

<template>
  <div class="pc-finance">
    <div class="pc-fields">
      <label class="field">
        <span>مصدر التمويل <small class="pm-muted">(تبرع مقيد أو منحة، يُفحص أولًا)</small></span>
        <select v-model="fundingBatchId" class="input">
          <option value="">— بلا مصدر تمويل —</option>
          <option v-for="b in opts?.funding ?? []" :key="b.id" :value="b.id">{{ batchLabel(b) }}</option>
        </select>
      </label>
      <label class="field">
        <span>بند الموازنة <small class="pm-muted">(موازنة {{ year }}{{ opts?.budget ? ` · ${opts.budget.code}` : '' }})</small></span>
        <div class="pc-inline">
          <select v-model="budgetLineId" class="input grow">
            <option value="">— بلا بند —</option>
            <option v-for="l in opts?.lines ?? []" :key="l.lineId" :value="l.lineId">{{ lineLabel(l) }}</option>
          </select>
          <select v-model.number="year" class="input" style="width: 90px"><option v-for="y in [year - 1, year, year + 1]" :key="y" :value="y">{{ y }}</option></select>
        </div>
      </label>
    </div>
    <p v-if="opts && !opts.budget && !opts.funding.length" class="pc-warn" style="white-space: normal">لا توجد موازنة معتمدة لهذه السنة ولا مصادر تمويل نشطة. اعتمد الموازنة من نظام التخطيط أولًا.</p>
    <p v-if="selectedBatch?.conditions?.endDate" class="pm-muted" style="font-size: .8rem">ينتهي استخدام هذا التمويل في {{ selectedBatch.conditions.endDate }}</p>
    <div v-if="checking" class="pm-muted" style="font-size: .85rem">جارٍ فحص المتاح...</div>
    <div v-else-if="check" :class="['pc-check-box', check.allowed ? 'ok' : 'bad']">
      <b>{{ check.allowed ? '✓' : '✕' }} {{ check.message }}</b>
      <div v-for="w in check.warnings ?? []" :key="w" class="pc-warn" style="white-space: normal; display: block; margin-top: 4px">{{ w }}</div>
    </div>
  </div>
</template>
