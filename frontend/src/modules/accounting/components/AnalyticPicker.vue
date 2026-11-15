<script setup lang="ts">
/** التوزيع التحليلي لسطر: حساب تحليلي واحد أو أكثر بنسب مجموعها 100% (مثل التوزيع التحليلي في Odoo) */
import { computed, ref } from 'vue';
import type { Analytic } from '../lib';

export interface Share { analyticId: string; percent: number }
const props = defineProps<{ modelValue: Share[]; analytic: Analytic[]; amount?: number; required?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [Share[]]; close: [] }>();
const rows = ref<Share[]>(props.modelValue.length ? props.modelValue.map((s) => ({ ...s })) : [{ analyticId: '', percent: 100 }]);
const subs = computed(() => props.analytic.filter((a) => a.kind === 'sub' && a.isActive));
const total = computed(() => Math.round(rows.value.reduce((s, r) => s + Number(r.percent || 0), 0) * 100) / 100);
const parentName = (a: Analytic) => props.analytic.find((x) => x.id === a.parentId)?.name ?? '';
function add() {
  rows.value.push({ analyticId: '', percent: Math.max(0, Math.round((100 - total.value) * 100) / 100) });
}
function save() {
  const clean = rows.value.filter((r) => r.analyticId);
  emit('update:modelValue', clean.map((r) => ({ analyticId: r.analyticId, percent: Number(r.percent) })));
  emit('close');
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="card modal">
      <h2>التوزيع التحليلي <small v-if="required" class="pm-muted">(إلزامي لهذا الحساب)</small></h2>
      <div v-for="(r, i) in rows" :key="i" class="arow">
        <select v-model="r.analyticId" class="input">
          <option value="">اختر حسابًا تحليليًا فرعيًا</option>
          <option v-for="a in subs" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}{{ parentName(a) ? ` (${parentName(a)})` : '' }}</option>
        </select>
        <input v-model.number="r.percent" class="input pct" type="number" min="0.01" max="100" step="0.01" />
        <span class="pm-muted">%</span>
        <span v-if="amount" class="pm-muted amt">{{ ((amount * (r.percent || 0)) / 100).toFixed(2) }}</span>
        <button class="btn btn-sm" @click="rows.splice(i, 1)">✕</button>
      </div>
      <button class="btn btn-sm" @click="add">+ توزيع على حساب آخر</button>
      <p :class="['tot', { ok: total === 100 }]">المجموع {{ total }}% {{ total === 100 ? '✓' : '(يجب أن يساوي 100%)' }}</p>
      <div class="modal-actions">
        <button class="btn btn-primary" :disabled="rows.some((r) => r.analyticId) && total !== 100" @click="save">تم</button>
        <button class="btn" @click="emit('close')">إلغاء</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.arow { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
.arow select { flex: 1; }
.pct { width: 90px; }
.amt { min-width: 80px; font-variant-numeric: tabular-nums; }
.tot { font-weight: 700; color: var(--danger); }
.tot.ok { color: var(--success); }
</style>
