<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { PR, PRIORITY_COLOR, REQ_COLOR, fmtDate, lookups, sar } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const route = useRoute();
const router = useRouter();
const session = useSession();
const toast = useToast();
const lk = ref<any>(null);
const rows = ref<any[]>([]);
const loading = ref(true);
const f = ref({ q: '', status: String(route.query.status ?? ''), mine: '' });
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/procurement/requests?${q}`);
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
const canCreate = () => session.can(PR.requests) || session.can(PR.sourcing);
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>طلبات الشراء</h1><p class="muted">كل احتياج يبدأ بطلب يحدد البنود والكميات ومصدر الصرف، ثم يُعتمد ويُطرح أو يُعمَّد حسب قيمته.</p></div>
      <button v-if="canCreate()" class="btn btn-primary" @click="router.push('/procurement/requests/new')">+ طلب شراء</button>
    </div>
    <div class="pc-toolbar">
      <input v-model="f.q" class="input grow" placeholder="بحث بالرقم أو العنوان" />
      <select v-model="f.status" class="input"><option value="">كل الحالات</option><option v-for="(l, k) in lk?.requestStatus ?? {}" :key="k" :value="k">{{ l }}</option></select>
      <label class="pc-inline" style="font-size: .88rem"><input v-model="f.mine" type="checkbox" true-value="1" false-value="" /> طلباتي فقط</label>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>الطلب</th><th>الإدارة</th><th>الأسلوب</th><th>القيمة التقديرية</th><th>الاحتياج</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="pc-row" @click="router.push(`/procurement/requests/${r.id}`)">
            <td class="pc-code">{{ r.code }}</td>
            <td>
              <b>{{ r.title }}</b>
              <span class="pm-muted" style="display: block; font-size: .8rem">{{ r.kindLabel }} · {{ r.lineCount }} بند · {{ r.requestedByName }}</span>
            </td>
            <td style="font-size: .85rem">{{ r.unitName ?? '—' }}<span v-if="r.projectName" class="pm-muted" style="display: block; font-size: .78rem">{{ r.projectName }}</span></td>
            <td style="font-size: .85rem">{{ r.methodLabel ?? '—' }}</td>
            <td class="pc-num">{{ sar(r.estimatedTotal) }}<span v-if="r.budgetOk === false" class="pc-flag" style="display: flex; margin-top: 2px">المتاح لا يكفي</span></td>
            <td style="font-size: .85rem">
              {{ fmtDate(r.neededBy) }}
              <span v-if="r.priority !== 'normal'" class="pc-chip" :style="{ '--c': PRIORITY_COLOR[r.priority] }">{{ r.priorityLabel }}</span>
              <span v-if="r.late" class="pc-flag">متأخر</span>
            </td>
            <td><span class="pm-pill" :style="{ '--c': REQ_COLOR[r.status] }">{{ r.statusLabel }}</span></td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="7" class="pc-empty">لا توجد طلبات شراء</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
