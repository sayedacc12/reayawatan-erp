<script setup lang="ts">
/**
 * تقرير الإهلاك بالعرض: صفحة رئيسية بطريقة عرض الميزانية لكل مجموعة (رصيد الأصول أول الفترة، الإضافات، الاستبعادات، رصيد آخر الفترة،
 * ثم مجمع الإهلاك أول الفترة، والإهلاك المحتسب، ومجمع آخر الفترة) مع إجمالي الصفحة، ثم صفحة مستقلة لكل أصل.
 */
import { computed } from 'vue';
import type { AssetReportRow, DepReport } from '../assets';
import { money, monthName } from '../lib';

const props = defineProps<{ report: DepReport; title: string; subtitle?: string; organization?: string; status?: string }>();
const assets = computed(() => props.report.assets.filter((a) => a.depreciation > 0 || a.costOpening || a.costClosing || a.additions || a.disposals));
const n = (v: number) => (v ? money(v) : '—');
const accumAfter = (a: AssetReportRow) => a.accumOpening + a.depreciation + a.otherDepreciation;
</script>

<template>
  <div class="dep-report">
    <section class="sheet">
      <header class="rh">
        <div><b>{{ organization }}</b><small>الأصول الثابتة</small></div>
        <div class="t"><h2>{{ title }}</h2><small>{{ subtitle ?? `${monthName(report.period)} · حتى ${report.toDate}` }}</small></div>
        <div class="s"><span v-if="status" class="stamp">{{ status }}</span><small>{{ report.assetCount }} أصل · الإهلاك {{ money(report.total) }} ر.س</small></div>
      </header>
      <table class="rt">
        <thead>
          <tr><th rowspan="2">المجموعة</th><th rowspan="2">عدد</th><th colspan="4" class="cost">تكلفة الأصول</th><th colspan="5" class="acc">مجمع الإهلاك</th><th rowspan="2">صافي القيمة</th></tr>
          <tr>
            <th class="cost">أول الفترة</th><th class="cost">الإضافات</th><th class="cost">الاستبعادات</th><th class="cost">آخر الفترة</th>
            <th class="acc">أول الفترة</th><th class="acc">الإهلاك المحتسب</th><th class="acc">إهلاك جزئي للمستبعد</th><th class="acc">مجمع المستبعد</th><th class="acc">آخر الفترة</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in report.groups" :key="g.groupId">
            <td><b>{{ g.groupName }}</b></td><td>{{ g.assets }}</td>
            <td>{{ n(g.costOpening) }}</td><td>{{ n(g.additions) }}</td><td>{{ n(g.disposals) }}</td><td><b>{{ n(g.costClosing) }}</b></td>
            <td>{{ n(g.accumOpening) }}</td><td class="hl">{{ n(g.depreciation) }}</td><td>{{ n(g.otherDepreciation) }}</td><td>{{ n(g.accumDisposed) }}</td><td><b>{{ n(g.accumClosing) }}</b></td>
            <td><b>{{ n(g.nbv) }}</b></td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2">إجمالي الصفحة</td>
            <td>{{ money(report.totals.costOpening) }}</td><td>{{ money(report.totals.additions) }}</td><td>{{ money(report.totals.disposals) }}</td><td>{{ money(report.totals.costClosing) }}</td>
            <td>{{ money(report.totals.accumOpening) }}</td><td class="hl">{{ money(report.totals.depreciation) }}</td><td>{{ money(report.totals.otherDepreciation) }}</td><td>{{ money(report.totals.accumDisposed) }}</td><td>{{ money(report.totals.accumClosing) }}</td>
            <td>{{ money(report.totals.nbv) }}</td>
          </tr>
        </tfoot>
      </table>
      <p class="note">المبالغ بالريال السعودي. «إهلاك جزئي للمستبعد» هو إهلاك الأصول المباعة أو المخردة من آخر إهلاك حتى تاريخ استبعادها خلال الفترة.</p>
    </section>

    <section v-for="a in assets" :key="a.assetId" class="sheet asset">
      <header class="rh">
        <div><b>{{ a.name }}</b><small class="code">{{ a.code }}</small></div>
        <div class="t"><h2>بطاقة إهلاك الأصل</h2><small>{{ monthName(report.period) }}</small></div>
        <div class="s"><small>{{ a.groupName }} · {{ a.status }}</small></div>
      </header>
      <div class="grid">
        <dl>
          <dt>تاريخ الخدمة</dt><dd>{{ a.inServiceDate ?? '—' }}</dd>
          <dt>الطريقة</dt><dd>{{ a.methodLabel }}{{ a.rate ? ` · ${a.rate}%` : '' }}{{ a.lifeYears ? ` · ${a.lifeYears} سنة` : '' }}</dd>
          <dt>تكلفة الشراء</dt><dd>{{ money(a.purchaseCost) }}</dd>
          <dt>القيمة التخريدية</dt><dd>{{ money(a.salvage) }}</dd>
          <dt>العهدة</dt><dd>{{ a.custodianName ?? '—' }}</dd>
          <dt>الموقع</dt><dd>{{ a.location ?? '—' }}</dd>
        </dl>
        <table class="mini">
          <tbody>
            <tr><th>تكلفة الأصل أول الفترة</th><td>{{ money(a.costOpening) }}</td></tr>
            <tr><th>+ الإضافات</th><td>{{ money(a.additions) }}</td></tr>
            <tr><th>− الاستبعادات</th><td>{{ money(a.disposals) }}</td></tr>
            <tr class="sum"><th>تكلفة الأصل آخر الفترة</th><td>{{ money(a.costClosing) }}</td></tr>
            <tr><th>مجمع الإهلاك أول الفترة</th><td>{{ money(a.accumOpening) }}</td></tr>
            <tr class="hl"><th>+ مصروف الإهلاك المحتسب{{ a.from ? ` (${a.from} إلى ${a.to})` : '' }}</th><td>{{ money(a.depreciation + a.otherDepreciation) }}</td></tr>
            <tr class="sum"><th>رصيد الإهلاك بعد إهلاك الفترة</th><td>{{ money(accumAfter(a)) }}</td></tr>
            <tr v-if="a.accumDisposed"><th>− مجمع المستبعد</th><td>{{ money(a.accumDisposed) }}</td></tr>
            <tr class="sum"><th>صافي القيمة الدفترية</th><td>{{ money(a.nbv) }}</td></tr>
          </tbody>
        </table>
      </div>
      <p v-if="a.catchUp" class="warn">احتساب متأخر: آخر إهلاك لهذا الأصل كان حتى {{ a.lastDepreciated }}، فيشمل هذا الاحتساب الأشهر السابقة غير المحتسبة.</p>
      <p v-if="a.note" class="warn">{{ a.note }}</p>
      <table v-if="a.months.length" class="rt months">
        <thead><tr><th>الشهر</th><th>من</th><th>إلى</th><th>نسبة الشهر</th><th>الإهلاك</th></tr></thead>
        <tbody><tr v-for="m in a.months" :key="m.month"><td>{{ monthName(m.month) }}</td><td>{{ m.from }}</td><td>{{ m.to }}</td><td>{{ Math.round(m.fraction * 1000) / 10 }}%</td><td>{{ money(m.amount) }}</td></tr></tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.dep-report { display: flex; flex-direction: column; gap: 18px; }
.sheet { background: #fff; color: #0f172a; border-radius: 14px; padding: 22px 26px; border: 1px solid var(--border); box-shadow: 0 14px 34px rgba(15,23,42,.07); overflow-x: auto; }
.rh { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: center; border-bottom: 3px double #164e38; padding-bottom: 10px; margin-bottom: 14px; }
.rh > div { display: flex; flex-direction: column; }
.rh .t { text-align: center; }
.rh .t h2 { font-size: 1.1rem; margin: 0; }
.rh .s { align-items: flex-end; }
.rh small { color: #64748b; }
.code { font-family: ui-monospace, monospace; direction: ltr; }
.stamp { border: 2px solid #164e38; color: #164e38; border-radius: 6px; padding: 0 10px; font-weight: 800; transform: rotate(-4deg); }
.rt { width: 100%; border-collapse: collapse; font-size: .82rem; font-variant-numeric: tabular-nums; min-width: 900px; }
.rt th, .rt td { border: 1px solid #cbd5e1; padding: 6px 7px; text-align: center; white-space: nowrap; }
.rt td:first-child { text-align: start; }
.rt thead th { background: #f1f5f9; font-weight: 700; }
.rt th.cost { background: #e0f2fe; }
.rt th.acc { background: #fef3c7; }
.rt .hl { background: #fff7ed; font-weight: 700; color: #9a3412; }
.rt tfoot td { background: #164e38; color: #fff; font-weight: 800; }
.rt tfoot td.hl { background: #b45309; color: #fff; }
.note { font-size: .78rem; color: #64748b; margin-top: 10px; }
.grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); gap: 18px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 12px; font-size: .88rem; margin: 0; }
dt { color: #64748b; }
dd { margin: 0; font-weight: 600; }
.mini { width: 100%; border-collapse: collapse; font-size: .86rem; font-variant-numeric: tabular-nums; }
.mini th, .mini td { border-bottom: 1px solid #e2e8f0; padding: 5px 8px; text-align: start; }
.mini td { text-align: end; }
.mini .sum th, .mini .sum td { font-weight: 800; border-bottom: 2px solid #164e38; }
.mini .hl th, .mini .hl td { color: #9a3412; font-weight: 700; }
.months { min-width: 0; margin-top: 12px; }
.warn { margin-top: 10px; font-size: .84rem; color: #9a3412; background: #fff7ed; border-radius: 8px; padding: 6px 10px; }
@media print {
  @page { size: A4 landscape; margin: 10mm; }
  .sheet { box-shadow: none; border: 0; border-radius: 0; padding: 0; page-break-after: always; overflow: visible; }
  .sheet:last-child { page-break-after: auto; }
  .rt { min-width: 0; }
}
@media (max-width: 800px) { .grid { grid-template-columns: 1fr; } .rh { grid-template-columns: 1fr; } .rh .s { align-items: flex-start; } }
</style>
