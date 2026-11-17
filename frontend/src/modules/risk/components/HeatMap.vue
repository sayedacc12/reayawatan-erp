
<script setup lang="ts">
import { computed } from 'vue';
import { levelOf, type RiskConfig } from '../lib';

/**
 * مصفوفة المخاطر 5×5: الصفوف للاحتمالية (5 في الأعلى) والأعمدة للأثر.
 * بوضع العرض تُظهر عدد المخاطر في كل خانة، وبوضع الاختيار يحدد المستخدم الاحتمالية والأثر بنقرة.
 */
const props = defineProps<{ config: RiskConfig; grid?: number[][]; likelihood?: number; impact?: number; pick?: boolean; marker?: { l: number; i: number } | null }>();
const emit = defineEmits<{ (e: 'pick', v: { likelihood: number; impact: number }): void; (e: 'cell', v: { likelihood: number; impact: number }): void }>();
const rows = [5, 4, 3, 2, 1];
const cols = [1, 2, 3, 4, 5];
const color = (l: number, i: number) => levelOf(props.config, l * i).color;
const isOn = (l: number, i: number) => (props.pick && props.likelihood === l && props.impact === i) || (props.marker?.l === l && props.marker?.i === i);
const name = (arr: { value: number; name: string }[], v: number) => arr.find((x) => x.value === v)?.name ?? v;
const total = computed(() => (props.grid ?? []).flat().reduce((a, b) => a + b, 0));
</script>

<template>
  <div>
    <div class="rk-heat">
      <template v-for="(l, ri) in rows" :key="l">
        <span class="ax" :title="name(config.likelihood, l) as string">{{ l }}</span>
        <button
          v-for="(i, ci) in cols" :key="`${l}-${i}`" type="button"
          :class="['cell', { pick, on: isOn(l, i), empty: !pick && !(grid?.[l - 1]?.[i - 1]) }]"
          :style="{ '--c': color(l, i), '--i': ri * 5 + ci }"
          :title="`الاحتمالية: ${name(config.likelihood, l)} · الأثر: ${name(config.impact, i)} · الدرجة ${l * i}`"
          @click="pick ? emit('pick', { likelihood: l, impact: i }) : emit('cell', { likelihood: l, impact: i })"
        >{{ pick ? l * i : grid?.[l - 1]?.[i - 1] || '' }}</button>
      </template>
      <span />
      <span v-for="i in cols" :key="`a${i}`" class="ax" :title="name(config.impact, i) as string">{{ i }}</span>
    </div>
    <div class="rk-heat-title"><span>↑ الاحتمالية</span><span v-if="grid">{{ total }} خطر</span><span>الأثر ←</span></div>
  </div>
</template>
