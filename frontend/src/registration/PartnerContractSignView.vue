<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import ContractDocument from './ContractDocument.vue';
import PublicShell from './PublicShell.vue';

interface PublicContract {
  number: string;
  version: number;
  title: string;
  status: string;
  statusLabel: string;
  organizationName: string;
  partnerName: string;
  contactName: string | null;
  contactTitle: string | null;
  needsRegistration: boolean;
  rendered: { title: string; paragraphs: string[]; category?: string }[];
  startsOn: string;
  endsOn: string;
  contentHash: string;
  signedAt: string | null;
  signerName: string | null;
  signerTitle: string | null;
  changeRequest: string | null;
}
const route = useRoute();
const token = route.params.token as string;
const c = ref<PublicContract | null>(null);
const error = ref('');
const busy = ref(false);
const actionError = ref('');
const mode = ref<'sign' | 'changes'>('sign');
const f = reactive({ signerName: '', signerTitle: '', registrationNo: '', agree: false, note: '' });
const celebrate = ref(false);

onMounted(async () => {
  try {
    c.value = await api<PublicContract>(`/public/partnership-contracts/${token}`);
    f.signerName = c.value.contactName ?? '';
    f.signerTitle = c.value.contactTitle ?? '';
  } catch (e) {
    error.value = (e as Error).message;
  }
});

async function sign() {
  actionError.value = '';
  busy.value = true;
  try {
    const body = { signerName: f.signerName, signerTitle: f.signerTitle, agree: f.agree, registrationNo: c.value?.needsRegistration ? f.registrationNo : null };
    c.value = await api<PublicContract>(`/public/partnership-contracts/${token}/sign`, { method: 'POST', json: body });
    celebrate.value = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    actionError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const printDoc = () => window.print();
async function requestChanges() {
  actionError.value = '';
  busy.value = true;
  try {
    c.value = await api<PublicContract>(`/public/partnership-contracts/${token}/request-changes`, { method: 'POST', json: { note: f.note } });
  } catch (e) {
    actionError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <PublicShell wide>
    <div v-if="error" class="alert alert-error" style="margin-top: 30px">{{ error }}</div>
    <template v-if="c">
      <section class="head">
        <p class="kicker">اتفاقية شراكة إلكترونية</p>
        <h1>{{ c.organizationName }} <span class="amp">و</span> {{ c.partnerName }}</h1>
        <p class="ttl">{{ c.title }} · من {{ c.startsOn }} إلى {{ c.endsOn }}</p>
      </section>
      <div v-if="celebrate" class="card done-card"><span class="big">✓</span><div><h2>تم توقيع الاتفاقية بنجاح</h2><p>شكرًا لشراكتكم. يمكنكم طباعة نسخة من الاتفاقية في أي وقت من هذا الرابط.</p></div></div>
      <div v-else-if="c.status === 'changes_requested'" class="card info-card">أرسلتم طلب تعديل: «{{ c.changeRequest }}». ستراجع الجمعية طلبكم وتعيد إرسال الاتفاقية.</div>
      <div v-else-if="!['sent', 'signed', 'expired'].includes(c.status)" class="card info-card">حالة الاتفاقية: {{ c.statusLabel }}. لا يمكن توقيعها الآن.</div>

      <div class="layout">
        <ContractDocument heading="اتفاقية شراكة" :sub="`${c.organizationName} و${c.partnerName} · الإصدار ${c.version}`" :number="c.number" :rendered="c.rendered" :hash="c.contentHash"
          :signature="c.signedAt ? { name: c.signerName, title: c.signerTitle, at: c.signedAt } : null" />
        <aside v-if="c.status === 'sent'" class="card side">
          <div class="seg">
            <button :class="{ on: mode === 'sign' }" @click="mode = 'sign'">التوقيع</button>
            <button :class="{ on: mode === 'changes' }" @click="mode = 'changes'">طلب تعديل</button>
          </div>
          <form v-if="mode === 'sign'" @submit.prevent="sign">
            <p class="muted small">التوقيع الإلكتروني ملزم وفق نظام التعاملات الإلكترونية في المملكة العربية السعودية.</p>
            <div class="field"><label>اسم الموقّع *</label><input v-model="f.signerName" class="input" required minlength="3" /></div>
            <div class="field"><label>صفته *</label><input v-model="f.signerTitle" class="input" required /></div>
            <div v-if="c.needsRegistration" class="field"><label>رقم السجل أو الترخيص لجهتكم (للتحقق) *</label><input v-model="f.registrationNo" class="input" dir="ltr" required /></div>
            <label class="check agree"><input v-model="f.agree" type="checkbox" required /> <span>أقر بأني اطلعت على جميع بنود العقد وأوافق عليها، وأني مفوض بالتوقيع عن جهتي.</span></label>
            <div v-if="actionError" class="alert alert-error">{{ actionError }}</div>
            <button class="btn btn-primary sign-btn" :disabled="busy || !f.agree">✍ توقيع الاتفاقية إلكترونيًا</button>
          </form>
          <form v-else @submit.prevent="requestChanges">
            <p class="muted small">اكتب ما تريدون تعديله في العقد، وستراجعه الجمعية.</p>
            <div class="field"><textarea v-model="f.note" class="input" rows="6" required minlength="3" /></div>
            <div v-if="actionError" class="alert alert-error">{{ actionError }}</div>
            <button class="btn btn-primary" :disabled="busy">إرسال طلب التعديل</button>
          </form>
        </aside>
        <aside v-else-if="c.status === 'signed' || c.status === 'expired'" class="card side">
          <p><b>{{ c.statusLabel }}</b></p>
          <button class="btn" @click="printDoc">طباعة الاتفاقية</button>
        </aside>
      </div>
    </template>
  </PublicShell>
</template>

<style scoped>
.head { color: #fff; text-align: center; padding: 22px 0 18px; }
.kicker { color: #fcd34d; margin: 0 0 4px; }
.amp { color: #5eead4; }
.ttl { margin: 6px 0 0; opacity: .85; }
.layout { display: grid; grid-template-columns: 1fr 300px; gap: 16px; align-items: start; }
.side { padding: 18px; position: sticky; top: 16px; animation: up .5s .2s var(--ease) both; }
@keyframes up { from { opacity: 0; transform: translateY(12px); } }
.seg { display: grid; grid-template-columns: 1fr 1fr; background: var(--surface-2); border-radius: 10px; padding: 3px; margin-bottom: 12px; }
.seg button { border: 0; background: none; padding: 7px; border-radius: 8px; font: inherit; cursor: pointer; color: var(--muted); }
.seg button.on { background: #fff; color: var(--primary); font-weight: 600; box-shadow: var(--shadow); }
.small { font-size: .85rem; }
.agree { align-items: flex-start; font-size: .88rem; margin-bottom: 12px; }
.agree input { margin-top: 4px; flex-shrink: 0; }
.sign-btn { width: 100%; }
.done-card { display: flex; gap: 16px; align-items: center; padding: 18px 22px; margin-bottom: 16px; border: 1px solid #a7e3c4; background: linear-gradient(135deg, #effbf4, #fff); animation: up .5s var(--ease) both; }
.done-card .big { width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; background: var(--grad); color: #fff; font-size: 1.6rem; flex-shrink: 0; animation: pop .6s var(--ease) both; }
.done-card h2 { color: var(--success); }
.done-card p { margin: 4px 0 0; }
.info-card { padding: 14px 18px; margin-bottom: 16px; background: #fff8e8; }
@media (max-width: 860px) { .layout { grid-template-columns: 1fr; } .side { position: static; } }
@media print { .side, .head, .done-card { display: none; } }
</style>
