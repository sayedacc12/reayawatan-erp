<script setup lang="ts">
import { computed } from 'vue';
import { STATUS_COLOR, kindOf, timeText, type MeetingRow } from '../lib';

const props = defineProps<{ m: MeetingRow; i?: number }>();
const d = computed(() => new Date(`${props.m.date}T00:00:00`));
const month = computed(() => d.value.toLocaleDateString('ar-SA-u-ca-gregory', { month: 'short' }));
const weekday = computed(() => d.value.toLocaleDateString('ar-SA-u-ca-gregory', { weekday: 'long' }));
</script>

<template>
  <RouterLink :to="`/meetings/m/${m.id}`" class="card mt-item" :style="{ '--i': i ?? 0, '--c': kindOf(m.kind).color }">
    <div class="mt-cal"><span>{{ month }}</span><b>{{ d.getDate() }}</b><small>{{ weekday }}</small></div>
    <div style="min-width: 0">
      <h3>{{ m.title }} <span v-if="m.isConfidential" class="pm-pill" style="--c: #f59e0b">سري</span></h3>
      <div class="meta">
        <span class="cm-code">{{ m.refNo }}</span><span>{{ m.bodyName }}</span><span>{{ timeText(m.startTime) }} · {{ m.modeLabel }}</span>
        <span v-if="m.location">{{ m.location }}</span>
        <span>{{ m.items }} بند · {{ m.recs }} توصية</span>
      </div>
    </div>
    <div class="side">
      <span class="pm-pill" :style="{ '--c': STATUS_COLOR[m.status] }">{{ m.statusLabel }}</span>
      <small v-if="m.status === 'scheduled'" class="pm-muted">{{ m.accepted }} من {{ m.invited }} أكدوا</small>
      <small v-else-if="['held', 'signing', 'adopted'].includes(m.status)" class="pm-muted">حضر {{ m.present }} من {{ m.invited }}<template v-if="m.signers"> · وقّع {{ m.signed }}/{{ m.signers }}</template></small>
      <small v-if="m.myRsvp === 'pending' && m.status === 'scheduled'" class="pm-pill" style="--c: #e11d48">بانتظار ردك</small>
      <small v-if="m.mySign === 'pending' && m.status === 'signing'" class="pm-pill" style="--c: #6366f1">بانتظار توقيعك</small>
    </div>
  </RouterLink>
</template>
