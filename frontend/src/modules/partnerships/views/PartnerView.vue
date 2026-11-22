<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import EvaluationForm from '../components/EvaluationForm.vue';
import NewContractForm from '../components/NewContractForm.vue';
import PartnerForm from '../components/PartnerForm.vue';
import ScoreRing from '../components/ScoreRing.vue';
import { CONTRACT_COLOR, EVAL_COLOR, KIND_ICON, PARTNER_COLOR, fmtDate, fmtDateTime, sar } from '../lib';
import '../../../shared/module.css';
import '../partnerships.css';

const props = defineProps<{ id: string }>();
const router = useRouter();
const toast = useToast();
const p = ref<any>(null);
const error = ref('');
const tab = ref<'info' | 'evaluations' | 'contracts' | 'followups' | 'log'>('info');
const editing = ref(false);
const evaluating = ref<any>(null);
const contracting = ref(false);
const open = ref<string | null>(null);
async function load() {
  try {
    p.value = await api(`/partnerships/partners/${props.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
const openEval = computed(() => p.value?.evaluations.find((e: any) => ['draft', 'returned', 'submitted'].includes(e.status)));
function startEval() {
  if (openEval.value && openEval.value.status !== 'submitted') evaluating.value = openEval.value;
  else evaluating.value = { new: true };
}
async function setStatus(status: string, ask: string) {
  const note = prompt(ask);
  if (!note || note.trim().length < 3) return;
  try {
    p.value = await api(`/partnerships/partners/${props.id}/status`, { method: 'POST', json: { status, note } });
    toast.success('تم تحديث حالة الشريك');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove() {
  if (!confirm(`حذف الشريك «${p.value.name}» نهائيًا؟`)) return;
  try {
    await api(`/partnerships/partners/${props.id}`, { method: 'DELETE' });
    toast.success('حُذف الشريك');
    router.push('/partnerships/partners');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const LOG_COLOR = (a: string) => (a.includes('اعتماد') ? '#10b981' : a.includes('رفض') || a.includes('إيقاف') ? '#ef4444' : a.includes('رفع') ? '#f59e0b' : '#d6b26b');
</script>

<template>
  <div>
    <RouterLink to="/partnerships/partners" class="back">→ سجل الشركاء</RouterLink>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="p">
      <section class="pm-hero pt-hero head">
        <div class="who">
          <ScoreRing :score="p.score" :color="p.tierColor ?? '#fcd34d'" :size="104" />
          <div>
            <p class="pm-kicker"><span class="pt-code">{{ p.code }}</span> · {{ p.className ?? 'بدون تصنيف' }}</p>
            <h1>{{ p.name }}</h1>
            <div class="badges">
              <span class="pm-pill light" :style="{ '--c': PARTNER_COLOR[p.status] }">{{ p.statusLabel }}</span>
              <span v-if="p.tierLabel" class="pt-tier" :style="{ '--c': p.tierColor }">{{ p.tierLabel }}</span>
              <span v-for="t in p.types" :key="t.id" class="tchip">{{ t.name }}</span>
              <span v-if="p.showOnWebsite" class="tchip">يظهر في الموقع</span>
            </div>
          </div>
        </div>
        <div class="pm-actions">
          <button v-if="p.can.evaluate && p.status !== 'suspended' && openEval?.status !== 'submitted'" class="btn pt-glow" @click="startEval">{{ openEval ? 'إكمال التقييم' : p.status === 'approved' ? 'إعادة التقييم' : 'تقييم الشريك' }}</button>
          <button v-if="p.can.contract" class="btn pt-ghost" @click="contracting = true">+ عقد شراكة</button>
          <button v-if="p.can.edit" class="btn pt-ghost" @click="editing = true">تعديل البيانات</button>
          <button v-if="p.can.status && p.status === 'approved'" class="btn pt-ghost" @click="setStatus('suspended', 'سبب إيقاف الشراكة:')">إيقاف</button>
          <button v-if="p.can.status && p.status === 'suspended'" class="btn pt-ghost" @click="setStatus('approved', 'سبب إعادة تفعيل الشراكة:')">إعادة التفعيل</button>
          <button v-if="p.can.status && ['rejected', 'suspended'].includes(p.status)" class="btn pt-ghost" @click="setStatus('prospect', 'سبب إعادته شريكًا محتملًا لتقييمه من جديد:')">إعادة للتقييم</button>
          <button v-if="p.can.edit && !p.contracts.length && p.status !== 'approved'" class="btn pt-ghost" @click="remove">حذف</button>
        </div>
      </section>

      <div v-if="openEval?.status === 'submitted'" class="alert note">التقييم مرفوع للاعتماد بدرجة {{ openEval.total }} من 100، وينتظر قرار المعتمد.</div>
      <div v-else-if="openEval?.status === 'returned'" class="alert note">أُعيد التقييم للمقيّم: {{ openEval.decisionNote }}</div>
      <div v-if="p.evaluationDue" class="alert note">حان موعد إعادة تقييم الشريك ({{ fmtDate(p.nextEvaluationOn) }}).</div>
      <div v-if="p.status !== 'approved' && p.status !== 'suspended'" class="alert note soft">لا يُتعاقد إلا مع شريك معتمد: قيّمه وفق معايير الاختيار ثم ارفع التقييم للاعتماد.</div>

      <nav class="pm-tabs">
        <button :class="['pm-tab', { on: tab === 'info' }]" @click="tab = 'info'">البيانات</button>
        <button :class="['pm-tab', { on: tab === 'evaluations' }]" @click="tab = 'evaluations'">التقييمات <b>{{ p.evaluations.length }}</b></button>
        <button :class="['pm-tab', { on: tab === 'contracts' }]" @click="tab = 'contracts'">العقود <b>{{ p.contracts.length }}</b></button>
        <button :class="['pm-tab', { on: tab === 'followups' }]" @click="tab = 'followups'">الالتزامات <b>{{ p.followups.filter((f: any) => !f.doneAt).length }}</b></button>
        <button :class="['pm-tab', { on: tab === 'log' }]" @click="tab = 'log'">السجل</button>
      </nav>

      <section v-if="tab === 'info'" class="card pm-panel">
        <dl class="pm-dl">
          <dt>رقم السجل أو الترخيص</dt><dd class="pt-code" style="text-align: right">{{ p.registrationNo ?? '—' }}</dd>
          <dt>المدينة</dt><dd>{{ p.city ?? '—' }}</dd>
          <dt>الموقع الإلكتروني</dt><dd><a v-if="p.website" :href="p.website" target="_blank" rel="noopener" dir="ltr">{{ p.website }}</a><template v-else>—</template></dd>
          <dt>ممثل الشريك</dt><dd>{{ p.contactName ?? '—' }}<small v-if="p.contactTitle" class="pm-muted"> · {{ p.contactTitle }}</small></dd>
          <dt>الجوال</dt><dd dir="ltr" style="text-align: right">{{ p.phone ?? '—' }}</dd>
          <dt>البريد</dt><dd dir="ltr" style="text-align: right">{{ p.email ?? '—' }}</dd>
          <dt>المانح في تنمية الموارد</dt><dd><RouterLink v-if="p.donor" :to="`/fundraising/donors/${p.donor.id}`" class="pm-link">{{ p.donor.name }}</RouterLink><template v-else>—</template></dd>
          <dt>تاريخ الاعتماد</dt><dd>{{ fmtDate(p.approvedAt) }}</dd>
          <dt>إعادة التقييم</dt><dd>{{ fmtDate(p.nextEvaluationOn) }}</dd>
        </dl>
        <template v-if="p.about"><div class="pt-sec">نبذة ومجالات التعاون</div><p class="pt-pre">{{ p.about }}</p></template>
      </section>

      <section v-else-if="tab === 'evaluations'" class="evals">
        <p v-if="!p.evaluations.length" class="card pt-empty">لم يُقيَّم الشريك بعد.</p>
        <article v-for="e in p.evaluations" :key="e.id" class="card ev">
          <header @click="open = open === e.id ? null : e.id">
            <ScoreRing :score="e.total" :color="e.tierColor ?? (e.knockoutFailed ? '#dc2626' : '#94a3b8')" :size="64" label="" />
            <div style="flex: 1">
              <b>{{ e.typeName }}</b> <span class="pm-pill" :style="{ '--c': EVAL_COLOR[e.status] }">{{ e.statusLabel }}</span>
              <span v-if="e.tierLabel" class="pt-tier" :style="{ '--c': e.tierColor }">{{ e.tierLabel }}</span>
              <span v-if="e.overridden" class="pt-flag" title="اعتُمد رغم مخالفة قواعد القبول">اعتماد استثنائي</span>
              <span v-else-if="!e.meetsRules" class="pt-flag">لا يجتاز القواعد (الحد {{ e.minScore }})</span>
              <p class="pm-muted" style="margin: 2px 0 0">المقيّم {{ e.evaluatorName }} · {{ fmtDate(e.submittedAt ?? e.createdAt) }}<template v-if="e.decidedByName"> · القرار {{ e.decidedByName }} {{ fmtDate(e.decidedAt) }}</template></p>
            </div>
            <span class="pm-muted">{{ open === e.id ? '▲' : '▼' }}</span>
          </header>
          <div v-if="open === e.id" class="ev-body">
            <div v-for="s in e.scores" :key="s.criterionId" class="srow">
              <span>{{ s.name }} <small class="pm-muted">{{ s.weight }}%</small><span v-if="s.knockout" class="pt-chip" style="--c: #dc2626">حاسم</span></span>
              <span class="dots"><i v-for="n in 5" :key="n" :class="{ on: n <= s.score, ko: s.knockout && s.score === 1 }" /></span>
              <small class="pm-muted">{{ s.note }}</small>
            </div>
            <p v-if="e.recommendation"><b>التوصية:</b> {{ e.recommendation }}</p>
            <p v-if="e.decisionNote"><b>ملاحظة القرار:</b> {{ e.decisionNote }}</p>
          </div>
        </article>
      </section>

      <section v-else-if="tab === 'contracts'" class="card table-wrap">
        <table class="table">
          <thead><tr><th>رقم العقد</th><th>العنوان</th><th>النوع</th><th>المدة</th><th>القيمة</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="c in p.contracts" :key="c.id" class="pt-row" @click="router.push(`/partnerships/contracts/${c.id}`)">
              <td class="pt-code">{{ c.number }}</td><td><b>{{ c.title }}</b><span v-if="c.projectName" class="pm-muted">المشروع: {{ c.projectName }}</span></td><td>{{ c.typeName }}</td>
              <td class="pm-muted">{{ fmtDate(c.startsOn) }} ← {{ fmtDate(c.endsOn) }}</td><td class="pt-num">{{ sar(c.value) }}</td>
              <td><span class="pm-pill" :style="{ '--c': CONTRACT_COLOR[c.status] }">{{ c.statusLabel }}</span></td>
            </tr>
            <tr v-if="!p.contracts.length"><td colspan="6" class="pt-empty">لا توجد عقود مع هذا الشريك</td></tr>
          </tbody>
        </table>
      </section>

      <section v-else-if="tab === 'followups'" class="card table-wrap">
        <table class="table">
          <thead><tr><th>الالتزام</th><th>العقد</th><th>على</th><th>الاستحقاق</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="f in p.followups" :key="f.id" class="pt-row" @click="router.push(`/partnerships/contracts/${f.contractId}`)">
              <td>{{ KIND_ICON[f.kind] }} <b>{{ f.title }}</b><span class="pm-muted">{{ f.kindLabel }}</span></td><td class="pt-code">{{ f.contractNumber }}</td>
              <td>{{ f.party === 'partner' ? 'الشريك' : 'الجمعية' }}</td><td>{{ fmtDate(f.dueDate) }}</td>
              <td><span v-if="f.doneAt" class="pt-days ok">منجز</span><span v-else-if="f.overdue" class="pt-days late">متأخر</span><span v-else class="pt-days">بعد {{ f.daysLeft }} يوم</span></td>
            </tr>
            <tr v-if="!p.followups.length"><td colspan="5" class="pt-empty">لا توجد التزامات مسجلة</td></tr>
          </tbody>
        </table>
      </section>

      <section v-else class="card pm-panel">
        <ul class="pt-log">
          <li v-for="(l, i) in p.log" :key="i" :style="{ '--c': LOG_COLOR(l.action) }"><b>{{ l.action }}</b> · {{ l.byName }}<small>{{ fmtDateTime(l.at) }}</small><small v-if="l.note">{{ l.note }}</small></li>
        </ul>
      </section>
    </template>
    <PartnerForm v-if="editing" :partner="p" @close="editing = false" @saved="editing = false; load()" />
    <EvaluationForm v-if="evaluating" :partner="p" :evaluation="evaluating.new ? undefined : evaluating" @close="evaluating = null" @saved="evaluating = null; tab = 'evaluations'; load()" />
    <NewContractForm v-if="contracting" :partner-id="p.id" @close="contracting = false" @saved="(c) => router.push(`/partnerships/contracts/${c.id}`)" />
  </div>
</template>

<style scoped>
.back { display: inline-block; margin-bottom: 10px; font-size: .9rem; }
.head { align-items: center; }
.who { display: flex; gap: 16px; align-items: center; }
.who :deep(.v small) { color: rgba(255,255,255,.6); }
.badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; align-items: center; }
.pm-pill.light { background: rgba(255,255,255,.92); }
.tchip { font-size: .74rem; border: 1px solid rgba(255,255,255,.3); border-radius: 999px; padding: 1px 9px; color: rgba(255,255,255,.88); }
.note { background: #fff8e8; color: #7a5a14; border: 1px solid #f0d9a6; }
.note.soft { background: var(--surface-2); color: var(--muted); border-color: var(--border); }
.evals { display: grid; gap: 10px; }
.ev header { display: flex; gap: 12px; align-items: center; padding: 12px 16px; cursor: pointer; flex-wrap: wrap; }
.ev header > div > * { margin-inline-end: 4px; }
.ev-body { padding: 0 16px 14px; border-top: 1px solid var(--border); }
.srow { display: grid; grid-template-columns: minmax(180px, 1.3fr) 120px 1fr; gap: 10px; align-items: center; padding: 7px 0; border-bottom: 1px dashed var(--border); font-size: .88rem; }
.dots { display: flex; gap: 4px; }
.dots i { width: 16px; height: 16px; border-radius: 5px; background: var(--surface-2); border: 1px solid var(--border); }
.dots i.on { background: linear-gradient(135deg, #f59e0b, #164e38); border-color: transparent; }
.dots i.on.ko { background: #dc2626; }
@media (max-width: 700px) { .who { flex-direction: column; align-items: flex-start; } .srow { grid-template-columns: 1fr; } }
</style>
