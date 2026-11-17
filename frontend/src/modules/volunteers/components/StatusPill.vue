<script setup lang="ts">
import { STATUS_COLOR } from '../lib';

defineProps<{ status: string; label: string }>();
</script>

<template>
  <span class="pm-pill" :style="{ '--c': STATUS_COLOR[status] ?? '#94a3b8' }">{{ label }}</span>
</template>
