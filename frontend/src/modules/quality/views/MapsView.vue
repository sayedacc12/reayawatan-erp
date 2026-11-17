<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, STATUS_COLOR, errMsg, fmtDate, type DocRow } from '../lib';
import '../../projects/projects.css';
import '../quality.css';

interface MapRow {
  id: string; code: string; title: string; description: string | null; lanes: string[]; steps: number; version: number; updatedByName: string; updatedAt: string;
  document: { id: string; code: string; title: string; status: string; statusLabel: string; revisionLabel: string } | null;
}
const session = useSession();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const maps = ref<MapRow[]>([]);
const procedures = ref<DocRow[]>([]);
onMounted(async () => {
  maps.value = await api<MapRow[]>('/quality/maps');
  if (session.can(P.documents)) procedures.value = (await api<{ rows: DocRow[] }>('/quality/documents?type=procedure&external=0&status=active')).rows;
});
const form = reactive({ show: route.query.new === '1', title: '', documentId: String(route.query.doc ?? ''), lanes: 'المسؤول عن الإجراء، قسم الجودة' });
async function create() {
  try {
    const lanes = form.lanes.split(/[،,]+/).map((l) => l.trim()).filter(Boolean);
    const m = await api<{ id: string }>('/quality/maps', {
      method: 'POST', json: {
        title: form.title, documentId: form.documentId || null, lanes,
        steps: [
          { id: 's', kind: 'start', label: 'بداية الإجراء', lane: 0, next: [{ to: 'a' }] },
          { id: 'a', kind: 'task', label: 'الخطوة الأولى', lane: 0, next: [{ to: 'z' }] },
          { id: 'z', kind: 'end', label: 'نهاية الإجراء', lane: Math.min(1, lanes.length - 1), next: [] },
        ],
      },
    });
    router.push(`/quality/maps/${m.id}?edit=1`);
  } catch (e) {
    toast.error(errMsg(e));
  }
}
function pickDoc() {
  const d = procedures.value.find((x) => x.id === form.documentId);
  if (d && !form.title) form.title = `خريطة ${d.title}`;
}
</script>

<template>
  <div>
    <section class="pm-hero q-hero">
      <div><p class="pm-kicker">العمليات وتفاعلها · البند 4.4</p><h1>خرائط الإجراءات</h1>
        <p class="pm-sub">كل إجراء مرسوم كمخطط تدفق بمسارات للجهات المسؤولة، ومرتبط بوثيقة الإجراء ونماذجه. ارسمها وعدّلها من داخل النظام.</p></div>
      <div class="pm-actions"><button v-if="session.can(P.documents)" class="btn q-glow" @click="form.show = true">خريطة جديدة</button></div>
    </section>
    <div class="q-grid3">
      <RouterLink v-for="(m, i) in maps" :key="m.id" :to="`/quality/maps/${m.id}`" class="card pm-panel" :style="{ '--i': i, display: 'block', color: 'inherit' }">
        <div style="display: flex; justify-content: space-between; gap: 8px; align-items: flex-start">
          <span class="q-code">{{ m.code }}</span><span class="pm-tag">إصدار الرسم {{ m.version }}</span>
        </div>
        <h2 style="margin: 10px 0 6px">{{ m.title }}</h2>
        <svg viewBox="0 0 120 40" width="100%" height="46" aria-hidden="true" style="margin-bottom: 6px">
          <rect x="2" y="14" width="22" height="12" rx="6" fill="#10b981" />
          <path d="M24 20 H36" stroke="#94a3b8" />
          <rect x="36" y="12" width="22" height="16" rx="3" fill="none" stroke="#0f766e" />
          <path d="M58 20 H68" stroke="#94a3b8" />
          <polygon points="80,8 92,20 80,32 68,20" fill="#fff7ed" stroke="#f59e0b" />
          <path d="M92 20 H98" stroke="#94a3b8" />
          <rect x="98" y="14" width="20" height="12" rx="6" fill="#ef4444" />
        </svg>
        <div class="q-chips" style="margin-bottom: 8px"><span v-for="l in m.lanes" :key="l" class="pm-tag">{{ l }}</span></div>
        <p class="pm-muted">{{ m.steps }} خطوة · حدّثها {{ m.updatedByName }} {{ fmtDate(m.updatedAt) }}</p>
        <p v-if="m.document" class="pm-muted">الإجراء: <span class="q-code">{{ m.document.code }}</span> {{ m.document.revisionLabel }}
          <span class="pm-pill" :style="{ '--c': STATUS_COLOR[m.document.status] }">{{ m.document.statusLabel }}</span></p>
      </RouterLink>
    </div>
    <p v-if="!maps.length" class="q-empty">لا توجد خرائط بعد</p>
    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" @submit.prevent="create">
        <h2>خريطة إجراء جديدة</h2>
        <label class="field"><span>وثيقة الإجراء</span>
          <select v-model="form.documentId" class="input" @change="pickDoc"><option value="">بدون ربط</option><option v-for="d in procedures" :key="d.id" :value="d.id">{{ d.code }} · {{ d.title }}</option></select>
        </label>
        <label class="field"><span>العنوان</span><input v-model="form.title" class="input" required /></label>
        <label class="field"><span>الجهات المسؤولة (مسارات الخريطة) مفصولة بفاصلة</span><input v-model="form.lanes" class="input" /></label>
        <p class="pm-muted">ستبدأ الخريطة بثلاث خطوات (بداية، خطوة، نهاية)، ثم تضيف الخطوات والقرارات وتربطها بالنماذج من شاشة الرسم.</p>
        <div class="modal-actions"><button class="btn btn-primary">إنشاء والبدء بالرسم</button><button type="button" class="btn" @click="form.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
