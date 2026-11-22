<script setup lang="ts">
import { AR, type Service } from './site';
import { svcNo } from './parts';
defineProps<{ s: Service }>();
</script>
<template><span class="stage"><b>{{ AR(svcNo(s)) }}</b>{{ s.stage }}<em v-if="s.slug === 'health'">تخصصنا</em></span></template>
