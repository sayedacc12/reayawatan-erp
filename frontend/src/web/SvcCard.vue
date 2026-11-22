<script setup lang="ts">
import Icon from './Icon.vue';
import Shift from './Shift.vue';
import StageTag from './StageTag.vue';
import type { Service } from './site';
defineProps<{ s: Service }>();
</script>
<template>
  <RouterLink class="svc-card val-card" :to="`/services/${s.slug}`">
    <StageTag :s="s" />
    <div class="vc-head"><span class="ico"><Icon :name="s.icon" /></span><h3>{{ s.title }}</h3></div>
    <p class="vc-value">{{ s.value }}</p>
    <Shift v-if="s.shifts[0]" :from="s.shifts[0].from" :to="s.shifts[0].to" />
    <span class="more">القيمة والمؤشرات ←</span>
  </RouterLink>
</template>
