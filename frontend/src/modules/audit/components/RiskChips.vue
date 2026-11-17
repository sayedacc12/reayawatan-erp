<script setup lang="ts">
import { LEVEL_COLOR, LEVEL_LABEL, type RiskRef } from '../lib';

/** المخاطر المرتبطة من سجل المخاطر بلون مستواها الحالي */
defineProps<{ risks: RiskRef[]; empty?: string }>();
</script>

<template>
  <div>
    <span v-for="r in risks" :key="r.id" class="au-risk" :style="{ '--c': LEVEL_COLOR[r.level] ?? '#94a3b8' }" :title="r.live === false ? 'غير موجود حاليًا في سجل المخاطر (نسخة وقت الربط)' : ''">
      <span class="au-code">{{ r.code }}</span>{{ r.title }}<b :style="{ color: LEVEL_COLOR[r.level] }">{{ r.levelLabel ?? LEVEL_LABEL[r.level] ?? r.level }}</b>
    </span>
    <span v-if="!risks.length" class="pm-muted">{{ empty ?? 'لا توجد مخاطر مرتبطة' }}</span>
  </div>
</template>
