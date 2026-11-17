
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import RiskPicker from '../components/RiskPicker.vue';
import WorkflowBar from '../components/WorkflowBar.vue';
import { BIA_IMPACTS, DEP_KINDS, hours, loadLookups, P, type Lookups } from '../lib';
import '../../projects/projects.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id?: string }>();
const session = useSession();
const toast = useToast();
const router = useRouter();
const lk = ref<Lookups | null>(null);
const data = ref<any>(null);
const blank = () => ({
  activity: '', unitName: '', ownerName: '', description: '', impacts: { financial: 3, beneficiaries: 3, reputation: 3, legal: 3, operational: 3 } as Record<string, number>,
  mtpdHours: 72, rtoHours: 24, rpoHours: 24 as number | null, minResources: '', dependencies: [] as any[], strategy: '', steps: [] as any[], riskIds: [] as string[], lastTestDate: '', lastTestResult: '',
});
const form = reactive(blank());
const isNew = computed(() => !props.id);
const canEdit = computed(() => session.can(P.continuity) && (isNew.value || !['in_review', 'rejected'].includes(data.value?.status)));
const CRIT = ['', '#10b981', '#f59e0b', '#f97316', '#ef4444'];
const crit = computed(() => {
  const max = Math.max(...Object.values(form.impacts));
  const v = Math.min(4, Math.max(1, Math.ceil(max * 0.8) + (form.mtpdHours <= 24 ? 1 : 0) - (form.mtpdHours > 168 ? 1 : 0)));
  return { value: v, name: ['', 'منخفضة', 'متوسطة', 'عالية', 'حرجة'][v] };
});
function fill(b: any) {
  data.value = b;
  Object.assign(form, { ...blank(), ...b, unitName: b.unitName ?? '', ownerName: b.ownerName ?? '', description: b.description ?? '', minResources: b.minResources ?? '', strategy: b.strategy ?? '',
    lastTestDate: b.lastTestDate ?? '', lastTestResult: b.lastTestResult ?? '', impacts: { ...b.impacts }, dependencies: b.dependencies.map((d: any) => ({ ...d })), steps: b.steps.map((s: any) => ({ ...s })), riskIds: [...b.riskIds] });
}
onMounted(async () => {
  lk.value = await loadLookups();
  if (props.id) fill(await api(`/risk/continuity/${props.id}`));
});
async function save() {
  try {
    const json = { ...form, lastTestDate: form.lastTestDate || null, rpoHours: form.rpoHours ?? null };
    const b = await api<any>(isNew.value ? '/risk/continuity' : `/risk/continuity/${props.id}`, { method: isNew.value ? 'POST' : 'PATCH', json });
    toast.success('حُفظ التحليل والخطة');
    if (isNew.value) router.replace(`/risk/continuity/${b.id}`);
    fill(b);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div v-if="isNew || data">
    <div class="page-head">
      <div><h1><span v-if="data" class="rk-code" style="font-size: 1rem">{{ data.code }}</span> {{ isNew ? 'تحليل أثر توقف نشاط' : form.activity }}</h1>
        <p class="muted">قدّر أثر توقف النشاط، وحدد الأهداف الزمنية للاستعادة، ثم اكتب خطة التعافي بخطوات مزمنة.</p></div>
      <span class="pm-pill" :style="{ '--c': CRIT[crit.value], fontSize: '.95rem' }">الأهمية: {{ crit.name }}</span>
    </div>
    <div class="rk-grid">
      <fieldset :disabled="!canEdit" style="border: 0; padding: 0; margin: 0; min-width: 0; display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2>النشاط وأثر توقفه</h2>
          <label class="field"><span>النشاط</span><input v-model="form.activity" class="input" /></label>
          <div class="rk-fields">
            <label class="field"><span>الجهة</span><select v-model="form.unitName" class="input"><option value="">—</option><option v-for="u in lk?.units" :key="u.id" :value="u.name">{{ u.name }}</option></select></label>
            <label class="field"><span>المسؤول</span><input v-model="form.ownerName" class="input" /></label>
          </div>
          <label class="field"><span>الوصف</span><textarea v-model="form.description" class="input" rows="2" /></label>
          <div class="rk-sec">أثر التوقف (1 ضئيل إلى 5 جسيم)</div>
          <div class="rk-fields">
            <label v-for="i in BIA_IMPACTS" :key="i.key" class="field"><span>{{ i.label }}: <b>{{ form.impacts[i.key] }}</b></span><input v-model.number="form.impacts[i.key]" type="range" min="1" max="5" /></label>
          </div>
          <div class="rk-sec">الأهداف الزمنية</div>
          <div class="rk-fields">
            <label class="field"><span>أقصى فترة توقف محتملة MTPD (ساعة) · {{ hours(form.mtpdHours) }}</span><input v-model.number="form.mtpdHours" type="number" min="1" class="input" /></label>
            <label class="field"><span>الوقت المستهدف للاستعادة RTO (ساعة) · {{ hours(form.rtoHours) }}</span><input v-model.number="form.rtoHours" type="number" min="0" class="input" :style="{ borderColor: form.rtoHours > form.mtpdHours ? 'var(--danger)' : '' }" /></label>
            <label class="field"><span>أقصى فقد مقبول للبيانات RPO (ساعة)</span><input v-model.number="form.rpoHours" type="number" min="0" class="input" /></label>
          </div>
          <p v-if="form.rtoHours > form.mtpdHours" class="rk-danger">وقت الاستعادة يجب ألا يتجاوز أقصى فترة توقف محتملة.</p>
          <label class="field"><span>الحد الأدنى من الموارد للاستمرار</span><textarea v-model="form.minResources" class="input" rows="2" /></label>
          <div class="rk-sec">الاعتماديات</div>
          <div v-for="(d, i) in form.dependencies" :key="i" style="display: flex; gap: 6px; margin-bottom: 6px">
            <select v-model="d.kind" class="input" style="max-width: 150px"><option v-for="(l, k) in DEP_KINDS" :key="k" :value="k">{{ l }}</option></select>
            <input v-model="d.name" class="input" /><button type="button" class="btn btn-sm" @click="form.dependencies.splice(i, 1)">✕</button>
          </div>
          <button type="button" class="btn btn-sm" @click="form.dependencies.push({ kind: 'system', name: '' })">+ اعتمادية</button>
        </section>
        <section class="card pm-panel">
          <h2>خطة التعافي</h2>
          <label class="field"><span>استراتيجية الاستمرارية</span><textarea v-model="form.strategy" class="input" rows="2" placeholder="مثل: الصرف اليدوي بشيكات معتمدة مسبقًا، والعمل عن بعد" /></label>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>#</th><th>الخطوة</th><th>المسؤول</th><th>خلال (ساعة)</th><th /></tr></thead>
            <tbody><tr v-for="(s, i) in form.steps" :key="i"><td>{{ i + 1 }}</td><td><input v-model="s.title" class="input" /></td><td><input v-model="s.ownerName" class="input" /></td>
              <td><input v-model.number="s.withinHours" type="number" min="0" class="input" style="max-width: 100px" /></td><td><button type="button" class="btn btn-sm" @click="form.steps.splice(i, 1)">✕</button></td></tr></tbody>
          </table></div>
          <button type="button" class="btn btn-sm" @click="form.steps.push({ title: '', ownerName: '', withinHours: null })">+ خطوة</button>
          <div class="rk-sec">المخاطر المسببة للتوقف</div>
          <RiskPicker v-model="form.riskIds" :options="lk?.risks ?? []" :disabled="!canEdit" />
          <div class="rk-sec">آخر اختبار للخطة</div>
          <div class="rk-fields">
            <label class="field"><span>تاريخ الاختبار</span><input v-model="form.lastTestDate" type="date" class="input" /></label>
          </div>
          <label class="field"><span>النتيجة والدروس</span><textarea v-model="form.lastTestResult" class="input" rows="2" /></label>
          <div v-if="canEdit" class="modal-actions"><button type="button" class="btn btn-primary" @click="save">حفظ</button></div>
        </section>
      </fieldset>
      <div v-if="data" style="display: grid; gap: 16px; align-content: start">
        <WorkflowBar :item="data" :base="`/risk/continuity/${data.id}`" :can-submit="session.can(P.continuity)" @changed="fill" />
        <section v-if="data.teams.length" class="card pm-panel">
          <h2>فرق الأزمات المسؤولة</h2>
          <RouterLink v-for="t in data.teams" :key="t.id" :to="`/risk/crisis/${t.id}`" class="rk-chip" style="margin-bottom: 6px"><span class="rk-code">{{ t.code }}</span>{{ t.name }}</RouterLink>
        </section>
      </div>
    </div>
  </div>
</template>
