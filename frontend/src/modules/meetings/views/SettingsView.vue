<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import '../../projects/projects.css';
import '../../comms/comms.css';
import '../meetings.css';

const route = useRoute();
const toast = useToast();
const tab = ref<'general' | 'permissions'>(route.query.tab === 'permissions' ? 'permissions' : 'general');
const f = reactive({ signDays: 5, taskDays: 30, defaultQuorum: 51, minutesFooter: '' });
const busy = ref(false);
const error = ref('');
onMounted(async () => {
  try {
    const s = await api<typeof f & { minutesFooter: string | null }>('/meetings/settings');
    Object.assign(f, { ...s, minutesFooter: s.minutesFooter ?? '' });
  } catch (e) {
    error.value = (e as Error).message;
  }
});
async function save() {
  busy.value = true;
  try {
    await api('/meetings/settings', { method: 'PUT', json: { ...f, minutesFooter: f.minutesFooter || null } });
    toast.success('حُفظت الإعدادات');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <section class="pm-hero mt-hero">
      <p class="pm-kicker">الاجتماعات واللجان</p>
      <h1>الإعدادات</h1>
      <p class="pm-sub">مهلة توقيع المحاضر، والموعد الافتراضي لتنفيذ التوصيات، والنصاب الافتراضي، وتذييل المحاضر، وصلاحيات النظام.</p>
    </section>
    <div class="pm-tabs">
      <button :class="['pm-tab', { on: tab === 'general' }]" @click="tab = 'general'">عام</button>
      <button :class="['pm-tab', { on: tab === 'permissions' }]" @click="tab = 'permissions'">الصلاحيات</button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <form v-if="tab === 'general'" class="card pm-panel" style="max-width: 720px" @submit.prevent="save">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 0 12px">
        <label class="field"><span>مهلة توقيع المحضر (يوم)</span><input v-model.number="f.signDays" type="number" min="1" max="60" class="input" /></label>
        <label class="field"><span>موعد تنفيذ التوصية إن لم يُحدد (يوم)</span><input v-model.number="f.taskDays" type="number" min="1" max="365" class="input" /></label>
        <label class="field"><span>النصاب الافتراضي للجهات الجديدة (%)</span><input v-model.number="f.defaultQuorum" type="number" min="1" max="100" class="input" /></label>
      </div>
      <label class="field"><span>تذييل المحضر المطبوع</span><textarea v-model="f.minutesFooter" class="input" rows="3" placeholder="مثال: يُحفظ هذا المحضر لدى أمانة المجلس، ويمكن التحقق منه برمز التحقق" /></label>
      <div class="alert" style="background: #eef2ff; color: #3730a3">
        <b>كيف يُؤمَّن التوقيع الإلكتروني؟</b><br />
        يُجمَّد نص المحضر عند إصداره وتُحسب له بصمة SHA-256. مستخدمو النظام يوقّعون بإعادة إدخال كلمة المرور، ومن خارجه برابط شخصي ورمز من 6 أرقام يُحفظان مشفّرين.
        يُوقف التوقيع 15 دقيقة بعد 5 محاولات خاطئة، ويُسجَّل وقت كل توقيع وعنوانه، ويمكن لأي أحد التحقق من المحضر برمز التحقق المطبوع عليه.
      </div>
      <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ</button></div>
    </form>
    <ModulePermissionsPane v-else module="meetings" />
  </div>
</template>
