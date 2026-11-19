<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../../api';
import { useSession } from '../../../../stores/session';
import AssetForm from '../../components/AssetForm.vue';
import { AF, STATUSES, STATUS_COLOR, useLookups, type AssetDetail, type AssetRow } from '../../assets';
import { P, sar } from '../../lib';
import '../../../projects/projects.css';
import '../../acc.css';
import './assets.css';

const session = useSession();
const route = useRoute();
const router = useRouter();
const { lookups, load: loadLookups } = useLookups();
const rows = ref<AssetRow[]>([]);
const error = ref('');
const f = reactive({ q: '', groupId: String(route.query.groupId ?? ''), status: String(route.query.status ?? ''), custodian: String(route.query.custodian ?? ''), unitId: '' });
let timer: ReturnType<typeof setTimeout> | undefined;
async function load() {
  try {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
    rows.value = await api<AssetRow[]>(`${AF}${qs ? `?${qs}` : ''}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => { load(); loadLookups().catch(() => {}); });
watch(f, () => { clearTimeout(timer); timer = setTimeout(load, 250); });
const totals = computed(() => rows.value.reduce((s, r) => ({ cost: s.cost + r.cost, accum: s.accum + r.accum, nbv: s.nbv + r.nbv }), { cost: 0, accum: 0, nbv: 0 }));

const showForm = ref(route.query.new === '1');
function saved(a: AssetDetail) {
  showForm.value = false;
  router.push(`/accounting/assets/${a.id}`);
}
const picked = ref<string[]>([]);
const allPicked = computed({
  get: () => rows.value.length > 0 && picked.value.length === rows.value.length,
  set: (v: boolean) => { picked.value = v ? rows.value.map((r) => r.id) : []; },
});
const printLabels = () => router.push({ path: '/accounting/assets/labels', query: { ids: picked.value.join(',') } });
const ACQ: Record<string, string> = { opening: 'رصيد افتتاحي', purchase: 'شراء', donation: 'تبرع عيني' };
</script>

<template>
  <div>
    <section class="pm-hero ac-hero fa-hero">
      <div>
        <p class="pm-kicker">الأصول الثابتة</p>
        <h1>سجل الأصول</h1>
        <p class="pm-sub">بطاقة لكل أصل برمز فريد وملصق QR: مجموعته، والموظف المسؤول عنه، وموقعه، وقيمته ومجمع إهلاكه. الأصل المسجل بلا قيمة يدخل الدفاتر برصيد افتتاحي أو شراء أو تبرع عيني.</p>
      </div>
      <div class="pm-actions">
        <button v-if="session.can(P.assetsManage)" class="btn ac-glow" @click="showForm = true">أصل جديد</button>
        <button class="btn ac-ghost" :disabled="!picked.length" @click="printLabels">طباعة ملصقات QR ({{ picked.length }})</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <section class="card pm-panel">
      <div class="ac-toolbar">
        <input v-model="f.q" class="input grow" placeholder="ابحث بالاسم أو الرمز أو الرقم التسلسلي أو الموقع..." />
        <select v-model="f.groupId" class="input"><option value="">كل المجموعات</option><option v-for="g in lookups?.groups ?? []" :key="g.id" :value="g.id">{{ g.name }}</option></select>
        <select v-model="f.status" class="input"><option value="">كل الحالات</option><option v-for="s in STATUSES" :key="s.value" :value="s.value">{{ s.label }}</option></select>
        <select v-model="f.custodian" class="input"><option value="">كل الموظفين</option><option v-for="e in lookups?.employees ?? []" :key="e.id" :value="e.id">{{ e.fullName }}</option></select>
        <select v-model="f.unitId" class="input"><option value="">كل الإدارات</option><option v-for="u in lookups?.units ?? []" :key="u.id" :value="u.id">{{ u.name }}</option></select>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th><input v-model="allPicked" type="checkbox" title="تحديد الكل" /></th><th>الرمز</th><th>الأصل</th><th>المجموعة</th><th>العهدة والموقع</th>
            <th>التكلفة</th><th>مجمع الإهلاك</th><th>صافي القيمة</th><th>آخر إهلاك</th><th>الحالة</th>
          </tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id" class="ac-row-click" @click="router.push(`/accounting/assets/${r.id}`)">
              <td @click.stop><input v-model="picked" type="checkbox" :value="r.id" /></td>
              <td class="ac-code"><b>{{ r.code }}</b></td>
              <td><b>{{ r.name }}</b><span class="pm-muted">{{ r.serialNumber ?? '' }}{{ r.acquisition ? ` · ${ACQ[r.acquisition] ?? ''}` : '' }}</span></td>
              <td>{{ r.groupName }}</td>
              <td><span v-if="r.custodianName">{{ r.custodianName }}</span><span v-else-if="r.isTangible && !r.disposedAt" class="fa-flag">بلا عهدة</span><span class="pm-muted">{{ r.location }}</span></td>
              <td class="ac-num">{{ sar(r.cost) }}</td><td class="ac-num">{{ sar(r.accum) }}</td><td class="ac-num"><b>{{ sar(r.nbv) }}</b></td>
              <td class="pm-muted">{{ r.depreciatedThrough ?? '—' }}</td>
              <td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[r.status] }">{{ r.statusLabel }}</span></td>
            </tr>
            <tr v-if="!rows.length"><td colspan="10" class="pm-empty">لا توجد أصول مطابقة</td></tr>
          </tbody>
          <tfoot v-if="rows.length"><tr><td colspan="5"><b>الإجمالي ({{ rows.length }} أصل)</b></td><td class="ac-num"><b>{{ sar(totals.cost) }}</b></td><td class="ac-num"><b>{{ sar(totals.accum) }}</b></td><td class="ac-num"><b>{{ sar(totals.nbv) }}</b></td><td colspan="2" /></tr></tfoot>
        </table>
      </div>
    </section>
    <AssetForm v-if="showForm" @saved="saved" @close="showForm = false" />
  </div>
</template>

<style scoped>
td .pm-muted { display: block; }
</style>
