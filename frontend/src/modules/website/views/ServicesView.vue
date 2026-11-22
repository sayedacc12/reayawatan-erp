<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import ValueEditor from '../components/ValueEditor.vue';
import '../../../shared/module.css';
import '../../../shared/ws.css';
import '../website.css';

const toast = useToast();
const rows = ref<any[]>([]);
const edit = ref<any>(null);
const busy = ref(false);
const ICONS = [['strategy', 'التخطيط'], ['gov', 'الحوكمة'], ['finance', 'المال'], ['tech', 'التقنية'], ['pm', 'المشاريع'], ['health', 'الصحة'], ['impact', 'القياس']];
const LIST_TPL = {
  deliverables: [{ title: '', desc: '' }], steps: [{ title: '', desc: '' }], shifts: [{ from: '', to: '' }], audience: [''], kpis: [''],
};
const LIST_LABELS: Record<string, string> = { deliverables: 'ماذا نقدم', steps: 'مراحل العمل', shifts: 'التحول (قبل ← بعد)', audience: 'لمن هذه الخدمة', kpis: 'مؤشرات الأثر التي نقيسها' };

async function load() { rows.value = await api<any[]>('/website/services'); }
onMounted(() => load().catch((e) => toast.error((e as Error).message)));
function open(s?: any) {
  edit.value = s ? JSON.parse(JSON.stringify(s)) : { slug: '', title: '', stage: '', icon: 'strategy', short: '', intro: '', value: '', deliverables: [], audience: [], steps: [], shifts: [], kpis: [], featured: false, published: false };
}
async function save() {
  busy.value = true;
  const e = edit.value;
  const body = { slug: e.slug, title: e.title, stage: e.stage, icon: e.icon, short: e.short, intro: e.intro, value: e.value, deliverables: e.deliverables, audience: e.audience, steps: e.steps, shifts: e.shifts, kpis: e.kpis, featured: e.featured, published: e.published };
  try {
    await api(e.id ? `/website/services/${e.id}` : '/website/services', { method: e.id ? 'PUT' : 'POST', json: body });
    toast.success('حُفظت الخدمة');
    edit.value = null;
    await load();
  } catch (err) { toast.error((err as Error).message); } finally { busy.value = false; }
}
async function move(i: number, d: number) {
  const ids = rows.value.map((r) => r.id);
  const [x] = ids.splice(i, 1);
  ids.splice(i + d, 0, x);
  try { rows.value = await api('/website/services/order', { method: 'PUT', json: { ids } }); } catch (e) { toast.error((e as Error).message); }
}
async function remove(s: any) {
  if (!confirm(`حذف خدمة «${s.title}» من الموقع؟ يمكنكم إخفاؤها بدل الحذف.`)) return;
  try { await api(`/website/services/${s.id}`, { method: 'DELETE' }); await load(); } catch (e) { toast.error((e as Error).message); }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>خدمات الموقع</h1><p class="muted" style="margin: 4px 0 0">المجالات بترتيب دورة العمل كما تظهر في الموقع ودورة القيمة وتقييم الجاهزية.</p></div>
      <button class="btn btn-primary" @click="open()">+ خدمة</button>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>#</th><th>الخدمة</th><th>المرحلة</th><th>المعرّف</th><th>الحالة</th><th /></tr></thead>
        <tbody>
          <tr v-for="(s, i) in rows" :key="s.id">
            <td>{{ i + 1 }}</td>
            <td><b>{{ s.title }}</b><br><small class="muted" style="white-space: normal">{{ s.value }}</small></td>
            <td>{{ s.stage }}</td>
            <td dir="ltr">{{ s.slug }}</td>
            <td><span class="ws-pill" :style="{ '--c': s.published ? '#067647' : '#94a3b8' }">{{ s.published ? 'منشورة' : 'مخفية' }}</span></td>
            <td>
              <button class="btn btn-sm" :disabled="i === 0" @click="move(i, -1)">↑</button>
              <button class="btn btn-sm" :disabled="i === rows.length - 1" @click="move(i, 1)">↓</button>
              <button class="btn btn-sm" @click="open(s)">تعديل</button>
              <button class="btn btn-sm btn-danger" @click="remove(s)">حذف</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="edit" class="modal-backdrop" @click.self="edit = null">
      <div class="card modal modal-wide">
        <h2 style="margin-bottom: 12px">{{ edit.id ? 'تعديل خدمة' : 'خدمة جديدة' }}</h2>
        <div class="rw-grid3">
          <div class="field"><label>اسم الخدمة</label><input v-model="edit.title" class="input"></div>
          <div class="field"><label>المعرّف في الرابط</label><input v-model="edit.slug" class="input" dir="ltr" placeholder="strategy"></div>
          <div class="field"><label>مرحلة دورة العمل</label><input v-model="edit.stage" class="input"></div>
        </div>
        <div class="field"><label>الأيقونة</label><select v-model="edit.icon" class="input"><option v-for="[k, l] in ICONS" :key="k" :value="k">{{ l }}</option></select></div>
        <div class="field"><label>الأثر المستهدف (جملة القيمة)</label><input v-model="edit.value" class="input"></div>
        <div class="field"><label>وصف مختصر</label><input v-model="edit.short" class="input"></div>
        <div class="field"><label>المقدمة في صفحة الخدمة</label><textarea v-model="edit.intro" class="input" rows="3" /></div>
        <ValueEditor v-for="(tpl, k) in LIST_TPL" :key="k" v-model="edit[k]" :tpl="tpl" :path="String(k)" :label="LIST_LABELS[k]" />
        <label class="check"><input v-model="edit.featured" type="checkbox"> تخصصنا (تمييز في الموقع)</label>
        <label class="check" style="margin-inline-start: 16px"><input v-model="edit.published" type="checkbox"> منشورة في الموقع</label>
        <div class="modal-actions" style="margin-top: 14px"><button class="btn btn-primary" :disabled="busy" @click="save">حفظ</button><button class="btn" @click="edit = null">إغلاق</button></div>
      </div>
    </div>
  </div>
</template>
