<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { loadLookups } from '../lib';
import '../../../shared/module.css';
import '../comms.css';
import StarterSettings from '../../../components/StarterSettings.vue';

interface Category { code: string; name: string; kind: 'admin' | 'financial'; dueDays: number; isActive: boolean }
const route = useRoute();
const toast = useToast();
const tab = ref<'general' | 'permissions'>(route.query.tab === 'permissions' ? 'permissions' : 'general');
const cats = ref<Category[]>([]);
const reminder = ref(2);
const busy = ref(false);
const error = ref('');

onMounted(async () => {
  try {
    const s = await api<{ categories: Category[]; taskReminderDays: number }>('/comms/settings');
    cats.value = s.categories;
    reminder.value = s.taskReminderDays;
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const add = () => cats.value.push({ code: '', name: '', kind: 'admin', dueDays: 5, isActive: true });
async function save() {
  busy.value = true;
  try {
    const s = await api<{ categories: Category[]; taskReminderDays: number }>('/comms/settings', { method: 'PUT', json: { categories: cats.value, taskReminderDays: reminder.value } });
    cats.value = s.categories;
    loadLookups(true).catch(() => {});
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
    <section class="pm-hero cm-hero">
      <p class="pm-kicker">الاتصالات الإدارية</p>
      <h1>الإعدادات</h1>
      <p class="pm-sub">تصنيفات المعاملات ومهلة إنجاز كل تصنيف، وتذكير المهام، وصلاحيات النظام.</p>
    </section>
    <StarterSettings module="comms" />
    <div class="pm-tabs">
      <button :class="['pm-tab', { on: tab === 'general' }]" @click="tab = 'general'">التصنيفات والمهل</button>
      <button :class="['pm-tab', { on: tab === 'permissions' }]" @click="tab = 'permissions'">الصلاحيات</button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <form v-if="tab === 'general'" class="card pm-panel" @submit.prevent="save">
      <h2>تصنيفات المعاملات</h2>
      <p class="pm-muted" style="margin-top: -6px">عند اختيار التصنيف في معاملة جديدة يُقترح موعد الإنجاز حسب مهلته.</p>
      <div style="overflow-x: auto">
        <table class="table">
          <thead><tr><th>الرمز</th><th>الاسم</th><th>النوع</th><th>المهلة (يوم)</th><th>مفعل</th><th /></tr></thead>
          <tbody>
            <tr v-for="(c, i) in cats" :key="i">
              <td><input v-model="c.code" class="input" style="width: 110px; direction: ltr" required /></td>
              <td><input v-model="c.name" class="input" required /></td>
              <td><select v-model="c.kind" class="input" style="width: 110px"><option value="admin">إدارية</option><option value="financial">مالية</option></select></td>
              <td><input v-model.number="c.dueDays" type="number" min="1" max="180" class="input" style="width: 90px" /></td>
              <td><input v-model="c.isActive" type="checkbox" /></td>
              <td><button type="button" class="btn btn-sm" title="حذف" @click="cats.splice(i, 1)">×</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <button type="button" class="btn" style="margin-top: 10px" @click="add">+ تصنيف</button>
      <p class="cm-sec">المهام</p>
      <label class="field" style="max-width: 360px"><span>تُعد المهمة عاجلة في جرس المهام قبل موعدها بـ (يوم)</span><input v-model.number="reminder" type="number" min="0" max="30" class="input" /></label>
      <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ</button></div>
    </form>
    <ModulePermissionsPane v-else module="comms" />
  </div>
</template>
