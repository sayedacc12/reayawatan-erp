<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, openProtectedFile } from '../../../api';
import RegistrationForm, { type MainData } from '../../../registration/RegistrationForm.vue';
import { useToast } from '../../../stores/toast';
import ScreensPicker, { type Access } from '../components/ScreensPicker.vue';
import SampleDataResult, { type SampleResult } from '../../../components/SampleDataResult.vue';
import { CONTRACT_STATUS, copyText, cycleLabel, fmtDate, money, ORG_STATE, type ScreenModule } from '../labels';
import { waNumber } from '../siteLabels';
import '../platform.css';

interface Org {
  id: string; name: string; slug: string; isActive: boolean; createdAt: string; userCount: number; modules: string[]; state: string;
  subscriptionStatus: string; subscriptionPrice: number | null; billingCycle: string | null; trialEndsOn: string | null;
  subscriptionStartsOn: string | null; subscriptionEndsOn: string | null; allowedScreens: string[] | null;
}
interface Profile { id: string; status: string; data: MainData; licenseFileMime: string }
interface ContractRow { id: string; number: string; status: string; terms: { price: number; billingCycle: string; months: number; startsOn: string }; signedAt: string | null; createdAt: string }

const route = useRoute();
const router = useRouter();
const toast = useToast();
const id = route.params.id as string;
const org = ref<Org | null>(null);
const profile = ref<Profile | null>(null);
const contracts = ref<ContractRow[]>([]);
const catalog = ref<ScreenModule[]>([]);
const error = ref('');
const tab = ref<'overview' | 'profile' | 'screens' | 'contracts'>((route.query.tab as never) ?? 'overview');
interface Admin { id: string; fullName: string; email: string; username: string | null; isActive: boolean; lastLoginAt: string | null }
const admins = ref<Admin[]>([]);
const access = ref<Access>({ allScreens: true, screens: [], modules: [] });

async function load() {
  try {
    const [d, screens] = await Promise.all([
      api<{ organization: Org; profile: Profile | null; contracts: ContractRow[] }>(`/platform/organizations/${id}/details`),
      api<ScreenModule[]>('/platform/screens'),
    ]);
    org.value = d.organization;
    profile.value = d.profile;
    contracts.value = d.contracts;
    catalog.value = screens;
    admins.value = await api<Admin[]>(`/platform/organizations/${id}/admins`).catch(() => []);
    sample.value = await api<SampleStatus>(`/platform/organizations/${id}/sample-data`).catch(() => null);
    access.value = { allScreens: !d.organization.allowedScreens, screens: d.organization.allowedScreens ?? [], modules: d.organization.modules };
    Object.assign(sub, {
      status: d.organization.subscriptionStatus, trialEndsOn: d.organization.trialEndsOn ?? '',
      startsOn: d.organization.subscriptionStartsOn ?? '', endsOn: d.organization.subscriptionEndsOn ?? '',
    });
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

const busy = ref(false);
async function run(fn: () => Promise<unknown>, ok: string) {
  busy.value = true;
  try {
    await fn();
    toast.success(ok);
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const saveScreens = () => {
  if (!access.value.allScreens && !access.value.screens.length) return toast.error('اختر شاشة واحدة على الأقل');
  return run(() => api(`/platform/organizations/${id}/access`, { method: 'PUT', json: access.value }), 'تم حفظ الشاشات المسموحة');
};

const sub = reactive({ status: 'active', trialEndsOn: '', startsOn: '', endsOn: '' });
const subOpen = ref(false);
const saveSub = () => run(async () => {
  await api(`/platform/organizations/${id}/subscription`, { method: 'PATCH', json: sub });
  subOpen.value = false;
}, 'تم تحديث حالة الاشتراك');

const toggleActive = () => {
  if (!org.value) return;
  if (org.value.isActive && !confirm(`إيقاف "${org.value.name}"؟ لن يستطيع أي مستخدم فيها الدخول حتى تُفعّل مرة أخرى.`)) return;
  return run(() => api(`/platform/organizations/${id}`, { method: 'PATCH', json: { isActive: !org.value!.isActive } }), org.value.isActive ? 'تم إيقاف الجمعية' : 'تم تفعيل الجمعية');
};

const newContract = async () => {
  busy.value = true;
  try {
    const c = await api<{ id: string }>(`/platform/organizations/${id}/contracts`, { method: 'POST' });
    router.push(`/platform/contracts/${c.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
};

// ---- البيانات الرئيسية ----
const editing = ref(false);
const editError = ref('');
async function saveProfile(fd: FormData) {
  busy.value = true;
  editError.value = '';
  try {
    if (profile.value) {
      await api(`/platform/applications/${profile.value.id}`, { method: 'PATCH', body: fd });
    } else {
      fd.append('organizationId', id);
      await api('/platform/applications', { method: 'POST', body: fd });
    }
    editing.value = false;
    toast.success('تم حفظ البيانات الرئيسية');
    await load();
  } catch (e) {
    editError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const viewLicense = () => profile.value && openProtectedFile(`/platform/applications/${profile.value.id}/license`).catch((e) => toast.error((e as Error).message));
const origin = location.origin;
const copy = (s: string) => { copyText(s); toast.success('تم النسخ'); };

// بيانات دخول مدير نظام الجمعية: كلمة مرور مؤقتة تظهر مرة واحدة وتُرسل للجمعية
const creds = ref<{ name: string; login: string; password: string } | null>(null);
async function resetPassword(a: Admin) {
  if (!confirm(`إنشاء كلمة مرور جديدة لحساب "${a.fullName}"؟ ستتوقف كلمة المرور الحالية فورًا.`)) return;
  busy.value = true;
  try {
    const r = await api<{ password: string; login: string }>(`/platform/organizations/${id}/admins/${a.id}/reset-password`, { method: 'POST' });
    creds.value = { name: a.fullName, login: r.login, password: r.password };
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const credsText = () => creds.value ? `السلام عليكم،
بيانات دخول مدير النظام لـ${org.value?.name} في منصة سنابل:
رابط الدخول: ${origin}/o/${org.value?.slug}
اسم الدخول: ${creds.value.login}
كلمة المرور: ${creds.value.password}
ننصح بتغيير كلمة المرور بعد أول دخول من قائمة الحساب.` : '';
const directorPhone = () => profile.value?.data.directorPhone || profile.value?.data.orgPhone || '';
const credsWa = () => `https://wa.me/${waNumber(directorPhone())}?text=${encodeURIComponent(credsText())}`;
// ---- البيانات التجريبية: إضافتها في فترة التجربة، ثم التحويل لجمعية فعلية بحذفها ----
interface SampleEvent { at: string; by: string; action: 'loaded' | 'failed' | 'cleared'; note?: string; counts?: Record<string, number> }
interface SampleStatus { status: 'none' | 'loading' | 'stalled' | 'loaded' | 'cleared'; canLoad: boolean; isTrial: boolean; loadedAt: string | null; clearedAt: string | null; log: SampleEvent[] }
interface SystemCount { system: string; count: number }
interface SamplePreview { sample: { total: number; systems: SystemCount[] }; own: { total: number; systems: SystemCount[] }; keptPeople: { users: number; roles: number } }
const sample = ref<SampleStatus | null>(null);
const sampleBusy = ref(false);
const sampleResult = ref<SampleResult | null>(null);
const preview = ref<SamplePreview | null>(null);
const confirmSlug = ref('');
const SAMPLE_STATE: Record<SampleStatus['status'], { label: string; tone: string }> = {
  none: { label: 'لا توجد', tone: 'muted' }, loading: { label: 'جارٍ الإضافة', tone: 'warn' }, stalled: { label: 'توقفت الإضافة قبل اكتمالها', tone: 'danger' },
  loaded: { label: 'موجودة', tone: 'warn' }, cleared: { label: 'حُذفت (جمعية فعلية)', tone: 'ok' },
};
const SAMPLE_ACTION = { loaded: 'أُضيفت البيانات التجريبية', failed: 'تعذرت الإضافة', cleared: 'التحويل إلى جمعية فعلية' };
const num = (n: number) => n.toLocaleString('ar-SA');
const keptText = (p: SamplePreview) => {
  const parts = ['الجمعية واشتراكها وعقودها والشاشات المسموحة', 'ومدير نظامها'];
  if (p.keptPeople.users) parts.push(`و${num(p.keptPeople.users)} حساب موظف أضافته الجمعية`);
  if (p.keptPeople.roles) parts.push(`و${num(p.keptPeople.roles)} دور أنشأته الجمعية`);
  return `${parts.join(' ')}. وتعود إعدادات الأنظمة كما كانت قبل إضافة البيانات التجريبية.`;
};
async function loadSample() {
  if (!confirm('إضافة بيانات تجريبية مترابطة في كل أنظمة هذه الجمعية؟ تستغرق دقيقة أو دقيقتين.')) return;
  sampleBusy.value = true;
  try {
    sampleResult.value = await api<SampleResult>(`/platform/organizations/${id}/sample-data`, { method: 'POST' });
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    sampleBusy.value = false;
  }
}
async function openConvert() {
  sampleBusy.value = true;
  try {
    confirmSlug.value = '';
    preview.value = await api<SamplePreview>(`/platform/organizations/${id}/sample-data/preview`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    sampleBusy.value = false;
  }
}
async function convert() {
  sampleBusy.value = true;
  try {
    const r = await api<{ deleted: number }>(`/platform/organizations/${id}/sample-data/clear`, { method: 'POST', json: { confirm: confirmSlug.value } });
    preview.value = null;
    toast.success(`تم التحويل إلى جمعية فعلية، وحُذف ${num(r.deleted)} سجلًا`);
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    sampleBusy.value = false;
  }
}
const STATUS_OPTIONS = [
  { value: 'trial', label: 'فترة تجريبية' }, { value: 'awaiting_contract', label: 'بانتظار توقيع العقد' }, { value: 'active', label: 'اشتراك ساري' },
];
</script>

<template>
  <div>
    <RouterLink to="/platform/organizations" class="back">→ الجمعيات</RouterLink>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="org">
      <section class="p-hero">
        <div>
          <p class="p-kicker">ملف الجمعية · <span dir="ltr">{{ org.slug }}</span></p>
          <h1>{{ org.name }}</h1>
          <p class="p-sub">{{ org.userCount }} مستخدم · مسجلة منذ {{ fmtDate(org.createdAt) }}</p>
        </div>
        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
          <span :class="['tone', `tone-${ORG_STATE[org.state]?.tone}`]">{{ ORG_STATE[org.state]?.label }}</span>
          <button :class="['btn', 'btn-ghost-light']" :disabled="busy" @click="toggleActive">{{ org.isActive ? 'إيقاف الجمعية' : 'تفعيل الجمعية' }}</button>
        </div>
      </section>

      <nav class="p-tabs">
        <button :class="['p-tab', { on: tab === 'overview' }]" @click="tab = 'overview'">الاشتراك والروابط</button>
        <button :class="['p-tab', { on: tab === 'profile' }]" @click="tab = 'profile'">البيانات الرئيسية <span v-if="!profile" class="tone tone-warn">ناقصة</span></button>
        <button :class="['p-tab', { on: tab === 'screens' }]" @click="tab = 'screens'">الشاشات المسموحة</button>
        <button :class="['p-tab', { on: tab === 'contracts' }]" @click="tab = 'contracts'">العقود ({{ contracts.length }})</button>
      </nav>

      <template v-if="tab === 'overview'">
        <div class="p-grid">
          <section class="card p-panel">
            <h2>الاشتراك</h2>
            <dl class="p-dl">
              <dt>الحالة</dt><dd><span :class="['tone', `tone-${ORG_STATE[org.state]?.tone}`]">{{ ORG_STATE[org.state]?.label }}</span></dd>
              <dt v-if="org.subscriptionStatus === 'trial'">نهاية التجربة</dt><dd v-if="org.subscriptionStatus === 'trial'">{{ fmtDate(org.trialEndsOn) }}</dd>
              <dt>القيمة</dt><dd>{{ money(org.subscriptionPrice) }} <small class="muted">{{ cycleLabel(org.billingCycle) }}</small></dd>
              <dt>الفترة</dt><dd>{{ fmtDate(org.subscriptionStartsOn) }} ← {{ fmtDate(org.subscriptionEndsOn) }}</dd>
            </dl>
            <button class="btn btn-sm" style="margin-top: 12px" @click="subOpen = !subOpen">تعديل يدوي (تمديد التجربة، تجديد...)</button>
            <form v-if="subOpen" class="sub-form" @submit.prevent="saveSub">
              <div class="field"><label>الحالة</label><select v-model="sub.status" class="input"><option v-for="o in STATUS_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option></select></div>
              <div v-if="sub.status === 'trial'" class="field"><label>آخر يوم في التجربة</label><input v-model="sub.trialEndsOn" class="input" type="date" required /></div>
              <div v-if="sub.status === 'active'" class="p-row-2">
                <div class="field"><label>بداية الاشتراك</label><input v-model="sub.startsOn" class="input" type="date" /></div>
                <div class="field"><label>نهاية الاشتراك</label><input v-model="sub.endsOn" class="input" type="date" /></div>
              </div>
              <button class="btn btn-primary btn-sm" :disabled="busy">حفظ</button>
            </form>
          </section>
          <section class="card p-panel">
            <h2>الروابط المولدة</h2>
            <div class="p-link-box"><span>دخول الموظفين</span><code>{{ origin }}/o/{{ org.slug }}</code><button class="btn btn-sm" @click="copy(`${origin}/o/${org.slug}`)">نسخ</button></div>
            <div class="p-link-box"><span>بوابة المستفيدين</span><code>{{ origin }}/portal/{{ org.slug }}</code><button class="btn btn-sm" @click="copy(`${origin}/portal/${org.slug}`)">نسخ</button></div>
            <p class="muted small">يتوقف الدخول على الرابطين تلقائيًا عند انتهاء التجربة أو الاشتراك أو إيقاف الجمعية.</p>
          </section>
          <section class="card p-panel">
            <h2>حساب مدير نظام الجمعية</h2>
            <p class="muted small">يدخل من رابط دخول الموظفين باسم الدخول أدناه، ثم يضيف موظفي الجمعية بنفسه. إن لم تكن لديه كلمة المرور فأنشئ له كلمة مؤقتة وأرسلها له.</p>
            <div v-for="a in admins" :key="a.id" class="admin-row">
              <div>
                <b>{{ a.fullName }}</b> <span v-if="!a.isActive" class="tone tone-danger">موقوف</span>
                <div class="muted small">اسم الدخول: <code dir="ltr">{{ a.username ?? a.email }}</code> · {{ a.lastLoginAt ? `آخر دخول ${fmtDate(a.lastLoginAt)}` : 'لم يدخل بعد' }}</div>
              </div>
              <button class="btn btn-sm" :disabled="busy" @click="resetPassword(a)">كلمة مرور مؤقتة جديدة</button>
            </div>
            <p v-if="!admins.length" class="muted small">لا يوجد حساب مدير نظام لهذه الجمعية.</p>
          </section>
          <section v-if="sample" class="card p-panel">
            <h2>البيانات التجريبية</h2>
            <dl class="p-dl">
              <dt>الحالة</dt><dd><span :class="['tone', `tone-${SAMPLE_STATE[sample.status].tone}`]">{{ SAMPLE_STATE[sample.status].label }}</span></dd>
            </dl>
            <p v-if="sample.status === 'none'" class="muted small">
              {{ sample.isTrial ? 'يستطيع مدير نظام الجمعية إضافتها بنفسه من شريط يظهر له عند الدخول، أو تضيفها له من هنا.' : 'تتاح للجمعيات في الفترة التجريبية فقط.' }}
            </p>
            <p v-else-if="sample.status === 'loaded' || sample.status === 'stalled'" class="muted small">
              عند اتفاق الجمعية على بدء العمل الفعلي، حوّلها لجمعية فعلية: تُحذف البيانات التجريبية من كل الأنظمة، وتبقى الجمعية واشتراكها وعقودها وحسابات موظفيها.
            </p>
            <div class="sample-actions">
              <button v-if="sample.canLoad" class="btn btn-primary btn-sm" :disabled="sampleBusy" @click="loadSample">{{ sampleBusy ? 'جارٍ الإضافة...' : 'إضافة بيانات تجريبية' }}</button>
              <button v-if="sample.status === 'loaded' || sample.status === 'stalled'" class="btn btn-sm btn-convert" :disabled="sampleBusy" @click="openConvert">تحويل إلى جمعية فعلية (حذف البيانات التجريبية)</button>
            </div>
            <ul v-if="sample.log.length" class="sample-log">
              <li v-for="(e, i) in sample.log" :key="i">
                <b>{{ SAMPLE_ACTION[e.action] }}</b> · {{ e.by }} · {{ fmtDate(e.at) }}
                <span v-if="e.action === 'loaded' && e.counts" class="muted"> · {{ num(e.counts.records ?? 0) }} سجلًا</span>
                <span v-if="e.action === 'cleared' && e.counts" class="muted"> · حُذف {{ num(e.counts.deleted ?? 0) }} سجلًا</span>
                <div v-if="e.note" class="muted">{{ e.note }}</div>
              </li>
            </ul>
          </section>
        </div>
      </template>

      <section v-else-if="tab === 'profile'" class="card p-panel">
        <template v-if="profile && !editing">
          <div class="p-grid">
            <dl class="p-dl">
              <dt>الاسم في الترخيص</dt><dd>{{ profile.data.orgName }}</dd>
              <dt>المدينة</dt><dd>{{ profile.data.city }}</dd>
              <dt>البريد</dt><dd dir="ltr" style="text-align: right">{{ profile.data.orgEmail }}</dd>
              <dt>الهاتف</dt><dd dir="ltr" style="text-align: right">{{ profile.data.orgPhone }}</dd>
              <dt>رقم الترخيص</dt><dd>{{ profile.data.licenseNumber }}</dd>
              <dt>بداية الترخيص</dt><dd>{{ fmtDate(profile.data.licenseStartDate) }}</dd>
              <dt>نهاية الترخيص</dt><dd>{{ fmtDate(profile.data.licenseEndDate) }}</dd>
            </dl>
            <dl class="p-dl">
              <dt>المدير التنفيذي</dt><dd>{{ profile.data.directorName }}</dd>
              <dt>جواله</dt><dd dir="ltr" style="text-align: right">{{ profile.data.directorPhone }}</dd>
              <dt>بريده</dt><dd dir="ltr" style="text-align: right">{{ profile.data.directorEmail }}</dd>
              <dt>عضو مجلس الإدارة</dt><dd>{{ profile.data.boardName }} <small class="muted">({{ profile.data.boardPosition }})</small></dd>
              <dt>جواله</dt><dd dir="ltr" style="text-align: right">{{ profile.data.boardPhone }}</dd>
              <dt>بريده</dt><dd dir="ltr" style="text-align: right">{{ profile.data.boardEmail }}</dd>
            </dl>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 14px">
            <button class="btn btn-primary" @click="editing = true">تعديل البيانات الرئيسية</button>
            <button class="btn" @click="viewLicense">📄 مستند الترخيص</button>
            <RouterLink class="btn" :to="`/platform/applications/${profile.id}`">طلب الاشتراك وسجله</RouterLink>
          </div>
        </template>
        <template v-else>
          <div v-if="!profile" class="alert" style="background: #fff4e0; color: #7a4800">هذه الجمعية أُنشئت قبل نظام الاشتراكات. استكمل بياناتها الرئيسية ومستند ترخيصها.</div>
          <RegistrationForm :mode="profile ? 'edit' : 'link'" :initial="profile?.data ?? { orgName: org.name }" :approved="true" :busy="busy" submit-label="حفظ البيانات الرئيسية" @submit="saveProfile" @cancel="editing = false">
            <template #error><div v-if="editError" class="alert alert-error">{{ editError }}</div></template>
          </RegistrationForm>
        </template>
      </section>

      <section v-else-if="tab === 'screens'" class="card p-panel">
        <h2>الشاشات المسموحة للجمعية</h2>
        <p class="muted small" style="margin-top: -6px">الشاشة غير المسموحة تختفي من قوائم الجمعية وتُسحب صلاحياتها من كل الأدوار فورًا، حتى من مدير نظام الجمعية.</p>
        <ScreensPicker v-model="access" :catalog="catalog" />
        <button class="btn btn-primary" style="margin-top: 14px" :disabled="busy" @click="saveScreens">حفظ الشاشات</button>
      </section>

      <section v-else class="card p-panel">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px">
          <h2 style="margin: 0">عقود الجمعية</h2>
          <button class="btn btn-primary btn-sm" :disabled="busy" @click="newContract">+ عقد جديد (تجديد)</button>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>رقم العقد</th><th>القيمة</th><th>المدة</th><th>الحالة</th><th>التوقيع</th></tr></thead>
            <tbody>
              <tr v-for="c in contracts" :key="c.id" class="click" @click="router.push(`/platform/contracts/${c.id}`)">
                <td dir="ltr" style="text-align: right"><code>{{ c.number }}</code></td>
                <td>{{ money(c.terms.price) }} <small class="muted">{{ cycleLabel(c.terms.billingCycle) }}</small></td>
                <td>{{ c.terms.months }} شهرًا من {{ fmtDate(c.terms.startsOn) }}</td>
                <td><span :class="['tone', `tone-${CONTRACT_STATUS[c.status].tone}`]">{{ CONTRACT_STATUS[c.status].label }}</span></td>
                <td>{{ fmtDate(c.signedAt) }}</td>
              </tr>
              <tr v-if="!contracts.length"><td colspan="5" class="muted" style="text-align: center">لا توجد عقود بعد</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
    <div v-if="sampleResult" class="modal-backdrop">
      <div class="modal card sample-modal">
        <h3>أُضيفت البيانات التجريبية</h3>
        <SampleDataResult :result="sampleResult" :slug="org?.slug ?? ''" />
        <div class="modal-actions"><button class="btn" @click="sampleResult = null">إغلاق</button></div>
      </div>
    </div>
    <div v-if="preview" class="modal-backdrop" @click.self="preview = null">
      <div class="modal card sample-modal">
        <h3>تحويل «{{ org?.name }}» إلى جمعية فعلية</h3>
        <p>سيُحذف من كل الأنظمة <b>{{ num(preview.sample.total) }}</b> سجلًا تجريبيًا، وتصبح الجمعية بلا بيانات لتبدأ عملها الفعلي.</p>
        <ul class="sys-list">
          <li v-for="s in preview.sample.systems" :key="s.system">{{ s.system }} <small>{{ num(s.count) }}</small></li>
        </ul>
        <div v-if="preview.own.total" class="alert alert-error">
          <b>انتبه:</b> أضافت الجمعية بنفسها {{ num(preview.own.total) }} سجلًا بعد البيانات التجريبية، وستُحذف هي أيضًا:
          <span v-for="(s, i) in preview.own.systems" :key="s.system">{{ i ? '، ' : '' }}{{ s.system }} ({{ num(s.count) }})</span>.
          إن كانت الجمعية تحتاجها فاطلب منها تصديرها أولًا.
        </div>
        <div class="keep">
          <b>يبقى كما هو:</b> {{ keptText(preview) }}
        </div>
        <p class="danger-note">لا يمكن التراجع عن هذه العملية. للتأكيد اكتب معرّف الجمعية: <code dir="ltr">{{ org?.slug }}</code></p>
        <input v-model="confirmSlug" class="input" dir="ltr" :placeholder="org?.slug" autocomplete="off" />
        <div class="modal-actions">
          <button class="btn btn-delete" :disabled="sampleBusy || confirmSlug.trim().toLowerCase() !== org?.slug" @click="convert">{{ sampleBusy ? 'جارٍ الحذف...' : 'حذف البيانات التجريبية والتحويل' }}</button>
          <button class="btn" :disabled="sampleBusy" @click="preview = null">إلغاء</button>
        </div>
      </div>
    </div>
    <div v-if="creds" class="modal-backdrop" @click.self="creds = null">
      <div class="modal card">
        <h3>بيانات الدخول الجديدة</h3>
        <p class="muted small">انسخها الآن، فكلمة المرور لن تظهر مرة أخرى.</p>
        <div class="p-link-box"><span>رابط الدخول</span><code>{{ origin }}/o/{{ org?.slug }}</code></div>
        <div class="p-link-box"><span>اسم الدخول</span><code>{{ creds.login }}</code></div>
        <div class="p-link-box"><span>كلمة المرور</span><code>{{ creds.password }}</code></div>
        <div class="modal-actions">
          <a v-if="directorPhone()" class="btn btn-primary" :href="credsWa()" target="_blank" rel="noopener">إرسال عبر واتساب للمدير التنفيذي</a>
          <button class="btn" @click="copy(credsText())">نسخ الرسالة كاملة</button>
          <button class="btn" @click="creds = null">إغلاق</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.back { display: inline-block; margin-bottom: 10px; font-size: .9rem; }
.small { font-size: .86rem; }
.admin-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 10px 0; border-top: 1px dashed var(--border); }
.sub-form { margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 12px; }
.p-link-box span { min-width: 110px; font-weight: 500; }
.click { cursor: pointer; }
.p-tab .tone { margin-inline-start: 4px; }
.sample-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.btn-convert { color: var(--danger); border-color: #f3c4bf; }
.btn-convert:hover { background: var(--danger-soft); }
.sample-log { list-style: none; padding: 0; margin: 12px 0 0; border-top: 1px dashed var(--border); font-size: .86rem; }
.sample-log li { padding: 6px 0; }
.sample-modal { max-width: 640px; width: 100%; }
.sys-list { list-style: none; padding: 0; margin: 8px 0 12px; display: flex; flex-wrap: wrap; gap: 6px; }
.sys-list li { background: var(--surface-2); border: 1px solid var(--border); border-radius: 99px; padding: 3px 10px; font-size: .86rem; }
.sys-list small { color: var(--muted); margin-inline-start: 4px; }
.keep { background: var(--success-soft); color: var(--success); border-radius: 8px; padding: 10px 14px; font-size: .9rem; line-height: 1.8; margin-bottom: 12px; }
.danger-note { color: var(--danger); font-weight: 600; font-size: .92rem; }
.btn-delete { background: var(--danger); color: #fff; border-color: transparent; }
.btn-delete:hover:not(:disabled) { background: #912018; }
</style>
