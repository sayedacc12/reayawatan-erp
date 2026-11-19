<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { fmtDateTime } from '../labels';
import '../platform.css';

interface Settings { enabled: boolean; senderName: string; replyTo: string | null; adminEmails: string[]; dailyLimit: number; events: Record<string, boolean> }
interface Status {
  configured: boolean; mode: string; host: string | null; port: number; from: string | null; provider: string | null;
  sentLast24h: number; counts: Record<string, number>; settings: Settings; events: Record<string, string>;
}
interface Row { id: string; to: string; subject: string; kind: string; status: string; attempts: number; lastError: string | null; sentAt: string | null; createdAt: string; sensitive: boolean; nextAttemptAt: string }

const STATUS: Record<string, { label: string; tone: string }> = {
  queued: { label: 'في الانتظار', tone: 'info' },
  sending: { label: 'قيد الإرسال', tone: 'info' },
  sent: { label: 'أُرسلت', tone: 'ok' },
  failed: { label: 'فشلت', tone: 'bad' },
  skipped: { label: 'لم تُرسل', tone: 'muted' },
};
const KIND: Record<string, string> = {
  test: 'رسالة تجريبية', contract_link: 'رابط العقد', admin_welcome: 'ترحيب بمدير الجمعية', temp_password: 'كلمة مرور مؤقتة',
  lifecycle_trial_ending: 'قرب نهاية التجربة', lifecycle_trial_expired: 'انتهاء التجربة', lifecycle_mutual: 'إنهاء بالتراضي', lifecycle_final: 'تنبيه أخير قبل الحذف',
  inquiry_admin: 'طلب خدمة جديد (للإدارة)', inquiry_ack: 'تأكيد استلام طلب', password_reset: 'استعادة كلمة المرور',
};

const toast = useToast();
const st = ref<Status | null>(null);
const form = reactive({ enabled: true, senderName: 'سنابل', replyTo: '', adminEmails: '', dailyLimit: 450, events: {} as Record<string, boolean> });
const testTo = ref('');
const busy = ref(false);
const testing = ref(false);
const testResult = ref<{ ok: boolean; text: string } | null>(null);
const error = ref('');
const rows = ref<Row[]>([]);
const page = ref(1);
const pages = ref(1);
const filter = ref('');
const preview = ref<{ subject: string; to: string; html: string | null } | null>(null);

function fill(s: Status) {
  st.value = s;
  Object.assign(form, {
    enabled: s.settings.enabled, senderName: s.settings.senderName, replyTo: s.settings.replyTo ?? '',
    adminEmails: s.settings.adminEmails.join('\n'), dailyLimit: s.settings.dailyLimit, events: { ...s.settings.events },
  });
  if (!testTo.value) testTo.value = s.from ?? '';
}
async function loadLog() {
  const q = new URLSearchParams({ page: String(page.value) });
  if (filter.value) q.set('status', filter.value);
  const r = await api<{ rows: Row[]; pages: number }>(`/platform/mail/log?${q}`);
  rows.value = r.rows;
  pages.value = r.pages;
}
onMounted(async () => {
  try {
    fill(await api<Status>('/platform/mail'));
    await loadLog();
  } catch (e) {
    error.value = (e as Error).message;
  }
});

async function save() {
  busy.value = true;
  try {
    fill(await api<Status>('/platform/mail/settings', {
      method: 'PUT',
      json: {
        enabled: form.enabled, senderName: form.senderName, replyTo: form.replyTo || null, dailyLimit: Number(form.dailyLimit), events: form.events,
        adminEmails: form.adminEmails.split(/[\s,،;]+/).map((x) => x.trim()).filter(Boolean),
      },
    }));
    toast.success('تم حفظ إعدادات البريد');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}

async function sendTest() {
  testing.value = true;
  testResult.value = null;
  try {
    const r = await api<{ message: string }>('/platform/mail/test', { method: 'POST', json: { to: testTo.value } });
    testResult.value = { ok: true, text: r.message };
  } catch (e) {
    testResult.value = { ok: false, text: (e as Error).message };
  } finally {
    testing.value = false;
    st.value = await api<Status>('/platform/mail');
    await loadLog();
  }
}

async function retry(r: Row) {
  try {
    await api(`/platform/mail/log/${r.id}/retry`, { method: 'POST' });
    toast.success('أُعيدت الرسالة إلى الانتظار');
    await loadLog();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function show(r: Row) {
  if (r.sensitive) return toast.error('هذه الرسالة فيها بيانات دخول، فلا يُعرض نصها');
  try {
    preview.value = await api(`/platform/mail/log/${r.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const setFilter = async (s: string) => { filter.value = s; page.value = 1; await loadLog(); };
const go = async (p: number) => { page.value = p; await loadLog(); };
const usage = computed(() => (st.value ? Math.min(100, Math.round((st.value.sentLast24h / Math.max(1, st.value.settings.dailyLimit)) * 100)) : 0));
</script>

<template>
  <div>
    <section class="p-hero">
      <div>
        <p class="p-kicker">إدارة المنصة</p>
        <h1>البريد الإلكتروني</h1>
        <p class="p-sub">رسائل سنابل الآلية: روابط العقود، وبيانات دخول مديري الجمعيات، وتذكيرات انتهاء التجربة، وإشعارات طلبات الخدمات.</p>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <template v-if="st">
      <div v-if="!st.configured" class="card p-panel setup">
        <h2>البريد غير مفعّل بعد على السيرفر</h2>
        <p>لأسباب الأمان، كلمة مرور البريد لا تُكتب هنا، بل تُحفظ على السيرفر فقط. الخطوات:</p>
        <ol>
          <li>من حساب Google للبريد المرسل: فعّل «التحقق بخطوتين»، ثم أنشئ «كلمة مرور للتطبيقات» باسم سنابل.</li>
          <li>على السيرفر نفّذ الأمر: <code dir="ltr">bash deploy/mail-setup.sh</code> والصق كلمة مرور التطبيق عندما يطلبها.</li>
          <li>ارجع لهذه الصفحة واضغط «إرسال رسالة تجريبية».</li>
        </ol>
        <p class="muted small">حتى ذلك الحين تُسجَّل الرسائل في السجل بحالة «لم تُرسل» ولا يتأثر أي شيء آخر.</p>
      </div>

      <div class="p-grid">
        <section class="card p-panel">
          <h2>حالة الإرسال</h2>
          <dl class="p-dl">
            <dt>الحالة</dt>
            <dd>
              <span v-if="st.configured && st.settings.enabled" class="tone tone-ok">يعمل</span>
              <span v-else-if="st.configured" class="tone tone-warn">موقوف من الإعدادات</span>
              <span v-else class="tone tone-bad">غير مضبوط</span>
            </dd>
            <dt>المزود</dt><dd>{{ st.provider ?? '—' }}</dd>
            <dt>البريد المرسل</dt><dd dir="ltr" style="text-align: right">{{ st.from ?? '—' }}</dd>
            <dt>آخر 24 ساعة</dt>
            <dd>
              {{ st.sentLast24h }} من {{ st.settings.dailyLimit }} رسالة
              <div class="bar"><i :style="{ width: `${usage}%` }" :class="{ hot: usage > 80 }" /></div>
            </dd>
          </dl>
          <p class="muted small">حساب Gmail العادي يسمح بنحو 500 رسالة يوميًا. عند بلوغ الحد تنتظر الرسائل وتُرسل تلقائيًا في اليوم التالي.</p>

          <h2 style="margin-top: 18px">إرسال رسالة تجريبية</h2>
          <form class="test-row" @submit.prevent="sendTest">
            <input v-model="testTo" class="input" dir="ltr" type="email" required placeholder="name@example.com" />
            <button class="btn btn-primary" :disabled="testing || !st.configured">{{ testing ? 'جارٍ الإرسال...' : 'إرسال رسالة تجريبية' }}</button>
          </form>
          <div v-if="testResult" :class="['alert', testResult.ok ? 'alert-success' : 'alert-error']" style="margin-top: 10px">{{ testResult.text }}</div>
        </section>

        <section class="card p-panel">
          <h2>الإعدادات</h2>
          <form @submit.prevent="save">
            <label class="check"><input v-model="form.enabled" type="checkbox" /> تفعيل إرسال البريد من المنصة</label>
            <div class="field"><label>اسم المرسل</label><input v-model="form.senderName" class="input" maxlength="60" /></div>
            <div class="field">
              <label>بريد الرد <small class="muted">(اختياري)</small></label>
              <input v-model="form.replyTo" class="input" dir="ltr" type="email" placeholder="info@sanabelerp.com" />
              <small class="muted">إذا ضغط المستلم «رد» تذهب رسالته لهذا البريد بدل بريد الإرسال.</small>
            </div>
            <div class="field">
              <label>بريد إشعارات الإدارة</label>
              <textarea v-model="form.adminEmails" class="input" dir="ltr" rows="2" :placeholder="st.from ?? ''" />
              <small class="muted">تصله إشعارات طلبات الخدمات الجديدة. اتركه فارغًا لاستخدام بريد الإرسال نفسه. عنوان في كل سطر.</small>
            </div>
            <div class="field"><label>الحد اليومي للرسائل</label><input v-model.number="form.dailyLimit" class="input" type="number" min="1" max="100000" dir="ltr" /></div>
            <fieldset class="events">
              <legend>الرسائل المفعّلة</legend>
              <label v-for="(label, k) in st.events" :key="k" class="check"><input v-model="form.events[k]" type="checkbox" /> {{ label }}</label>
            </fieldset>
            <button class="btn btn-primary" :disabled="busy">حفظ</button>
          </form>
        </section>
      </div>

      <h2 class="log-title">سجل الرسائل</h2>
      <div class="p-filters">
        <button :class="['p-chip', { on: !filter }]" @click="setFilter('')">الكل</button>
        <button v-for="(s, k) in STATUS" :key="k" :class="['p-chip', { on: filter === k }]" @click="setFilter(k)">{{ s.label }}<b>{{ st.counts[k] ?? 0 }}</b></button>
      </div>
      <div class="card table-wrap">
        <table class="table">
          <thead><tr><th>التاريخ</th><th>إلى</th><th>النوع</th><th>الموضوع</th><th>الحالة</th><th></th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id">
              <td>{{ fmtDateTime(r.createdAt) }}</td>
              <td dir="ltr" style="text-align: right">{{ r.to }}</td>
              <td>{{ KIND[r.kind] ?? r.kind }}</td>
              <td><a href="#" @click.prevent="show(r)">{{ r.subject }}</a><small v-if="r.sensitive" class="muted d-block">فيها بيانات دخول، ولا يُحفظ نصها بعد الإرسال</small></td>
              <td>
                <span :class="['tone', `tone-${STATUS[r.status]?.tone ?? 'muted'}`]">{{ STATUS[r.status]?.label ?? r.status }}</span>
                <small v-if="r.lastError" class="muted d-block err">{{ r.lastError }}</small>
                <small v-if="r.status === 'queued' && r.attempts" class="muted d-block">محاولة {{ r.attempts }}، التالية {{ fmtDateTime(r.nextAttemptAt) }}</small>
              </td>
              <td><button v-if="r.status === 'failed' && !r.sensitive" class="btn btn-sm" @click="retry(r)">إعادة المحاولة</button></td>
            </tr>
            <tr v-if="!rows.length"><td colspan="6" class="muted" style="text-align: center; padding: 24px">لا توجد رسائل بعد.</td></tr>
          </tbody>
        </table>
      </div>
      <div v-if="pages > 1" class="pager">
        <button class="btn btn-sm" :disabled="page <= 1" @click="go(page - 1)">السابق</button>
        <span>{{ page }} / {{ pages }}</span>
        <button class="btn btn-sm" :disabled="page >= pages" @click="go(page + 1)">التالي</button>
      </div>
    </template>

    <div v-if="preview" class="modal-backdrop" @click.self="preview = null">
      <div class="card modal modal-wide">
        <h3 style="margin-top: 0">{{ preview.subject }}</h3>
        <p class="muted small" dir="ltr" style="text-align: right">{{ preview.to }}</p>
        <iframe v-if="preview.html" class="mail-frame" sandbox="" :srcdoc="preview.html" title="معاينة الرسالة" />
        <p v-else class="muted">نص الرسالة غير محفوظ.</p>
        <div class="modal-actions"><button class="btn" @click="preview = null">إغلاق</button></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.setup { margin-bottom: 16px; border-inline-start: 4px solid var(--warning, #c98a00); }
.setup ol { padding-inline-start: 20px; line-height: 2; }
.test-row { display: flex; gap: 8px; flex-wrap: wrap; }
.test-row .input { flex: 1 1 220px; }
.check { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-weight: 500; }
.events { border: 1px solid var(--border, #e5e7eb); border-radius: 10px; padding: 10px 14px; margin: 0 0 14px; }
.events legend { padding: 0 6px; font-size: .9rem; color: var(--muted); }
.bar { height: 6px; background: var(--border, #e5e7eb); border-radius: 4px; margin-top: 6px; overflow: hidden; max-width: 220px; }
.bar i { display: block; height: 100%; background: var(--primary); }
.bar i.hot { background: #d97706; }
.log-title { margin: 24px 0 10px; }
.err { color: var(--danger, #b42318); max-width: 320px; }
.d-block { display: block; }
.pager { display: flex; gap: 10px; align-items: center; justify-content: center; margin-top: 12px; }
.mail-frame { width: 100%; height: 60vh; border: 1px solid var(--border, #e5e7eb); border-radius: 10px; background: #fff; }
.small { font-size: .85rem; }
</style>
