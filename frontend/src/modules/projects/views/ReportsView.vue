<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { fmtDate, num, sar } from '../labels';
import '../projects.css';

interface Def { key: string; name: string; description: string; dated?: boolean }
interface Col { key: string; label: string; type?: 'money' | 'number' | 'date' | 'percent' | 'text' }
interface Report { key: string; name: string; description: string; from: string | null; to: string | null; columns: Col[]; rows: Record<string, unknown>[]; totals: Record<string, number> }

const defs = ref<Def[]>([]);
const active = ref<Def | null>(null);
const report = ref<Report | null>(null);
const from = ref('');
const to = ref('');
const loading = ref(false);
const error = ref('');

onMounted(async () => {
  try {
    defs.value = await api<Def[]>('/projects-ops/reports');
    if (defs.value.length) await run(defs.value[0]);
  } catch (e) {
    error.value = (e as Error).message;
  }
});

async function run(d: Def = active.value!) {
  active.value = d;
  loading.value = true;
  error.value = '';
  try {
    const qs = new URLSearchParams();
    if (d.dated && from.value) qs.set('from', from.value);
    if (d.dated && to.value) qs.set('to', to.value);
    report.value = await api<Report>(`/projects-ops/reports/${d.key}${qs.toString() ? `?${qs}` : ''}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

function cell(c: Col, v: unknown) {
  if (v === null || v === undefined || v === '') return '—';
  if (c.type === 'money') return sar(Number(v));
  if (c.type === 'number') return num(Number(v));
  if (c.type === 'percent') return `${num(Number(v))}%`;
  if (c.type === 'date') return fmtDate(v as string);
  return String(v);
}

function csv() {
  const r = report.value;
  if (!r) return;
  const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [r.columns.map((c) => esc(c.label)).join(','), ...r.rows.map((row) => r.columns.map((c) => esc(row[c.key])).join(','))];
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${r.name}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
const print = () => window.print();
</script>

<template>
  <div class="reports">
    <section class="pm-hero no-print">
      <div><p class="pm-kicker">تقارير المشاريع</p><h1>قسم التقارير</h1><p class="pm-sub">تقارير الموقف المالي والدعم والصرف والمستفيدين والمناقلات والتعديلات والاعتماد، مع التصدير إلى Excel والطباعة.</p></div>
    </section>
    <div class="layout">
      <nav class="card list no-print">
        <button v-for="(d, i) in defs" :key="d.key" class="rep" :class="{ on: active?.key === d.key }" :style="{ '--i': i }" @click="run(d)">
          <strong>{{ d.name }}</strong><small>{{ d.description }}</small>
        </button>
      </nav>
      <section class="card pm-panel body">
        <div v-if="error" class="alert alert-error">{{ error }}</div>
        <template v-if="report">
          <div class="head">
            <div><h2 style="margin: 0">{{ report.name }}</h2><p class="pm-muted">{{ report.description }}<template v-if="report.from || report.to"> · من {{ fmtDate(report.from) }} إلى {{ fmtDate(report.to) }}</template></p></div>
            <div class="pm-actions no-print">
              <template v-if="active?.dated">
                <input v-model="from" type="date" class="input" title="من تاريخ" />
                <input v-model="to" type="date" class="input" title="إلى تاريخ" />
                <button class="btn btn-sm" @click="run()">تطبيق</button>
              </template>
              <button class="btn btn-sm" :disabled="!report.rows.length" @click="csv">تصدير Excel</button>
              <button class="btn btn-sm" @click="print">طباعة</button>
            </div>
          </div>
          <div class="table-wrap" :style="{ opacity: loading ? 0.5 : 1 }">
            <table class="table">
              <thead><tr><th v-for="c in report.columns" :key="c.key">{{ c.label }}</th></tr></thead>
              <tbody>
                <tr v-for="(row, i) in report.rows" :key="i"><td v-for="c in report.columns" :key="c.key" :class="{ 'pm-money': c.type === 'money' }">{{ cell(c, row[c.key]) }}</td></tr>
                <tr v-if="!report.rows.length"><td :colspan="report.columns.length" class="pm-empty">لا توجد بيانات</td></tr>
              </tbody>
              <tfoot v-if="report.rows.length && Object.keys(report.totals).length">
                <tr><td v-for="(c, i) in report.columns" :key="c.key" class="pm-money">{{ i === 0 ? 'الإجمالي' : c.key in report.totals ? sar(report.totals[c.key]) : '' }}</td></tr>
              </tfoot>
            </table>
          </div>
          <p class="pm-muted">{{ num(report.rows.length) }} سطر</p>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.layout { display: grid; grid-template-columns: 280px 1fr; gap: 16px; align-items: start; }
.list { padding: 8px; display: grid; gap: 4px; position: sticky; top: 16px; }
.rep { text-align: start; background: none; border: 1px solid transparent; border-radius: 12px; padding: 10px 12px; cursor: pointer; font: inherit; display: flex; flex-direction: column; gap: 2px;
  animation: pm-rise .4s calc(var(--i) * 40ms) var(--ease) both; transition: background .2s, border-color .2s; }
.rep small { color: var(--muted); font-size: .76rem; }
.rep:hover { background: var(--surface-2); }
.rep.on { background: var(--primary-soft); border-color: var(--primary); }
.rep.on strong { color: var(--primary); }
.head { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.head .input { width: auto; }
.head .pm-actions { align-items: center; align-self: flex-start; }
tfoot td { font-weight: 700; background: var(--surface-2); }
@media (max-width: 860px) { .layout { grid-template-columns: 1fr; } .list { position: static; } }
@media print { .no-print { display: none !important; } .layout { display: block; } .body { box-shadow: none; border: 0; } }
</style>
