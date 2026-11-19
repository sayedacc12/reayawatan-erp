<script setup lang="ts">
import { computed } from 'vue';
import { copyText } from '../modules/platform/labels';
import { waNumber } from '../modules/platform/siteLabels';
import { useToast } from '../stores/toast';

/**
 * كلمة مرور مؤقتة صدرت للتو: تظهر مرة واحدة فقط، مع رسالة جاهزة تُنسخ أو تُرسل عبر واتساب.
 * لا ترسل المنصة بريدًا أو رسائل نصية بعد، فالمسؤول يسلّمها بنفسه.
 */
const props = defineProps<{
  name: string;
  /** اسم الدخول أو رقم الهوية */
  login: string;
  loginLabel?: string;
  password: string;
  expiresAt: string;
  loginUrl: string;
  /** جوال صاحب الحساب المسجل (لرابط واتساب مباشر) */
  phone?: string | null;
  place?: string;
}>();
defineEmits<{ close: [] }>();
const toast = useToast();

const until = computed(() => new Date(props.expiresAt).toLocaleString('ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' }));
const text = computed(() => `السلام عليكم ${props.name}،
كلمة مرور مؤقتة للدخول${props.place ? ` إلى ${props.place}` : ''}:
رابط الدخول: ${props.loginUrl}
${props.loginLabel ?? 'اسم الدخول'}: ${props.login}
كلمة المرور المؤقتة: ${props.password}
صالحة حتى ${until.value}، وسيطلب منك النظام اختيار كلمة مرور جديدة عند أول دخول.`);
const wa = computed(() => {
  const n = props.phone ? waNumber(props.phone.replace(/[\s-]/g, '')) : '';
  return `https://wa.me/${n}?text=${encodeURIComponent(text.value)}`;
});
async function copy(s: string) {
  await copyText(s);
  toast.success('تم النسخ');
}
</script>

<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <div class="card modal tp">
      <h2>كلمة مرور مؤقتة لـ {{ name }}</h2>
      <p class="alert tp-note">تظهر هذه الكلمة مرة واحدة فقط. سلّمها لصاحب الحساب الآن{{ phone ? ' على جواله المسجل' : '' }}، ولا ترسلها لأي رقم آخر.</p>
      <div class="tp-row"><span>{{ loginLabel ?? 'اسم الدخول' }}</span><code dir="ltr">{{ login }}</code></div>
      <div class="tp-row"><span>كلمة المرور المؤقتة</span><code dir="ltr" class="tp-pass">{{ password }}</code><button class="btn btn-sm" @click="copy(password)">نسخ</button></div>
      <div class="tp-row"><span>صالحة حتى</span><b>{{ until }}</b></div>
      <p class="muted tp-small">عند أول دخول بها يُطلب منه اختيار كلمة مرور جديدة، وأي جلسة مفتوحة سابقًا لحسابه انتهت الآن.</p>
      <div class="modal-actions">
        <a class="btn btn-primary" :href="wa" target="_blank" rel="noopener">إرسال عبر واتساب{{ phone ? ` (${phone})` : '' }}</a>
        <button class="btn" @click="copy(text)">نسخ الرسالة كاملة</button>
        <button class="btn" @click="$emit('close')">تم</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tp { max-width: 520px; }
.tp h2 { margin-bottom: 12px; }
.tp-note { font-size: .9rem; background: #fef3c7; color: #92400e; }
.tp-small { font-size: .85rem; }
.tp-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px dashed var(--border); flex-wrap: wrap; }
.tp-row span { color: var(--muted); min-width: 130px; }
.tp-pass { font-size: 1.15rem; font-weight: 700; letter-spacing: .04em; }
</style>
