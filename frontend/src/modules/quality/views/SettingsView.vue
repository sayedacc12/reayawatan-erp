<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { useToast } from '../../../stores/toast';
import { errMsg, loadSettings, type Dept, type QSettings } from '../lib';
import '../../../shared/module.css';
import '../quality.css';
import StarterSettings from '../../../components/StarterSettings.vue';

const toast = useToast();
type Tab = 'coding' | 'departments' | 'periods' | 'permissions';
const tab = ref<Tab>('coding');
const s = ref<QSettings | null>(null);
const f = reactive({ prefixes: {} as Record<string, string>, departments: [] as Dept[], seqDigits: 2, reviewMonths: 24, complaintDays: 10, ncrDays: 30 });
function fill(x: QSettings) {
  s.value = x;
  Object.assign(f, { prefixes: { ...x.prefixes }, departments: x.departments.map((d) => ({ ...d })), seqDigits: x.seqDigits, reviewMonths: x.reviewMonths, complaintDays: x.complaintDays, ncrDays: x.ncrDays });
}
onMounted(async () => fill(await loadSettings(true)));
async function save() {
  try {
    await api('/quality/settings', { method: 'PUT', json: { prefixes: f.prefixes, departments: f.departments, seqDigits: f.seqDigits, reviewMonths: f.reviewMonths, complaintDays: f.complaintDays, ncrDays: f.ncrDays } });
    fill(await loadSettings(true));
    toast.success('حُفظت الإعدادات');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
const example = computed(() => `${f.prefixes.procedure ?? 'QP'}-${f.departments[0]?.code?.toUpperCase() || 'QMS'}-${'1'.padStart(f.seqDigits, '0')}`);
</script>

<template>
  <div>
    <div class="page-head"><div><h1>إعدادات الجودة</h1><p class="muted">نظام الترميز الموحد لكل وثائق الشركة، ورموز الإدارات، والمدد المستهدفة، وصلاحيات الأدوار.</p></div></div>
    <StarterSettings module="quality" />
    <div class="q-tabs">
      <button :class="['q-tab', { on: tab === 'coding' }]" @click="tab = 'coding'">الترميز</button>
      <button :class="['q-tab', { on: tab === 'departments' }]" @click="tab = 'departments'">الإدارات</button>
      <button :class="['q-tab', { on: tab === 'periods' }]" @click="tab = 'periods'">المدد المستهدفة</button>
      <button :class="['q-tab', { on: tab === 'permissions' }]" @click="tab = 'permissions'">الصلاحيات</button>
    </div>
    <section v-if="tab === 'coding' && s" class="card pm-panel" style="max-width: 720px">
      <h2>الترميز الموحد</h2>
      <p class="pm-muted">صيغة الرمز: <b>البادئة - رمز الإدارة - الرقم التسلسلي</b>، مثل <span class="q-code">{{ example }}</span>. يُستخدم الترميز نفسه في نماذج العملاء والأوصاف الوظيفية، ولا يتكرر رمز في الشركة.</p>
      <div class="q-fields">
        <label v-for="t in s.docTypes" :key="t.value" class="field"><span>{{ t.label }}</span><input v-model="f.prefixes[t.value]" class="input" dir="ltr" maxlength="5" style="text-transform: uppercase" /></label>
        <label class="field"><span>خانات الرقم التسلسلي</span><select v-model.number="f.seqDigits" class="input"><option v-for="n in [2, 3, 4]" :key="n" :value="n">{{ n }} ({{ '1'.padStart(n, '0') }})</option></select></label>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" @click="save">حفظ</button></div>
    </section>
    <section v-else-if="tab === 'departments'" class="card pm-panel" style="max-width: 640px">
      <h2>رموز الإدارات</h2>
      <p class="pm-muted">رمز قصير بالإنجليزية لكل إدارة يدخل في رموز الوثائق. لا يُحذف رمز مستخدم في وثائق أو سجلات.</p>
      <div v-for="(d, i) in f.departments" :key="i" style="display: flex; gap: 6px; margin-bottom: 8px">
        <input v-model="d.code" class="input" dir="ltr" maxlength="10" style="width: 110px; text-transform: uppercase" placeholder="BEN" />
        <input v-model="d.name" class="input" placeholder="اسم الإدارة" />
        <button class="btn btn-sm" :disabled="f.departments.length === 1" @click="f.departments.splice(i, 1)">✕</button>
      </div>
      <button class="btn btn-sm" @click="f.departments.push({ code: '', name: '' })">+ إدارة</button>
      <div class="modal-actions"><button class="btn btn-primary" @click="save">حفظ</button></div>
    </section>
    <section v-else-if="tab === 'periods'" class="card pm-panel" style="max-width: 640px">
      <h2>المدد المستهدفة</h2>
      <label class="field"><span>المراجعة الدورية للوثيقة كل (شهر)</span><input v-model.number="f.reviewMonths" type="number" min="1" max="60" class="input" /></label>
      <label class="field"><span>المدة المستهدفة لمعالجة الشكوى (يوم)</span><input v-model.number="f.complaintDays" type="number" min="1" max="90" class="input" /></label>
      <label class="field"><span>المدة الافتراضية لإغلاق حالة عدم المطابقة (يوم)</span><input v-model.number="f.ncrDays" type="number" min="1" max="365" class="input" /></label>
      <p class="pm-muted">تظهر التنبيهات في لوحة الجودة عند تجاوز هذه المدد.</p>
      <div class="modal-actions"><button class="btn btn-primary" @click="save">حفظ</button></div>
    </section>
    <ModulePermissionsPane v-else-if="tab === 'permissions'" module="quality" />
  </div>
</template>
