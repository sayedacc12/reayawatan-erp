<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { exportCsv, fmtDate, num, sar, todayStr } from '../lib';
import '../../../shared/module.css';
import '../members.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Bar = { label: string; count: number; amount?: number; color?: string };
const toast = useToast();
const from = ref(`${todayStr().slice(0, 4)}-01-01`);
const to = ref(todayStr());
const r = ref<any>(null);
const tab = ref('members');
const TABS = [{ k: 'members', l: 'الأعضاء' }, { k: 'revenue', l: 'الإيرادات' }, { k: 'applications', l: 'الطلبات' }];
async function load() {
  try {
    r.value = await api(`/members/reports?from=${from.value}&to=${to.value}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
const max = (rows: Bar[], k: 'count' | 'amount' = 'count') => Math.max(1, ...rows.map((x) => x[k] ?? 0));
const printNow = () => window.print();
function exportTab() {
  const d = r.value;
  const rows = (title: string, list: Bar[]) => [[title, '', ''], ...list.map((x) => [x.label, x.count, x.amount ?? '']), ['', '', '']];
  if (tab.value === 'members') {
    exportCsv('تقرير الأعضاء', ['البند', 'العدد', ''], [
      ...rows('حسب الحالة', d.members.byStatus), ...rows('حسب النوع', d.members.byType), ...rows('حسب الجنس', d.members.byGender),
      ...rows('حسب المدينة', d.members.byCity), ...rows('حسب الجنسية', d.members.byNationality), ...rows('حسب العمر', d.members.byAge),
    ]);
  } else if (tab.value === 'revenue') {
    exportCsv('تقرير إيرادات الاشتراكات', ['البند', 'العدد', 'المبلغ'], [
      ...rows('حسب طريقة السداد', d.revenue.byMethod), ...rows('حسب النوع', d.revenue.byKind), ...rows('حسب نوع العضوية', d.revenue.byType),
      ['حسب الشهر', '', ''], ...d.revenue.monthly.map((x: any) => [x.month, '', x.amount]),
    ]);
  } else {
    exportCsv('تقرير طلبات العضوية', ['البند', 'العدد', ''], [...rows('حسب الحالة', d.applications.byStatus), ...rows('حسب المصدر', d.applications.bySource)]);
  }
}
</script>

<template>
  <div>
    <section class="pm-hero mb-hero no-print">
      <div><p class="pm-kicker">التقارير</p><h1>تقارير العضوية</h1><p class="pm-sub">الأعضاء وتوزيعهم، إيرادات الاشتراكات، نسبة التجديد، والطلبات ومدة اعتمادها، لأي فترة. كل تقرير يُطبع أو يُصدَّر إلى Excel.</p></div>
      <div class="pm-actions">
        <input v-model="from" type="date" class="input" style="width: auto" /><input v-model="to" type="date" class="input" style="width: auto" />
        <button class="btn mb-glow" @click="load">عرض</button>
      </div>
    </section>
    <template v-if="r">
      <div class="pm-kpis no-print">
        <div class="pm-kpi" style="--a: #164e38; --i: 0"><span>الأعضاء الساريون</span><strong>{{ r.members.current }}</strong><small>{{ r.members.joinedInPeriod }} انضموا في الفترة</small></div>
        <div class="pm-kpi" style="--a: #fbbf24; --i: 1"><span>إيرادات الاشتراكات</span><strong>{{ num(r.revenue.total) }}</strong><small>ريال · {{ r.revenue.count }} سداد</small></div>
        <div class="pm-kpi" style="--a: #1e3a8a; --i: 2"><span>نسبة التجديد</span><strong>{{ r.renewal.rate !== null ? `${num(r.renewal.rate)}%` : '—' }}</strong><small>{{ r.renewal.renewed }} جددوا · {{ r.renewal.lapsed }} لم يجددوا</small></div>
        <div class="pm-kpi" style="--a: #ef4444; --i: 3"><span>مطالبات غير مسددة</span><strong>{{ sar(r.outstanding.amount) }}</strong><small>{{ r.outstanding.count }} مطالبة · {{ r.outstanding.overdue }} متأخرة</small></div>
      </div>
      <div class="mb-toolbar no-print">
        <div class="mb-tabs" style="margin: 0"><button v-for="t in TABS" :key="t.k" :class="['mb-tab', { on: tab === t.k }]" @click="tab = t.k">{{ t.l }}</button></div>
        <span class="grow" />
        <button class="btn btn-sm" @click="exportTab">تصدير Excel</button>
        <button class="btn btn-sm" @click="printNow">طباعة</button>
      </div>
      <section class="card pm-panel mb-print">
        <h2>تقرير {{ TABS.find((t) => t.k === tab)?.l }} <span class="pm-muted">من {{ fmtDate(r.from) }} إلى {{ fmtDate(r.to) }}</span></h2>

        <div v-if="tab === 'members'" class="mb-grid">
          <div v-for="g in [
            { t: 'حسب الحالة (كل السجل)', rows: r.members.byStatus },
            { t: 'الساريون حسب النوع', rows: r.members.byType },
            { t: 'حسب الجنس', rows: r.members.byGender },
            { t: 'حسب الفئة العمرية', rows: r.members.byAge },
            { t: 'حسب المدينة', rows: r.members.byCity },
            { t: 'حسب الجنسية', rows: r.members.byNationality },
          ]" :key="g.t">
            <div class="mb-sec">{{ g.t }}</div>
            <div class="mb-bars"><div v-for="x in g.rows" :key="x.label" class="r"><span>{{ x.label }}</span><span class="mb-bar"><i :style="{ width: (x.count / max(g.rows)) * 100 + '%', background: x.color }" /></span><b>{{ x.count }}</b></div></div>
            <p v-if="!g.rows.length" class="mb-empty">لا توجد بيانات</p>
          </div>
          <div>
            <div class="mb-sec">الجمعية العمومية</div>
            <p>أصحاب حق التصويت: <b>{{ r.members.voting }}</b> · النصاب: <b>{{ r.members.quorum }}</b></p>
          </div>
        </div>

        <div v-else-if="tab === 'revenue'" class="mb-grid">
          <div v-for="g in [{ t: 'حسب طريقة السداد', rows: r.revenue.byMethod }, { t: 'جديدة وتجديد', rows: r.revenue.byKind }, { t: 'حسب نوع العضوية', rows: r.revenue.byType }]" :key="g.t">
            <div class="mb-sec">{{ g.t }}</div>
            <table class="table"><thead><tr><th>البند</th><th>العدد</th><th>المبلغ</th></tr></thead>
              <tbody><tr v-for="x in g.rows" :key="x.label"><td>{{ x.label }}</td><td>{{ x.count }}</td><td class="pm-money">{{ sar(x.amount) }}</td></tr>
                <tr v-if="!g.rows.length"><td colspan="3" class="pm-empty">لا توجد إيرادات في الفترة</td></tr></tbody></table>
          </div>
          <div>
            <div class="mb-sec">حسب الشهر</div>
            <div class="mb-bars"><div v-for="x in r.revenue.monthly" :key="x.month" class="r"><span class="mb-code">{{ x.month }}</span><span class="mb-bar"><i :style="{ width: (x.amount / Math.max(1, ...r.revenue.monthly.map((y: any) => y.amount))) * 100 + '%' }" /></span><b>{{ num(x.amount) }}</b></div></div>
            <p v-if="r.revenue.withoutVoucher" class="pm-viol" style="margin-top: 10px">{{ r.revenue.withoutVoucher }} سداد بلا سند قبض في النظام المالي. أكمل الربط من الإعدادات ثم أعد المحاولة من المطالبة.</p>
          </div>
        </div>

        <div v-else class="mb-grid">
          <div>
            <div class="mb-sec">حسب الحالة ({{ r.applications.total }} طلب)</div>
            <div class="mb-bars"><div v-for="x in r.applications.byStatus" :key="x.status" class="r"><span>{{ x.label }}</span><span class="mb-bar"><i :style="{ width: (x.count / max(r.applications.byStatus)) * 100 + '%' }" /></span><b>{{ x.count }}</b></div></div>
          </div>
          <div>
            <div class="mb-sec">حسب المصدر</div>
            <div class="mb-bars"><div v-for="x in r.applications.bySource" :key="x.label" class="r"><span>{{ x.label }}</span><span class="mb-bar"><i :style="{ width: (x.count / max(r.applications.bySource)) * 100 + '%' }" /></span><b>{{ x.count }}</b></div></div>
            <p style="margin-top: 14px">متوسط مدة البت في الطلب: <b>{{ r.applications.avgDays !== null ? `${num(r.applications.avgDays)} يوم` : '—' }}</b></p>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
