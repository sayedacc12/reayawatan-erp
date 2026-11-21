<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import WarehouseForm from '../components/WarehouseForm.vue';
import { PR, accLabel, fmtDateTime, lookups } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const w = ref<any>(null);
const all = ref<any[]>([]);
const lk = ref<any>(null);
const editing = ref(false);
const loc = ref<any>(null);
const busy = ref(false);
const can = computed(() => session.can(PR.warehouses));
async function load() {
  try {
    [w.value, all.value, lk.value] = await Promise.all([api(`/procurement/warehouses/${props.id}`), api<any[]>('/procurement/warehouses'), lookups()]);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
watch(() => props.id, load);
const openLoc = (l?: any) => {
  loc.value = l ? { ...l, parentId: l.parentId ?? '', capacity: l.capacity ?? '' } : { code: '', name: '', kind: 'shelf', purpose: 'storage', parentId: '', capacity: '', isActive: true };
};
async function saveLoc() {
  const l = loc.value;
  const body = { code: l.code, name: l.name, kind: l.kind, purpose: l.purpose, parentId: l.parentId || null, capacity: l.capacity || null, isActive: l.isActive };
  busy.value = true;
  try {
    if (l.id) await api(`/procurement/warehouses/${props.id}/locations/${l.id}`, { method: 'PUT', json: body });
    else await api(`/procurement/warehouses/${props.id}/locations`, { method: 'POST', json: body });
    toast.success('حُفظ الموقع');
    loc.value = null;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function removeLoc(l: any) {
  if (!confirm(`حذف الموقع ${l.label}؟`)) return;
  try {
    await api(`/procurement/warehouses/${props.id}/locations/${l.id}`, { method: 'DELETE' });
    toast.success('حُذف الموقع');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const PURPOSE_C: Record<string, string> = { storage: '#0f766e', receiving: '#0369a1', quarantine: '#d97706', damaged: '#dc2626', returns: '#7c3aed' };
</script>

<template>
  <div v-if="w">
    <div class="page-head">
      <div><h1>{{ w.name }}</h1><p class="muted"><span class="pc-code">{{ w.code }}</span> · {{ w.kindLabel }} <span v-if="!w.isActive" class="pc-flag">موقوف</span></p></div>
      <button v-if="can" class="btn" @click="editing = true">تعديل</button>
    </div>
    <div class="pc-grid">
      <section class="card pm-panel">
        <h2>البيانات</h2>
        <dl class="pc-dl">
          <div><dt>يتبع</dt><dd>{{ w.parentName ?? '—' }}</dd></div>
          <div><dt>الإدارة أو الفرع</dt><dd>{{ w.unitName ?? '—' }}</dd></div>
          <div><dt>المشروع</dt><dd>{{ w.projectName ?? '—' }}</dd></div>
          <div><dt>المدينة</dt><dd>{{ w.city ?? '—' }}</dd></div>
          <div><dt>السعة</dt><dd>{{ w.capacity ?? '—' }}</dd></div>
          <div><dt>حساب المخزون</dt><dd>{{ accLabel(w.glAccount) }}</dd></div>
          <div><dt>الأمناء</dt><dd>{{ w.keepers.map((k: any) => k.name).join('، ') || '—' }}</dd></div>
          <div><dt>العنوان</dt><dd>{{ w.address ?? '—' }}</dd></div>
        </dl>
        <p v-if="w.notes" class="pm-muted" style="margin: 12px 0 0">{{ w.notes }}</p>
      </section>
      <section class="card pm-panel">
        <h2>السجل</h2>
        <ul class="pc-log"><li v-for="(l, k) in [...(w.log ?? [])].reverse()" :key="k"><div><b>{{ l.action }}</b> <span v-if="l.note">· {{ l.note }}</span><small>{{ l.byName }} · {{ fmtDateTime(l.at) }}</small></div></li></ul>
      </section>
      <section class="card pm-panel wide">
        <h2>مواقع التخزين <button v-if="can" class="btn btn-sm" @click="openLoc()">+ موقع</button></h2>
        <table class="table">
          <thead><tr><th>الموقع</th><th>الاسم</th><th>النوع</th><th>الغرض</th><th>السعة</th><th /></tr></thead>
          <tbody>
            <tr v-for="l in w.locationsList" :key="l.id" :class="{ 'pc-row': true, off: !l.isActive }">
              <td class="pc-code">{{ l.label }}</td><td>{{ l.name }}</td><td>{{ l.kindLabel }}</td>
              <td><span class="pc-chip" :style="{ '--c': PURPOSE_C[l.purpose] }">{{ l.purposeLabel }}</span></td><td>{{ l.capacity ?? '—' }}</td>
              <td v-if="can" style="white-space: nowrap"><button class="btn btn-sm" @click="openLoc(l)">تعديل</button> <button class="btn btn-sm" @click="removeLoc(l)">✕</button></td><td v-else />
            </tr>
            <tr v-if="!w.locationsList.length"><td colspan="6" class="pc-empty">لم تُعرّف مواقع داخل المستودع</td></tr>
          </tbody>
        </table>
      </section>
    </div>

    <WarehouseForm v-if="editing" :warehouse="w" :warehouses="all" @close="editing = false" @saved="load" />
    <div v-if="loc && lk" class="modal-backdrop" @click.self="loc = null">
      <form class="card modal" @submit.prevent="saveLoc">
        <h2>{{ loc.id ? 'تعديل الموقع' : 'موقع تخزين جديد' }}</h2>
        <div class="pc-fields">
          <label class="field"><span>الرمز *</span><input v-model="loc.code" class="input" dir="ltr" required placeholder="A-01" /></label>
          <label class="field"><span>الاسم *</span><input v-model="loc.name" class="input" required /></label>
          <label class="field"><span>النوع</span><select v-model="loc.kind" class="input"><option v-for="(l, k) in lk.locationKinds" :key="k" :value="k">{{ l }}</option></select></label>
          <label class="field"><span>الغرض</span><select v-model="loc.purpose" class="input"><option v-for="(l, k) in lk.locationPurpose" :key="k" :value="k">{{ l }}</option></select></label>
          <label class="field"><span>داخل الموقع</span><select v-model="loc.parentId" class="input"><option value="">—</option><option v-for="x in w.locationsList.filter((y: any) => y.id !== loc.id)" :key="x.id" :value="x.id">{{ x.label }} {{ x.name }}</option></select></label>
          <label class="field"><span>السعة</span><input v-model="loc.capacity" class="input" /></label>
          <label v-if="loc.id" class="field"><span><input v-model="loc.isActive" type="checkbox" /> نشط</span></label>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ</button><button type="button" class="btn" @click="loc = null">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
