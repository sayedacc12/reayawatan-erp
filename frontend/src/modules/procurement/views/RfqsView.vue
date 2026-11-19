<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { RFQ_COLOR, fmtDateTime, lookups, sar } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const router = useRouter();
const toast = useToast();
const lk = ref<any>(null);
const rows = ref<any[]>([]);
const loading = ref(true);
const f = ref({ q: '', status: '' });
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/procurement/rfqs?${q}`);
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
watch(() => f.value.status, load);
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>المنافسات وطلبات العروض</h1><p class="muted">تُطرح من طلب شراء معتمد، وتصل للموردين المدعوين عبر البوابة. العروض مختومة حتى موعد الفتح.</p></div>
    </div>
    <div class="pc-toolbar">
      <input v-model="f.q" class="input grow" placeholder="بحث بالرقم أو العنوان" />
      <select v-model="f.status" class="input"><option value="">كل الحالات</option><option v-for="(l, k) in lk?.rfqStatus ?? {}" :key="k" :value="k">{{ l }}</option></select>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>المنافسة</th><th>الأسلوب</th><th>إغلاق التقديم</th><th>المدعوون</th><th>العروض</th><th>التقديري</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="pc-row" @click="router.push(`/procurement/rfqs/${r.id}`)">
            <td class="pc-code">{{ r.code }}</td>
            <td><b>{{ r.title }}</b><span class="pm-muted" style="display: block; font-size: .8rem">طلب {{ r.requestCode }}<span v-if="r.member" class="pc-okflag" style="margin-inline-start: 6px">أنت في لجنة التقييم</span></span></td>
            <td style="font-size: .85rem">{{ r.methodLabel }}</td>
            <td style="font-size: .85rem">{{ fmtDateTime(r.closesAt) }}</td>
            <td class="pc-num">{{ r.invited }}</td>
            <td class="pc-num">{{ r.quotes }}</td>
            <td class="pc-num">{{ sar(r.estimatedTotal) }}</td>
            <td><span class="pm-pill" :style="{ '--c': RFQ_COLOR[r.status] }">{{ r.statusLabel }}</span><span v-if="r.awaitingOpen" class="pc-warn" style="display: flex; margin-top: 2px">انتهى التقديم، بانتظار الفتح</span></td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="8" class="pc-empty">لا توجد منافسات. تُطرح المنافسة من صفحة طلب الشراء المعتمد.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
