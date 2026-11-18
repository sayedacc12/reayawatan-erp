<script setup lang="ts">
import { ref } from 'vue';
import MediaPicker from './MediaPicker.vue';

/** حقل صورة: معاينة واختيار من مكتبة الصور أو رفع جديدة */
const props = defineProps<{ id: string | null | undefined; url?: string | null; label?: string; round?: boolean }>();
const emit = defineEmits<{ (e: 'update', v: { id: string | null; url: string | null }): void }>();
const open = ref(false);
const shown = ref<string | null>(props.url ?? null);
function pick(m: { id: string; url: string }) {
  shown.value = m.url;
  emit('update', { id: m.id, url: m.url });
  open.value = false;
}
function clear() {
  shown.value = null;
  emit('update', { id: null, url: null });
}
</script>

<template>
  <div class="if">
    <span v-if="label" class="if-label">{{ label }}</span>
    <div class="if-body">
      <div :class="['if-prev', { round }]" @click="open = true"><img v-if="id && (shown || url)" :src="shown || url || ''" alt="" /><span v-else>+ صورة</span></div>
      <div class="if-btns"><button type="button" class="btn btn-sm" @click="open = true">{{ id ? 'تغيير' : 'اختيار' }}</button><button v-if="id" type="button" class="btn btn-sm btn-danger" @click="clear">إزالة</button></div>
    </div>
    <MediaPicker v-if="open" @pick="pick" @close="open = false" />
  </div>
</template>

<style scoped>
.if { margin-bottom: 14px; }
.if-label { display: block; font-weight: 500; font-size: .92rem; margin-bottom: 6px; }
.if-body { display: flex; gap: 10px; align-items: center; }
.if-prev { width: 150px; height: 90px; border-radius: 10px; border: 1px dashed var(--border); background: var(--surface-2); display: grid; place-items: center; cursor: pointer; overflow: hidden; color: var(--muted); font-size: .85rem; }
.if-prev.round { width: 80px; height: 80px; border-radius: 50%; }
.if-prev img { width: 100%; height: 100%; object-fit: cover; }
.if-btns { display: flex; flex-direction: column; gap: 6px; }
</style>
