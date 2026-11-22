<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, ref, watch } from 'vue';
import { api, ApiError } from '../../../api';
import { useToast } from '../../../stores/toast';
import { MATCH_LABEL } from '../lib';

/** إضافة جهة أو تعديلها، مع فحص فوري للمكرر بالجوال والبريد والرقم الضريبي والاسم */
const props = defineProps<{ lk: any; party?: any }>();
const emit = defineEmits<{ (e: 'saved', v: { id: string }): void; (e: 'close'): void }>();
const toast = useToast();
const busy = ref(false);
const p = props.party;
const f = ref({
  kind: p?.kind ?? 'org', name: p?.name ?? '', phone: p?.phone ?? '', email: p?.email ?? '', city: p?.city ?? '', vatNumber: p?.vatNumber ?? '', crNumber: p?.crNumber ?? '',
  source: p?.source ?? '', tags: (p?.tags ?? []).join('، '), notes: p?.notes ?? '',
});
const similar = ref<any[]>([]);
const hidden = ref(0);
const confirmDup = ref(false);
const strong = computed(() => hidden.value > 0 || similar.value.some((s) => s.matchedBy !== 'name'));
const sources = computed(() => props.lk.settings.sources.filter((i: any) => i.isActive || i.key === f.value.source));

let t: ReturnType<typeof setTimeout>;
watch(() => [f.value.name, f.value.phone, f.value.email, f.value.vatNumber], () => {
  clearTimeout(t);
  confirmDup.value = false;
  t = setTimeout(check, 400);
});
async function check() {
  const x = f.value;
  const q = new URLSearchParams(Object.entries({ name: x.name, phone: x.phone, email: x.email, vat: x.vatNumber, exclude: p?.id ?? '' }).filter(([, v]) => v) as [string, string][]);
  if (![...q.keys()].some((k) => k !== 'exclude')) {
    similar.value = [];
    hidden.value = 0;
    return;
  }
  try {
    const r = await api<any>(`/crm/parties/check?${q}`);
    similar.value = r.parties;
    hidden.value = r.hiddenParties ?? 0;
  } catch {
    similar.value = [];
    hidden.value = 0;
  }
}

async function save() {
  busy.value = true;
  try {
    const x = f.value;
    const json = {
      kind: x.kind, name: x.name, phone: x.phone || null, email: x.email || null, city: x.city || null, vatNumber: x.vatNumber || null, crNumber: x.crNumber || null,
      source: x.source || null, tags: [...new Set(String(x.tags).split(/[،,]/).map((s) => s.trim()).filter(Boolean))].slice(0, 20), notes: x.notes || null,
      allowDuplicate: confirmDup.value,
    };
    const r = p ? await api<any>(`/crm/parties/${p.id}`, { method: 'PUT', json }) : await api<any>('/crm/parties', { method: 'POST', json });
    toast.success(p ? 'حُفظت التعديلات' : 'أُضيفت الجهة');
    emit('saved', { id: p?.id ?? r.id });
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      toast.error(e.message);
      await check();
    } else toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <form class="card modal cr-modal" @submit.prevent="save">
      <h2>{{ party ? 'تعديل بيانات الجهة' : 'جهة جديدة' }}</h2>
      <div class="cr-chips" style="margin-bottom: 12px">
        <button v-for="(l, k) in lk.labels.kinds" :key="k" type="button" :class="['cr-chip', { on: f.kind === String(k) }]" style="--c: #0891b2" @click="f.kind = String(k)">{{ l }}</button>
      </div>
      <div class="cr-fields">
        <label class="field"><span>{{ f.kind === 'org' ? 'اسم المنشأة' : 'الاسم' }}</span><input v-model="f.name" class="input" maxlength="250" required /></label>
        <label class="field"><span>الجوال</span><input v-model="f.phone" class="input" maxlength="20" dir="ltr" /></label>
        <label class="field"><span>البريد الإلكتروني</span><input v-model="f.email" type="email" class="input" maxlength="200" dir="ltr" /></label>
        <label class="field"><span>المدينة</span><input v-model="f.city" class="input" maxlength="100" /></label>
        <template v-if="f.kind === 'org'">
          <label class="field"><span>الرقم الضريبي</span><input v-model="f.vatNumber" class="input" maxlength="15" dir="ltr" placeholder="3xxxxxxxxxxxxx3" /></label>
          <label class="field"><span>السجل التجاري</span><input v-model="f.crNumber" class="input" maxlength="40" dir="ltr" /></label>
        </template>
        <label class="field"><span>المصدر</span><select v-model="f.source" class="input"><option value="">—</option><option v-for="s in sources" :key="s.key" :value="s.key">{{ s.label }}</option></select></label>
        <label class="field"><span>الوسوم (افصل بينها بفاصلة)</span><input v-model="f.tags" class="input" maxlength="400" placeholder="مثل: عملاء رئيسيون، القطاع الصحي" /></label>
      </div>
      <label class="field"><span>ملاحظات</span><textarea v-model="f.notes" class="input" rows="2" maxlength="2000" /></label>
      <div v-if="similar.length || hidden" class="cr-warn">
        <b>جهات مشابهة مسجلة:</b>
        <div v-if="hidden" style="margin-top: 4px">توجد {{ hidden }} جهة مطابقة خارج نطاق صلاحيتك. راجع مدير المبيعات قبل الإضافة.</div>
        <div v-for="s in similar" :key="s.id" style="margin-top: 4px">
          <RouterLink :to="`/crm/parties/${s.id}`" target="_blank">{{ s.name }}</RouterLink> <span class="cr-code">{{ s.code }}</span> · تطابق {{ MATCH_LABEL[s.matchedBy] }}
        </div>
        <label v-if="strong" style="display: flex; gap: 6px; margin-top: 8px"><input v-model="confirmDup" type="checkbox" /> راجعتها، وأؤكد أن هذه جهة مختلفة</label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" @click="emit('close')">إلغاء</button>
        <button class="btn btn-primary" :disabled="busy || (strong && !confirmDup)">حفظ</button>
      </div>
    </form>
  </div>
</template>
