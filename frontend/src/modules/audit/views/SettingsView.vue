<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { useToast } from '../../../stores/toast';
import { LEVEL_COLOR, LEVELS, levelOf } from '../lib';
import '../../projects/projects.css';
import '../audit.css';

interface Settings { riskBands: { medium: number; high: number; critical: number }; frequency: Record<string, number>; dueDays: Record<string, number>; reminderDays: number }
const toast = useToast();
const route = useRoute();
const tab = ref<'risk' | 'permissions'>(route.query.tab === 'permissions' ? 'permissions' : 'risk');
const s = reactive<Settings>({ riskBands: { medium: 5, high: 10, critical: 16 }, frequency: {}, dueDays: {}, reminderDays: 7 });
onMounted(async () => {
  Object.assign(s, await api<Settings>('/audit/settings'));
});
async function save() {
  try {
    Object.assign(s, await api<Settings>('/audit/settings', { method: 'PUT', json: s }));
    toast.success('حُفظت الإعدادات');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <div class="page-head"><div><h1>إعدادات المراجعة الداخلية</h1><p class="muted">مستويات الخطر وتكرار المراجعة ومهل التوصيات، وصلاحيات الوحدة على أدوار الجمعية.</p></div></div>
    <div class="pm-tabs">
      <button :class="['pm-tab', { on: tab === 'risk' }]" @click="tab = 'risk'">المخاطر والمهل</button>
      <button :class="['pm-tab', { on: tab === 'permissions' }]" @click="tab = 'permissions'">الصلاحيات</button>
    </div>
    <div v-if="tab === 'risk'" class="au-grid">
      <section class="card pm-panel">
        <h2>حدود مستويات الخطر (الاحتمال × الأثر)</h2>
        <div class="pm-grid2">
          <label class="field"><span>متوسط من درجة</span><input v-model.number="s.riskBands.medium" type="number" min="2" max="25" class="input" /></label>
          <label class="field"><span>مرتفع من درجة</span><input v-model.number="s.riskBands.high" type="number" min="2" max="25" class="input" /></label>
          <label class="field"><span>حرج من درجة</span><input v-model.number="s.riskBands.critical" type="number" min="2" max="25" class="input" /></label>
          <label class="field"><span>التنبيه قبل موعد التوصية (أيام)</span><input v-model.number="s.reminderDays" type="number" min="0" max="60" class="input" /></label>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>المستوى</th><th>تكرار مراجعة المجال (شهر)</th><th>مهلة تنفيذ التوصية (يوم)</th></tr></thead>
            <tbody>
              <tr v-for="l in LEVELS" :key="l.value">
                <td><span class="au-lvl" :style="{ '--c': LEVEL_COLOR[l.value] }">{{ l.label }}</span></td>
                <td><input v-model.number="s.frequency[l.value]" type="number" min="1" max="60" class="input" /></td>
                <td><input v-model.number="s.dueDays[l.value]" type="number" min="1" max="365" class="input" /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" @click="save">حفظ</button></div>
      </section>
      <section class="card pm-panel">
        <h2>مصفوفة المخاطر بالحدود الحالية</h2>
        <div class="au-heat">
          <template v-for="l in [5, 4, 3, 2, 1]" :key="l">
            <span class="ax">{{ l }}</span>
            <div v-for="i in [1, 2, 3, 4, 5]" :key="i" class="cell on" :style="{ '--c': LEVEL_COLOR[levelOf(s.riskBands, l * i)], '--i': (5 - l) * 5 + i }">{{ l * i }}</div>
          </template>
        </div>
        <div class="au-heat-x"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>
        <div class="au-heat-cap"><span>↑ الاحتمال</span><span>الأثر ←</span></div>
        <p class="pm-muted" style="margin-top: 10px">منهجيات المخاطر المعتمدة وإصداراتها تُدار في نظام المخاطر. هذه الحدود تخص ترتيب أولويات المراجعة الداخلية فقط.</p>
      </section>
    </div>
    <ModulePermissionsPane v-else module="audit" />
  </div>
</template>
