<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { RESIDENCY, fmtDate, label, links, sar, today } from '../labels';
import type { Amendment, Batch, Conditions, ProjectRow } from '../types';
import '../projects.css';

interface Target { id: string; name: string; problems: string[] }
type Category = 'citizen' | 'resident' | 'visitor';

const session = useSession();
const toast = useToast();
const canAmend = computed(() => session.can('projects.amendments.manage'));
const projects = ref<ProjectRow[]>([]);
const history = ref<Amendment[]>([]);
const error = ref('');
const busy = ref(false);
const projectId = ref('');
const batches = ref<Batch[]>([]);
const batchId = ref('');
const targets = ref<Target[]>([]);

const blank = () => ({
  amount: null as number | null, effectiveDate: today(), newActivityId: '', acceptsPatientContribution: false, maxSpend: null as number | null,
  nationalities: '', categories: [] as Category[], endDate: '', reason: '', donorApproved: false, donorApprovalRef: '', acknowledged: false,
});
const form = ref(blank());

async function load() {
  try {
    [projects.value, history.value] = await Promise.all([api<ProjectRow[]>('/projects/list'), api<Amendment[]>('/projects-ops/amendments')]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

watch(projectId, async (id) => {
  batches.value = []; batchId.value = '';
  if (!id) return;
  try {
    batches.value = (await api<Batch[]>(`/projects-ops/support/projects/${id}/batches`)).filter((b) => b.activityId === id && b.net > 0);
  } catch (e) {
    toast.error((e as Error).message);
  }
});
const batch = computed(() => batches.value.find((b) => b.id === batchId.value));
watch(batchId, async (id) => {
  targets.value = [];
  const b = batch.value;
  const c: Conditions = b?.conditions ?? {};
  form.value = {
    ...blank(), amount: b?.net ?? null, acceptsPatientContribution: !!c.acceptsPatientContribution, maxSpend: c.maxSpend ?? null,
    nationalities: (c.nationalities ?? []).join('، '), categories: [...(c.categories ?? [])], endDate: c.endDate ?? '',
  };
  if (!id) return;
  try {
    targets.value = (await api<{ projects: Target[] }>(`/projects-ops/transfers/targets/${id}`)).projects;
  } catch { /* اختياري */ }
});

const projectName = computed(() => projects.value.find((p) => p.id === projectId.value)?.name ?? '');
const newName = computed(() => (form.value.newActivityId ? targets.value.find((t) => t.id === form.value.newActivityId)?.name : projectName.value));
const cats = (c?: Category[]) => (c?.length ? c.map((x) => label('residency', x)).join('، ') : 'الكل');
const describe = (c: Conditions) => [
  `مساهمة المستفيد: ${c.acceptsPatientContribution ? 'مقبولة' : 'غير مقبولة'}`,
  `الحد الأعلى للصرف: ${c.maxSpend ? sar(c.maxSpend) : 'بلا حد'}`,
  `الجنسيات: ${c.nationalities?.length ? c.nationalities.join('، ') : 'الكل'}`,
  `الفئات: ${cats(c.categories)}`,
  `انتهاء المشروع: ${c.endDate ? fmtDate(c.endDate) : 'غير محدد'}`,
];

async function save() {
  if (!batch.value) return;
  busy.value = true;
  try {
    const f = form.value;
    await api('/projects-ops/amendments', {
      method: 'POST',
      json: {
        batchId: batchId.value, amount: Number(f.amount), effectiveDate: f.effectiveDate, newActivityId: f.newActivityId || null,
        acceptsPatientContribution: f.acceptsPatientContribution, maxSpend: f.maxSpend || null,
        nationalities: f.nationalities.split(/[،,]/).map((x) => x.trim()).filter(Boolean), categories: f.categories, endDate: f.endDate || null,
        reason: f.reason, donorApproved: f.donorApproved, donorApprovalRef: f.donorApprovalRef || null, acknowledged: f.acknowledged,
      },
    });
    toast.success('اعتُمد التعديل وسُجّل القيد العكسي والقيد الجديد');
    projectId.value = '';
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <section class="pm-hero">
      <div>
        <p class="pm-kicker">تعديل فرص التبرع</p>
        <h1>نموذج تعديل شروط فرصة تبرع</h1>
        <p class="pm-sub">يُعتمد التعديل بعد موافقة الداعم وإقرار المسؤول. أثره المالي قيد عكسي بمبلغ التعديل (بحد أقصى صافي الرصيد غير المحجوز وغير المخصوم) ثم قيد جديد بالمبلغ نفسه بالشروط الجديدة.</p>
      </div>
      <RouterLink :to="links.journal" class="btn btn-ghost">دفتر القيود</RouterLink>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <form v-if="canAmend" class="card pm-panel" @submit.prevent="save">
      <h2>تعديل جديد</h2>
      <div class="pm-grid2">
        <div class="field"><label>المشروع الحالي</label>
          <select v-model="projectId" class="input"><option value="">اختر المشروع</option><option v-for="p in projects.filter((x) => x.available > 0)" :key="p.id" :value="p.id">{{ p.code }} · {{ p.name }}</option></select>
        </div>
        <div class="field"><label>الدفعة (فرصة التبرع)</label>
          <select v-model="batchId" class="input" :disabled="!projectId"><option value="">اختر الدفعة</option><option v-for="b in batches" :key="b.id" :value="b.id">دفعة {{ b.batchNo }} · فرصة {{ b.opportunityNo }} · {{ b.donorName }} · صافي {{ sar(b.net) }}</option></select>
        </div>
      </div>

      <template v-if="batch">
        <div class="compare">
          <div class="side before">
            <h3>قبل التعديل</h3>
            <p><b>{{ projectName }}</b></p>
            <ul><li v-for="l in describe(batch.conditions)" :key="l">{{ l }}</li></ul>
            <RouterLink :to="links.opportunity(batch.opportunityId)" class="pm-link">فتح فرصة التبرع</RouterLink>
          </div>
          <div class="side after">
            <h3>بعد التعديل</h3>
            <div class="field"><label>المشروع</label>
              <select v-model="form.newActivityId" class="input">
                <option value="">نفس المشروع ({{ projectName }})</option>
                <option v-for="t in targets" :key="t.id" :value="t.id" :disabled="!!t.problems.length">{{ t.name }}{{ t.problems.length ? ` — ${t.problems[0]}` : '' }}</option>
              </select>
            </div>
            <label class="check"><input v-model="form.acceptsPatientContribution" type="checkbox" /> يقبل مساهمة المستفيد</label>
            <div class="pm-grid2">
              <div class="field"><label>الحد الأعلى للصرف</label><input v-model.number="form.maxSpend" class="input" type="number" min="0" step="0.01" placeholder="بلا حد" /></div>
              <div class="field"><label>تاريخ انتهاء المشروع</label><input v-model="form.endDate" class="input" type="date" /></div>
            </div>
            <div class="field"><label>الجنسيات المسموحة (افصل بفاصلة، فارغ = الكل)</label><input v-model="form.nationalities" class="input" /></div>
            <div class="field"><label>الفئات (فارغ = الكل)</label>
              <div class="cats"><label v-for="r in RESIDENCY" :key="r.value" class="check"><input v-model="form.categories" type="checkbox" :value="r.value" /> {{ r.label }}</label></div>
            </div>
          </div>
        </div>

        <div class="pm-grid2">
          <div class="field"><label>مبلغ التعديل *</label><input v-model.number="form.amount" class="input" type="number" min="0.01" step="0.01" :max="batch.net" required /><small class="pm-muted">الحد الأعلى صافي الرصيد الحر {{ sar(batch.net) }}</small></div>
          <div class="field"><label>تاريخ سريان التعديل *</label><input v-model="form.effectiveDate" class="input" type="date" required /></div>
        </div>
        <div class="field"><label>سبب التعديل *</label><textarea v-model="form.reason" class="input" rows="2" required minlength="3" /></div>

        <div class="effect">
          <h3>الأثر المالي</h3>
          <p>١. قيد عكسي بمبلغ <b>{{ sar(form.amount) }}</b> على توجيه القيد الأصلي لفرصة التبرع.</p>
          <p>٢. قيد جديد بالمبلغ نفسه على دفعة جديدة لمشروع «{{ newName }}» بالشروط الجديدة، من تاريخ {{ fmtDate(form.effectiveDate) }}.</p>
        </div>

        <div class="approvals">
          <label class="check strong"><input v-model="form.donorApproved" type="checkbox" /> وافق الداعم {{ batch.donorName }} على هذا التعديل</label>
          <div v-if="form.donorApproved" class="field" style="margin: 0"><label>مرجع موافقة الداعم (رقم خطاب أو بريد)</label><input v-model="form.donorApprovalRef" class="input" /></div>
          <label class="check strong"><input v-model="form.acknowledged" type="checkbox" /> أقر بأن بيانات التعديل صحيحة، وأن الداعم وافق عليها، وأتحمل مسؤولية اعتمادها.</label>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy || !form.donorApproved || !form.acknowledged">اعتماد التعديل</button></div>
      </template>
    </form>

    <div class="card table-wrap" style="margin-top: 16px">
      <table class="table">
        <thead><tr><th>الرقم</th><th>فرصة التبرع</th><th>الداعم</th><th>قبل ← بعد</th><th>المبلغ</th><th>السريان</th><th>الموافقة والإقرار</th></tr></thead>
        <tbody>
          <tr v-for="a in history" :key="a.id">
            <td>#{{ a.amendmentNo }}<span class="pm-muted">{{ fmtDate(a.createdAt) }}</span></td>
            <td><RouterLink :to="links.opportunity(a.opportunityId)" class="pm-link">فرصة {{ a.opportunityNo }}</RouterLink><span class="pm-muted"><RouterLink :to="links.batch(a.batchId)">دفعة {{ a.batchNo }}</RouterLink><template v-if="a.newBatchId"> ← <RouterLink :to="links.batch(a.newBatchId)">دفعة {{ a.newBatchNo }}</RouterLink></template></span></td>
            <td>{{ a.donorName }}</td>
            <td>{{ a.before.activityName }} ← {{ a.after.activityName }}<span class="pm-muted">{{ a.reason }}</span></td>
            <td class="pm-money">{{ sar(a.amount) }}<RouterLink v-if="a.reversalEntryId" :to="links.journal" class="pm-muted">القيد العكسي والجديد</RouterLink></td>
            <td>{{ fmtDate(a.effectiveDate) }}</td>
            <td><span class="pm-ok">✓ الداعم</span><span v-if="a.donorApprovalRef" class="pm-muted">{{ a.donorApprovalRef }}</span><span class="pm-muted">أقر: {{ a.acknowledgedByName }}</span></td>
          </tr>
          <tr v-if="!history.length"><td colspan="7" class="pm-empty">لا توجد تعديلات بعد</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.compare { display: grid; grid-template-columns: 1fr 1.4fr; gap: 14px; margin: 14px 0; }
.side { border: 1px solid var(--border); border-radius: 14px; padding: 14px; }
.side h3 { font-size: .9rem; margin: 0 0 8px; }
.side ul { margin: 0 0 8px; padding-inline-start: 18px; color: var(--muted); font-size: .88rem; }
.before { background: var(--surface-2); }
.after { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.check { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; cursor: pointer; }
.check.strong { font-weight: 600; }
.cats { display: flex; gap: 16px; flex-wrap: wrap; }
.effect { background: color-mix(in srgb, var(--primary) 7%, transparent); border-radius: 12px; padding: 12px 14px; margin: 6px 0 12px; }
.effect h3 { font-size: .9rem; margin: 0 0 6px; }
.effect p { margin: 2px 0; font-size: .88rem; }
.approvals { display: grid; gap: 8px; padding: 12px 14px; border: 1px dashed var(--warning, #f59e0b); border-radius: 12px; margin-bottom: 10px; }
@media (max-width: 760px) { .compare { grid-template-columns: 1fr; } }
</style>
