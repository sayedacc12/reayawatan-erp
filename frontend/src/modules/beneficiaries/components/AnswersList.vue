<script setup lang="ts">
import { answer } from '../labels';
import type { FormField } from '../types';

defineProps<{ fields: FormField[]; data: Record<string, unknown> | null }>();
</script>

<template>
  <dl class="answers">
    <div v-for="f in fields" :key="f.key" :class="{ wide: f.type === 'textarea' }">
      <dt>{{ f.label }}</dt>
      <dd>{{ answer(f.type, data?.[f.key]) }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.answers { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px 18px; margin: 0; }
.answers .wide { grid-column: 1 / -1; }
dt { font-size: .78rem; color: var(--muted); }
dd { margin: 2px 0 0; font-weight: 500; white-space: pre-wrap; }
</style>
