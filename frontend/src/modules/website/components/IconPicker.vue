<script setup lang="ts">
import SiteIcon from '../../../site/SiteIcon.vue';
import { ICONS } from '../lib';

defineProps<{ modelValue: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();
</script>

<template>
  <div class="ip">
    <button v-for="i in ICONS" :key="i" type="button" :class="['ip-i', { on: modelValue === i }]" :title="i" @click="emit('update:modelValue', i)"><SiteIcon :name="i" :size="20" /></button>
  </div>
</template>

<style scoped>
.ip { display: flex; flex-wrap: wrap; gap: 4px; }
.ip-i { width: 36px; height: 36px; border-radius: 9px; border: 1px solid var(--border); background: var(--surface); display: grid; place-items: center; cursor: pointer; color: var(--muted); transition: all .15s; }
.ip-i:hover { color: var(--primary); border-color: var(--primary); }
.ip-i.on { background: var(--grad); color: #fff; border-color: transparent; box-shadow: 0 4px 12px rgba(13,148,136,.3); }
</style>
