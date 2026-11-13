<script setup lang="ts">
defineProps<{ size?: number }>();
</script>

<template>
  <!-- شعار هندسي: نجمة ثمانية (زخرفة عربية) بداخلها قلب العطاء -->
  <svg :width="size ?? 48" :height="size ?? 48" viewBox="0 0 64 64" aria-hidden="true" class="brand-mark">
    <defs>
      <linearGradient id="bm-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#5eead4" />
        <stop offset="0.55" stop-color="#14b8a6" />
        <stop offset="1" stop-color="#f5c66b" />
      </linearGradient>
    </defs>
    <g fill="none" stroke="url(#bm-g)" stroke-width="2.4" stroke-linejoin="round">
      <rect x="14" y="14" width="36" height="36" rx="4" />
      <rect x="14" y="14" width="36" height="36" rx="4" transform="rotate(45 32 32)" />
    </g>
    <path d="M32 42c-6-4.4-9.5-7.6-9.5-11.3a4.9 4.9 0 0 1 9.5-1.8 4.9 4.9 0 0 1 9.5 1.8c0 3.7-3.5 6.9-9.5 11.3z" fill="url(#bm-g)" />
  </svg>
</template>
