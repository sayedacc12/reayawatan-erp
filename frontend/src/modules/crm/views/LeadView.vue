<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../../../api';
import { useToast } from '../../../stores/toast';
import ActivityForm from '../components/ActivityForm.vue';
import ActivityTimeline from '../components/ActivityTimeline.vue';
import LeadForm from '../components/LeadForm.vue';
import { LEAD_COLOR, fmtDateTime, fromLocalInput, lookups, relTime, toLocalInput } from '../lib';
import '../../../shared/module.css';
import '../crm.css';

const props = defineProps<{ id: string }>();
const router = useRouter();
const toast = useToast();
const lk = ref<any>(null);
const l = ref<any>(null);
const editing = ref(false);
const addingAct = ref(false);
const lost = ref<any>(null);
const conv = ref<any>(null);
const busy = ref(false);
const tab = ref<'activities' | 'log'>('activities');

async function load() {
  try {
    [lk.value, l.value] = await Promise.all([lookups(), api(`/crm/leads/${props.id}`)]);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
watch(() => props.id, load);
const open = computed(() => ['new', 'contacted', 'qualified'].includes(l.value?.status));
const STEPS = ['new', 'contacted', 'qualified', 'converted'];
const stepClass = (s: string) => {
  if (l.value.status === 'disqualified') return 'lost';
  const i = STEPS.indexOf(l.value.status);
  const j = STEPS.indexOf(s);
  return j < i ? 'done' : j === i ? 'on' : '';
};

async function setOwner(ownerId: string) {
  try {
    await api(`/crm/leads/${props.id}/owner`, { method: 'PUT', json: { ownerId: ownerId || null } });
    toast.success(ownerId ? 'أُسند العميل المحتمل' : 'أُلغي الإسناد');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function setStatus(status: string, extra: any = {}) {
  busy.value = true;
  try {
    await api(`/crm/leads/${props.id}/status`, { method: 'POST', json: { status, ...extra } });
    lost.value = null;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
function startConvert() {
  const s = l.value.similar?.parties ?? [];
  conv.value = { mode: s.length ? 'link' : 'new', partyId: s[0]?.id ?? '', nextSubject: '', nextDueAt: toLocalInput(new Date(Date.now() + 3 * 86400_000)), dup: '', allowDuplicate: false };
}
async function convert() {
  const c = conv.value;
  busy.value = true;
  try {
    const r = await api<any>(`/crm/leads/${props.id}/convert`, {
      method: 'POST',
      json: { partyId: c.mode === 'link' ? c.partyId : null, nextSubject: c.nextSubject || null, nextDueAt: c.nextSubject ? fromLocalInput(c.nextDueAt) : null, allowDuplicate: c.allowDuplicate },
    });
    toast.success('تحول العميل المحتمل إلى جهة');
    router.push(`/crm/parties/${r.partyId}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) c.dup = e.message;
    else toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const activeReasons = computed(() => (lk.value?.settings.disqualifyReasons ?? []).filter((r: any) => r.isActive));
</script>

<template>
  <div v-if="l && lk">
    <div class="page-head">
      <div>
        <p class="pm-muted" style="margin: 0; font-size: .85rem"><span class="cr-code">{{ l.code }}</span> · {{ l.sourceLabel }}{{ l.campaign ? ` · ${l.campaign}` : '' }}</p>
        <h1 style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap">
          {{ l.name }} <small v-if="l.company" class="pm-muted" style="font-size: 1rem">{{ l.company }}</small>
          <span class="cr-chip" :style="{ '--c': LEAD_COLOR[l.status] }">{{ l.statusLabel }}</span>
          <span v-if="l.overdue" class="cr-flag">تجاوز مهلة التواصل {{ relTime(l.dueAt).replace('منذ ', '') }}</span>
        </h1>
        <p class="muted cr-ltr" style="text-align: start">{{ [l.phone, l.email].filter(Boolean).join(' · ') }}</p>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
        <select v-if="l.can.assign && open" class="input" style="width: auto" :value="l.ownerId ?? ''" @change="setOwner(($event.target as HTMLSelectElement).value)">
          <option value="">بلا مسؤول</option><option v-for="u in lk.users" :key="u.id" :value="u.id">المسؤول: {{ u.fullName }}</option>
        </select>
        <span v-else class="pm-muted">المسؤول: {{ l.ownerName ?? '—' }}</span>
        <template v-if="l.can.manage && open">
          <button class="btn" @click="editing = true">تعديل</button>
          <button class="btn btn-primary" @click="addingAct = true">+ نشاط</button>
        </template>
      </div>
    </div>

    <div class="cr-steps">
      <span v-for="s in STEPS" :key="s" :class="stepClass(s)">{{ lk.labels.leadStatus[s] }}</span>
    </div>

    <div v-if="open && (l.similar.parties.length || l.similar.leads.length)" class="cr-warn">
      <b>بيانات مشابهة مسجلة:</b>
      <div v-for="p in l.similar.parties" :key="p.id">جهة: <RouterLink :to="`/crm/parties/${p.id}`">{{ p.name }}</RouterLink> <span class="cr-code">{{ p.code }}</span>، فقد يكون التحويل ربطًا بها.</div>
      <div v-for="x in l.similar.leads" :key="x.id">عميل محتمل آخر: <RouterLink :to="`/crm/leads/${x.id}`">{{ x.name }}</RouterLink> <span class="cr-code">{{ x.code }}</span> ({{ x.statusLabel }})</div>
    </div>
    <div v-if="l.status === 'converted' && l.party" class="cr-warn" style="border-color: #6ee7b7; background: #ecfdf5; color: #065f46">
      تحول إلى الجهة <RouterLink :to="`/crm/parties/${l.party.id}`">{{ l.party.name }}</RouterLink> <span class="cr-code">{{ l.party.code }}</span> في {{ fmtDateTime(l.convertedAt) }}، والمتابعة من ملفها.
    </div>
    <div v-if="l.status === 'disqualified'" class="cr-warn" style="border-color: #cbd5e1; background: #f8fafc; color: #334155">
      غير مؤهل: <b>{{ l.reasonLabel }}</b>{{ l.disqualifyNote ? `، ${l.disqualifyNote}` : '' }}
      <button v-if="l.can.manage" class="btn btn-sm" style="margin-inline-start: 8px" :disabled="busy" @click="setStatus('new')">إعادة فتح</button>
    </div>

    <div v-if="l.can.manage && open" class="card pm-panel" style="margin-bottom: 16px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
      <b style="margin-inline-end: 6px">الخطوة التالية:</b>
      <button v-if="l.status === 'new'" class="btn" :disabled="busy" @click="setStatus('contacted')">تم التواصل</button>
      <button v-if="l.status !== 'qualified'" class="btn" :disabled="busy" @click="setStatus('qualified')">مؤهل (مهتم فعلًا)</button>
      <button class="btn btn-primary" :disabled="busy" @click="startConvert">تحويل إلى جهة</button>
      <button class="btn" :disabled="busy" @click="lost = { reason: activeReasons[0]?.key ?? '', note: '' }">غير مؤهل</button>
      <small class="pm-muted">تسجيل مكالمة أو رسالة منجزة يُسجل أول تواصل تلقائيًا.</small>
    </div>

    <div class="cr-grid">
      <section class="card pm-panel">
        <div class="pm-tabs">
          <button :class="['pm-tab', { on: tab === 'activities' }]" @click="tab = 'activities'">الأنشطة</button>
          <button :class="['pm-tab', { on: tab === 'log' }]" @click="tab = 'log'">السجل</button>
        </div>
        <ActivityTimeline v-if="tab === 'activities'" :items="l.activities" :lk="lk" :can-manage="l.can.manage && open" @changed="load" />
        <div v-else class="cr-timeline">
          <div v-for="(e, i) in [...l.log].reverse()" :key="i" class="cr-act" style="--c: #64748b">
            <span class="ic">•</span>
            <div><h4>{{ e.action }}</h4><p v-if="e.note">{{ e.note }}</p><div class="meta">{{ e.byName }} · {{ fmtDateTime(e.at) }}</div></div>
          </div>
        </div>
      </section>
      <section class="card pm-panel">
        <h2>البيانات</h2>
        <dl class="cr-kv">
          <dt>المسمى</dt><dd>{{ l.title ?? '—' }}</dd>
          <dt>المدينة</dt><dd>{{ l.city ?? '—' }}</dd>
          <dt>الاهتمام</dt><dd>{{ l.interestLabel ?? '—' }}</dd>
          <dt>وصل</dt><dd>{{ fmtDateTime(l.createdAt) }} · {{ l.createdByName }}</dd>
          <dt>مهلة التواصل</dt><dd>{{ fmtDateTime(l.dueAt) }}</dd>
          <dt>أول تواصل</dt><dd>{{ l.firstContactAt ? fmtDateTime(l.firstContactAt) : '—' }}</dd>
        </dl>
        <template v-if="l.message"><p class="cr-sec">رسالته</p><p style="white-space: pre-line; font-size: .9rem">{{ l.message }}</p></template>
      </section>
    </div>

    <LeadForm v-if="editing" :lk="lk" :lead="l" @close="editing = false" @saved="editing = false; load()" />
    <ActivityForm v-if="addingAct" :lk="lk" :lead-id="l.id" :default-done="true" @close="addingAct = false" @saved="addingAct = false; load()" />

    <div v-if="lost" class="modal-backdrop" @click.self="lost = null">
      <form class="card modal cr-modal" @submit.prevent="setStatus('disqualified', { reason: lost.reason, note: lost.note || null })">
        <h2>غير مؤهل</h2>
        <label class="field"><span>السبب</span><select v-model="lost.reason" class="input" required><option v-for="r in activeReasons" :key="r.key" :value="r.key">{{ r.label }}</option></select></label>
        <label class="field"><span>ملاحظة (اختياري)</span><textarea v-model="lost.note" class="input" rows="2" maxlength="1000" /></label>
        <div class="modal-actions"><button type="button" class="btn" @click="lost = null">إلغاء</button><button class="btn btn-primary" :disabled="busy">حفظ</button></div>
      </form>
    </div>

    <div v-if="conv" class="modal-backdrop" @click.self="conv = null">
      <form class="card modal cr-modal" @submit.prevent="convert">
        <h2>تحويل إلى جهة</h2>
        <div class="cr-chips" style="margin-bottom: 12px">
          <button type="button" :class="['cr-chip', { on: conv.mode === 'new' }]" style="--c: #0891b2" @click="conv.mode = 'new'">جهة جديدة</button>
          <button type="button" :class="['cr-chip', { on: conv.mode === 'link' }]" style="--c: #7c3aed" :disabled="!l.similar.parties.length" @click="conv.mode = 'link'">ربطه بجهة موجودة</button>
        </div>
        <p v-if="conv.mode === 'new'" class="pm-muted" style="font-size: .86rem">
          {{ l.company ? `تُنشأ منشأة «${l.company}»، ويصبح ${l.name} شخص الاتصال الرئيسي فيها.` : `يُنشأ ملف شخص باسم «${l.name}».` }} تنتقل أنشطته إلى ملف الجهة.
        </p>
        <label v-else class="field"><span>الجهة</span>
          <select v-model="conv.partyId" class="input" required><option v-for="p in l.similar.parties" :key="p.id" :value="p.id">{{ p.name }} ({{ p.code }})</option></select>
        </label>
        <p class="cr-sec">نشاط المتابعة التالي (اختياري)</p>
        <div class="cr-fields">
          <label class="field"><span>المهمة</span><input v-model="conv.nextSubject" class="input" maxlength="250" placeholder="مثل: إرسال عرض الشراكة" /></label>
          <label v-if="conv.nextSubject" class="field"><span>الموعد</span><input v-model="conv.nextDueAt" type="datetime-local" class="input" required /></label>
        </div>
        <div v-if="conv.dup" class="cr-warn">
          {{ conv.dup }}
          <label style="display: flex; gap: 6px; margin-top: 6px"><input v-model="conv.allowDuplicate" type="checkbox" /> أؤكد إنشاء جهة جديدة مختلفة</label>
        </div>
        <div class="modal-actions"><button type="button" class="btn" @click="conv = null">إلغاء</button><button class="btn btn-primary" :disabled="busy">تحويل</button></div>
      </form>
    </div>
  </div>
</template>
