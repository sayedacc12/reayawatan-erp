<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { PR, RECEIPT_COLOR, RECEIPT_KIND_COLOR, fmtDate, lookups, sar } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

const router = useRouter();
const toast = useToast();
const session = useSession();
const canOperate = session.can(PR.stockOperate);
const lk = ref<any>(null);
const rows = ref<any[]>([]);
const loading = ref(true);
const f = ref({ q: '', kind: '', warehouse: '', status: '' });
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/procurement/receipts?${q}`);
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
      <div><h1>الاستلام والفحص</h1><p class="muted">محاضر استلام التعميدات والتبرعات العينية والأرصدة الافتتاحية. كل استلام يحدّث رصيد المستودع وقيمته فورًا ويصدر سند مخازن في النظام المالي.</p></div>
      <div v-if="canOperate" class="pc-inline">
        <button class="btn btn-primary" @click="router.push('/procurement/receipts/new?kind=order')">استلام تعميد</button>
        <button class="btn" @click="router.push('/procurement/receipts/new?kind=donation')">تبرع عيني</button>
        <button class="btn btn-ghost" @click="router.push('/procurement/receipts/new?kind=opening')">رصيد افتتاحي</button>
      </div>
    </div>
    <div class="pc-toolbar">
      <input v-model="f.q" class="input grow" placeholder="بحث بالرقم أو المورد أو المتبرع" />
      <select v-model="f.kind" class="input"><option value="">كل الأنواع</option><option value="order">استلام بتعميد</option><option value="donation">تبرع عيني</option><option value="opening">رصيد افتتاحي</option></select>
      <select v-model="f.warehouse" class="input"><option value="">كل المستودعات</option><option v-for="w in lk?.activeWarehouses ?? []" :key="w.id" :value="w.id">{{ w.code }} · {{ w.name }}</option></select>
      <select v-model="f.status" class="input"><option value="">كل الحالات</option><option value="posted">معتمد</option><option value="cancelled">ملغى</option></select>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>النوع</th><th>المصدر</th><th>المستودع</th><th>التاريخ</th><th>القيمة</th><th>الفحص</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="pc-row" @click="router.push(`/procurement/receipts/${r.id}`)">
            <td class="pc-code">{{ r.code }}</td>
            <td><span class="pm-pill" :style="{ '--c': RECEIPT_KIND_COLOR[r.kind] }">{{ r.kindLabel }}</span></td>
            <td>
              <template v-if="r.kind === 'order'">{{ r.supplierName }}<span class="pc-code" style="display: block">{{ r.orderCode }}</span></template>
              <template v-else>{{ r.donorName ?? '—' }}</template>
            </td>
            <td>{{ r.warehouseName ?? 'تسليم مباشر' }}</td>
            <td style="font-size: .85rem">{{ fmtDate(r.date) }}</td>
            <td class="pc-num">{{ sar(r.total) }}</td>
            <td>{{ r.inspectionLabel ?? '—' }}<span v-if="r.hasRejected" class="pc-flag" style="display: flex; margin-top: 2px">مرفوضات</span></td>
            <td><span class="pm-pill" :style="{ '--c': RECEIPT_COLOR[r.status] }">{{ r.statusLabel }}</span></td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="8" class="pc-empty">لا توجد محاضر استلام بهذه المواصفات.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
