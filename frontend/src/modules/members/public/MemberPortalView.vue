<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import MemberCard from '../components/MemberCard.vue';
import PersonForm from '../components/PersonForm.vue';
import { durationLabel, fmtDate, fmtDateTime, sar, toFormData, type CardData, type Condition, type DocReq, type FormField } from '../lib';
import MemShell from './MemShell.vue';
import '../../projects/projects.css';
import '../members.css';

interface PubType { code: string; name: string; description: string | null; fee: number; joiningFee: number; durationMonths: number; votingRights: boolean; minAge: number | null; saudiOnly: boolean; benefits: string | null; color: string }
interface Info {
  name: string; slug: string; publicEnabled: boolean; intro: string | null; types: PubType[]; conditions: Condition[];
  regulation: { title: string; sections: { title: string; body: string }[]; version: number; effectiveDate: string | null };
  applicationFields: FormField[]; documents: DocReq[]; nationalities: string[]; payment: { online: boolean; transfer: boolean; cash: boolean };
}
interface Track {
  applicationNo: string; fullName: string; typeName: string; status: string; statusLabel: string; stageName: string | null; createdAt: string; note: string | null;
  invoice: { invoiceNo: string; amount: number; status: string; statusLabel: string; payToken: string | null } | null; memberNo: number | null;
  data: Record<string, unknown> & { documents: { key: string; name: string; fileName: string }[] } | null;
}
interface Mine {
  card: CardData; daysLeft: number; canRenew: boolean; renewalAmount: number; benefits: string | null;
  invoices: { invoiceNo: string; kindLabel: string; amount: number; status: string; statusLabel: string; paidOn: string | null; periodStart: string | null; periodEnd: string | null; payToken: string | null }[];
}
type Tab = 'about' | 'apply' | 'track' | 'member';
const route = useRoute();
const router = useRouter();
const slug = route.params.slug as string;
const info = ref<Info | null>(null);
const error = ref('');
const tab = ref<Tab>((['about', 'apply', 'track', 'member'].includes(String(route.query.tab)) ? route.query.tab : 'about') as Tab);
const formError = ref('');
const busy = ref(false);
const go = (t: Tab) => {
  tab.value = t;
  formError.value = '';
};
onMounted(async () => {
  try {
    info.value = await api<Info>(`/public/members/org/${slug}`);
    if (!info.value.publicEnabled && tab.value === 'apply') tab.value = 'about';
  } catch (e) {
    error.value = (e as Error).message;
  }
});

// التقديم
const done = ref<{ applicationNo: string; trackCode: string; fullName: string } | null>(null);
const form = ref<InstanceType<typeof PersonForm> | null>(null);
async function submitApply(data: Record<string, unknown>, files: Record<string, File>) {
  busy.value = true;
  try {
    done.value = await api(`/public/members/org/${slug}/apply`, { method: 'POST', body: toFormData(data, files) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    form.value?.setError((e as Error).message);
  } finally {
    busy.value = false;
  }
}

// المتابعة
const tr = reactive({ no: (route.query.no as string) ?? '', code: (route.query.code as string) ?? '' });
const tracked = ref<Track | null>(null);
const editing = ref(false);
async function track() {
  formError.value = '';
  try {
    tracked.value = await api<Track>(`/public/members/org/${slug}/applications/${encodeURIComponent(tr.no.trim())}?code=${encodeURIComponent(tr.code.trim())}`);
  } catch (e) {
    tracked.value = null;
    formError.value = (e as Error).message;
  }
}
async function resubmit(data: Record<string, unknown>, files: Record<string, File>) {
  busy.value = true;
  try {
    tracked.value = await api<Track>(`/public/members/org/${slug}/applications/${encodeURIComponent(tr.no.trim())}/resubmit?code=${encodeURIComponent(tr.code.trim())}`, {
      method: 'POST', body: toFormData(data, files),
    });
    editing.value = false;
  } catch (e) {
    form.value?.setError((e as Error).message);
  } finally {
    busy.value = false;
  }
}
function trackNow() {
  if (!done.value) return;
  tr.no = done.value.applicationNo;
  tr.code = done.value.trackCode;
  go('track');
  void track();
}

// عضويتي
const mq = reactive({ memberNo: '', nationalId: '' });
const mine = ref<Mine | null>(null);
async function lookup() {
  formError.value = '';
  try {
    mine.value = await api<Mine>(`/public/members/org/${slug}/membership`, { method: 'POST', json: { memberNo: Number(mq.memberNo), nationalId: mq.nationalId } });
  } catch (e) {
    mine.value = null;
    formError.value = (e as Error).message;
  }
}
async function renew() {
  busy.value = true;
  formError.value = '';
  try {
    const r = await api<{ payToken: string | null }>(`/public/members/org/${slug}/membership/renew`, { method: 'POST', json: { memberNo: Number(mq.memberNo), nationalId: mq.nationalId } });
    if (r.payToken) router.push(`/m/pay/${r.payToken}`);
    else await lookup();
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const steps = ['تقديم الطلب وإرفاق الهوية', 'مراجعة الطلب واعتماده', 'سداد الاشتراك إلكترونيًا', 'تفعيل العضوية وإصدار البطاقة'];
</script>

<template>
  <MemShell :org="info?.name" wide>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="info">
      <section class="hero">
        <h1>عضوية {{ info.name }}</h1>
        <p>{{ info.intro || 'كن عضوًا في الجمعية العمومية، وشاركنا صناعة الأثر واتخاذ القرار.' }}</p>
        <div class="tabs">
          <button :class="{ on: tab === 'about' }" @click="go('about')">الشروط والأنواع</button>
          <button v-if="info.publicEnabled" :class="{ on: tab === 'apply' }" @click="go('apply')">طلب عضوية</button>
          <button :class="{ on: tab === 'track' }" @click="go('track')">متابعة طلب</button>
          <button :class="{ on: tab === 'member' }" @click="go('member')">عضويتي والتجديد</button>
        </div>
      </section>

      <Transition name="page" mode="out-in">
        <section v-if="tab === 'about'" key="a" class="card panel">
          <div class="flow">
            <div v-for="(s, i) in steps" :key="i" class="flow-step" :style="{ '--i': i }"><b>{{ i + 1 }}</b><span>{{ s }}</span></div>
          </div>
          <h2>أنواع العضوية</h2>
          <div class="mb-types">
            <div v-for="t in info.types" :key="t.code" class="mb-type" :style="{ '--c': t.color, cursor: 'default' }">
              <h3>{{ t.name }}</h3>
              <div class="fee">{{ t.fee ? sar(t.fee) : 'بدون اشتراك' }} <small v-if="t.fee">{{ durationLabel(t.durationMonths) }}</small></div>
              <div v-if="t.joiningFee" class="pm-muted">+ رسوم انتساب {{ sar(t.joiningFee) }} مرة واحدة</div>
              <p v-if="t.description" class="pm-muted" style="margin: 6px 0 0">{{ t.description }}</p>
              <ul>
                <li v-if="t.votingRights">حق التصويت في الجمعية العمومية</li>
                <li v-if="t.minAge">العمر {{ t.minAge }} سنة فأكثر</li>
                <li v-if="t.saudiOnly">للسعوديين</li>
                <li v-for="b in (t.benefits ?? '').split('\n').filter(Boolean)" :key="b">{{ b }}</li>
              </ul>
            </div>
          </div>
          <h2 style="margin-top: 22px">شروط العضوية</h2>
          <ol class="conds"><li v-for="c in info.conditions" :key="c.key">{{ c.text }}<small v-if="c.reference">{{ c.reference }}</small></li></ol>
          <details class="reg">
            <summary>{{ info.regulation.title }}<span v-if="info.regulation.version" class="pm-muted"> · الإصدار {{ info.regulation.version }}{{ info.regulation.effectiveDate ? ` (ساري من ${fmtDate(info.regulation.effectiveDate)})` : '' }}</span></summary>
            <div v-for="(s, i) in info.regulation.sections" :key="i"><b>{{ s.title }}</b><p class="mb-pre">{{ s.body }}</p></div>
          </details>
          <button v-if="info.publicEnabled" class="btn btn-primary go" @click="go('apply')">قدّم طلب العضوية الآن</button>
          <p v-else class="alert">التقديم من الموقع متوقف حاليًا، تواصل مع الجمعية.</p>
        </section>

        <section v-else-if="tab === 'apply'" key="p" class="card panel">
          <div v-if="done" class="ok">
            <div class="big">🎉</div>
            <h2>وصل طلبك يا {{ done.fullName }}</h2>
            <p>رقم الطلب <b class="mb-code">{{ done.applicationNo }}</b> ورمز المتابعة <b class="mb-code">{{ done.trackCode }}</b>.</p>
            <p class="pm-muted">احتفظ بهما لمتابعة الطلب، وبعد اعتماده يظهر لك رابط سداد الاشتراك.</p>
            <button class="btn btn-primary" @click="trackNow">متابعة الطلب</button>
          </div>
          <PersonForm v-else ref="form" mode="apply" cards :types="info.types" :nationalities="info.nationalities" :fields="info.applicationFields"
            :documents="info.documents" :conditions="info.conditions" :busy="busy" submit-label="إرسال طلب العضوية" @submit="submitApply" @cancel="go('about')" />
        </section>

        <section v-else-if="tab === 'track'" key="t" class="card panel">
          <div v-if="formError" class="alert alert-error">{{ formError }}</div>
          <form class="pm-grid2" @submit.prevent="track">
            <label class="field"><span>رقم الطلب</span><input v-model="tr.no" class="input" dir="ltr" placeholder="MA-2026-0001" required /></label>
            <label class="field"><span>رمز المتابعة</span><input v-model="tr.code" class="input" dir="ltr" required /></label>
            <button class="btn btn-primary">متابعة</button>
          </form>
          <div v-if="tracked && !editing" class="result">
            <h3>{{ tracked.fullName }} · {{ tracked.typeName }}</h3>
            <p>الحالة: <b>{{ tracked.statusLabel }}</b><span v-if="tracked.stageName"> ({{ tracked.stageName }})</span> · قُدم {{ fmtDateTime(tracked.createdAt) }}</p>
            <p v-if="tracked.note" class="note"><b>{{ tracked.status === 'returned' ? 'المطلوب استكماله:' : 'سبب الرفض:' }}</b> {{ tracked.note }}</p>
            <button v-if="tracked.status === 'returned'" class="btn btn-primary" @click="editing = true">استكمال الطلب وإعادة إرساله</button>
            <div v-if="tracked.invoice && tracked.status === 'awaiting_payment'" class="pay">
              <p>اعتُمد طلبك 🎉 بقي سداد الاشتراك <b>{{ sar(tracked.invoice.amount) }}</b> (مطالبة {{ tracked.invoice.invoiceNo }}: {{ tracked.invoice.statusLabel }}).</p>
              <RouterLink v-if="tracked.invoice.payToken" :to="`/m/pay/${tracked.invoice.payToken}`" class="btn btn-primary">سداد الاشتراك</RouterLink>
            </div>
            <p v-if="tracked.status === 'completed'" class="okline">أصبحت عضوًا برقم <b>{{ tracked.memberNo }}</b>. اعرض بطاقتك من «عضويتي والتجديد».</p>
          </div>
          <template v-if="tracked && editing && tracked.data">
            <div class="mb-sec">استكمال الطلب</div>
            <PersonForm ref="form" mode="apply" :types="info.types" :nationalities="info.nationalities" :fields="info.applicationFields" :documents="info.documents"
              :conditions="info.conditions" :initial="tracked.data" :existing-docs="tracked.data.documents" :busy="busy" submit-label="إعادة إرسال الطلب"
              @submit="resubmit" @cancel="editing = false" />
          </template>
        </section>

        <section v-else key="m" class="card panel">
          <div v-if="formError" class="alert alert-error">{{ formError }}</div>
          <form class="pm-grid2" @submit.prevent="lookup">
            <label class="field"><span>رقم العضوية</span><input v-model="mq.memberNo" class="input" dir="ltr" inputmode="numeric" required /></label>
            <label class="field"><span>رقم الهوية</span><input v-model="mq.nationalId" class="input" dir="ltr" maxlength="10" inputmode="numeric" required /></label>
            <button class="btn btn-primary">عرض عضويتي</button>
          </form>
          <div v-if="mine" class="mine">
            <MemberCard :card="mine.card" />
            <div class="mine-side">
              <p v-if="mine.daysLeft >= 0">تنتهي العضوية بعد <b>{{ mine.daysLeft }}</b> يومًا ({{ fmtDate(mine.card.endDate) }}).</p>
              <p v-else class="note">انتهت العضوية منذ {{ -mine.daysLeft }} يومًا.</p>
              <button v-if="mine.canRenew" class="btn btn-primary go" :disabled="busy" @click="renew">تجديد العضوية ({{ sar(mine.renewalAmount) }})</button>
              <div class="mb-sec">كشف الاشتراكات</div>
              <div v-for="x in mine.invoices" :key="x.invoiceNo" class="inv">
                <span><b>{{ x.kindLabel }}</b> · {{ x.invoiceNo }}<small v-if="x.periodStart" class="pm-muted" style="display: block">من {{ fmtDate(x.periodStart) }} إلى {{ fmtDate(x.periodEnd) }}</small></span>
                <span>{{ sar(x.amount) }}</span>
                <RouterLink v-if="x.payToken" :to="`/m/pay/${x.payToken}`" class="btn btn-sm btn-primary">سداد</RouterLink>
                <span v-else class="pm-muted">{{ x.statusLabel }}</span>
              </div>
              <p v-if="!mine.invoices.length" class="pm-muted">لا توجد اشتراكات مسجلة</p>
            </div>
          </div>
        </section>
      </Transition>
    </template>
  </MemShell>
</template>

<style scoped>
.hero { color: #fff; text-align: center; padding: 26px 0 18px; animation: pm-rise .6s var(--ease) both; }
.hero h1 { font-size: 2rem; background: linear-gradient(90deg, #99f6e4, #fde68a); -webkit-background-clip: text; background-clip: text; color: transparent; margin-bottom: 6px; }
.hero p { color: rgba(255,255,255,.75); margin: 0 auto 16px; max-width: 600px; white-space: pre-line; }
.tabs { display: inline-flex; gap: 6px; background: rgba(255,255,255,.08); padding: 5px; border-radius: 999px; flex-wrap: wrap; justify-content: center; }
.tabs button { font: inherit; border: 0; background: transparent; color: rgba(255,255,255,.8); padding: 7px 16px; border-radius: 999px; cursor: pointer; transition: all .2s; }
.tabs button.on { background: linear-gradient(135deg, #2dd4bf, #fbbf24); color: #0b1b3f; font-weight: 700; }
.panel { padding: 22px; border-radius: 18px; }
.panel h2 { font-size: 1.1rem; margin: 0 0 12px; }
.go { width: 100%; margin-top: 14px; min-height: 46px; font-size: 1.02rem; }
.ok { text-align: center; padding: 16px 0; }
.ok .big { font-size: 3rem; animation: pm-rise .6s var(--ease) both; }
.flow { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 20px; }
.flow-step { background: var(--surface-2); border-radius: 14px; padding: 10px; text-align: center; font-size: .82rem; animation: pm-rise .5s calc(var(--i) * 90ms) var(--ease) both; }
.flow-step b { display: grid; place-items: center; width: 30px; height: 30px; margin: 0 auto 6px; border-radius: 50%; color: #fff; background: linear-gradient(135deg, #0f766e, #1e3a8a); }
.conds { padding-inline-start: 20px; line-height: 1.9; }
.conds small { display: block; color: var(--muted); font-size: .74rem; line-height: 1.4; }
.reg { background: var(--surface-2); border-radius: 12px; padding: 10px 14px; font-size: .9rem; }
.reg summary { cursor: pointer; font-weight: 700; }
.result { margin-top: 14px; padding: 14px; border-radius: 14px; background: var(--surface-2); }
.result h3 { margin: 0 0 6px; }
.note { background: #fff7ed; color: #9a3412; border-radius: 10px; padding: 8px 12px; }
.okline { background: #ecfdf5; color: #065f46; border-radius: 10px; padding: 8px 12px; }
.pay { background: #eff6ff; border-radius: 12px; padding: 10px 14px; margin-top: 10px; }
.mine { display: grid; grid-template-columns: minmax(0, 420px) 1fr; gap: 18px; margin-top: 16px; align-items: start; }
.inv { display: flex; gap: 10px; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: .88rem; }
@media (max-width: 760px) { .flow { grid-template-columns: 1fr 1fr; } .mine { grid-template-columns: 1fr; } .hero h1 { font-size: 1.6rem; } }
</style>
