<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { STATUS_COLOR } from '../lib';
import '../../../shared/module.css';
import '../quality.css';

interface Clause { code: string; title: string; how: string; path: string; status: 'met' | 'partial' | 'gap'; evidenceText: string; documents: { id: string; code: string; title: string }[] }
interface Section { code: string; title: string; score: number; clauses: Clause[] }
const data = ref<{ score: number; sections: Section[] } | null>(null);
const filter = ref<'' | 'met' | 'partial' | 'gap'>('');
onMounted(async () => {
  data.value = await api('/quality/standard');
});
const LABEL = { met: 'مستوفى', partial: 'مستوفى جزئيًا', gap: 'فجوة' };
const ringColor = (v: number) => (v >= 80 ? '#10b981' : v >= 50 ? '#f59e0b' : '#ef4444');
const counts = computed(() => {
  const all = data.value?.sections.flatMap((s) => s.clauses) ?? [];
  return { met: all.filter((c) => c.status === 'met').length, partial: all.filter((c) => c.status === 'partial').length, gap: all.filter((c) => c.status === 'gap').length };
});
</script>

<template>
  <div v-if="data">
    <section class="pm-hero q-hero">
      <div><p class="pm-kicker">ISO 9001:2015</p><h1>متطلبات المواصفة ومصفوفة المطابقة</h1>
        <p class="pm-sub">كل بند من 4 إلى 10، وأين يُطبَّق في النظام، والدليل المحسوب تلقائيًا من بيانات الشركة. استخدمها للاستعداد لمراجعة جهة المنح أو المراجعة الداخلية.</p></div>
    </section>
    <div class="q-grid" style="margin-bottom: 16px">
      <section class="card pm-panel">
        <h2>المطابقة حسب القسم</h2>
        <div class="q-sections">
          <a v-for="(s, i) in data.sections" :key="s.code" :href="`#sec-${s.code}`" class="q-secbox" :style="{ '--i': i }">
            <div class="q-ring sm" :style="{ '--v': s.score, '--c': ringColor(s.score) }"><b>{{ s.score }}%</b></div>
            <div class="t">{{ s.code }}. {{ s.title }}</div><div class="n">{{ s.clauses.length }} بنود</div>
          </a>
        </div>
      </section>
      <section class="card pm-panel" style="text-align: center">
        <h2>المطابقة الكلية</h2>
        <div class="q-ring" :style="{ '--v': data.score, '--c': ringColor(data.score) }"><div><b>{{ data.score }}%</b><small>28 بندًا</small></div></div>
        <div class="q-chips" style="justify-content: center; margin-top: 8px">
          <button v-for="k in (['met', 'partial', 'gap'] as const)" :key="k" :class="['q-chip', { on: filter === k }]" @click="filter = filter === k ? '' : k">
            <i :style="{ width: '8px', height: '8px', borderRadius: '50%', background: STATUS_COLOR[k] }" /> {{ LABEL[k] }} {{ counts[k] }}
          </button>
        </div>
      </section>
    </div>
    <section v-for="s in data.sections" :id="`sec-${s.code}`" :key="s.code" class="card pm-panel" style="margin-bottom: 16px">
      <h2>البند {{ s.code }}: {{ s.title }} <span class="pm-pill" :style="{ '--c': ringColor(s.score) }">{{ s.score }}%</span></h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th style="width: 60px">البند</th><th>المتطلب</th><th>التطبيق في النظام</th><th>الدليل</th><th>الوثائق المعتمدة</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="c in s.clauses.filter((x) => !filter || x.status === filter)" :key="c.code">
            <td><span class="q-code">{{ c.code }}</span></td>
            <td><b>{{ c.title }}</b></td>
            <td>{{ c.how }}<RouterLink :to="c.path" class="pm-link" style="display: block; font-size: .8rem">فتح الشاشة ←</RouterLink></td>
            <td class="pm-muted">{{ c.evidenceText }}</td>
            <td><div class="q-chips"><RouterLink v-for="d in c.documents" :key="d.id" :to="`/quality/documents/${d.id}`" class="q-code" :title="d.title">{{ d.code }}</RouterLink></div><span v-if="!c.documents.length" class="pm-muted">—</span></td>
            <td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[c.status] }">{{ LABEL[c.status] }}</span></td>
          </tr>
        </tbody>
      </table></div>
    </section>
  </div>
</template>
