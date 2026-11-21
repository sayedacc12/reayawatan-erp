<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import '../../../shared/module.css';
import '../../../shared/ws.css';
import '../website.css';

const toast = useToast();
const tab = ref<'notify' | 'roles'>('notify');
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
    <ModulePermissionsPane v-else-if="tab === 'roles'" module="website" />
  </div>
</template>
