<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { CONTRACT_COLOR, PR, fmtDate, sar } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const session = useSession();
const rows = ref<any[]>([]);
const lk = ref<any>(null);
const loading = ref(true);
const f = ref({ q: String(route.query.q ?? ''), status: '', view: String(route.query.view ?? '') });
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/procurement/contracts?${q}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  lk.value = await api('/procurement/contract-lookups').catch(() => null);
  await load();
});
let t: ReturnType<typeof setTimeout>;
watch(() => f.value.q, () => { clearTimeout(t); t = setTimeout(load, 300); });
watch(() => [f.value.status, f.value.view], load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>العقود والاتفاقيات</h1>
        <p class="muted">عقود التوريد والخدمات والاتفاقيات الإطارية مع الموردين: سقف القيمة والمدة والأسعار التعاقدية والضمانات ومستويات الخدمة والجزاءات. يصدر التعميد على العقد في حدود المتبقي من سقفه.</p>
      </div>
      <div v-if="session.can(PR.contracts)"><button class="btn btn-primary" @click="router.push('/procurement/contracts/new')">عقد جديد</button></div>
    </div>
    <div class="pc-tabs" style="margin-bottom: 10px">
      <button :class="{ on: f.view === '' }" @click="f.view = ''">الكل</button>
      <button :class="{ on: f.view === 'alerts' }" @click="f.view = 'alerts'">عليها تنبيهات</button>
    </div>
    <div class="pc-toolbar">
      <input v-model="f.q" class="input grow" placeholder="بحث برقم العقد أو عنوانه أو المورد أو المرجع" />
      <select v-model="f.status" class="input"><option value="">كل الحالات</option><option v-for="(l, k) in lk?.status ?? {}" :key="k" :value="k">{{ l }}</option></select>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>العقد</th><th>المورد</th><th>المدة</th><th>القيمة</th><th>المستخدم</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="pc-row" @click="router.push(`/procurement/contracts/${r.id}`)">
            <td class="pc-code">{{ r.code }}<small class="pm-muted" style="display: block">{{ r.kindLabel }}</small></td>
            <td>{{ r.title }}
              <small v-if="r.joint" class="pm-pill" style="--c: #0891b2; margin-inline-start: 4px">عقد مشترك مع شريك</small>
              <small v-for="(a, i) in r.alerts" :key="i" class="pc-flag" style="display: block">⚠ {{ a }}</small>
            </td>
            <td>{{ r.supplierName }}<small class="pm-muted" style="display: block">{{ r.supplierCode }}</small></td>
            <td style="font-size: .85rem">{{ fmtDate(r.startsOn) }}<small class="pm-muted" style="display: block">إلى {{ fmtDate(r.endsOn) }}</small></td>
            <td class="pc-num">{{ sar(r.value) }}</td>
            <td class="pc-num">{{ sar(r.used) }}<small class="pm-muted" style="display: block">{{ r.usedPct }}%</small></td>
            <td><span class="pm-pill" :style="{ '--c': CONTRACT_COLOR[r.status] }">{{ r.statusLabel }}</span></td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="7" class="pc-empty">لا توجد عقود.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
