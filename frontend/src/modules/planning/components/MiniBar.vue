<script setup lang="ts">
/** شريط إنجاز صغير مع علامة المخطط */
defineProps<{ value: number | null; planned?: number | null; color?: string }>();
</script>

<template>
  <span class="pl-mini" :title="`المنجز ${value ?? 0}%${planned !== null && planned !== undefined ? ` · المخطط ${planned}%` : ''}`">
    <i :style="{ width: `${Math.min(100, value ?? 0)}%`, '--c': color ?? '#10b981' }" />
    <u v-if="planned !== null && planned !== undefined" :style="{ insetInlineStart: `${Math.min(100, planned)}%` }" />
  </span>
</template>
