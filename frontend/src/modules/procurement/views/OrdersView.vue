<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { ORDER_COLOR, fmtDate, lookups, sar } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const lk = ref<any>(null);
const rows = ref<any[]>([]);
const loading = ref(true);
const f = ref({ q: '', status: String(route.query.status ?? ''), mine: route.query.mine === '1' ? '1' : '' });
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/procurement/orders?${q}`);
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
watch(() => [f.value.status, f.value.mine], load);
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>التعميدات (أوامر الشراء)</h1><p class="muted">تصدر من العرض المرسى أو مباشرة للشراء المباشر، وتمر بمستويات الاعتماد حسب القيمة، ويُحجز مبلغها من مصدر الصرف عند الاعتماد الأخير.</p></div>
    </div>
    <div class="pc-toolbar">
      <input v-model="f.q" class="input grow" placeholder="بحث بالرقم أو العنوان أو المورد" />
      <select v-model="f.status" class="input"><option value="">كل الحالات</option><option v-for="(l, k) in lk?.orderStatus ?? {}" :key="k" :value="k">{{ l }}</option></select>
      <label class="pc-inline" style="font-size: .88rem"><input v-model="f.mine" type="checkbox" true-value="1" false-value="" /> بانتظار اعتمادي</label>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>التعميد</th><th>المورد</th><th>القيمة</th><th>التسليم</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="pc-row" @click="router.push(`/procurement/orders/${r.id}`)">
            <td class="pc-code">{{ r.code }}</td>
            <td><b>{{ r.title }}</b><span class="pm-muted" style="display: block; font-size: .8rem">{{ r.kindLabel }} · طلب {{ r.requestCode }}</span></td>
            <td>{{ r.supplierName }} <span class="pc-code">{{ r.supplierCode }}</span></td>
            <td class="pc-num">{{ sar(r.total) }}</td>
            <td style="font-size: .85rem">{{ fmtDate(r.deliveryDate) }}<span v-if="r.late" class="pc-flag" style="display: block">متأخر</span></td>
            <td>
              <span class="pm-pill" :style="{ '--c': ORDER_COLOR[r.status] }">{{ r.statusLabel }}</span>
              <span v-if="r.nextLevel" class="pm-muted" style="display: block; font-size: .78rem">بانتظار: {{ r.nextLevel }}</span>
              <span v-if="r.myTurn" class="pc-warn" style="display: flex; margin-top: 2px">بانتظار اعتمادك</span>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="6" class="pc-empty">لا توجد تعميدات بهذه المواصفات.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
