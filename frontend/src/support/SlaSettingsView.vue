<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { useToast } from '../stores/toast';
import '../modules/platform/platform.css';
import SlaLevels from './SlaLevels.vue';
import { PRIORITY, type SlaLevel } from './support';

/** إعداد مستويات الخدمة: المهل وآلية التعامل والتصعيد لكل مستوى */
const toast = useToast();
const levels = ref<(SlaLevel & { examplesText: string; handlingText: string })[]>([]);
const preview = ref<SlaLevel[]>([]);
const error = ref('');
const busy = ref(false);
const editing = ref(false);

function fill(ls: SlaLevel[]) {
  preview.value = ls;
  levels.value = ls.map((l) => ({ ...l, examplesText: l.examples.join('\n'), handlingText: l.handling.join('\n') }));
}
onMounted(async () => {
  try { fill(await api<SlaLevel[]>('/support-desk/sla')); } catch (e) { error.value = (e as Error).message; }
});
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

async function save() {
  busy.value = true;
  try {
    const payload = levels.value.map(({ examplesText, handlingText, ...l }) => ({ ...l, examples: lines(examplesText), handling: lines(handlingText) }));
    fill(await api<SlaLevel[]>('/support-desk/sla', { method: 'PUT', json: { levels: payload } }));
    editing.value = false;
    toast.success('تم حفظ مستويات الخدمة، وتسري على الطلبات الجديدة');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <section class="p-hero">
      <div>
        <p class="p-kicker">الدعم الفني</p>
        <h1>مستويات الخدمة وآلية التعامل</h1>
        <p class="p-sub">خمسة مستويات تحدد مهلة أول رد ومهلة الحل وخطوات المعالجة والتصعيد. تظهر هذه الآلية للجمعيات عند تقديم الطلب، وتُحسب المهل تلقائيًا وتتوقف أثناء انتظار رد الشركة.</p>
      </div>
      <button v-if="!editing" class="btn btn-gold" @click="editing = true">تعديل المستويات</button>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <SlaLevels v-if="!editing" :levels="preview" />
    <form v-else @submit.prevent="save">
      <section v-for="l in levels" :key="l.priority" class="card p-panel lvl" :style="{ '--c': PRIORITY[l.priority].color }">
        <h2><i class="dot" />{{ PRIORITY[l.priority].label }}</h2>
        <div class="row-3">
          <div class="field"><label>الاسم الظاهر</label><input v-model="l.name" class="input" required /></div>
          <div class="field"><label>أول رد خلال (ساعة)</label><input v-model.number="l.responseHours" class="input" type="number" min="0.25" step="0.25" required /></div>
          <div class="field"><label>الحل خلال (ساعة)</label><input v-model.number="l.resolutionHours" class="input" type="number" min="0.5" step="0.5" required /></div>
        </div>
        <div class="field"><label>الوصف</label><input v-model="l.description" class="input" /></div>
        <div class="p-row-2">
          <div class="field"><label>أمثلة (سطر لكل مثال)</label><textarea v-model="l.examplesText" class="input" rows="4" /></div>
          <div class="field"><label>خطوات التعامل (سطر لكل خطوة)</label><textarea v-model="l.handlingText" class="input" rows="4" /></div>
        </div>
        <div class="field"><label>التصعيد</label><input v-model="l.escalation" class="input" /></div>
      </section>
      <div class="bar">
        <button class="btn btn-primary" :disabled="busy">{{ busy ? 'جارٍ الحفظ...' : 'حفظ' }}</button>
        <button type="button" class="btn" @click="fill(preview); editing = false">إلغاء</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.lvl { border-inline-start: 5px solid var(--c); }
.dot { width: 12px; height: 12px; border-radius: 50%; background: var(--c); display: inline-block; box-shadow: 0 0 10px var(--c); }
.row-3 { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 0 14px; }
@media (max-width: 700px) { .row-3 { grid-template-columns: 1fr; } }
textarea.input { width: 100%; resize: vertical; }
.bar { position: sticky; bottom: 0; display: flex; gap: 8px; padding: 12px 0; background: var(--bg, transparent); }
</style>
