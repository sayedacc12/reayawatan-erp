<script setup lang="ts">
// أيقونات خطية بسيطة، الاسم يأتي من حقل icon في manifest الوحدة
const props = defineProps<{ name?: string; size?: number }>();
const paths: Record<string, string> = {
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4z',
  building: 'M4 21V5l8-3 8 3v16 M9 21v-4h6v4 M8 8h2 M14 8h2 M8 12h2 M14 12h2 M2 21h20',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
  heart: 'M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.3 5 6.8 5c2 0 3.6 1.1 5.2 3 1.6-1.9 3.2-3 5.2-3 3.5 0 5.6 3.6 4.3 6.8C19.5 16.4 12 21 12 21z',
  hand: 'M11 14h2a2 2 0 0 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16 M7 20l1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.8-2.8L14.4 13 M2 15l6 6',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12 M16 13.5h.01',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M2 12h20 M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z',
  grid: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  coins: 'M9 10a6 3 0 1 0 0-.01 M3 7v6c0 1.7 2.7 3 6 3s6-1.3 6-3V7 M15 10.2c3.4.3 6 1.6 6 3.3 0 1.7-2.7 3-6 3 M21 13.5v4c0 1.7-2.7 3-6 3-2 0-3.8-.5-4.9-1.3 M3 13v4c0 1.7 2.7 3 6 3',
  layers: 'M12 2 2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
  ledger: 'M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4z M4 17a3 3 0 0 1 3-3h12 M8 8h7 M8 11h4 M15 10.5l1.5 1.5 3-3',
  idcard: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z M9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M5.5 16.5c.6-1.7 2-2.5 3.5-2.5s2.9.8 3.5 2.5 M14 9h4 M14 12h4 M14 15h2',
  sprout: 'M12 21v-9 M12 12c0-4 3-7 8-7 0 4-3 7-8 7z M12 15c0-3.3-2.5-6-7-6 0 3.3 2.5 6 7 6z M7 21h10',
  headset: 'M3 14v-2a9 9 0 0 1 18 0v2 M21 14v3a2 2 0 0 1-2 2h-1v-6h3 M3 14v3a2 2 0 0 0 2 2h1v-6H3 M18 19c0 1.5-2 2.5-5 2.5',
};
const d = () => paths[props.name ?? ''] ?? paths.grid;
</script>

<template>
  <svg :width="size ?? 26" :height="size ?? 26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="d()" />
  </svg>
</template>
