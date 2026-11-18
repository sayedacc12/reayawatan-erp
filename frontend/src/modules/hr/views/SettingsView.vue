<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import AllowancesPane from '../components/AllowancesPane.vue';
import AttendanceSettingsPane from '../components/AttendanceSettingsPane.vue';
import DevConfigPane from '../components/DevConfigPane.vue';
import ExpenseProfilesPane from '../components/ExpenseProfilesPane.vue';
import PayrollConfigPane from '../components/PayrollConfigPane.vue';
import RequestTypesPane from '../components/RequestTypesPane.vue';
import { useToast } from '../../../stores/toast';
import '../../projects/projects.css';
import '../hr.css';

const toast = useToast();
type Tab = 'structure' | 'services' | 'allowances' | 'profiles' | 'accounting' | 'attendance' | 'development' | 'permissions';
const route = useRoute();
const tab = ref<Tab>((['structure', 'services', 'allowances', 'profiles', 'accounting', 'attendance', 'development', 'permissions'].includes(String(route.query.tab)) ? route.query.tab : 'structure') as Tab);
const levels = ref<string[]>([]);
onMounted(async () => {
  levels.value = (await api<{ structureLevels: string[] }>('/hr/settings')).structureLevels;
});
async function save() {
  try {
    levels.value = (await api<{ structureLevels: string[] }>('/hr/settings', { method: 'PUT', json: { structureLevels: levels.value.filter((l) => l.trim()) } })).structureLevels;
    toast.success('حُفظت مستويات الهيكل');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function move(i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= levels.value.length) return;
  [levels.value[i], levels.value[j]] = [levels.value[j], levels.value[i]];
}
</script>

<template>
  <div>
    <div class="page-head"><div><h1>إعدادات الموارد البشرية</h1><p class="muted">مستويات الهيكل، البدلات، حسابات المصروف حسب الوظيفة، الربط المحاسبي للرواتب، الحضور وأجهزة البصمة، التطوير والتدريب، والصلاحيات. النسب والمدد والإجازات في <RouterLink to="/hr/policy" class="pm-link">لائحة الموارد البشرية</RouterLink>.</p></div></div>
    <div class="hr-tabs">
      <button :class="['hr-tab', { on: tab === 'structure' }]" @click="tab = 'structure'">مستويات الهيكل</button>
      <button :class="['hr-tab', { on: tab === 'services' }]" @click="tab = 'services'">خدمات الموظفين ومسارات الطلبات</button>
      <button :class="['hr-tab', { on: tab === 'allowances' }]" @click="tab = 'allowances'">البدلات</button>
      <button :class="['hr-tab', { on: tab === 'profiles' }]" @click="tab = 'profiles'">حسابات المصروف للوظائف</button>
      <button :class="['hr-tab', { on: tab === 'accounting' }]" @click="tab = 'accounting'">الربط المحاسبي واعتماد المسير</button>
      <button :class="['hr-tab', { on: tab === 'attendance' }]" @click="tab = 'attendance'">الحضور وأجهزة البصمة</button>
      <button :class="['hr-tab', { on: tab === 'development' }]" @click="tab = 'development'">التطوير والتدريب</button>
      <button :class="['hr-tab', { on: tab === 'permissions' }]" @click="tab = 'permissions'">الصلاحيات</button>
    </div>
    <section v-if="tab === 'structure'" class="card pm-panel" style="max-width: 640px">
      <h2>مستويات الهيكل التنظيمي</h2>
      <p class="pm-muted">رتّب المستويات من الأعلى للأدنى بالأسماء التي تستخدمها الجمعية (مثل: قطاع، إدارة، قسم، وحدة). يمكن أن تتبع الوحدة أي مستوى أعلى منها، فلا يلزم المرور بكل المستويات. لا يُحذف مستوى عليه وحدات.</p>
      <div v-for="(l, i) in levels" :key="i" style="display: flex; gap: 6px; margin-bottom: 8px; align-items: center">
        <span class="pm-tag" style="min-width: 28px; text-align: center">{{ i + 1 }}</span>
        <input v-model="levels[i]" class="input" />
        <button class="btn btn-sm" :disabled="i === 0" @click="move(i, -1)">▲</button>
        <button class="btn btn-sm" :disabled="i === levels.length - 1" @click="move(i, 1)">▼</button>
        <button class="btn btn-sm" :disabled="levels.length === 1" @click="levels.splice(i, 1)">✕</button>
      </div>
      <button class="btn btn-sm" :disabled="levels.length >= 8" @click="levels.push('')">+ مستوى</button>
      <div class="modal-actions"><button class="btn btn-primary" @click="save">حفظ</button></div>
    </section>
    <RequestTypesPane v-else-if="tab === 'services'" />
    <AllowancesPane v-else-if="tab === 'allowances'" />
    <ExpenseProfilesPane v-else-if="tab === 'profiles'" />
    <PayrollConfigPane v-else-if="tab === 'accounting'" />
    <DevConfigPane v-else-if="tab === 'development'" />
    <AttendanceSettingsPane v-else-if="tab === 'attendance'" />
    <ModulePermissionsPane v-else module="hr" />
  </div>
</template>
