<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../../api';
import { useSession } from '../../../../stores/session';
import CountUp from '../../../beneficiaries/components/CountUp.vue';
import { AF, type Alert, type Group, type Move, type Recon, type Run } from '../../assets';
import { P, sar, shortMonth } from '../../lib';
import '../../../projects/projects.css';
import '../../acc.css';
import './assets.css';

interface Dash {
  kpis: { inBooks: number; draft: number; pending: number; disposed: number; cost: number; accum: number; nbv: number; fully: number; depYear: number; year: number; noCustody: number; openStocktakes: number; consumed: number };
  monthly: { month: string; amount: number }[];
  groups: Group[];
  reconciliation: Recon;
  behind: { id: string; code: string; name: string; through: string | null }[];
  alerts: Alert[];
  pendingOps: Move[];
  lastRuns: Run[];
  disposals: { kind: string; label: string; count: number; gainLoss: number; proceeds: number }[];
}
const session = useSession();
const router = useRouter();
const d = ref<Dash | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    d.value = await api<Dash>(`${AF}/dashboard`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const top = computed(() => Math.max(1, ...(d.value?.monthly ?? []).map((m) => m.amount)));
const totalCost = computed(() => Math.max(1, d.value?.kpis.cost ?? 1));
const COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#6366f1', '#e11d48'];
const badAccounts = computed(() => d.value?.reconciliation.accounts.filter((a) => !a.ok) ?? []);
</script>

<template>
  <div>
    <section class="pm-hero ac-hero fa-hero">
      <div>
        <p class="pm-kicker">النظام المالي · الأصول الثابتة</p>
        <h1>كل أصل معروف مكانه وعهدته وقيمته</h1>
        <p class="pm-sub">المجموعات تحدد الحسابات وطريقة الإهلاك، والسندات تصدر من الأصول نفسها، وأرصدة الدفاتر تُطابَق مع الدليل المحاسبي باستمرار.</p>
      </div>
      <div class="pm-actions">
        <RouterLink v-if="session.can(P.assetsManage)" to="/accounting/assets/register?new=1" class="btn ac-glow">أصل جديد</RouterLink>
        <RouterLink v-if="session.can(P.assetsDepreciate)" to="/accounting/assets/depreciation" class="btn ac-ghost">احتساب الإهلاك</RouterLink>
        <RouterLink v-if="session.can(P.assetsOperate)" to="/accounting/assets/operations" class="btn ac-ghost">العمليات</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <template v-if="d">
      <!-- المطابقة مع الدليل: علامة حمراء واضحة عند أي اختلاف -->
      <section v-if="!d.reconciliation.ok" class="fa-recon-bad">
        <div class="fa-recon-head">
          <span class="dot" />
          <div>
            <b>قيم الأصول لا تطابق أرصدة الدليل المحاسبي ({{ d.reconciliation.issues }} {{ d.reconciliation.issues === 1 ? 'حساب' : 'حسابات' }})</b>
            <div class="sub">حتى {{ d.reconciliation.asOf }}. التفاصيل وسبب الاختلاف لكل حساب:</div>
          </div>
          <RouterLink to="/accounting/assets/groups?tab=recon" class="btn btn-sm">تقرير المطابقة</RouterLink>
        </div>
        <div v-for="a in badAccounts" :key="a.accountId" class="fa-recon-row">
          <div><span class="ac-code">{{ a.code }}</span> {{ a.name }} <span class="pm-tag">{{ a.kindLabel }}</span></div>
          <div class="nums">الدليل {{ sar(a.gl) }} · الأصول {{ sar(a.subledger) }} · <b>الفرق {{ sar(a.diff) }}</b></div>
          <ul><li v-for="(p, i) in a.problems" :key="i">{{ p }}</li></ul>
        </div>
      </section>
      <div v-else class="fa-recon-ok">✓ قيم الأصول في كل المجموعات مطابقة لأرصدة حساباتها في الدليل المحاسبي</div>

      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #0ea5e9; --i: 0"><span>تكلفة الأصول</span><strong><CountUp :value="d.kpis.cost" :decimals="2" /></strong><small>{{ d.kpis.inBooks }} أصل في الدفاتر</small></div>
        <div class="pm-kpi" style="--a: #f59e0b; --i: 1"><span>مجمع الإهلاك</span><strong><CountUp :value="d.kpis.accum" :decimals="2" /></strong><small>استُهلك {{ d.kpis.consumed }}% من التكلفة</small></div>
        <div class="pm-kpi" style="--a: #10b981; --i: 2"><span>صافي القيمة الدفترية</span><strong><CountUp :value="d.kpis.nbv" :decimals="2" /></strong><small>ريال</small></div>
        <div class="pm-kpi" style="--a: #8b5cf6; --i: 3"><span>إهلاك {{ d.kpis.year }}</span><strong><CountUp :value="d.kpis.depYear" :decimals="2" /></strong><small>مرحّل بسندات الإهلاك</small></div>
        <div class="pm-kpi" style="--a: #6366f1; --i: 4"><span>عمليات تنتظر الاعتماد</span><strong><CountUp :value="d.kpis.pending" /></strong><small>{{ d.kpis.draft }} أصل مسجل بلا قيمة</small></div>
        <div class="pm-kpi" style="--a: #ef4444; --i: 5"><span>أصول بلا عهدة</span><strong><CountUp :value="d.kpis.noCustody" /></strong><small>{{ d.kpis.fully }} أصل مُهلك بالكامل</small></div>
      </div>

      <div class="fa-dash">
        <section class="card pm-panel wide">
          <h2>الإهلاك الشهري المرحّل <RouterLink to="/accounting/assets/runs" class="pm-link" style="font-size: .85rem">سجل حركات الإهلاك</RouterLink></h2>
          <p v-if="!d.monthly.length" class="pm-empty">لم يُرحَّل إهلاك هذه السنة بعد</p>
          <div v-else class="fa-bars">
            <div v-for="(m, i) in d.monthly" :key="m.month" class="col" :title="`${shortMonth(m.month)}: ${sar(m.amount)}`">
              <i :style="{ height: Math.max(3, (m.amount / top) * 100) + '%', animationDelay: i * 50 + 'ms' }" />
              <span>{{ shortMonth(m.month) }}</span>
            </div>
          </div>
        </section>

        <section class="card pm-panel">
          <h2>توزيع التكلفة على المجموعات</h2>
          <div class="fa-stack">
            <i v-for="(g, i) in d.groups.filter((x) => x.cost > 0)" :key="g.id" :style="{ width: (g.cost / totalCost) * 100 + '%', background: COLORS[i % COLORS.length] }" :title="`${g.name}: ${sar(g.cost)}`" />
          </div>
          <div v-for="(g, i) in d.groups" :key="g.id" class="fa-grow">
            <span class="sw" :style="{ background: COLORS[i % COLORS.length] }" />
            <span class="grow"><b>{{ g.name }}</b><small class="pm-muted">{{ g.inBooks }} أصل · {{ g.depreciable ? `${g.methodLabel}` : 'لا تُهلك' }}</small></span>
            <span class="ac-num"><b>{{ sar(g.nbv) }}</b><small class="pm-muted">من {{ sar(g.cost) }}</small></span>
          </div>
        </section>

        <section class="card pm-panel">
          <h2>تنبيهات الانتهاء <span class="pm-tag">{{ d.alerts.length }}</span></h2>
          <p v-if="!d.alerts.length" class="pm-empty">لا توجد تواريخ قريبة الانتهاء</p>
          <RouterLink v-for="(a, i) in d.alerts" :key="i" :to="`/accounting/assets/${a.assetId}`" :class="['fa-alert', { expired: a.expired }]">
            <b>{{ a.label }}</b><span>{{ a.name }} <span class="ac-code">{{ a.code }}</span></span><small>{{ a.expired ? 'انتهى في' : 'ينتهي في' }} {{ a.date }}</small>
          </RouterLink>
        </section>

        <section class="card pm-panel">
          <h2>تنتظر اعتماد السند</h2>
          <p v-if="!d.pendingOps.length" class="pm-empty">لا توجد عمليات معلقة</p>
          <RouterLink v-for="o in d.pendingOps" :key="o.id" :to="o.voucher ? `/accounting/vouchers/${o.voucher.id}` : '/accounting/assets/operations'" class="fa-alert pend">
            <b>{{ o.kindLabel }} · {{ sar(o.amount || o.proceeds) }}</b><span>{{ o.asset?.name }}</span><small>سند {{ o.voucher?.kind === 'receipt' ? 'قبض' : 'صرف' }} رقم {{ o.voucher?.serial }}</small>
          </RouterLink>
          <template v-if="d.behind.length">
            <h2 style="margin-top: 14px">أصول متأخر إهلاكها</h2>
            <RouterLink v-for="b in d.behind" :key="b.id" :to="`/accounting/assets/${b.id}`" class="fa-alert">
              <b>{{ b.name }}</b><small>آخر إهلاك {{ b.through ?? 'لم يُحتسب' }}</small>
            </RouterLink>
          </template>
        </section>

        <section class="card pm-panel">
          <h2>الاستبعادات هذه السنة</h2>
          <p v-if="!d.disposals.length" class="pm-empty">لا توجد مبيعات أو تخريد</p>
          <div v-for="x in d.disposals" :key="x.kind" class="fa-grow">
            <span class="grow"><b>{{ x.label }}</b><small class="pm-muted">{{ x.count }} أصل{{ x.proceeds ? ` · المتحصل ${sar(x.proceeds)}` : '' }}</small></span>
            <span :class="['ac-num', x.gainLoss >= 0 ? 'gain' : 'loss']"><b>{{ x.gainLoss >= 0 ? 'ربح' : 'خسارة' }} {{ sar(Math.abs(x.gainLoss)) }}</b></span>
          </div>
        </section>

        <section class="card pm-panel full">
          <h2>آخر حركات الإهلاك</h2>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>الحركة</th><th>الفترة</th><th>النطاق</th><th>الأصول</th><th>المبلغ</th><th>القيد</th></tr></thead>
              <tbody>
                <tr v-for="r in d.lastRuns" :key="r.id" class="ac-row-click" @click="router.push(`/accounting/assets/runs/${r.id}`)">
                  <td><b class="ac-code">{{ r.runNo }}</b> <span class="pm-muted">{{ r.kindLabel }}</span></td><td>{{ r.period }}</td><td>{{ r.scope.label }}</td>
                  <td>{{ r.assetCount }}</td><td class="pm-money">{{ sar(r.total) }}</td><td><span dir="ltr" class="vno">{{ r.entry?.voucherNo }}</span></td>
                </tr>
                <tr v-if="!d.lastRuns.length"><td colspan="6" class="pm-empty">لا توجد حركات إهلاك</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.fa-dash { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.fa-dash .wide { grid-column: span 2; }
.fa-dash .full { grid-column: 1 / -1; }
.vno { white-space: nowrap; font-variant-numeric: tabular-nums; }
.gain { color: #047857; }
.loss { color: #b91c1c; }
@media (max-width: 900px) { .fa-dash { grid-template-columns: 1fr; } .fa-dash .wide, .fa-dash .full { grid-column: auto; } }
</style>
