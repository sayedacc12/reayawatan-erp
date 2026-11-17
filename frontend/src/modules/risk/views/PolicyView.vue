
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { fmtDate, fmtDateTime, P, todayStr } from '../lib';
import '../../projects/projects.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Section { key: string; title: string; body: string }
const session = useSession();
const toast = useToast();
const data = ref<any>(null);
const sections = ref<Section[]>([]);
const tab = ref<'read' | 'edit' | 'history'>('read');
const active = ref(0);
const old = ref<any>(null);
const meta = ref({ effectiveDate: todayStr(), note: '', approvedBy: '' });
const canEdit = computed(() => session.can(P.policy));
const CHANGE: Record<string, { label: string; color: string }> = { added: { label: 'أُضيف', color: '#10b981' }, modified: { label: 'عُدّل', color: '#f59e0b' }, removed: { label: 'حُذف', color: '#ef4444' } };
function take(d: any) {
  data.value = d;
  sections.value = d.sections.map((s: Section) => ({ ...s }));
}
onMounted(async () => take(await api('/risk/policy')));
const dirty = computed(() => JSON.stringify(sections.value) !== JSON.stringify(data.value?.sections));
function addSection() {
  sections.value.push({ key: `s${Date.now().toString(36)}`, title: 'باب جديد', body: '' });
  active.value = sections.value.length - 1;
}
function move(i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= sections.value.length) return;
  [sections.value[i], sections.value[j]] = [sections.value[j], sections.value[i]];
  active.value = j;
}
async function save() {
  try {
    take(await api('/risk/policy', { method: 'PUT', json: { sections: sections.value, effectiveDate: meta.value.effectiveDate, note: meta.value.note, approvedBy: meta.value.approvedBy || null } }));
    meta.value.note = '';
    toast.success(`اعتُمد الإصدار ${data.value.current.version} من سياسة المخاطر`);
    tab.value = 'read';
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function view(v: number) {
  try {
    old.value = await api(`/risk/policy/versions/${v}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div v-if="data">
    <section class="pm-hero rk-hero">
      <div><p class="pm-kicker">سياسة إدارة المخاطر والتغيير والالتزام{{ data.current ? ` · الإصدار ${data.current.version}` : ' · المقترحة من النظام' }}</p>
        <h1>السياسة واللائحة المعتمدة</h1>
        <p class="pm-sub">نص مفتوح تعدّله الجمعية حسب ما يعتمده مجلس الإدارة. كل حفظ يصبح إصدارًا جديدًا بتاريخ سريانه وملخص لما تغير، ويبقى كل إصدار سابق متاحًا للرجوع إليه.</p></div>
      <div v-if="data.current" class="pm-actions"><span class="pm-pill" style="--c: #10b981; background: rgba(255,255,255,.9)">سارية من {{ fmtDate(data.current.effectiveDate) }}</span></div>
    </section>
    <div class="rk-tabs">
      <button :class="['rk-tab', { on: tab === 'read' }]" @click="tab = 'read'">قراءة السياسة</button>
      <button v-if="canEdit" :class="['rk-tab', { on: tab === 'edit' }]" @click="tab = 'edit'">تعديل وإصدار جديد</button>
      <button :class="['rk-tab', { on: tab === 'history' }]" @click="tab = 'history'">سجل الإصدارات ({{ data.history.length }})</button>
    </div>
    <p v-if="!data.current" class="rk-warn" style="margin-bottom: 14px">هذه هي السياسة المقترحة من النظام، ولم تُعتمد بعد. راجعها وعدّلها ثم احفظها كإصدار أول.</p>

    <div v-if="tab === 'read'" class="rk-grid" style="grid-template-columns: 240px 1fr">
      <nav class="card pm-panel" style="align-self: start; position: sticky; top: 12px">
        <a v-for="(s, i) in data.sections" :key="s.key" :href="`#sec-${s.key}`" class="pm-link" style="display: block; padding: 4px 0">{{ i + 1 }}. {{ s.title }}</a>
      </nav>
      <article class="card pm-panel">
        <section v-for="(s, i) in data.sections" :id="`sec-${s.key}`" :key="s.key" style="margin-bottom: 18px">
          <h2>{{ i + 1 }}. {{ s.title }}</h2><p class="rk-pre">{{ s.body }}</p>
        </section>
      </article>
    </div>

    <div v-else-if="tab === 'edit'" class="rk-grid" style="grid-template-columns: 260px 1fr">
      <section class="card pm-panel" style="align-self: start">
        <h2>الأبواب</h2>
        <div v-for="(s, i) in sections" :key="s.key" style="display: flex; gap: 4px; align-items: center; margin-bottom: 4px">
          <button :class="['rk-tab', { on: active === i }]" style="flex: 1; text-align: start; border-radius: 10px" @click="active = i">{{ i + 1 }}. {{ s.title }}</button>
          <button class="btn btn-sm" :disabled="i === 0" @click="move(i, -1)">▲</button>
          <button class="btn btn-sm" :disabled="i === sections.length - 1" @click="move(i, 1)">▼</button>
        </div>
        <button class="btn btn-sm" @click="addSection">+ باب</button>
      </section>
      <div style="display: grid; gap: 16px; align-content: start">
        <section v-if="sections[active]" class="card pm-panel">
          <label class="field"><span>عنوان الباب</span><input v-model="sections[active].title" class="input" /></label>
          <label class="field"><span>النص</span><textarea v-model="sections[active].body" class="input" rows="16" style="line-height: 1.9" /></label>
          <button class="btn btn-sm" style="color: var(--danger)" :disabled="sections.length === 1" @click="sections.splice(active, 1); active = 0">حذف هذا الباب</button>
        </section>
        <section class="card pm-panel">
          <h2>اعتماد الإصدار {{ (data.current?.version ?? 0) + 1 }}</h2>
          <div class="rk-fields">
            <label class="field"><span>تاريخ السريان</span><input v-model="meta.effectiveDate" type="date" class="input" /></label>
            <label class="field"><span>جهة الاعتماد (مثل: مجلس الإدارة)</span><input v-model="meta.approvedBy" class="input" /></label>
          </div>
          <label class="field"><span>ملخص التعديل (يظهر في سجل الإصدارات)</span><input v-model="meta.note" class="input" placeholder="مثل: تحديث حد قابلية المخاطر بقرار المجلس رقم 12" /></label>
          <div class="modal-actions"><button class="btn btn-primary" :disabled="!dirty && !!data.current" @click="save">حفظ كإصدار جديد</button></div>
          <p v-if="!dirty && data.current" class="pm-muted">لم تعدّل شيئًا بعد.</p>
        </section>
      </div>
    </div>

    <section v-else class="card pm-panel">
      <h2>سجل إصدارات السياسة</h2>
      <p v-if="!data.history.length" class="pm-empty">لم يُعتمد أي إصدار بعد</p>
      <table v-else class="table">
        <thead><tr><th>الإصدار</th><th>السريان</th><th>جهة الاعتماد</th><th>ملخص التعديل</th><th>الأبواب المتغيرة</th><th>حفظه</th><th /></tr></thead>
        <tbody><tr v-for="h in data.history" :key="h.version">
          <td><b>{{ h.version }}</b></td><td>{{ fmtDate(h.effectiveDate) }}</td><td>{{ h.approvedBy ?? '—' }}</td><td style="white-space: normal">{{ h.note }}</td>
          <td style="white-space: normal"><span v-for="(c, i) in h.changedSections" :key="i" class="pm-pill" :style="{ '--c': CHANGE[c.change].color, margin: '2px' }">{{ CHANGE[c.change].label }}: {{ c.title }}</span></td>
          <td>{{ h.createdByName }}<br /><span class="pm-muted">{{ fmtDateTime(h.createdAt) }}</span></td>
          <td><button class="btn btn-sm" @click="view(h.version)">عرض النص</button></td>
        </tr></tbody>
      </table>
    </section>

    <div v-if="old" class="modal-backdrop" @click.self="old = null">
      <div class="card modal" style="max-width: 860px; max-height: 85vh; overflow: auto">
        <h2>نص الإصدار {{ old.version }} <span class="pm-muted" style="font-size: .85rem">سارٍ من {{ fmtDate(old.effectiveDate) }}</span></h2>
        <section v-for="(s, i) in old.sections" :key="s.key" style="margin-bottom: 14px"><h3>{{ i + 1 }}. {{ s.title }}</h3><p class="rk-pre">{{ s.body }}</p></section>
        <div class="modal-actions"><button class="btn" @click="old = null">إغلاق</button></div>
      </div>
    </div>
  </div>
</template>
