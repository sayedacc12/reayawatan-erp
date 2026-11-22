<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref } from 'vue';
import { api, openProtectedFile } from '../../../api';
import { useToast } from '../../../stores/toast';
import { num } from '../lib';
import '../../../shared/module.css';
import '../../../shared/ws.css';
import '../website.css';

const toast = useToast();
const rows = ref<any[]>([]);
const services = ref<{ slug: string; title: string }[]>([]);
const edit = ref<any>(null);
const busy = ref(false);
async function load() { rows.value = await api<any[]>('/website/guides'); }
onMounted(async () => {
  await load().catch((e) => toast.error((e as Error).message));
  services.value = await api<any[]>('/website/services').catch(() => []);
});
function open(g?: any) {
  edit.value = g ? { ...g } : { slug: '', title: '', summary: '', serviceSlug: '', pages: null, published: false };
}
async function save() {
  busy.value = true;
  const e = edit.value;
  try {
    const r = await api<any>(e.id ? `/website/guides/${e.id}` : '/website/guides', { method: e.id ? 'PUT' : 'POST', json: {
      slug: e.slug, title: e.title, summary: e.summary, serviceSlug: e.serviceSlug || null, pages: e.pages || null, published: !!e.published,
    } });
    toast.success(e.id ? 'حُفظ الدليل' : 'أُنشئ الدليل، ارفعوا ملفه PDF ثم انشروه');
    edit.value = e.id ? null : r;
    await load();
  } catch (err) { toast.error((err as Error).message); } finally { busy.value = false; }
}
async function upload(g: any, kind: 'file' | 'cover', ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0];
  (ev.target as HTMLInputElement).value = '';
  if (!f) return;
  const fd = new FormData();
  fd.append('file', f);
  try {
    const r = await api<any>(`/website/guides/${g.id}/${kind}`, { method: 'POST', body: fd });
    toast.success(kind === 'file' ? 'رُفع ملف الدليل' : 'رُفعت صورة الغلاف');
    if (edit.value?.id === g.id) edit.value = { ...edit.value, ...r };
    await load();
  } catch (e) { toast.error((e as Error).message); }
}
async function remove(g: any) {
  if (!confirm(`حذف الدليل «${g.title}»؟ إن كان قد نُزّل فسيُخفى فقط ويبقى سجله.`)) return;
  try { const r = await api<any>(`/website/guides/${g.id}`, { method: 'DELETE' }); toast.success(r.hidden ? 'أُخفي الدليل' : 'حُذف الدليل'); await load(); } catch (e) { toast.error((e as Error).message); }
}
const kb = (n: number | null) => (n ? `${Math.round(n / 1024).toLocaleString('en-US')} ك.ب` : '');
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>مكتبة الأدلة المجانية</h1><p class="muted" style="margin: 4px 0 0">يحصل الزائر على الدليل مقابل بريده، فيصل لكم عميلًا محتملًا. الملف PDF حتى ١٠ ميجابايت.</p></div>
      <button class="btn btn-primary" @click="open()">+ دليل</button>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الدليل</th><th>الخدمة</th><th>الملف</th><th>التنزيلات</th><th>الحالة</th><th /></tr></thead>
        <tbody>
          <tr v-for="g in rows" :key="g.id">
            <td><b>{{ g.title }}</b><br><small class="muted" dir="ltr">{{ g.slug }}</small></td>
            <td>{{ services.find((s) => s.slug === g.serviceSlug)?.title ?? '—' }}</td>
            <td>
              <a v-if="g.fileKey" href="#" @click.prevent="openProtectedFile(`/website/guides/${g.id}/file`).catch((e) => toast.error(e.message))">{{ g.fileName }}</a>
              <span v-else class="muted">لم يُرفع</span>
              <br><small class="muted">{{ kb(g.fileSize) }}</small>
            </td>
            <td>{{ num(g.downloads) }}</td>
            <td><span class="ws-pill" :style="{ '--c': g.published ? '#067647' : '#94a3b8' }">{{ g.published ? 'منشور' : 'مسودة' }}</span></td>
            <td><button class="btn btn-sm" @click="open(g)">تعديل</button> <button class="btn btn-sm btn-danger" @click="remove(g)">حذف</button></td>
          </tr>
          <tr v-if="!rows.length"><td colspan="6" class="ws-empty">لا أدلة بعد. أضيفوا أول دليل.</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="edit" class="modal-backdrop" @click.self="edit = null">
      <div class="card modal">
        <h2 style="margin-bottom: 12px">{{ edit.id ? 'تعديل دليل' : 'دليل جديد' }}</h2>
        <div class="field"><label>العنوان</label><input v-model="edit.title" class="input"></div>
        <div class="field"><label>المعرّف في الرابط</label><input v-model="edit.slug" class="input" dir="ltr" placeholder="governance-checklist"></div>
        <div class="field"><label>نبذة</label><textarea v-model="edit.summary" class="input" rows="3" /></div>
        <div class="field"><label>الخدمة المرتبطة</label><select v-model="edit.serviceSlug" class="input"><option value="">—</option><option v-for="s in services" :key="s.slug" :value="s.slug">{{ s.title }}</option></select></div>
        <div class="field"><label>عدد الصفحات</label><input v-model.number="edit.pages" type="number" min="1" class="input"></div>
        <template v-if="edit.id">
          <div class="field"><label>ملف الدليل (PDF)</label><input type="file" accept="application/pdf" class="input" @change="upload(edit, 'file', $event)"><small class="muted">{{ edit.fileName || 'لم يُرفع ملف بعد' }}</small></div>
          <div class="field"><label>صورة الغلاف (اختيارية)</label><input type="file" accept="image/png,image/jpeg,image/webp" class="input" @change="upload(edit, 'cover', $event)"></div>
          <label class="check"><input v-model="edit.published" type="checkbox" :disabled="!edit.fileKey"> منشور في الموقع</label>
        </template>
        <div class="modal-actions" style="margin-top: 14px"><button class="btn btn-primary" :disabled="busy" @click="save">حفظ</button><button class="btn" @click="edit = null">إغلاق</button></div>
      </div>
    </div>
  </div>
</template>
