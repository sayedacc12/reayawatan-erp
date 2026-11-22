<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import ItemForm from '../components/ItemForm.vue';
import { KIND_COLOR, PR, groupTree, indent, lookups, sar } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

const route = useRoute();
const router = useRouter();
const session = useSession();
const toast = useToast();
const lk = ref<any>(null);
const rows = ref<any[]>([]);
const loading = ref(true);
const adding = ref(route.query.new === '1');
const f = ref({ q: '', group: String(route.query.group ?? ''), kind: '', status: 'active' });
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/procurement/items?${q}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  lk.value = await lookups().catch(() => null);
  await load();
});
const groups = computed(() => groupTree(lk.value?.groups ?? []));
let t: ReturnType<typeof setTimeout>;
watch(() => f.value.q, () => { clearTimeout(t); t = setTimeout(load, 300); });
watch(() => [f.value.group, f.value.kind, f.value.status], load);
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>دليل الأصناف</h1><p class="muted">ترميز موحد لكل صنف حسب مجموعته، بوحداته ومواصفاته وحساباته. لا يتكرر الاسم ولا الباركود.</p></div>
      <button v-if="session.can(PR.items)" class="btn btn-primary" @click="adding = true">+ صنف جديد</button>
    </div>
    <div class="pc-toolbar">
      <input v-model="f.q" class="input grow" placeholder="بحث بالاسم أو الرمز أو الباركود" />
      <select v-model="f.group" class="input"><option value="">كل المجموعات</option><option v-for="g in groups" :key="g.id" :value="g.id">{{ indent(g.depth) }}{{ g.name }}</option></select>
      <select v-model="f.kind" class="input"><option value="">كل الأنواع</option><option v-for="(l, k) in lk?.itemKinds ?? {}" :key="k" :value="k">{{ l }}</option></select>
      <select v-model="f.status" class="input"><option value="">النشطة والموقوفة</option><option value="active">النشطة</option><option value="stopped">الموقوفة</option></select>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرمز</th><th>الصنف</th><th>المجموعة</th><th>النوع</th><th>الوحدة</th><th>التتبع</th><th>نقطة إعادة الطلب</th><th>السعر الاسترشادي</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" :class="['pc-row', { off: r.status === 'stopped' }]" @click="router.push(`/procurement/items/${r.id}`)">
            <td class="pc-code">{{ r.code }}</td>
            <td><b>{{ r.name }}</b> <span v-if="r.status === 'stopped'" class="pc-flag">موقوف</span><span v-if="r.barcode" class="pm-muted pc-code" style="display: block">{{ r.barcode }}</span></td>
            <td>{{ r.groupName }}</td>
            <td><span class="pc-chip" :style="{ '--c': KIND_COLOR[r.kind] }">{{ r.kindLabel }}</span></td>
            <td>{{ r.uom }}</td>
            <td class="pm-muted" style="font-size: .8rem">{{ [r.trackBatch && 'تشغيلة', r.trackSerial && 'تسلسلي', r.trackExpiry && 'صلاحية'].filter(Boolean).join(' · ') || '—' }}</td>
            <td class="pc-num">{{ r.reorderPoint ?? '—' }}</td>
            <td class="pc-num">{{ sar(r.refPrice) }}</td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="8" class="pc-empty">لا توجد أصناف بهذه المواصفات</td></tr>
        </tbody>
      </table>
    </div>
    <ItemForm v-if="adding" @close="adding = false" @saved="(i) => router.push(`/procurement/items/${i.id}`)" />
  </div>
</template>
