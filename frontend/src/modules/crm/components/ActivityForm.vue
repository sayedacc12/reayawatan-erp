<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, ref, watch } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { fromLocalInput, toLocalInput } from '../lib';

/**
 * تسجيل نشاط: منجز الآن (مكالمة تمت، ملاحظة) أو مجدول بموعد (مكالمة قادمة، زيارة، مهمة).
 * من شاشة الأنشطة يُربط النشاط بعميل واحد أو عدة عملاء أو كل العملاء، ويُسند لأي زميل، ويُضاف له متابعون للاطلاع فقط.
 */
const props = defineProps<{ lk: any; partyId?: string | null; leadId?: string | null; defaultDone?: boolean }>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'close'): void }>();
const toast = useToast();
const busy = ref(false);
const inHour = new Date(Date.now() + 3600_000);
const f = ref({ type: 'call', subject: '', details: '', done: props.defaultDone ?? false, dueAt: toLocalInput(inHour), outcome: '', ownerId: props.lk.me as string });

// ---------- الربط بالعملاء (فقط حين لا يُفتح النموذج من ملف جهة أو عميل محتمل) ----------
const fixed = !!(props.partyId || props.leadId);
const target = ref<'none' | 'pick' | 'all'>('none');
const picked = ref<{ id: string; name: string; code: string }[]>([]);
const term = ref('');
const results = ref<any[]>([]);
const role = ref('customer');
const allCount = ref<number | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

watch(term, (v) => {
  clearTimeout(timer);
  if (v.trim().length < 2) {
    results.value = [];
    return;
  }
  timer = setTimeout(async () => {
    try {
      const rows: any[] = await api(`/crm/parties?${new URLSearchParams({ q: v.trim() })}`);
      results.value = rows.filter((r) => !picked.value.some((p) => p.id === r.id)).slice(0, 8);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, 250);
});
function pick(r: any) {
  picked.value.push({ id: r.id, name: r.name, code: r.code });
  term.value = '';
  results.value = [];
}
const unpick = (id: string) => (picked.value = picked.value.filter((p) => p.id !== id));

/** عدد الجهات في «الكل» للتنبيه قبل الحفظ (ما يراه الموظف فقط) */
async function countAll() {
  allCount.value = null;
  try {
    const rows: any[] = await api(`/crm/parties?${new URLSearchParams(role.value ? { role: role.value } : {})}`);
    allCount.value = rows.length;
  } catch {
    allCount.value = null;
  }
}
watch([target, role], () => {
  if (target.value === 'all') countAll();
});
const allLabel = computed(() => (role.value === 'customer' ? 'العملاء' : role.value ? props.lk.labels.roles[role.value] : 'الجهات'));

// ---------- المتابعون ----------
const followers = ref<string[]>([]);
const others = computed(() => (props.lk.users as { id: string; fullName: string }[]).filter((u) => u.id !== f.value.ownerId));
const toggleFollower = (id: string) => (followers.value = followers.value.includes(id) ? followers.value.filter((x) => x !== id) : [...followers.value, id]);
watch(() => f.value.ownerId, (o) => (followers.value = followers.value.filter((x) => x !== o)));

async function save() {
  const x = f.value;
  if (target.value === 'pick' && !picked.value.length) {
    toast.error('اختر عميلًا واحدًا على الأقل، أو غيّر طريقة الربط');
    return;
  }
  if (target.value === 'all' && !confirm(`سيُربط النشاط بكل ${allLabel.value}${allCount.value !== null ? ` (${allCount.value})` : ''}. متابعة؟`)) return;
  busy.value = true;
  try {
    const done = x.done || x.type === 'note';
    const link = fixed
      ? { partyId: props.partyId ?? null, leadId: props.leadId ?? null }
      : target.value === 'pick' ? { partyIds: picked.value.map((p) => p.id) }
      : target.value === 'all' ? { allParties: true, audienceRole: role.value || null } : {};
    const r: any = await api('/crm/activities', {
      method: 'POST',
      json: {
        type: x.type, subject: x.subject, details: x.details || null, done, dueAt: done ? null : fromLocalInput(x.dueAt), outcome: done ? x.outcome || null : null,
        ...link, ownerId: x.ownerId || null, followerIds: followers.value,
      },
    });
    const note = r.parties > 1 ? ` مع ${r.parties} جهة` : '';
    const skipped = r.excluded ? `، واستُبعد ${r.excluded} طلبوا عدم التواصل` : '';
    toast.success(`${done ? 'سُجّل النشاط' : 'جُدول النشاط'}${note}${skipped}`);
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

      <template v-if="!fixed">
        <p class="cr-sec">مرتبط بـ</p>
        <div class="cr-chips" style="margin-bottom: 10px">
          <button type="button" :class="['cr-chip', { on: target === 'none' }]" style="--c: #64748b" @click="target = 'none'">بلا ربط</button>
          <button type="button" :class="['cr-chip', { on: target === 'pick' }]" style="--c: #0369a1" @click="target = 'pick'">عميل أو أكثر</button>
          <button type="button" :class="['cr-chip', { on: target === 'all' }]" style="--c: #b45309" @click="target = 'all'">الكل</button>
        </div>
        <div v-if="target === 'pick'" class="field">
          <div v-if="picked.length" class="cr-chips" style="margin-bottom: 8px">
            <span v-for="p in picked" :key="p.id" class="cr-chip" style="--c: #0369a1">
              {{ p.name }} <button type="button" class="cr-x" :aria-label="`إزالة ${p.name}`" @click="unpick(p.id)">×</button>
            </span>
          </div>
          <input v-model="term" class="input" placeholder="ابحث بالاسم أو الجوال أو البريد، ثم اختر" />
          <div v-if="results.length" class="cr-picklist">
            <button v-for="r in results" :key="r.id" type="button" @click="pick(r)">{{ r.name }} <small class="muted">{{ r.code }}{{ r.phone ? ` · ${r.phone}` : '' }}</small></button>
          </div>
        </div>
        <div v-else-if="target === 'all'" class="cr-fields">
          <label class="field"><span>الفئة</span>
            <select v-model="role" class="input">
              <option value="customer">كل العملاء</option>
              <option value="">كل الجهات</option>
              <template v-for="(l, k) in lk.labels.roles" :key="k"><option v-if="String(k) !== 'customer'" :value="k">الكل: {{ l }}</option></template>
            </select>
          </label>
          <p class="muted" style="align-self: end">
            {{ allCount === null ? '…' : `${allCount} جهة في نطاقك` }}. تُحفظ القائمة كما هي الآن، ومن طلب عدم التواصل لا يدخل في المكالمات والرسائل.
          </p>
        </div>
      </template>

      <template v-if="f.type !== 'note'">
        <div class="cr-chips" style="margin: 4px 0 10px">
          <button type="button" :class="['cr-chip', { on: !f.done }]" style="--c: #7c3aed" @click="f.done = false">مجدول بموعد</button>
          <button type="button" :class="['cr-chip', { on: f.done }]" style="--c: #059669" @click="f.done = true">تم الآن</button>
        </div>
        <div class="cr-fields">
          <label v-if="!f.done" class="field"><span>الموعد</span><input v-model="f.dueAt" type="datetime-local" class="input" required /></label>
          <label class="field"><span>المسؤول عن التنفيذ</span>
            <select v-model="f.ownerId" class="input"><option v-for="u in lk.users" :key="u.id" :value="u.id">{{ u.fullName }}{{ u.id === lk.me ? ' (أنا)' : '' }}</option></select>
          </label>
        </div>
        <label v-if="f.done" class="field"><span>النتيجة</span><textarea v-model="f.outcome" class="input" rows="2" maxlength="2000" placeholder="ماذا تم؟ وما الاتفاق؟" /></label>
      </template>

      <div v-if="others.length" class="field">
        <span>المتابعون (للاطلاع فقط، دون إنجاز أو تعديل)</span>
        <div class="cr-chips">
          <button v-for="u in others" :key="u.id" type="button" :class="['cr-chip', { on: followers.includes(u.id) }]" style="--c: #0e7490" @click="toggleFollower(u.id)">{{ u.fullName }}</button>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" @click="emit('close')">إلغاء</button>
        <button class="btn btn-primary" :disabled="busy">{{ f.done || f.type === 'note' ? 'تسجيل' : 'جدولة' }}</button>
      </div>
    </form>
  </div>
</template>
