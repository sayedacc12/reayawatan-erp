<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { useToast } from '../../../stores/toast';
import { lookups, setLookups } from '../lib';
import '../../../shared/module.css';
import '../crm.css';

const toast = useToast();
const tab = ref<'general' | 'lists' | 'permissions'>('general');
const lk = ref<any>(null);
const g = ref<any>(null);
const lists = ref<any>(null);
const busy = ref(false);
const SYSTEM = ['website', 'import', 'manual'];
const TOPICS = { consultation: 'طلب استشارة', booking: 'حجز جلسة تشخيص', assessment: 'تقييم الجاهزية', calculator: 'حاسبة مضاعف الأثر', guide: 'تنزيل دليل' };
const LISTS = [
  { key: 'sources', label: 'مصادر العملاء المحتملين' }, { key: 'interests', label: 'الاهتمامات' }, { key: 'disqualifyReasons', label: 'أسباب عدم التأهيل' },
] as const;

function apply(v: any) {
  lk.value = v;
  setLookups(v);
  const s = v.settings;
  g.value = { slaHours: s.slaHours, assignMode: s.assignMode, team: [...s.team], webTopics: [...(s.webTopics ?? [])], partyVisibility: s.partyVisibility };
  lists.value = { sources: s.sources.map((x: any) => ({ ...x })), interests: s.interests.map((x: any) => ({ ...x })), disqualifyReasons: s.disqualifyReasons.map((x: any) => ({ ...x })) };
}
onMounted(async () => {
  try {
    apply(await lookups(true));
  } catch (e) {
    toast.error((e as Error).message);
  }
});
async function saveGeneral() {
  busy.value = true;
  try {
    apply(await api('/crm/settings', { method: 'PUT', json: { ...g.value, slaHours: Number(g.value.slaHours) } }));
    toast.success('حُفظت الإعدادات');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function saveLists() {
  busy.value = true;
  try {
    apply(await api('/crm/settings/lists', { method: 'PUT', json: lists.value }));
    toast.success('حُفظت القوائم');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const newKey = () => `c_${Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 8) || 'item'}${Date.now().toString(36).slice(-4).replace(/[^a-z0-9]/g, '')}`;
const add = (k: string) => lists.value[k].push({ key: newKey(), label: '', isActive: true });
const toggle = (arr: string[], v: string) => {
  const i = arr.indexOf(v);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(v);
};
</script>

<template>
  <div v-if="lk && g">
    <div class="page-head">
      <div>
        <h1>إعدادات علاقات العملاء</h1>
        <p class="muted">مهلة التواصل الأول، وطريقة توزيع العملاء المحتملين على الفريق، وما يدخل من طلبات الموقع، والقوائم المرجعية.</p>
      </div>
    </div>
    <div class="pm-tabs">
      <button :class="['pm-tab', { on: tab === 'general' }]" @click="tab = 'general'">التوزيع والمهلة</button>
      <button :class="['pm-tab', { on: tab === 'lists' }]" @click="tab = 'lists'">القوائم</button>
      <button :class="['pm-tab', { on: tab === 'permissions' }]" @click="tab = 'permissions'">الصلاحيات</button>
    </div>
    <form v-if="tab === 'general'" class="card pm-panel" @submit.prevent="saveGeneral">
      <p class="cr-sec">مهلة التواصل الأول</p>
      <label class="field" style="max-width: 260px"><span>عدد الساعات من وصول العميل المحتمل</span><input v-model.number="g.slaHours" type="number" min="1" max="720" class="input" required /></label>
      <p class="cr-sec">توزيع العملاء المحتملين</p>
      <div class="cr-chips" style="margin-bottom: 10px">
        <button v-for="(l, k) in lk.labels.assignModes" :key="k" type="button" :class="['cr-chip', { on: g.assignMode === String(k) }]" style="--c: #0891b2" @click="g.assignMode = String(k)">{{ l }}</button>
      </div>
      <p class="pm-muted" style="font-size: .86rem">أعضاء فريق المبيعات{{ g.assignMode === 'round_robin' ? ' (يُوزع عليهم بالتناوب بهذا الترتيب)' : '' }}:</p>
      <div class="cr-chips">
        <button v-for="u in lk.users" :key="u.id" type="button" :class="['cr-chip', { on: g.team.includes(u.id) }]" style="--c: #7c3aed" @click="toggle(g.team, u.id)">
          {{ g.team.includes(u.id) ? `${g.team.indexOf(u.id) + 1}. ` : '' }}{{ u.fullName }}
        </button>
      </div>
      <p class="cr-sec">نماذج الموقع الإلكتروني</p>
      <p class="pm-muted" style="font-size: .86rem">طلبات النماذج المختارة تدخل عميلًا محتملًا هنا تلقائيًا، وتبقى كما هي في قائمة طلبات الموقع. وننصح بترك «تنزيل دليل» و«الحاسبة» غير مختارين إن كان أغلب أصحابها يطلبون المعرفة لا الخدمة.</p>
      <div class="cr-chips">
        <button v-for="(l, k) in TOPICS" :key="k" type="button" :class="['cr-chip', { on: g.webTopics.includes(String(k)) }]" style="--c: #059669" @click="toggle(g.webTopics, String(k))">{{ l }}</button>
      </div>
      <p class="cr-sec">من يرى الجهات</p>
      <div class="cr-chips">
        <button type="button" :class="['cr-chip', { on: g.partyVisibility === 'all' }]" style="--c: #0891b2" @click="g.partyVisibility = 'all'">كل من لديه صلاحية الاطلاع</button>
        <button type="button" :class="['cr-chip', { on: g.partyVisibility === 'own' }]" style="--c: #0891b2" @click="g.partyVisibility = 'own'">كل موظف يرى الجهات المسؤول عنها فقط</button>
      </div>
      <p class="pm-muted" style="font-size: .82rem">صاحب صلاحية «كل السجلات» يرى الجميع في الحالتين.</p>
      <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ</button></div>
    </form>
    <form v-else-if="tab === 'lists'" class="card pm-panel" @submit.prevent="saveLists">
      <template v-for="L in LISTS" :key="L.key">
        <p class="cr-sec">{{ L.label }}</p>
        <div v-for="(it, i) in lists[L.key]" :key="it.key" style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px">
          <input v-model="it.label" class="input" maxlength="120" required style="flex: 1" />
          <label style="display: flex; gap: 4px; white-space: nowrap"><input v-model="it.isActive" type="checkbox" /> فاعل</label>
          <button v-if="!(L.key === 'sources' && SYSTEM.includes(it.key))" type="button" class="btn btn-sm" title="حذف" @click="lists[L.key].splice(i, 1)">✕</button>
          <small v-else class="pm-muted" style="white-space: nowrap">يستخدمه النظام</small>
        </div>
        <button type="button" class="btn btn-sm" @click="add(L.key)">+ إضافة</button>
      </template>
      <p class="pm-muted" style="font-size: .82rem; margin-top: 12px">العنصر غير الفاعل لا يظهر في الاختيار، ويبقى على السجلات القديمة.</p>
      <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ القوائم</button></div>
    </form>
    <ModulePermissionsPane v-else module="crm" />
  </div>
</template>
