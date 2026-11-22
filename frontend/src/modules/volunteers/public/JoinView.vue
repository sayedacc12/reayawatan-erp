<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import DynFields from '../components/DynFields.vue';
import { AVAILABILITY, fmtDateTime, type FormField, type LookupItem } from '../lib';
import VolShell from './VolShell.vue';
import '../../../shared/module.css';
import '../volunteers.css';

interface Info { name: string; slug: string; publicRegistration: boolean; volunteerTypes: LookupItem[]; volunteerFields: LookupItem[]; registrationFields: FormField[]; charter: { title: string; sections: { title: string; body: string }[] } }
const route = useRoute();
const slug = route.params.slug as string;
const info = ref<Info | null>(null);
const error = ref('');
const tab = ref<'join' | 'contact' | 'track'>((['join', 'contact', 'track'].includes(String(route.query.tab)) ? route.query.tab : 'join') as 'join');
onMounted(async () => {
  try {
    info.value = await api<Info>(`/public/volunteers/org/${slug}`);
    if (!info.value.publicRegistration && tab.value === 'join') tab.value = 'contact';
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const toggle = (list: string[], v: string) => {
  const i = list.indexOf(v);
  if (i >= 0) list.splice(i, 1);
  else list.push(v);
};

// التسجيل
const f = reactive({ fullName: '', nationalId: '', mobile: '', email: '', gender: 'male', birthDate: '', city: '', qualification: '', typeCode: '', fieldCodes: [] as string[], skills: '', availability: [] as string[], answers: {} as Record<string, unknown>, acceptCharter: false });
const showCharter = ref(false);
const done = ref<{ volunteerNo: number; fullName: string } | null>(null);
const busy = ref(false);
const formError = ref('');
async function register() {
  formError.value = '';
  busy.value = true;
  try {
    done.value = await api(`/public/volunteers/org/${slug}/register`, {
      method: 'POST', json: { ...f, email: f.email || null, birthDate: f.birthDate || null, city: f.city || null, qualification: f.qualification || null, typeCode: f.typeCode || null, skills: f.skills || null },
    });
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

// الشكاوى والمقترحات
const t = reactive({ kind: 'suggestion', senderType: 'volunteer', senderName: '', senderMobile: '', senderEmail: '', subject: '', body: '' });
const sent = ref<{ ticketNo: string; trackCode: string } | null>(null);
async function sendTicket() {
  formError.value = '';
  busy.value = true;
  try {
    sent.value = await api(`/public/volunteers/org/${slug}/tickets`, { method: 'POST', json: { ...t, senderMobile: t.senderMobile || null, senderEmail: t.senderEmail || null } });
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

// المتابعة
const tr = reactive({ no: '', code: '' });
const tracked = ref<{ ticketNo: string; kindLabel: string; subject: string; statusLabel: string; status: string; reply: string | null; repliedAt: string | null; createdAt: string } | null>(null);
async function track() {
  formError.value = '';
  try {
    tracked.value = await api(`/public/volunteers/org/${slug}/tickets/${encodeURIComponent(tr.no.trim())}?code=${encodeURIComponent(tr.code.trim())}`);
  } catch (e) {
    tracked.value = null;
    formError.value = (e as Error).message;
  }
}
</script>

<template>
  <VolShell :org="info?.name">
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="info">
      <section class="hero">
        <h1>كن جزءًا من العطاء</h1>
        <p>انضم إلى فريق متطوعي {{ info.name }}، أو أرسل لنا شكوى أو مقترحًا أو استفسارًا عن التطوع.</p>
        <div class="tabs">
          <button v-if="info.publicRegistration" :class="{ on: tab === 'join' }" @click="tab = 'join'; formError = ''">التسجيل متطوعًا</button>
          <button :class="{ on: tab === 'contact' }" @click="tab = 'contact'; formError = ''">شكوى أو مقترح أو استفسار</button>
          <button :class="{ on: tab === 'track' }" @click="tab = 'track'; formError = ''">متابعة طلب</button>
        </div>
      </section>
      <Transition name="page" mode="out-in">
        <section v-if="tab === 'join'" key="j" class="card panel">
          <div v-if="done" class="ok">
            <div class="big">🌱</div>
            <h2>شكرًا لك يا {{ done.fullName }}</h2>
            <p>وصل طلب تسجيلك برقم <b>{{ done.volunteerNo }}</b>، وسيتواصل معك فريق التطوع بعد مراجعته.</p>
          </div>
          <form v-else @submit.prevent="register">
            <div v-if="formError" class="alert alert-error">{{ formError }}</div>
            <div class="pm-grid2">
              <label class="field"><span>الاسم الكامل *</span><input v-model="f.fullName" class="input" required /></label>
              <label class="field"><span>رقم الهوية أو الإقامة *</span><input v-model="f.nationalId" class="input" dir="ltr" maxlength="10" required /></label>
              <label class="field"><span>رقم الجوال *</span><input v-model="f.mobile" class="input" dir="ltr" placeholder="05xxxxxxxx" required /></label>
              <label class="field"><span>البريد الإلكتروني</span><input v-model="f.email" type="email" class="input" dir="ltr" /></label>
              <label class="field"><span>الجنس *</span><select v-model="f.gender" class="input"><option value="male">ذكر</option><option value="female">أنثى</option></select></label>
              <label class="field"><span>تاريخ الميلاد</span><input v-model="f.birthDate" type="date" class="input" /></label>
              <label class="field"><span>المدينة</span><input v-model="f.city" class="input" /></label>
              <label class="field"><span>المؤهل العلمي</span><input v-model="f.qualification" class="input" /></label>
            </div>
            <label class="field"><span>نوع التطوع الذي تفضله</span>
              <select v-model="f.typeCode" class="input"><option value="">اختر...</option><option v-for="x in info.volunteerTypes" :key="x.code" :value="x.code">{{ x.name }}{{ x.description ? ` - ${x.description}` : '' }}</option></select>
            </label>
            <div class="field"><span>مجالات التطوع</span>
              <div class="vt-chips"><button v-for="x in info.volunteerFields" :key="x.code" type="button" :class="['vt-chip', { on: f.fieldCodes.includes(x.code) }]" @click="toggle(f.fieldCodes, x.code)">{{ x.name }}</button></div>
            </div>
            <div class="field"><span>أوقات الإتاحة</span>
              <div class="vt-chips"><button v-for="a in AVAILABILITY" :key="a" type="button" :class="['vt-chip', { on: f.availability.includes(a) }]" @click="toggle(f.availability, a)">{{ a }}</button></div>
            </div>
            <label class="field"><span>مهاراتك وخبراتك</span><textarea v-model="f.skills" class="input" rows="2" /></label>
            <DynFields v-if="info.registrationFields.length" v-model="f.answers" :fields="info.registrationFields" />
            <label class="check charter"><input v-model="f.acceptCharter" type="checkbox" required /> قرأت <a href="#" @click.prevent="showCharter = !showCharter">{{ info.charter.title }}</a> وأوافق عليه</label>
            <Transition name="page"><div v-if="showCharter" class="charter-box">
              <div v-for="(s, i) in info.charter.sections" :key="i"><b>{{ s.title }}</b><p class="vt-pre">{{ s.body }}</p></div>
            </div></Transition>
            <button class="btn btn-primary go" :disabled="busy">إرسال طلب التسجيل</button>
          </form>
        </section>

        <section v-else-if="tab === 'contact'" key="c" class="card panel">
          <div v-if="sent" class="ok">
            <div class="big">✉️</div>
            <h2>وصلنا طلبك</h2>
            <p>رقم الطلب <b class="vt-code">{{ sent.ticketNo }}</b> ورمز المتابعة <b class="vt-code">{{ sent.trackCode }}</b>. احتفظ بهما لمتابعة الرد.</p>
            <button class="btn" @click="tab = 'track'; tr.no = sent.ticketNo; tr.code = sent.trackCode">متابعة الطلب</button>
          </div>
          <form v-else @submit.prevent="sendTicket">
            <div v-if="formError" class="alert alert-error">{{ formError }}</div>
            <div class="kinds">
              <button v-for="k in [{ v: 'complaint', l: 'شكوى' }, { v: 'suggestion', l: 'مقترح' }, { v: 'inquiry', l: 'استفسار' }]" :key="k.v" type="button" :class="{ on: t.kind === k.v }" @click="t.kind = k.v">{{ k.l }}</button>
            </div>
            <div class="pm-grid2">
              <label class="field"><span>الاسم *</span><input v-model="t.senderName" class="input" required /></label>
              <label class="field"><span>صفتك</span><select v-model="t.senderType" class="input"><option value="volunteer">متطوع</option><option value="beneficiary">مستفيد</option><option value="other">أخرى</option></select></label>
              <label class="field"><span>الجوال</span><input v-model="t.senderMobile" class="input" dir="ltr" placeholder="05xxxxxxxx" /></label>
              <label class="field"><span>البريد الإلكتروني</span><input v-model="t.senderEmail" type="email" class="input" dir="ltr" /></label>
            </div>
            <label class="field"><span>الموضوع *</span><input v-model="t.subject" class="input" required /></label>
            <label class="field"><span>التفاصيل *</span><textarea v-model="t.body" class="input" rows="4" required /></label>
            <button class="btn btn-primary go" :disabled="busy">إرسال</button>
          </form>
        </section>

        <section v-else key="t" class="card panel">
          <div v-if="formError" class="alert alert-error">{{ formError }}</div>
          <form class="pm-grid2" @submit.prevent="track">
            <label class="field"><span>رقم الطلب</span><input v-model="tr.no" class="input" dir="ltr" placeholder="VT-2026-0001" required /></label>
            <label class="field"><span>رمز المتابعة</span><input v-model="tr.code" class="input" dir="ltr" required /></label>
            <button class="btn btn-primary">متابعة</button>
          </form>
          <div v-if="tracked" class="ok" style="text-align: start; margin-top: 12px">
            <h3>{{ tracked.kindLabel }}: {{ tracked.subject }}</h3>
            <p>الحالة: <b>{{ tracked.statusLabel }}</b> · أُرسل {{ fmtDateTime(tracked.createdAt) }}</p>
            <p v-if="tracked.reply" class="reply"><b>رد الجمعية ({{ fmtDateTime(tracked.repliedAt) }}):</b><br />{{ tracked.reply }}</p>
            <p v-else class="pm-muted">لم يصل رد بعد.</p>
          </div>
        </section>
      </Transition>
    </template>
  </VolShell>
</template>

<style scoped>
.hero { color: #fff; text-align: center; padding: 26px 0 18px; animation: pm-rise .6s var(--ease) both; }
.hero h1 { font-size: 2rem; background: linear-gradient(90deg, #a7f3d0, #fde68a); -webkit-background-clip: text; background-clip: text; color: transparent; margin-bottom: 6px; }
.hero p { color: rgba(255,255,255,.75); margin: 0 auto 16px; max-width: 560px; }
.tabs { display: inline-flex; gap: 6px; background: rgba(255,255,255,.08); padding: 5px; border-radius: 999px; flex-wrap: wrap; justify-content: center; }
.tabs button { font: inherit; border: 0; background: transparent; color: rgba(255,255,255,.8); padding: 7px 16px; border-radius: 999px; cursor: pointer; transition: all .2s; }
.tabs button.on { background: linear-gradient(135deg, #34d399, #facc15); color: #052e1c; font-weight: 700; }
.panel { padding: 22px; border-radius: 18px; }
.go { width: 100%; margin-top: 10px; min-height: 46px; font-size: 1.02rem; }
.ok { text-align: center; padding: 16px 0; }
.ok .big { font-size: 3rem; animation: pm-rise .6s var(--ease) both; }
.charter { margin: 10px 0; }
.charter-box { max-height: 260px; overflow: auto; background: var(--surface-2); border-radius: 12px; padding: 10px 14px; font-size: .88rem; }
.kinds { display: flex; gap: 8px; margin-bottom: 14px; }
.kinds button { flex: 1; font: inherit; font-weight: 600; padding: 10px; border-radius: 12px; border: 1.5px solid var(--border); background: var(--surface); cursor: pointer; }
.kinds button.on { border-color: #10b981; background: #ecfdf5; color: #047857; }
.reply { background: #ecfdf5; border-radius: 10px; padding: 10px 12px; }
</style>
