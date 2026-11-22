<script setup lang="ts">
import { computed, ref } from 'vue';
import { api, downloadProtectedFile } from '../api';
import { useToast } from '../stores/toast';

/**
 * نافذة استيراد من Excel بخطوتين: فحص الملف وعرض التقرير دون حفظ، ثم الحفظ بعد الموافقة (كله أو لا شيء).
 * الخادم يعيد { ok, errors[], warnings[] } وتفاصيل يعرضها المستدعي في الخانة summary.
 */
interface Issue { sheet?: string; row: number | null; label: string | null; messages: string[] }
export interface ImportReport { mode: 'check' | 'apply'; ok: boolean; errors: Issue[]; warnings: Issue[]; [k: string]: unknown }

const props = defineProps<{ title: string; intro: string; templateUrl: string; templateName: string; uploadUrl: string }>();
const emit = defineEmits<{ close: []; done: [report: ImportReport] }>();
const toast = useToast();
const file = ref<File | null>(null);
const input = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const report = ref<ImportReport | null>(null);
const saved = computed(() => report.value?.mode === 'apply' && report.value.ok);

async function template() {
  try { await downloadProtectedFile(props.templateUrl, props.templateName); } catch (e) { toast.error((e as Error).message); }
}
function pick(e: Event) { file.value = (e.target as HTMLInputElement).files?.[0] ?? null; report.value = null; }
async function send(mode: 'check' | 'apply') {
  if (!file.value) return;
  busy.value = true;
  try {
    const fd = new FormData();
    fd.append('file', file.value);
    fd.append('mode', mode);
    report.value = await api<ImportReport>(props.uploadUrl, { method: 'POST', body: fd });
    if (mode === 'apply' && report.value.ok) { toast.success('تم الاستيراد'); emit('done', report.value); }
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const where = (i: Issue) => [i.sheet ? `ورقة ${i.sheet}` : '', i.row ? `الصف ${i.row}` : '', i.label ?? ''].filter(Boolean).join(' · ');
</script>

<template>
  <div class="xi-back" @click.self="emit('close')">
    <div class="card xi-box" role="dialog" aria-modal="true">
      <header class="xi-head"><h2>{{ title }}</h2><button class="btn" @click="emit('close')">إغلاق</button></header>
      <p class="pm-sub">{{ intro }}</p>
      <ol class="xi-steps">
        <li><button class="btn" @click="template">⬇️ تنزيل النموذج</button> واملأه، أو استخدم ملفًا جاهزًا بالصيغة نفسها.</li>
        <li>
          <input ref="input" type="file" accept=".xlsx" @change="pick" />
          <button class="btn btn-primary" :disabled="!file || busy" @click="send('check')">{{ busy && !report ? 'جارٍ الفحص...' : 'فحص الملف' }}</button>
        </li>
      </ol>
      <section v-if="report" class="xi-report">
        <p v-if="saved" class="xi-ok">تم الحفظ. العناصر المستوردة مسودات، فراجعها وارفعها للاعتماد من شاشاتها.</p>
        <p v-else-if="report.ok" class="xi-ok">الملف سليم ولم يُحفظ شيء بعد. راجع الملخص ثم اضغط «حفظ».</p>
        <p v-else class="xi-bad">في الملف {{ report.errors.length }} خطأ. صححها ثم افحص الملف مرة أخرى. لم يُحفظ شيء.</p>
        <slot name="summary" :report="report" />
        <details v-if="report.errors.length" open><summary>الأخطاء ({{ report.errors.length }})</summary>
          <ul class="xi-list bad"><li v-for="(e, i) in report.errors" :key="i"><b>{{ where(e) }}</b>: {{ e.messages.join('، ') }}</li></ul>
        </details>
        <details v-if="report.warnings.length"><summary>تنبيهات ({{ report.warnings.length }})</summary>
          <ul class="xi-list"><li v-for="(w, i) in report.warnings" :key="i"><b>{{ where(w) }}</b>: {{ w.messages.join('، ') }}</li></ul>
        </details>
        <button v-if="report.ok && !saved" class="btn btn-primary" :disabled="busy" @click="send('apply')">{{ busy ? 'جارٍ الحفظ...' : 'حفظ' }}</button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.xi-back { position: fixed; inset: 0; background: rgba(15, 23, 42, .45); display: grid; place-items: center; z-index: 50; padding: 16px; }
.xi-box { width: min(860px, 100%); max-height: 90vh; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.xi-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.xi-head h2 { margin: 0; }
.xi-steps { margin: 0; padding-inline-start: 20px; display: grid; gap: 10px; }
.xi-steps li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.xi-report { display: grid; gap: 8px; border-top: 1px solid #e2e8f0; padding-top: 10px; }
.xi-ok { color: #047857; font-weight: 700; margin: 0; }
.xi-bad { color: #b91c1c; font-weight: 700; margin: 0; }
.xi-list { margin: 6px 0; padding-inline-start: 18px; line-height: 1.8; }
.xi-list.bad { color: #b91c1c; }
</style>
