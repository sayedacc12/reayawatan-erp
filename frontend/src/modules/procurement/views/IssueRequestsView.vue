<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { ISR_COLOR, PR, fmtDate, lookups } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const session = useSession();
const lk = ref<any>(null);
const rows = ref<any[]>([]);
const loading = ref(true);
const STATUS: Record<string, string> = {
  draft: 'مسودة', submitted: 'بانتظار الاعتماد', approved: 'معتمد للصرف', partial: 'صُرف جزئيًا', issued: 'صُرف بالكامل', returned: 'معاد للتعديل', rejected: 'مرفوض', cancelled: 'ملغى',
};
const f = ref({ q: '', status: String(route.query.status ?? ''), warehouse: '', mine: route.query.mine === '1' ? '1' : '', todo: route.query.todo === '1' ? '1' : '' });
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/procurement/issue-requests?${q}`);
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
watch(() => [f.value.status, f.value.warehouse, f.value.mine, f.value.todo], load);
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>طلبات الصرف</h1><p class="muted">تطلب الإدارات المواد من المستودع، فيعتمدها مختص غير مقدم الطلب، ثم يصرفها أمين المستودع ويُحمّل مصروفها على مركز التكلفة والمشروع ومصدر التمويل.</p></div>
      <div v-if="session.can(PR.issueRequest)"><button class="btn btn-primary" @click="router.push('/procurement/issue-requests/new')">طلب صرف جديد</button></div>
    </div>
    <div class="pc-toolbar">
      <input v-model="f.q" class="input grow" placeholder="بحث بالرقم أو الغرض أو مقدم الطلب" />
      <select v-model="f.status" class="input"><option value="">كل الحالات</option><option v-for="(l, k) in STATUS" :key="k" :value="k">{{ l }}</option></select>
      <select v-model="f.warehouse" class="input"><option value="">كل المستودعات</option><option v-for="w in lk?.activeWarehouses ?? []" :key="w.id" :value="w.id">{{ w.code }} · {{ w.name }}</option></select>
      <label class="pc-inline" style="font-size: .88rem"><input v-model="f.todo" type="checkbox" true-value="1" false-value="" /> بانتظاري</label>
      <label class="pc-inline" style="font-size: .88rem"><input v-model="f.mine" type="checkbox" true-value="1" false-value="" /> طلباتي</label>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>الغرض</th><th>المستودع</th><th>مقدم الطلب</th><th>مطلوب قبل</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="pc-row" @click="router.push(`/procurement/issue-requests/${r.id}`)">
            <td class="pc-code">{{ r.code }}</td>
            <td><b>{{ r.purpose }}</b><span class="pm-muted" style="display: block; font-size: .8rem">{{ r.lines }} صنف{{ r.unitName ? ` · ${r.unitName}` : '' }}</span></td>
            <td>{{ r.warehouseName }}</td>
            <td>{{ r.requestedByName }}</td>
            <td style="font-size: .85rem">{{ fmtDate(r.neededBy) }}</td>
            <td>
              <span class="pm-pill" :style="{ '--c': ISR_COLOR[r.status] }">{{ r.statusLabel }}</span>
              <span v-if="r.myDecision" class="pc-warn" style="display: flex; margin-top: 2px">بانتظار اعتمادك</span>
              <span v-if="r.myIssue" class="pc-warn" style="display: flex; margin-top: 2px">بانتظار صرفك</span>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="6" class="pc-empty">لا توجد طلبات صرف بهذه المواصفات.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
