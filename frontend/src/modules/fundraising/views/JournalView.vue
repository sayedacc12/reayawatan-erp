<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import JournalEntryCard from '../components/JournalEntryCard.vue';
import { sar } from '../labels';
import type { LedgerEntry } from '../types';
import '../fr.css';

const rows = ref<LedgerEntry[] | null>(null);
const error = ref('');
const f = reactive({ from: '', to: '', search: '' });
async function load() {
  try {
    const q = new URLSearchParams(Object.entries({ from: f.from, to: f.to }).filter(([, v]) => v));
    rows.value = await api<LedgerEntry[]>(`/fundraising/journal?${q}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(() => [f.from, f.to], load);
const shown = computed(() => (rows.value ?? []).filter((e) => !f.search || e.description.includes(f.search) || String(e.entryNo) === f.search));
const total = computed(() => shown.value.filter((e) => !e.reversalOfId && e.status === 'posted').reduce((s, e) => s + e.total, 0));
const print = () => window.print();
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>قيود اليومية</h1><p class="muted sub">قيود مزدوجة متوازنة تصدر تلقائيًا عند اعتماد الفرص وسداد الوعود، والتصحيح يكون بقيد عكسي</p></div>
      <button class="btn no-print" @click="print">طباعة</button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="fr-filters">
      <input v-model="f.search" class="input grow" placeholder="ابحث في البيان أو برقم القيد" />
      <label class="muted">من</label><input v-model="f.from" type="date" class="input" />
      <label class="muted">إلى</label><input v-model="f.to" type="date" class="input" />
    </div>
    <p v-if="rows" class="muted count">{{ shown.length.toLocaleString('ar-SA') }} قيد · إجمالي القيود السارية {{ sar(total) }}</p>
    <div class="list">
      <JournalEntryCard v-for="e in shown" :key="e.id" :entry="e" />
      <p v-if="rows && !shown.length" class="fr-empty card">لا توجد قيود</p>
    </div>
  </div>
</template>

<style scoped>
.sub { margin: 2px 0 0; font-size: .88rem; }
.count { font-size: .86rem; }
.list { display: flex; flex-direction: column; gap: 12px; }
</style>
