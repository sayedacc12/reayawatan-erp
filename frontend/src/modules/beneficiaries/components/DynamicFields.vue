<script setup lang="ts">
import type { FormField } from '../types';

/** يعرض حقول نموذج معرّف من الإعدادات ويربطها بكائن الإجابات */
defineProps<{ fields: FormField[]; disabled?: boolean }>();
const model = defineModel<Record<string, unknown>>({ required: true });
</script>

<template>
  <div class="dyn">
    <div v-for="f in fields" :key="f.key" :class="['field', { wide: f.type === 'textarea' }]">
      <label v-if="f.type !== 'checkbox'">{{ f.label }}<span v-if="f.required" class="req"> *</span></label>
      <textarea v-if="f.type === 'textarea'" v-model="model[f.key] as string" class="input" rows="3" :required="f.required" :placeholder="f.placeholder" :disabled="disabled" />
      <select v-else-if="f.type === 'select'" v-model="model[f.key]" class="input" :required="f.required" :disabled="disabled">
        <option :value="undefined" disabled>اختر...</option>
        <option v-for="o in f.options" :key="o" :value="o">{{ o }}</option>
      </select>
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
@media (max-width: 600px) { .dyn { grid-template-columns: 1fr; } .box { margin-top: 0; } }
</style>
