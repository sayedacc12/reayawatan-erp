<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { fmtDate, sar } from '../lib';
import MemShell from './MemShell.vue';
import '../../../shared/module.css';
import '../members.css';

interface Info {
  orgName: string; slug: string; invoiceNo: string; kind: string; kindLabel: string; partyName: string; typeName: string; items: { label: string; amount: number }[];
  amount: number; dueDate: string; status: string; statusLabel: string; paidOn: string | null; periodStart: string | null; periodEnd: string | null; method: string | null;
  note: string | null; methods: { online: boolean; transfer: boolean; cash: boolean }; provider: string;
  bank: { bankName: string | null; accountName: string | null; iban: string | null } | null; transferSubmitted: { reference: string | null; at: string | null } | null;
}
const route = useRoute();
const router = useRouter();
const t = route.params.token as string;
const info = ref<Info | null>(null);
const error = ref('');
const busy = ref(false);
const way = ref<'online' | 'transfer' | 'cash'>('online');
const sandboxRef = ref<string | null>((route.query.sandbox as string) ?? null);
const card = ref({ number: '4111 1111 1111 1111', name: '', exp: '12/30', cvc: '123' });

async function load() {
  try {
    if (route.query.check) {
      info.value = await api<Info>(`/public/members/pay/${t}/verify`, { method: 'POST' });
      router.replace({ query: {} });
    } else {
      info.value = await api<Info>(`/public/members/pay/${t}`);
    }
    if (info.value && !info.value.methods.online) way.value = info.value.methods.transfer ? 'transfer' : 'cash';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
async function payOnline() {
  busy.value = true;
  error.value = '';
  try {
    const r = await api<{ url: string; provider: string }>(`/public/members/pay/${t}/online`, { method: 'POST' });
    if (r.provider === 'sandbox') {
      sandboxRef.value = new URL(r.url).searchParams.get('sandbox');
      card.value.name = info.value?.partyName ?? '';
    } else {
      window.location.href = r.url;
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function confirmSandbox() {
  busy.value = true;
  error.value = '';
  try {
    await new Promise((r) => setTimeout(r, 900));
    info.value = await api<Info>(`/public/members/pay/${t}/sandbox`, { method: 'POST', json: { ref: sandboxRef.value } });
    sandboxRef.value = null;
    router.replace({ query: {} });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const receipt = ref<File | null>(null);
const reference = ref('');
async function sendTransfer() {
  if (!receipt.value) return (error.value = 'أرفق صورة إيصال التحويل');
  busy.value = true;
  error.value = '';
  try {
    const fd = new FormData();
    fd.append('receipt', receipt.value);
    if (reference.value) fd.append('reference', reference.value);
    info.value = await api<Info>(`/public/members/pay/${t}/transfer`, { method: 'POST', body: fd });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <MemShell :org="info?.orgName">
    <div v-if="error" class="alert alert-error" style="margin-top: 16px">{{ error }}</div>
    <template v-if="info">
      <section class="card bill">
        <div class="head">
          <div><p class="pm-muted" style="margin: 0">{{ info.kindLabel }}</p><h1>{{ sar(info.amount) }}</h1><p class="pm-muted" style="margin: 0">مطالبة {{ info.invoiceNo }} · {{ info.partyName }} · {{ info.typeName }}</p></div>
          <span :class="['st', info.status]">{{ info.statusLabel }}</span>
        </div>
        <table class="items"><tbody><tr v-for="(x, i) in info.items" :key="i"><td>{{ x.label }}</td><td>{{ sar(x.amount) }}</td></tr></tbody></table>
        <p v-if="info.status === 'unpaid'" class="pm-muted">آخر موعد للسداد {{ fmtDate(info.dueDate) }}</p>

        <Transition name="page" mode="out-in">
          <div v-if="info.status === 'paid'" key="paid" class="done">
            <div class="check">✓</div>
            <h2>تم السداد بنجاح</h2>
            <p>شكرًا لك. العضوية سارية من {{ fmtDate(info.periodStart) }} إلى {{ fmtDate(info.periodEnd) }}.</p>
            <RouterLink :to="`/m/${info.slug}?tab=member`" class="btn btn-primary">عرض عضويتي وبطاقتي</RouterLink>
          </div>
          <div v-else-if="info.status === 'review'" key="rev" class="done">
            <div class="check wait">⏳</div>
            <h2>وصل إيصال التحويل</h2>
            <p>ستؤكده الشركة بعد مطابقته مع كشف الحساب، ثم تُفعَّل العضوية.</p>
          </div>
          <div v-else-if="info.status === 'cancelled'" key="c" class="done"><h2>المطالبة ملغاة</h2></div>
          <div v-else-if="sandboxRef" key="sbx" class="sandbox">
            <div class="pm-tag" style="background: #fef3c7; color: #92400e">بيئة دفع تجريبية: لا يُخصم أي مبلغ حقيقي</div>
            <div class="fake-card">
              <span>{{ card.number }}</span>
              <div><small>حامل البطاقة</small><b>{{ card.name || '—' }}</b></div>
            </div>
            <div class="pm-grid2">
              <label class="field"><span>رقم البطاقة</span><input v-model="card.number" class="input" dir="ltr" /></label>
              <label class="field"><span>الاسم على البطاقة</span><input v-model="card.name" class="input" dir="ltr" /></label>
              <label class="field"><span>تاريخ الانتهاء</span><input v-model="card.exp" class="input" dir="ltr" /></label>
              <label class="field"><span>رمز التحقق</span><input v-model="card.cvc" class="input" dir="ltr" maxlength="4" /></label>
            </div>
            <button class="btn btn-primary go" :disabled="busy" @click="confirmSandbox">{{ busy ? 'جارٍ تنفيذ الدفع...' : `ادفع ${sar(info.amount)}` }}</button>
            <button class="btn" style="width: 100%; margin-top: 6px" @click="sandboxRef = null">رجوع</button>
          </div>
          <div v-else key="pay">
            <div v-if="info.note" class="alert alert-error">{{ info.note }}</div>
            <div class="ways">
              <button v-if="info.methods.online" :class="{ on: way === 'online' }" @click="way = 'online'">💳 دفع إلكتروني<small>مدى، فيزا، ماستركارد، Apple Pay</small></button>
              <button v-if="info.methods.transfer" :class="{ on: way === 'transfer' }" @click="way = 'transfer'">🏦 تحويل بنكي<small>ورفع صورة الإيصال</small></button>
              <button v-if="info.methods.cash" :class="{ on: way === 'cash' }" @click="way = 'cash'">🏢 في مقر الشركة<small>نقدًا أو بالشبكة</small></button>
            </div>
            <div v-if="way === 'online'">
              <button class="btn btn-primary go" :disabled="busy" @click="payOnline">ادفع الآن {{ sar(info.amount) }}</button>
              <p class="pm-muted" style="text-align: center">{{ info.provider === 'sandbox' ? 'البوابة في وضع التجربة حاليًا' : 'ستنتقل لصفحة الدفع الآمنة ثم تعود هنا تلقائيًا' }}</p>
            </div>
            <div v-else-if="way === 'transfer' && info.bank">
              <div class="bank">
                <p><span>البنك</span><b>{{ info.bank.bankName ?? '—' }}</b></p>
                <p><span>اسم الحساب</span><b>{{ info.bank.accountName ?? info.orgName }}</b></p>
                <p><span>الآيبان</span><b class="mb-code">{{ info.bank.iban }}</b></p>
                <p><span>المبلغ</span><b>{{ sar(info.amount) }}</b></p>
              </div>
              <label class="field"><span>رقم الحوالة أو المرجع (اختياري)</span><input v-model="reference" class="input" dir="ltr" /></label>
              <label class="field"><span>صورة إيصال التحويل *</span><input type="file" class="input" accept="image/jpeg,image/png,application/pdf" @change="receipt = ($event.target as HTMLInputElement).files?.[0] ?? null" /></label>
              <button class="btn btn-primary go" :disabled="busy" @click="sendTransfer">إرسال الإيصال</button>
            </div>
            <div v-else-if="way === 'cash'" class="bank"><p>تفضل بزيارة مقر الشركة وذكر رقم المطالبة <b class="mb-code">{{ info.invoiceNo }}</b>، وسيُسجل الموظف السداد وتُفعّل العضوية فورًا.</p></div>
          </div>
        </Transition>
      </section>
    </template>
  </MemShell>
</template>

<style scoped>
.bill { margin-top: 18px; padding: 22px; border-radius: 20px; animation: pm-rise .5s var(--ease) both; }
.head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.head h1 { margin: 2px 0; font-size: 2.1rem; background: linear-gradient(90deg, #164e38, #1e3a8a); -webkit-background-clip: text; background-clip: text; color: transparent; }
.st { border-radius: 999px; padding: 3px 12px; font-size: .8rem; font-weight: 700; background: #fef3c7; color: #92400e; white-space: nowrap; }
.st.paid { background: #d1fae5; color: #065f46; }
.st.review { background: #dbeafe; color: #1e40af; }
.items { width: 100%; margin: 14px 0 6px; border-collapse: collapse; font-size: .9rem; }
.items td { padding: 7px 0; border-bottom: 1px dashed var(--border); }
.items td:last-child { text-align: end; font-weight: 700; }
.ways { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin: 14px 0; }
.ways button { font: inherit; font-weight: 700; padding: 12px; border-radius: 14px; border: 1.5px solid var(--border); background: var(--surface); cursor: pointer; transition: all .2s; }
.ways button small { display: block; font-weight: 500; color: var(--muted); font-size: .74rem; margin-top: 2px; }
.ways button.on { border-color: #164e38; background: #f0fdfa; box-shadow: 0 0 0 3px rgba(15,118,110,.15); }
.go { width: 100%; margin-top: 10px; min-height: 48px; font-size: 1.05rem; }
.bank { background: var(--surface-2); border-radius: 14px; padding: 12px 16px; margin-bottom: 10px; }
.bank p { display: flex; justify-content: space-between; gap: 10px; margin: 6px 0; }
.bank span { color: var(--muted); }
.done { text-align: center; padding: 18px 0 4px; }
.check { width: 74px; height: 74px; margin: 0 auto 10px; border-radius: 50%; display: grid; place-items: center; font-size: 2.2rem; color: #fff; background: linear-gradient(135deg, #10b981, #164e38); animation: pop .6s var(--ease) both; box-shadow: 0 0 0 10px rgba(16,185,129,.15); }
.check.wait { background: linear-gradient(135deg, #60a5fa, #1e3a8a); box-shadow: 0 0 0 10px rgba(59,130,246,.15); }
.sandbox { margin-top: 12px; }
.fake-card { margin: 12px auto; max-width: 340px; aspect-ratio: 1.586; border-radius: 16px; padding: 18px; color: #fff; display: flex; flex-direction: column; justify-content: space-between;
  background: linear-gradient(135deg, #1e3a8a, #164e38); box-shadow: 0 14px 30px rgba(30,58,138,.3); direction: ltr; font-family: ui-monospace, monospace; font-size: 1.1rem; letter-spacing: 2px; }
.fake-card small { display: block; font-size: .65rem; opacity: .7; letter-spacing: 0; }
.fake-card b { letter-spacing: 0; font-size: .9rem; }
@keyframes pop { from { transform: scale(.4); opacity: 0; } }
</style>
