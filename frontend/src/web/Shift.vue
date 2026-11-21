<script setup lang="ts">
defineProps<{ from: string; to: string; head?: boolean }>();
</script>
<template><div :class="['shift', { head }]"><span class="from">{{ from }}</span><span class="arr" aria-hidden="true">{{ head ? '' : '←' }}</span><span class="to">{{ to }}</span></div></template>
