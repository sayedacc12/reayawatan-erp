<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { EVAL_COLOR, GRADE_COLOR, PR, fmtDate, today } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const session = useSession();
const rows = ref<any[]>([]);
const lk = ref<any>(null);
const loading = ref(true);
const busy = ref(false);
const f = ref({ status: '', supplier: String(route.query.supplier ?? '') });
const showNew = ref(false);
const yearStart = () => `${today().slice(0, 4)}-01-01`;
const nf = ref<any>({ supplierId: '', kind: 'periodic', orderId: '', contractId: '', periodFrom: yearStart(), periodTo: today() });

async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/procurement/evaluations?${q}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  lk.value = await api('/procurement/evaluation-lookups').catch(() => null);
  await load();
});
watch(() => [f.value.status, f.value.supplier], load);

const ordersFor = computed(() => (lk.value?.orders ?? []).filter((o: any) => o.supplierId === nf.value.supplierId));
const contractsFor = computed(() => (lk.value?.contracts ?? []).filter((c: any) => c.supplierId === nf.value.supplierId));
async function create() {
  busy.value = true;
  try {
    const n = nf.value;
    const e = await api<any>('/procurement/evaluations', {
      method: 'POST',
      json: { supplierId: n.supplierId, kind: n.kind, orderId: n.kind === 'order' ? n.orderId : null, contractId: n.kind === 'contract' ? n.contractId : null, periodFrom: n.periodFrom, periodTo: n.periodTo },
    });
    router.push(`/procurement/evaluations/${e.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>تقييم الموردين</h1>
        <p class="muted">يُقيّم المورد بمؤشرات تُحسب آليًا من التوريد في الموعد والكميات ونتائج الفحص ومطابقة الفواتير ومستويات الخدمة، ثم يراجعها المقيّم ويعتمدها غيره، فيُحدّث تقدير المورد في سجله.</p>
      </div>
      <div v-if="session.can(PR.evaluations)"><button class="btn btn-primary" @click="showNew = true">تقييم جديد</button></div>
    </div>
    <div class="pc-toolbar">
      <select v-model="f.supplier" class="input grow"><option value="">كل الموردين</option><option v-for="s in lk?.suppliers ?? []" :key="s.id" :value="s.id">{{ s.code }} · {{ s.name }}</option></select>
      <select v-model="f.status" class="input"><option value="">كل الحالات</option><option v-for="(l, k) in lk?.status ?? {}" :key="k" :value="k">{{ l }}</option></select>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>المورد</th><th>النوع</th><th>الفترة</th><th>الدرجة</th><th>التقدير</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="pc-row" @click="router.push(`/procurement/evaluations/${r.id}`)">
            <td class="pc-code">{{ r.code }}</td>
            <td>{{ r.supplierName }}<small v-if="r.responded" class="pm-muted" style="display: block">ردّ المورد على التقييم</small></td>
            <td>{{ r.kindLabel }}<small v-if="r.ref" class="pm-muted pc-code" style="display: block">{{ r.ref }}</small></td>
            <td style="font-size: .85rem">{{ fmtDate(r.periodFrom) }}<small class="pm-muted" style="display: block">إلى {{ fmtDate(r.periodTo) }}</small></td>
            <td class="pc-num">{{ r.total }}</td>
            <td><span class="pm-pill" :style="{ '--c': GRADE_COLOR[r.grade] }">{{ r.grade }} · {{ r.gradeLabel }}</span></td>
            <td><span class="pm-pill" :style="{ '--c': EVAL_COLOR[r.status] }">{{ r.statusLabel }}</span></td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="7" class="pc-empty">لا توجد تقييمات.</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="showNew && lk" class="modal-backdrop" @click.self="showNew = false">
      <form class="card modal" @submit.prevent="create">
        <h2>تقييم جديد</h2>
        <label class="field"><span>المورد</span><select v-model="nf.supplierId" class="input" required><option value="">اختر…</option><option v-for="s in lk.suppliers" :key="s.id" :value="s.id">{{ s.code }} · {{ s.name }}</option></select></label>
        <label class="field"><span>النوع</span><select v-model="nf.kind" class="input"><option v-for="(l, k) in lk.kinds" :key="k" :value="k">{{ l }}</option></select></label>
        <label v-if="nf.kind === 'order'" class="field"><span>التعميد</span><select v-model="nf.orderId" class="input" required><option value="">اختر…</option><option v-for="o in ordersFor" :key="o.id" :value="o.id">{{ o.code }} · {{ o.title }}</option></select></label>
        <label v-if="nf.kind === 'contract'" class="field"><span>العقد</span><select v-model="nf.contractId" class="input" required><option value="">اختر…</option><option v-for="c in contractsFor" :key="c.id" :value="c.id">{{ c.code }} · {{ c.title }}</option></select></label>
        <label class="field"><span>من</span><input v-model="nf.periodFrom" type="date" class="input" required /></label>
        <label class="field"><span>إلى</span><input v-model="nf.periodTo" type="date" class="input" :max="today()" required /></label>
        <p class="pm-muted" style="font-size: .82rem">تُحسب المؤشرات من حركة المورد في الفترة، وتقترح درجة كل معيار، ويمكنك تعديلها بسبب مكتوب.</p>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">إنشاء</button><button type="button" class="btn" @click="showNew = false">رجوع</button></div>
      </form>
    </div>
  </div>
</template>
