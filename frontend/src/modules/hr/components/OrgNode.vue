<script setup lang="ts">
import type { Unit } from '../lib';

/** عقدة في المخطط التنظيمي، تعرض وحداتها الفرعية تحتها */
defineOptions({ name: 'OrgNode' });
const props = defineProps<{ unit: Unit; all: Unit[]; depth?: number }>();
const emit = defineEmits<{ pick: [u: Unit] }>();
const COLORS = ['#a78bfa', '#14b8a6', '#f472b6', '#f59e0b', '#0ea5e9', '#22c55e', '#ef4444', '#6366f1'];
const kids = () => props.all.filter((u) => u.parentId === props.unit.id);
</script>

<template>
  <li>
    <div class="hr-node" :style="{ '--c': COLORS[unit.level % COLORS.length], '--i': depth ?? 0 }" @click="emit('pick', unit)">
      <span class="lv">{{ unit.levelName }}</span>
      <b>{{ unit.name }}</b>
      <span class="mgr">{{ unit.managerName ?? 'بدون مدير' }}</span>
      <div class="stats"><span title="الموظفون">👤 {{ unit.employees }}</span><span title="الوظائف">💼 {{ unit.jobs }}</span><span title="الشواغر المعتمدة">{{ unit.headcount }} معتمد</span></div>
    </div>
    <ul v-if="kids().length">
      <OrgNode v-for="k in kids()" :key="k.id" :unit="k" :all="all" :depth="(depth ?? 0) + 1" @pick="(u) => emit('pick', u)" />
    </ul>
  </li>
</template>
