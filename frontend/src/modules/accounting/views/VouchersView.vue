<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import CountUp from '../../beneficiaries/components/CountUp.vue';
import VoucherForm from '../components/VoucherForm.vue';
import { P, VOUCHER_STATUS, sar } from '../lib';
import '../../projects/projects.css';
import '../acc.css';

interface Row { id: string; serial: number; voucherDate: string; partyName: string; amount: number; purpose: string; methodLabel: string; cashAccountName: string; counterAccount: string; status: string; stageName: string | null; requestKind: string | null; awaitingMe: boolean; createdByName: string }
interface List { items: Row[]; counts: Record<string, { count: number; total: number }>; stagesCount: number }
const props = defineProps<{ kind: 'receipt' | 'payment' }>();
const session = useSession();
const router = useRouter();
const data = ref<List | null>(null);
const error = ref('');
const f = reactive({ status: '', q: '', from: '', to: '', mine: '' });
const showForm = ref(false);
const isR = computed(() => props.kind === 'receipt');
let timer: ReturnType<typeof setTimeout> | undefined;
async function load() {
  try {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
    data.value = await api<List>(`/accounting/vouchers/${props.kind}${qs ? `?${qs}` : ''}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(() => props.kind, () => { Object.assign(f, { status: '', q: '', from: '', to: '', mine: '' }); load(); });
watch(f, () => { clearTimeout(timer); timer = setTimeout(load, 250); });
const c = (s: string) => data.value?.counts[s] ?? { count: 0, total: 0 };
const pendingCount = computed(() => c('draft').count + c('pending').count + c('returned').count);
const canCreate = computed(() => session.can(isR.value ? P.receipts : P.payments));
function saved(r: { id: string }) {
  showForm.value = false;
  router.push(`/accounting/vouchers/${r.id}`);
}
</script>

<template>
  <div>
    <section :class="['pm-hero', 'ac-hero', kind]">
      <div>
        <p class="pm-kicker">النظام المالي</p>
        <h1>{{ isR ? 'سندات القبض' : 'سندات الصرف' }}</h1>
        <p class="pm-sub">{{ isR
          ? 'كل سند يمر بمراحل الاعتماد المحددة في الإعدادات، وعند الاعتماد النهائي يصبح قيدًا مرحّلًا برقم السند. الإلغاء أو الإعادة للمسودة باعتماد ثنائي.'
          : 'سندات الصرف تمر بمراحل اعتمادها المستقلة، ويمكن تحميلها على حساب تحليلي. لا يعيدها للمسودة أو يلغيها إلا المعتمد النهائي.' }}</p>
      </div>
      <div class="pm-actions"><button v-if="canCreate" class="btn ac-glow" @click="showForm = true">{{ isR ? 'سند قبض جديد' : 'سند صرف جديد' }}</button></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <template v-if="data">
      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #10b981; --i: 0"><span>معتمد ومرحّل</span><strong><CountUp :value="c('approved').total" :decimals="2" /></strong><small>{{ c('approved').count }} سند · ريال</small></div>
        <div class="pm-kpi" style="--a: #6366f1; --i: 1"><span>قيد الاعتماد</span><strong><CountUp :value="pendingCount" /></strong><small>{{ sar(c('draft').total + c('pending').total + c('returned').total) }}</small></div>
        <div class="pm-kpi" style="--a: #ef4444; --i: 2"><span>ملغي أو مرفوض</span><strong><CountUp :value="c('cancelled').count + c('rejected').count" /></strong><small>أرقامها محفوظة</small></div>
        <div class="pm-kpi" style="--a: #f59e0b; --i: 3"><span>مراحل الاعتماد</span><strong>{{ data.stagesCount }}</strong><small>{{ data.stagesCount ? 'من إعدادات النظام المالي' : 'اعتماد مباشر' }}</small></div>
      </div>

      <div class="pm-tabs">
        <button :class="['pm-tab', { on: !f.status && !f.mine }]" @click="f.status = ''; f.mine = ''">الكل</button>
        <button :class="['pm-tab', { on: f.mine === '1' }]" @click="f.mine = '1'; f.status = ''">بانتظار قراري <b>{{ data.items.filter((i) => i.awaitingMe).length || '' }}</b></button>
        <button v-for="(s, k) in VOUCHER_STATUS" :key="k" :class="['pm-tab', { on: f.status === k && !f.mine }]" @click="f.status = String(k); f.mine = ''">{{ s.label }} <b>{{ c(String(k)).count }}</b></button>
      </div>

      <section class="card pm-panel">
        <div class="ac-toolbar">
          <input v-model="f.q" class="input grow" placeholder="ابحث برقم السند أو الجهة أو البيان..." />
          <label class="pm-muted">من <input v-model="f.from" type="date" class="input" /></label>
          <label class="pm-muted">إلى <input v-model="f.to" type="date" class="input" /></label>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>رقم السند</th><th>التاريخ</th><th>{{ isR ? 'من السادة' : 'إلى السادة' }}</th><th>البيان</th><th>المبلغ</th><th>{{ isR ? 'المستلِم' : 'من' }}</th><th>الحالة</th></tr></thead>
            <tbody>
              <tr v-for="r in data.items" :key="r.id" :class="['ac-row-click', { voided: r.status === 'cancelled' || r.status === 'rejected', mine: r.awaitingMe }]" @click="router.push(`/accounting/vouchers/${r.id}`)">
                <td class="ac-code"><b>{{ r.serial }}</b></td>
                <td>{{ r.voucherDate }}</td>
                <td><b>{{ r.partyName }}</b></td>
                <td><span class="desc">{{ r.purpose }}</span><span class="pm-muted">{{ r.counterAccount }}</span></td>
                <td class="pm-money">{{ sar(r.amount) }}</td>
                <td><span>{{ r.cashAccountName }}</span><span class="pm-muted">{{ r.methodLabel }}</span></td>
                <td>
                  <span class="pm-pill" :style="{ '--c': VOUCHER_STATUS[r.status].color }">{{ VOUCHER_STATUS[r.status].label }}</span>
                  <span v-if="r.stageName" class="pm-muted">{{ r.stageName }}</span>
                  <span v-if="r.requestKind" class="pm-muted req">طلب {{ r.requestKind === 'draft' ? 'إعادة للمسودة' : 'إلغاء' }}</span>
                </td>
              </tr>
              <tr v-if="!data.items.length"><td colspan="7" class="pm-empty">لا توجد سندات</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <div v-if="showForm" class="modal-backdrop" @click.self="showForm = false">
      <div class="modal modal-wide vmodal"><VoucherForm :kind="kind" :org-name="session.user?.organizationName ?? ''" @saved="saved" @close="showForm = false" /></div>
    </div>
  </div>
</template>

<style scoped>
.ac-hero.payment::before { background: radial-gradient(460px 220px at 88% -10%, rgba(251,146,60,.45), transparent 70%), radial-gradient(520px 260px at 5% 130%, rgba(180,83,9,.5), transparent 70%); }
td .pm-muted { display: block; }
.voided td { color: var(--muted); }
.voided .desc { text-decoration: line-through; }
tr.mine { box-shadow: inset 4px 0 0 #6366f1; background: #eef2ff; }
.req { color: #b45309 !important; font-weight: 600; }
.vmodal { max-width: 900px; padding: 0; background: none; box-shadow: none; }
</style>
