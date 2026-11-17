<script setup lang="ts">
import type { FieldType, FormField } from '../lib';

/** محرر نموذج مرن: إضافة حقول وترتيبها وتحديد نوعها وإلزاميتها */
const fields = defineModel<FormField[]>({ required: true });
defineProps<{ hint?: string }>();
const TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'نص قصير' }, { value: 'textarea', label: 'نص طويل' }, { value: 'number', label: 'رقم' }, { value: 'date', label: 'تاريخ' },
  { value: 'select', label: 'قائمة اختيار' }, { value: 'checkbox', label: 'مربع تأكيد' },
];
function add() {
  fields.value = [...fields.value, { key: '', label: '', type: 'text', required: false }];
}
function move(i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= fields.value.length) return;
  const list = [...fields.value];
  [list[i], list[j]] = [list[j], list[i]];
  fields.value = list;
}
const optionsText = (f: FormField) => (f.options ?? []).join('، ');
function setOptions(f: FormField, v: string) {
  f.options = v.split(/[،,\n]/).map((x) => x.trim()).filter(Boolean);
}
</script>

<template>
  <div>
    <p v-if="hint" class="pm-muted" style="margin-top: 0">{{ hint }}</p>
    <TransitionGroup name="page" tag="div" class="fe">
      <div v-for="(f, i) in fields" :key="f.key || `n${i}`" class="fe-row">
        <span class="pm-tag">{{ i + 1 }}</span>
        <input v-model="f.label" class="input" placeholder="اسم الحقل" />
        <select v-model="f.type" class="input" style="max-width: 150px"><option v-for="t in TYPES" :key="t.value" :value="t.value">{{ t.label }}</option></select>
        <label class="check" style="white-space: nowrap"><input v-model="f.required" type="checkbox" /> إلزامي</label>
        <span class="acts">
          <button type="button" class="btn btn-sm" :disabled="i === 0" title="لأعلى" @click="move(i, -1)">▲</button>
          <button type="button" class="btn btn-sm" :disabled="i === fields.length - 1" title="لأسفل" @click="move(i, 1)">▼</button>
          <button type="button" class="btn btn-sm btn-danger" title="حذف" @click="fields.splice(i, 1)">✕</button>
        </span>
        <input v-if="f.type === 'select'" :value="optionsText(f)" class="input opts" placeholder="الخيارات مفصولة بفاصلة: نعم، لا" @change="setOptions(f, ($event.target as HTMLInputElement).value)" />
      </div>
    </TransitionGroup>
    <p v-if="!fields.length" class="pm-muted">لا توجد حقول إضافية، ويكفي النموذج الأساسي.</p>
    <button type="button" class="btn btn-sm" @click="add">+ حقل جديد</button>
  </div>
</template>

<style scoped>
.fe { display: grid; gap: 8px; margin-bottom: 10px; }
.fe-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; padding: 8px; border: 1px dashed var(--border); border-radius: 12px; background: var(--surface); }
.fe-row > .input:first-of-type { flex: 1; min-width: 180px; }
.acts { display: flex; gap: 4px; }
.opts { flex-basis: 100%; }
</style>
