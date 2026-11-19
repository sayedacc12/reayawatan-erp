<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, openProtectedFile } from '../../../api';
import { useToast } from '../../../stores/toast';
import { ORDER_COLOR, QUOTE_COLOR, RFQ_COLOR, fmtDateTime, fmtSize, fromLocalInput, lookups, sar, toLocalInput, upload } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const props = defineProps<{ id: string }>();
const router = useRouter();
const toast = useToast();
const q = ref<any>(null);
const lk = ref<any>(null);
const tab = ref<'quotes' | 'invited' | 'questions' | 'log'>('quotes');
const busy = ref(false);
const modal = ref<'' | 'publish' | 'extend' | 'cancel' | 'recommend' | 'score' | 'negotiate' | 'exclude' | 'staff' | 'answer'>('');
const m = ref<any>({});
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval>;
const base = () => `/procurement/rfqs/${props.id}`;

async function load() {
  try {
    [q.value, lk.value] = await Promise.all([api(base()), lookups()]);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(() => { load(); timer = setInterval(() => (now.value = Date.now()), 30_000); });
onUnmounted(() => clearInterval(timer));
watch(() => props.id, load);

async function run(fn: () => Promise<any>, ok: string) {
  busy.value = true;
  try {
    const x = await fn();
    if (x?.id === props.id) q.value = x;
    else if (x?.rfq?.id === props.id) q.value = x.rfq;
    else await load();
    toast.success(ok);
    modal.value = '';
    return x;
  } catch (e) {
    toast.error((e as Error).message);
    return null;
  } finally {
    busy.value = false;
  }
}
const left = computed(() => {
  if (!q.value?.closesAt) return '';
  const ms = new Date(q.value.closesAt).getTime() - now.value;
  if (ms <= 0) return 'انتهى موعد التقديم';
  const d = Math.floor(ms / 86400_000), h = Math.floor((ms % 86400_000) / 3600_000), mi = Math.floor((ms % 3600_000) / 60_000);
  return `متبقٍ ${d ? `${d} يوم ` : ''}${h} ساعة ${mi} دقيقة`;
});
const quotes = computed(() => (q.value?.quotes ?? []).filter((x: any) => x.status !== 'withdrawn'));
const ranked = computed(() => [...quotes.value].sort((a: any, b: any) => (a.evaluation?.rank ?? 99) - (b.evaluation?.rank ?? 99)));
const techCriteria = computed(() => (q.value?.criteria ?? []).filter((c: any) => c.kind === 'technical'));
const price = (qt: any, lineId: string) => qt.lines?.find((l: any) => l.lineId === lineId)?.unitPrice ?? null;
const bestPrice = (lineId: string) => Math.min(...quotes.value.filter((x: any) => x.status === 'submitted').map((x: any) => price(x, lineId) ?? Infinity));

function openPublish() {
  const needs = q.value.method === 'quotes' && q.value.invitedIds.length < lk.value.sourcing.minQuotes;
  if (!needs) return run(() => api(`${base()}/publish`, { method: 'POST', json: {} }), 'نُشرت المنافسة وأُشعر الموردون');
  m.value = { fewerReason: '' };
  modal.value = 'publish';
}
function openScore(x: any) {
  m.value = { quote: x, note: x.myScore?.note ?? '', scores: Object.fromEntries(techCriteria.value.map((c: any) => [c.key, x.myScore?.scores?.[c.key] ?? 70])) };
  modal.value = 'score';
}
function openNegotiate(x: any) {
  m.value = { quote: x, note: '', prices: Object.fromEntries(q.value.lines.map((l: any) => [l.id, price(x, l.id)])) };
  modal.value = 'negotiate';
}
function openStaff() {
  m.value = { supplierId: '', vatRate: 15, deliveryDays: null, validityDays: 30, technicalNote: '', prices: Object.fromEntries(q.value.lines.map((l: any) => [l.id, null])) };
  modal.value = 'staff';
}
function openRecommend() {
  m.value = { quoteId: ranked.value.find((x: any) => x.evaluation?.rank === 1)?.id ?? '', recommendation: '' };
  modal.value = 'recommend';
}
const submitScore = () => run(() => api(`/procurement/quotes/${m.value.quote.id}/score`, {
  method: 'POST', json: { scores: Object.entries(m.value.scores).map(([key, score]) => ({ key, score: Number(score) })), note: m.value.note || null },
}), 'حُفظ تقييمك');
const submitNegotiate = () => run(() => api(`/procurement/quotes/${m.value.quote.id}/negotiate`, {
  method: 'POST', json: { lines: Object.entries(m.value.prices).map(([lineId, unitPrice]) => ({ lineId, unitPrice: Number(unitPrice) })), note: m.value.note },
}), 'وُثقت جولة التفاوض');
const submitStaff = () => run(() => api(`${base()}/quotes`, {
  method: 'POST', json: {
    supplierId: m.value.supplierId, vatRate: Number(m.value.vatRate), deliveryDays: m.value.deliveryDays || null, validityDays: m.value.validityDays || null, technicalNote: m.value.technicalNote || null,
    lines: Object.entries(m.value.prices).map(([lineId, unitPrice]) => ({ lineId, unitPrice: Number(unitPrice) || 0 })),
  },
}), 'سُجّل العرض');
async function submitRecommend() {
  const r = await run(() => api(`${base()}/recommend`, { method: 'POST', json: m.value }), 'أُعد التعميد وأُرسل للاعتماد');
  if (r?.orderId) router.push(`/procurement/orders/${r.orderId}`);
}
const pick = (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; return f; };
const addFile = (e: Event) => { const f = pick(e); if (f) run(() => upload(`${base()}/attachments`, f), 'أُرفق الملف'); };
const removeFile = (key: string) => run(() => api(`${base()}/attachments/${key.split('/').pop()}`, { method: 'DELETE' }), 'حُذف المرفق');
const openFile = (key: string) => openProtectedFile(`${base()}/files/${key.split('/').pop()}`).catch((e) => toast.error(e.message));
const openQuoteFile = (qid: string, key: string) => openProtectedFile(`/procurement/quotes/${qid}/files/${key.split('/').pop()}`).catch((e) => toast.error(e.message));
</script>

<template>
  <div v-if="q && lk">
    <div class="page-head">
      <div>
        <h1>{{ q.title }}</h1>
        <p class="muted">
          <span class="pc-code">{{ q.code }}</span> · {{ q.methodLabel }} · طلب <RouterLink class="pm-link" :to="`/procurement/requests/${q.request.id}`">{{ q.request.code }}</RouterLink> ·
          <span class="pm-pill" :style="{ '--c': RFQ_COLOR[q.status] }">{{ q.statusLabel }}</span>
        </p>
      </div>
      <div class="pc-inline">
        <button v-if="q.can.edit" class="btn" @click="router.push(`/procurement/rfqs/${q.id}/edit`)">تعديل</button>
        <button v-if="q.can.publish" class="btn btn-primary" :disabled="busy" @click="openPublish">نشر للموردين</button>
        <button v-if="q.can.extend" class="btn" @click="m = { closesAt: toLocalInput(q.closesAt), questionsUntil: toLocalInput(q.questionsUntil), reason: '' }; modal = 'extend'">تمديد الموعد</button>
        <button v-if="q.can.open" class="btn btn-primary" :disabled="busy" @click="run(() => api(`${base()}/open`, { method: 'POST' }), 'فُتحت العروض')">فتح العروض</button>
        <button v-if="q.can.recommend" class="btn btn-primary" @click="openRecommend">التوصية بالترسية</button>
        <RouterLink v-if="q.order" class="btn" :to="`/procurement/orders/${q.order.id}`">التعميد {{ q.order.code }}</RouterLink>
        <button v-if="q.can.cancel" class="btn btn-ghost" @click="m = { reason: '' }; modal = 'cancel'">إلغاء المنافسة</button>
      </div>
    </div>

    <div v-if="q.cancelReason" class="alert alert-error">أُلغيت: {{ q.cancelReason }}</div>

    <div class="pc-grid" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)">
      <section class="card pm-panel">
        <dl class="pc-dl">
          <div><dt>آخر موعد للتقديم</dt><dd>{{ fmtDateTime(q.closesAt) }}<span v-if="q.status === 'published'" :class="['pc-timer', { over: q.deadlinePassed }]" style="display: block; font-size: .8rem">{{ left }}</span></dd></div>
          <div><dt>آخر موعد للاستفسارات</dt><dd>{{ fmtDateTime(q.questionsUntil) }}</dd></div>
          <div><dt>القيمة التقديرية</dt><dd>{{ q.request.estimatedTotal === null ? 'مخفية' : sar(q.request.estimatedTotal) }}</dd></div>
          <div v-if="q.openedAt"><dt>فُتحت العروض</dt><dd>{{ fmtDateTime(q.openedAt) }} · {{ q.openedByName }}</dd></div>
          <div v-if="q.scope" style="grid-column: 1 / -1"><dt>نطاق الأعمال</dt><dd style="white-space: pre-line; font-weight: 400">{{ q.scope }}</dd></div>
          <div v-if="q.terms" style="grid-column: 1 / -1"><dt>الشروط</dt><dd style="white-space: pre-line; font-weight: 400">{{ q.terms }}</dd></div>
        </dl>
        <div class="pc-sec">المرفقات</div>
        <div class="pc-chips">
          <span v-for="f in q.attachments" :key="f.key" class="pc-chip"><a href="#" class="pm-link" @click.prevent="openFile(f.key)">{{ f.name }}</a> <small>{{ fmtSize(f.size) }}</small>
            <button v-if="q.status === 'draft' && q.can.edit" class="btn btn-ghost" style="padding: 0 4px" @click="removeFile(f.key)">✕</button></span>
          <label v-if="['draft', 'published'].includes(q.status) && (q.can.edit || q.can.extend)" class="btn" style="padding: 2px 10px">+ مرفق<input type="file" hidden @change="addFile" /></label>
          <span v-if="!q.attachments.length && !q.can.edit" class="pm-muted">لا توجد مرفقات</span>
        </div>
      </section>
      <section class="card pm-panel">
        <h2>معايير التقييم</h2>
        <ul class="pc-log" style="gap: 4px">
          <li v-for="c in q.criteria" :key="c.key"><span>{{ c.name }} <b>{{ c.weight }}%</b> <small class="pm-muted">{{ c.kind === 'price' ? 'مالي آلي' : 'فني' }}</small></span></li>
        </ul>
        <p v-if="techCriteria.length" class="pm-muted" style="font-size: .82rem; margin-top: 8px">الحد الأدنى الفني {{ q.technicalPass }} · اللجنة: {{ q.committee.map((u: any) => u.name).join('، ') || '—' }}</p>
      </section>
    </div>

    <div class="pc-tabs" style="margin-top: 16px">
      <button :class="{ on: tab === 'quotes' }" @click="tab = 'quotes'">العروض والتقييم<b v-if="quotes.length">{{ quotes.length }}</b></button>
      <button :class="{ on: tab === 'invited' }" @click="tab = 'invited'">المدعوون<b>{{ q.invited.length }}</b></button>
      <button :class="{ on: tab === 'questions' }" @click="tab = 'questions'">الاستفسارات<b v-if="q.questions.some((x: any) => !x.answer)">{{ q.questions.filter((x: any) => !x.answer).length }}</b></button>
      <button :class="{ on: tab === 'log' }" @click="tab = 'log'">السجل</button>
    </div>

    <section v-if="tab === 'quotes'" class="card pm-panel">
      <div v-if="q.sealed">
        <div class="alert-info" style="margin-bottom: 12px">🔒 العروض مختومة: تظهر أسعارها ومرفقاتها بعد انتهاء موعد التقديم وفتحها.</div>
        <table class="pc-lines">
          <thead><tr><th>المورد</th><th>وقت التقديم</th><th>الطريقة</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="x in quotes" :key="x.id"><td><b>{{ x.supplier?.name }}</b></td><td>{{ fmtDateTime(x.submittedAt) }}</td><td>{{ x.via === 'portal' ? 'البوابة' : 'أدخله موظف' }}</td><td><span class="pm-pill" :style="{ '--c': QUOTE_COLOR[x.status] }">{{ x.statusLabel }}</span></td></tr>
            <tr v-if="!quotes.length"><td colspan="4" class="pc-empty">لم يُقدَّم أي عرض بعد</td></tr>
          </tbody>
        </table>
        <button v-if="q.can.staffQuote" class="btn" style="margin-top: 10px" @click="openStaff">+ إدخال عرض ورد ورقيًا</button>
      </div>
      <div v-else-if="!quotes.length" class="pc-empty">لم يُقدَّم أي عرض</div>
      <div v-else class="table-wrap">
        <table class="pc-cmp">
          <thead>
            <tr><th>البند</th><th>الكمية</th><th v-for="x in ranked" :key="x.id" :class="{ out: x.status === 'excluded' || (x.evaluation && !x.evaluation.passed) }">
              <span v-if="x.evaluation?.rank" :class="['pc-rank', { r1: x.evaluation.rank === 1 }]">{{ x.evaluation.rank }}</span> {{ x.supplier?.name }}
              <span v-if="q.recommendedQuoteId === x.id" class="pc-okflag">الموصى به</span>
              <span v-if="x.status === 'excluded'" class="pc-flag">مستبعد</span>
            </th></tr>
          </thead>
          <tbody>
            <tr v-for="l in q.lines" :key="l.id">
              <td>{{ l.description }}</td><td class="pc-num">{{ l.qty }} {{ l.uomName ?? '' }}</td>
              <td v-for="x in ranked" :key="x.id" :class="['pc-num', { best: price(x, l.id) === bestPrice(l.id), out: x.status === 'excluded' }]">{{ sar(price(x, l.id)) }}</td>
            </tr>
            <tr><td colspan="2">الإجمالي قبل الضريبة</td><td v-for="x in ranked" :key="x.id" class="pc-num">{{ sar(x.subtotal) }}</td></tr>
            <tr><td colspan="2">الضريبة</td><td v-for="x in ranked" :key="x.id" class="pc-num">{{ sar(x.vat) }} <small class="pm-muted">({{ x.vatRate }}%)</small></td></tr>
            <tr><td colspan="2"><b>الإجمالي</b></td><td v-for="x in ranked" :key="x.id" class="pc-num"><b>{{ sar(x.total) }}</b><small v-if="x.revisions?.length" class="pc-warn" style="display: block">بعد {{ x.revisions.length }} جولة تفاوض</small></td></tr>
            <tr><td colspan="2">مدة التوريد · سريان العرض</td><td v-for="x in ranked" :key="x.id">{{ x.deliveryDays ?? '—' }} يوم · {{ x.validityDays ?? '—' }} يوم</td></tr>
            <tr v-for="c in techCriteria" :key="c.key"><td colspan="2">{{ c.name }} <small class="pm-muted">({{ c.weight }}%)</small></td><td v-for="x in ranked" :key="x.id" class="pc-num">{{ x.evaluation?.technical?.[c.key] ?? '—' }}</td></tr>
            <tr v-if="techCriteria.length"><td colspan="2">الدرجة الفنية <small class="pm-muted">(الحد {{ q.technicalPass }})</small></td>
              <td v-for="x in ranked" :key="x.id" class="pc-num">{{ x.evaluation?.technicalScore ?? '—' }} <small class="pm-muted">({{ x.evaluation?.scoredBy ?? 0 }}/{{ q.committee.length }})</small><span v-if="x.evaluation && !x.evaluation.passed" class="pc-flag">لم يجتز</span></td></tr>
            <tr><td colspan="2">الدرجة المالية</td><td v-for="x in ranked" :key="x.id" class="pc-num">{{ x.evaluation?.financialScore ?? '—' }}</td></tr>
            <tr><td colspan="2"><b>الدرجة النهائية</b></td><td v-for="x in ranked" :key="x.id" class="pc-num"><b>{{ x.evaluation?.totalScore ?? '—' }}</b></td></tr>
            <tr class="pc-noprint"><td colspan="2" /><td v-for="x in ranked" :key="x.id">
              <div style="display: grid; gap: 4px">
                <button v-if="q.can.score && x.status === 'submitted'" class="btn" style="padding: 2px 8px" @click="openScore(x)">{{ x.myScore ? 'تعديل تقييمي' : 'تقييم فني' }}</button>
                <button v-if="q.can.manageQuotes && x.status === 'submitted'" class="btn" style="padding: 2px 8px" @click="openNegotiate(x)">جولة تفاوض</button>
                <button v-if="q.can.manageQuotes && x.status === 'submitted'" class="btn btn-ghost" style="padding: 2px 8px" @click="m = { quote: x, reason: '' }; modal = 'exclude'">استبعاد</button>
                <button v-if="q.can.manageQuotes && x.status === 'excluded'" class="btn btn-ghost" style="padding: 2px 8px" @click="run(() => api(`/procurement/quotes/${x.id}/restore`, { method: 'POST' }), 'أُعيد العرض')">إعادة</button>
                <a v-for="f in x.attachments" :key="f.key" href="#" class="pm-link" style="font-size: .78rem" @click.prevent="openQuoteFile(x.id, f.key)">📎 {{ f.name }}</a>
                <small v-if="x.technicalNote" class="pm-muted" style="white-space: pre-line">{{ x.technicalNote }}</small>
                <small v-if="x.excludedReason" class="pc-flag" style="white-space: normal">{{ x.excludedReason }}</small>
              </div>
            </td></tr>
          </tbody>
        </table>
        <div v-if="q.recommendation" class="alert-info" style="margin-top: 12px"><b>محضر التوصية</b> · {{ q.recommendedByName }} · {{ fmtDateTime(q.recommendedAt) }}<div style="white-space: pre-line">{{ q.recommendation }}</div></div>
        <div v-if="q.order" style="margin-top: 8px">التعميد: <RouterLink class="pm-link" :to="`/procurement/orders/${q.order.id}`">{{ q.order.code }}</RouterLink> · {{ sar(q.order.total) }} <span class="pm-pill" :style="{ '--c': ORDER_COLOR[q.order.status] }">{{ q.order.statusLabel }}</span></div>
      </div>
    </section>

    <section v-if="tab === 'invited'" class="card pm-panel">
      <table class="pc-lines">
        <thead><tr><th>المورد</th><th>العرض</th></tr></thead>
        <tbody><tr v-for="s in q.invited" :key="s.id">
          <td><RouterLink class="pm-link" :to="`/procurement/suppliers/${s.id}`">{{ s.name }}</RouterLink> <span class="pc-code">{{ s.code }}</span></td>
          <td><span v-if="s.quoteStatus" class="pm-pill" :style="{ '--c': QUOTE_COLOR[s.quoteStatus] }">{{ lk.quoteStatus[s.quoteStatus] }}</span><span v-else class="pm-muted">لم يقدم</span></td>
        </tr></tbody>
      </table>
    </section>

    <section v-if="tab === 'questions'" class="card pm-panel">
      <div v-for="x in q.questions" :key="x.id" style="padding: 10px 0; border-bottom: 1px dashed var(--border)">
        <div><b>س:</b> {{ x.question }} <small class="pm-muted">· {{ x.supplierName }} · {{ fmtDateTime(x.createdAt) }}</small></div>
        <div v-if="x.answer" style="margin-top: 4px"><b>ج:</b> {{ x.answer }} <small class="pm-muted">· {{ x.answeredByName }} · {{ x.published ? 'معمم على المدعوين' : 'للسائل فقط' }}</small></div>
        <button v-if="q.can.answer" class="btn" style="margin-top: 6px; padding: 2px 10px" @click="m = { question: x, answer: x.answer ?? '', published: x.published || !x.answer }; modal = 'answer'">{{ x.answer ? 'تعديل الرد' : 'الرد' }}</button>
      </div>
      <p v-if="!q.questions.length" class="pc-empty">لا توجد استفسارات</p>
    </section>

    <section v-if="tab === 'log'" class="card pm-panel">
      <ul class="pc-log">
        <li v-for="(x, i) in [...q.log].reverse()" :key="i"><span><b>{{ x.action }}</b> · {{ x.byName }} <small class="pm-muted">{{ fmtDateTime(x.at) }}</small><div v-if="x.note" class="pm-muted" style="font-size: .8rem">{{ x.note }}</div></span></li>
      </ul>
    </section>

    <!-- النوافذ -->
    <div v-if="modal" class="modal-backdrop" @click.self="modal = ''">
      <form v-if="modal === 'publish'" class="card modal" @submit.prevent="run(() => api(`${base()}/publish`, { method: 'POST', json: m }), 'نُشرت المنافسة وأُشعر الموردون')">
        <h2>نشر المنافسة</h2>
        <p class="pm-muted">الموردون المدعوون {{ q.invitedIds.length }}، والحد الأدنى {{ lk.sourcing.minQuotes }}. اكتب مبرر العدد الأقل ليُحفظ في السجل.</p>
        <label class="field"><span>المبرر</span><textarea v-model="m.fewerReason" class="input" rows="3" required /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">نشر</button><button type="button" class="btn" @click="modal = ''">رجوع</button></div>
      </form>
      <form v-if="modal === 'extend'" class="card modal" @submit.prevent="run(() => api(`${base()}/extend`, { method: 'POST', json: { closesAt: fromLocalInput(m.closesAt), questionsUntil: fromLocalInput(m.questionsUntil), reason: m.reason } }), 'مُدد الموعد وأُشعر الموردون')">
        <h2>تمديد موعد التقديم</h2>
        <label class="field"><span>الموعد الجديد للتقديم</span><input v-model="m.closesAt" type="datetime-local" class="input" required /></label>
        <label class="field"><span>موعد الاستفسارات</span><input v-model="m.questionsUntil" type="datetime-local" class="input" /></label>
        <label class="field"><span>السبب</span><textarea v-model="m.reason" class="input" rows="2" required /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">تمديد</button><button type="button" class="btn" @click="modal = ''">رجوع</button></div>
      </form>
      <form v-if="modal === 'cancel'" class="card modal" @submit.prevent="run(() => api(`${base()}/cancel`, { method: 'POST', json: m }), 'أُلغيت المنافسة')">
        <h2>إلغاء المنافسة</h2>
        <label class="field"><span>السبب (يصل للموردين المدعوين)</span><textarea v-model="m.reason" class="input" rows="3" required /></label>
        <div class="modal-actions"><button class="btn btn-danger" :disabled="busy">إلغاء المنافسة</button><button type="button" class="btn" @click="modal = ''">رجوع</button></div>
      </form>
      <form v-if="modal === 'answer'" class="card modal" @submit.prevent="run(() => api(`${base()}/questions/${m.question.id}/answer`, { method: 'POST', json: { answer: m.answer, published: m.published } }), 'أُرسل الرد')">
        <h2>الرد على الاستفسار</h2>
        <p class="pm-muted">{{ m.question.question }}</p>
        <label class="field"><span>الرد</span><textarea v-model="m.answer" class="input" rows="4" required /></label>
        <label class="pc-inline" style="font-size: .88rem"><input v-model="m.published" type="checkbox" /> تعميم الرد على كل المدعوين (بلا اسم السائل)</label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">إرسال</button><button type="button" class="btn" @click="modal = ''">رجوع</button></div>
      </form>
      <form v-if="modal === 'score'" class="card modal" @submit.prevent="submitScore">
        <h2>تقييم عرض {{ m.quote.supplier?.name }}</h2>
        <p class="pm-muted">قدّر كل معيار من 100. الدرجة الفنية متوسط تقديرات أعضاء اللجنة.</p>
        <label v-for="c in techCriteria" :key="c.key" class="field"><span>{{ c.name }} <b>{{ m.scores[c.key] }}</b></span><input v-model.number="m.scores[c.key]" type="range" min="0" max="100" step="5" /></label>
        <label class="field"><span>ملاحظات</span><textarea v-model="m.note" class="input" rows="2" /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ التقييم</button><button type="button" class="btn" @click="modal = ''">رجوع</button></div>
      </form>
      <form v-if="modal === 'negotiate'" class="card modal modal-wide" @submit.prevent="submitNegotiate">
        <h2>جولة تفاوض مع {{ m.quote.supplier?.name }}</h2>
        <table class="pc-lines">
          <thead><tr><th>البند</th><th>السعر الحالي</th><th>السعر بعد التفاوض</th></tr></thead>
          <tbody><tr v-for="l in q.lines" :key="l.id"><td>{{ l.description }}</td><td class="pc-num">{{ sar(price(m.quote, l.id)) }}</td><td><input v-model.number="m.prices[l.id]" type="number" step="any" min="0" class="input" /></td></tr></tbody>
        </table>
        <label class="field"><span>نتيجة الجولة (تُحفظ في محضر المنافسة)</span><textarea v-model="m.note" class="input" rows="2" required /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ</button><button type="button" class="btn" @click="modal = ''">رجوع</button></div>
      </form>
      <form v-if="modal === 'exclude'" class="card modal" @submit.prevent="run(() => api(`/procurement/quotes/${m.quote.id}/exclude`, { method: 'POST', json: { reason: m.reason } }), 'استُبعد العرض')">
        <h2>استبعاد عرض {{ m.quote.supplier?.name }}</h2>
        <label class="field"><span>السبب</span><textarea v-model="m.reason" class="input" rows="3" required placeholder="مثل: لم يرفق شهادة المطابقة المطلوبة" /></label>
        <div class="modal-actions"><button class="btn btn-danger" :disabled="busy">استبعاد</button><button type="button" class="btn" @click="modal = ''">رجوع</button></div>
      </form>
      <form v-if="modal === 'staff'" class="card modal modal-wide" @submit.prevent="submitStaff">
        <h2>إدخال عرض ورد خارج البوابة</h2>
        <label class="field"><span>المورد</span><select v-model="m.supplierId" class="input" required><option value="" disabled>اختر</option><option v-for="s in q.invited" :key="s.id" :value="s.id">{{ s.name }}</option></select></label>
        <table class="pc-lines">
          <thead><tr><th>البند</th><th>الكمية</th><th>سعر الوحدة قبل الضريبة</th></tr></thead>
          <tbody><tr v-for="l in q.lines" :key="l.id"><td>{{ l.description }}</td><td>{{ l.qty }}</td><td><input v-model.number="m.prices[l.id]" type="number" step="any" min="0" class="input" required /></td></tr></tbody>
        </table>
        <div class="pc-fields">
          <label class="field"><span>الضريبة</span><select v-model.number="m.vatRate" class="input"><option :value="15">15%</option><option :value="0">غير خاضع</option></select></label>
          <label class="field"><span>مدة التوريد (يوم)</span><input v-model.number="m.deliveryDays" type="number" min="0" class="input" /></label>
          <label class="field"><span>سريان العرض (يوم)</span><input v-model.number="m.validityDays" type="number" min="1" class="input" /></label>
        </div>
        <label class="field"><span>ملاحظات فنية</span><textarea v-model="m.technicalNote" class="input" rows="2" /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ العرض</button><button type="button" class="btn" @click="modal = ''">رجوع</button></div>
      </form>
      <form v-if="modal === 'recommend'" class="card modal" @submit.prevent="submitRecommend">
        <h2>التوصية بالترسية</h2>
        <p class="pm-muted">يُنشأ التعميد للعرض المختار ويدخل مسار الاعتماد حسب قيمته، والاعتماد الأخير يحجز المبلغ ويصدره للمورد.</p>
        <label class="field"><span>العرض</span>
          <select v-model="m.quoteId" class="input" required>
            <option v-for="x in ranked.filter((y: any) => y.status === 'submitted' && y.evaluation?.passed)" :key="x.id" :value="x.id">{{ x.evaluation?.rank ? `(${x.evaluation.rank}) ` : '' }}{{ x.supplier?.name }} · {{ sar(x.total) }}</option>
          </select>
        </label>
        <p v-if="m.quoteId && ranked.find((x: any) => x.id === m.quoteId)?.evaluation?.rank !== 1" class="pc-warn" style="white-space: normal">العرض المختار ليس الأعلى تقييمًا؛ اكتب مبررات واضحة.</p>
        <label class="field"><span>محضر التوصية ومبرراتها</span><textarea v-model="m.recommendation" class="input" rows="4" required /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">إعداد التعميد</button><button type="button" class="btn" @click="modal = ''">رجوع</button></div>
      </form>
    </div>
  </div>
</template>
