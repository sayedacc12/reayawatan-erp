<script setup lang="ts">
defineProps<{ size?: number }>();
// معرّف فريد لكل نسخة حتى لا تتعارض التدرجات عند تكرار الشعار في الصفحة
const uid = `sb${Math.random().toString(36).slice(2, 8)}`;
</script>

<template>
  <!-- شعار سنابل: سنبلة قمح بحبوب متدرجة داخل إطار نجمة ثمانية خافت -->
  <svg :width="size ?? 48" :height="size ?? 48" viewBox="0 0 64 64" aria-hidden="true" class="brand-mark">
    <defs>
      <linearGradient :id="`${uid}-g`" x1="0" y1="1" x2="0.6" y2="0">
        <stop offset="0" stop-color="#14b8a6" />
        <stop offset="0.5" stop-color="#5eead4" />
        <stop offset="1" stop-color="#f5c66b" />
      </linearGradient>
    </defs>
    <g fill="none" :stroke="`url(#${uid}-g)`" stroke-width="1.4" opacity="0.45" stroke-linejoin="round">
      <rect x="12" y="12" width="40" height="40" rx="5" />
      <rect x="12" y="12" width="40" height="40" rx="5" transform="rotate(45 32 32)" />
    </g>
    <g :fill="`url(#${uid}-g)`">
      <!-- الساق -->
      <path d="M31.2 56c0-9 .3-24 .8-38.5h1c-.4 14.5-.6 29.5-.6 38.5z" />
      <!-- الحبوب: أزواج متبادلة من الأسفل للأعلى -->
      <ellipse cx="27.2" cy="43" rx="2.6" ry="5.2" transform="rotate(-32 27.2 43)" />
      <ellipse cx="36.6" cy="43" rx="2.6" ry="5.2" transform="rotate(32 36.6 43)" />
      <ellipse cx="27.6" cy="34.5" rx="2.5" ry="5" transform="rotate(-30 27.6 34.5)" />
      <ellipse cx="36.4" cy="34.5" rx="2.5" ry="5" transform="rotate(30 36.4 34.5)" />
      <ellipse cx="28.2" cy="26.3" rx="2.3" ry="4.6" transform="rotate(-26 28.2 26.3)" />
      <ellipse cx="35.8" cy="26.3" rx="2.3" ry="4.6" transform="rotate(26 35.8 26.3)" />
      <ellipse cx="32" cy="15.5" rx="2.3" ry="5" />
    </g>
  </svg>
</template>
