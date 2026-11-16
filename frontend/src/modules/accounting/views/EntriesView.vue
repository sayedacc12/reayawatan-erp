<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { ENTRY_STATUS, P, allTypes, loadDocTypes, sar, typeLabel as labelOf } from '../lib';
import '../../projects/projects.css';
import '../acc.css';

interface Row { id: string; entryNo: number; voucherLabel: string; voucherNo: string; entryDate: string; documentDate: string; description: string; counterparty: string | null; status: string; source: string; total: number; createdByName: string; cancelReason: string | null }
/** fixedType: شاشة لنوع مستند واحد (مثل قيود التسوية) ضمن مجموعة العمليات */
const props = defineProps<{ fixedType?: string }>();
const typeLabel = computed(() => (props.fixedType ? labelOf(props.fixedType) : ''));
loadDocTypes();
const session = useSession();
const router = useRouter();
const rows = ref<Row[]>([]);
const error = ref('');
const f = reactive({ status: '', type: props.fixedType ?? '', from: '', to: '', q: '' });
let timer: ReturnType<typeof setTimeout> | undefined;
async function load() {
  try {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
    rows.value = await api<Row[]>(`/accounting/entries${qs ? `?${qs}` : ''}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(f, () => { clearTimeout(timer); timer = setTimeout(load, 250); });
const counts = computed(() => ({
  draft: rows.value.filter((r) => r.status === 'draft').length, posted: rows.value.filter((r) => r.status === 'posted').length,
  cancelled: rows.value.filter((r) => r.status === 'cancelled').length,
}));
</script>

<template>
  <div>
    <section class="pm-hero ac-hero">
      <div>
        <p class="pm-kicker">النظام المالي</p>
        <h1>{{ fixedType === 'adjustment' ? 'قيود التسوية' : fixedType ? typeLabel : 'قيود اليومية' }}</h1>
        <p class="pm-sub">رقم القيد مسلسل لا يتكرر ولا يُحذف، والقيد الملغي يبقى برقمه ويظهر «ملغي». سندات القبض والصرف تبدأ أرقامها من محضر الجرد السابق، وباقي المستندات من 1 مع رقم السنة.</p>
      </div>
      <div class="pm-actions">
        <RouterLink v-if="session.can(P.entries)" :to="fixedType ? `/accounting/entries/new?type=${fixedType}` : '/accounting/entries/new'" class="btn ac-glow">{{ fixedType ? `${typeLabel} جديد` : 'قيد جديد' }}</RouterLink>
        <RouterLink v-if="session.can(P.post)" to="/accounting/posting" class="btn ac-ghost">الترحيل الجماعي</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="pm-tabs">
      <button :class="['pm-tab', { on: !f.status }]" @click="f.status = ''">الكل <b>{{ rows.length }}</b></button>
      <button v-for="(s, k) in ENTRY_STATUS" :key="k" :class="['pm-tab', { on: f.status === k }]" @click="f.status = String(k)">{{ s.label }} <b>{{ counts[k as keyof typeof counts] }}</b></button>
    </div>
    <section class="card pm-panel">
      <div class="ac-toolbar">
        <input v-model="f.q" class="input grow" placeholder="ابحث بالبيان أو الجهة أو رقم القيد أو المستند..." />
        <select v-if="!fixedType" v-model="f.type" class="input"><option value="">كل المستندات</option><option v-for="t in allTypes" :key="t.value" :value="t.value">{{ t.label }}</option></select>
        <label class="pm-muted">من <input v-model="f.from" type="date" class="input" /></label>
        <label class="pm-muted">إلى <input v-model="f.to" type="date" class="input" /></label>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>رقم القيد</th><th>المستند</th><th>تاريخ المستند</th><th>البيان</th><th>المبلغ</th><th>الحالة</th><th>بواسطة</th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id" :class="['ac-row-click', { voided: r.status === 'cancelled' }]" @click="router.push(`/accounting/entries/${r.id}`)">
              <td class="ac-code"><b>{{ r.entryNo }}</b></td>
              <td>{{ r.voucherLabel }} <span class="ac-code">{{ r.voucherNo }}</span><span v-if="r.source !== 'manual'" class="pm-tag" style="margin-inline-start: 4px">{{ r.source === 'voucher' ? 'من سند' : 'آلي' }}</span></td>
              <td>{{ r.documentDate }}</td>
              <td><span class="desc">{{ r.description }}</span><span v-if="r.counterparty" class="pm-muted">{{ r.counterparty }}</span><span v-if="r.cancelReason" class="pm-muted reason">{{ r.cancelReason }}</span></td>
              <td class="pm-money">{{ sar(r.total) }}</td>
              <td><span class="pm-pill" :style="{ '--c': ENTRY_STATUS[r.status].color }">{{ ENTRY_STATUS[r.status].label }}</span></td>
              <td class="pm-muted">{{ r.createdByName }}</td>
            </tr>
            <tr v-if="!rows.length"><td colspan="7" class="pm-empty">لا توجد قيود مطابقة</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
td .pm-muted { display: block; }
.voided td { color: var(--muted); }
.voided .desc { text-decoration: line-through; }
.reason { color: var(--danger) !important; }
</style>
