<script setup lang="ts">
/** شعار رعاية وطن: الورقة البرونزية في المركز والأوراق حولها. light للخلفيات الداكنة */
defineProps<{ size?: number; light?: boolean }>();
</script>

<template>
  <img :src="light ? '/brand/mark-light.png' : '/brand/mark.png'" :width="size ?? 48" :height="size ?? 48" alt="" aria-hidden="true" class="brand-mark" style="object-fit: contain">
</template>
