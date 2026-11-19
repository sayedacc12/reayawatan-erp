<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { useSession } from '../../../stores/session';
import { useRouter } from 'vue-router';
import { CONTRACT_STATUS, cycleLabel, fmtDate, money, ORG_STATE } from '../labels';
import '../platform.css';
import TempPasswordDialog from '../../../components/TempPasswordDialog.vue';

const toast = useToast();
const session = useSession();

interface Org {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  userCount: number;
  modules: string[];
  state: string;
  subscriptionPrice: number | null;
  billingCycle: string | null;
  trialEndsOn: string | null;
  subscriptionEndsOn: string | null;
  allowedScreens: string[] | null;
  hasProfile: boolean;
  contractStatus: string | null;
}
interface OptionalModule { code: string; name: string; description?: string }

const orgs = ref<Org[]>([]);
const optional = ref<OptionalModule[]>([]);
const error = ref('');

// طلبات «نسيت كلمة المرور» من مديري أنظمة الجمعيات وفريق المنصة
interface PwdRequest { id: string; name: string; organizationName: string | null; organizationSlug: string | null; superadmin: boolean; createdAt: string; status: string }
const pwdRequests = ref<PwdRequest[]>([]);
const temp = ref<{ name: string; login: string; password: string; expiresAt: string; place?: string; url: string } | null>(null);
async function issueTemp(r: PwdRequest) {
  if (!confirm(`إصدار كلمة مرور مؤقتة لـ "${r.name}"؟ تأكد أولًا أن الطلب منه شخصيًا. تتوقف كلمة مروره الحالية فورًا.`)) return;
  try {
    const res = await api<{ fullName: string; login: string; password: string; expiresAt: string }>(`/platform/password-resets/${r.id}/issue`, { method: 'POST' });
    temp.value = { ...res, name: res.fullName, place: r.organizationName ?? 'إدارة منصة سنابل', url: `${origin}${r.organizationSlug ? `/o/${r.organizationSlug}` : '/login'}` };
    pwdRequests.value = pwdRequests.value.filter((x) => x.id !== r.id);
  } catch (e) {
    toast.error((e as Error).message);
  }
}

async function load() {
  try {
    let resets: { pending: PwdRequest[] };
    [orgs.value, optional.value, resets] = await Promise.all([
      api<Org[]>('/platform/organizations'),
      api<OptionalModule[]>('/platform/modules'),
      api<{ pending: PwdRequest[] }>('/platform/password-resets'),
    ]);
    pwdRequests.value = resets.pending;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

const router = useRouter();

async function toggleActive(o: Org) {
  const verb = o.isActive ? 'إيقاف' : 'تفعيل';
  if (o.isActive && !confirm(`إيقاف "${o.name}"؟ لن يستطيع أي مستخدم فيها الدخول حتى تُفعّل مرة أخرى.`)) return;
  try {
    await api(`/platform/organizations/${o.id}`, { method: 'PATCH', json: { isActive: !o.isActive } });
    toast.success(o.isActive ? `تم إيقاف "${o.name}"` : `تم تفعيل "${o.name}"`);
    await load();
  } catch (e) {
    error.value = `تعذر ${verb} الجمعية: ${(e as Error).message}`;
  }
}

// ---- جمعية تجريبية للشرح ----
interface DemoResult {
  organization: { name: string; slug: string };
  staffPassword: string;
  staff: { role: string; email: string }[];
  portalPassword: string;
  portalUsers: { fullName: string; nationalId: string }[];
  supportTeam?: { role: string; email: string }[];
}
const demo = ref<DemoResult | null>(null);
const demoBusy = ref(false);
async function createDemo(recreate = false) {
  if (recreate && !confirm('ستُحذف الجمعية التجريبية الحالية بكل بياناتها وتُنشأ من جديد بأحدث البيانات التجريبية. هل تريد المتابعة؟')) return;
  demoBusy.value = true;
  try {
    if (recreate) await api('/platform/demo-organization', { method: 'DELETE' });
    demo.value = await api<DemoResult>('/platform/demo-organization', { method: 'POST' });
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    demoBusy.value = false;
  }
}
const origin = location.origin;
/** حساب مدير المنصة الحالي (كلمة مروره لا تتغير بإعادة إنشاء الجمعية التجريبية) */
const platformLogin = () => session.user?.username || session.user?.email || '';

/** تصدير بيانات الدخول وملخص الجمعية التجريبية إلى ملف Word (يفتحه Word مباشرة) */
function exportDemoWord() {
  const d = demo.value;
  if (!d) return;
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = (items: [string, string][]) => items.map(([a, b]) => `<tr><td>${esc(a)}</td><td dir="ltr">${esc(b)}</td></tr>`).join('');
  const scope = [...document.querySelectorAll('.demo-scope li')].map((li) => `<li>${esc(li.textContent ?? '')}</li>`).join('');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">
<style>body{font-family:Arial;direction:rtl}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px;text-align:right}th{background:#e6f2ef}</style></head>
<body dir="rtl"><h1>بيانات الدخول: ${esc(d.organization.name)}</h1><ul>${scope}</ul>
<h2>إدارة المنصة: ${esc(origin)}/login</h2>
<table><tr><th>الدور</th><th>اسم الدخول</th></tr>${rows([['مدير المنصة', platformLogin()], ['كلمة المرور', 'كلمة مرور مدير المنصة الحالية (لا تتغير)']])}</table>
<h2>دخول الموظفين: ${esc(origin)}/o/${esc(d.organization.slug)}</h2>
<table><tr><th>الدور</th><th>البريد الإلكتروني</th></tr>${rows([...d.staff.map((s) => [s.role, s.email] as [string, string]), ['كلمة المرور للكل', d.staffPassword]])}</table>
<h2>بوابة المستفيدين: ${esc(origin)}/portal/${esc(d.organization.slug)}</h2>
<table><tr><th>المستفيد</th><th>رقم الهوية</th></tr>${rows([...d.portalUsers.map((p) => [p.fullName, p.nationalId] as [string, string]), ['كلمة المرور للكل', d.portalPassword]])}</table>
${d.supportTeam?.length ? `<h2>فريق الدعم الفني: ${esc(origin)}/login</h2>
<table><tr><th>الدور</th><th>البريد الإلكتروني</th></tr>${rows([...d.supportTeam.map((s) => [s.role, s.email] as [string, string]), ['كلمة المرور', d.staffPassword]])}</table>` : ''}
</body></html>`;
  const url = URL.createObjectURL(new Blob(['\ufeff', html], { type: 'application/msword' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `بيانات-الجمعية-التجريبية.doc`;
  a.click();
  URL.revokeObjectURL(url);
}

const moduleName = (code: string) => optional.value.find((m) => m.code === code)?.name ?? code;
const until = (o: Org) => (o.state === 'trial' ? o.trialEndsOn : o.subscriptionEndsOn);
</script>

<template>
  <div>
    <section class="p-hero">
      <div>
        <p class="p-kicker">إدارة المنصة</p>
        <h1>الجمعيات</h1>
        <p class="p-sub">كل جمعية حساب مستقل ببياناتها ومستخدميها. افتح ملف الجمعية لإدارة بياناتها الرئيسية والشاشات المسموحة والاشتراك والعقود.</p>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap">
        <button v-if="!orgs.some((o) => o.slug === 'demo')" class="btn btn-ghost-light" :disabled="demoBusy" @click="createDemo()">{{ demoBusy ? 'جارٍ التجهيز...' : '✨ جمعية تجريبية للشرح' }}</button>
        <button v-else class="btn btn-ghost-light" :disabled="demoBusy" @click="createDemo(true)">{{ demoBusy ? 'جارٍ التجهيز...' : '↻ إعادة إنشاء الجمعية التجريبية' }}</button>
        <RouterLink to="/platform/applications?new=1" class="btn btn-gold">+ تسجيل جمعية جديدة</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <section v-if="pwdRequests.length" class="card pwd-box">
      <h2>طلبات نسيت كلمة المرور ({{ pwdRequests.length }})</h2>
      <p class="muted">من مديري أنظمة الجمعيات وفريق المنصة. تأكد من هوية صاحب الطلب (اتصال بالجمعية) قبل إصدار كلمة مؤقتة.</p>
      <div v-for="r in pwdRequests" :key="r.id" class="pwd-row">
        <div><b>{{ r.name }}</b> · {{ r.organizationName ?? 'فريق المنصة' }}<div class="muted" style="font-size: .82rem">طلبها {{ fmtDate(r.createdAt) }}</div></div>
        <button class="btn btn-primary btn-sm" @click="issueTemp(r)">إصدار كلمة مرور مؤقتة</button>
      </div>
    </section>
    <TempPasswordDialog v-if="temp" :name="temp.name" :login="temp.login" :password="temp.password" :expires-at="temp.expiresAt" :login-url="temp.url" :place="temp.place" @close="temp = null" />

    <div class="card table-wrap">
      <table class="table">
        <thead>
          <tr><th>الجمعية</th><th>حالة الاشتراك</th><th>القيمة</th><th>العقد</th><th>الشاشات</th><th>المستخدمون</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="o in orgs" :key="o.id" class="click" @click="router.push(`/platform/organizations/${o.id}`)">
            <td>
              <b>{{ o.name }}</b>
              <div class="links" @click.stop>
                <code dir="ltr">{{ o.slug }}</code>
                <a :href="`/o/${o.slug}`" target="_blank" class="portal-link">دخول الموظفين ↗</a>
                <a :href="`/portal/${o.slug}`" target="_blank" class="portal-link">بوابة المستفيدين ↗</a>
              </div>
              <span v-if="!o.hasProfile" class="tone tone-warn" style="margin-top: 4px">البيانات الرئيسية غير مكتملة</span>
            </td>
            <td>
              <span :class="['tone', `tone-${ORG_STATE[o.state]?.tone ?? 'muted'}`]">{{ ORG_STATE[o.state]?.label ?? o.state }}</span>
              <div v-if="until(o)" class="muted small">حتى {{ fmtDate(until(o)) }}</div>
            </td>
            <td>{{ o.subscriptionPrice !== null ? money(o.subscriptionPrice) : '—' }}<div v-if="o.billingCycle" class="muted small">{{ cycleLabel(o.billingCycle) }}</div></td>
            <td><span v-if="o.contractStatus" :class="['tone', `tone-${CONTRACT_STATUS[o.contractStatus].tone}`]">{{ CONTRACT_STATUS[o.contractStatus].label }}</span><span v-else class="muted">لا يوجد</span></td>
            <td>
              {{ o.allowedScreens ? `${o.allowedScreens.length} شاشة` : 'كل الشاشات' }}
              <div v-if="o.modules.length" class="muted small">+ {{ o.modules.map(moduleName).join('، ') }}</div>
            </td>
            <td>{{ o.userCount }}</td>
            <td @click.stop style="display: flex; gap: 6px">
              <RouterLink :to="`/platform/organizations/${o.id}`" class="btn btn-sm">إدارة</RouterLink>
              <button :class="['btn', 'btn-sm', o.isActive && 'btn-danger']" @click="toggleActive(o)">{{ o.isActive ? 'إيقاف' : 'تفعيل' }}</button>
            </td>
          </tr>
          <tr v-if="!orgs.length"><td colspan="7" class="muted" style="text-align: center">لا توجد جمعيات بعد. شارك رابط التسجيل أو سجّل أول جمعية.</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="demo" class="modal-backdrop" @click.self="demo = null">
      <div class="card modal modal-wide demo">
        <h2>✨ تم تجهيز {{ demo.organization.name }}</h2>
        <p class="muted">احفظ هذه البيانات، فلن تظهر كلمات المرور مرة أخرى.</p>
        <ul class="demo-scope">
          <li><b>المساعدات الاجتماعية:</b> 6 ملفات مستفيدين و8 طلبات في مراحل مختلفة (جديد، بحث اجتماعي، مساهمة مستفيد، معاد، مرفوض، معتمد)، منها طلب معتمد ينتظر التحميل على دفعة داعم لتجربته بنفسك.</li>
          <li><b>إدارة المشاريع:</b> 7 مشاريع معتمدة عبر مراحل الاعتماد، ومشروع قيد الاعتماد، ومعاد للتعديل، ومسودة.</li>
          <li><b>الموارد المالية:</b> 6 داعمين و7 فرص تبرع (نقدي وزكاة وعيني ووعد بالدفع ووقف) بدفعاتها وقيودها.</li>
          <li><b>الدعم والصرف:</b> تحميل طلبين على دفعات الداعمين، وصرف عام، وسندات صرف وفواتير، ومناقلة، وتعديل فرصة بقيد عكسي، وطلب صرف بانتظار المالية.</li>
          <li><b>النظام المالي:</b> الدليل الموحد للجمعيات، وثلاثة بنوك وصناديق، وعملاء وموردون، وسندات قبض وصرف بمراحل اعتماد (معتمدة ومعلقة وملغاة باعتماد ثنائي)، وقيد افتتاحي وقيود يومية وتسوية، وشهور مغلقة بالتسلسل.</li>
          <li><b>الأصول الثابتة:</b> 6 مجموعات بحساباتها (منها الأراضي بلا إهلاك)، وأصول بأرصدة افتتاحية وعهد موظفين، وإهلاك شهري مرحّل بسندات الإهلاك، وشراء نقدي وآجل، وتبرع عيني، وإضافة على مبنى، وبيع سيارة بربح أو خسارة، وتخريد، وشراء ينتظر اعتماد سند الصرف، وجرد بملصقات QR، وقيد يدوي يُظهر علامة عدم المطابقة، وإعادة تقييم أرض، وهبوط قيمة، وتأمين وضمان بتنبيهات انتهاء، وخطط صيانة دورية وسجل أعطال متكررة، وأصل ممول من منحة يخفض صافي الأصول المقيد، ومبنى تحت التنفيذ بدفعتين، وموازنة رأسمالية معتمدة مربوطة بالمشتريات.</li>
          <li><b>الموارد البشرية:</b> لائحة معتمدة، وهيكل تنظيمي بمستويات، وسلم رواتب، وجدارات وأوصاف وظيفية، وخطة تعيين، وموظفون بعقودهم، وإجازات، وبطاقات أداء، وخطط تطوير وصف ثانٍ.</li>
          <li><b>الحضور والرواتب:</b> جهاز بصمة وملف حضور (فيه غياب وتأخير)، وكشف رواتب الشهر السابق معتمد بقيده وسندات صرفه، وكشف الشهر الحالي قيد الإعداد.</li>
          <li><b>التطوع:</b> متطوعون وطلبات تسجيل جديدة، و6 فعاليات في كل المراحل، وشهادات وعقود وشكاوى ومقترحات.</li>
          <li><b>الجودة ISO 9001:</b> وثائق وإجراءات بنماذجها، وخرائط إجراءات، وأهداف بمؤشرات، ومراجعات داخلية، وحالات عدم مطابقة، وشكاوى واستبانات رضا، ومراجعتا إدارة.</li>
          <li><b>المخاطر والتغيير والالتزام:</b> سجل مخاطر بمراجعات دورية، وتحليل PESTEL وSWOT، وطلبات تغيير بمهام، والتزامات، وخطط استمرارية، وفريق أزمات بأزمة مفعّلة الآن.</li>
          <li><b>التخطيط والموازنات:</b> خطة استراتيجية خمسية من قالب الجمعيات الأهلية بإصدارين معتمدين (مراجعة منتصف المدة) ومؤشرات بقراءات، وخطط تشغيلية للإدارات مرتبطة بالمبادرات بنسب مساهمة وأنشطتها في كل الحالات (منجز، حسب الخطة، في خطر، متأخر بإجراء تصحيحي)، ونشاط مُرحّل من العام السابق، وخطة قيد الاعتماد وأخرى مسودة.</li>
          <li><b>المراجعة الداخلية:</b> خطة رئيسية وخطط فرعية، و4 مهام مراجعة في مراحل مختلفة، وتوصيات مغلقة وبانتظار التحقق وقيد التنفيذ ومتأخرة.</li>
          <li><b>عضوية الجمعية العمومية:</b> أعضاء بحالات مختلفة (سارية، تنتهي قريبًا، في مهلة السماح، منتهية، موقوفة)، وطلبات عضوية في كل المراحل، وسدادات بسندات قبض.</li>
          <li><b>الدعم الفني:</b> فريق دعم (مدير وموظف)، وطلبات صيانة بكل الحالات، ومهام منجزة وجارية ومتأخرة بساعات عمل مسجلة.</li>
          <li><b>المنصة:</b> عقد إلكتروني موقّع واشتراك سنوي فعّال، وطلبا اشتراك لجمعيتين (قيد المراجعة، ومعاد للاستكمال).</li>
        </ul>
        <h3>إدارة المنصة <a href="/login" target="_blank" dir="ltr">{{ origin }}/login</a></h3>
        <table class="table">
          <tr><td>مدير المنصة</td><td dir="ltr"><code>{{ platformLogin() }}</code></td></tr>
          <tr><td>كلمة المرور</td><td>كلمة مرور مدير المنصة الحالية (لا تتغير)</td></tr>
        </table>
        <h3>دخول الموظفين <a :href="`/o/${demo.organization.slug}`" target="_blank" dir="ltr">{{ origin }}/o/{{ demo.organization.slug }}</a></h3>
        <table class="table">
          <tr v-for="s in demo.staff" :key="s.email"><td>{{ s.role }}</td><td dir="ltr"><code>{{ s.email }}</code></td></tr>
          <tr><td>كلمة المرور للكل</td><td dir="ltr"><code>{{ demo.staffPassword }}</code></td></tr>
        </table>
        <h3>بوابة المستفيدين <a :href="`/portal/${demo.organization.slug}`" target="_blank" dir="ltr">{{ origin }}/portal/{{ demo.organization.slug }}</a></h3>
        <table class="table">
          <tr v-for="p in demo.portalUsers" :key="p.nationalId"><td>{{ p.fullName }}</td><td dir="ltr"><code>{{ p.nationalId }}</code></td></tr>
          <tr><td>كلمة المرور للكل</td><td dir="ltr"><code>{{ demo.portalPassword }}</code></td></tr>
        </table>
        <template v-if="demo.supportTeam?.length">
          <h3>فريق الدعم الفني <a href="/login" target="_blank" dir="ltr">{{ origin }}/login</a></h3>
          <table class="table">
            <tr v-for="s in demo.supportTeam" :key="s.email"><td>{{ s.role }}</td><td dir="ltr"><code>{{ s.email }}</code></td></tr>
            <tr><td>كلمة المرور</td><td dir="ltr"><code>{{ demo.staffPassword }}</code></td></tr>
          </table>
        </template>
        <div class="modal-actions"><button class="btn btn-ghost" @click="exportDemoWord">⬇ تصدير Word</button><button class="btn btn-primary" @click="demo = null">حسنًا</button></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.portal-link { font-size: .78rem; margin-inline-start: 8px; }
.links { font-size: .8rem; margin-top: 2px; }
.small { font-size: .8rem; }
.click { cursor: pointer; }
.demo h3 { font-size: .95rem; margin: 16px 0 6px; color: var(--primary); }
.demo code { font-size: .9rem; }
.demo-scope { margin: 10px 0 4px; padding-inline-start: 20px; font-size: .88rem; line-height: 1.9; }
.pwd-box { padding: 16px 18px; margin-bottom: 14px; border-inline-start: 4px solid #f59e0b; }
.pwd-box h2 { font-size: 1.05rem; margin: 0 0 4px; }
.pwd-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 0; border-top: 1px solid var(--border); flex-wrap: wrap; }
</style>
