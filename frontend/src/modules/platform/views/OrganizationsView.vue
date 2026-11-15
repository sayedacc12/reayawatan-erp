<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { useRouter } from 'vue-router';
import { CONTRACT_STATUS, cycleLabel, fmtDate, money, ORG_STATE } from '../labels';
import '../platform.css';

const toast = useToast();

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

async function load() {
  try {
    [orgs.value, optional.value] = await Promise.all([
      api<Org[]>('/platform/organizations'),
      api<OptionalModule[]>('/platform/modules'),
    ]);
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
}
const demo = ref<DemoResult | null>(null);
const demoBusy = ref(false);
async function createDemo() {
  demoBusy.value = true;
  try {
    demo.value = await api<DemoResult>('/platform/demo-organization', { method: 'POST' });
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    demoBusy.value = false;
  }
}
const origin = location.origin;

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
        <button v-if="!orgs.some((o) => o.slug === 'demo')" class="btn btn-ghost-light" :disabled="demoBusy" @click="createDemo">{{ demoBusy ? 'جارٍ التجهيز...' : '✨ جمعية تجريبية للشرح' }}</button>
        <RouterLink to="/platform/applications?new=1" class="btn btn-gold">+ تسجيل جمعية جديدة</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

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
        <div class="modal-actions"><button class="btn btn-primary" @click="demo = null">حسنًا</button></div>
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
</style>
