<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
defineProps<{ s: any; board?: string }>();
</script>

<template>
  <div class="oc">
    <img v-if="s.imageUrl" :src="s.imageUrl" alt="الهيكل التنظيمي" class="oc-img" />
    <template v-else>
      <div class="oc-node top">{{ s.assembly }}</div>
      <i class="oc-line" />
      <div class="oc-node">{{ board || 'مجلس الإدارة' }}</div>
      <template v-if="s.committees?.length">
        <i class="oc-line" />
        <div class="oc-row"><div v-for="c in s.committees" :key="c" class="oc-node soft">{{ c }}</div></div>
      </template>
      <i class="oc-line" />
      <div class="oc-node accent">{{ s.ceo }}</div>
      <template v-if="s.units?.length">
        <i class="oc-line" />
        <div class="oc-row"><div v-for="u in s.units" :key="u" class="oc-node light">{{ u }}</div></div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.oc { display: flex; flex-direction: column; align-items: center; padding: 10px 0; }
.oc-img { max-width: 100%; border-radius: 14px; }
.oc-node { padding: 12px 24px; border-radius: 14px; background: var(--primary); color: #fff; font-weight: 700; text-align: center; box-shadow: 0 8px 20px color-mix(in srgb, var(--primary) 25%, transparent); }
.oc-node.top { background: var(--grad-dark); padding: 14px 34px; font-size: 1.08rem; }
.oc-node.accent { background: var(--accent); color: var(--dark); }
.oc-node.soft { background: color-mix(in srgb, var(--primary) 12%, #fff); color: var(--primary); box-shadow: none; font-size: .9rem; padding: 10px 16px; }
.oc-node.light { background: var(--paper); color: var(--ink); border: 1.5px solid var(--line); box-shadow: none; font-size: .9rem; padding: 10px 14px; }
.oc-line { width: 2px; height: 26px; background: linear-gradient(var(--primary), var(--accent)); }
.oc-row { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; position: relative; padding-top: 4px; }
</style>
