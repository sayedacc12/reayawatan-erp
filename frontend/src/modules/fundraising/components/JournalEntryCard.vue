<script setup lang="ts">
import { fmtDate, hijri, money } from '../labels';
import type { LedgerEntry } from '../types';

/** عرض قيد يومية: رقمه وتاريخه وبيانه وأطرافه المدينة والدائنة */
defineProps<{ entry: LedgerEntry }>();
</script>

<template>
  <div :class="['je', { reversed: entry.status === 'reversed', reversal: entry.reversalOfId }]">
    <div class="je-head">
      <span class="fr-no">قيد {{ entry.entryNo }}</span>
      <span>{{ fmtDate(entry.date) }} <small class="muted">· {{ hijri(entry.date) }}</small></span>
      <span v-if="entry.status === 'reversed'" class="fr-badge" style="--c: #ef4444">معكوس</span>
      <span v-if="entry.reversalOfId" class="fr-badge" style="--c: #8b5cf6">قيد عكسي</span>
      <span class="grow" />
      <b>{{ money(entry.total) }} ر.س</b>
    </div>
    <p class="je-desc">{{ entry.description }}</p>
    <table class="table je-table">
      <thead><tr><th>الحساب</th><th>البيان</th><th>مدين</th><th>دائن</th></tr></thead>
      <tbody>
        <tr v-for="l in entry.lines" :key="l.id">
          <td><span v-if="l.accountCode" class="code">{{ l.accountCode }}</span> {{ l.accountName }}</td>
          <td class="muted">{{ l.memo ?? '' }}</td>
          <td class="dr">{{ l.debit ? money(l.debit) : '' }}</td>
          <td class="cr">{{ l.credit ? money(l.credit) : '' }}</td>
        </tr>
      </tbody>
      <tfoot><tr><td colspan="2">الإجمالي</td><td class="dr">{{ money(entry.total) }}</td><td class="cr">{{ money(entry.total) }}</td></tr></tfoot>
    </table>
  </div>
</template>

<style scoped>
.je { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--surface); }
.je.reversed { opacity: .7; }
.je-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--surface-2); flex-wrap: wrap; font-size: .9rem; }
.je-desc { margin: 0; padding: 8px 14px 0; font-size: .9rem; }
.grow { flex: 1; }
.je-table th, .je-table td { padding: 7px 14px; font-size: .86rem; }
.je-table tfoot td { font-weight: 700; border-top: 2px solid var(--border); background: var(--surface-2); }
.code { font-family: ui-monospace, Menlo, monospace; font-size: .78rem; background: var(--primary-soft); color: var(--primary); padding: 0 6px; border-radius: 5px; }
.dr { color: #0f766e; font-weight: 600; }
.cr { color: #a16207; font-weight: 600; }
</style>
