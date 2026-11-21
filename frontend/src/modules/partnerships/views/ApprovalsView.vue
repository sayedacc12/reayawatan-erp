<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import ScoreRing from '../components/ScoreRing.vue';
import { fmtDate, fmtDateTime, sar } from '../lib';
import '../../../shared/module.css';
import '../partnerships.css';

const toast = useToast();
const data = ref<any>(null);
const notes = reactive<Record<string, string>>({});
const busy = ref(false);
async function load() {
  try {
    data.value = await api('/partnerships/approvals');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
async function decide(e: any, decision: 'approve' | 'reject' | 'return') {
  const note = (notes[e.id] ?? '').trim();
  if (decision !== 'approve' && note.length < 3) return toast.error('اكتب سبب القرار في خانة الملاحظة');
  if (decision === 'approve' && !e.meetsRules && note.length < 5) return toast.error('الشريك لا يجتاز قواعد القبول، اكتب سبب الاعتماد رغم ذلك');
  busy.value = true;
  try {
    await api(`/partnerships/evaluations/${e.id}/decision`, { method: 'POST', json: { decision, note: note || null } });
    toast.success({ approve: 'اعتُمد الشريك', reject: 'رُفض التقييم', return: 'أُعيد التقييم للمقيّم' }[decision]);
    await load();
  } catch (x) {
    toast.error((x as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-head"><div><h1>الاعتمادات</h1><p class="muted">تقييمات الشركاء المرفوعة وعقود الشراكة بانتظار الاعتماد الداخلي. يظهر التقييم كاملًا قبل القرار.</p></div></div>
    <template v-if="data">
      <div class="pt-sec">تقييمات الشركاء ({{ data.evaluations.length }})</div>
      <p v-if="!data.evaluations.length" class="card pt-empty">لا توجد تقييمات بانتظار الاعتماد ✓</p>
      <article v-for="(e, i) in data.evaluations" :key="e.id" class="card ap" :style="{ '--i': i }">
        <header>
          <ScoreRing :score="e.total" :color="e.tierColor ?? (e.knockoutFailed ? '#dc2626' : '#94a3b8')" :size="96" />
          <div style="flex: 1; min-width: 220px">
            <RouterLink :to="`/partnerships/partners/${e.partnerId}`" class="pm-link"><h2>{{ e.partner.name }}</h2></RouterLink>
            <p class="pm-muted" style="margin: 2px 0 6px">{{ e.partner.className ?? 'بدون تصنيف' }} · {{ e.partner.city ?? '' }} · مرشح لـ <b>{{ e.typeName }}</b></p>
            <span v-if="e.tierLabel" class="pt-tier" :style="{ '--c': e.tierColor }">{{ e.tierLabel }}</span>
            <span v-if="e.meetsRules" class="pt-okflag">✓ يجتاز قواعد القبول (الحد {{ e.minScore }})</span>
            <span v-else class="pt-flag">✕ {{ e.knockoutFailed ? 'لم يجتز معيارًا حاسمًا' : `أقل من الحد الأدنى ${e.minScore}` }}</span>
            <p class="pm-muted" style="margin: 6px 0 0">المقيّم {{ e.evaluatorName }} · رُفع {{ fmtDateTime(e.submittedAt) }}</p>
          </div>
        </header>
        <div class="sheet">
          <div v-for="s in e.scores" :key="s.criterionId" :class="['srow', { ko: s.knockout && s.score === 1 }]">
            <span>{{ s.name }} <small class="pm-muted">{{ s.weight }}%</small><span v-if="s.knockout" class="pt-chip" style="--c: #dc2626">حاسم</span></span>
            <span class="bar"><i :style="{ width: s.score * 20 + '%' }" /></span>
            <b>{{ s.score }}/5</b>
            <small class="pm-muted">{{ s.note }}</small>
          </div>
        </div>
        <p v-if="e.recommendation" class="rec"><b>توصية المقيّم:</b> {{ e.recommendation }}</p>
        <p v-if="e.about" class="pm-muted"><b>عن الشريك:</b> {{ e.about }}</p>
        <div class="decide">
          <input v-model="notes[e.id]" class="input" :placeholder="e.meetsRules ? 'ملاحظة القرار (إلزامية عند الرفض أو الإرجاع)' : 'سبب الاعتماد رغم المخالفة أو سبب الرفض (إلزامي)'" />
          <button class="btn btn-primary" :disabled="busy" @click="decide(e, 'approve')">اعتماد الشريك</button>
          <button class="btn" :disabled="busy" @click="decide(e, 'return')">إرجاع للمقيّم</button>
          <button class="btn btn-danger" :disabled="busy" @click="decide(e, 'reject')">رفض</button>
        </div>
      </article>

      <div class="pt-sec">عقود بانتظار الاعتماد الداخلي ({{ data.contracts.length }})</div>
      <div class="card table-wrap">
        <table class="table">
          <thead><tr><th>رقم العقد</th><th>العنوان</th><th>الشريك</th><th>النوع</th><th>المدة</th><th>القيمة</th><th>البنود</th><th>رفعه</th></tr></thead>
          <tbody>
            <tr v-for="c in data.contracts" :key="c.id" class="pt-row" @click="$router.push(`/partnerships/contracts/${c.id}`)">
              <td class="pt-code">{{ c.number }}</td><td><b>{{ c.title }}</b></td><td>{{ c.partnerName }}</td><td>{{ c.typeName }}</td>
              <td class="pm-muted">{{ fmtDate(c.startsOn) }} ← {{ fmtDate(c.endsOn) }}</td><td class="pt-num">{{ sar(c.value) }}</td><td class="pt-num">{{ c.clauses }}</td><td>{{ c.submittedBy }}</td>
            </tr>
            <tr v-if="!data.contracts.length"><td colspan="8" class="pt-empty">لا توجد عقود بانتظار الاعتماد ✓</td></tr>
          </tbody>
        </table>
      </div>
      <p class="pm-muted">افتح العقد لمراجعة نصه النهائي كاملًا ثم اعتماده أو إرجاعه.</p>
    </template>
  </div>
</template>

<style scoped>
.ap { padding: 16px 18px; margin-bottom: 12px; animation: pm-rise .4s calc(var(--i) * 60ms) var(--ease) both; }
.ap header { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.ap h2 { font-size: 1.1rem; margin: 0; }
.ap header span { margin-inline-end: 6px; }
.sheet { display: grid; gap: 2px; background: var(--surface-2); border-radius: 12px; padding: 8px 12px; }
.srow { display: grid; grid-template-columns: minmax(180px, 1.4fr) 1fr 44px 1.2fr; gap: 10px; align-items: center; padding: 6px 0; font-size: .87rem; border-bottom: 1px dashed var(--border); }
.srow:last-child { border-bottom: 0; }
.srow.ko { color: #b91c1c; }
.bar { height: 8px; background: var(--surface); border-radius: 8px; overflow: hidden; }
.bar i { display: block; height: 100%; background: linear-gradient(90deg, #f59e0b, #164e38); border-radius: 8px; animation: pm-fill .8s var(--ease) both; transform-origin: right; }
.srow.ko .bar i { background: #dc2626; }
.rec { margin: 10px 0 4px; }
.decide { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.decide .input { flex: 1; min-width: 240px; }
@media (max-width: 700px) { .srow { grid-template-columns: 1fr 60px; } .srow .bar, .srow small { display: none; } }
</style>
