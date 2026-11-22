<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { fmtDate, fmtDateTime } from '../lib';
import '../../../shared/module.css';
import '../../procurement/procurement.css';
import '../billing.css';

const toast = useToast();
const st = ref<any>(null);
const busy = ref(false);
const otp = ref('');
const resetOpen = ref(false);
const resetReason = ref('');

async function load() {
  try {
    st.value = await api('/billing/zatca');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);

const steps = computed(() => {
  const order = ['none', 'compliance', 'checked', 'production'];
  const at = order.indexOf(st.value?.stage ?? 'none');
  return [
    { n: 1, title: 'رمز التحقق وشهادة الامتثال', text: 'يولّد النظام مفتاح الجمعية وطلب الشهادة، ويرسله للمنصة مع رمز التحقق.', done: at >= 1 },
    { n: 2, title: 'فحوص الامتثال', text: 'ستة مستندات تجريبية موقّعة: فاتورة وإشعار دائن ومدين، للضريبية والمبسطة.', done: at >= 2 },
    { n: 3, title: 'شهادة الإنتاج', text: 'بعدها يوقّع النظام كل فاتورة ضريبية عند إصدارها.', done: at >= 3 },
  ];
});

async function setEnv(env: string) {
  busy.value = true;
  try {
    st.value = await api('/billing/zatca/env', { method: 'PUT', json: { env } });
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}

async function onboard() {
  busy.value = true;
  try {
    st.value = await api('/billing/zatca/onboard', { method: 'POST', json: st.value.stage === 'none' ? { otp: otp.value.trim() } : {} });
    otp.value = '';
    toast.success('اكتمل الربط مع منصة «فاتورة»');
  } catch (e) {
    toast.error((e as Error).message);
    await load();
  } finally {
    busy.value = false;
  }
}

async function reset() {
  busy.value = true;
  try {
    st.value = await api('/billing/zatca/reset', { method: 'POST', json: { reason: resetReason.value } });
    resetOpen.value = false;
    resetReason.value = '';
    toast.success('أُلغي الربط. يمكنك البدء من جديد');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="st">
    <div class="page-head">
      <div>
        <h1>الربط مع منصة «فاتورة»</h1>
        <p class="muted">المرحلة الثانية من الفوترة الإلكترونية: تحصل الجمعية على شهادة من هيئة الزكاة والضريبة والجمارك، فيوقّع النظام كل فاتورة ضريبية عند إصدارها، ويبني ملفها الإلكتروني وسلسلة بصماتها ورمز QR الكامل.</p>
      </div>
    </div>

    <div :class="['pc-check-box', st.stage === 'production' ? 'ok' : 'bad']" style="margin-bottom: 12px">
      {{ st.stage === 'production' ? `✓ ${st.stageLabel} (${st.envLabel})` : st.stageLabel }}
    </div>
    <div v-if="st.problems.length" class="alert alert-error">قبل الربط أكمل: {{ st.problems.join('، ') }}. <RouterLink class="pm-link" to="/billing/settings">إعدادات الفوترة</RouterLink></div>
    <div v-if="st.lastError" class="alert alert-error">{{ st.lastError }}</div>
    <div v-if="st.certificate?.expiringSoon" class="alert" style="background: #fffbeb">تنتهي الشهادة بعد {{ st.certificate.daysLeft }} يومًا. جدّدها بإلغاء الربط ثم البدء من جديد برمز تحقق جديد.</div>

    <div class="pc-grid">
      <section class="card pm-panel">
        <h2>خطوات الربط</h2>
        <ol class="bl-steps">
          <li v-for="s in steps" :key="s.n" :class="{ done: s.done }"><b>{{ s.done ? '✓' : s.n }}</b><div><strong>{{ s.title }}</strong><small class="pm-muted">{{ s.text }}</small></div></li>
        </ol>

        <template v-if="st.stage === 'none'">
          <p class="pc-sec">البيئة</p>
          <div class="pc-check">
            <label v-for="(l, k) in st.envs" :key="k" :class="['bl-mode', { on: st.env === String(k) }]">
              <input type="radio" :checked="st.env === String(k)" :disabled="busy" @change="setEnv(String(k))" /> <span>{{ l }}</span>
            </label>
          </div>
          <p class="pm-muted" style="font-size: .82rem">ابدأ ببيئة المحاكاة للتجربة، ثم ألغِ الربط واربط ببيئة الإنتاج عندما تكون جاهزًا. رمز التحقق يُولَّد من بوابة «فاتورة» للبيئة نفسها، وصلاحيته قصيرة.</p>
          <form class="pc-inline" style="margin-top: 10px" @submit.prevent="onboard">
            <input v-model="otp" class="input" inputmode="numeric" maxlength="6" placeholder="رمز التحقق (OTP)" dir="ltr" required pattern="\d{6}" :disabled="busy || st.problems.length" />
            <button class="btn btn-primary" :disabled="busy || !!st.problems.length">{{ busy ? 'جارٍ الربط…' : 'ابدأ الربط' }}</button>
          </form>
        </template>
        <div v-else-if="st.stage !== 'production'" style="margin-top: 10px">
          <button class="btn btn-primary" :disabled="busy" @click="onboard">{{ busy ? 'جارٍ…' : 'إكمال الخطوات المتبقية' }}</button>
        </div>
        <div v-if="st.stage !== 'none'" style="margin-top: 12px">
          <button class="btn" :disabled="busy" @click="resetOpen = true">إلغاء الربط والبدء من جديد</button>
        </div>
      </section>

      <section class="card pm-panel">
        <h2>الشهادة والسلسلة</h2>
        <dl class="pc-dl" style="grid-template-columns: 1fr">
          <div><dt>البيئة</dt><dd>{{ st.envLabel }}</dd></div>
          <div v-if="st.certificate"><dt>الشهادة</dt><dd>{{ st.certificate.kind === 'production' ? 'شهادة الإنتاج' : 'شهادة الامتثال' }} · تنتهي {{ fmtDate(st.certificate.validTo) }}<small class="pm-muted" style="display: block" dir="ltr">{{ st.certificate.issuer }}</small></dd></div>
          <div v-if="st.egsSerial"><dt>وحدة الإصدار</dt><dd class="pc-code" dir="ltr" style="font-size: .74rem">{{ st.egsSerial }}</dd></div>
          <div><dt>المستندات الموقّعة</dt><dd>{{ st.signed }}</dd></div>
          <div><dt>إرسال المستندات للمنصة</dt><dd>يُفعّل في المرحلة القادمة (التخليص والإبلاغ)</dd></div>
        </dl>
      </section>

      <section v-if="st.checks.length" class="card pm-panel">
        <h2>نتائج فحوص الامتثال</h2>
        <ul class="pc-log">
          <li v-for="c in st.checks" :key="c.label"><span><b :style="{ color: c.ok ? '#047857' : '#b91c1c' }">{{ c.ok ? '✓' : '✕' }}</b> {{ c.label }} <small class="pm-muted">{{ c.status }}</small>
            <div v-for="(m, i) in c.messages" :key="i" class="pm-muted" style="font-size: .78rem" dir="auto">{{ m }}</div></span></li>
        </ul>
      </section>

      <section class="card pm-panel">
        <h2>السجل</h2>
        <p v-if="!st.log.length" class="pc-empty">لا يوجد</p>
        <ul class="pc-log">
          <li v-for="(x, i) in st.log" :key="i"><span><b>{{ x.action }}</b> · {{ x.byName }} <small class="pm-muted">{{ fmtDateTime(x.at) }}</small><div v-if="x.note" class="pm-muted" style="font-size: .78rem">{{ x.note }}</div></span></li>
        </ul>
      </section>
    </div>

    <div v-if="resetOpen" class="modal-backdrop" @click.self="resetOpen = false">
      <form class="card modal" style="max-width: 520px" @submit.prevent="reset">
        <h2>إلغاء الربط والبدء من جديد</h2>
        <p class="pm-muted" style="font-size: .86rem">تُحذف شهادة الجمعية ومفتاحها من النظام، وتُصدر الفواتير بعدها دون توقيع حتى يكتمل الربط من جديد. سلسلة البصمات تستمر من آخر مستند موقّع.</p>
        <label class="field"><span>السبب</span><input v-model="resetReason" class="input" required minlength="3" maxlength="500" placeholder="مثل: تجديد الشهادة، أو الانتقال لبيئة الإنتاج" /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">تأكيد</button><button type="button" class="btn" @click="resetOpen = false">رجوع</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.bl-steps { list-style: none; padding: 0; margin: 0 0 8px; display: grid; gap: 10px; }
.bl-steps li { display: flex; gap: 10px; align-items: flex-start; }
.bl-steps li > b { flex: 0 0 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--surface-2); border: 1px solid var(--border); font-size: .85rem; }
.bl-steps li.done > b { background: #059669; color: #fff; border-color: #059669; }
.bl-steps li div { display: grid; gap: 2px; }
.bl-mode { display: flex; gap: 8px; align-items: center; padding: 9px 12px; border: 1px solid var(--border); border-radius: 12px; cursor: pointer; }
.bl-mode.on { border-color: var(--primary); background: var(--surface-2); }
</style>
