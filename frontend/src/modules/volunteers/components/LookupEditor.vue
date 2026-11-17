<script setup lang="ts">
import type { LookupItem } from '../lib';

/** محرر قائمة قابلة للتعريف (أنواع التطوع، المجالات، التصنيفات): العنصر المستخدم يُوقف ولا يُحذف */
const items = defineModel<LookupItem[]>({ required: true });
defineProps<{ title: string; hint?: string; withDescription?: boolean }>();
function add() {
  items.value = [...items.value, { code: '', name: '', description: null, isActive: true }];
}
</script>

<template>
  <div>
    <h2>{{ title }} <span class="pm-tag">{{ items.filter((x) => x.isActive).length }} مفعّل</span></h2>
    <p v-if="hint" class="pm-muted" style="margin-top: 0">{{ hint }}</p>
    <div v-for="(it, i) in items" :key="it.code || `n${i}`" class="le-row" :class="{ off: !it.isActive }">
      <input v-model="it.name" class="input" placeholder="الاسم" />
      <input v-if="withDescription" v-model="it.description" class="input" placeholder="وصف مختصر (اختياري)" />
      <label class="check" style="white-space: nowrap"><input v-model="it.isActive" type="checkbox" /> مفعّل</label>
      <button v-if="!it.code" type="button" class="btn btn-sm btn-danger" @click="items.splice(i, 1)">✕</button>
    </div>
    <button type="button" class="btn btn-sm" @click="add">+ إضافة</button>
  </div>
</template>

<style scoped>
.le-row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.le-row .input { flex: 1; min-width: 160px; }
.le-row.off .input { opacity: .55; text-decoration: line-through; }
</style>
