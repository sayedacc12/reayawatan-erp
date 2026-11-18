<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { useToast } from '../../../stores/toast';
import { copy, errMsg, siteUrl } from '../lib';
import '../website.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const toast = useToast();
type Tab = 'general' | 'store' | 'payment' | 'accounting' | 'permissions';
const tab = ref<Tab>('general');
const TABS: [Tab, string][] = [['general', 'عام والنشر'], ['store', 'المتجر'], ['payment', 'بوابة الدفع'], ['accounting', 'الربط المالي'], ['permissions', 'الصلاحيات']];
const SECTIONS: Record<string, string> = {
  about: 'من نحن', programs: 'البرامج', news: 'الأخبار', governance: 'الحوكمة والشفافية', partners: 'الشركاء', contact: 'تواصل معنا', store: 'المتجر والتبرع',
  volunteer: 'رابط التطوع', membership: 'رابط العضوية', portal: 'رابط بوابة المستفيدين',
};
const s = ref<any>(null);
const presets = ref('');
const pay = reactive({ provider: 'sandbox', publishableKey: '', secretKey: '', clearSecret: false });
const busy = ref(false);

function fill(r: any) {
  s.value = r;
  presets.value = (r.store.presets ?? []).join('، ');
  Object.assign(pay, { provider: r.payment.provider, publishableKey: r.payment.publishableKey ?? '', secretKey: '', clearSecret: false });
}
onMounted(async () => {
  try {
    fill(await api('/website/settings'));
  } catch (e) {
    toast.error(errMsg(e));
  }
});
async function save(section: Exclude<Tab, 'permissions'>, extra: Record<string, unknown> = {}) {
  busy.value = true;
  try {
    let data: Record<string, unknown>;
    if (section === 'general') data = { published: s.value.published, sections: s.value.sections, seo: s.value.seo, footerText: s.value.footerText ?? '', customDomain: s.value.customDomain ?? '', ...extra };
    else if (section === 'store') data = { ...s.value.store, presets: presets.value.split(/[،,\s]+/).map(Number).filter((x) => x > 0) };
    else if (section === 'payment') data = { ...pay };
    else data = { ...s.value.accounting };
    fill(await api(`/website/settings/${section}`, { method: 'PUT', json: { data } }));
    toast.success('حُفظت الإعدادات');
  } catch (e) {
    toast.error(errMsg(e));
  } finally {
    busy.value = false;
  }
}
const link = computed(() => (s.value ? siteUrl(s.value.slug) : ''));
const previewLink = computed(() => (s.value ? siteUrl(s.value.slug, '', s.value.previewKey) : ''));
async function copyText(t: string) {
  if (await copy(t)) toast.success('نُسخ الرابط');
}
const revenue = computed(() => (s.value?.accounts ?? []).filter((a: any) => a.nature === 'revenue'));
</script>

<template>
  <div v-if="s">
    <div class="page-head"><div><h1>إعدادات الموقع الإلكتروني</h1><p class="muted">النشر والأقسام والمتجر وبوابة الدفع والربط مع النظام المالي، وصلاحيات فريق الموقع.</p></div></div>
    <div class="ws-tabs"><button v-for="[k, l] in TABS" :key="k" :class="['ws-tab', { on: tab === k }]" @click="tab = k">{{ l }}</button></div>

    <template v-if="tab === 'general'">
      <section class="card ws-panel">
        <h2>النشر</h2>
        <label class="st-switch"><input v-model="s.published" type="checkbox" /><span class="st-track"><i /></span><strong>{{ s.published ? 'الموقع منشور ويراه الجميع' : 'الموقع غير منشور (يراه من معه رابط المعاينة فقط)' }}</strong></label>
        <div class="ws-row"><span class="muted">رابط الموقع:</span><span class="ws-code">{{ link }}</span><button class="btn btn-sm" @click="copyText(link)">نسخ</button></div>
        <div class="ws-row"><span class="muted">رابط المعاينة:</span><span class="ws-code" style="max-width: 420px; overflow: hidden; text-overflow: ellipsis">{{ previewLink }}</span><button class="btn btn-sm" @click="copyText(previewLink)">نسخ</button><button class="btn btn-sm" @click="save('general', { newPreviewKey: true })">تغيير رابط المعاينة</button></div>
        <label class="field"><span>النطاق الخاص (اختياري)</span><input v-model="s.customDomain" class="input" dir="ltr" placeholder="www.example.org.sa" /><small class="muted">يربطه فريق المنصة بالخادم بعد توجيه سجل DNS للنطاق.</small></label>
      </section>
      <section class="card ws-panel">
        <h2>أقسام الموقع</h2>
        <p class="ws-muted">القسم المخفي يختفي من القائمة والصفحة الرئيسية.</p>
        <div class="ws-grid3"><label v-for="(l, k) in SECTIONS" :key="k" class="check"><input v-model="s.sections[k]" type="checkbox" /> {{ l }}</label></div>
      </section>
      <section class="card ws-panel">
        <h2>محركات البحث والتذييل</h2>
        <label class="field"><span>عنوان الموقع في محركات البحث</span><input v-model="s.seo.title" class="input" /></label>
        <label class="field"><span>الوصف</span><textarea v-model="s.seo.description" class="input" rows="2" /></label>
        <label class="field"><span>الكلمات المفتاحية</span><input v-model="s.seo.keywords" class="input" /></label>
        <label class="field"><span>نص التذييل</span><textarea v-model="s.footerText" class="input" rows="2" /></label>
      </section>
      <div class="ws-actions"><button class="btn btn-primary" :disabled="busy" @click="save('general')">حفظ</button></div>
    </template>

    <template v-else-if="tab === 'store'">
      <section class="card ws-panel">
        <h2>المتجر</h2>
        <label class="check"><input v-model="s.store.enabled" type="checkbox" /> <strong>استقبال التبرعات من الموقع</strong></label>
        <label class="check"><input v-model="s.store.general" type="checkbox" /> التبرع العام غير المقيد (بدون برنامج محدد)</label>
        <label v-if="s.store.general" class="field"><span>اسم التبرع العام</span><input v-model="s.store.generalTitle" class="input" /></label>
        <div class="ws-grid3">
          <label class="field"><span>أقل مبلغ (ريال)</span><input v-model.number="s.store.min" type="number" min="1" class="input" /></label>
          <label class="field"><span>أعلى مبلغ (ريال)</span><input v-model.number="s.store.max" type="number" min="1" class="input" /></label>
          <label class="field"><span>مبالغ مقترحة</span><input v-model="presets" class="input" placeholder="50، 100، 200" /></label>
        </div>
        <label class="check"><input v-model="s.store.monthly" type="checkbox" /> السماح بالتبرع الشهري</label>
        <label class="check"><input v-model="s.store.gift" type="checkbox" /> السماح بالإهداء (بطاقة إهداء باسم شخص آخر)</label>
        <label class="field"><span>رسالة الشكر بعد الدفع</span><textarea v-model="s.store.thanks" class="input" rows="2" /></label>
        <label class="field"><span>ملاحظة في الإيصال (مثل رقم الترخيص)</span><textarea v-model="s.store.receiptNote" class="input" rows="2" /></label>
      </section>
      <div class="ws-actions"><button class="btn btn-primary" :disabled="busy" @click="save('store')">حفظ</button></div>
    </template>

    <template v-else-if="tab === 'payment'">
      <section class="card ws-panel">
        <h2>بوابة الدفع</h2>
        <div class="st-gw">
          <label :class="['st-gw-opt', { on: pay.provider === 'sandbox' }]"><input v-model="pay.provider" type="radio" value="sandbox" hidden /><strong>البيئة التجريبية</strong><small>لتجربة المتجر بدون مال حقيقي.</small></label>
          <label :class="['st-gw-opt', { on: pay.provider === 'moyasar' }]"><input v-model="pay.provider" type="radio" value="moyasar" hidden /><strong>ميسر (Moyasar)</strong><small>مدى وفيزا وماستركارد وApple Pay، والمبالغ تصل لحساب الجمعية.</small></label>
        </div>
        <template v-if="pay.provider === 'moyasar'">
          <label class="field"><span>المفتاح العام (Publishable key)</span><input v-model="pay.publishableKey" class="input" dir="ltr" placeholder="pk_live_..." /></label>
          <label class="field"><span>المفتاح السري (Secret key)</span><input v-model="pay.secretKey" type="password" class="input" dir="ltr" :placeholder="s.payment.hasSecretKey ? 'محفوظ. اكتب مفتاحًا جديدًا لتغييره' : 'sk_live_...'" autocomplete="off" /></label>
          <label v-if="s.payment.hasSecretKey" class="check"><input v-model="pay.clearSecret" type="checkbox" /> حذف المفتاح السري المحفوظ</label>
          <p class="ws-muted">تجد المفاتيح في لوحة ميسر ← الإعدادات ← مفاتيح API. المفتاح السري لا يظهر بعد حفظه.</p>
        </template>
      </section>
      <div class="ws-actions"><button class="btn btn-primary" :disabled="busy" @click="save('payment')">حفظ</button></div>
    </template>

    <template v-else-if="tab === 'accounting'">
      <section class="card ws-panel">
        <h2>الربط مع النظام المالي</h2>
        <p class="ws-muted">كل تبرع مدفوع يصدر له سند قبض مسودة في النظام المالي تلقائيًا: مدين حساب التحصيل، ودائن حساب الإيراد. ولكل برنامج حساب إيراد خاص يحدده المعتمد، وإلا استُخدم الحساب العام هنا.</p>
        <label class="field"><span>حساب التحصيل (البنك أو الصندوق الذي تصل إليه مبالغ بوابة الدفع)</span><select v-model="s.accounting.onlineCashAccountId" class="input"><option :value="null">اختر</option><option v-for="c in s.cashAccounts" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
        <label class="field"><span>حساب إيراد التبرعات العامة والمشاريع</span><select v-model="s.accounting.generalRevenueAccountId" class="input"><option :value="null">اختر</option><option v-for="a in revenue" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select></label>
        <label class="field"><span>حساب إيراد التبرعات الوقفية</span><select v-model="s.accounting.waqfRevenueAccountId" class="input"><option :value="null">اختر</option><option v-for="a in s.accounts" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select></label>
      </section>
      <div class="ws-actions"><button class="btn btn-primary" :disabled="busy" @click="save('accounting')">حفظ</button></div>
    </template>

    <ModulePermissionsPane v-else module="website" />
  </div>
</template>

<style scoped>
.st-switch { display: flex; align-items: center; gap: 12px; cursor: pointer; margin-bottom: 10px; }
.st-switch input { display: none; }
.st-track { width: 48px; height: 26px; border-radius: 999px; background: var(--border); position: relative; transition: background .25s; flex-shrink: 0; }
.st-track i { position: absolute; top: 3px; inset-inline-start: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.2); transition: transform .25s var(--ease); }
.st-switch input:checked + .st-track { background: #10b981; box-shadow: 0 0 14px rgba(16,185,129,.45); }
.st-switch input:checked + .st-track i { transform: translateX(-22px); }
.st-gw { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-bottom: 10px; }
.st-gw-opt { border: 2px solid var(--border); border-radius: 12px; padding: 14px; cursor: pointer; display: grid; gap: 4px; transition: border-color .2s, box-shadow .2s; }
.st-gw-opt.on { border-color: var(--primary); box-shadow: 0 0 0 4px var(--primary-soft); }
.st-gw-opt small { color: var(--muted); }
</style>
