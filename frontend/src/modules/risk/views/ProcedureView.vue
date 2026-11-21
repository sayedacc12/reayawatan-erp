
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import RiskPicker from '../components/RiskPicker.vue';
import WorkflowBar from '../components/WorkflowBar.vue';
import { DOMAINS, EFFECTIVENESS, loadLookups, P, type Lookups } from '../lib';
import '../../../shared/module.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id?: string }>();
const session = useSession();
const toast = useToast();
const router = useRouter();
const lk = ref<Lookups | null>(null);
const controls = ref<{ id: string; code: string; title: string }[]>([]);
const data = ref<any>(null);
const mode = ref<'flow' | 'edit'>(props.id ? 'flow' : 'edit');
const blankStep = () => ({ title: '', actor: '', description: '', durationDays: null as number | null, output: '', control: '', decision: false });
const blank = () => ({
  name: '', domain: 'risk', purpose: '', scope: '', ownerName: '', inputs: '', outputs: '', steps: [blankStep()] as ReturnType<typeof blankStep>[],
  kpis: [] as { name: string; target: string }[], riskIds: [] as string[], controlIds: [] as string[],
});
const form = reactive(blank());
const isNew = computed(() => !props.id);
const canEdit = computed(() => session.can(P.procedures) && (isNew.value || !['in_review', 'rejected'].includes(data.value?.status)));
const totalDays = computed(() => form.steps.reduce((s, x) => s + (Number(x.durationDays) || 0), 0));
const s = (v: string | null | undefined) => v ?? '';
function fill(p: any) {
  data.value = p;
  Object.assign(form, {
    name: p.name, domain: p.domain, purpose: s(p.purpose), scope: s(p.scope), ownerName: s(p.ownerName), inputs: s(p.inputs), outputs: s(p.outputs),
    steps: p.steps.map((x: any) => ({ ...x, description: s(x.description), output: s(x.output), control: s(x.control) })),
    kpis: p.kpis.map((k: any) => ({ ...k })), riskIds: [...p.riskIds], controlIds: [...p.controlIds],
  });
}
onMounted(async () => {
  const [l, c] = await Promise.all([loadLookups(), api<any[]>('/risk/controls')]);
  lk.value = l;
  controls.value = c.map((x) => ({ id: x.id, code: x.code, title: x.name }));
  if (props.id) fill(await api(`/risk/procedures/${props.id}`));
});
function move(i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= form.steps.length) return;
  [form.steps[i], form.steps[j]] = [form.steps[j], form.steps[i]];
}
async function save() {
  try {
    const nul = (v: string) => v.trim() || null;
    const json = {
      ...form, purpose: nul(form.purpose), scope: nul(form.scope), ownerName: nul(form.ownerName), inputs: nul(form.inputs), outputs: nul(form.outputs),
      steps: form.steps.map((x) => ({ ...x, description: nul(x.description), output: nul(x.output), control: nul(x.control), durationDays: x.durationDays === null || (x.durationDays as unknown) === '' ? null : Number(x.durationDays) })),
    };
    const p = await api<any>(isNew.value ? '/risk/procedures' : `/risk/procedures/${props.id}`, { method: isNew.value ? 'POST' : 'PATCH', json });
    toast.success('حُفظ الإجراء');
    if (isNew.value) router.replace(`/risk/procedures/${p.id}`);
    fill(p);
    mode.value = 'flow';
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove() {
  if (!confirm('حذف هذا الإجراء؟')) return;
  try {
    await api(`/risk/procedures/${props.id}`, { method: 'DELETE' });
    router.replace('/risk/procedures');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div v-if="isNew || data">
    <div class="page-head">
      <div><h1><span v-if="data" class="rk-code" style="font-size: 1rem">{{ data.qualityCode }}</span> {{ isNew ? 'إجراء جديد' : form.name }}</h1>
        <p class="muted">صمّم الإجراء خطوة بخطوة: من ينفذ، وكم يستغرق، وما المخرج، وأين نقطة الرقابة. الخطوة التي فيها قرار تظهر بشكل معين في المخطط.</p></div>
      <div v-if="data" class="rk-tabs" style="margin: 0">
        <button :class="['rk-tab', { on: mode === 'flow' }]" @click="mode = 'flow'">مخطط الإجراء</button>
        <button :class="['rk-tab', { on: mode === 'edit' }]" @click="mode = 'edit'">{{ canEdit ? 'تعديل' : 'التفاصيل' }}</button>
      </div>
    </div>
    <div class="rk-grid">
      <div style="display: grid; gap: 16px; align-content: start; min-width: 0">
        <section v-if="mode === 'flow' && data" class="card pm-panel">
          <h2>{{ data.name }} <span class="pm-muted" style="font-size: .85rem">{{ DOMAINS[data.domain] }} · {{ data.steps.length }} خطوات{{ totalDays ? ` · ${totalDays} يوم` : '' }}</span></h2>
          <p v-if="data.purpose" class="rk-pre" style="margin-bottom: 12px">{{ data.purpose }}</p>
          <div class="rk-fields" style="margin-bottom: 14px">
            <div v-if="data.scope"><div class="rk-sec">النطاق</div><p class="rk-pre">{{ data.scope }}</p></div>
            <div v-if="data.inputs"><div class="rk-sec">المدخلات</div><p class="rk-pre">{{ data.inputs }}</p></div>
            <div v-if="data.outputs"><div class="rk-sec">المخرجات</div><p class="rk-pre">{{ data.outputs }}</p></div>
          </div>
          <div class="rk-flow">
            <div v-for="(st, i) in data.steps" :key="i" :class="['rk-step', { decision: st.decision }]" :style="{ '--i': i }">
              <div class="n"><span>{{ st.decision ? '؟' : i + 1 }}</span></div>
              <div class="box">
                <h4>{{ st.title }} <span class="actor">{{ st.actor }}</span></h4>
                <p v-if="st.description" class="rk-pre pm-muted" style="font-size: .85rem">{{ st.description }}</p>
                <div class="kv">
                  <span v-if="st.durationDays != null">⏱ {{ st.durationDays }} يوم</span>
                  <span v-if="st.output">📄 {{ st.output }}</span>
                  <span v-if="st.control" style="color: #be123c">🛡 {{ st.control }}</span>
                </div>
              </div>
            </div>
          </div>
          <template v-if="data.kpis.length">
            <div class="rk-sec">مؤشرات قياس الإجراء</div>
            <table class="table"><thead><tr><th>المؤشر</th><th>المستهدف</th></tr></thead>
              <tbody><tr v-for="(k, i) in data.kpis" :key="i"><td>{{ k.name }}</td><td>{{ k.target }}</td></tr></tbody></table>
          </template>
        </section>

        <fieldset v-else :disabled="!canEdit" style="border: 0; padding: 0; margin: 0; min-width: 0; display: grid; gap: 16px">
          <section class="card pm-panel">
            <h2>بطاقة الإجراء</h2>
            <label class="field"><span>اسم الإجراء</span><input v-model="form.name" class="input" /></label>
            <div class="rk-fields">
              <label class="field"><span>المجال</span><select v-model="form.domain" class="input"><option v-for="(l, k) in DOMAINS" :key="k" :value="k">{{ l }}</option></select></label>
              <label class="field"><span>مالك الإجراء</span><input v-model="form.ownerName" class="input" /></label>
            </div>
            <label class="field"><span>الغرض</span><textarea v-model="form.purpose" class="input" rows="2" /></label>
            <label class="field"><span>النطاق</span><textarea v-model="form.scope" class="input" rows="2" /></label>
            <div class="rk-fields">
              <label class="field"><span>المدخلات</span><textarea v-model="form.inputs" class="input" rows="2" /></label>
              <label class="field"><span>المخرجات</span><textarea v-model="form.outputs" class="input" rows="2" /></label>
            </div>
          </section>
          <section class="card pm-panel">
            <h2>الخطوات <span class="pm-muted" style="font-size: .85rem">المدة الكلية {{ totalDays }} يوم</span></h2>
            <div v-for="(st, i) in form.steps" :key="i" class="rk-item" style="margin-bottom: 10px">
              <div style="display: flex; gap: 6px; align-items: center">
                <b style="min-width: 22px">{{ i + 1 }}</b>
                <input v-model="st.title" class="input" placeholder="عنوان الخطوة" />
                <input v-model="st.actor" class="input" style="max-width: 170px" placeholder="المنفذ" />
                <button type="button" class="btn btn-sm" :disabled="i === 0" @click="move(i, -1)">▲</button>
                <button type="button" class="btn btn-sm" :disabled="i === form.steps.length - 1" @click="move(i, 1)">▼</button>
                <button type="button" class="btn btn-sm" :disabled="form.steps.length === 1" @click="form.steps.splice(i, 1)">✕</button>
              </div>
              <textarea v-model="st.description" class="input" rows="1" placeholder="وصف الخطوة (اختياري)" />
              <div class="meta">
                <label>المدة (يوم) <input v-model.number="st.durationDays" type="number" min="0" class="input" style="width: 80px" /></label>
                <input v-model="st.output" class="input" style="max-width: 200px" placeholder="المخرج" />
                <input v-model="st.control" class="input" style="max-width: 220px" placeholder="نقطة الرقابة" />
                <label><input v-model="st.decision" type="checkbox" /> خطوة قرار</label>
              </div>
            </div>
            <button type="button" class="btn btn-sm" @click="form.steps.push(blankStep())">+ خطوة</button>
            <div class="rk-sec">مؤشرات القياس</div>
            <div v-for="(k, i) in form.kpis" :key="i" style="display: flex; gap: 6px; margin-bottom: 6px">
              <input v-model="k.name" class="input" placeholder="المؤشر" /><input v-model="k.target" class="input" style="max-width: 160px" placeholder="المستهدف" />
              <button type="button" class="btn btn-sm" @click="form.kpis.splice(i, 1)">✕</button>
            </div>
            <button type="button" class="btn btn-sm" @click="form.kpis.push({ name: '', target: '' })">+ مؤشر</button>
            <div class="rk-sec">المخاطر التي يعالجها الإجراء</div>
            <RiskPicker v-model="form.riskIds" :options="lk?.risks ?? []" :disabled="!canEdit" />
            <div class="rk-sec">الضوابط المطبقة فيه</div>
            <RiskPicker v-model="form.controlIds" :options="controls" placeholder="اختر ضابطًا" :disabled="!canEdit" />
            <div v-if="canEdit" class="modal-actions">
              <button type="button" class="btn btn-primary" @click="save">حفظ</button>
              <button v-if="data && !data.approvedAt" type="button" class="btn" style="color: var(--danger)" @click="remove">حذف</button>
            </div>
          </section>
        </fieldset>
      </div>
      <div v-if="data" style="display: grid; gap: 16px; align-content: start">
        <WorkflowBar :item="data" :base="`/risk/procedures/${data.id}`" :can-submit="session.can(P.procedures)" @changed="fill" />
        <section v-if="data.risks.length || data.controls.length" class="card pm-panel">
          <h2>الربط</h2>
          <RouterLink v-for="r in data.risks" :key="r.id" :to="`/risk/register/${r.id}`" class="rk-chip" style="margin: 0 0 6px 6px"><span class="rk-code">{{ r.code }}</span>{{ r.title }}</RouterLink>
          <div class="rk-chips" style="margin-top: 6px">
            <span v-for="c in data.controls" :key="c.id" class="rk-chip"><span class="rk-code">{{ c.code }}</span>{{ c.name }}
              <span class="pm-pill" :style="{ '--c': EFFECTIVENESS[c.effectiveness]?.color }">{{ EFFECTIVENESS[c.effectiveness]?.label }}</span></span>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
