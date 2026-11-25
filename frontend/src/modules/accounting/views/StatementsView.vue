<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import FsAppropriationPane from '../components/FsAppropriationPane.vue';
import FsMappingPane from '../components/FsMappingPane.vue';
import FsVariancePane from '../components/FsVariancePane.vue';
import { P, dt, todayStr } from '../lib';
import { amt, currentPart, download, fetchHtml, printFrame, SPAN_LABEL, spanParts, type FsOptions, type FsPreview, type FsRow, type Span } from '../statements';
import '../../../shared/module.css';
import '../acc.css';

/**
 * إعداد الميزانية: القوائم المالية لأي فترة، والدليل وفق بنود القوائم، ومشروع توزيع الأرباح،
 * وانحرافات الموازنة، وسجل الإصدارات. المعاينة متاحة دائمًا بعلامة «مسودة»، والإصدار النهائي بعد إغلاق الفترة فقط.
 */
type Tab = 'statements' | 'mapping' | 'appropriation' | 'variance' | 'issues';
const props = withDefaults(defineProps<{ tab?: Tab }>(), { tab: 'statements' });
const router = useRouter();
const session = useSession();
const toast = useToast();

const tabs: { key: Tab; label: string }[] = [
  { key: 'statements', label: 'القوائم المالية والإصدار' },
  { key: 'mapping', label: 'الدليل وفق بنود القوائم' },
  { key: 'appropriation', label: 'مشروع توزيع الأرباح' },
  { key: 'variance', label: 'انحرافات الموازنة' },
  { key: 'issues', label: 'سجل الإصدارات' },
];
const tab = ref<Tab>(props.tab);
watch(() => props.tab, (t) => { tab.value = t; });
function go(t: Tab) {
  tab.value = t;
  router.replace(t === 'variance' ? '/accounting/statements/variance' : { path: '/accounting/statements', query: t === 'statements' ? {} : { tab: t } });
}

const canPrepare = computed(() => session.can(P.statements));
const opts = ref<FsOptions | null>(null);
const error = ref('');
const sel = reactive({ yearId: '', span: 'Q' as Span, part: 1 });
const year = computed(() => opts.value?.years.find((y) => y.id === sel.yearId));
const parts = computed(() => spanParts(year.value, sel.span));
const data = ref<FsPreview | null>(null);
const loading = ref(false);
const busy = ref<'' | 'preview' | 'print' | 'issue'>('');
const html = ref('');
const frame = ref<HTMLIFrameElement | null>(null);
const open = ref(new Set<string>());

const q = computed(() => new URLSearchParams({ yearId: sel.yearId, span: sel.span, part: String(sel.part) }).toString());

async function load() {
  if (!sel.yearId) return;
  loading.value = true; html.value = ''; open.value = new Set();
  try { data.value = await api<FsPreview>(`/accounting/statements?${q.value}`); error.value = ''; } catch (e) { data.value = null; error.value = (e as Error).message; } finally { loading.value = false; }
}
watch(() => sel.span, () => { sel.part = currentPart(year.value, sel.span, todayStr()); });
watch(() => sel.yearId, () => { sel.part = currentPart(year.value, sel.span, todayStr()); });
watch(q, load);

async function preview() {
  busy.value = 'preview';
  try { html.value = await fetchHtml(`/accounting/statements/document?${q.value}`); } catch (e) { toast.error((e as Error).message); } finally { busy.value = ''; }
}
async function print() {
  busy.value = 'print';
  try {
    if (!html.value) html.value = await fetchHtml(`/accounting/statements/document?${q.value}`);
    await new Promise((r) => setTimeout(r, 60));
    await printFrame(frame.value);
  } catch (e) { toast.error((e as Error).message); } finally { busy.value = ''; }
}
async function issue() {
  if (!data.value?.closure.closed) return;
  if (!confirm(`إصدار نهائي للقوائم المالية عن ${data.value.period.label}؟ سيُسجَّل الإصدار برقم وبصمة الملف ولا يُحذف.`)) return;
  busy.value = 'issue';
  try {
    const res = await download('/accounting/statements/issue', 'financial-statements.pdf', { method: 'POST', json: { yearId: sel.yearId, span: sel.span, part: sel.part } });
    toast.success(`تم الإصدار النهائي رقم ${res.headers.get('X-Issue-No') ?? ''} وتنزيل الملف`);
    await loadIssues();
  } catch (e) {
    toast.error(e instanceof ApiError && e.status === 503 ? 'محرك PDF غير متاح على الخادم حاليًا، استخدم المعاينة والطباعة مؤقتًا' : (e as Error).message);
  } finally { busy.value = ''; }
}

function toggle(code: string) {
  const s = new Set(open.value);
  if (s.has(code)) s.delete(code); else s.add(code);
  open.value = s;
}
const hasCmp = computed(() => !!data.value?.comparative);
const bsGroups = computed(() => (data.value?.bs.groups ?? []).filter((g) => g.rows.length));
const rowsOf = (r: FsRow) => (open.value.has(r.code) ? r.accounts : []);

// سجل الإصدارات
interface Issue { id: string; issueNo: number; year: string | null; periodLabel: string; fromDate: string; toDate: string; totals: Record<string, number>; sha256: string; issuedByName: string; issuedAt: string }
const issues = ref<Issue[]>([]);
async function loadIssues() { try { issues.value = await api<Issue[]>('/accounting/statements/issues'); } catch (e) { toast.error((e as Error).message); } }
watch(tab, (t) => { if (t === 'issues') loadIssues(); });

onMounted(async () => {
  const qt = router.currentRoute.value.query.tab;
  if (props.tab === 'statements' && typeof qt === 'string' && tabs.some((t) => t.key === qt)) tab.value = qt as Tab;
  try {
    opts.value = await api<FsOptions>('/accounting/statements/options');
    const today = todayStr();
    const y = opts.value.years.find((x) => x.startDate <= today && x.endDate >= today) ?? opts.value.years[0];
    sel.yearId = y?.id ?? '';
    if (tab.value === 'issues') loadIssues();
  } catch (e) { error.value = (e as Error).message; }
});
</script>

<template>
  <div>
    <section class="pm-hero ac-hero">
      <div>
        <p class="pm-kicker">النظام المالي</p>
        <h1>إعداد الميزانية والقوائم المالية</h1>
        <p class="pm-sub">قائمة المركز المالي وقائمة الدخل والتغيرات في حقوق الملكية والتدفقات النقدية والإيضاحات المتممة، في ملف واحد للمراجع الخارجي
          مرفق به الإهلاك التفصيلي وتحليل العملاء والموردين. ومعها مشروع توزيع الأرباح وتقرير انحرافات الموازنة.</p>
      </div>
    </section>

    <div class="pm-tabs">
      <button v-for="t in tabs" :key="t.key" :class="['pm-tab', { on: tab === t.key }]" @click="go(t.key)">{{ t.label }}</button>
    </div>
    <div v-if="error && tab === 'statements'" class="alert alert-error">{{ error }}</div>

    <!-- القوائم المالية والإصدار -->
    <template v-if="tab === 'statements' && opts">
      <section class="card pm-panel">
        <div class="fs-params">
          <label class="field"><span>السنة المالية</span>
            <select v-model="sel.yearId" class="input">
              <option v-if="!opts.years.length" value="">لا توجد سنوات مالية</option>
              <option v-for="y in opts.years" :key="y.id" :value="y.id">{{ y.name }} ({{ y.startDate }} – {{ y.endDate }}){{ y.status === 'closed' ? ' · مغلقة' : '' }}</option>
            </select></label>
          <label class="field fs-narrow"><span>نوع الفترة</span>
            <select v-model="sel.span" class="input"><option v-for="(l, k) in SPAN_LABEL" :key="k" :value="k">{{ l }}</option></select></label>
          <label v-if="sel.span !== 'Y'" class="field"><span>الفترة</span>
            <select v-model.number="sel.part" class="input"><option v-for="p in parts" :key="p.value" :value="p.value">{{ p.label }}</option></select></label>
        </div>
        <p class="pm-muted">قائمة المركز المالي في نهاية الفترة، وقائمة الدخل للفترة مع عمود من بداية السنة، والمقارنة بالفترة نفسها من السنة السابقة.</p>
      </section>

      <p v-if="loading" class="pm-empty">جارٍ احتساب القوائم...</p>
      <template v-else-if="data">
        <section class="card pm-panel fs-status" :class="data.closure.closed ? 'ok' : 'warn'">
          <div>
            <h2>{{ data.closure.closed ? 'الفترة مغلقة وقيودها مرحّلة، ويمكن الإصدار النهائي' : 'الفترة غير مغلقة: المعاينة متاحة بعلامة «مسودة»، والإصدار النهائي غير متاح' }}</h2>
            <ul v-if="!data.closure.closed" class="fs-list">
              <li v-for="r in data.closure.reasons" :key="r">{{ r }}</li>
            </ul>
            <p v-if="!data.closure.closed" class="pm-muted">رحّل القيود واعتمد السندات، ثم أغلق الشهور من <RouterLink to="/accounting/periods">إغلاق الفترات</RouterLink>.</p>
          </div>
          <div class="fs-actions">
            <button class="btn" :disabled="!!busy" @click="preview"><span v-if="busy === 'preview'" class="spin" />معاينة الملف الموحد</button>
            <button class="btn" :disabled="!!busy" @click="print"><span v-if="busy === 'print'" class="spin" />طباعة</button>
            <button v-if="canPrepare" class="btn btn-primary" :disabled="!!busy || !data.closure.closed || !opts.pdf"
              :title="!data.closure.closed ? 'لا يُصدَّر قبل إغلاق الفترة وترحيل قيودها' : !opts.pdf ? 'محرك PDF غير متاح على الخادم' : ''" @click="issue">
              <span v-if="busy === 'issue'" class="spin" />إصدار نهائي PDF للمراجع</button>
          </div>
        </section>

        <div v-if="data.warnings.length" class="alert alert-warn fs-warn"><b>ملاحظات قبل الإصدار</b><ul class="fs-list"><li v-for="w in data.warnings" :key="w">{{ w }}</li></ul></div>

        <div class="fs-kpis">
          <div class="card"><span>مجموع الأصول</span><b class="ac-num">{{ amt(data.totals.assets) }}</b></div>
          <div class="card"><span>مجموع الالتزامات</span><b class="ac-num">{{ amt(data.totals.liabilities) }}</b></div>
          <div class="card"><span>حقوق الملكية</span><b class="ac-num">{{ amt(data.totals.equity) }}</b></div>
          <div class="card"><span>صافي الربح للفترة</span><b class="ac-num" :class="{ neg: data.totals.netIncome < 0 }">{{ amt(data.totals.netIncome) }}</b></div>
          <div class="card"><span>النقد في نهاية الفترة</span><b class="ac-num">{{ amt(data.totals.cash) }}</b></div>
        </div>

        <!-- قائمة المركز المالي -->
        <section class="card pm-panel">
          <h2>قائمة المركز المالي <span class="pm-muted">كما في {{ data.period.to }}</span></h2>
          <div class="table-wrap"><table class="table fs-table">
            <thead><tr><th>البند</th><th class="fs-note">إيضاح</th><th class="ac-num">{{ data.period.to }}</th><th v-if="hasCmp" class="ac-num">{{ data.comparative!.end }}</th></tr></thead>
            <tbody>
              <template v-for="g in bsGroups" :key="g.key">
                <tr class="fs-group"><td :colspan="hasCmp ? 4 : 3">{{ g.name }}</td></tr>
                <template v-for="r in g.rows" :key="r.code">
                  <tr :class="{ 'ac-row-click': r.accounts.length }" @click="r.accounts.length && toggle(r.code)">
                    <td>{{ r.accounts.length ? (open.has(r.code) ? '▾ ' : '▸ ') : '' }}{{ r.name }}</td><td class="fs-note">{{ r.note ?? '' }}</td>
                    <td class="ac-num">{{ amt(r.cur) }}</td><td v-if="hasCmp" class="ac-num">{{ amt(r.cmp) }}</td>
                  </tr>
                  <tr v-for="a in rowsOf(r)" :key="a.id" class="fs-acc"><td><span class="ac-code">{{ a.code }}</span> {{ a.name }}</td><td /><td class="ac-num">{{ amt(a.cur) }}</td><td v-if="hasCmp" class="ac-num">{{ amt(a.cmp) }}</td></tr>
                </template>
                <tr class="fs-sub"><td>مجموع {{ g.name }}</td><td /><td class="ac-num">{{ amt(g.total.cur) }}</td><td v-if="hasCmp" class="ac-num">{{ amt(g.total.cmp) }}</td></tr>
              </template>
            </tbody>
            <tfoot>
              <tr><td>مجموع الأصول</td><td /><td class="ac-num">{{ amt(data.bs.totalAssets.cur) }}</td><td v-if="hasCmp" class="ac-num">{{ amt(data.bs.totalAssets.cmp) }}</td></tr>
              <tr><td>مجموع الالتزامات وحقوق الملكية</td><td /><td class="ac-num">{{ amt(data.bs.totalLiabEquity.cur) }}</td><td v-if="hasCmp" class="ac-num">{{ amt(data.bs.totalLiabEquity.cmp) }}</td></tr>
              <tr v-if="data.bs.difference.cur" class="neg"><td>الفرق</td><td /><td class="ac-num">{{ amt(data.bs.difference.cur) }}</td><td v-if="hasCmp" /></tr>
            </tfoot>
          </table></div>
        </section>

        <!-- قائمة الدخل -->
        <section class="card pm-panel">
          <h2>قائمة الدخل <span class="pm-muted">{{ data.period.range }}</span></h2>
          <div class="table-wrap"><table class="table fs-table">
            <thead><tr><th>البند</th><th class="fs-note">إيضاح</th><th class="ac-num">الفترة</th><th v-if="data.is.showYtd" class="ac-num">من بداية السنة</th><th v-if="hasCmp" class="ac-num">المقارنة</th></tr></thead>
            <tbody>
              <template v-for="s in data.is.sections" :key="s.key">
                <template v-if="s.rows">
                  <template v-if="s.rows.length">
                    <tr class="fs-group"><td :colspan="3 + (data.is.showYtd ? 1 : 0) + (hasCmp ? 1 : 0)">{{ s.name }}</td></tr>
                    <template v-for="r in s.rows" :key="r.code">
                      <tr :class="{ 'ac-row-click': r.accounts.length }" @click="r.accounts.length && toggle(r.code)">
                        <td>{{ r.accounts.length ? (open.has(r.code) ? '▾ ' : '▸ ') : '' }}{{ r.name }}</td><td class="fs-note">{{ r.note ?? '' }}</td>
                        <td class="ac-num">{{ amt(r.cur) }}</td><td v-if="data.is.showYtd" class="ac-num">{{ amt(r.ytd) }}</td><td v-if="hasCmp" class="ac-num">{{ amt(r.cmp) }}</td>
                      </tr>
                      <tr v-for="a in rowsOf(r)" :key="a.id" class="fs-acc"><td><span class="ac-code">{{ a.code }}</span> {{ a.name }}</td><td /><td class="ac-num">{{ amt(a.cur) }}</td><td v-if="data.is.showYtd" /><td v-if="hasCmp" class="ac-num">{{ amt(a.cmp) }}</td></tr>
                    </template>
                  </template>
                </template>
                <tr v-else class="fs-sub"><td>{{ s.name }}</td><td /><td class="ac-num">{{ amt(s.subtotal!.cur) }}</td><td v-if="data.is.showYtd" class="ac-num">{{ amt(s.subtotal!.ytd) }}</td><td v-if="hasCmp" class="ac-num">{{ amt(s.subtotal!.cmp) }}</td></tr>
              </template>
            </tbody>
          </table></div>
        </section>

        <div class="fs-two">
          <!-- التغيرات في حقوق الملكية -->
          <section class="card pm-panel">
            <h2>التغيرات في حقوق الملكية</h2>
            <div class="table-wrap"><table class="table fs-table">
              <thead><tr><th>البيان</th><th v-for="c in data.equity.columns" :key="c.code" class="ac-num">{{ c.name }}</th></tr></thead>
              <tbody><tr v-for="(r, i) in data.equity.rows" :key="r.label" :class="{ 'fs-sub': i === 0 || i === data.equity.rows.length - 1 }">
                <td>{{ r.label }}</td><td v-for="(v, j) in r.values" :key="j" class="ac-num">{{ amt(v) }}</td></tr></tbody>
            </table></div>
          </section>
          <!-- التدفقات النقدية -->
          <section class="card pm-panel">
            <h2>التدفقات النقدية <span class="pm-muted">الطريقة غير المباشرة</span></h2>
            <div class="table-wrap"><table class="table fs-table">
              <tbody>
                <tr class="fs-group"><td colspan="2">الأنشطة التشغيلية</td></tr>
                <tr><td>صافي ربح الفترة</td><td class="ac-num">{{ amt(data.cash.netIncome) }}</td></tr>
                <tr v-if="data.cash.depreciation"><td>يُضاف: الإهلاك والإطفاء</td><td class="ac-num">{{ amt(data.cash.depreciation) }}</td></tr>
                <tr v-for="r in data.cash.operating" :key="r.name"><td>{{ r.name }}</td><td class="ac-num">{{ amt(r.amount) }}</td></tr>
                <tr class="fs-sub"><td>صافي النقد من الأنشطة التشغيلية</td><td class="ac-num">{{ amt(data.cash.operatingTotal) }}</td></tr>
                <tr class="fs-group"><td colspan="2">الأنشطة الاستثمارية</td></tr>
                <tr v-for="r in data.cash.investing" :key="r.name"><td>{{ r.name }}</td><td class="ac-num">{{ amt(r.amount) }}</td></tr>
                <tr class="fs-sub"><td>صافي النقد من الأنشطة الاستثمارية</td><td class="ac-num">{{ amt(data.cash.investingTotal) }}</td></tr>
                <tr class="fs-group"><td colspan="2">الأنشطة التمويلية</td></tr>
                <tr v-for="r in data.cash.financing" :key="r.name"><td>{{ r.name }}</td><td class="ac-num">{{ amt(r.amount) }}</td></tr>
                <tr class="fs-sub"><td>صافي النقد من الأنشطة التمويلية</td><td class="ac-num">{{ amt(data.cash.financingTotal) }}</td></tr>
                <tr><td>صافي التغير في النقد</td><td class="ac-num">{{ amt(data.cash.netChange) }}</td></tr>
                <tr><td>النقد في بداية الفترة</td><td class="ac-num">{{ amt(data.cash.cashStart) }}</td></tr>
                <tr class="fs-sub"><td>النقد في نهاية الفترة</td><td class="ac-num">{{ amt(data.cash.cashEnd) }}</td></tr>
              </tbody>
            </table></div>
          </section>
        </div>
        <p class="pm-muted">الإيضاحات المتممة، والإهلاك التفصيلي، وتحليل أعمار أرصدة العملاء والموردين، والدليل وفق بنود القوائم، ومشروع توزيع الأرباح (للسنة كاملة) في الملف الموحد.</p>
      </template>

      <section v-show="html" class="card fs-preview">
        <iframe ref="frame" title="معاينة القوائم المالية" sandbox="allow-same-origin allow-modals" :srcdoc="html" />
      </section>
    </template>

    <FsMappingPane v-if="tab === 'mapping'" :can-edit="canPrepare" />
    <FsAppropriationPane v-if="tab === 'appropriation' && opts" :opts="opts" :can-edit="canPrepare" />
    <FsVariancePane v-if="tab === 'variance'" />

    <section v-if="tab === 'issues'" class="card pm-panel">
      <h2>سجل الإصدارات النهائية <span class="pm-muted">كل إصدار برقم متسلسل وبصمة الملف (SHA-256) للتحقق من أن النسخة لدى المراجع هي الصادرة من النظام</span></h2>
      <p v-if="!issues.length" class="pm-empty">لا توجد إصدارات نهائية بعد</p>
      <div v-else class="table-wrap"><table class="table">
        <thead><tr><th>الرقم</th><th>السنة</th><th>الفترة</th><th class="ac-num">الأصول</th><th class="ac-num">صافي الربح</th><th>أصدره</th><th>التاريخ</th><th>البصمة</th></tr></thead>
        <tbody><tr v-for="i in issues" :key="i.id">
          <td class="ac-code">{{ i.issueNo }}</td><td>{{ i.year ?? '' }}</td><td>{{ i.periodLabel }}</td>
          <td class="ac-num">{{ amt(i.totals.assets) }}</td><td class="ac-num">{{ amt(i.totals.netIncome) }}</td>
          <td>{{ i.issuedByName }}</td><td>{{ dt(i.issuedAt) }}</td><td class="ac-code fs-hash" :title="i.sha256">{{ i.sha256.slice(0, 16) }}…</td>
        </tr></tbody>
      </table></div>
    </section>
  </div>
</template>

<style scoped>
.fs-params { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.fs-params .field { flex: 1 1 260px; }
.fs-params .fs-narrow { flex: 0 1 170px; }
.fs-status { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; margin-top: 14px; border-inline-start: 4px solid var(--c); }
.fs-status.ok { --c: #10b981; }
.fs-status.warn { --c: #f59e0b; }
.fs-status h2 { margin-bottom: 6px; }
.fs-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.fs-actions .btn { display: inline-flex; align-items: center; gap: 6px; }
.fs-list { margin: 4px 0; padding-inline-start: 18px; }
.fs-warn { margin-top: 14px; }
.fs-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin: 14px 0; }
.fs-kpis .card { padding: 12px 14px; display: grid; gap: 4px; }
.fs-kpis span { color: var(--muted); font-size: .8rem; }
.fs-kpis b { font-size: 1.1rem; text-align: start; }
.fs-table td, .fs-table th { padding: 6px 10px; }
.fs-note { width: 60px; text-align: center; color: var(--muted); }
.fs-group td { font-weight: 700; background: var(--surface-2); }
.fs-sub td { font-weight: 700; border-top: 1px solid var(--border); }
.fs-acc td { font-size: .82rem; color: var(--muted); padding-inline-start: 26px; }
.fs-table tfoot td { font-weight: 800; border-top: 2px solid var(--border); }
.neg, .neg td { color: #b91c1c; }
.fs-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 14px; margin-top: 14px; }
.fs-two .pm-panel, .pm-panel + .pm-panel { margin-top: 14px; }
.fs-two .pm-panel { margin-top: 0; }
.fs-preview { margin-top: 14px; padding: 0; overflow: hidden; }
.fs-preview iframe { width: 100%; height: 80vh; border: 0; background: #fff; display: block; }
.fs-hash { font-size: .75rem; }
.spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid currentColor; border-top-color: transparent; animation: fs-spin .7s linear infinite; }
@keyframes fs-spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) { .fs-params .fs-narrow { flex: 1 1 100%; } .fs-two { grid-template-columns: 1fr; } }
</style>
