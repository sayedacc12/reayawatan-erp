<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { copyText } from '../labels';
import '../platform.css';

interface Contact { whatsapp: string | null; whatsappMessage: string | null; email: string | null; phone: string | null; address: string | null }
const toast = useToast();
const form = reactive({ whatsapp: '', whatsappMessage: '', email: '', phone: '', address: '' });
const error = ref('');
const busy = ref(false);

onMounted(async () => {
  try {
    const c = await api<Contact>('/platform/site/contact');
    Object.assign(form, { whatsapp: c.whatsapp ?? '', whatsappMessage: c.whatsappMessage ?? '', email: c.email ?? '', phone: c.phone ?? '', address: c.address ?? '' });
  } catch (e) {
    error.value = (e as Error).message;
  }
});

// الرقم السعودي المحلي يتحول تلقائيًا للصيغة الدولية
const waDigits = computed(() => {
  const d = form.whatsapp.replace(/[٠-٩]/g, (x) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/[^\d]/g, '');
  return /^05\d{8}$/.test(d) ? `966${d.slice(1)}` : d.replace(/^00/, '');
});
const waLink = computed(() => (waDigits.value ? `https://wa.me/${waDigits.value}${form.whatsappMessage ? `?text=${encodeURIComponent(form.whatsappMessage)}` : ''}` : ''));

async function save() {
  busy.value = true;
  error.value = '';
  try {
    const c = await api<Contact>('/platform/site/contact', { method: 'PUT', json: { ...form, whatsapp: waDigits.value } });
    form.whatsapp = c.whatsapp ?? '';
    toast.success('تم الحفظ، وظهرت البيانات في الصفحة الرئيسية');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

const links = [
  { label: 'الصفحة التعريفية (الرئيسية)', url: `${location.origin}/` },
  { label: 'تسجيل جمعية جديدة', url: `${location.origin}/register` },
  { label: 'دخول إدارة المنصة', url: `${location.origin}/login` },
];
const copy = (u: string) => { copyText(u); toast.success('تم نسخ الرابط'); };
</script>

<template>
  <div>
    <section class="p-hero">
      <div>
        <p class="p-kicker">إدارة المنصة</p>
        <h1>إعدادات المنصة</h1>
        <p class="p-sub">بيانات التواصل التي تظهر في الصفحة الرئيسية لسنابل: رقم واتساب وزره العائم، والبريد، والهاتف. تُدار من هنا بصلاحيات مدير المنصة نفسها.</p>
      </div>
      <a class="btn btn-ghost-light" href="/?site" target="_blank" rel="noopener">معاينة الصفحة الرئيسية</a>
    </section>

    <div class="p-grid">
      <section class="card p-panel">
        <h2>التواصل وواتساب</h2>
        <div v-if="error" class="alert alert-error">{{ error }}</div>
        <form @submit.prevent="save">
          <div class="field">
            <label>رقم واتساب</label>
            <input v-model="form.whatsapp" class="input" dir="ltr" inputmode="tel" placeholder="9665xxxxxxxx أو 05xxxxxxxx" />
            <small class="muted">اتركه فارغًا لإخفاء المحادثة المباشرة، وعندها يفتح زر واتساب نموذج الطلب.</small>
          </div>
          <div class="field">
            <label>رسالة البداية في واتساب</label>
            <input v-model="form.whatsappMessage" class="input" maxlength="300" />
          </div>
          <div class="field"><label>البريد الإلكتروني</label><input v-model="form.email" class="input" dir="ltr" type="email" placeholder="info@sanabelerp.com" /></div>
          <div class="field"><label>رقم الهاتف <small class="muted">(اختياري)</small></label><input v-model="form.phone" class="input" dir="ltr" inputmode="tel" /></div>
          <div class="field"><label>العنوان <small class="muted">(اختياري)</small></label><input v-model="form.address" class="input" maxlength="200" /></div>
          <div class="actions">
            <button class="btn btn-primary" :disabled="busy">حفظ</button>
            <a v-if="waLink" class="btn wa" :href="waLink" target="_blank" rel="noopener">تجربة رابط واتساب</a>
          </div>
        </form>
      </section>

      <section class="card p-panel">
        <h2>روابط المنصة</h2>
        <div v-for="l in links" :key="l.url" class="link-row">
          <span>{{ l.label }}</span>
          <div class="p-link-box"><code>{{ l.url }}</code><button class="btn btn-sm" type="button" @click="copy(l.url)">نسخ</button></div>
        </div>
        <h2 style="margin-top: 20px">إعدادات أخرى</h2>
        <RouterLink class="more" to="/platform/mail">البريد الإلكتروني: الإعدادات والرسالة التجريبية وسجل الرسائل ←</RouterLink>
        <RouterLink class="more" to="/platform/inquiries">طلبات الخدمات الواردة من الصفحة الرئيسية ←</RouterLink>
        <RouterLink class="more" to="/platform/contract-clauses">بيانات مقدم الخدمة وبنود العقد ←</RouterLink>
      </section>
    </div>
  </div>
</template>

<style scoped>
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.btn.wa { background: linear-gradient(135deg, #25d366, #128c7e); color: #fff; border-color: transparent; }
.link-row { margin-bottom: 12px; }
.link-row > span { display: block; font-size: 0.88rem; color: var(--muted); margin-bottom: 4px; }
.more { display: block; padding: 6px 0; color: var(--primary); font-weight: 500; }
</style>
