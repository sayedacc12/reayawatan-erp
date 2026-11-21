<script setup lang="ts">
/** إغلاق الفترات: شهور السنة المالية، يختار المستخدم الشهور ويغلقها أو يفتحها. لا يُغلق شهر قبل ترحيل كل مستنداته */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, dt, monthName, shortMonth } from '../lib';
import '../../../shared/module.css';
import '../acc.css';
import CloseFlow from '../components/CloseFlow.vue';

interface Month { month: string; closed: boolean; closedAt: string | null; closedByName: string | null; future: boolean; draftEntries: number; openVouchers: number; postedEntries: number }
interface Periods {
  year: { id: string; name: number; status: string; startDate: string; endDate: string; closedAt: string | null; closedByName: string | null;
    reopenedAt: string | null; reopenedByName: string | null; inventory: 'draft' | 'approved' | null };
  months: Month[];
}
interface Result extends Periods { done: string[]; failed: { month: string; reason: string }[] }

const session = useSession();
const toast = useToast();
const route = useRoute();
const years = ref<{ id: string; name: number; isCurrent: boolean }[]>([]);
const yearId = ref<string | null>(null);
const data = ref<Periods | null>(null);
const picked = ref<string[]>([]);
const busy = ref(false);
const failed = ref<{ month: string; reason: string }[]>([]);

onMounted(async () => {
  try {
    const o = await api<{ years: { id: string; name: number; isCurrent: boolean }[] }>('/accounting/setup');
    years.value = o.years;
    yearId.value = (route.query.year as string) || (o.years.find((y) => y.isCurrent) ?? o.years.at(-1))?.id || null;
  } catch (e) {
    toast.error((e as Error).message);
  }
});
async function load() {
  if (!yearId.value) return;
  try {
    data.value = await api<Periods>(`/accounting/periods/${yearId.value}`);
    if (route.hash === '#year') setTimeout(() => document.getElementById('year')?.scrollIntoView({ behavior: 'smooth' }), 50);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
watch(() => route.hash, (h) => { if (h === '#year') document.getElementById('year')?.scrollIntoView({ behavior: 'smooth' }); });
watch(yearId, () => { picked.value = []; failed.value = []; load(); });

const ready = (m: Month) => !m.draftEntries && !m.openVouchers;
const pickedOpen = computed(() => data.value?.months.filter((m) => !m.closed && picked.value.includes(m.month)) ?? []);
const pickedClosed = computed(() => data.value?.months.filter((m) => m.closed && picked.value.includes(m.month)) ?? []);
const yearOpen = computed(() => data.value?.year.status === 'open');
/**
 * التحديد بالتسلسل: الإغلاق من أول شهر مفتوح فما بعده دون فجوات، والفتح من آخر شهر مغلق فما قبله.
 * تحديد شهر مفتوح يحدد معه كل الشهور المفتوحة قبله، وتحديد شهر مغلق يحدد معه كل المغلقة بعده.
 */
function toggle(m: Month) {
  if (!yearOpen.value || !data.value) return;
  const all = data.value.months;
  const on = picked.value.includes(m.month);
  if (!m.closed) {
    const opens = all.filter((x) => !x.closed).map((x) => x.month);
    picked.value = on ? opens.filter((x) => x < m.month) : opens.filter((x) => x <= m.month);
  } else {
    const closed = all.filter((x) => x.closed).map((x) => x.month);
    picked.value = on ? closed.filter((x) => x > m.month) : closed.filter((x) => x >= m.month);
  }
}
/** الشهور الجاهزة المتتالية من أول شهر مفتوح حتى أول شهر غير جاهز */
function pickReady() {
  const out: string[] = [];
  for (const m of (data.value?.months ?? []).filter((x) => !x.closed)) {
    if (m.future || !ready(m)) break;
    out.push(m.month);
  }
  picked.value = out;
  if (!out.length) toast.error('أول شهر مفتوح غير جاهز للإغلاق: رحّل مستنداته واعتمد سنداته أولًا');
}
async function yearAction(kind: 'close' | 'reopen') {
  const y = data.value!.year;
  const msg = kind === 'close'
    ? `إغلاق السنة المالية ${y.name}؟ تُغلق كل شهورها ولا يُعدَّل عليها إلا بعد فتحها من صاحب الصلاحية.`
    : `فتح السنة ${y.name} المغلقة؟ أي تعديل عليها سيُظهر تنبيهًا مستمرًا لمدير النظام باختلاف الأرصدة الافتتاحية للسنة التالية.`;
  if (!confirm(msg)) return;
  busy.value = true;
  try {
    await api(`/accounting/years/${y.id}/${kind}`, { method: 'POST', json: {} });
    toast.success(kind === 'close' ? 'أُغلقت السنة المالية' : 'فُتحت السنة المالية');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function run(kind: 'close' | 'reopen') {
  const list = (kind === 'close' ? pickedOpen.value : pickedClosed.value).map((m) => m.month);
  if (!list.length) return;
  const names = list.map(shortMonth).join('، ');
  const msg = kind === 'close'
    ? `إغلاق ${list.length} شهر (${names})؟ لن يُسمح بالتسجيل فيها أو فك ترحيل مستنداتها حتى تُفتح.`
    : `فتح ${list.length} شهر (${names})؟ سيُسمح بالتعديل وفك الترحيل فيها.`;
  if (!confirm(msg)) return;
  busy.value = true;
  try {
    const r = await api<Result>(`/accounting/periods/${kind}`, { method: 'POST', json: { fiscalYearId: yearId.value, months: list } });
    data.value = r;
    failed.value = r.failed;
    picked.value = [];
    if (r.done.length) toast.success(kind === 'close' ? `أُغلق ${r.done.length} شهر` : `فُتح ${r.done.length} شهر`);
    if (r.failed.length) toast.error(`تعذر ${kind === 'close' ? 'إغلاق' : 'فتح'} ${r.failed.length} شهر`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <section class="pm-hero ac-hero">
      <div>
        <p class="pm-kicker">النظام المالي{{ data ? ` · السنة المالية ${data.year.name}` : '' }}</p>
        <h1>الترحيل والإغلاق · إغلاق الفترات</h1>
        <p class="pm-sub">اختر الشهور ثم أغلقها بالتسلسل: لا يُغلق شهر وما قبله مفتوح، ولا يُغلق قبل ترحيل كل مستنداته واعتماد سنداته. ولا يُفك ترحيل أي مستند في شهر مغلق إلا بعد فتحه، والفتح يبدأ من آخر شهر مغلق.</p>
      </div>
      <div class="pm-actions">
        <select v-model="yearId" class="input" style="width: 170px"><option v-for="y in years" :key="y.id" :value="y.id">السنة المالية {{ y.name }}</option></select>
      </div>
    </section>
    <CloseFlow />

    <section v-if="data" class="card pm-panel">
      <h2>
        شهور السنة <small class="pm-muted">{{ data.months.filter((m) => m.closed).length }} من {{ data.months.length }} مغلق</small>
        <span v-if="yearOpen" class="tools">
          <button class="btn btn-sm" @click="pickReady">تحديد الشهور الجاهزة</button>
          <button v-if="picked.length" class="btn btn-sm" @click="picked = []">إلغاء التحديد</button>
        </span>
      </h2>
      <p v-if="!yearOpen" class="alert alert-error">السنة المالية مغلقة. تُفتح من شاشة الافتتاحيات بصلاحية فتح السنوات.</p>

      <div class="pgrid">
        <button
          v-for="(m, i) in data.months" :key="m.month" type="button"
          :class="['pcell', { closed: m.closed, sel: picked.includes(m.month), blocked: !m.closed && !ready(m), future: m.future }]"
          :style="{ animationDelay: i * 35 + 'ms' }" :disabled="!yearOpen" @click="toggle(m)"
        >
          <span class="chk">{{ picked.includes(m.month) ? '✓' : '' }}</span>
          <b>{{ shortMonth(m.month) }}</b><small>{{ m.month.slice(0, 4) }}</small>
          <span class="st">{{ m.closed ? '🔒 مغلق' : m.future ? 'لم يبدأ بعد' : ready(m) ? 'جاهز للإغلاق' : 'غير جاهز' }}</span>
          <span v-if="m.closed" class="meta">{{ m.closedByName }}</span>
          <template v-else>
            <span v-if="m.draftEntries" class="warn">{{ m.draftEntries }} قيد غير مرحّل</span>
            <span v-if="m.openVouchers" class="warn">{{ m.openVouchers }} سند لم يُعتمد</span>
            <span v-if="ready(m)" class="meta">{{ m.postedEntries }} قيد مرحّل</span>
          </template>
        </button>
      </div>

      <div v-if="yearOpen" class="bar">
        <span class="pm-muted">المحدد: {{ picked.length ? picked.map(shortMonth).join('، ') : 'لا شيء' }}</span>
        <button v-if="session.can(P.closePeriods)" class="btn ac-glow" :disabled="busy || !pickedOpen.length" @click="run('close')">إغلاق الشهور المحددة ({{ pickedOpen.length }})</button>
        <button v-if="session.can(P.reopenPeriods)" class="btn" :disabled="busy || !pickedClosed.length" @click="run('reopen')">فتح الشهور المحددة ({{ pickedClosed.length }})</button>
      </div>

      <div v-if="failed.length" class="alert alert-error" style="margin-top: 12px">
        <b>شهور لم تُنفَّذ:</b>
        <ul><li v-for="x in failed" :key="x.month">{{ monthName(x.month) }}: {{ x.reason }}</li></ul>
      </div>
    </section>

    <section v-if="data" id="year" :class="['card', 'pm-panel', 'yclose', { done: !yearOpen }]" style="margin-top: 16px">
      <h2>إغلاق السنة المالية {{ data.year.name }}</h2>
      <div class="ysteps">
        <span :class="{ ok: data.months.every((m) => m.closed) }">{{ data.months.every((m) => m.closed) ? '✓' : '○' }} إغلاق كل الشهور ({{ data.months.filter((m) => m.closed).length }}/{{ data.months.length }})</span>
        <span :class="{ ok: data.year.inventory === 'approved' }">{{ data.year.inventory === 'approved' ? '✓' : '○' }} اعتماد محضر جرد السندات من مدير النظام
          <RouterLink to="/accounting/inventory" class="pm-link">المحضر</RouterLink></span>
        <span>○ إغلاق السنة السابقة إن وجدت</span>
      </div>
      <p v-if="data.year.closedAt" class="pm-muted">أُغلقت {{ dt(data.year.closedAt) }} · {{ data.year.closedByName }}</p>
      <p v-if="data.year.reopenedAt" class="pm-muted">آخر فتح {{ dt(data.year.reopenedAt) }} · {{ data.year.reopenedByName }}</p>
      <div class="modal-actions">
        <button v-if="yearOpen && session.can(P.closePeriods)" class="btn btn-primary" :disabled="busy" @click="yearAction('close')">إغلاق السنة</button>
        <button v-if="!yearOpen && session.can(P.reopenPeriods)" class="btn btn-danger" :disabled="busy" @click="yearAction('reopen')">فتح السنة المغلقة</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tools { display: inline-flex; gap: 6px; margin-inline-start: auto; }
.pgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-top: 8px; }
.pcell { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; text-align: start; padding: 14px; border-radius: 16px; cursor: pointer;
  border: 2px solid var(--border); background: var(--surface); color: inherit; font: inherit; transition: transform .2s, border-color .2s, box-shadow .2s; animation: pin .5s var(--ease) both; }
.pcell:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(15, 118, 110, .12); }
.pcell b { font-size: 1.1rem; }
.pcell small { color: var(--muted); }
.pcell .st { font-weight: 700; font-size: .85rem; color: #059669; margin-top: 4px; }
.pcell .warn { font-size: .78rem; color: #b45309; }
.pcell .meta { font-size: .78rem; color: var(--muted); }
.pcell.blocked .st { color: #b45309; }
.pcell.future { opacity: .7; }
.pcell.closed { background: linear-gradient(135deg, #0f766e, #134e4a); color: #fff; border-color: transparent; }
.pcell.closed small, .pcell.closed .meta { color: rgba(255, 255, 255, .75); }
.pcell.closed .st { color: #fde68a; }
.pcell.sel { border-color: #f59e0b; box-shadow: 0 0 0 4px rgba(245, 158, 11, .2); }
.chk { position: absolute; inset-inline-end: 10px; top: 10px; width: 22px; height: 22px; border-radius: 7px; border: 2px solid var(--border); display: grid; place-items: center; font-weight: 800; color: #fff; }
.pcell.sel .chk { background: #f59e0b; border-color: #f59e0b; }
.pcell.closed .chk { border-color: rgba(255, 255, 255, .5); }
.ysteps { display: flex; flex-direction: column; gap: 6px; margin: 6px 0 10px; }
.ysteps span { color: var(--muted); }
.ysteps span.ok { color: #059669; font-weight: 600; }
.yclose.done { border: 2px solid #0f766e; }
.bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: flex-end; margin-top: 16px; padding-top: 12px; border-top: 1px dashed var(--border); }
.bar .pm-muted { margin-inline-end: auto; }
@keyframes pin { from { opacity: 0; transform: scale(.94); } }
</style>
