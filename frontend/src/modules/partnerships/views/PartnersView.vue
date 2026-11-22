<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import PartnerForm from '../components/PartnerForm.vue';
import { PARTNER_COLOR, PT, fmtDate, lookups } from '../lib';
import '../../../shared/module.css';
import '../partnerships.css';

const route = useRoute();
const router = useRouter();
const session = useSession();
const toast = useToast();
const lk = ref<any>(null);
const rows = ref<any[]>([]);
const loading = ref(true);
const adding = ref(false);
const f = ref({ q: '', status: String(route.query.status ?? ''), type: '', class: '', tier: '' });
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/partnerships/partners?${q}`);
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
let t: ReturnType<typeof setTimeout>;
watch(() => f.value.q, () => { clearTimeout(t); t = setTimeout(load, 300); });
watch(() => [f.value.status, f.value.type, f.value.class, f.value.tier], load);
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>سجل الشركاء</h1><p class="muted">كل الجهات التي نتعاون معها أو نرشحها للشراكة، بتصنيفاتها ومستوياتها وحالة اعتمادها.</p></div>
      <button v-if="session.can(PT.partners)" class="btn btn-primary" @click="adding = true">+ شريك جديد</button>
    </div>
    <div class="pt-toolbar">
      <input v-model="f.q" class="input grow" placeholder="بحث بالاسم أو جهة التواصل أو المدينة أو رقم السجل" />
      <select v-model="f.status" class="input"><option value="">كل الحالات</option><option v-for="(l, k) in lk?.partnerStatus ?? {}" :key="k" :value="k">{{ l }}</option></select>
      <select v-model="f.type" class="input"><option value="">كل أنواع الشراكة</option><option v-for="x in lk?.types ?? []" :key="x.id" :value="x.id">{{ x.name }}</option></select>
      <select v-model="f.class" class="input"><option value="">كل التصنيفات</option><option v-for="x in lk?.classes ?? []" :key="x.id" :value="x.id">{{ x.name }}</option></select>
      <select v-model="f.tier" class="input"><option value="">كل المستويات</option><option v-for="x in lk?.tiers ?? []" :key="x.key" :value="x.key">{{ x.label }}</option></select>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>الشريك</th><th>أنواع الشراكة</th><th>جهة التواصل</th><th>الحالة</th><th>المستوى</th><th>الدرجة</th><th>عقود سارية</th><th>إعادة التقييم</th></tr></thead>
        <tbody>
          <tr v-for="p in rows" :key="p.id" class="pt-row" @click="router.push(`/partnerships/partners/${p.id}`)">
            <td class="pt-code">{{ p.code }}</td>
            <td><b>{{ p.name }}</b><span class="pm-muted"><i class="dot" :style="{ background: p.classColor }" />{{ p.className ?? 'بدون تصنيف' }}{{ p.city ? ` · ${p.city}` : '' }}</span></td>
            <td><div class="pt-chips"><span v-for="x in p.types" :key="x.id" class="pt-chip" :style="{ '--c': x.color }">{{ x.name }}</span></div></td>
            <td>{{ p.contactName ?? '—' }}<span v-if="p.contactTitle" class="pm-muted">{{ p.contactTitle }}</span></td>
            <td><span class="pm-pill" :style="{ '--c': PARTNER_COLOR[p.status] }">{{ p.statusLabel }}</span></td>
            <td><span v-if="p.tierLabel" class="pt-tier" :style="{ '--c': p.tierColor }">{{ p.tierLabel }}</span><span v-else class="pm-muted">—</span></td>
            <td class="pt-num"><b v-if="p.score !== null">{{ p.score }}</b><span v-else>—</span></td>
            <td class="pt-num">{{ p.activeContracts }}</td>
            <td><span v-if="p.evaluationDue" class="pt-days late">مستحقة</span><span v-else class="pm-muted">{{ fmtDate(p.nextEvaluationOn) }}</span></td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="9" class="pt-empty">لا يوجد شركاء بهذه المواصفات</td></tr>
        </tbody>
      </table>
    </div>
    <PartnerForm v-if="adding" @close="adding = false" @saved="(p) => router.push(`/partnerships/partners/${p.id}`)" />
  </div>
</template>

<style scoped>
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-inline-end: 5px; }
</style>
