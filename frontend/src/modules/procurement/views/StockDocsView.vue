<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { DOC_KIND_COLOR, PR, STOCK_DOC_COLOR, fmtDate, lookups, sar } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const session = useSession();
const lk = ref<any>(null);
const rows = ref<any[]>([]);
const loading = ref(true);
const KINDS: Record<string, string> = { issue: 'سند صرف', transfer: 'تحويل بين المستودعات', return_supplier: 'مرتجع للمورد', return_in: 'مرتجع من الجهة', writeoff: 'إتلاف وشطب' };
const f = ref({ q: '', kind: String(route.query.kind ?? ''), warehouse: '', status: String(route.query.status ?? '') });
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/procurement/stock-docs?${q}`);
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
watch(() => [f.value.kind, f.value.warehouse, f.value.status], load);
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>حركات المستودع</h1><p class="muted">سندات الصرف والتحويل والمرتجعات والإتلاف. كل سند يحدّث الأرصدة فورًا ويصدر قيده في النظام المالي بسند مخازن.</p></div>
      <div v-if="session.can(PR.stockOperate)" class="pc-inline">
        <button class="btn btn-primary" @click="router.push('/procurement/stock-docs/new?kind=transfer')">تحويل بين المستودعات</button>
        <button class="btn" @click="router.push('/procurement/stock-docs/new?kind=writeoff')">إتلاف وشطب</button>
      </div>
    </div>
    <div class="pc-toolbar">
      <input v-model="f.q" class="input grow" placeholder="بحث بالمستلم أو المورد أو الملاحظات" />
      <select v-model="f.kind" class="input"><option value="">كل الأنواع</option><option v-for="(l, k) in KINDS" :key="k" :value="k">{{ l }}</option></select>
      <select v-model="f.warehouse" class="input"><option value="">كل المستودعات</option><option v-for="w in lk?.activeWarehouses ?? []" :key="w.id" :value="w.id">{{ w.code }} · {{ w.name }}</option></select>
      <select v-model="f.status" class="input"><option value="">كل الحالات</option><option value="pending">بانتظار الاعتماد</option><option value="posted">مرحّل</option><option value="cancelled">ملغى</option></select>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>النوع</th><th>المستودع</th><th>البيان</th><th>التاريخ</th><th>القيمة</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="pc-row" @click="router.push(`/procurement/stock-docs/${r.id}`)">
            <td class="pc-code">{{ r.code }}</td>
            <td><span class="pm-pill" :style="{ '--c': DOC_KIND_COLOR[r.kind] }">{{ r.kindLabel }}</span></td>
            <td>{{ r.warehouseName }}<span v-if="r.toWarehouseName" style="display: block; font-size: .8rem">← {{ r.toWarehouseName }}</span></td>
            <td style="font-size: .85rem">
              <template v-if="r.requestCode">طلب {{ r.requestCode }}</template>
              <template v-if="r.receiverName"> · {{ r.receiverName }}</template>
              <template v-if="r.supplierName">{{ r.supplierName }}</template>
              <template v-if="r.reasonLabel">{{ r.reasonLabel }}</template>
            </td>
            <td style="font-size: .85rem">{{ fmtDate(r.date) }}</td>
            <td class="pc-num">{{ sar(r.total) }}</td>
            <td>
              <span class="pm-pill" :style="{ '--c': STOCK_DOC_COLOR[r.status] }">{{ r.statusLabel }}</span>
              <span v-if="r.myApproval" class="pc-warn" style="display: flex; margin-top: 2px">بانتظار اعتمادك</span>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="7" class="pc-empty">لا توجد حركات بهذه المواصفات.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
