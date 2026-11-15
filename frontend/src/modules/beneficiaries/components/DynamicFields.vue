<script setup lang="ts">
import { SUPPORT_DECISIONS } from '../labels';
import type { FormField, SupportAnswer } from '../types';

/** يعرض حقول نموذج معرّف من الإعدادات ويربطها بكائن الإجابات */
defineProps<{ fields: FormField[]; disabled?: boolean }>();
const model = defineModel<Record<string, unknown>>({ required: true });
const sup = (key: string) => (model.value[key] as SupportAnswer | undefined) ?? null;
function setSupport(key: string, decision: SupportAnswer['decision']) {
  model.value = { ...model.value, [key]: decision === 'partial' ? { decision, percent: sup(key)?.percent } : { decision } };
}
function setPercent(key: string, v: string) {
  model.value = { ...model.value, [key]: { decision: 'partial', percent: v === '' ? undefined : Number(v) } };
}
</script>

<template>
  <div class="dyn">
    <div v-for="f in fields" :key="f.key" :class="['field', { wide: f.type === 'textarea' || f.type === 'support' }]">
      <label v-if="f.type !== 'checkbox'">{{ f.label }}<span v-if="f.required" class="req"> *</span></label>
      <textarea v-if="f.type === 'textarea'" v-model="model[f.key] as string" class="input" rows="3" :required="f.required" :placeholder="f.placeholder" :disabled="disabled" />
      <select v-else-if="f.type === 'select'" v-model="model[f.key]" class="input" :required="f.required" :disabled="disabled">
        <option :value="undefined" disabled>اختر...</option>
        <option v-for="o in f.options" :key="o" :value="o">{{ o }}</option>
      </select>
      <div v-else-if="f.type === 'support'" class="support">
        <div class="sopts">
          <button v-for="o in SUPPORT_DECISIONS" :key="o.value" type="button" :disabled="disabled"
            :class="['sopt', { on: sup(f.key)?.decision === o.value }]" :style="{ '--c': o.color }" @click="setSupport(f.key, o.value as SupportAnswer['decision'])">{{ o.label }}</button>
        </div>
        <Transition name="page">
          <div v-if="sup(f.key)?.decision === 'partial'" class="spct">
            <label>نسبة دعم الجمعية *</label>
            <div class="pin"><input :value="sup(f.key)?.percent ?? ''" type="number" min="1" max="99" step="0.01" class="input" required :disabled="disabled" @input="setPercent(f.key, ($event.target as HTMLInputElement).value)" /><span>%</span></div>
            <small v-if="sup(f.key)?.percent" class="muted">الجمعية {{ sup(f.key)?.percent }}% والمستفيد يستكمل {{ Math.round((100 - (sup(f.key)?.percent ?? 0)) * 100) / 100 }}% كمساهمة</small>
          </div>
        </Transition>
      </div>
      <label v-else-if="f.type === 'checkbox'" class="check box"><input v-model="model[f.key]" type="checkbox" :required="f.required" :disabled="disabled" /> {{ f.label }}<span v-if="f.required" class="req"> *</span></label>
      <input v-else v-model="model[f.key]" class="input" :type="f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'"
        :step="f.type === 'number' ? 'any' : undefined" :required="f.required" :placeholder="f.placeholder" :disabled="disabled" />
    </div>
  </div>
</template>

<style scoped>
.dyn { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.wide { grid-column: 1 / -1; }
.req { color: var(--danger); }
.box { padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; margin-top: 22px; }
textarea.input { resize: vertical; }
.support { display: flex; flex-direction: column; gap: 10px; }
.sopts { display: flex; gap: 8px; flex-wrap: wrap; }
.sopt { font: inherit; font-weight: 600; padding: 9px 16px; border-radius: 10px; border: 1.5px solid var(--border); background: var(--surface); cursor: pointer; transition: all .2s; }
.sopt:hover { border-color: var(--c); color: var(--c); }
.sopt.on { background: var(--c); border-color: var(--c); color: #fff; box-shadow: 0 6px 16px color-mix(in srgb, var(--c) 35%, transparent); }
.spct { padding: 10px 12px; border-radius: 10px; border: 1px dashed #f59e0b; background: rgba(245,158,11,.06); }
.spct label { display: block; font-weight: 600; margin-bottom: 6px; }
.pin { display: flex; align-items: center; gap: 6px; max-width: 160px; }
@media (max-width: 600px) { .dyn { grid-template-columns: 1fr; } .box { margin-top: 0; } }
</style>
