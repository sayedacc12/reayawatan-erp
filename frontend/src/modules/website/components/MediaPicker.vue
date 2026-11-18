<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';

/* eslint-disable @typescript-eslint/no-explicit-any */
const emit = defineEmits<{ (e: 'pick', m: { id: string; url: string }): void; (e: 'close'): void }>();
const toast = useToast();
const items = ref<any[]>([]);
const busy = ref(false);
onMounted(async () => {
  try {
    items.value = await api('/website/media');
  } catch (e) {
    toast.error((e as Error).message);
  }
});
async function upload(ev: Event) {
  const files = Array.from((ev.target as HTMLInputElement).files ?? []);
  (ev.target as HTMLInputElement).value = '';
  busy.value = true;
  try {
    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f);
      const m: any = await api('/website/media', { method: 'POST', body: fd });
      items.value.unshift(m);
    }
    if (files.length === 1) emit('pick', items.value[0]);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal modal-wide card">
      <div class="ws-row" style="justify-content: space-between">
        <h2>اختر صورة</h2>
        <label class="btn btn-primary btn-sm">{{ busy ? 'جارٍ الرفع...' : 'رفع صورة جديدة' }}<input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden :disabled="busy" @change="upload" /></label>
      </div>
      <p class="ws-muted">JPG أو PNG أو WEBP بحد 5 ميجابايت. يفضل للصور العريضة مقاس 1600×900.</p>
      <div v-if="!items.length" class="ws-empty"><strong>المكتبة فارغة</strong>ارفع أول صورة</div>
      <div class="mp-grid">
        <button v-for="m in items" :key="m.id" class="mp-item" :title="m.name" @click="emit('pick', m)"><img :src="m.url" :alt="m.name" loading="lazy" /></button>
      </div>
      <div class="modal-actions"><button class="btn" @click="emit('close')">إغلاق</button></div>
    </div>
  </div>
</template>

<style scoped>
.mp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; max-height: 55vh; overflow-y: auto; }
.mp-item { padding: 0; border: 2px solid transparent; border-radius: 10px; overflow: hidden; cursor: pointer; aspect-ratio: 16 / 10; background: var(--surface-2); transition: border-color .2s, transform .2s; }
.mp-item:hover { border-color: var(--primary); transform: scale(1.03); }
.mp-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>
