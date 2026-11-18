<script setup lang="ts">
import { CONF_COLOR } from '../lib';

defineProps<{ level: string; label: string }>();
</script>

<template>
  <span :class="['cm-conf', { hot: level === 'confidential' || level === 'top_secret' }]" :style="{ '--c': CONF_COLOR[level] }" :title="label">
    <svg v-if="level !== 'normal'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
    {{ label }}
  </span>
</template>
