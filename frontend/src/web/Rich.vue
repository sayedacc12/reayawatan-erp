<script setup lang="ts">
import { computed } from 'vue';
import { segments } from './site';

/** نص من لوحة التحكم: يُعرض نصًا عاديًا (بلا HTML)، وما بين {{ }} يظهر مظللًا كبيان ينتظر الاستكمال */
const props = defineProps<{ text?: string | null }>();
const parts = computed(() => segments(props.text));
</script>

<template><template v-for="(p, i) in parts" :key="i"><span v-if="p.ph" class="ph">{{ p.t }}</span><template v-else>{{ p.t }}</template></template></template>
