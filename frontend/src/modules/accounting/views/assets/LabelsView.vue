<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../../api';
import { AF } from '../../assets';
import '../../acc.css';

interface Label { id: string; code: string; name: string; groupName: string; location: string | null; svg: string }
const route = useRoute();
const data = ref<{ organization: string; labels: Label[] } | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    const ids = String(route.query.ids ?? '');
    data.value = await api(`${AF}/labels?base=${encodeURIComponent(window.location.origin)}&ids=${encodeURIComponent(ids)}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const printNow = () => window.print();
</script>

<template>
  <div>
    <div class="no-print bar">
      <p class="pm-muted">ملصق لكل أصل: امسحه بكاميرا الجوال فتفتح بطاقة الأصل، أو استخدمه في الجرد. {{ data?.labels.length ?? 0 }} ملصق.</p>
      <button class="btn btn-primary" @click="printNow">طباعة الملصقات</button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="data" class="sheet">
      <!-- SVG من الخادم (مولّد من رمز الأصل فقط) -->
      <div v-for="l in data.labels" :key="l.id" class="label">
        <div class="qr" v-html="l.svg" />
        <div class="txt">
          <small>{{ data.organization }}</small>
          <b class="ac-code">{{ l.code }}</b>
          <span>{{ l.name }}</span>
          <small>{{ l.groupName }}{{ l.location ? ` · ${l.location}` : '' }}</small>
        </div>
      </div>
      <p v-if="!data.labels.length" class="pm-empty">اختر الأصول من سجل الأصول ثم اضغط «طباعة ملصقات QR»</p>
    </div>
  </div>
</template>

<style scoped>
.bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 14px; }
.sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; }
.label { display: flex; gap: 10px; align-items: center; background: #fff; color: #0f172a; border: 1px dashed #94a3b8; border-radius: 10px; padding: 8px; break-inside: avoid; }
.qr { width: 96px; height: 96px; flex: 0 0 96px; }
.qr :deep(svg) { width: 100%; height: 100%; }
.txt { display: flex; flex-direction: column; min-width: 0; line-height: 1.35; }
.txt b { font-size: 1rem; }
.txt small { color: #475569; font-size: .72rem; }
@media print { .sheet { grid-template-columns: repeat(3, 1fr); } .label { border-color: #cbd5e1; } }
</style>
