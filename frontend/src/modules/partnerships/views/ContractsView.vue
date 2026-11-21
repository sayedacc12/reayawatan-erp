<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import NewContractForm from '../components/NewContractForm.vue';
import { CONTRACT_COLOR, PT, fmtDate, lookups, sar } from '../lib';
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
const f = ref({ q: '', status: String(route.query.status ?? ''), type: '' });
const STATES = [
  ['', 'الكل'], ['open', 'تحت الإجراء'], ['draft', 'مسودات'], ['review', 'بانتظار الاعتماد'], ['approved', 'معتمدة داخليًا'], ['sent', 'مرسلة للتوقيع'],
  ['changes_requested', 'طلب تعديل'], ['signed', 'سارية'], ['expired', 'منتهية'], ['terminated', 'منهاة'], ['cancelled', 'ملغاة'],
];
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/partnerships/contracts?${q}`);
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
watch(() => [f.value.status, f.value.type], load);
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>عقود الشراكة</h1><p class="muted">كل اتفاقيات الشراكة من المسودة حتى التوقيع والتجديد، بإصداراتها وحالاتها.</p></div>
      <button v-if="session.can(PT.contracts)" class="btn btn-primary" @click="adding = true">+ عقد شراكة</button>
    </div>
    <div class="pt-chips" style="margin-bottom: 10px">
      <button v-for="[k, l] in STATES" :key="k" :class="['pt-chip', { on: f.status === k }]" style="--c: #b45309" @click="f.status = k">{{ l }}</button>
    </div>
    <div class="pt-toolbar">
      <input v-model="f.q" class="input grow" placeholder="بحث برقم العقد أو العنوان أو اسم الشريك" />
      <select v-model="f.type" class="input"><option value="">كل أنواع الشراكة</option><option v-for="x in lk?.types ?? []" :key="x.id" :value="x.id">{{ x.name }}</option></select>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>رقم العقد</th><th>العنوان</th><th>الشريك</th><th>النوع</th><th>المدة</th><th>القيمة</th><th>الإصدار</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="c in rows" :key="c.id" class="pt-row" @click="router.push(`/partnerships/contracts/${c.id}`)">
            <td class="pt-code">{{ c.number }}</td>
            <td><b>{{ c.title }}</b><span v-if="c.projectName" class="pm-muted">المشروع: {{ c.projectName }}</span><span v-if="c.renewalOf" class="pm-muted">↻ تجديد</span></td>
            <td>{{ c.partnerName }}</td>
            <td><span class="pt-chip" :style="{ '--c': c.typeColor }">{{ c.typeName }}</span></td>
            <td class="pm-muted">{{ fmtDate(c.startsOn) }} ← {{ fmtDate(c.endsOn) }}</td>
            <td class="pt-num">{{ sar(c.value) }}</td>
            <td class="pt-num">{{ c.version || '—' }}</td>
            <td><span class="pm-pill" :style="{ '--c': CONTRACT_COLOR[c.status] }">{{ c.statusLabel }}</span>
              <span v-if="c.daysLeft !== null && c.daysLeft <= (lk?.settings.alertDays ?? 60)" class="pt-days" style="margin-inline-start: 4px">{{ c.daysLeft }} يوم</span></td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="8" class="pt-empty">لا توجد عقود</td></tr>
        </tbody>
      </table>
    </div>
    <NewContractForm v-if="adding" @close="adding = false" @saved="(c) => router.push(`/partnerships/contracts/${c.id}`)" />
  </div>
</template>
