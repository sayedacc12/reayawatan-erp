<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { EVAL_COLOR, GRADE_COLOR, fmtDate, fmtDateTime, sar } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const props = defineProps<{ id: string }>();
const toast = useToast();
const d = ref<any>(null);
const form = ref<any>(null);
const busy = ref(false);
const modal = ref<'' | 'approve' | 'return'>('');
const note = ref('');
const base = () => `/procurement/evaluations/${props.id}`;

function fill() {
  form.value = {
    scores: d.value.scores.map((s: any) => ({ key: s.key, score: s.score, note: s.note ?? '' })),
    strengths: d.value.strengths ?? '', weaknesses: d.value.weaknesses ?? '', recommendation: d.value.recommendation ?? '', shareWithSupplier: d.value.shareWithSupplier,
  };
}
async function load() {
  try {
    d.value = await api(base());
    fill();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
watch(() => props.id, load);

const total = computed(() => {
  if (!d.value || !form.value) return 0;
  const w = d.value.scores.reduce((t: number, s: any) => t + s.weight, 0) || 1;
  return Math.round((d.value.scores.reduce((t: number, s: any, i: number) => t + s.weight * Number(form.value.scores[i].score || 0), 0) / w) * 100) / 100;
});
const needNote = (i: number) => {
  const s = d.value.scores[i];
  return s.auto !== null && Math.abs(Number(form.value.scores[i].score) - s.auto) > 10;
};
const pct = (v: number | null) => (v === null || v === undefined ? '—' : `${v}%`);

async function run(fn: () => Promise<any>, done: string) {
  busy.value = true;
  try {
    d.value = await fn();
    fill();
    toast.success(done);
    modal.value = '';
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const nul = (v: string) => (v?.trim() ? v.trim() : null);
const save = () => run(() => api(base(), {
  method: 'PUT',
  json: {
    scores: form.value.scores.map((s: any) => ({ key: s.key, score: Number(s.score), note: nul(s.note) })), strengths: nul(form.value.strengths),
    weaknesses: nul(form.value.weaknesses), recommendation: nul(form.value.recommendation), shareWithSupplier: form.value.shareWithSupplier,
  },
}), 'حُفظت الدرجات');
const submit = async () => {
  await save();
  await run(() => api(`${base()}/submit`, { method: 'POST', json: {} }), 'أُرسل التقييم للاعتماد');
};
const decide = () => run(() => api(`${base()}/${modal.value}`, { method: 'POST', json: { note: nul(note.value) } }), modal.value === 'approve' ? 'اعتُمد التقييم وحُدّث تقدير المورد' : 'أُعيد التقييم');
</script>

<template>
  <div v-if="d && form">
    <div class="page-head">
      <div>
        <h1>{{ d.code }} · تقييم {{ d.supplier.name }}</h1>
        <p class="muted">{{ d.kindLabel }}<span v-if="d.ref"> على <RouterLink class="pm-link" :to="d.ref.kind === 'order' ? `/procurement/orders/${d.ref.id}` : `/procurement/contracts/${d.ref.id}`">{{ d.ref.code }}</RouterLink></span>
          · {{ fmtDate(d.periodFrom) }} إلى {{ fmtDate(d.periodTo) }} · <span class="pm-pill" :style="{ '--c': EVAL_COLOR[d.status] }">{{ d.statusLabel }}</span></p>
      </div>
      <div class="pc-inline">
        <template v-if="d.can.edit">
          <button class="btn" :disabled="busy" @click="save">حفظ</button>
          <button class="btn btn-primary" :disabled="busy" @click="submit">إرسال للاعتماد</button>
        </template>
        <button v-if="d.can.decide" class="btn btn-primary" @click="modal = 'approve'; note = ''">اعتماد</button>
        <button v-if="d.can.decide" class="btn" @click="modal = 'return'; note = ''">إعادة للمقيّم</button>
      </div>
    </div>
    <div v-if="d.returnReason && d.status === 'returned'" class="alert alert-error">{{ d.returnReason }}</div>

    <div class="pc-cards" style="margin-bottom: 14px">
      <div class="pc-kpi"><small>الدرجة الكلية</small><b>{{ d.can.edit ? total : d.total }}</b></div>
      <div class="pc-kpi"><small>التقدير</small><b :style="{ color: GRADE_COLOR[d.grade] }">{{ d.grade }}</b><small>{{ d.gradeLabel }}</small></div>
      <div class="pc-kpi"><small>تقدير المورد الحالي</small><b :style="{ color: GRADE_COLOR[d.supplier.grade] }">{{ d.supplier.grade ?? '—' }}</b><small>{{ d.supplier.rating ?? 'لم يُقيّم' }}</small></div>
      <div class="pc-kpi"><small>قيمة التعميدات في الفترة</small><b>{{ sar(d.metrics.spend) }}</b><small>{{ d.metrics.orders }} تعميد</small></div>
    </div>

    <div class="pc-grid" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)">
      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2>المعايير والدرجات</h2>
          <table class="pc-lines">
            <thead><tr><th>المعيار</th><th>الوزن</th><th>المحسوب آليًا</th><th>الدرجة (0 إلى 100)</th><th>السبب أو الملاحظة</th></tr></thead>
            <tbody>
              <tr v-for="(s, i) in d.scores" :key="s.key">
                <td>{{ s.name }}</td><td class="pc-num">{{ s.weight }}%</td><td class="pc-num">{{ s.auto ?? 'يدوي' }}</td>
                <td><input v-if="d.can.edit" v-model.number="form.scores[i].score" type="number" min="0" max="100" step="any" class="input" style="width: 90px" /><span v-else class="pc-num">{{ s.score }}</span></td>
                <td><input v-if="d.can.edit" v-model="form.scores[i].note" class="input" maxlength="500" :required="needNote(i)" :placeholder="needNote(i) ? 'مطلوب: سبب الاختلاف عن المحسوب' : ''" /><span v-else class="pm-muted">{{ s.note ?? '' }}</span></td>
              </tr>
            </tbody>
          </table>
        </section>
        <section class="card pm-panel">
          <h2>الملاحظات والتوصية</h2>
          <template v-if="d.can.edit">
            <label class="field"><span>نقاط القوة</span><textarea v-model="form.strengths" class="input" rows="2" /></label>
            <label class="field"><span>نقاط الضعف (مطلوبة للتقدير الضعيف)</span><textarea v-model="form.weaknesses" class="input" rows="2" /></label>
            <label class="field"><span>التوصية</span><textarea v-model="form.recommendation" class="input" rows="2" /></label>
            <label class="pc-inline"><input v-model="form.shareWithSupplier" type="checkbox" /> يظهر التقييم للمورد في بوابته بعد اعتماده ليرد عليه</label>
          </template>
          <dl v-else class="pc-dl" style="grid-template-columns: 1fr">
            <div><dt>نقاط القوة</dt><dd>{{ d.strengths ?? '—' }}</dd></div>
            <div><dt>نقاط الضعف</dt><dd>{{ d.weaknesses ?? '—' }}</dd></div>
            <div><dt>التوصية</dt><dd>{{ d.recommendation ?? '—' }}</dd></div>
          </dl>
        </section>
        <section v-if="d.supplierResponse" class="card pm-panel" style="border-inline-start: 4px solid #0369a1">
          <h2>رد المورد</h2>
          <p style="white-space: pre-line; margin: 0">{{ d.supplierResponse }}</p>
          <p v-if="d.improvementPlan" class="pm-muted" style="white-space: pre-line"><b>خطة التحسين:</b> {{ d.improvementPlan }}</p>
          <small class="pm-muted">{{ fmtDateTime(d.responseAt) }}</small>
        </section>
      </div>
      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2>المؤشرات المحسوبة</h2>
          <dl class="pc-dl" style="grid-template-columns: 1fr 1fr">
            <div><dt>التوريد في الموعد</dt><dd>{{ pct(d.metrics.onTimePct) }}<small class="pm-muted"> ({{ d.metrics.onTime }}/{{ d.metrics.deliveries }})</small></dd></div>
            <div><dt>متوسط التأخير</dt><dd>{{ d.metrics.avgDelayDays ?? '—' }} يوم</dd></div>
            <div><dt>اكتمال الكميات</dt><dd>{{ pct(d.metrics.fillPct) }}</dd></div>
            <div><dt>المرفوض في الفحص</dt><dd>{{ pct(d.metrics.rejectPct) }}</dd></div>
            <div><dt>فواتير مطابقة</dt><dd>{{ pct(d.metrics.invoiceOkPct) }}<small class="pm-muted"> ({{ d.metrics.invoices }} فاتورة)</small></dd></div>
            <div><dt>مستويات الخدمة المحققة</dt><dd>{{ pct(d.metrics.kpiPct) }}</dd></div>
            <div><dt>الجزاءات المعتمدة</dt><dd>{{ d.metrics.penalties }} · {{ sar(d.metrics.penaltyAmount) }}</dd></div>
            <div><dt>سرعة الرد على التعميد</dt><dd>{{ d.metrics.avgResponseHours ?? '—' }} ساعة</dd></div>
          </dl>
        </section>
        <section class="card pm-panel">
          <h2>تاريخ تقديرات المورد</h2>
          <ul class="pc-log">
            <li v-for="h in d.history" :key="h.id"><span><RouterLink class="pm-link" :to="`/procurement/evaluations/${h.id}`">{{ h.code }}</RouterLink> · {{ fmtDate(h.periodTo) }} · {{ h.total }}
              <span class="pm-pill" :style="{ '--c': GRADE_COLOR[h.grade] }">{{ h.grade }}</span></span></li>
            <li v-if="!d.history.length" class="pm-muted">لا توجد تقييمات معتمدة سابقة.</li>
          </ul>
        </section>
        <section class="card pm-panel">
          <h2>السجل</h2>
          <ul class="pc-log">
            <li v-for="(x, i) in [...d.log].reverse()" :key="i"><span><b>{{ x.action }}</b> · {{ x.byName }} <small class="pm-muted">{{ fmtDateTime(x.at) }}</small><div v-if="x.note" class="pm-muted" style="font-size: .8rem">{{ x.note }}</div></span></li>
          </ul>
        </section>
      </div>
    </div>

    <div v-if="modal" class="modal-backdrop" @click.self="modal = ''">
      <form class="card modal" @submit.prevent="decide">
        <h2>{{ modal === 'approve' ? 'اعتماد التقييم' : 'إعادة التقييم للمقيّم' }}</h2>
        <p v-if="modal === 'approve'" class="pm-muted" style="font-size: .85rem">يُحدَّث تقدير المورد في سجله إلى {{ d.grade }} ({{ d.total }})، ويظهر للمورد في بوابته إن كانت المشاركة مفعّلة.</p>
        <label class="field"><span>{{ modal === 'approve' ? 'ملاحظة (اختياري)' : 'السبب' }}</span><textarea v-model="note" class="input" rows="3" :required="modal === 'return'" /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">تأكيد</button><button type="button" class="btn" @click="modal = ''">رجوع</button></div>
      </form>
    </div>
  </div>
</template>
