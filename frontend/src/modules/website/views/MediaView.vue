<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { copy, errMsg, fmtDate } from '../lib';
import '../website.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const toast = useToast();
const items = ref<any[]>([]);
const busy = ref(false);
onMounted(async () => {
  try {
    items.value = await api('/website/media');
  } catch (e) {
    toast.error(errMsg(e));
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
      items.value.unshift(await api('/website/media', { method: 'POST', body: fd }));
    }
    toast.success('رُفعت الصور');
  } catch (e) {
    toast.error(errMsg(e));
  } finally {
    busy.value = false;
  }
}
async function remove(m: any) {
  if (!confirm(`حذف الصورة «${m.name}»؟`)) return;
  try {
    await api(`/website/media/${m.id}`, { method: 'DELETE' });
    items.value = items.value.filter((x) => x.id !== m.id);
    toast.success('حُذفت الصورة');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
async function copyUrl(m: any) {
  if (await copy(window.location.origin + m.url)) toast.success('نُسخ رابط الصورة');
}
const kb = (n: number) => `${Math.round(n / 1024).toLocaleString('ar-SA')} ك.ب`;
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>مكتبة الصور</h1><p class="muted">كل صور الموقع في مكان واحد. الصورة المستخدمة في صفحة أو خبر لا تُحذف.</p></div>
      <label class="btn btn-primary">{{ busy ? 'جارٍ الرفع...' : '+ رفع صور' }}<input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden :disabled="busy" @change="upload" /></label>
    </div>
    <div v-if="!items.length" class="card ws-empty"><strong>المكتبة فارغة</strong>ارفع صورًا لتستخدمها في الصفحات والأخبار والبرامج</div>
    <div class="md-grid">
      <figure v-for="m in items" :key="m.id" class="md-item card">
        <img :src="m.url" :alt="m.name" loading="lazy" />
        <figcaption><strong :title="m.name">{{ m.name }}</strong><small class="muted">{{ kb(m.size) }} · {{ fmtDate(m.createdAt) }}</small>
          <div class="ws-row" style="margin: 4px 0 0"><button class="btn btn-sm" @click="copyUrl(m)">نسخ الرابط</button><button class="btn btn-sm btn-danger" @click="remove(m)">حذف</button></div>
        </figcaption>
      </figure>
    </div>
  </div>
</template>

<style scoped>
.md-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.md-item { margin: 0; padding: 0; overflow: hidden; animation: ws-rise .4s var(--ease) both; }
.md-item img { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; display: block; background: var(--surface-2); }
.md-item figcaption { padding: 10px; display: grid; gap: 2px; }
.md-item strong { font-size: .86rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
