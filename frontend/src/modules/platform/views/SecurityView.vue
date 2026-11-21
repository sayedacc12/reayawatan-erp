<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { fmtDateTime } from '../labels';
import '../platform.css';

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
interface Settings {
  enabled: boolean; recipients: string[]; autoActions: boolean; dailyReport: boolean; dailyHour: number; blockMinutes: number;
  trustedIps: string[]; thresholds: { bruteForce: number; scan: number; probe: number; exports: number; errors: number };
}
interface Overview {
  status: 'ok' | 'watch' | 'attention'; counts: Record<string, number>; openIncidents: number; pendingApprovals: number; activeBlocks: number;
  lastReport: { day: string; at: string; status: string } | null; settings: Settings; recipients: string[]; retentionDays: number;
}
interface Action { at: string; kind: string; text: string; by: string }
interface Incident {
  id: string; rule: string; severity: Severity; title: string; summary: string; ip: string | null; hits: number;
  status: 'open' | 'acknowledged' | 'resolved'; actions: Action[]; pendingAction: string | null; firstSeenAt: string; lastSeenAt: string;
  closedBy: string | null; user: { name: string; email: string; active: boolean; org: string | null } | null;
}
interface Block { id: string; ip: string; reason: string; createdBy: string; createdAt: string; expiresAt: string; liftedAt: string | null; liftedBy: string | null; blockedRequests: number }
interface Event { id: string; at: string; type: string; severity: Severity; ip: string | null; actor: string | null; method: string | null; route: string | null; status: number | null }
interface Page<T> { total: number; page: number; pageSize: number; rows: T[] }
interface Report { id: string; day: string; createdAt: string; recipients: string[]; summary: { status: string; incidents: { total: number }; blocks: { created: number }; recommendations: string[] } }

const SEVERITY: Record<Severity, { text: string; tone: string }> = {
  critical: { text: 'حرج', tone: 'bad' }, high: { text: 'مرتفع', tone: 'bad' }, medium: { text: 'متوسط', tone: 'warn' },
  low: { text: 'منخفض', tone: 'muted' }, info: { text: 'معلومة', tone: 'muted' },
};
const STATUS: Record<string, string> = { open: 'مفتوحة', acknowledged: 'قيد المتابعة', resolved: 'مغلقة' };
const EVENT: Record<string, string> = {
  login_success: 'دخول ناجح', login_failed: 'دخول فاشل', login_throttled: 'دخول تجاوز الحد', auth_required: 'طلب بلا جلسة',
  forbidden: 'رفض صلاحية', not_found: 'سجل غير موجود', unknown_route: 'مسار غير موجود', rate_limited: 'تجاوز حد الطلبات',
  server_error: 'خطأ خادم', export: 'تصدير', admin_change: 'تغيير إداري', ip_blocked: 'حظر عنوان', ip_unblocked: 'رفع حظر',
  auto_action: 'إجراء تلقائي', admin_security: 'قرار إداري', events_dropped: 'أحداث لم تُسجل',
};

const tab = ref<'incidents' | 'blocks' | 'events' | 'reports' | 'settings'>('incidents');
const data = ref<Overview | null>(null);
const error = ref('');
const notice = ref('');
const busy = ref(false);

const incidents = ref<Page<Incident> | null>(null);
const incFilter = ref('active');
const blocks = ref<Page<Block> | null>(null);
const blocksActive = ref(true);
const events = ref<Page<Event> | null>(null);
const evFilter = reactive({ type: '', ip: '' });
const reports = ref<Report[]>([]);
const form = reactive({ ...emptySettings(), recipientsText: '', trustedText: '' });
const blockForm = reactive({ ip: '', minutes: 60, reason: '' });

function emptySettings(): Settings {
  return { enabled: true, recipients: [], autoActions: true, dailyReport: true, dailyHour: 7, blockMinutes: 60, trustedIps: [], thresholds: { bruteForce: 10, scan: 40, probe: 20, exports: 30, errors: 20 } };
}

async function run<T>(fn: () => Promise<T>, ok?: string) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const r = await fn();
    if (ok) notice.value = ok;
    return r;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function loadOverview() {
  const o = await api<Overview>('/platform/security');
  data.value = o;
  Object.assign(form, structuredClone(o.settings), { recipientsText: o.settings.recipients.join('\n'), trustedText: o.settings.trustedIps.join('\n') });
}
const loadIncidents = async (page = 1) => { incidents.value = await api<Page<Incident>>(`/platform/security/incidents?status=${incFilter.value}&page=${page}`); };
const loadBlocks = async (page = 1) => { blocks.value = await api<Page<Block>>(`/platform/security/blocks?active=${blocksActive.value ? '1' : '0'}&page=${page}`); };
async function loadEvents(page = 1) {
  const q = new URLSearchParams({ page: String(page) });
  if (evFilter.type) q.set('type', evFilter.type);
  if (evFilter.ip.trim()) q.set('ip', evFilter.ip.trim());
  events.value = await api<Page<Event>>(`/platform/security/events?${q}`);
}
const loadReports = async () => { reports.value = await api<Report[]>('/platform/security/reports'); };

async function open(t: typeof tab.value) {
  tab.value = t;
  await run(async () => {
    if (t === 'incidents') await loadIncidents();
    if (t === 'blocks') await loadBlocks();
    if (t === 'events') await loadEvents();
    if (t === 'reports') await loadReports();
  });
}

onMounted(() => run(async () => { await loadOverview(); await loadIncidents(); }));

async function incidentAction(i: Incident, action: string, ok: string, confirmText?: string) {
  if (confirmText && !confirm(confirmText)) return;
  await run(async () => {
    await api(`/platform/security/incidents/${i.id}/${action}`, { method: 'POST', json: {} });
    await Promise.all([loadIncidents(incidents.value?.page ?? 1), loadOverview()]);
  }, ok);
}

async function lift(b: Block) {
  if (!confirm(`رفع الحظر عن ${b.ip}؟`)) return;
  await run(async () => {
    await api(`/platform/security/blocks/${b.id}/lift`, { method: 'POST' });
    await Promise.all([loadBlocks(blocks.value?.page ?? 1), loadOverview()]);
  }, 'رُفع الحظر');
}

async function addBlock() {
  await run(async () => {
    await api('/platform/security/blocks', { method: 'POST', json: { ip: blockForm.ip.trim(), minutes: blockForm.minutes, reason: blockForm.reason.trim() } });
    Object.assign(blockForm, { ip: '', minutes: 60, reason: '' });
    await Promise.all([loadBlocks(), loadOverview()]);
  }, 'حُظر العنوان');
}

async function save() {
  const lines = (s: string) => s.split(/[\s,،]+/).map((x) => x.trim()).filter(Boolean);
  await run(async () => {
    const { recipientsText, trustedText, ...rest } = form;
    await api('/platform/security/settings', { method: 'PUT', json: { ...rest, recipients: lines(recipientsText), trustedIps: lines(trustedText) } });
    await loadOverview();
  }, 'حُفظت الإعدادات');
}

async function sendReport() {
  await run(async () => {
    await api('/platform/security/reports/send', { method: 'POST' });
    await Promise.all([loadReports(), loadOverview()]);
  }, 'أُنشئ التقرير وأُرسل بالبريد');
}

const banner = computed(() => {
  const d = data.value;
  if (!d) return null;
  if (!d.settings.enabled) return { tone: 'warn', text: 'المراقب الأمني موقوف من الإعدادات: لا تُسجل الأحداث ولا تُرصد الهجمات. الحظر القائم يبقى حتى ينتهي.' };
  if (d.status === 'attention') return { tone: 'bad', text: d.pendingApprovals ? `يوجد ${d.pendingApprovals} إجراء ينتظر موافقتك، وحوادث تحتاج مراجعة.` : 'توجد حوادث مهمة مفتوحة تحتاج مراجعتك.' };
  if (d.status === 'watch') return { tone: 'warn', text: `توجد ${d.openIncidents} حادثة مفتوحة للمتابعة. الأنظمة تعمل كالمعتاد.` };
  return { tone: 'ok', text: 'لا توجد حوادث مفتوحة. المراقب يعمل ويراقب النظام على مدار الساعة.' };
});
const c = (k: string) => data.value?.counts[k] ?? 0;
const blockActive = (b: Block) => !b.liftedAt && new Date(b.expiresAt).getTime() > Date.now();
const pages = (p: Page<unknown> | null) => (p ? Math.max(1, Math.ceil(p.total / p.pageSize)) : 1);
</script>

<template>
  <div>
    <section class="p-hero">
      <div>
        <p class="p-kicker">الحماية والمراقبة</p>
        <h1>المراقب الأمني «سيد»</h1>
        <p class="p-sub">
          يراقب «سيد» محاولات الدخول والطلبات المرفوضة وأخطاء الخادم وعمليات التصدير، وينبهك بالبريد فور رصد سلوك شاذ،
          ويتعامل مع مصدر الهجوم وحده: يحظر العنوان المهاجم مؤقتًا، أو ينهي جلسات حساب مشتبه به. لا يُغلق أي نظام، ولا يلاحظ بقية المستخدمين شيئًا،
          وإيقاف حساب موظف لا يحدث إلا بموافقتك.
        </p>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="notice" class="alert alert-success">{{ notice }}</div>

    <template v-if="data">
      <div v-if="banner" :class="['s-banner', `s-${banner.tone}`]">{{ banner.text }}</div>

      <div class="s-stats">
        <div class="card s-stat"><span>حوادث مفتوحة</span><b>{{ data.openIncidents }}</b></div>
        <div class="card s-stat"><span>تنتظر موافقتك</span><b :class="{ 's-red': data.pendingApprovals }">{{ data.pendingApprovals }}</b></div>
        <div class="card s-stat"><span>عناوين محظورة الآن</span><b>{{ data.activeBlocks }}</b></div>
        <div class="card s-stat"><span>دخول ناجح / فاشل (24 ساعة)</span><b>{{ c('login_success') }} / {{ c('login_failed') }}</b></div>
        <div class="card s-stat"><span>طلبات مرفوضة (24 ساعة)</span><b>{{ c('forbidden') + c('unknown_route') + c('rate_limited') }}</b></div>
        <div class="card s-stat"><span>أخطاء الخادم (24 ساعة)</span><b>{{ c('server_error') }}</b></div>
      </div>

      <nav class="s-tabs">
        <button :class="{ on: tab === 'incidents' }" @click="open('incidents')">الحوادث</button>
        <button :class="{ on: tab === 'blocks' }" @click="open('blocks')">الحظر المؤقت</button>
        <button :class="{ on: tab === 'events' }" @click="open('events')">سجل الأحداث</button>
        <button :class="{ on: tab === 'reports' }" @click="open('reports')">التقارير اليومية</button>
        <button :class="{ on: tab === 'settings' }" @click="open('settings')">الإعدادات</button>
      </nav>

      <!-- الحوادث -->
      <section v-if="tab === 'incidents'" class="card p-panel">
        <div class="s-bar">
          <select v-model="incFilter" class="input s-narrow" @change="run(() => loadIncidents())">
            <option value="active">المفتوحة وقيد المتابعة</option>
            <option value="resolved">المغلقة</option>
            <option value="">الكل</option>
          </select>
        </div>
        <div v-if="incidents && !incidents.rows.length" class="muted center s-empty">لا توجد حوادث هنا.</div>
        <article v-for="i in incidents?.rows ?? []" :key="i.id" :class="['s-inc', `s-${SEVERITY[i.severity].tone}-edge`]">
          <header>
            <span :class="['tone', `tone-${SEVERITY[i.severity].tone}`]">{{ SEVERITY[i.severity].text }}</span>
            <h3>{{ i.title }}</h3>
            <span class="muted">{{ STATUS[i.status] }}</span>
          </header>
          <p>{{ i.summary }}</p>
          <dl class="p-dl">
            <dt>أول رصد</dt><dd>{{ fmtDateTime(i.firstSeenAt) }}</dd>
            <dt>آخر رصد</dt><dd>{{ fmtDateTime(i.lastSeenAt) }} <small class="muted">({{ i.hits }} مرة)</small></dd>
            <template v-if="i.ip"><dt>العنوان</dt><dd dir="ltr" class="s-ltr">{{ i.ip }}</dd></template>
            <template v-if="i.user"><dt>الحساب</dt><dd>{{ i.user.name }} ({{ i.user.email }}) · {{ i.user.org ?? 'إدارة المنصة' }} <span v-if="!i.user.active" class="tone tone-bad">موقوف</span></dd></template>
          </dl>
          <ul v-if="i.actions.length" class="s-actions">
            <li v-for="(a, n) in i.actions" :key="n"><small class="muted">{{ fmtDateTime(a.at) }} · {{ a.by }}</small> {{ a.text }}</li>
          </ul>
          <div v-if="i.pendingAction === 'suspend_user'" class="s-pending">
            <b>ينتظر موافقتك: إيقاف الحساب المشتبه به.</b>
            <span>أُنهيت جلساته تلقائيًا. إن لم يكن صاحب الحساب هو من قام بذلك، أوقف الحساب حتى تتحقق.</span>
            <div class="s-btns">
              <button class="btn btn-danger btn-sm" :disabled="busy" @click="incidentAction(i, 'approve-suspend', 'أُوقف الحساب', 'إيقاف هذا الحساب؟ لن يستطيع الدخول حتى يُعاد تفعيله.')">إيقاف الحساب</button>
              <button class="btn btn-sm" :disabled="busy" @click="incidentAction(i, 'dismiss-suspend', 'رُفض الإيقاف')">لا حاجة للإيقاف</button>
            </div>
          </div>
          <div class="s-btns">
            <button v-if="i.status === 'open'" class="btn btn-sm" :disabled="busy" @click="incidentAction(i, 'ack', 'سُجل اطلاعك')">اطلعت عليها</button>
            <button v-if="i.status !== 'resolved'" class="btn btn-primary btn-sm" :disabled="busy" @click="incidentAction(i, 'resolve', 'أُغلقت الحادثة', 'إغلاق الحادثة؟')">إغلاق الحادثة</button>
            <button v-if="i.user && !i.user.active && i.actions.some((a) => a.kind === 'suspend')" class="btn btn-sm" :disabled="busy" @click="incidentAction(i, 'reactivate', 'أُعيد تفعيل الحساب', 'إعادة تفعيل الحساب؟')">إعادة تفعيل الحساب</button>
          </div>
        </article>
        <div v-if="incidents && pages(incidents) > 1" class="s-pager">
          <button class="btn btn-sm" :disabled="incidents.page <= 1" @click="run(() => loadIncidents(incidents!.page - 1))">السابق</button>
          <span>{{ incidents.page }} / {{ pages(incidents) }}</span>
          <button class="btn btn-sm" :disabled="incidents.page >= pages(incidents)" @click="run(() => loadIncidents(incidents!.page + 1))">التالي</button>
        </div>
      </section>

      <!-- الحظر -->
      <section v-if="tab === 'blocks'" class="card p-panel">
        <form class="s-form" @submit.prevent="addBlock">
          <h2>حظر عنوان يدويًا</h2>
          <div class="s-row">
            <div class="field"><label>العنوان (IP)</label><input v-model="blockForm.ip" class="input" dir="ltr" required maxlength="64" placeholder="203.0.113.5" /></div>
            <div class="field"><label>المدة بالدقائق</label><input v-model.number="blockForm.minutes" class="input" type="number" min="5" max="43200" dir="ltr" required /></div>
            <div class="field s-grow"><label>السبب</label><input v-model="blockForm.reason" class="input" required minlength="3" maxlength="300" /></div>
          </div>
          <button class="btn btn-primary" :disabled="busy">حظر</button>
        </form>
        <label class="check"><input v-model="blocksActive" type="checkbox" @change="run(() => loadBlocks())" /> النشط فقط</label>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>العنوان</th><th>السبب</th><th>بواسطة</th><th>من</th><th>حتى</th><th>طلبات مُنعت</th><th></th></tr></thead>
            <tbody>
              <tr v-for="b in blocks?.rows ?? []" :key="b.id">
                <td dir="ltr" class="s-ltr">{{ b.ip }}</td>
                <td>{{ b.reason }}</td>
                <td>{{ b.createdBy }}</td>
                <td>{{ fmtDateTime(b.createdAt) }}</td>
                <td>
                  {{ fmtDateTime(b.expiresAt) }}
                  <small v-if="b.liftedAt" class="muted"><br />رُفع: {{ b.liftedBy }}</small>
                </td>
                <td>{{ b.blockedRequests }}</td>
                <td><button v-if="blockActive(b)" class="btn btn-sm" :disabled="busy" @click="lift(b)">رفع الحظر</button></td>
              </tr>
              <tr v-if="blocks && !blocks.rows.length"><td colspan="7" class="muted center">لا يوجد حظر</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- السجل -->
      <section v-if="tab === 'events'" class="card p-panel">
        <form class="s-bar" @submit.prevent="run(() => loadEvents())">
          <select v-model="evFilter.type" class="input s-narrow">
            <option value="">كل الأنواع</option>
            <option v-for="(label, k) in EVENT" :key="k" :value="k">{{ label }}</option>
          </select>
          <input v-model="evFilter.ip" class="input s-narrow" dir="ltr" placeholder="IP" maxlength="64" />
          <button class="btn btn-sm">عرض</button>
        </form>
        <p class="muted">يُحتفظ بالأحداث التفصيلية {{ data.retentionDays }} يومًا. لا تُسجل كلمات المرور أو محتوى الطلبات أبدًا.</p>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>الوقت</th><th>الحدث</th><th>العنوان</th><th>الحساب</th><th>المسار</th><th>الرمز</th></tr></thead>
            <tbody>
              <tr v-for="e in events?.rows ?? []" :key="e.id">
                <td>{{ fmtDateTime(e.at) }}</td>
                <td>{{ EVENT[e.type] ?? e.type }}</td>
                <td dir="ltr" class="s-ltr">{{ e.ip ?? '' }}</td>
                <td class="s-ltr" dir="ltr">{{ e.actor ?? '' }}</td>
                <td dir="ltr" class="s-ltr s-route">{{ e.method }} {{ e.route }}</td>
                <td>{{ e.status ?? '' }}</td>
              </tr>
              <tr v-if="events && !events.rows.length"><td colspan="6" class="muted center">لا توجد أحداث</td></tr>
            </tbody>
          </table>
        </div>
        <div v-if="events && pages(events) > 1" class="s-pager">
          <button class="btn btn-sm" :disabled="events.page <= 1" @click="run(() => loadEvents(events!.page - 1))">السابق</button>
          <span>{{ events.page }} / {{ pages(events) }}</span>
          <button class="btn btn-sm" :disabled="events.page >= pages(events)" @click="run(() => loadEvents(events!.page + 1))">التالي</button>
        </div>
      </section>

      <!-- التقارير -->
      <section v-if="tab === 'reports'" class="card p-panel">
        <div class="s-bar">
          <p class="muted s-grow">
            يصل التقرير اليومي الساعة {{ data.settings.dailyHour }}:00 بتوقيت الرياض إلى: <span dir="ltr">{{ data.recipients.join('، ') || 'لا يوجد مستلم' }}</span>
          </p>
          <button class="btn btn-primary btn-sm" :disabled="busy" @click="sendReport">إنشاء تقرير اليوم وإرساله الآن</button>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>اليوم</th><th>الحالة</th><th>الحوادث</th><th>عناوين حُظرت</th><th>التوصيات</th></tr></thead>
            <tbody>
              <tr v-for="r in reports" :key="r.id">
                <td>{{ r.day }}</td>
                <td><span :class="['tone', r.summary.status === 'ok' ? 'tone-ok' : 'tone-warn']">{{ r.summary.status === 'ok' ? 'سليم' : 'يحتاج انتباه' }}</span></td>
                <td>{{ r.summary.incidents.total }}</td>
                <td>{{ r.summary.blocks.created }}</td>
                <td><ul class="s-recs"><li v-for="(x, n) in r.summary.recommendations" :key="n">{{ x }}</li></ul></td>
              </tr>
              <tr v-if="!reports.length"><td colspan="5" class="muted center">لم يُرسل أي تقرير بعد</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- الإعدادات -->
      <section v-if="tab === 'settings'" class="card p-panel">
        <form class="s-form" @submit.prevent="save">
          <label class="check"><input v-model="form.enabled" type="checkbox" /> تشغيل المراقب الأمني</label>
          <label class="check"><input v-model="form.autoActions" type="checkbox" /> الإجراءات التلقائية على المصدر المهاجم (حظر مؤقت للعنوان، وإنهاء جلسات الحساب المشتبه به)</label>
          <label class="check"><input v-model="form.dailyReport" type="checkbox" /> إرسال التقرير اليومي بالبريد</label>
          <div class="s-row">
            <div class="field"><label>ساعة التقرير (بتوقيت الرياض)</label><input v-model.number="form.dailyHour" class="input" type="number" min="0" max="23" dir="ltr" /></div>
            <div class="field"><label>مدة الحظر التلقائي (دقيقة)</label><input v-model.number="form.blockMinutes" class="input" type="number" min="5" max="10080" dir="ltr" /></div>
          </div>
          <div class="field">
            <label>مستلمو التنبيهات والتقرير <small class="muted">(سطر لكل بريد. فارغ = بريد إشعارات الإدارة في إعدادات البريد)</small></label>
            <textarea v-model="form.recipientsText" class="input" rows="3" dir="ltr"></textarea>
          </div>
          <div class="field">
            <label>عناوين موثوقة لا تُحظر أبدًا <small class="muted">(مثل عنوان مكتب الجمعية أو نطاق مثل 203.0.113.0/24، سطر لكل عنوان)</small></label>
            <textarea v-model="form.trustedText" class="input" rows="3" dir="ltr"></textarea>
          </div>
          <h2>حدود الرصد</h2>
          <div class="s-row">
            <div class="field"><label>محاولات دخول فاشلة من عنوان (10 دقائق)</label><input v-model.number="form.thresholds.bruteForce" class="input" type="number" min="3" max="1000" dir="ltr" /></div>
            <div class="field"><label>طلبات مرفوضة من عنوان (5 دقائق)</label><input v-model.number="form.thresholds.scan" class="input" type="number" min="10" max="5000" dir="ltr" /></div>
            <div class="field"><label>سجلات غير مسموحة لحساب (10 دقائق)</label><input v-model.number="form.thresholds.probe" class="input" type="number" min="5" max="1000" dir="ltr" /></div>
            <div class="field"><label>عمليات تصدير لحساب (ساعة)</label><input v-model.number="form.thresholds.exports" class="input" type="number" min="3" max="1000" dir="ltr" /></div>
            <div class="field"><label>أخطاء الخادم (10 دقائق)</label><input v-model.number="form.thresholds.errors" class="input" type="number" min="3" max="5000" dir="ltr" /></div>
          </div>
          <button class="btn btn-primary" :disabled="busy">حفظ</button>
        </form>
      </section>
    </template>
  </div>
</template>

<style scoped>
.s-banner { padding: 12px 16px; border-radius: 12px; margin-bottom: 16px; font-weight: 600; }
.s-ok { background: var(--success-soft); color: var(--success); }
.s-warn { background: #fff4e0; color: #9a5b00; }
.s-bad { background: var(--danger-soft); color: var(--danger); }
.s-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
@media (max-width: 820px) { .s-stats { grid-template-columns: repeat(2, 1fr); } }
.s-stat { padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; }
.s-stat span { color: var(--muted); font-size: .85rem; }
.s-stat b { font-size: 1.5rem; }
.s-red { color: var(--danger); }
.s-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.s-tabs button { border: 1px solid var(--border); background: var(--surface, #fff); border-radius: 999px; padding: 7px 16px; cursor: pointer; font: inherit; }
.s-tabs button.on { background: var(--primary); border-color: var(--primary); color: #fff; }
.s-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; }
.s-narrow { max-width: 240px; }
.s-grow { flex: 1; min-width: 200px; }
.s-empty { padding: 24px; }
.s-inc { border: 1px solid var(--border); border-inline-start: 5px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; }
.s-bad-edge { border-inline-start-color: var(--danger); }
.s-warn-edge { border-inline-start-color: #c7a27a; }
.s-muted-edge { border-inline-start-color: var(--border); }
.s-inc header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.s-inc h3 { margin: 0; font-size: 1.05rem; flex: 1; }
.s-actions { margin: 10px 0; padding-inline-start: 18px; font-size: .9rem; }
.s-pending { background: #fff4e0; border-radius: 10px; padding: 10px 12px; margin: 10px 0; display: flex; flex-direction: column; gap: 6px; }
.s-btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.s-pager { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 12px; }
.s-form { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
.s-form > .btn { align-self: flex-start; min-width: 140px; }
.table td .btn { white-space: nowrap; }
.s-row { display: flex; flex-wrap: wrap; gap: 12px; }
.s-row .field { min-width: 180px; }
.s-ltr { text-align: right; unicode-bidi: plaintext; }
.s-route { font-size: .82rem; word-break: break-all; }
.s-recs { margin: 0; padding-inline-start: 16px; font-size: .86rem; }
</style>
