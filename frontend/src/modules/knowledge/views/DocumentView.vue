<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, openProtectedFile } from '../../../api';
import { useToast } from '../../../stores/toast';
import DocForm from '../components/DocForm.vue';
import { STATUS_COLOR, TYPE_ICON, fmtDate, fmtDateTime, todayStr } from '../lib';
import '../../website/website.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id: string }>();
const router = useRouter();
const toast = useToast();
const d = ref<any>(null);
const lookups = ref<any>(null);
const editing = ref(false);
const versioning = ref(false);
const ver = ref({ version: '', issuedOn: todayStr(), note: '' });
const verFile = ref<File | null>(null);
const busy = ref(false);

async function load() {
  try {
    [d.value, lookups.value] = await Promise.all([api(`/knowledge/documents/${props.id}`), lookups.value ?? api('/knowledge/lookups')]);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
const open = (v?: number) => openProtectedFile(`/knowledge/documents/${props.id}/file${v === undefined ? '' : `?v=${v}`}`).catch((e) => toast.error(e.message));
async function setStatus(status: string, visibility: string) {
  busy.value = true;
  try {
    d.value = await api(`/knowledge/documents/${props.id}/status`, { method: 'POST', json: { status, visibility } });
    toast.success('حُدثت حالة الوثيقة');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function newVersion() {
  busy.value = true;
  try {
    const fd = new FormData();
    fd.append('version', ver.value.version);
    if (ver.value.issuedOn) fd.append('issuedOn', ver.value.issuedOn);
    if (ver.value.note) fd.append('note', ver.value.note);
    if (verFile.value) fd.append('file', verFile.value);
    d.value = await api(`/knowledge/documents/${props.id}/version`, { method: 'POST', body: fd });
    versioning.value = false;
    toast.success('صدر الإصدار الجديد وحُفظ السابق في السجل');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function remove() {
  if (!confirm('حذف المسودة نهائيًا؟')) return;
  try {
    await api(`/knowledge/documents/${props.id}`, { method: 'DELETE' });
    router.push('/knowledge');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const ACTION: Record<string, string> = { create: 'إنشاء', update: 'تعديل البيانات', file: 'رفع الملف', version: 'إصدار جديد' };
const actionLabel = (a: string) => (a.startsWith('status:') ? a.slice(7) : ACTION[a] ?? a);
</script>

<template>
  <div v-if="d">
    <RouterLink to="/knowledge" class="ws-link">‹ أرشيف المعرفة</RouterLink>
    <div class="doc-head card" :style="{ '--c': d.categoryColor }">
      <span class="doc-type">{{ TYPE_ICON[d.docType] ?? '•' }}</span>
      <div style="flex: 1; min-width: 240px">
        <small class="muted">{{ d.typeLabel }} · {{ d.categoryName ?? 'بدون تصنيف' }}<template v-if="d.code"> · <span class="ws-code">{{ d.code }}</span></template></small>
        <h1>{{ d.title }}</h1>
        <div class="ws-row" style="margin: 6px 0 0">
          <span class="ws-pill" :style="{ '--c': STATUS_COLOR[d.status] }">{{ d.statusLabel }}</span>
          <span class="ws-pill" :style="{ '--c': d.visibility === 'public' ? '#0ea5e9' : '#64748b' }">{{ d.visibility === 'public' ? 'منشورة في الموقع' : 'داخلية' }}</span>
          <span v-if="d.reviewDue" class="ws-pill" style="--c: #f97316">حان موعد المراجعة</span>
          <span class="muted" style="font-size: .85rem">الإصدار {{ d.version }} · 👁 {{ d.views }} · ⤓ {{ d.downloads }}</span>
        </div>
      </div>
      <div class="ws-actions" style="margin: 0">
        <button v-if="d.hasFile" class="btn btn-primary" @click="open()">فتح الملف</button>
        <a v-if="d.externalUrl" :href="d.externalUrl" target="_blank" rel="noopener" class="btn">فتح الرابط ↗</a>
        <button v-if="d.can.edit" class="btn" @click="editing = true">تعديل</button>
        <button v-if="d.can.edit" class="btn" @click="versioning = true; ver.version = ''">إصدار جديد</button>
        <button v-if="d.can.remove" class="btn btn-danger" @click="remove">حذف</button>
      </div>
    </div>

    <div class="ws-side">
      <div>
        <section v-if="d.summary || d.content" class="card ws-panel">
          <p v-if="d.summary" class="lead">{{ d.summary }}</p>
          <div v-if="d.content" class="doc-content">{{ d.content }}</div>
        </section>
        <section v-if="!d.hasFile && !d.content && !d.externalUrl" class="ws-note">لا يوجد ملف أو محتوى بعد. أضف الملف من «تعديل» قبل النشر.</section>
        <section class="card ws-panel">
          <h2>سجل الإصدارات</h2>
          <table class="table">
            <thead><tr><th>الإصدار</th><th>تاريخ الإصدار</th><th>الملف</th><th /></tr></thead>
            <tbody>
              <tr><td><strong>{{ d.version }}</strong> <span class="ws-pill" style="--c: #10b981">الحالي</span></td><td>{{ fmtDate(d.issuedOn) }}</td><td>{{ d.fileName ?? '—' }}</td><td><button v-if="d.hasFile" class="btn btn-sm" @click="open()">فتح</button></td></tr>
              <tr v-for="v in [...d.versions].reverse()" :key="v.index"><td>{{ v.version }}</td><td>{{ fmtDate(v.issuedOn) }}</td><td>{{ v.fileName ?? '—' }}</td><td><button v-if="v.hasFile" class="btn btn-sm" @click="open(v.index)">فتح</button></td></tr>
            </tbody>
          </table>
        </section>
      </div>
      <aside>
        <section class="card ws-panel">
          <h2>البيانات</h2>
          <dl class="doc-dl">
            <dt>الجهة المالكة</dt><dd>{{ d.ownerName ?? '—' }}</dd>
            <dt>الجهة المعتمدة</dt><dd>{{ d.approvedBy ?? '—' }}</dd>
            <dt>تاريخ الإصدار</dt><dd>{{ fmtDate(d.issuedOn) }}</dd>
            <dt>المراجعة القادمة</dt><dd :style="{ color: d.reviewDue ? '#ea580c' : '' }">{{ fmtDate(d.reviewOn) }}</dd>
            <dt>أضافها</dt><dd>{{ d.createdByName }}</dd>
          </dl>
          <div v-if="d.tags.length" class="ws-row"><span v-for="t in d.tags" :key="t" class="badge">{{ t }}</span></div>
        </section>
        <section v-if="d.can.publish" class="card ws-panel">
          <h2>النشر</h2>
          <p class="ws-muted">المنشورة يراها كل موظف معه صلاحية التصفح، والمنشورة في الموقع تظهر في صفحة الحوكمة والشفافية.</p>
          <div class="ws-actions" style="flex-direction: column">
            <button v-if="d.status !== 'published' || d.visibility !== 'internal'" class="btn" :disabled="busy" @click="setStatus('published', 'internal')">نشر داخليًا فقط</button>
            <button v-if="d.status !== 'published' || d.visibility !== 'public'" class="btn btn-primary" :disabled="busy" @click="setStatus('published', 'public')">نشر في الموقع الإلكتروني</button>
            <button v-if="d.status === 'published'" class="btn" :disabled="busy" @click="setStatus('archived', 'internal')">أرشفة (إيقاف العمل بها)</button>
            <button v-if="d.status === 'archived'" class="btn" :disabled="busy" @click="setStatus('draft', 'internal')">إعادتها مسودة</button>
          </div>
        </section>
        <section class="card ws-panel">
          <h2>السجل</h2>
          <ul class="ws-log"><li v-for="(l, i) in d.log" :key="i"><div><strong>{{ actionLabel(l.action) }}</strong> <span class="muted">· {{ l.byName }} · {{ fmtDateTime(l.at) }}</span><div v-if="l.note" class="muted">{{ l.note }}</div></div></li></ul>
        </section>
      </aside>
    </div>

    <DocForm v-if="editing && lookups" :doc="d" :lookups="lookups" @close="editing = false" @saved="(x) => { d = x; editing = false; }" />
    <div v-if="versioning" class="modal-backdrop" @click.self="versioning = false">
      <div class="modal card">
        <h2 style="margin-bottom: 12px">إصدار جديد</h2>
        <p class="ws-muted">يُحفظ الإصدار الحالي ({{ d.version }}) وملفه في سجل الإصدارات، ويصبح الجديد هو المعتمد.</p>
        <div class="ws-grid2">
          <label class="field"><span>رقم الإصدار الجديد *</span><input v-model="ver.version" class="input" dir="ltr" placeholder="مثل: 2.0" /></label>
          <label class="field"><span>تاريخ الإصدار</span><input v-model="ver.issuedOn" type="date" class="input" /></label>
        </div>
        <label class="field"><span>ملف الإصدار الجديد</span><input type="file" accept="application/pdf,image/*" class="input" @change="verFile = ($event.target as HTMLInputElement).files?.[0] ?? null" /></label>
        <label class="field"><span>ما الذي تغير؟</span><input v-model="ver.note" class="input" /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy || !ver.version" @click="newVersion">إصدار</button><button class="btn" @click="versioning = false">إلغاء</button></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.doc-head { display: flex; gap: 14px; align-items: center; padding: 18px; margin: 10px 0 16px; flex-wrap: wrap; border-top: 4px solid var(--c); }
.doc-head h1 { font-size: 1.35rem; margin-top: 2px; }
.doc-type { width: 54px; height: 54px; border-radius: 16px; display: grid; place-items: center; font-size: 1.6rem; color: var(--c); background: color-mix(in srgb, var(--c) 12%, white); }
.lead { font-size: 1.02rem; margin: 0 0 8px; }
.doc-content { white-space: pre-wrap; line-height: 1.9; }
.doc-dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0 0 8px; font-size: .9rem; }
.doc-dl dt { color: var(--muted); }
.doc-dl dd { margin: 0; }
</style>
