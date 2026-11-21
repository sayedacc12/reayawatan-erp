<script setup lang="ts">
import { useToast } from '../stores/toast';
const toast = useToast();
</script>

<template>
  <div class="toasts" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in toast.items" :key="t.id" :class="['toast', t.kind]" role="status" @click="toast.dismiss(t.id)">
        <span class="icon" aria-hidden="true">{{ t.kind === 'success' ? '✓' : '!' }}</span>
        {{ t.text }}
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts { position: fixed; top: 74px; inset-inline: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; z-index: 100; pointer-events: none; padding: 0 16px; }
.toast { pointer-events: auto; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-radius: 12px; color: #fff; font-weight: 600;
  box-shadow: 0 10px 30px rgba(6, 20, 26, .25); max-width: 100%; }
.toast.success { background: linear-gradient(135deg, #164e38, #2f7a57); }
.toast.error { background: linear-gradient(135deg, #b91c1c, #ef4444); }
.icon { width: 24px; height: 24px; border-radius: 50%; background: rgba(255,255,255,.22); display: grid; place-items: center; font-size: .85rem; flex-shrink: 0; }
.toast-enter-active, .toast-leave-active { transition: all .3s cubic-bezier(.2,.8,.2,1); }
.toast-enter-from { opacity: 0; transform: translateY(-14px) scale(.96); }
.toast-leave-to { opacity: 0; transform: translateY(-8px); }
@media (prefers-reduced-motion: reduce) { .toast-enter-active, .toast-leave-active { transition: none; } }
</style>
