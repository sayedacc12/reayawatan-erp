<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import PageHead from '../PageHead.vue';
import Rich from '../Rich.vue';
import VisitorFields from '../VisitorFields.vue';
import { blankVisitor, setTitle, visitorBody } from '../parts';
import { C, handoff, post, services, visitMeta } from '../site';

/** طلب استشارة: يصل للنظام عميلًا محتملًا جديدًا ويُشعَر به الفريق */
const route = useRoute();
const c = computed(() => C().contact ?? {});
const visitor = reactive(blankVisitor());
const service = ref('');
const message = ref('');
const calculator = ref<unknown>(null);
const assessment = ref<unknown>(null);
const sending = ref(false);
const ok = ref(false);
const err = ref('');

onMounted(() => {
  setTitle('تواصل معنا');
  visitor.orgType = c.value.orgTypes?.[0] ?? '';
  service.value = handoff.service || String(route.query.svc ?? '');
  message.value = handoff.message;
  calculator.value = handoff.calculator;
  assessment.value = handoff.assessment;
  Object.assign(handoff, { message: '', service: '', calculator: null, assessment: null });
});

async function submit() {
  err.value = '';
  if (!visitor.name.trim() || !visitor.email.trim() || !message.value.trim()) { err.value = 'أكملوا الحقول المطلوبة وتأكدوا من صحة البريد الإلكتروني.'; return; }
  sending.value = true;
  try {
    await post('/leads', {
      ...visitorBody(visitor), ...visitMeta(), source: 'consultation', message: message.value.trim(),
      ...(service.value && service.value !== 'other' ? { serviceSlug: service.value } : {}),
      ...(calculator.value ? { calculator: calculator.value } : {}), ...(assessment.value ? { assessment: assessment.value } : {}),
    });
    ok.value = true;
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <PageHead title="تواصل معنا" :lead="c.lead" :crumbs="[{ l: 'تواصل معنا' }]" />
  <section class="band"><div class="wrap two-col">
    <div v-if="ok" class="card ok-box" role="status"><h2>شكرًا لكم</h2><p><Rich :text="c.successText" /></p><RouterLink class="btn btn-primary" to="/book">احجزوا جلسة تشخيص مجانية الآن</RouterLink></div>
    <form v-else class="card" novalidate @submit.prevent="submit">
      <h2>طلب استشارة</h2>
      <VisitorFields :model-value="visitor" phone idp="f" />
      <div class="frow">
        <div class="field"><label for="f-type">نوع الجهة</label><select id="f-type" v-model="visitor.orgType" class="input"><option v-for="t in c.orgTypes" :key="t">{{ t }}</option></select></div>
        <div class="field"><label for="f-svc">الخدمة المطلوبة</label><select id="f-svc" v-model="service" class="input"><option value="">غير محدد / أخرى</option><option v-for="s in services()" :key="s.slug" :value="s.slug">{{ s.title }}</option></select></div>
      </div>
      <div class="field"><label for="f-msg">صفوا احتياجكم <span class="req">*</span></label><textarea id="f-msg" v-model="message" class="input" required maxlength="4000" placeholder="ما التحدي أو المشروع؟ وما المدة المتوقعة؟" /></div>
      <p v-if="calculator || assessment" class="note">سنرفق نتيجة {{ calculator ? 'حاسبة مضاعف الأثر' : 'تقييم الجاهزية' }} مع طلبكم.</p>
      <p v-if="err" class="err">{{ err }}</p>
      <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center"><button class="btn btn-primary" type="submit" :disabled="sending">{{ sending ? 'جارٍ الإرسال…' : 'إرسال الطلب' }}</button><span class="note">نستخدم بياناتكم للتواصل بخصوص الطلب فقط.</span></div>
    </form>
    <aside style="display: grid; gap: 20px; align-content: start">
      <div class="side-box"><h3>بيانات التواصل</h3><dl class="kv">
        <div><dt>الهاتف</dt><dd><Rich :text="c.phone" /></dd></div>
        <div><dt>البريد الإلكتروني</dt><dd dir="ltr"><Rich :text="c.email" /></dd></div>
        <div><dt>واتساب الأعمال</dt><dd><Rich :text="c.whatsapp" /></dd></div>
        <div><dt>العنوان</dt><dd><Rich :text="c.address" /></dd></div>
        <div><dt>ساعات العمل</dt><dd><Rich :text="c.hours" /></dd></div>
      </dl></div>
      <div class="side-box"><h3>جلسة تشخيص مجانية</h3><p class="note">تفضلون الحديث مباشرة؟ اختاروا موعدًا مناسبًا مع أحد مستشارينا.</p><RouterLink class="btn" to="/book">احجز موعدًا</RouterLink></div>
      <div class="side-box"><h3>للتوظيف</h3><p class="note"><Rich :text="c.careers" /></p></div>
    </aside>
  </div></section>
</template>
