<script setup lang="ts">
import { computed } from 'vue';
import { publicText } from './site';

/**
 * نص من لوحة التحكم يُعرض نصًا عاديًا (بلا HTML).
 * البيانات المعلقة بين {{ }} لا تظهر للزوار بعد إطلاق الموقع؛ تبقى ظاهرة في لوحة التحكم حتى تُستكمل.
 */
const props = defineProps<{ text?: string | null }>();
const shown = computed(() => publicText(props.text));
</script>

<template>{{ shown }}</template>
