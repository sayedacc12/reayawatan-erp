<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { fromLocalInput, toLocalInput } from '../lib';

/** تسجيل نشاط: منجز الآن (مكالمة تمت، ملاحظة) أو مجدول بموعد (مكالمة قادمة، زيارة، مهمة) */
const props = defineProps<{ lk: any; partyId?: string | null; leadId?: string | null; defaultDone?: boolean }>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'close'): void }>();
const toast = useToast();
const busy = ref(false);
const inHour = new Date(Date.now() + 3600_000);
const f = ref({ type: 'call', subject: '', details: '', done: props.defaultDone ?? false, dueAt: toLocalInput(inHour), outcome: '', ownerId: props.lk.me as string });
const canAssign = props.lk.can.assign || props.lk.can.all;

async function save() {
  busy.value = true;
  try {
    const x = f.value;
    const done = x.done || x.type === 'note';
    await api('/crm/activities', {
      method: 'POST',
      json: {
        type: x.type, subject: x.subject, details: x.details || null, done, dueAt: done ? null : fromLocalInput(x.dueAt), outcome: done ? x.outcome || null : null,
        partyId: props.partyId ?? null, leadId: props.leadId ?? null, ownerId: x.ownerId || null,
      },
    });
    toast.success(done ? 'سُجّل النشاط' : 'جُدول النشاط');
    emit('saved');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <form class="card modal cr-modal" @submit.prevent="save">
      <h2>نشاط جديد</h2>
      <div class="cr-chips" style="margin-bottom: 12px">
        <button v-for="(l, k) in lk.labels.activityTypes" :key="k" type="button" :class="['cr-chip', { on: f.type === String(k) }]" style="--c: #0891b2" @click="f.type = String(k)">{{ l }}</button>
      </div>
      <label class="field"><span>العنوان</span><input v-model="f.subject" class="input" maxlength="250" required placeholder="مثل: اتصال للتعريف بالبرامج" /></label>
      <label class="field"><span>التفاصيل (اختياري)</span><textarea v-model="f.details" class="input" rows="2" maxlength="4000" /></label>
      <template v-if="f.type !== 'note'">
        <div class="cr-chips" style="margin: 4px 0 10px">
          <button type="button" :class="['cr-chip', { on: !f.done }]" style="--c: #7c3aed" @click="f.done = false">مجدول بموعد</button>
          <button type="button" :class="['cr-chip', { on: f.done }]" style="--c: #059669" @click="f.done = true">تم الآن</button>
        </div>
        <div class="cr-fields">
          <label v-if="!f.done" class="field"><span>الموعد</span><input v-model="f.dueAt" type="datetime-local" class="input" required /></label>
          <label v-if="canAssign" class="field"><span>المسؤول</span>
            <select v-model="f.ownerId" class="input"><option v-for="u in lk.users" :key="u.id" :value="u.id">{{ u.fullName }}</option></select>
          </label>
        </div>
        <label v-if="f.done" class="field"><span>النتيجة</span><textarea v-model="f.outcome" class="input" rows="2" maxlength="2000" placeholder="ماذا تم؟ وما الاتفاق؟" /></label>
      </template>
      <div class="modal-actions">
        <button type="button" class="btn" @click="emit('close')">إلغاء</button>
        <button class="btn btn-primary" :disabled="busy">{{ f.done || f.type === 'note' ? 'تسجيل' : 'جدولة' }}</button>
      </div>
    </form>
  </div>
</template>
