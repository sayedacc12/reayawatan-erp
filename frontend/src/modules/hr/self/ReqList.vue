<script setup lang="ts">
import { fmtDate } from '../lib';
import { KIND_ICON, REQ_COLOR, rel, type ReqRow } from './ess';

/** قائمة طلبات مختصرة (تُستخدم في شاشات الموظف والمدير) */
defineProps<{ rows: ReqRow[]; showEmployee?: boolean; empty?: string }>();
</script>

<template>
  <div class="ess-list">
    <RouterLink v-for="(r, i) in rows" :key="r.id" :to="`/me/requests/${r.id}`" class="ess-item" :style="{ '--i': Math.min(i, 12), '--c': REQ_COLOR[r.status] }">
      <span class="em">{{ KIND_ICON[r.kind] ?? '📝' }}</span>
      <span class="tx">
        <b>{{ r.typeName }} <small class="pm-muted">#{{ r.requestNo }}</small></b>
        <span>
          <template v-if="showEmployee && r.employeeName">{{ r.employeeName }} · </template>{{ r.summary }}
          <template v-if="r.status === 'pending' && r.currentStep"> · عند {{ r.currentApprover ?? r.currentStep }}</template>
          <template v-if="r.attachments"> · 📎 {{ r.attachments }}</template>
        </span>
      </span>
      <span class="ess-req-end">
        <span class="ess-pill" :style="{ '--c': REQ_COLOR[r.status] }">{{ r.statusLabel }}</span>
        <small class="pm-muted" :title="fmtDate(r.createdAt)">{{ rel(r.createdAt) }}</small>
      </span>
    </RouterLink>
    <p v-if="!rows.length" class="pm-empty">{{ empty ?? 'لا توجد طلبات' }}</p>
  </div>
</template>
