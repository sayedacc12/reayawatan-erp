<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import ValueEditor from '../components/ValueEditor.vue';
import { SECTIONS } from '../sections';
import '../../../shared/module.css';
import '../../../shared/ws.css';
import '../website.css';

const toast = useToast();
const all = ref<any[]>([]);
const tab = ref('home');
const draft = ref<any>(null);
const busy = ref(false);
const sec = computed(() => SECTIONS.find((s) => s.key === tab.value)!);
const row = computed(() => all.value.find((s) => s.key === tab.value));
async function load() {
  all.value = await api<any[]>('/website/content');
  pick(tab.value);
}
function pick(k: string) {
  tab.value = k;
  const r = all.value.find((s) => s.key === k);
  draft.value = r ? JSON.parse(JSON.stringify(r.data)) : null;
}
onMounted(() => load().catch((e) => toast.error((e as Error).message)));
const groups = computed(() => sec.value.groups ?? [{ label: '', keys: Object.keys(row.value?.defaults ?? {}) }]);
async function save() {
  busy.value = true;
  try {
    await api(`/website/content/${tab.value}`, { method: 'PUT', json: { data: draft.value } });
    toast.success('حُفظ المحتوى وظهر في الموقع');
    await load();
  } catch (e) { toast.error((e as Error).message); } finally { busy.value = false; }
}
async function reset() {
  if (!confirm('إرجاع هذه الصفحة إلى النص الأصلي من تصميم الموقع؟')) return;
  try { await api(`/website/content/${tab.value}`, { method: 'DELETE' }); toast.success('أُعيد النص الأصلي'); await load(); } catch (e) { toast.error((e as Error).message); }
}
const PAGE_URL: Record<string, string> = { home: '/', about: '/about', contact: '/contact', assessment: '/assess', guides: '/guides' };
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>صفحات الموقع</h1><p class="muted" style="margin: 4px 0 0">عدّلوا نصوص الموقع هنا وتظهر فورًا. النص بين <code v-pre>{{ }}</code> يظهر مظللًا كبيان «يُستكمل» أو «ينتظر الاعتماد».</p></div>
      <div style="display: flex; gap: 8px">
        <a :href="PAGE_URL[tab]" target="_blank" class="btn">معاينة ↗</a>
        <button class="btn" @click="reset">النص الأصلي</button>
        <button class="btn btn-primary" :disabled="busy" @click="save">حفظ ونشر</button>
      </div>
    </div>
    <div class="ws-tabs"><button v-for="s in SECTIONS" :key="s.key" :class="['ws-tab', { on: tab === s.key }]" @click="pick(s.key)">{{ s.label }}</button></div>
    <p class="ws-muted">{{ sec.hint }}<span v-if="row?.updatedAt"> · آخر تعديل {{ new Date(row.updatedAt).toLocaleString('ar-SA-u-nu-latn') }}</span></p>
    <template v-if="draft && row">
      <section v-for="g in groups" :key="g.label" class="card ws-panel">
        <h2 v-if="g.label">{{ g.label }}</h2>
        <ValueEditor v-for="k in g.keys" :key="k" v-model="draft[k]" :tpl="row.defaults[k]" :path="k" />
      </section>
      <div class="ws-actions"><button class="btn btn-primary" :disabled="busy" @click="save">حفظ ونشر</button></div>
    </template>
  </div>
</template>
