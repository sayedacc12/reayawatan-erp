<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { passwordProblem } from '../validation';
import {
  emailProblem, isSaudiMobile, isSaudiPhone, LICENSE, MOBILE_MSG, normalizeLicense, normalizePhone, PHONE_MSG, personNameProblem,
} from './contactRules';

/**
 * نموذج البيانات الرئيسية للجمعية (طلب الاشتراك).
 * mode:
 * - public: تقديم جديد من الجمعية (كل الحقول وملف الترخيص وحساب مدير النظام إلزامية)
 * - admin: مدير المنصة يسجّل طلبًا نيابة عن جمعية
 * - link: استكمال البيانات الرئيسية لجمعية قائمة (بدون حساب مدير نظام)
 * - resubmit: الجمعية تستكمل طلبها المعاد (الملف اختياري)
 * - edit: مدير المنصة يعدّل البيانات الرئيسية (الملف اختياري)، ومع approved يُخفى المعرف وحساب المدير
 */
export interface MainData {
  orgName: string; proposedSlug: string; city: string; orgEmail: string; orgPhone: string;
  licenseNumber: string; licenseStartDate: string; licenseEndDate: string | null; licenseFileName?: string;
  directorName: string; directorPhone: string; directorEmail: string;
  boardName: string; boardPosition: string; boardPhone: string; boardEmail: string;
  adminFullName: string; adminEmail: string;
}
const props = defineProps<{
  mode: 'public' | 'admin' | 'link' | 'resubmit' | 'edit';
  initial?: Partial<MainData> | null;
  approved?: boolean;
  busy?: boolean;
  submitLabel?: string;
}>();
const emit = defineEmits<{ submit: [FormData]; cancel: [] }>();

const empty: MainData = {
  orgName: '', proposedSlug: '', city: '', orgEmail: '', orgPhone: '', licenseNumber: '', licenseStartDate: '', licenseEndDate: '',
  directorName: '', directorPhone: '', directorEmail: '', boardName: '', boardPosition: 'رئيس مجلس الإدارة', boardPhone: '', boardEmail: '',
  adminFullName: '', adminEmail: '',
};
const f = reactive<MainData & { adminPassword: string; adminPasswordConfirm: string }>({ ...empty, ...(props.initial ?? {}), licenseEndDate: props.initial?.licenseEndDate ?? '', adminPassword: '', adminPasswordConfirm: '' });
const file = ref<File | null>(null);
const fileError = ref('');
const localError = ref('');

const fileRequired = computed(() => ['public', 'admin', 'link'].includes(props.mode));
const showAccount = computed(() => props.mode !== 'link' && !props.approved);
const passwordRequired = computed(() => props.mode === 'public');
const showSlug = computed(() => props.mode !== 'link' && !props.approved);
const pwProblem = computed(() => passwordProblem(f.adminPassword));
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
const confirmProblem = computed(() =>
  f.adminPassword && f.adminPasswordConfirm !== f.adminPassword ? (f.adminPasswordConfirm ? 'تأكيد كلمة المرور لا يطابق كلمة المرور' : 'أعد كتابة كلمة المرور للتأكيد') : '');

// تدقيق الحقول: الرسالة تظهر بعد مغادرة الحقل أو عند محاولة الإرسال
type Checked = 'orgPhone' | 'orgEmail' | 'city' | 'licenseNumber' | 'licenseStartDate' | 'licenseEndDate' | 'directorName' | 'directorPhone'
  | 'directorEmail' | 'boardName' | 'boardPhone' | 'boardEmail' | 'adminFullName' | 'adminEmail';
const touched = reactive<Record<string, boolean>>({});
const tried = ref(false);
const optionalEmpty = (v: string) => props.mode === 'edit' && !v.trim();
const problems = computed<Record<Checked, string>>(() => {
  const mobile = (v: string) => (optionalEmpty(v) ? '' : !v.trim() ? 'اكتب رقم الجوال' : isSaudiMobile(normalizePhone(v)) ? '' : MOBILE_MSG);
  const email = (v: string) => (optionalEmpty(v) ? '' : emailProblem(v) ?? '');
  const person = (v: string) => (optionalEmpty(v) || !v.trim() ? '' : personNameProblem(v) ?? '');
  const lic = normalizeLicense(f.licenseNumber);
  return {
    orgPhone: optionalEmpty(f.orgPhone) ? '' : !f.orgPhone.trim() ? 'اكتب هاتف الجمعية' : isSaudiPhone(normalizePhone(f.orgPhone)) ? '' : PHONE_MSG,
    orgEmail: email(f.orgEmail),
    city: /[0-9٠-٩]/.test(f.city) ? 'اسم المدينة لا يحتوي على أرقام' : '',
    licenseNumber: !lic || LICENSE.test(lic) ? '' : 'رقم الترخيص أرقام فقط (يُسمح بـ / أو -)',
    licenseStartDate: f.licenseStartDate && f.licenseStartDate > today ? 'تاريخ بداية الترخيص لا يكون في المستقبل' : '',
    licenseEndDate: f.licenseEndDate && f.licenseStartDate && f.licenseEndDate <= f.licenseStartDate ? 'تاريخ نهاية الترخيص يجب أن يكون بعد تاريخ بدايته' : '',
    directorName: person(f.directorName),
    directorPhone: mobile(f.directorPhone),
    directorEmail: email(f.directorEmail),
    boardName: person(f.boardName),
    boardPhone: mobile(f.boardPhone),
    boardEmail: email(f.boardEmail),
    adminFullName: showAccount.value ? person(f.adminFullName) : '',
    adminEmail: showAccount.value && f.adminEmail.trim() ? email(f.adminEmail) : '',
  };
});
const err = (k: Checked) => ((touched[k] || tried.value) && problems.value[k]) || '';
/** عند مغادرة حقل الجوال: يوحّد الصيغة (أرقام إنجليزية و05...) */
function leave(k: Checked) {
  touched[k] = true;
  if (k === 'orgPhone' || k === 'directorPhone' || k === 'boardPhone') f[k] = normalizePhone(f[k]);
  if (k === 'licenseNumber') f.licenseNumber = normalizeLicense(f.licenseNumber);
}

// اقتراح المعرف من البريد لو الحقل فاضي
watch(() => f.orgEmail, (e) => {
  if (props.mode !== 'public' || f.proposedSlug) return;
  const domain = e.split('@')[1]?.split('.')[0];
  if (domain && /^[a-z0-9-]+$/.test(domain)) f.proposedSlug = domain;
});

function pick(e: Event) {
  fileError.value = '';
  const x = (e.target as HTMLInputElement).files?.[0] ?? null;
  if (x && x.size > 10 * 1024 * 1024) {
    fileError.value = 'حجم الملف أكبر من 10 ميجابايت';
    file.value = null;
    return;
  }
  if (x && !/^(application\/pdf|image\/(png|jpeg|webp))$/.test(x.type)) {
    fileError.value = 'الملف يجب أن يكون PDF أو صورة';
    file.value = null;
    return;
  }
  file.value = x;
}

function submit() {
  localError.value = '';
  tried.value = true;
  const firstProblem = Object.values(problems.value).find(Boolean);
  if (firstProblem) {
    localError.value = `صحّح الحقول المعلَّمة باللون الأحمر: ${firstProblem}`;
    return;
  }
  if (fileRequired.value && !file.value) {
    localError.value = 'أرفق مستند ترخيص الجمعية (PDF أو صورة)';
    return;
  }
  if (f.adminPassword && pwProblem.value) {
    localError.value = pwProblem.value;
    return;
  }
  if (showAccount.value && confirmProblem.value) {
    localError.value = confirmProblem.value;
    return;
  }
  for (const k of ['orgPhone', 'directorPhone', 'boardPhone'] as const) if (f[k].trim()) f[k] = normalizePhone(f[k]);
  f.licenseNumber = normalizeLicense(f.licenseNumber);
  const fd = new FormData();
  const keys: (keyof MainData)[] = [
    'orgName', 'city', 'orgEmail', 'orgPhone', 'licenseNumber', 'licenseStartDate', 'licenseEndDate',
    'directorName', 'directorPhone', 'directorEmail', 'boardName', 'boardPosition', 'boardPhone', 'boardEmail',
  ];
  if (showSlug.value) keys.push('proposedSlug');
  if (showAccount.value) keys.push('adminFullName', 'adminEmail');
  for (const k of keys) {
    const val = (f[k] ?? '') as string;
    // في التعديل نرسل الحقول كلها عدا الفارغ الاختياري
    if (val !== '' || k === 'licenseEndDate') fd.append(k, val.trim());
  }
  if (props.mode === 'link' && !fd.get('proposedSlug')) fd.append('proposedSlug', 'existing');
  if (showAccount.value && f.adminPassword) {
    fd.append('adminPassword', f.adminPassword);
    fd.append('adminPasswordConfirm', f.adminPasswordConfirm);
  }
  if (file.value) fd.append('license', file.value);
  emit('submit', fd);
}
</script>

<template>
  <form class="reg" @submit.prevent="submit">
    <section class="sec" style="--i: 0">
      <h3><span class="num">1</span> بيانات الجمعية</h3>
      <div class="field"><label>اسم الجمعية كما في الترخيص *</label><input v-model="f.orgName" class="input" required minlength="3" /></div>
      <div class="row">
        <div class="field"><label>المدينة *</label><input v-model="f.city" :class="['input', { invalid: err('city') }]" required @blur="leave('city')" /><small v-if="err('city')" class="field-error">{{ err('city') }}</small></div>
        <div class="field"><label>هاتف الجمعية *</label><input v-model="f.orgPhone" :class="['input', { invalid: err('orgPhone') }]" dir="ltr" inputmode="tel" required placeholder="05xxxxxxxx" @blur="leave('orgPhone')" /><small v-if="err('orgPhone')" class="field-error">{{ err('orgPhone') }}</small></div>
      </div>
      <div class="row">
        <div class="field"><label>البريد الرسمي للجمعية *</label><input v-model="f.orgEmail" :class="['input', { invalid: err('orgEmail') }]" type="email" dir="ltr" required @blur="leave('orgEmail')" /><small v-if="err('orgEmail')" class="field-error">{{ err('orgEmail') }}</small></div>
        <div v-if="showSlug" class="field">
          <label>المعرف المقترح للروابط (بالإنجليزية) *</label>
          <input v-model="f.proposedSlug" class="input" dir="ltr" pattern="[a-z0-9\-]+" required placeholder="al-bir" @input="f.proposedSlug = f.proposedSlug.toLowerCase()" />
          <small class="muted" dir="ltr">/o/{{ f.proposedSlug || '...' }}</small>
        </div>
      </div>
    </section>

    <section class="sec" style="--i: 1">
      <h3><span class="num">2</span> الترخيص</h3>
      <div class="row">
        <div class="field"><label>رقم الترخيص *</label><input v-model="f.licenseNumber" :class="['input', { invalid: err('licenseNumber') }]" dir="ltr" required @blur="leave('licenseNumber')" /><small v-if="err('licenseNumber')" class="field-error">{{ err('licenseNumber') }}</small></div>
        <div class="field"><label>تاريخ بداية الترخيص *</label><input v-model="f.licenseStartDate" :class="['input', { invalid: err('licenseStartDate') }]" type="date" :max="today" required @blur="leave('licenseStartDate')" /><small v-if="err('licenseStartDate')" class="field-error">{{ err('licenseStartDate') }}</small></div>
      </div>
      <div class="row">
        <div class="field"><label>تاريخ نهاية الترخيص (إن وجد)</label><input v-model="f.licenseEndDate" :class="['input', { invalid: err('licenseEndDate') }]" type="date" :min="f.licenseStartDate" @blur="leave('licenseEndDate')" /><small v-if="err('licenseEndDate')" class="field-error">{{ err('licenseEndDate') }}</small></div>
        <div class="field">
          <label>مستند الترخيص {{ fileRequired ? '*' : '(لاستبداله فقط)' }}</label>
          <label class="drop" :class="{ has: file }">
            <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" @change="pick" />
            <span class="drop-icon" aria-hidden="true">⇪</span>
            <span>{{ file ? file.name : initial?.licenseFileName ? `الحالي: ${initial.licenseFileName}` : 'اختر ملف PDF أو صورة (حتى 10 ميجابايت)' }}</span>
          </label>
          <small v-if="fileError" class="field-error">{{ fileError }}</small>
        </div>
      </div>
    </section>

    <section class="sec" style="--i: 2">
      <h3><span class="num">3</span> المدير التنفيذي</h3>
      <div class="field"><label>الاسم الكامل *</label><input v-model="f.directorName" :class="['input', { invalid: err('directorName') }]" required minlength="3" @blur="leave('directorName')" /><small v-if="err('directorName')" class="field-error">{{ err('directorName') }}</small></div>
      <div class="row">
        <div class="field"><label>الجوال *</label><input v-model="f.directorPhone" :class="['input', { invalid: err('directorPhone') }]" dir="ltr" inputmode="tel" required placeholder="05xxxxxxxx" @blur="leave('directorPhone')" /><small v-if="err('directorPhone')" class="field-error">{{ err('directorPhone') }}</small></div>
        <div class="field"><label>البريد الإلكتروني *</label><input v-model="f.directorEmail" :class="['input', { invalid: err('directorEmail') }]" type="email" dir="ltr" required @blur="leave('directorEmail')" /><small v-if="err('directorEmail')" class="field-error">{{ err('directorEmail') }}</small></div>
      </div>
    </section>

    <section class="sec" style="--i: 3">
      <h3><span class="num">4</span> عضو مجلس الإدارة</h3>
      <div class="row">
        <div class="field"><label>الاسم الكامل *</label><input v-model="f.boardName" :class="['input', { invalid: err('boardName') }]" required minlength="3" @blur="leave('boardName')" /><small v-if="err('boardName')" class="field-error">{{ err('boardName') }}</small></div>
        <div class="field"><label>المنصب في المجلس *</label><input v-model="f.boardPosition" class="input" required /></div>
      </div>
      <div class="row">
        <div class="field"><label>الجوال *</label><input v-model="f.boardPhone" :class="['input', { invalid: err('boardPhone') }]" dir="ltr" inputmode="tel" required placeholder="05xxxxxxxx" @blur="leave('boardPhone')" /><small v-if="err('boardPhone')" class="field-error">{{ err('boardPhone') }}</small></div>
        <div class="field"><label>البريد الإلكتروني *</label><input v-model="f.boardEmail" :class="['input', { invalid: err('boardEmail') }]" type="email" dir="ltr" required @blur="leave('boardEmail')" /><small v-if="err('boardEmail')" class="field-error">{{ err('boardEmail') }}</small></div>
      </div>
    </section>

    <section v-if="showAccount" class="sec" style="--i: 4">
      <h3><span class="num">5</span> حساب مدير النظام في الجمعية</h3>
      <p class="muted hint">يُنشأ هذا الحساب تلقائيًا عند اعتماد الطلب، ويدخل منه مدير النظام لإضافة الموظفين وصلاحياتهم.</p>
      <div class="row">
        <div class="field"><label>الاسم *</label><input v-model="f.adminFullName" :class="['input', { invalid: err('adminFullName') }]" :required="mode !== 'edit'" @blur="leave('adminFullName')" /><small v-if="err('adminFullName')" class="field-error">{{ err('adminFullName') }}</small></div>
        <div class="field"><label>البريد الإلكتروني (للدخول) *</label><input v-model="f.adminEmail" :class="['input', { invalid: err('adminEmail') }]" type="email" dir="ltr" :required="mode !== 'edit'" @blur="leave('adminEmail')" /><small v-if="err('adminEmail')" class="field-error">{{ err('adminEmail') }}</small></div>
      </div>
      <div class="field">
        <label>{{ passwordRequired ? 'كلمة المرور *' : mode === 'admin' ? 'كلمة المرور (اتركها فارغة لتوليدها تلقائيًا عند الاعتماد)' : 'كلمة مرور جديدة (اختياري)' }}</label>
        <input v-model="f.adminPassword" :class="['input', { invalid: pwProblem }]" type="password" dir="ltr" :required="passwordRequired" minlength="8" autocomplete="new-password" />
        <small v-if="pwProblem" class="field-error">{{ pwProblem }}</small>
      </div>
      <div v-if="f.adminPassword" class="field">
        <label>تأكيد كلمة المرور *</label>
        <input v-model="f.adminPasswordConfirm" :class="['input', { invalid: (touched.confirm || tried) && confirmProblem }]" type="password" dir="ltr" required autocomplete="new-password" @blur="touched.confirm = true" />
        <small v-if="(touched.confirm || tried) && confirmProblem" class="field-error">{{ confirmProblem }}</small>
        <small v-else-if="f.adminPasswordConfirm && !confirmProblem" class="ok-note">✓ كلمتا المرور متطابقتان</small>
      </div>
    </section>

    <div v-if="localError" class="alert alert-error">{{ localError }}</div>
    <slot name="error" />
    <div class="actions">
      <button class="btn btn-primary" :disabled="busy">{{ busy ? 'جارٍ الإرسال...' : submitLabel ?? 'إرسال' }}</button>
      <button v-if="mode !== 'public'" type="button" class="btn" @click="emit('cancel')">إلغاء</button>
    </div>
  </form>
</template>

<style scoped>
.sec { border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px 4px; margin-bottom: 14px; background: var(--surface); animation: sec-in .45s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--i) * 60ms); }
@keyframes sec-in { from { opacity: 0; transform: translateY(10px); } }
.sec h3 { font-size: 1rem; margin-bottom: 14px; display: flex; align-items: center; gap: 10px; }
.num { width: 26px; height: 26px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--grad); color: #fff; font-size: .85rem; box-shadow: 0 4px 12px rgba(13,148,136,.3); }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
.hint { margin: -6px 0 12px; font-size: .88rem; }
.drop { display: flex; align-items: center; gap: 10px; border: 1.5px dashed var(--border); border-radius: 10px; padding: 9px 12px; cursor: pointer; color: var(--muted); transition: all .2s; font-size: .9rem; }
.drop:hover { border-color: var(--primary); color: var(--primary); }
.drop.has { border-style: solid; border-color: var(--primary); color: var(--primary); background: var(--primary-soft); }
.drop input { display: none; }
.drop-icon { font-size: 1.2rem; }
.actions { display: flex; gap: 8px; }
.ok-note { color: var(--success, #15803d); font-size: .84rem; }
.field small.field-error { display: block; margin-top: 4px; }
@media (max-width: 640px) { .row { grid-template-columns: 1fr; } }
</style>
