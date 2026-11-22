<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { ACTIVITY_ICON, fmtDateTime, fromLocalInput, relTime, toLocalInput } from '../lib';

/** خط زمني للأنشطة: المجدول بإطار متقطع (والمتأخر بالأحمر)، والمنجز بلون ممتلئ. الإنجاز يطلب النتيجة والخطوة التالية */
const props = defineProps<{ items: any[]; lk: any; canManage: boolean; showTarget?: boolean }>();
const emit = defineEmits<{ (e: 'changed'): void }>();
const toast = useToast();
const COLORS: Record<string, string> = { call: '#0891b2', meeting: '#7c3aed', whatsapp: '#16a34a', email: '#0369a1', task: '#d97706', note: '#64748b' };
const completing = ref<any>(null);
const busy = ref(false);
const isLate = (a: any) => !a.doneAt && a.dueAt && new Date(a.dueAt) < new Date();
const mine = (a: any) => props.lk.can.all || a.ownerId === props.lk.me;

function start(a: any) {
  completing.value = { a, outcome: '', nextSubject: '', nextType: 'call', nextDueAt: toLocalInput(new Date(Date.now() + 2 * 86400_000)) };
}
async function complete() {
  const c = completing.value;
  busy.value = true;
  try {
    await api(`/crm/activities/${c.a.id}/complete`, {
      method: 'POST',
      json: { outcome: c.outcome || null, nextSubject: c.nextSubject || null, nextType: c.nextType, nextDueAt: c.nextSubject ? fromLocalInput(c.nextDueAt) : null },
    });
    toast.success(c.nextSubject ? 'أُنجز النشاط وجُدولت الخطوة التالية' : 'أُنجز النشاط');
    completing.value = null;
    emit('changed');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function remove(a: any) {
  if (!confirm(`حذف النشاط المجدول «${a.subject}»؟`)) return;
  try {
    await api(`/crm/activities/${a.id}`, { method: 'DELETE' });
    emit('changed');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <div v-if="!items.length" class="cr-empty">لا توجد أنشطة بعد</div>
    <div class="cr-timeline">
      <div v-for="a in items" :key="a.id" :class="['cr-act', { open: !a.doneAt, late: isLate(a) }]" :style="{ '--c': COLORS[a.type] }">
        <span class="ic">{{ ACTIVITY_ICON[a.type] }}</span>
        <div>
          <h4>
            {{ a.subject }}
            <span class="cr-chip" :style="{ '--c': COLORS[a.type] }">{{ a.typeLabel ?? lk.labels.activityTypes[a.type] }}</span>
            <span v-if="isLate(a)" class="cr-flag">متأخر {{ relTime(a.dueAt).replace('منذ ', '') }}</span>
            <span v-else-if="a.doneAt" class="cr-ok">✓ منجز</span>
          </h4>
          <p v-if="showTarget && (a.partyName || a.leadName)">
            <RouterLink v-if="a.partyId" class="pm-link" :to="`/crm/parties/${a.partyId}`">{{ a.partyName }}</RouterLink>
            <RouterLink v-else class="pm-link" :to="`/crm/leads/${a.leadId}`">{{ a.leadName }} (عميل محتمل)</RouterLink>
          </p>
          <p v-if="a.details">{{ a.details }}</p>
          <p v-if="a.outcome"><b>النتيجة:</b> {{ a.outcome }}</p>
          <div class="meta">
            <template v-if="a.doneAt">نُفّذ {{ fmtDateTime(a.doneAt) }}</template>
            <template v-else-if="a.dueAt">موعده {{ fmtDateTime(a.dueAt) }} ({{ relTime(a.dueAt) }})</template>
            · {{ a.ownerName ?? a.createdByName }}
          </div>
          <div v-if="canManage && !a.doneAt && mine(a)" class="tools">
            <button class="btn btn-sm btn-primary" @click="start(a)">إنجاز</button>
            <button class="btn btn-sm" @click="remove(a)">حذف</button>
          </div>
        </div>
      </div>
    </div>
    <div v-if="completing" class="modal-backdrop" @click.self="completing = null">
      <form class="card modal cr-modal" @submit.prevent="complete">
        <h2>إنجاز: {{ completing.a.subject }}</h2>
        <label class="field"><span>النتيجة</span><textarea v-model="completing.outcome" class="input" rows="3" maxlength="2000" placeholder="ماذا تم؟ وما الاتفاق؟" /></label>
        <p class="cr-sec">الخطوة التالية (اختياري)</p>
        <div class="cr-fields">
          <label class="field"><span>النوع</span><select v-model="completing.nextType" class="input"><option v-for="(l, k) in lk.labels.activityTypes" :key="k" :value="k">{{ l }}</option></select></label>
          <label class="field"><span>العنوان</span><input v-model="completing.nextSubject" class="input" maxlength="250" placeholder="مثل: إرسال العرض" /></label>
          <label v-if="completing.nextSubject" class="field"><span>الموعد</span><input v-model="completing.nextDueAt" type="datetime-local" class="input" required /></label>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" @click="completing = null">إلغاء</button>
          <button class="btn btn-primary" :disabled="busy">إنجاز</button>
        </div>
      </form>
    </div>
  </div>
</template>
