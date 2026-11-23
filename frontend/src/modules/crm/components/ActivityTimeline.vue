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
/** ينجزه ويحذفه المسؤول عنه أو منشئه أو مدير المبيعات. والمتابع يطّلع فقط */
const mine = (a: any) => !a.following && (props.lk.can.all || a.ownerId === props.lk.me || a.createdById === props.lk.me);
const editing = ref<{ a: any; ids: string[] } | null>(null);
const toggle = (id: string) => {
  const e = editing.value!;
  e.ids = e.ids.includes(id) ? e.ids.filter((x) => x !== id) : [...e.ids, id];
};
async function saveFollowers() {
  const e = editing.value!;
  busy.value = true;
  try {
    await api(`/crm/activities/${e.a.id}/followers`, { method: 'PUT', json: { userIds: e.ids } });
    toast.success('حُفظ المتابعون');
    editing.value = null;
    emit('changed');
  } catch (err) {
    toast.error((err as Error).message);
  } finally {
    busy.value = false;
  }
}

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
          <p v-if="a.audienceLabel">
            <span class="cr-chip" style="--c: #b45309">{{ a.audienceLabel }}</span>
            <template v-if="showTarget && a.parties?.length">
              <template v-for="(p, i) in a.parties" :key="p.id">{{ i ? '، ' : ' ' }}<RouterLink class="pm-link" :to="`/crm/parties/${p.id}`">{{ p.name }}</RouterLink></template>
              <template v-if="a.partyCount > a.parties.length"> وغيرها</template>
            </template>
          </p>
          <p v-if="a.details">{{ a.details }}</p>
          <p v-if="a.outcome"><b>النتيجة:</b> {{ a.outcome }}</p>
          <div class="meta">
            <template v-if="a.doneAt">نُفّذ {{ fmtDateTime(a.doneAt) }}</template>
            <template v-else-if="a.dueAt">موعده {{ fmtDateTime(a.dueAt) }} ({{ relTime(a.dueAt) }})</template>
            · {{ a.ownerName ?? a.createdByName }}
            <template v-if="a.followers?.length"> · المتابعون: {{ a.followers.map((x: any) => x.name).join('، ') }}</template>
            <span v-if="a.following" class="cr-chip" style="--c: #0e7490">متابع للاطلاع</span>
          </div>
          <div v-if="canManage && !a.doneAt && mine(a)" class="tools">
            <button class="btn btn-sm btn-primary" @click="start(a)">إنجاز</button>
            <button class="btn btn-sm" @click="remove(a)">حذف</button>
            <button v-if="a.followers" class="btn btn-sm" @click="editing = { a, ids: a.followers.map((x: any) => x.id) }">المتابعون</button>
          </div>
        </div>
      </div>
    </div>
    <div v-if="editing" class="modal-backdrop" @click.self="editing = null">
      <form class="card modal cr-modal" @submit.prevent="saveFollowers">
        <h2>متابعو: {{ editing.a.subject }}</h2>
        <p class="muted">يرى المتابع النشاط في قائمته للاطلاع فقط، ولا ينجزه ولا يحذفه.</p>
        <div class="cr-chips">
          <button v-for="u in lk.users.filter((x: any) => x.id !== editing!.a.ownerId)" :key="u.id" type="button" :class="['cr-chip', { on: editing.ids.includes(u.id) }]" style="--c: #0e7490" @click="toggle(u.id)">{{ u.fullName }}</button>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" @click="editing = null">إلغاء</button>
          <button class="btn btn-primary" :disabled="busy">حفظ</button>
        </div>
      </form>
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
