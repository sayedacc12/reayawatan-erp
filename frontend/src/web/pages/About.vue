<script setup lang="ts">
import { computed, onMounted } from 'vue';
import CtaBand from '../CtaBand.vue';
import PageHead from '../PageHead.vue';
import Rich from '../Rich.vue';
import { setTitle } from '../parts';
import { C } from '../site';

const a = computed(() => C().about ?? {});
onMounted(() => setTitle('من نحن'));
</script>

<template>
  <PageHead title="من نحن" :lead="a.lead" :crumbs="[{ l: 'من نحن' }]" />
  <section class="band"><div class="wrap two-col">
    <div class="prose">
      <h2>من نحن</h2>
      <p v-if="a.intro"><Rich :text="a.intro" /></p>
      <h2 style="margin-top: 16px">قصتنا</h2>
      <p v-for="(p, i) in a.story" :key="i"><Rich :text="p" /></p>
      <h2 style="margin-top: 16px">رؤيتنا</h2>
      <p><Rich :text="a.vision" /></p>
      <h2 style="margin-top: 16px">رسالتنا</h2>
      <p><Rich :text="a.mission" /></p>
    </div>
    <aside class="side-box">
      <h3>بطاقة الشركة</h3>
      <dl class="kv"><div v-for="(c, i) in a.card" :key="i"><dt>{{ c.label }}</dt><dd><Rich :text="c.value" /></dd></div></dl>
    </aside>
  </div></section>
  <section v-if="a.directions?.length" class="band alt"><div class="wrap">
    <div class="sec-head"><p class="eyebrow">إلى أين نتجه</p><h2>{{ a.directionsTitle }}</h2></div>
    <ol class="steps"><li v-for="(d, i) in a.directions" :key="i"><h3>{{ d }}</h3></li></ol>
  </div></section>
  <section class="band"><div class="wrap">
    <div class="sec-head"><p class="eyebrow">لماذا أُنشئت رعاية وطن</p><h2>{{ a.reasonsTitle }}</h2></div>
    <div class="grid g2"><div v-for="(r, i) in a.reasons" :key="i" class="svc-card"><h3>{{ r.title }}</h3><p><Rich :text="r.text" /></p></div></div>
  </div></section>
  <section class="band alt"><div class="wrap two-col">
    <div class="prose">
      <p class="eyebrow">الحوكمة</p>
      <h2>{{ a.govTitle }}</h2>
      <p><Rich :text="a.govText" /></p>
      <p v-if="a.govNote" class="note"><Rich :text="a.govNote" /></p>
    </div>
    <aside class="side-box"><h3>اللوائح والسياسات</h3><ul class="checklist"><li v-for="(p, i) in a.policies" :key="i">{{ p }}</li></ul></aside>
  </div></section>
  <section class="band"><div class="wrap">
    <div class="sec-head"><p class="eyebrow">قيمنا</p><h2>ما نلتزم به في كل مشروع</h2></div>
    <div class="grid g3"><div v-for="(v, i) in a.values" :key="i" class="svc-card"><h3>{{ v.title }}</h3><p><Rich :text="v.text" /></p></div></div>
  </div></section>
  <section class="band alt"><div class="wrap">
    <div class="sec-head"><p class="eyebrow">فريق العمل</p><h2>القيادة والخبراء</h2></div>
    <template v-if="a.board?.length">
      <h3 style="margin-bottom: 12px">{{ a.boardTitle }}</h3>
      <div class="grid g3"><div v-for="(m, i) in a.board" :key="i" class="svc-card"><h3>{{ m.name }}</h3><p>{{ m.role }}</p></div></div>
    </template>
    <p v-if="a.teamNote" class="note" style="margin-top: 16px"><Rich :text="a.teamNote" /></p>
  </div></section>
  <CtaBand />
</template>
