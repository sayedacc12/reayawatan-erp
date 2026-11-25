<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageHead from '../PageHead.vue';
import Shift from '../Shift.vue';
import StageTag from '../StageTag.vue';
import { setTitle } from '../parts';
import { seoFor } from '../seo';
import { AR, bySlug, handoff, services, site } from '../site';

const route = useRoute();
const router = useRouter();
const s = computed(() => bySlug(String(route.params.slug)));
// خدمة غير موجودة لا تُفهرس، والخدمة المضافة من لوحة التحكم تأخذ وصفها المختصر
watchEffect(() => setTitle(s.value?.title ?? 'خدماتنا', seoFor(route.path)?.description ?? s.value?.short, !!s.value || !site.data));
function request() {
  Object.assign(handoff, { message: '', service: s.value!.slug, calculator: null, assessment: null });
  router.push('/contact');
}
</script>

<template>
  <template v-if="s">
    <PageHead :title="s.title" :lead="s.intro" :crumbs="[{ to: '/services', l: 'خدماتنا' }, { l: s.title }]" />
    <section class="value-band"><div class="wrap">
      <div class="vb-main"><StageTag :s="s" /><p class="eyebrow" style="margin-top: 10px">الأثر المستهدف</p><p class="vb-value">{{ s.value }}</p></div>
      <div class="vb-shifts"><Shift head from="قبل" to="بعد" /><Shift v-for="(x, i) in s.shifts" :key="i" :from="x.from" :to="x.to" /></div>
    </div></section>
    <section class="band"><div class="wrap two-col">
      <div style="display: grid; gap: 36px; min-width: 0">
        <div style="display: grid; gap: 16px"><h2>ماذا نقدم</h2><div class="deliv"><div v-for="(d, i) in s.deliverables" :key="i"><h3>{{ d.title }}</h3><p>{{ d.desc }}</p></div></div></div>
        <div style="display: grid; gap: 16px"><h2>مراحل العمل</h2><ol class="steps" style="grid-template-columns: repeat(2, minmax(0, 1fr))"><li v-for="(d, i) in s.steps" :key="i"><h3>{{ d.title }}</h3><p>{{ d.desc }}</p></li></ol></div>
      </div>
      <aside style="display: grid; gap: 20px">
        <div class="side-box kpi-box"><h3>مؤشرات الأثر التي نقيسها</h3><ul class="checklist"><li v-for="(k, i) in s.kpis" :key="i">{{ k }}</li></ul><p class="note">نقيسها قبل البدء وعند التسليم وبعد ستة أشهر.</p></div>
        <div class="side-box"><h3>لمن هذه الخدمة</h3><div class="tag-row"><span v-for="(a, i) in s.audience" :key="i" class="tag">{{ a }}</span></div></div>
        <div class="side-box"><h3>ما الذي تحصلون عليه</h3>
          <ul class="checklist"><li>مؤشرات أثر متفق عليها في العقد</li><li>نطاق ومدة وتكلفة محددة مسبقاً</li><li>فريق متخصص ومدير مشروع واحد للتواصل</li><li>تقرير أثر يقارن النتائج بخط الأساس</li><li>تدريب فريقكم على استخدامها</li></ul>
          <button class="btn btn-primary" type="button" @click="request">اطلب هذه الخدمة</button>
          <RouterLink class="btn" to="/book">احجز جلسة تشخيص مجانية</RouterLink>
        </div>
      </aside>
    </div></section>
    <section class="band alt"><div class="wrap" style="display: grid; gap: 16px"><h2>مجالات دورة العمل</h2>
      <div class="other-svcs"><template v-for="(x, i) in services()" :key="x.slug"><span v-if="x.slug === s.slug" class="cur">{{ AR(i + 1) }}. {{ x.title }}</span><RouterLink v-else :to="`/services/${x.slug}`">{{ AR(i + 1) }}. {{ x.title }}</RouterLink></template></div>
    </div></section>
  </template>
  <template v-else>
    <PageHead title="الخدمة غير موجودة" lead="ربما تغير رابط الخدمة. تصفحوا خدماتنا من القائمة." :crumbs="[{ to: '/services', l: 'خدماتنا' }]" />
    <section class="band"><div class="wrap"><RouterLink class="btn btn-primary" to="/services">كل الخدمات</RouterLink></div></section>
  </template>
</template>
