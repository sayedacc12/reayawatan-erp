<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { color, fmtDate, fmtNo, hijri, KINDS, label, sar, STATUSES } from '../labels';
import type { OpportunityRow } from '../types';
import '../fr.css';

const session = useSession();
const router = useRouter();
const data = ref<{ items: OpportunityRow[]; total: number; amount: number; page: number; pageSize: number } | null>(null);
const error = ref('');
const f = reactive({ search: '', status: '', kind: '', zakat: '', mine: '', from: '', to: '', page: 1 });
let timer: ReturnType<typeof setTimeout> | undefined;

async function load() {
  try {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '').map(([k, v]) => [k, String(v)]));
    data.value = await api(`/fundraising/opportunities?${q}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(() => [f.status, f.kind, f.zakat, f.mine, f.from, f.to], () => { f.page = 1; load(); });
watch(() => f.search, () => { clearTimeout(timer); timer = setTimeout(() => { f.page = 1; load(); }, 300); });
const targetsOf = (s: string | null) => (s ?? '').split(',').filter(Boolean);
</script>

<template>
  <div>
    <section class="fr-hero">
      <div>
        <p class="kicker">سجل فرص التبرع</p>
        <h1>كل ريال له وجهة واضحة</h1>
        <p class="sub">فرص نقدية وعينية ووعود بالدفع، موزعة على دفعات بحسب البرامج والأوقاف والحالات واشتراطات الداعم.</p>
      </div>
      <div class="fr-hero-actions">
        <RouterLink v-if="session.can('fundraising.opportunities.create')" to="/fundraising/opportunities/new" class="btn btn-gold">+ فرصة تبرع جديدة</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="fr-filters">
      <div class="fr-pills">
        <button :class="['fr-pill', { on: !f.status && !f.mine }]" @click="f.status = ''; f.mine = ''">الكل</button>
        <button v-if="session.can('fundraising.opportunities.process')" :class="['fr-pill', { on: f.mine }]" @click="f.mine = f.mine ? '' : 'true'; f.status = ''">بانتظار قراري</button>
        <button v-for="s in STATUSES" :key="s.value" :class="['fr-pill', { on: f.status === s.value }]" @click="f.status = s.value; f.mine = ''">{{ s.label }}</button>
      </div>
    </div>
    <div class="fr-filters">
      <input v-model="f.search" class="input grow" placeholder="رقم الفرصة أو سند القبض أو اسم الداعم" />
      <select v-model="f.kind" class="input"><option value="">كل الأنواع</option><option v-for="k in KINDS" :key="k.value" :value="k.value">{{ k.label }}</option></select>
      <select v-model="f.zakat" class="input"><option value="">زكاة وغيرها</option><option value="true">الزكاة فقط</option><option value="false">غير الزكاة</option></select>
      <input v-model="f.from" type="date" class="input" title="من تاريخ" />
      <input v-model="f.to" type="date" class="input" title="إلى تاريخ" />
    </div>

    <div v-if="data" class="sum-bar"><span>{{ data.total.toLocaleString('ar-SA') }} فرصة</span><span>الإجمالي: <b>{{ sar(data.amount) }}</b></span></div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>رقم الفرصة</th><th>الداعم</th><th>النوع</th><th>التاريخ</th><th>المبلغ</th><th>التوزيع</th><th>الحالة / المرحلة</th></tr></thead>
        <tbody>
          <tr v-for="o in data?.items ?? []" :key="o.id" class="fr-row-link" @click="router.push(`/fundraising/opportunities/${o.id}`)">
            <td><span class="fr-no">{{ fmtNo('FR', o.opportunityNo) }}</span> <span v-if="o.isZakat" class="fr-zakat">زكاة</span></td>
            <td><b>{{ o.donorName }}</b></td>
            <td><span class="fr-badge" :style="{ '--c': color('kind', o.kind) }">{{ label('kind', o.kind) }}</span></td>
            <td>{{ fmtDate(o.date) }}<span class="fr-hijri">{{ hijri(o.date) }}</span></td>
            <td class="fr-amount">{{ sar(o.totalAmount) }}</td>
            <td><span class="dots"><i v-for="t in targetsOf(o.targetKinds)" :key="t" :style="{ background: color('target', t) }" :title="label('target', t)" /></span> {{ o.batchCount }} دفعة</td>
            <td><span class="fr-badge" :style="{ '--c': color('status', o.status) }">{{ label('status', o.status) }}</span><small v-if="o.stageName" class="muted"> · {{ o.stageName }}</small></td>
          </tr>
        </tbody>
      </table>
      <p v-if="data && !data.items.length" class="fr-empty">لا توجد فرص مطابقة</p>
    </div>
    <div v-if="data && data.total > data.pageSize" class="pager">
      <button class="btn btn-sm" :disabled="f.page <= 1" @click="f.page--; load()">السابق</button>
      <span class="muted">صفحة {{ f.page }} من {{ Math.ceil(data.total / data.pageSize) }}</span>
      <button class="btn btn-sm" :disabled="f.page * data.pageSize >= data.total" @click="f.page++; load()">التالي</button>
    </div>
  </div>
</template>

<style scoped>
.sum-bar { display: flex; gap: 18px; justify-content: flex-end; font-size: .88rem; color: var(--muted); margin-bottom: 8px; }
.dots { display: inline-flex; gap: 3px; vertical-align: middle; }
.dots i { width: 9px; height: 9px; border-radius: 50%; box-shadow: 0 0 6px currentColor; }
.pager { display: flex; gap: 10px; align-items: center; justify-content: center; margin-top: 14px; }
</style>
