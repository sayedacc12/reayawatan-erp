<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, fmtDate, fmtDateTime, todayStr } from '../lib';
import '../../../shared/module.css';
import '../volunteers.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Kind = 'policy' | 'charter';
const session = useSession();
const toast = useToast();
const docs = ref<Record<Kind, any> | null>(null);
const kind = ref<Kind>('policy');
const editing = ref(false);
const draft = ref<{ title: string; sections: { title: string; body: string }[] }>({ title: '', sections: [] });
const effectiveDate = ref(todayStr());
const note = ref('');
const canEdit = computed(() => session.can(P.policy));
const doc = computed(() => docs.value?.[kind.value]);
onMounted(async () => {
  try {
    docs.value = await api('/volunteers/documents');
  } catch (e) {
    toast.error((e as Error).message);
  }
});
function edit() {
  draft.value = JSON.parse(JSON.stringify({ title: doc.value.title, sections: doc.value.sections }));
  editing.value = true;
}
function move(i: number, d: number) {
  const s = draft.value.sections;
  const j = i + d;
  if (j < 0 || j >= s.length) return;
  [s[i], s[j]] = [s[j], s[i]];
}
async function save() {
  try {
    docs.value = await api(`/volunteers/documents/${kind.value}`, { method: 'PUT', json: { ...draft.value, effectiveDate: effectiveDate.value, note: note.value || null } });
    editing.value = false;
    note.value = '';
    toast.success(`اعتُمد الإصدار ${doc.value.current.version}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const printNow = () => window.print();
</script>

<template>
  <div v-if="docs">
    <section class="pm-hero vt-hero no-print">
      <div><p class="pm-kicker">{{ doc.title }}{{ doc.current ? ` · الإصدار ${doc.current.version}` : ' · مسودة مقترحة' }}</p>
        <h1>لائحة التطوع وميثاقه</h1>
        <p class="pm-sub">تأتي بمسودة مقترحة تراجعها الشركة وتعدّل أقسامها بحرية ثم تعتمدها. كل اعتماد إصدار جديد بتاريخه، والميثاق يظهر للمتطوع عند التسجيل.</p></div>
      <div class="pm-actions">
        <button class="btn vt-ghost" @click="printNow">طباعة</button>
        <button v-if="canEdit && !editing" class="btn vt-glow" @click="edit">تعديل واعتماد إصدار جديد</button>
      </div>
    </section>
    <div class="vt-tabs no-print">
      <button :class="['vt-tab', { on: kind === 'policy' }]" @click="kind = 'policy'; editing = false">لائحة التطوع</button>
      <button :class="['vt-tab', { on: kind === 'charter' }]" @click="kind = 'charter'; editing = false">ميثاق التطوع</button>
    </div>
    <div v-if="!doc.current && !editing" class="alert alert-error no-print">هذه مسودة مقترحة ولم تعتمدها الشركة بعد.</div>
    <div class="vt-grid">
      <section v-if="!editing" class="card pm-panel vt-print">
        <h2 style="justify-content: center; font-size: 1.3rem">{{ doc.title }}</h2>
        <p v-if="doc.current" class="pm-muted" style="text-align: center">الإصدار {{ doc.current.version }} · سارية من {{ fmtDate(doc.current.effectiveDate) }}</p>
        <div v-for="(s, i) in doc.sections" :key="i" style="margin-bottom: 14px">
          <h3 style="color: #065f46; margin: 0 0 4px">{{ i + 1 }}. {{ s.title }}</h3>
          <p class="vt-pre">{{ s.body }}</p>
        </div>
      </section>
      <section v-else class="card pm-panel">
        <label class="field"><span>عنوان الوثيقة</span><input v-model="draft.title" class="input" /></label>
        <div v-for="(s, i) in draft.sections" :key="i" class="card" style="padding: 12px; margin-bottom: 10px">
          <div style="display: flex; gap: 6px; align-items: center">
            <span class="pm-tag">{{ i + 1 }}</span><input v-model="s.title" class="input" placeholder="عنوان القسم" />
            <button class="btn btn-sm" :disabled="i === 0" @click="move(i, -1)">▲</button>
            <button class="btn btn-sm" :disabled="i === draft.sections.length - 1" @click="move(i, 1)">▼</button>
            <button class="btn btn-sm btn-danger" @click="draft.sections.splice(i, 1)">✕</button>
          </div>
          <textarea v-model="s.body" class="input" rows="4" style="margin-top: 6px" placeholder="نص القسم (كل سطر بند)" />
        </div>
        <button class="btn btn-sm" @click="draft.sections.push({ title: '', body: '' })">+ قسم جديد</button>
        <button class="btn btn-sm" style="margin-inline-start: 6px" @click="draft = JSON.parse(JSON.stringify(doc.defaults))">استعادة المسودة المقترحة</button>
        <div class="vt-sec">الاعتماد</div>
        <div class="pm-grid2">
          <label class="field"><span>تاريخ الاعتماد</span><input v-model="effectiveDate" type="date" class="input" /></label>
          <label class="field"><span>ملاحظة (مثل: قرار مجلس الإدارة)</span><input v-model="note" class="input" /></label>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" @click="save">اعتماد الإصدار</button><button class="btn" @click="editing = false">إلغاء</button></div>
      </section>
      <section class="card pm-panel no-print">
        <h2>سجل الإصدارات</h2>
        <ul class="vt-log">
          <li v-for="h in doc.history" :key="h.version" style="--c: #10b981"><b>الإصدار {{ h.version }}</b> · سارٍ من {{ fmtDate(h.effectiveDate) }}
            <span class="pm-muted" style="display: block">{{ h.approvedByName }} · {{ fmtDateTime(h.createdAt) }}</span><span v-if="h.note" style="display: block">{{ h.note }}</span></li>
          <li v-if="!doc.history.length" class="pm-muted">لم يُعتمد أي إصدار بعد</li>
        </ul>
      </section>
    </div>
  </div>
</template>
