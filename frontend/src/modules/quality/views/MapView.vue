<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import FlowChart from '../components/FlowChart.vue';
import { P, STATUS_COLOR, errMsg, fmtDate, uid, type DocRow, type MapStep } from '../lib';
import '../../../shared/module.css';
import '../quality.css';

interface MapData {
  id: string; code: string; title: string; description: string | null; documentId: string | null; lanes: string[]; steps: MapStep[]; version: number; updatedByName: string; updatedAt: string;
  document: { id: string; code: string; title: string; status: string; statusLabel: string; revisionLabel: string } | null;
  linkedDocs: { code: string; title: string; path: string; statusLabel: string }[];
}
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const data = ref<MapData | null>(null);
const editing = ref(false);
const selected = ref<string | null>(null);
const docs = ref<DocRow[]>([]);
const form = reactive({ title: '', code: '', description: '', documentId: '' as string, lanes: [] as string[], steps: [] as MapStep[] });

async function load() {
  data.value = await api<MapData>(`/quality/maps/${props.id}`);
}
onMounted(async () => {
  await load();
  if (route.query.edit === '1' && session.can(P.documents)) await startEdit();
});
async function startEdit() {
  const d = data.value!;
  Object.assign(form, { title: d.title, code: d.code, description: d.description ?? '', documentId: d.documentId ?? '', lanes: [...d.lanes], steps: JSON.parse(JSON.stringify(d.steps)) });
  if (!docs.value.length) docs.value = (await api<{ rows: DocRow[] }>('/quality/documents?status=active')).rows;
  editing.value = true;
}
const view = computed(() => (editing.value ? { lanes: form.lanes, steps: form.steps } : { lanes: data.value?.lanes ?? [], steps: data.value?.steps ?? [] }));
const KINDS = [{ v: 'start', l: 'بداية' }, { v: 'task', l: 'خطوة' }, { v: 'decision', l: 'قرار' }, { v: 'document', l: 'نموذج / وثيقة' }, { v: 'end', l: 'نهاية' }] as const;
const procs = computed(() => docs.value.filter((d) => d.docType === 'procedure' && d.source === 'quality'));

function addStep(after?: MapStep) {
  const s: MapStep = { id: uid(), kind: 'task', label: 'خطوة جديدة', lane: after?.lane ?? 0, docCode: null, next: [] };
  if (after) {
    // الخطوة الجديدة تأخذ مسار السابقة، والسابقة تتجه إليها
    s.next = after.next.length ? [{ ...after.next[0] }] : [];
    if (after.kind !== 'end') after.next = [{ to: s.id, label: after.next[0]?.label ?? null }, ...after.next.slice(1)];
    form.steps.splice(form.steps.indexOf(after) + 1, 0, s);
  } else form.steps.push(s);
  selected.value = s.id;
}
function removeStep(s: MapStep) {
  form.steps = form.steps.filter((x) => x !== s).map((x) => ({ ...x, next: x.next.filter((n) => n.to !== s.id) }));
  if (selected.value === s.id) selected.value = null;
}
function removeLane(i: number) {
  if (form.steps.some((s) => s.lane === i)) return toast.error('انقل الخطوات من هذه الجهة أولًا');
  form.lanes.splice(i, 1);
  form.steps.forEach((s) => { if (s.lane > i) s.lane--; });
}
async function save() {
  try {
    data.value = await api<MapData>(`/quality/maps/${props.id}`, {
      method: 'PUT', json: { title: form.title, code: form.code, description: form.description || null, documentId: form.documentId || null, lanes: form.lanes, steps: form.steps },
    });
    editing.value = false;
    toast.success('حُفظت الخريطة');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
async function remove() {
  if (!confirm('حذف هذه الخريطة؟')) return;
  await api(`/quality/maps/${props.id}`, { method: 'DELETE' });
  router.push('/quality/maps');
}
function openDoc(code: string) {
  const d = data.value?.linkedDocs.find((x) => x.code === code) ?? docs.value.find((x) => x.code === code);
  if (d) router.push(d.path);
}
function focus(id: string) {
  selected.value = id;
  if (editing.value) document.getElementById(`step-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
const labelOf = (id: string) => form.steps.find((s) => s.id === id)?.label ?? id;
</script>

<template>
  <div v-if="data">
    <section class="pm-hero q-hero no-print">
      <div>
        <p class="pm-kicker"><span class="q-code" style="background: rgba(255,255,255,.12); color: #fcd34d">{{ data.code }}</span> · إصدار الرسم {{ data.version }}</p>
        <h1>{{ data.title }}</h1>
        <p class="pm-sub">{{ data.description ?? 'مخطط تدفق الإجراء بمسارات الجهات المسؤولة' }} · حدّثها {{ data.updatedByName }} {{ fmtDate(data.updatedAt) }}</p>
      </div>
      <div class="pm-actions">
        <RouterLink v-if="data.document" :to="`/quality/documents/${data.document.id}`" class="btn q-ghost">وثيقة الإجراء {{ data.document.code }}</RouterLink>
        <button v-if="session.can(P.documents) && !editing" class="btn q-glow" @click="startEdit">تعديل الرسم</button>
        <template v-if="editing"><button class="btn q-glow" @click="save">حفظ</button><button class="btn q-ghost" @click="editing = false">إلغاء</button></template>
      </div>
    </section>
    <div v-if="data.document" class="q-info no-print">مرتبطة بالإجراء <b>{{ data.document.title }}</b> {{ data.document.revisionLabel }} <span class="pm-pill" :style="{ '--c': STATUS_COLOR[data.document.status] }">{{ data.document.statusLabel }}</span>. اضغط كود أي نموذج في الخريطة لفتحه.</div>

    <section class="card pm-panel">
      <FlowChart :lanes="view.lanes" :steps="view.steps" :selected="selected" @select="focus" @doc="openDoc" />
    </section>

    <section v-if="!editing && data.linkedDocs.length" class="card pm-panel" style="margin-top: 16px">
      <h2>النماذج والوثائق المستخدمة في الإجراء</h2>
      <div class="q-chips"><RouterLink v-for="d in data.linkedDocs" :key="d.code" :to="d.path" class="q-chip"><span class="q-code">{{ d.code }}</span> {{ d.title }} · {{ d.statusLabel }}</RouterLink></div>
    </section>

    <template v-if="editing">
      <section class="card pm-panel" style="margin-top: 16px">
        <h2>بيانات الخريطة</h2>
        <div class="q-fields">
          <label class="field"><span>العنوان</span><input v-model="form.title" class="input" /></label>
          <label class="field"><span>الكود</span><input v-model="form.code" class="input" dir="ltr" /></label>
          <label class="field"><span>وثيقة الإجراء</span><select v-model="form.documentId" class="input"><option value="">بدون ربط</option><option v-for="d in procs" :key="d.id" :value="d.id">{{ d.code }} · {{ d.title }}</option></select></label>
        </div>
        <label class="field"><span>وصف مختصر</span><input v-model="form.description" class="input" /></label>
        <p class="q-sec">الجهات المسؤولة (المسارات) من اليمين لليسار</p>
        <div class="q-chips">
          <span v-for="(l, i) in form.lanes" :key="i" class="q-chip" style="padding: 2px 4px 2px 10px">
            <input v-model="form.lanes[i]" class="input" style="border: 0; padding: 2px; width: 150px; background: transparent" />
            <button class="btn btn-sm" @click="removeLane(i)">✕</button>
          </span>
          <button class="btn btn-sm" :disabled="form.lanes.length >= 8" @click="form.lanes.push('جهة جديدة')">+ جهة</button>
        </div>
      </section>
      <section class="card pm-panel" style="margin-top: 16px">
        <h2>الخطوات <button class="btn btn-sm" @click="addStep()">+ خطوة</button></h2>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>النوع</th><th>الوصف</th><th>الجهة</th><th>النموذج</th><th>تتجه إلى</th><th /></tr></thead>
            <tbody>
              <tr v-for="s in form.steps" :id="`step-${s.id}`" :key="s.id" :style="{ background: selected === s.id ? 'var(--primary-soft)' : '' }" @click="selected = s.id">
                <td><select v-model="s.kind" class="input" style="min-width: 110px"><option v-for="k in KINDS" :key="k.v" :value="k.v">{{ k.l }}</option></select></td>
                <td><input v-model="s.label" class="input" style="min-width: 200px" /></td>
                <td><select v-model.number="s.lane" class="input"><option v-for="(l, i) in form.lanes" :key="i" :value="i">{{ l }}</option></select></td>
                <td><input v-model="s.docCode" class="input" dir="ltr" list="q-doc-codes" style="width: 120px" placeholder="—" /></td>
                <td>
                  <div v-if="s.kind !== 'end'" style="display: grid; gap: 4px; min-width: 260px">
                    <div v-for="(n, k) in s.next" :key="k" style="display: flex; gap: 4px">
                      <select v-model="n.to" class="input"><option v-for="t in form.steps.filter((x) => x.id !== s.id)" :key="t.id" :value="t.id">{{ t.label }}</option></select>
                      <input v-model="n.label" class="input" style="width: 90px" :placeholder="s.kind === 'decision' ? (k ? 'لا' : 'نعم') : 'تسمية'" />
                      <button class="btn btn-sm" @click="s.next.splice(k, 1)">✕</button>
                    </div>
                    <button class="btn btn-sm" style="justify-self: start" @click="s.next.push({ to: form.steps.find((x) => x.id !== s.id)?.id ?? '', label: null })">+ اتجاه</button>
                  </div>
                  <span v-else class="pm-muted">نهاية</span>
                </td>
                <td style="white-space: nowrap">
                  <button class="btn btn-sm" title="إضافة خطوة بعدها" @click.stop="addStep(s)">+ بعدها</button>
                  <button class="btn btn-sm" @click.stop="removeStep(s)">✕</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <datalist id="q-doc-codes"><option v-for="d in docs" :key="d.code" :value="d.code">{{ d.title }}</option></datalist>
        <p class="pm-muted" style="margin-top: 8px">القرار يحتاج اتجاهين على الأقل (نعم / لا). الاتجاه إلى خطوة سابقة يُرسم منقطًا على الجانب. {{ selected ? `المحدد: ${labelOf(selected)}` : '' }}</p>
        <div class="modal-actions"><button class="btn btn-primary" @click="save">حفظ الخريطة</button><button class="btn" @click="editing = false">إلغاء</button>
          <button class="btn" style="color: var(--danger); margin-inline-start: auto" @click="remove">حذف الخريطة</button></div>
      </section>
    </template>
  </div>
</template>
