<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { useToast } from '../../../stores/toast';
import { addressPayload, billingLookups, emptyAddress, fmtDateTime } from '../lib';
import '../../projects/projects.css';
import '../../procurement/procurement.css';
import '../billing.css';

const toast = useToast();
const lk = ref<any>(null);
const tab = ref<'general' | 'accounts' | 'permissions'>('general');
const busy = ref(false);
const f = ref<any>(null);
function fill(l: any) {
  const s = l.settings;
  f.value = {
    mode: s.mode === 'integrated' ? 'registered' : s.mode, sellerName: s.sellerName ?? '', sellerNameEn: s.sellerNameEn ?? '', vatNumber: s.vatNumber ?? '', idType: s.idType ?? '', idNumber: s.idNumber ?? '',
    address: { ...emptyAddress(), ...(s.address ?? {}) }, vatRate: s.vatRate, receivablesAccountId: s.receivablesAccountId ?? '', vatOutputAccountId: s.vatOutputAccountId ?? '',
    revenueAccountId: s.revenueAccountId ?? '', customerCategoryId: s.customerCategoryId ?? '', analyticId: s.analyticId ?? '', paymentDays: s.paymentDays, terms: s.terms ?? '',
  };
}
onMounted(async () => {
  try {
    lk.value = await billingLookups(true);
    fill(lk.value);
  } catch (e) {
    toast.error((e as Error).message);
  }
});
const accounts = (nature: string) => (lk.value?.accounts ?? []).filter((a: any) => a.nature === nature);
const registered = computed(() => f.value?.mode === 'registered');
const sellerIdTypes = computed(() => Object.fromEntries((lk.value?.sellerIdTypes ?? []).map((k: string) => [k, lk.value.idTypes[k]])));
async function save() {
  busy.value = true;
  try {
    const x = f.value;
    const r = await api<any>('/billing/settings', {
      method: 'PUT',
      json: {
        mode: x.mode, sellerName: x.sellerName || null, sellerNameEn: x.sellerNameEn || null, vatNumber: x.vatNumber || null, idType: x.idType || null, idNumber: x.idNumber || null,
        address: addressPayload(x.address), vatRate: Number(x.vatRate), receivablesAccountId: x.receivablesAccountId || null, vatOutputAccountId: x.vatOutputAccountId || null,
        revenueAccountId: x.revenueAccountId || null, customerCategoryId: x.customerCategoryId || null, analyticId: x.analyticId || null, paymentDays: Number(x.paymentDays), terms: x.terms || null,
      },
    });
    lk.value = r;
    fill(r);
    await billingLookups(true);
    toast.success('حُفظت إعدادات الفوترة');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="lk && f">
    <div class="page-head">
      <div>
        <h1>إعدادات الفوترة والمبيعات</h1>
        <p class="muted">النظام اختياري لكل جمعية. اختر وضع الجمعية الضريبي، وأكمل بياناتها كما في شهادة التسجيل، وحدد حسابات القيود في الدليل.</p>
      </div>
    </div>
    <div :class="['pc-check-box', lk.readiness.ready ? 'ok' : 'bad']" style="margin-bottom: 12px">
      {{ lk.readiness.ready ? '✓ النظام جاهز لإصدار الفواتير' : `ينقص لإصدار الفواتير: ${lk.readiness.missing.join('، ')}` }}
    </div>
    <div v-if="lk.settings.mode === 'integrated'" class="alert alert-info">الجمعية مربوطة مع منصة «فاتورة»، فتُعدّل بياناتها الضريبية من شاشة الربط.</div>
    <div class="pc-tabs">
      <button :class="{ on: tab === 'general' }" @click="tab = 'general'">الجمعية والضريبة</button>
      <button :class="{ on: tab === 'accounts' }" @click="tab = 'accounts'">الربط المالي</button>
      <button :class="{ on: tab === 'permissions' }" @click="tab = 'permissions'">الصلاحيات</button>
    </div>
    <form v-if="tab !== 'permissions'" class="card pm-panel" @submit.prevent="save">
      <template v-if="tab === 'general'">
        <p class="pc-sec">وضع الجمعية</p>
        <div class="pc-check">
          <label v-for="(l, k) in lk.modes" :key="k" :class="['bl-mode', { on: f.mode === String(k), off: String(k) === 'integrated' }]">
            <input v-model="f.mode" type="radio" :value="String(k)" :disabled="String(k) === 'integrated'" /> <span>{{ l }}</span>
            <small v-if="String(k) === 'integrated'" class="pm-muted">يُفعّل بعد اكتمال الربط (المرحلة الثانية)</small>
          </label>
        </div>
        <p class="pc-sec">بيانات الجمعية في الفاتورة</p>
        <div class="pc-fields">
          <label class="field"><span>الاسم كما في السجل الضريبي</span><input v-model="f.sellerName" class="input" maxlength="250" /></label>
          <label class="field"><span>الاسم بالإنجليزية (اختياري)</span><input v-model="f.sellerNameEn" class="input" maxlength="250" dir="ltr" /></label>
          <label class="field"><span>الرقم الضريبي</span><input v-model="f.vatNumber" class="input" maxlength="20" dir="ltr" placeholder="3xxxxxxxxxxxxx3" :required="registered" /></label>
          <label class="field"><span>نسبة الضريبة الأساسية %</span><input v-model.number="f.vatRate" type="number" min="0" max="100" step="any" class="input" required /></label>
          <label class="field"><span>المعرّف الآخر</span><select v-model="f.idType" class="input"><option value="">—</option><option v-for="(l, k) in sellerIdTypes" :key="k" :value="k">{{ l }}</option></select></label>
          <label class="field"><span>رقم المعرّف</span><input v-model="f.idNumber" class="input" maxlength="40" dir="ltr" /></label>
        </div>
        <p class="pc-sec">العنوان الوطني للجمعية</p>
        <div class="pc-fields">
          <label class="field"><span>رقم المبنى</span><input v-model="f.address.buildingNo" class="input" maxlength="4" dir="ltr" /></label>
          <label class="field"><span>الشارع</span><input v-model="f.address.street" class="input" maxlength="200" /></label>
          <label class="field"><span>الحي</span><input v-model="f.address.district" class="input" maxlength="120" /></label>
          <label class="field"><span>المدينة</span><input v-model="f.address.city" class="input" maxlength="120" /></label>
          <label class="field"><span>الرمز البريدي</span><input v-model="f.address.postalCode" class="input" maxlength="5" dir="ltr" /></label>
          <label class="field"><span>الرقم الإضافي</span><input v-model="f.address.additionalNo" class="input" maxlength="4" dir="ltr" /></label>
        </div>
        <p class="pc-sec">الفوترة</p>
        <div class="pc-fields">
          <label class="field"><span>مدة السداد الافتراضية (يوم)</span><input v-model.number="f.paymentDays" type="number" min="0" max="365" class="input" required /></label>
          <label class="field wide"><span>شروط تظهر أسفل الفاتورة</span><textarea v-model="f.terms" class="input" rows="2" maxlength="2000" /></label>
        </div>
      </template>
      <template v-else>
        <p class="pm-muted" style="font-size: .86rem">قيد كل فاتورة صادرة: مدين حساب العملاء بالإجمالي، ودائن حساب الإيراد (أو حساب الصنف) وحساب ضريبة المخرجات. والإشعار الدائن عكسه. والتحصيل بسند قبض: مدين البنك أو الصندوق، ودائن حساب العملاء.</p>
        <div class="pc-fields">
          <label class="field"><span>حساب العملاء (الذمم المدينة)</span><select v-model="f.receivablesAccountId" class="input"><option value="">اختر…</option><option v-for="a in accounts('assets')" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select></label>
          <label class="field"><span>حساب ضريبة القيمة المضافة (المخرجات)</span><select v-model="f.vatOutputAccountId" class="input"><option value="">اختر…</option><option v-for="a in accounts('liabilities')" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select></label>
          <label class="field"><span>حساب الإيراد الافتراضي</span><select v-model="f.revenueAccountId" class="input"><option value="">اختر…</option><option v-for="a in accounts('revenue')" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select></label>
          <label class="field"><span>تصنيف العملاء في الشركاء</span><select v-model="f.customerCategoryId" class="input"><option value="">بلا حساب شريك</option><option v-for="c in lk.partnerCategories" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
          <label v-if="lk.analytics.length" class="field"><span>مركز التكلفة الافتراضي للإيراد</span><select v-model="f.analyticId" class="input"><option value="">—</option><option v-for="a in lk.analytics" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select></label>
        </div>
      </template>
      <div class="modal-actions" style="justify-content: flex-start"><button class="btn btn-primary" :disabled="busy || lk.settings.mode === 'integrated'">حفظ</button></div>
      <details v-if="lk.settings.log?.length" style="margin-top: 12px">
        <summary class="pm-muted">سجل التعديلات</summary>
        <ul class="pc-log" style="margin-top: 8px">
          <li v-for="(x, i) in [...lk.settings.log].reverse().slice(0, 30)" :key="i"><span><b>{{ x.action }}</b> · {{ x.byName }} <small class="pm-muted">{{ fmtDateTime(x.at) }}</small><div v-if="x.note" class="pm-muted" style="font-size: .78rem">{{ x.note }}</div></span></li>
        </ul>
      </details>
    </form>
    <ModulePermissionsPane v-else module="billing" />
  </div>
</template>

<style scoped>
.bl-mode { display: flex; gap: 8px; align-items: center; padding: 9px 12px; border: 1px solid var(--border); border-radius: 12px; cursor: pointer; }
.bl-mode.on { border-color: var(--primary); background: var(--surface-2); }
.bl-mode.off { opacity: .6; cursor: not-allowed; }
.bl-mode small { margin-inline-start: auto; }
</style>
