<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { riyadh } from '../lib';
import '../../../shared/module.css';
import '../../../shared/ws.css';
import '../website.css';

const toast = useToast();
const tab = ref<'notify' | 'history' | 'roles'>('notify');
const history = ref<any[] | null>(null);
const AREA: Record<string, string> = { content: 'محتوى الصفحات', service: 'الخدمات', guide: 'الأدلة' };
const ACTION: Record<string, string> = {
  save: 'حفظ', reset: 'إرجاع للأصل', create: 'إضافة', update: 'تعديل', delete: 'حذف', hide: 'إخفاء', upload: 'رفع ملف', order: 'ترتيب',
};
/** الحقول التي تغيرت بين النسختين */
function changes(e: any) {
  const b = e.before ?? {}, a = e.after ?? {};
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => ({ k, b: show(b[k]), a: show(a[k]) }));
}
function show(v: unknown) {
  if (v === undefined || v === null || v === '') return '—';
  const t = typeof v === 'string' ? v : JSON.stringify(v);
  return t.length > 300 ? `${t.slice(0, 300)}…` : t;
}
async function openHistory() {
  tab.value = 'history';
  try { history.value = await api<any[]>('/website/content-history'); } catch (e) { toast.error((e as Error).message); }
}
const n = ref<any>(null);
const emails = ref('');
const busy = ref(false);
onMounted(async () => {
  try {
    const secs = await api<any[]>('/website/content');
    n.value = secs.find((s) => s.key === 'notify').data;
    emails.value = n.value.emails.join('\n');
  } catch (e) { toast.error((e as Error).message); }
});
async function save() {
  busy.value = true;
  try {
    await api('/website/content/notify', { method: 'PUT', json: { data: { emails: emails.value.split(/[\n,،]/).map((x) => x.trim()).filter(Boolean), confirmVisitor: n.value.confirmVisitor } } });
    toast.success('حُفظت الإعدادات');
  } catch (e) { toast.error((e as Error).message); } finally { busy.value = false; }
}
</script>

<template>
  <div>
    <div class="page-head"><h1>إعدادات الموقع</h1></div>
    <div class="ws-tabs">
      <button :class="['ws-tab', { on: tab === 'notify' }]" @click="tab = 'notify'">إشعارات الفريق</button>
      <button :class="['ws-tab', { on: tab === 'history' }]" @click="openHistory">سجل التعديلات</button>
      <button :class="['ws-tab', { on: tab === 'roles' }]" @click="tab = 'roles'">الصلاحيات</button>
    </div>
    <section v-if="tab === 'notify' && n" class="card ws-panel">
      <h2>من يصله إشعار بكل طلب جديد من الموقع؟</h2>
      <p class="ws-muted">عنوان في كل سطر (حتى عشرة). إن تُركت فارغة يصل الإشعار لمدير المنظمة. الطلبات تظهر أيضًا في جرس المهام لمن يملك صلاحية متابعة العملاء المحتملين.</p>
      <div class="field"><textarea v-model="emails" class="input" rows="4" dir="ltr" placeholder="sales@reayawatan.com" /></div>
      <label class="check"><input v-model="n.confirmVisitor" type="checkbox"> إرسال نسخة للزائر بنتيجته أو تأكيد طلبه</label>
      <p class="ws-muted" style="margin-top: 10px">يتطلب الإرسال ضبط البريد الصادر على السيرفر (SMTP). بدونه تُحفظ الطلبات وتظهر في النظام دون بريد.</p>
      <div class="ws-actions"><button class="btn btn-primary" :disabled="busy" @click="save">حفظ</button></div>
    </section>
    <section v-else-if="tab === 'history'" class="card table-wrap">
      <table class="table">
        <thead><tr><th>التاريخ</th><th>بواسطة</th><th>القسم</th><th>الإجراء</th><th>ما تغيّر</th></tr></thead>
        <tbody>
          <tr v-for="e in history ?? []" :key="e.id">
            <td>{{ riyadh(e.createdAt) }}</td>
            <td>{{ e.userName ?? '—' }}</td>
            <td>{{ AREA[e.area] ?? e.area }}<br><small v-if="e.target" class="muted" dir="ltr">{{ e.target }}</small></td>
            <td>{{ ACTION[e.action] ?? e.action }}</td>
            <td>
              <details v-if="changes(e).length">
                <summary>{{ changes(e).length }} حقل</summary>
                <div v-for="c in changes(e)" :key="c.k" style="margin-top: 6px">
                  <b dir="ltr">{{ c.k }}</b>
                  <div class="muted">قبل: {{ c.b }}</div>
                  <div>بعد: {{ c.a }}</div>
                </div>
              </details>
              <span v-else class="muted">—</span>
            </td>
          </tr>
          <tr v-if="history && !history.length"><td colspan="5" class="ws-empty">لا توجد تعديلات بعد.</td></tr>
        </tbody>
      </table>
    </section>
    <ModulePermissionsPane v-else-if="tab === 'roles'" module="website" />
  </div>
</template>
