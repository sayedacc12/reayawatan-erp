<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import CountUp from '../../../shared/CountUp.vue';
import { ENTRY_STATUS, P, sar, shortMonth } from '../lib';
import '../../../shared/module.css';
import '../acc.css';

interface Mismatch { fromYear: number; toYear: number; rows: { accountCode: string; accountName: string; partnerName: string | null; expected: number; actual: number }[] }
interface Dash {
  setup: { hasYear: boolean; chartInstalled: boolean; accounts: number };
  mismatches: Mismatch[];
  year: { id: string; name: number; startDate: string; endDate: string; status: string } | null;
  cash?: { id: string; name: string; kind: string; code: string; balance: number }[];
  revenue?: number; expenses?: number; surplus?: number;
  monthly?: { month: string; revenue: number; expenses: number }[];
  entries?: Record<string, number>;
  receipts?: { approved: { n: number; total: number }; pending: { n: number; total: number } };
  payments?: { approved: { n: number; total: number }; pending: { n: number; total: number } };
  recent?: { id: string; entryNo: number; voucherLabel: string; voucherNo: string; documentDate: string; description: string; status: string; total: number }[];
}
const session = useSession();
const router = useRouter();
const data = ref<Dash | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    data.value = await api<Dash>('/accounting/dashboard');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const cashTotal = computed(() => (data.value?.cash ?? []).reduce((s, c) => s + c.balance, 0));
const top = computed(() => Math.max(1, ...(data.value?.monthly ?? []).flatMap((m) => [m.revenue, m.expenses])));
const ready = computed(() => data.value?.setup.chartInstalled && data.value?.setup.hasYear);
</script>

<template>
  <div>
    <section class="pm-hero ac-hero">
      <div>
        <p class="pm-kicker">النظام المالي{{ data?.year ? ` · السنة المالية ${data.year.name}` : '' }}</p>
        <h1>دفاتر منضبطة، وأرقام تحكي الأثر</h1>
        <p class="pm-sub">قيود متوازنة، سندات معتمدة على مراحل، وفترات تُغلق بمحضر جرد معتمد.</p>
      </div>
      <div class="pm-actions">
        <RouterLink v-if="session.can(P.receipts)" to="/accounting/receipts" class="btn ac-glow">سند قبض</RouterLink>
        <RouterLink v-if="session.can(P.payments)" to="/accounting/payments" class="btn ac-ghost">سند صرف</RouterLink>
        <RouterLink v-if="session.can(P.entries)" to="/accounting/entries/new" class="btn ac-ghost">قيد يومية</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <template v-if="data">
      <div v-for="m in data.mismatches" :key="m.toYear" class="ac-warn pulse">
        <div>
          <b>أرصدة نهاية السنة {{ m.fromYear }} تختلف عن الأرصدة الافتتاحية للسنة {{ m.toYear }}</b>
          <div class="pm-muted">عُدّلت السنة {{ m.fromYear }} بعد فتح السنة التالية ({{ m.rows.length }} حساب). حدّث القيد الافتتاحي من شاشة الافتتاحيات.</div>
        </div>
        <RouterLink to="/accounting/setup" class="btn btn-sm" style="margin-inline-start: auto">الافتتاحيات</RouterLink>
      </div>

      <section v-if="!ready" class="card pm-panel">
        <h2>ابدأ إعداد النظام المالي</h2>
        <div class="ac-steps">
          <div :class="['ac-step', { done: data.setup.chartInstalled || data.setup.accounts > 0 }]">
            <div class="grow"><b>الدليل المحاسبي</b><div class="pm-muted">نصّب دليل الحسابات الموحد للجمعيات الأهلية من الإعدادات، أو أضف حساباتك يدويًا</div></div>
            <RouterLink v-if="session.can(P.settings) && !data.setup.accounts" to="/accounting/settings" class="btn btn-sm btn-primary">تنصيب الدليل</RouterLink>
            <RouterLink v-else to="/accounting/accounts" class="btn btn-sm">الدليل</RouterLink>
          </div>
          <div :class="['ac-step', { done: data.setup.hasYear }]">
            <div class="grow"><b>الافتتاحيات</b><div class="pm-muted">السنة المالية وتاريخ بدايتها ونهايتها، والرقم الضريبي، وبداية أرقام السندات</div></div>
            <RouterLink to="/accounting/setup" class="btn btn-sm btn-primary">الافتتاحيات</RouterLink>
          </div>
          <div class="ac-step">
            <div class="grow"><b>البنوك والنقدية</b><div class="pm-muted">عرّف الحسابات البنكية والصناديق واربطها بالدليل</div></div>
            <RouterLink to="/accounting/banks" class="btn btn-sm">البنوك والنقدية</RouterLink>
          </div>
        </div>
      </section>

      <template v-if="data.year">
        <div class="pm-kpis">
          <div class="pm-kpi" style="--a: #10b981; --i: 0"><span>الإيرادات والتبرعات</span><strong><CountUp :value="data.revenue ?? 0" :decimals="2" /></strong><small>ريال · قيود مرحّلة</small></div>
          <div class="pm-kpi" style="--a: #ef4444; --i: 1"><span>المصروفات</span><strong><CountUp :value="data.expenses ?? 0" :decimals="2" /></strong><small>ريال</small></div>
          <div class="pm-kpi" style="--a: #8b5cf6; --i: 2"><span>{{ (data.surplus ?? 0) >= 0 ? 'فائض النشاط' : 'عجز النشاط' }}</span><strong><CountUp :value="Math.abs(data.surplus ?? 0)" :decimals="2" /></strong><small>يُقفل في صافي الأصول آخر السنة</small></div>
          <div class="pm-kpi" style="--a: #0ea5e9; --i: 3"><span>النقدية والبنوك</span><strong><CountUp :value="cashTotal" :decimals="2" /></strong><small>{{ data.cash?.length ?? 0 }} حساب</small></div>
          <div class="pm-kpi" style="--a: #f59e0b; --i: 4"><span>قيود غير مرحّلة</span><strong><CountUp :value="data.entries?.draft ?? 0" /></strong><small>{{ data.entries?.posted ?? 0 }} مرحّل</small></div>
          <div class="pm-kpi" style="--a: #6366f1; --i: 5"><span>سندات تنتظر الاعتماد</span><strong><CountUp :value="(data.receipts?.pending.n ?? 0) + (data.payments?.pending.n ?? 0)" /></strong><small>قبض {{ data.receipts?.pending.n }} · صرف {{ data.payments?.pending.n }}</small></div>
        </div>

        <div class="ac-dash">
          <section class="card pm-panel wide">
            <h2>الإيرادات والمصروفات شهريًا <span class="pm-legend"><span style="--c: #10b981">إيرادات</span><span style="--c: #ef4444">مصروفات</span></span></h2>
            <div class="bars2">
              <div v-for="(m, i) in data.monthly" :key="m.month" class="col" :title="`${shortMonth(m.month)}: ${sar(m.revenue)} / ${sar(m.expenses)}`">
                <div class="pair">
                  <i class="r" :style="{ height: Math.max(2, (m.revenue / top) * 100) + '%', animationDelay: i * 45 + 'ms' }" />
                  <i class="e" :style="{ height: Math.max(2, (m.expenses / top) * 100) + '%', animationDelay: i * 45 + 25 + 'ms' }" />
                </div>
                <span>{{ shortMonth(m.month) }}</span>
              </div>
            </div>
          </section>

          <section class="card pm-panel">
            <h2>أرصدة البنوك والصناديق</h2>
            <p v-if="!data.cash?.length" class="pm-empty">لم تُعرَّف حسابات بنكية بعد</p>
            <div v-for="c in data.cash" :key="c.id" class="cashrow">
              <span class="ic">{{ c.kind === 'bank' ? '🏦' : '💵' }}</span>
              <span class="grow"><b>{{ c.name }}</b><small class="pm-muted ac-code">{{ c.code }}</small></span>
              <span class="pm-money">{{ sar(c.balance) }}</span>
            </div>
          </section>

          <section class="card pm-panel">
            <h2>السندات المعتمدة</h2>
            <div class="vbox r"><span>سندات القبض</span><strong>{{ sar(data.receipts?.approved.total) }}</strong><small>{{ data.receipts?.approved.n }} سند</small></div>
            <div class="vbox p"><span>سندات الصرف</span><strong>{{ sar(data.payments?.approved.total) }}</strong><small>{{ data.payments?.approved.n }} سند</small></div>
          </section>

          <section class="card pm-panel wide">
            <h2>أحدث القيود <RouterLink to="/accounting/entries" class="pm-link" style="font-size: .85rem">كل القيود</RouterLink></h2>
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>رقم القيد</th><th>المستند</th><th>التاريخ</th><th>البيان</th><th>المبلغ</th><th>الحالة</th></tr></thead>
                <tbody>
                  <tr v-for="e in data.recent" :key="e.id" class="ac-row-click" @click="router.push(`/accounting/entries/${e.id}`)">
                    <td class="ac-code">{{ e.entryNo }}</td><td>{{ e.voucherLabel }} <span class="ac-code">{{ e.voucherNo }}</span></td><td>{{ e.documentDate }}</td>
                    <td>{{ e.description }}</td><td class="pm-money">{{ sar(e.total) }}</td>
                    <td><span class="pm-pill" :style="{ '--c': ENTRY_STATUS[e.status].color }">{{ ENTRY_STATUS[e.status].label }}</span></td>
                  </tr>
                  <tr v-if="!data.recent?.length"><td colspan="6" class="pm-empty">لا توجد قيود بعد</td></tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.ac-dash { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.ac-dash .wide { grid-column: span 2; }
.bars2 { display: flex; gap: 6px; align-items: flex-end; height: 200px; padding-top: 10px; }
.bars2 .col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; height: 100%; }
.bars2 .pair { flex: 1; width: 100%; display: flex; gap: 3px; align-items: flex-end; justify-content: center; }
.bars2 i { width: 42%; max-width: 16px; border-radius: 6px 6px 2px 2px; animation: grow .8s var(--ease) both; transform-origin: bottom; }
.bars2 i.r { background: linear-gradient(180deg, #34d399, #059669); box-shadow: 0 0 12px rgba(16,185,129,.35); }
.bars2 i.e { background: linear-gradient(180deg, #fb7185, #dc2626); box-shadow: 0 0 12px rgba(239,68,68,.3); }
.bars2 span { font-size: .72rem; color: var(--muted); }
.cashrow { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px dashed var(--border); }
.cashrow:last-child { border-bottom: 0; }
.cashrow .ic { font-size: 1.3rem; }
.cashrow .grow { flex: 1; display: flex; flex-direction: column; }
.vbox { border-radius: 14px; padding: 14px; margin-bottom: 10px; display: flex; flex-direction: column; color: #fff; position: relative; overflow: hidden; }
.vbox.r { background: linear-gradient(135deg, #059669, #0f766e); }
.vbox.p { background: linear-gradient(135deg, #b45309, #92400e); }
.vbox::after { content: ''; position: absolute; width: 120px; height: 120px; border-radius: 50%; inset-inline-end: -40px; top: -50px; background: rgba(255,255,255,.12); }
.vbox strong { font-size: 1.3rem; }
.vbox small { opacity: .8; }
@keyframes grow { from { transform: scaleY(0); } }
@media (max-width: 900px) { .ac-dash { grid-template-columns: 1fr; } .ac-dash .wide { grid-column: auto; } }
</style>
