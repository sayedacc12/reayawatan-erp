<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import CustomerForm from '../components/CustomerForm.vue';
import { BL, billingLookups, sar } from '../lib';
import '../../../shared/module.css';
import '../../procurement/procurement.css';
import '../billing.css';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const session = useSession();
const rows = ref<any[]>([]);
const lk = ref<any>(null);
const loading = ref(true);
const adding = ref(route.query.new === '1');
const f = ref({ q: '', kind: '', status: 'active' });
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams(Object.entries(f.value).filter(([, v]) => v) as [string, string][]);
    rows.value = await api(`/billing/customers?${q}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  lk.value = await billingLookups().catch(() => null);
  await load();
});
let t: ReturnType<typeof setTimeout>;
watch(() => f.value.q, () => { clearTimeout(t); t = setTimeout(load, 300); });
watch(() => [f.value.kind, f.value.status], load);
const saved = (c: any) => {
  adding.value = false;
  router.push(`/billing/customers/${c.id}`);
};
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>العملاء</h1>
        <p class="muted">ملف كل عميل ببياناته الضريبية وعنوانه الوطني. يُنشأ له حساب شريك في النظام المالي عند إصدار أول فاتورة له، فيظهر رصيده في كشوف الشركاء.</p>
      </div>
      <div v-if="session.can(BL.customers)"><button class="btn btn-primary" @click="adding = true">عميل جديد</button></div>
    </div>
    <div class="pc-toolbar">
      <input v-model="f.q" class="input grow" placeholder="بحث بالاسم أو الرقم الضريبي أو الجوال أو الرمز" />
      <select v-model="f.kind" class="input"><option value="">كل الأنواع</option><option v-for="(l, k) in lk?.customerKinds ?? {}" :key="k" :value="k">{{ l }}</option></select>
      <select v-model="f.status" class="input"><option value="">الكل</option><option value="active">النشطون</option><option value="stopped">الموقوفون</option></select>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرمز</th><th>العميل</th><th>النوع</th><th>الرقم الضريبي</th><th>الجوال</th><th>المستندات</th><th>الرصيد</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="pc-row" :class="{ off: !r.isActive }" @click="router.push(`/billing/customers/${r.id}`)">
            <td class="pc-code">{{ r.code }}</td>
            <td>{{ r.name }}<small v-if="r.kind === 'business' && !r.address?.buildingNo" class="pc-warn" style="display: block">العنوان الوطني ناقص</small></td>
            <td>{{ r.kindLabel }}</td>
            <td class="pc-code">{{ r.vatNumber ?? '—' }}</td>
            <td class="pc-code">{{ r.phone ?? '—' }}</td>
            <td class="pc-num">{{ r.docs }}</td>
            <td class="pc-num"><b>{{ sar(r.balance) }}</b></td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="7" class="pc-empty">لا يوجد عملاء.</td></tr>
        </tbody>
      </table>
    </div>
    <CustomerForm v-if="adding && lk" :lk="lk" @saved="saved" @close="adding = false" />
  </div>
</template>
