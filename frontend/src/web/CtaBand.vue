<script setup lang="ts">
defineProps<{ title?: string; text?: string }>();
</script>
<template>
  <section class="cta-band"><div class="wrap">
    <div><h2>{{ title ?? 'ما الأثر الذي تريدون تحقيقه؟' }}</h2><p>{{ text ?? 'احجزوا جلسة تشخيص مجانية نحدد فيها معكم الأثر المستهدف وأين نضيف القيمة.' }}</p></div>
    <RouterLink class="btn" to="/book">احجز جلسة تشخيص</RouterLink>
  </div></section>
</template>
