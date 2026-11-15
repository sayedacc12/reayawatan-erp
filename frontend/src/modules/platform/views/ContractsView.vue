<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { CONTRACT_STATUS, cycleLabel, fmtDate, money } from '../labels';
import '../platform.css';

interface Row {
  id: string; number: string; status: string; organizationId: string; organizationName: string;
  terms: { price: number; billingCycle: string; months: number; startsOn: string }; sentAt: string | null; signedAt: string | null; signerName: string | null; createdAt: string;
}
const router = useRouter();
const rows = ref<Row[]>([]);
const error = ref('');
const filter = ref('');
onMounted(async () => {
  try {
    rows.value = await api<Row[]>('/platform/contracts');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const counts = computed(() => {
  const c: Record<string, number> = {};
  for (const r of rows.value) c[r.status] = (c[r.status] ?? 0) + 1;
  return c;
});
const shown = computed(() => (filter.value ? rows.value.filter((r) => r.status === filter.value) : rows.value));
</script>

<template>
  <div>
    <section class="p-hero">
      <div>
        <p class="p-kicker">العقود الإلكترونية</p>
        <h1>عقود الاشتراك</h1>
        <p class="p-sub">كل عقد يمر بإجراءات داخل المنصة: مسودة ← إرسال للجمعية ← (طلب تعديل) ← توقيع إلكتروني يفعّل الاشتراك تلقائيًا.</p>
      </div>
      <RouterLink to="/platform/contract-clauses" class="btn btn-gold">بنود العقد والمسودة المقترحة</RouterLink>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="p-filters">
      <button :class="['p-chip', { on: !filter }]" @click="filter = ''">الكل<b>{{ rows.length }}</b></button>
      <button v-for="(s, k) in CONTRACT_STATUS" :key="k" :class="['p-chip', { on: filter === k }]" @click="filter = k">{{ s.label }}<b>{{ counts[k] ?? 0 }}</b></button>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>رقم العقد</th><th>الجمعية</th><th>القيمة</th><th>المدة</th><th>الحالة</th><th>أُرسل</th><th>وُقّع</th></tr></thead>
        <tbody>
          <tr v-for="r in shown" :key="r.id" class="click" @click="router.push(`/platform/contracts/${r.id}`)">
            <td dir="ltr" style="text-align: right"><code>{{ r.number }}</code></td>
            <td><b>{{ r.organizationName }}</b></td>
            <td>{{ money(r.terms.price) }} <small class="muted">{{ cycleLabel(r.terms.billingCycle) }}</small></td>
            <td>{{ r.terms.months }} شهرًا</td>
            <td><span :class="['tone', `tone-${CONTRACT_STATUS[r.status].tone}`]">{{ CONTRACT_STATUS[r.status].label }}</span></td>
            <td>{{ fmtDate(r.sentAt) }}</td>
            <td>{{ r.signedAt ? `${fmtDate(r.signedAt)} · ${r.signerName}` : '—' }}</td>
          </tr>
          <tr v-if="!shown.length"><td colspan="7" class="muted" style="text-align: center; padding: 28px">لا توجد عقود. تُنشأ مسودة العقد تلقائيًا عند اعتماد طلب اشتراك.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.click { cursor: pointer; }
</style>
