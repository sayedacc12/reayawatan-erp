<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { fmtDate, fmtNo, label, money, today } from '../labels';
import '../fr.css';

type Col = { key: string; label: string; type?: 'money' | 'date' | 'target' | 'batch' | 'opp' | 'bool' | 'status' | 'num'; total?: boolean };
interface ReportDef { key: string; title: string; hint: string; icon: string; cols: Col[]; link?: (r: Record<string, unknown>) => string | null }

const reports: ReportDef[] = [
  { key: 'donors', title: 'تبرعات الداعمين', hint: 'إجمالي كل داعم في الفترة', icon: '👥', link: (r) => `/fundraising/donors/${r.id}`,
    cols: [{ key: 'donorNo', label: 'رقم' }, { key: 'name', label: 'الداعم' }, { key: 'levelName', label: 'المستوى' }, { key: 'count', label: 'عدد الفرص', type: 'num', total: true },
      { key: 'amount', label: 'الإجمالي', type: 'money', total: true }, { key: 'zakat', label: 'منها زكاة', type: 'money', total: true }, { key: 'lastDonation', label: 'آخر تبرع', type: 'date' }] },
  { key: 'by-target', title: 'التوزيع على البرامج والجهات', hint: 'المبالغ والمحجوز والمخصوم لكل جهة', icon: '🎯',
    cols: [{ key: 'targetKind', label: 'التصنيف', type: 'target' }, { key: 'targetName', label: 'الجهة' }, { key: 'batches', label: 'الدفعات', type: 'num', total: true },
      { key: 'amount', label: 'المبلغ', type: 'money', total: true }, { key: 'reserved', label: 'محجوز', type: 'money', total: true }, { key: 'spent', label: 'مخصوم', type: 'money', total: true },
      { key: 'transferred', label: 'مناقلات', type: 'money', total: true }, { key: 'net', label: 'صافي', type: 'money', total: true }] },
  { key: 'batches', title: 'أرصدة الدفعات', hint: 'كل دفعة ورصيدها الصافي', icon: '🧾', link: (r) => `/fundraising/batches/${r.id}`,
    cols: [{ key: 'batchNo', label: 'الدفعة', type: 'batch' }, { key: 'opportunityNo', label: 'الفرصة', type: 'opp' }, { key: 'donorName', label: 'الداعم' }, { key: 'targetName', label: 'الجهة' },
      { key: 'isZakat', label: 'زكاة', type: 'bool' }, { key: 'amount', label: 'المبلغ', type: 'money', total: true }, { key: 'reserved', label: 'محجوز', type: 'money', total: true },
      { key: 'spent', label: 'مخصوم', type: 'money', total: true }, { key: 'net', label: 'صافي', type: 'money', total: true }] },
  { key: 'zakat', title: 'تقرير الزكاة', hint: 'أموال الزكاة ومصارفها', icon: '✦', link: (r) => `/fundraising/opportunities/${r.id}`,
    cols: [{ key: 'opportunityNo', label: 'الفرصة', type: 'opp' }, { key: 'donorName', label: 'الداعم' }, { key: 'date', label: 'التاريخ', type: 'date' }, { key: 'batchNo', label: 'الدفعة', type: 'batch' },
      { key: 'targetName', label: 'المصرف' }, { key: 'amount', label: 'المبلغ', type: 'money', total: true }, { key: 'spent', label: 'مصروف', type: 'money', total: true }, { key: 'net', label: 'المتبقي', type: 'money', total: true }] },
  { key: 'pledges', title: 'الوعود بالدفع', hint: 'المسدد والمتبقي على كل وعد', icon: '🤝', link: (r) => `/fundraising/opportunities/${r.id}`,
    cols: [{ key: 'opportunityNo', label: 'الفرصة', type: 'opp' }, { key: 'donorName', label: 'الداعم' }, { key: 'date', label: 'التاريخ', type: 'date' }, { key: 'endDate', label: 'انتهاء المشروع', type: 'date' },
      { key: 'amount', label: 'الوعد', type: 'money', total: true }, { key: 'collected', label: 'المسدد', type: 'money', total: true }, { key: 'outstanding', label: 'المتبقي', type: 'money', total: true }] },
  { key: 'banks', title: 'التحصيل حسب الحساب البنكي', hint: 'التبرعات النقدية وسداد الوعود', icon: '🏦',
    cols: [{ key: 'bankName', label: 'البنك' }, { key: 'accountNumber', label: 'رقم الحساب' }, { key: 'count', label: 'العمليات', type: 'num', total: true },
      { key: 'donations', label: 'تبرعات نقدية', type: 'money', total: true }, { key: 'pledgeCollections', label: 'سداد وعود', type: 'money', total: true }, { key: 'total', label: 'الإجمالي', type: 'money', total: true }] },
  { key: 'managers', title: 'أداء مدراء الدعم', hint: 'الداعمون والفرص لكل مدير', icon: '⭐',
    cols: [{ key: 'name', label: 'مدير الدعم' }, { key: 'donors', label: 'الداعمون', type: 'num', total: true }, { key: 'count', label: 'الفرص', type: 'num', total: true },
      { key: 'amount', label: 'الإجمالي', type: 'money', total: true }, { key: 'average', label: 'متوسط الفرصة', type: 'money' }] },
  { key: 'levels', title: 'مستويات الداعمين', hint: 'التبرعات حسب المستوى', icon: '💎',
    cols: [{ key: 'name', label: 'المستوى' }, { key: 'donors', label: 'الداعمون', type: 'num', total: true }, { key: 'count', label: 'الفرص', type: 'num', total: true }, { key: 'amount', label: 'الإجمالي', type: 'money', total: true }] },
];

const router = useRouter();
const active = ref<ReportDef>(reports[0]);
const f = reactive({ from: `${new Date().getFullYear()}-01-01`, to: today() });
const rows = ref<Record<string, unknown>[] | null>(null);
const error = ref('');
async function load() {
  rows.value = null;
  try {
    rows.value = (await api<{ rows: Record<string, unknown>[] }>(`/fundraising/reports/${active.value.key}?from=${f.from}&to=${f.to}`)).rows;
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(() => [active.value, f.from, f.to], load);

function cell(c: Col, v: unknown) {
  if (v === null || v === undefined || v === '') return '—';
  switch (c.type) {
    case 'money': return money(Number(v));
    case 'num': return Number(v).toLocaleString('ar-SA');
    case 'date': return fmtDate(String(v));
    case 'target': return label('target', String(v));
    case 'batch': return fmtNo('B', Number(v));
    case 'opp': return fmtNo('FR', Number(v));
    case 'bool': return v ? 'نعم' : '—';
    default: return String(v);
  }
}
const totals = computed(() => Object.fromEntries(active.value.cols.filter((c) => c.total).map((c) => [c.key, (rows.value ?? []).reduce((s, r) => s + Number(r[c.key] ?? 0), 0)])));
function exportCsv() {
  const cols = active.value.cols;
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = [cols.map((c) => esc(c.label)).join(','), ...(rows.value ?? []).map((r) => cols.map((c) => esc(c.type === 'money' || c.type === 'num' ? String(r[c.key] ?? 0) : cell(c, r[c.key]))).join(','))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${active.value.title}-${f.from}-${f.to}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const print = () => window.print();
</script>

<template>
  <div>
    <div class="page-head no-print">
      <div><h1>تقارير الموارد المالية</h1><p class="muted sub">اختر التقرير والفترة، ثم اطبعه أو صدّره إلى Excel</p></div>
    </div>
    <div class="cards no-print">
      <button v-for="(r, i) in reports" :key="r.key" :class="['rcard', { on: active.key === r.key }]" :style="{ '--i': i }" @click="active = r">
        <span class="ic">{{ r.icon }}</span><b>{{ r.title }}</b><small>{{ r.hint }}</small>
      </button>
    </div>
    <div class="fr-filters no-print">
      <label class="muted">من</label><input v-model="f.from" type="date" class="input" />
      <label class="muted">إلى</label><input v-model="f.to" type="date" class="input" />
      <span class="grow" />
      <button class="btn" :disabled="!rows?.length" @click="exportCsv">تصدير Excel (CSV)</button>
      <button class="btn btn-primary" @click="print">طباعة</button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <section class="fr-panel report">
      <header class="rh"><h2>{{ active.title }}</h2><span class="muted">من {{ fmtDate(f.from) }} إلى {{ fmtDate(f.to) }}</span></header>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th v-for="c in active.cols" :key="c.key">{{ c.label }}</th></tr></thead>
          <tbody>
            <tr v-for="(r, i) in rows ?? []" :key="i" :class="{ 'fr-row-link': !!active.link?.(r) }" @click="active.link?.(r) && router.push(active.link(r)!)">
              <td v-for="c in active.cols" :key="c.key" :class="{ num: c.type === 'money' || c.type === 'num' }">{{ cell(c, r[c.key]) }}</td>
            </tr>
          </tbody>
          <tfoot v-if="rows?.length && Object.keys(totals).length">
            <tr><td v-for="(c, i) in active.cols" :key="c.key" class="num">{{ c.total ? (c.type === 'money' ? money(totals[c.key]) : totals[c.key].toLocaleString('ar-SA')) : i === 0 ? 'الإجمالي' : '' }}</td></tr>
          </tfoot>
        </table>
      </div>
      <p v-if="rows && !rows.length" class="fr-empty">لا توجد بيانات في هذه الفترة</p>
      <div v-if="!rows && !error" class="fr-skeleton" />
    </section>
  </div>
</template>

<style scoped>
.sub { margin: 2px 0 0; font-size: .88rem; }
.cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
.rcard { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; text-align: right; padding: 14px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface);
  cursor: pointer; font: inherit; transition: all .2s var(--ease); animation: fr-rise .4s calc(var(--i) * 45ms) var(--ease) both; }
.rcard small { color: var(--muted); font-size: .78rem; }
.rcard .ic { font-size: 1.3rem; margin-bottom: 4px; }
.rcard:hover { transform: translateY(-2px); border-color: var(--primary); }
.rcard.on { border-color: var(--gold); background: linear-gradient(160deg, #fffbeb, var(--surface)); box-shadow: 0 12px 26px rgba(232,176,75,.2); }
.grow { flex: 1; }
.rh { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; }
.rh h2 { margin: 0; }
.num { font-variant-numeric: tabular-nums; }
tfoot td { font-weight: 700; background: var(--surface-2); border-top: 2px solid var(--border); }
@media (max-width: 900px) { .cards { grid-template-columns: 1fr 1fr; } }
@media print { .report { box-shadow: none; border: 0; } }
</style>
