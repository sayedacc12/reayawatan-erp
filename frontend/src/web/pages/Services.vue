<script setup lang="ts">
import { onMounted } from 'vue';
import CtaBand from '../CtaBand.vue';
import PageHead from '../PageHead.vue';
import SvcCard from '../SvcCard.vue';
import { setTitle } from '../parts';
import { services } from '../site';

onMounted(() => setTitle('خدماتنا'));
</script>

<template>
  <PageHead title="القيمة التي نضيفها" lead="خدمات لكل منها أثر مستهدف ومؤشرات نتفق عليها معكم قبل البدء." :crumbs="[{ l: 'خدماتنا' }]" />
  <section class="band"><div class="wrap"><div class="grid g3">
    <SvcCard v-for="s in services()" :key="s.slug" :s="s" />
    <RouterLink class="svc-card" to="/contact" style="justify-content: center; border-style: dashed"><h3>لا تجدون ما تبحثون عنه؟</h3><p>صفوا لنا احتياجكم وسنقترح النطاق المناسب.</p><span class="more">تواصل معنا ←</span></RouterLink>
  </div></div></section>
  <CtaBand />
</template>
