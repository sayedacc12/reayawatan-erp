<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import JournalEntryCard from '../components/JournalEntryCard.vue';
import { color, fmtDate, fmtNo, hijri, label, sar } from '../labels';
import type { Batch, LedgerEntry } from '../types';
import '../fr.css';

interface BatchDetail extends Batch {
  donorName: string; opportunityNo: number; opportunityKind: string; opportunityStatus: string; parentBatchNo: number | null;
  children: { id: string; batchNo: number; targetName: string; amount: number; status: string }[]; entries: LedgerEntry[];
}
const route = useRoute();
const b = ref<BatchDetail | null>(null);
const error = ref('');
async function load() {
  try {
    b.value = await api<BatchDetail>(`/fundraising/batches/${route.params.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(() => route.params.id, () => route.params.id && load());

// حلقة الاستخدام: مخصوم، محجوز، مناقلات، صافي
const ring = computed(() => {
  const x = b.value;
  if (!x) return [];
  const C = 2 * Math.PI * 52;
  let off = 0;
  return [
    { label: 'مخصوم', v: x.spentAmount, c: '#0f766e' }, { label: 'محجوز', v: x.reservedAmount, c: '#f59e0b' },
    { label: 'مناقلات', v: x.transferredAmount, c: '#8b5cf6' }, { label: 'صافي متاح', v: x.net, c: '#34d399' },
  ].map((s) => {
    const len = x.amount ? (s.v / x.amount) * C : 0;
    const seg = { ...s, dash: `${len} ${C - len}`, offset: -off };
    off += len;
    return seg;
  });
});
const cats = (c: string[]) => (c.length ? c.map((x) => label('category', x)).join('، ') : 'كل الفئات');
</script>

<template>
  <div v-if="b">
    <section class="fr-hero">
      <div>
        <p class="kicker">دفعة {{ fmtNo('B', b.batchNo) }} <span v-if="b.isZakat" class="fr-zakat">زكاة</span></p>
        <h1>{{ b.targetName }}</h1>
        <p class="sub">{{ b.isZakat ? 'زكاة' : label('target', b.targetKind) }} · الداعم: <RouterLink :to="`/fundraising/donors/${b.donorId}`" class="lnk">{{ b.donorName }}</RouterLink>
          · من الفرصة <RouterLink :to="`/fundraising/opportunities/${b.opportunityId}`" class="lnk">{{ fmtNo('FR', b.opportunityNo) }}</RouterLink></p>
      </div>
      <div class="fr-hero-actions"><span class="fr-badge st" :style="{ '--c': color('batch', b.status) }">{{ label('batch', b.status) }}</span></div>
    </section>

    <div class="fr-grid">
      <section class="fr-panel">
        <h2>استخدام الدفعة</h2>
        <div class="ring-wrap">
          <svg viewBox="0 0 120 120" class="ring">
            <circle cx="60" cy="60" r="52" class="ring-bg" />
            <circle v-for="s in ring" :key="s.label" cx="60" cy="60" r="52" class="ring-seg" :stroke="s.c" :stroke-dasharray="s.dash" :stroke-dashoffset="s.offset" />
          </svg>
          <div class="ring-center"><strong>{{ sar(b.amount) }}</strong><span>مبلغ الدفعة</span></div>
        </div>
        <ul class="legend"><li v-for="s in ring" :key="s.label"><i :style="{ background: s.c }" />{{ s.label }}<b>{{ sar(s.v) }}</b></li></ul>
      </section>
      <section class="fr-panel fr-span2">
        <h2>اشتراطات الداعم على الدفعة</h2>
        <dl class="fr-kv">
          <div><dt>يقبل مساهمة المستفيد</dt><dd>{{ b.conditions.acceptsPatientContribution ? 'نعم' : 'لا' }}</dd></div>
          <div><dt>الحد الأعلى للصرف</dt><dd>{{ b.conditions.maxSpend ? sar(b.conditions.maxSpend) : 'بدون حد' }}</dd></div>
          <div><dt>الفئات</dt><dd>{{ cats(b.conditions.categories) }}</dd></div>
          <div><dt>الجنسيات</dt><dd>{{ b.conditions.nationalities.length ? b.conditions.nationalities.join('، ') : 'كل الجنسيات' }}</dd></div>
          <div><dt>انتهاء المشروع</dt><dd>{{ b.conditions.endDate ? `${fmtDate(b.conditions.endDate)} (${hijri(b.conditions.endDate)})` : '—' }}</dd></div>
          <div><dt>طريقة التوزيع</dt><dd>{{ b.allocationMode === 'percent' ? `${b.percent}% من إجمالي الفرصة` : 'مبلغ محدد' }}</dd></div>
          <div><dt>الحالة المالية</dt><dd>{{ b.isPromised ? 'تبرع آجل (وعد بالدفع): يُصرف منه الآن، ويبقى المتبقي مستحقًا على الداعم' : 'مُحصَّلة' }}</dd></div>
          <div v-if="b.parentBatchId"><dt>ناتجة عن مناقلة من</dt><dd><RouterLink :to="`/fundraising/batches/${b.parentBatchId}`">{{ fmtNo('B', b.parentBatchNo) }}</RouterLink></dd></div>
          <div v-if="b.beneficiaryRequestId"><dt>مقيدة لحالة</dt><dd><RouterLink :to="`/beneficiaries/requests/${b.beneficiaryRequestId}`">عرض طلب المستفيد</RouterLink></dd></div>
        </dl>
        <template v-if="b.children.length">
          <h3 class="sec">مناقلات من هذه الدفعة</h3>
          <RouterLink v-for="c in b.children" :key="c.id" :to="`/fundraising/batches/${c.id}`" class="child"><span class="fr-no">{{ fmtNo('B', c.batchNo) }}</span><span class="grow">{{ c.targetName }}</span><b>{{ sar(c.amount) }}</b></RouterLink>
        </template>
      </section>
    </div>

    <h2 class="sec2">القيود المرتبطة</h2>
    <div class="journal">
      <JournalEntryCard v-for="e in b.entries" :key="e.id" :entry="e" />
      <p v-if="!b.entries.length" class="fr-empty card">لا توجد قيود بعد</p>
    </div>
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
  <div v-else class="fr-skeleton" />
</template>

<style scoped>
.lnk { color: #fde68a; }
.st { background: rgba(255,255,255,.12); color: #fff; padding: 4px 14px; }
.ring-wrap { position: relative; width: 180px; margin: 0 auto 10px; }
.ring { width: 100%; transform: rotate(-90deg); }
.ring-bg { fill: none; stroke: var(--surface-2); stroke-width: 14; }
.ring-seg { fill: none; stroke-width: 14; animation: draw 1s var(--ease) both; }
@keyframes draw { from { stroke-dasharray: 0 400; } }
.ring-center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; }
.ring-center strong { font-size: 1rem; }
.ring-center span { color: var(--muted); font-size: .76rem; }
.legend { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; font-size: .86rem; }
.legend li { display: flex; align-items: center; gap: 6px; }
.legend i { width: 10px; height: 10px; border-radius: 3px; }
.legend b { margin-inline-start: auto; }
.sec { font-size: .92rem; margin: 18px 0 8px; color: var(--primary); }
.sec2 { font-size: 1rem; margin: 22px 0 10px; }
.child { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 10px; color: var(--text); }
.child:hover { background: var(--surface-2); }
.grow { flex: 1; }
.journal { display: flex; flex-direction: column; gap: 12px; }
</style>
