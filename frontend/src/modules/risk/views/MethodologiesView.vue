
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { DOMAINS, fmtDate, fmtDateTime, P, todayStr } from '../lib';
import '../../../shared/module.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const toast = useToast();
const data = ref<{ installed: boolean; items: any[] } | null>(null);
const sel = ref<string | null>(null);
const shown = ref<any>(null);
const atDate = ref(todayStr());
const canEdit = computed(() => session.can(P.methodologies));
const item = computed(() => data.value?.items.find((m) => m.id === sel.value) ?? null);
const edit = reactive({ show: false, body: '', effectiveDate: todayStr(), approvedBy: '', note: '' });
const add = reactive({ show: false, name: '', domain: 'risk', reference: '', body: '', effectiveDate: todayStr(), approvedBy: '' });
function take(d: any) {
  data.value = d;
  if (!sel.value || !d.items.some((m: any) => m.id === sel.value)) sel.value = d.items[0]?.id ?? null;
  shown.value = item.value?.current ?? null;
}
onMounted(async () => take(await api('/risk/methodologies')));
function pick(id: string) {
  sel.value = id;
  shown.value = item.value?.current ?? null;
  edit.show = false;
}
async function run(fn: () => Promise<unknown>, msg: string) {
  try {
    take(await fn());
    toast.success(msg);
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  }
}
const install = () => run(() => api('/risk/methodologies/install', { method: 'POST', json: {} }), 'نُصّبت المنهجيات المقترحة كإصدار أول');
function startEdit() {
  Object.assign(edit, { show: true, body: item.value.current?.body ?? '', effectiveDate: todayStr(), approvedBy: '', note: '' });
}
async function saveVersion() {
  const ok = await run(() => api(`/risk/methodologies/${sel.value}/versions`, { method: 'POST', json: { body: edit.body, effectiveDate: edit.effectiveDate, approvedBy: edit.approvedBy || null, note: edit.note } }), 'اعتُمد إصدار جديد من المنهجية');
  if (ok) edit.show = false;
}
async function create() {
  const ok = await run(() => api('/risk/methodologies', { method: 'POST', json: { ...add, reference: add.reference || null, approvedBy: add.approvedBy || null } }), 'أُضيفت المنهجية');
  if (ok) {
    add.show = false;
    sel.value = data.value!.items[data.value!.items.length - 1]?.id ?? null;
    shown.value = item.value?.current ?? null;
  }
}
async function toggle() {
  const m = item.value;
  await run(() => api(`/risk/methodologies/${m.id}`, { method: 'PATCH', json: { name: m.name, domain: m.domain, reference: m.reference, isActive: !m.isActive } }), m.isActive ? 'أُوقف العمل بالمنهجية' : 'أُعيد تفعيل المنهجية');
}
async function openVersion(id: string) {
  try { shown.value = await api(`/risk/methodologies/versions/${id}`); } catch (e) { toast.error((e as Error).message); }
}
async function openAt() {
  try {
    shown.value = await api(`/risk/methodologies/${sel.value}/at?date=${atDate.value}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div v-if="data">
    <section class="pm-hero rk-hero">
      <div><p class="pm-kicker">سجل المنهجيات المعتمدة</p><h1>منهجيات المخاطر والاستمرارية والتغيير</h1>
        <p class="pm-sub">لكل منهجية سجل إصدارات بتاريخ سريان وجهة اعتماد وملخص للتعديل. يمكن الرجوع لأي إصدار سابق، أو معرفة المنهجية التي كانت سارية في أي تاريخ (مفيد للمراجعة الداخلية).</p></div>
      <div v-if="canEdit" class="pm-actions">
        <button v-if="!data.installed" class="btn rk-glow" @click="install">تنصيب المنهجيات المقترحة</button>
        <button class="btn rk-ghost" @click="add.show = true">منهجية جديدة</button>
      </div>
    </section>
    <p v-if="!data.items.length" class="pm-empty card">لا توجد منهجيات بعد. نصّب المنهجيات المقترحة من النظام (إدارة المخاطر، استمرارية الأعمال، إدارة التغيير، الالتزام، هندسة الإجراءات) ثم عدّلها كما تشاء.</p>
    <div v-else class="rk-grid" style="grid-template-columns: 300px 1fr">
      <section class="card pm-panel" style="align-self: start">
        <h2>المنهجيات</h2>
        <button v-for="m in data.items" :key="m.id" :class="['rk-tab', { on: sel === m.id }]" style="display: block; width: 100%; text-align: start; border-radius: 12px; margin-bottom: 6px; opacity: 1" @click="pick(m.id)">
          <span class="rk-code" :style="{ color: sel === m.id ? '#fff' : '' }">{{ m.code }}</span> {{ m.name }}
          <small style="display: block; opacity: .75">{{ DOMAINS[m.domain] }} · الإصدار {{ m.current?.version ?? '—' }}{{ m.isActive ? '' : ' · موقوفة' }}</small>
        </button>
      </section>
      <div v-if="item" style="display: grid; gap: 16px; align-content: start; min-width: 0">
        <section class="card pm-panel">
          <h2>
            <span><span class="rk-code">{{ item.code }}</span> {{ item.name }}</span>
            <span v-if="canEdit" style="display: flex; gap: 6px">
              <button v-if="!edit.show" class="btn btn-sm btn-primary" @click="startEdit">إصدار جديد</button>
              <button class="btn btn-sm" @click="toggle">{{ item.isActive ? 'إيقاف' : 'تفعيل' }}</button>
            </span>
          </h2>
          <p class="pm-muted">{{ DOMAINS[item.domain] }}<template v-if="item.reference"> · المرجع: {{ item.reference }}</template></p>
          <template v-if="edit.show">
            <label class="field"><span>نص المنهجية (الإصدار {{ (item.current?.version ?? 0) + 1 }})</span><textarea v-model="edit.body" class="input" rows="18" style="line-height: 1.9" /></label>
            <div class="rk-fields">
              <label class="field"><span>تاريخ السريان</span><input v-model="edit.effectiveDate" type="date" class="input" /></label>
              <label class="field"><span>جهة الاعتماد</span><input v-model="edit.approvedBy" class="input" /></label>
            </div>
            <label class="field"><span>ملخص التعديل</span><input v-model="edit.note" class="input" /></label>
            <div class="modal-actions"><button class="btn btn-primary" @click="saveVersion">اعتماد الإصدار</button><button class="btn" @click="edit.show = false">إلغاء</button></div>
          </template>
          <template v-else-if="shown">
            <div :class="shown.id === item.current?.id ? 'rk-note' : 'rk-warn'" style="margin-bottom: 12px">
              الإصدار {{ shown.version }} · سارٍ من {{ fmtDate(shown.effectiveDate) }}<template v-if="shown.approvedBy"> · اعتمده {{ shown.approvedBy }}</template>
              <template v-if="shown.id !== item.current?.id"> · <b>إصدار سابق</b> <button class="btn btn-sm" @click="shown = item.current">عرض الحالي</button></template>
            </div>
            <p class="rk-pre">{{ shown.body }}</p>
          </template>
        </section>
        <section class="card pm-panel">
          <h2>سجل الإصدارات</h2>
          <div style="display: flex; gap: 6px; align-items: end; margin-bottom: 10px; flex-wrap: wrap">
            <label class="field" style="margin: 0"><span>المنهجية السارية في تاريخ</span><input v-model="atDate" type="date" class="input" /></label>
            <button class="btn btn-sm" @click="openAt">عرض</button>
          </div>
          <table class="table">
            <thead><tr><th>الإصدار</th><th>السريان</th><th>جهة الاعتماد</th><th>ملخص التعديل</th><th>حفظه</th><th /></tr></thead>
            <tbody><tr v-for="h in item.history" :key="h.id" :style="{ background: shown?.id === h.id ? 'var(--surface-2)' : '' }">
              <td><b>{{ h.version }}</b></td><td>{{ fmtDate(h.effectiveDate) }}</td><td>{{ h.approvedBy ?? '—' }}</td><td style="white-space: normal">{{ h.note }}</td>
              <td>{{ h.createdByName }}<br /><span class="pm-muted">{{ fmtDateTime(h.createdAt) }}</span></td>
              <td><button class="btn btn-sm" @click="openVersion(h.id)">عرض</button></td>
            </tr></tbody>
          </table>
        </section>
      </div>
    </div>
    <div v-if="add.show" class="modal-backdrop" @click.self="add.show = false">
      <form class="card modal" style="max-width: 760px" @submit.prevent="create">
        <h2>منهجية جديدة</h2>
        <label class="field"><span>الاسم</span><input v-model="add.name" class="input" /></label>
        <div class="rk-fields">
          <label class="field"><span>المجال</span><select v-model="add.domain" class="input"><option v-for="(l, k) in DOMAINS" :key="k" :value="k">{{ l }}</option></select></label>
          <label class="field"><span>المرجع (مثل ISO 31000)</span><input v-model="add.reference" class="input" /></label>
          <label class="field"><span>تاريخ السريان</span><input v-model="add.effectiveDate" type="date" class="input" /></label>
          <label class="field"><span>جهة الاعتماد</span><input v-model="add.approvedBy" class="input" /></label>
        </div>
        <label class="field"><span>نص المنهجية</span><textarea v-model="add.body" class="input" rows="10" /></label>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="add.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
