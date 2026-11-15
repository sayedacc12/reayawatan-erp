<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, openProtectedFile } from '../../../api';
import RegistrationForm, { type MainData } from '../../../registration/RegistrationForm.vue';
import { useToast } from '../../../stores/toast';
import ScreensPicker, { type Access } from '../components/ScreensPicker.vue';
import { CONTRACT_STATUS, copyText, cycleLabel, fmtDate, money, ORG_STATE, type ScreenModule } from '../labels';
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
  </div>
</template>

<style scoped>
.back { display: inline-block; margin-bottom: 10px; font-size: .9rem; }
.small { font-size: .86rem; }
.sub-form { margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 12px; }
.p-link-box span { min-width: 110px; font-weight: 500; }
.click { cursor: pointer; }
.p-tab .tone { margin-inline-start: 4px; }
</style>
