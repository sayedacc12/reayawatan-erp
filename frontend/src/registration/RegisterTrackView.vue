<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import { copyText } from '../modules/platform/labels';
import PublicShell from './PublicShell.vue';
import RegistrationForm, { type MainData } from './RegistrationForm.vue';

interface Track {
  number: string;
  status: 'submitted' | 'returned' | 'approved' | 'rejected';
  reviewNote: string | null;
  createdAt: string;
  data: MainData;
  history: { step: string; at: string; note?: string }[];
  organization: { name: string; slug: string; subscriptionStatus: string; trialEndsOn: string | null; subscriptionEndsOn: string | null } | null;
  contract: { number: string; status: string; path: string } | null;
}
const route = useRoute();
const token = route.params.token as string;
const t = ref<Track | null>(null);
const error = ref('');
const busy = ref(false);
const editing = ref(false);
const saveError = ref('');
const justCreated = ref(route.query.new === '1');
const link = location.href.split('?')[0];
const origin = location.origin;

async function load() {
  try {
    t.value = await api<Track>(`/public/registrations/${token}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

async function resubmit(fd: FormData) {
  busy.value = true;
  saveError.value = '';
  try {
    t.value = await api<Track>(`/public/registrations/${token}`, { method: 'PUT', body: fd });
    editing.value = false;
  } catch (e) {
    saveError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

/** مراحل الطلب: تقديم ← مراجعة ← اعتماد ← العقد ← التفعيل */
const stage = computed(() => {
  const s = t.value;
  if (!s) return 0;
  if (s.status === 'submitted' || s.status === 'returned') return 1;
  if (s.status === 'rejected') return 1;
  if (s.contract?.status === 'signed') return 4;
  if (s.contract) return 3;
  return 2;
});
const stages = ['تقديم الطلب', 'المراجعة', 'الاعتماد', 'العقد الإلكتروني', 'الاشتراك ساري'];
const fmt = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'long' }) : '');
const copy = (s: string) => copyText(s);
</script>

<template>
  <PublicShell>
    <div v-if="error" class="alert alert-error" style="margin-top: 30px">{{ error }}</div>
    <template v-if="t">
      <section class="head">
        <p class="kicker">طلب اشتراك رقم <b dir="ltr">{{ t.number }}</b></p>
        <h1>{{ t.data.orgName }}</h1>
      </section>

      <div v-if="justCreated" class="card saved">
        <h2>✓ تم استلام طلبك</h2>
        <p>احفظ رابط المتابعة هذا، فهو الطريقة الوحيدة لمتابعة الطلب واستكماله وتوقيع العقد لاحقًا:</p>
        <div class="linkbox"><code dir="ltr">{{ link }}</code><button class="btn btn-sm" @click="copy(link)">نسخ</button></div>
      </div>

      <div class="card track">
        <ol class="stages">
          <li v-for="(s, i) in stages" :key="s" :class="{ done: i < stage || (i === stage && stage === 4), now: i === stage && stage < 4, bad: t.status === 'rejected' && i === 1 }" :style="{ '--i': i }">
            <span class="dot">{{ i < stage || (i === stage && stage === 4) ? '✓' : i + 1 }}</span>
            <span>{{ s }}</span>
          </li>
        </ol>

        <div v-if="t.status === 'submitted'" class="state info">
          <b>طلبك قيد المراجعة لدى إدارة المنصة.</b> سيظهر هنا قرار الاعتماد أو أي ملاحظات.
        </div>
        <div v-else-if="t.status === 'returned'" class="state warn">
          <b>أعيد الطلب لاستكمال بعض البيانات:</b>
          <p class="note">{{ t.reviewNote }}</p>
          <button v-if="!editing" class="btn btn-primary" @click="editing = true">استكمال الطلب وإعادة إرساله</button>
        </div>
        <div v-else-if="t.status === 'rejected'" class="state bad">
          <b>نعتذر، لم يُقبل الطلب.</b>
          <p class="note">{{ t.reviewNote }}</p>
        </div>
        <template v-else-if="t.organization">
          <div class="state ok">
            <b>تم اعتماد جمعيتك 🎉</b>
            <span v-if="t.organization.subscriptionStatus === 'trial'"> الفترة التجريبية مفتوحة حتى {{ fmt(t.organization.trialEndsOn) }}.</span>
            <span v-else-if="t.organization.subscriptionStatus === 'awaiting_contract'"> يُفعَّل الدخول بعد توقيع عقد الاشتراك.</span>
            <span v-else> الاشتراك ساري{{ t.organization.subscriptionEndsOn ? ` حتى ${fmt(t.organization.subscriptionEndsOn)}` : '' }}.</span>
          </div>
          <h3>روابط جمعيتك</h3>
          <div class="linkbox"><span>دخول الموظفين</span><code dir="ltr">{{ origin }}/o/{{ t.organization.slug }}</code><a class="btn btn-sm" :href="`/o/${t.organization.slug}`" target="_blank">فتح</a></div>
          <div class="linkbox"><span>بوابة المستفيدين</span><code dir="ltr">{{ origin }}/portal/{{ t.organization.slug }}</code><a class="btn btn-sm" :href="`/portal/${t.organization.slug}`" target="_blank">فتح</a></div>
          <div class="linkbox"><span>بوابة الموردين</span><code dir="ltr">{{ origin }}/supplier/{{ t.organization.slug }}</code><a class="btn btn-sm" :href="`/supplier/${t.organization.slug}`" target="_blank">فتح</a></div>
          <p class="muted small">يدخل مدير النظام بالبريد <b dir="ltr">{{ t.data.adminEmail }}</b> وكلمة المرور التي اخترتها عند التسجيل.</p>
          <div v-if="t.contract" class="contract-cta">
            <div>
              <b>عقد الاشتراك {{ t.contract.number }}</b>
              <p class="muted">{{ t.contract.status === 'signed' ? 'تم توقيع العقد إلكترونيًا.' : t.contract.status === 'changes_requested' ? 'طلبتم تعديلًا، وتعمل إدارة المنصة عليه.' : 'العقد جاهز لمراجعتكم وتوقيعكم إلكترونيًا.' }}</p>
            </div>
            <RouterLink class="btn btn-primary" :to="t.contract.path">{{ t.contract.status === 'sent' ? 'مراجعة العقد وتوقيعه' : 'عرض العقد' }}</RouterLink>
          </div>
          <p v-else class="muted small">ستُرسل إدارة المنصة عقد الاشتراك هنا عندما يجهز.</p>
        </template>
      </div>

      <div v-if="editing" class="card edit">
        <h2>استكمال بيانات الطلب</h2>
        <RegistrationForm mode="resubmit" :initial="t.data" :busy="busy" submit-label="إعادة إرسال الطلب" @submit="resubmit" @cancel="editing = false">
          <template #error><div v-if="saveError" class="alert alert-error">{{ saveError }}</div></template>
        </RegistrationForm>
      </div>
    </template>
  </PublicShell>
</template>

<style scoped>
.head { color: #fff; text-align: center; padding: 22px 0 18px; }
.kicker { color: #a9c9b5; margin: 0 0 4px; }
.head h1 { font-size: clamp(1.4rem, 3.5vw, 2rem); }
.card { padding: 22px; margin-bottom: 16px; animation: up .5s var(--ease) both; }
@keyframes up { from { opacity: 0; transform: translateY(12px); } }
.saved { border: 1px solid #a7e3c4; background: linear-gradient(180deg, #f0fbf5, #fff); }
.saved h2 { color: var(--success); margin-bottom: 6px; }
.stages { list-style: none; padding: 0; margin: 0 0 20px; display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; position: relative; }
.stages li { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; font-size: .85rem; color: var(--muted); position: relative; animation: up .4s var(--ease) both; animation-delay: calc(var(--i) * 80ms); }
.stages li::after { content: ''; position: absolute; top: 15px; left: -50%; width: 100%; height: 2px; background: var(--border); z-index: 0; }
.stages li:last-child::after { display: none; }
.stages li.done::after { background: var(--primary); }
.dot { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: var(--surface-2); border: 2px solid var(--border); font-weight: 700; position: relative; z-index: 1; }
.done .dot { background: var(--grad); color: #fff; border-color: transparent; }
.done { color: var(--primary); }
.now .dot { border-color: #c7a27a; color: #9a5b00; box-shadow: 0 0 0 0 rgba(232,176,75,.5); animation: ring 2s infinite; }
.now { color: #9a5b00; font-weight: 600; }
.bad .dot { border-color: var(--danger); color: var(--danger); }
@keyframes ring { 70% { box-shadow: 0 0 0 10px rgba(232,176,75,0); } 100% { box-shadow: 0 0 0 0 rgba(232,176,75,0); } }
.state { border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; }
.state.info { background: #e8f0ff; color: #1e3a8a; }
.state.warn { background: #fff4e0; color: #7a4800; }
.state.bad { background: var(--danger-soft); color: var(--danger); }
.state.ok { background: var(--success-soft); color: var(--success); }
.note { white-space: pre-wrap; margin: 6px 0 10px; }
h3 { font-size: .98rem; margin: 6px 0 8px; }
.linkbox { display: flex; align-items: center; gap: 10px; background: var(--surface-2); border: 1px dashed var(--border); border-radius: 10px; padding: 8px 12px; margin-bottom: 8px; flex-wrap: wrap; }
.linkbox span { font-weight: 500; min-width: 110px; }
.linkbox code { flex: 1; text-align: left; overflow-wrap: anywhere; font-size: .88rem; }
.small { font-size: .88rem; }
.contract-cta { margin-top: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; border-radius: 14px; padding: 16px; background: linear-gradient(135deg, #fff8e8, #fff); border: 1px solid #f0d9a6; }
.contract-cta p { margin: 2px 0 0; }
@media (max-width: 640px) { .stages { grid-template-columns: repeat(5, 1fr); font-size: .72rem; } .stages li { font-size: .72rem; } .card { padding: 16px; } }
</style>
