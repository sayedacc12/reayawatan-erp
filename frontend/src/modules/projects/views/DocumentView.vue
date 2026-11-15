<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { ACTIONS, DURATIONS, color, fmtDate, label, links, sar } from '../labels';
import type { BudgetLine, Kpi, Phase, Stage, TreeNode } from '../types';
import '../projects.css';

interface Page extends TreeNode {
  program: { id: string; name: string }; axis: { id: string; name: string };
  history: { id: string; kind: string; stageName: string | null; note: string | null; userName: string; createdAt: string }[];
  stages: Stage[]; canDecide: boolean;
}

const route = useRoute();
const session = useSession();
const toast = useToast();
const id = route.params.id as string;
const p = ref<Page | null>(null);
const error = ref('');
const busy = ref(false);

type Line = { item: string; quantity: number | ''; unitCost: number | ''; amount: number | ''; notes: string };
const blank = () => ({
  durationType: 'annual' as 'annual' | 'continuous', fiscalYear: new Date().getFullYear() as number | '', startDate: '', endDate: '', managerName: '',
  location: '', targetBeneficiaries: '' as number | '', idea: '', goals: '', targetGroups: '', outcomes: '', risks: '',
  phases: [] as { name: string; startDate: string; endDate: string; deliverables: string }[],
  kpis: [] as { name: string; baseline: number | ''; target: number | ''; unit: string }[],
  budgetLines: [] as Line[],
});
const f = reactive(blank());

function fill(n: Page) {
  Object.assign(f, {
    durationType: n.durationType ?? 'annual', fiscalYear: n.fiscalYear ?? (n.durationType === 'continuous' ? '' : new Date().getFullYear()),
    startDate: n.startDate ?? '', endDate: n.endDate ?? '', managerName: n.managerName ?? '', location: n.location ?? '',
    targetBeneficiaries: n.targetBeneficiaries ?? '', idea: n.idea ?? '', goals: n.goals ?? '', targetGroups: n.targetGroups ?? '',
    outcomes: n.outcomes ?? '', risks: n.risks ?? '',
    phases: (n.phases ?? []).map((x: Phase) => ({ name: x.name, startDate: x.startDate ?? '', endDate: x.endDate ?? '', deliverables: x.deliverables ?? '' })),
    kpis: (n.kpis ?? []).map((x: Kpi) => ({ name: x.name, baseline: x.baseline ?? '', target: x.target ?? '', unit: x.unit ?? '' })),
    budgetLines: (n.budgetLines ?? []).map((x: BudgetLine) => ({ item: x.item, quantity: x.quantity ?? '', unitCost: x.unitCost ?? '', amount: x.amount, notes: x.notes ?? '' })),
  });
  if (!f.phases.length) f.phases.push({ name: '', startDate: '', endDate: '', deliverables: '' });
  if (!f.kpis.length) f.kpis.push({ name: '', baseline: '', target: '', unit: '' });
  if (!f.budgetLines.length) f.budgetLines.push({ item: '', quantity: '', unitCost: '', amount: '', notes: '' });
}

async function load() {
  try {
    p.value = await api<Page>(`/projects/${id}`);
    fill(p.value);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

const canEdit = computed(() => !!p.value && ['draft', 'returned', 'rejected'].includes(p.value.approvalStatus ?? '') && session.can('projects.projects.manage'));
const n = (v: number | '' | null | undefined) => (v === '' || v === null || v === undefined ? null : Number(v));
function calc(l: Line) {
  if (n(l.quantity) !== null && n(l.unitCost) !== null) l.amount = Math.round(Number(l.quantity) * Number(l.unitCost) * 100) / 100;
}
const total = computed(() => f.budgetLines.reduce((t, l) => t + (Number(l.amount) || 0), 0));
const lastReturn = computed(() => [...(p.value?.history ?? [])].reverse().find((h) => h.kind === 'returned' || h.kind === 'rejected'));

function body() {
  return {
    durationType: f.durationType, fiscalYear: f.durationType === 'annual' ? n(f.fiscalYear) : null,
    startDate: f.startDate || null, endDate: f.endDate || null, managerName: f.managerName || null, location: f.location || null,
    targetBeneficiaries: n(f.targetBeneficiaries), idea: f.idea || null, goals: f.goals || null, targetGroups: f.targetGroups || null,
    outcomes: f.outcomes || null, risks: f.risks || null,
    phases: f.phases.filter((x) => x.name.trim()).map((x) => ({ name: x.name, startDate: x.startDate || null, endDate: x.endDate || null, deliverables: x.deliverables || null })),
    kpis: f.kpis.filter((x) => x.name.trim()).map((x) => ({ name: x.name, baseline: n(x.baseline), target: n(x.target), unit: x.unit || null })),
    budgetLines: f.budgetLines.filter((x) => x.item.trim()).map((x) => ({ item: x.item, quantity: n(x.quantity), unitCost: n(x.unitCost), amount: Number(x.amount) || 0, notes: x.notes || null })),
  };
}

async function save(thenSubmit = false) {
  busy.value = true;
  try {
    await api(`/projects/nodes/${id}`, { method: 'PATCH', json: body() });
    if (thenSubmit) {
      const r = await api<TreeNode>(`/projects/${id}/submit`, { method: 'POST' });
      toast.success(r.approvalStatus === 'approved' ? 'اعتُمد المشروع وأصبح متاحًا للتسويق في تنمية الموارد المالية' : `أُرسلت الوثيقة للاعتماد: ${r.currentStage?.name ?? ''}`);
    } else toast.success('حُفظت الوثيقة');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}

const decision = ref<'approve' | 'reject' | 'return' | null>(null);
const note = ref('');
async function decide() {
  busy.value = true;
  try {
    const r = await api<TreeNode>(`/projects/${id}/decision`, { method: 'POST', json: { decision: decision.value, note: note.value || null } });
    toast.success(r.approvalStatus === 'approved' ? 'اعتُمد المشروع نهائيًا وأصبح متاحًا للتسويق' : r.approvalStatus === 'pending' ? `انتقل إلى: ${r.currentStage?.name}` : 'تم تسجيل القرار');
    decision.value = null; note.value = '';
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const print = () => window.print();
</script>

<template>
  <div v-if="p" class="doc">
    <section class="pm-hero">
      <div>
        <p class="pm-kicker">وثيقة المشروع · {{ p.code }}</p>
        <h1>{{ p.name }}</h1>
        <p class="pm-sub">{{ p.axis?.name }} ← {{ p.program?.name }}</p>
        <div class="chips">
          <span class="pm-pill" :style="{ '--c': color('approval', p.approvalStatus) }">{{ label('approval', p.approvalStatus) }}<template v-if="p.currentStage"> · {{ p.currentStage.name }}</template></span>
          <span class="pm-pill" :style="{ '--c': color('funding', p.fundingType) }">{{ label('funding', p.fundingType) }}</span>
          <span v-if="p.zakatEligible" class="pm-tag zakat">ضمن الزكاة</span>
          <span class="pm-pill" :style="{ '--c': color('duration', p.durationType) }">{{ label('duration', p.durationType) }}<template v-if="p.durationType === 'annual' && p.fiscalYear"> {{ p.fiscalYear }}</template></span>
        </div>
      </div>
      <div class="pm-actions no-print">
        <RouterLink :to="links.project(p.id)" class="btn btn-ghost">صفحة المشروع</RouterLink>
        <button class="btn btn-ghost" @click="print">طباعة</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <p v-if="p.approvalStatus === 'approved'" class="alert ok no-print">الوثيقة معتمدة {{ fmtDate(p.approvedAt) }}، والمشروع متاح للتسويق في تنمية الموارد المالية. لتعديلها أعد فتح المشروع من صفحته.</p>
    <p v-else-if="lastReturn && canEdit" class="alert alert-error no-print">{{ lastReturn.kind === 'returned' ? 'مطلوب تعديل' : 'سبب الرفض' }} ({{ lastReturn.userName }}): {{ lastReturn.note }}</p>

    <fieldset :disabled="!canEdit" class="sheet">
      <section class="card pm-panel">
        <h2>١. مواصفات المشروع</h2>
        <div class="durations">
          <label v-for="d in DURATIONS" :key="d.value" class="dur" :class="{ on: f.durationType === d.value }">
            <input v-model="f.durationType" type="radio" :value="d.value" />
            <b>{{ d.label }}</b>
            <small>{{ d.value === 'annual' ? 'يُنشأ لسنة مالية محددة' : 'مستمر ولا يُعاد إنشاؤه كل سنة' }}</small>
          </label>
        </div>
        <div class="g3">
          <div v-if="f.durationType === 'annual'" class="field"><label>السنة المالية *</label><input v-model.number="f.fiscalYear" class="input" type="number" min="2000" /></div>
          <div class="field"><label>تاريخ البداية</label><input v-model="f.startDate" class="input" type="date" /></div>
          <div class="field"><label>تاريخ النهاية</label><input v-model="f.endDate" class="input" type="date" /></div>
          <div class="field"><label>مدير المشروع</label><input v-model="f.managerName" class="input" /></div>
          <div class="field"><label>نطاق التنفيذ</label><input v-model="f.location" class="input" placeholder="المدينة أو المنطقة" /></div>
          <div class="field"><label>عدد المستفيدين المستهدف</label><input v-model.number="f.targetBeneficiaries" class="input" type="number" min="0" /></div>
        </div>
      </section>

      <section class="card pm-panel">
        <h2>٢. فكرة المشروع وأهدافه</h2>
        <div class="field"><label>فكرة المشروع ومبرراته *</label><textarea v-model="f.idea" class="input" rows="4" placeholder="ما المشكلة التي يعالجها المشروع؟ ولماذا الآن؟" /></div>
        <div class="field"><label>الأهداف *</label><textarea v-model="f.goals" class="input" rows="3" placeholder="هدف في كل سطر" /></div>
        <div class="g2">
          <div class="field"><label>الفئات المستهدفة</label><textarea v-model="f.targetGroups" class="input" rows="2" /></div>
          <div class="field"><label>المخرجات والأثر المتوقع</label><textarea v-model="f.outcomes" class="input" rows="2" /></div>
        </div>
      </section>

      <section class="card pm-panel">
        <h2>٣. مراحل التنفيذ <button v-if="canEdit" type="button" class="btn btn-sm no-print" @click="f.phases.push({ name: '', startDate: '', endDate: '', deliverables: '' })">+ مرحلة</button></h2>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>#</th><th>المرحلة</th><th>من</th><th>إلى</th><th>المخرجات</th><th v-if="canEdit" class="no-print"></th></tr></thead>
          <tbody>
            <tr v-for="(ph, i) in f.phases" :key="i">
              <td>{{ i + 1 }}</td>
              <td><input v-model="ph.name" class="input" /></td>
              <td><input v-model="ph.startDate" class="input" type="date" /></td>
              <td><input v-model="ph.endDate" class="input" type="date" /></td>
              <td><input v-model="ph.deliverables" class="input" /></td>
              <td v-if="canEdit" class="no-print"><button type="button" class="btn btn-sm" @click="f.phases.splice(i, 1)">✕</button></td>
            </tr>
          </tbody>
        </table></div>
      </section>

      <section class="card pm-panel">
        <h2>٤. مؤشرات الأداء <button v-if="canEdit" type="button" class="btn btn-sm no-print" @click="f.kpis.push({ name: '', baseline: '', target: '', unit: '' })">+ مؤشر</button></h2>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>المؤشر</th><th>خط الأساس</th><th>المستهدف</th><th>الوحدة</th><th v-if="canEdit" class="no-print"></th></tr></thead>
          <tbody>
            <tr v-for="(k, i) in f.kpis" :key="i">
              <td><input v-model="k.name" class="input" /></td>
              <td><input v-model.number="k.baseline" class="input" type="number" /></td>
              <td><input v-model.number="k.target" class="input" type="number" /></td>
              <td><input v-model="k.unit" class="input" placeholder="جلسة، أسرة، %" /></td>
              <td v-if="canEdit" class="no-print"><button type="button" class="btn btn-sm" @click="f.kpis.splice(i, 1)">✕</button></td>
            </tr>
          </tbody>
        </table></div>
      </section>

      <section class="card pm-panel">
        <h2>٥. الموازنة <button v-if="canEdit" type="button" class="btn btn-sm no-print" @click="f.budgetLines.push({ item: '', quantity: '', unitCost: '', amount: '', notes: '' })">+ بند</button></h2>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>البند</th><th>الكمية</th><th>تكلفة الوحدة</th><th>المبلغ</th><th>ملاحظات</th><th v-if="canEdit" class="no-print"></th></tr></thead>
          <tbody>
            <tr v-for="(l, i) in f.budgetLines" :key="i">
              <td><input v-model="l.item" class="input" /></td>
              <td><input v-model.number="l.quantity" class="input" type="number" min="0" @input="calc(l)" /></td>
              <td><input v-model.number="l.unitCost" class="input" type="number" min="0" step="0.01" @input="calc(l)" /></td>
              <td><input v-model.number="l.amount" class="input" type="number" min="0" step="0.01" /></td>
              <td><input v-model="l.notes" class="input" /></td>
              <td v-if="canEdit" class="no-print"><button type="button" class="btn btn-sm" @click="f.budgetLines.splice(i, 1)">✕</button></td>
            </tr>
          </tbody>
          <tfoot><tr><td colspan="3"><b>إجمالي الموازنة</b></td><td class="pm-money">{{ sar(total) }}</td><td :colspan="canEdit ? 2 : 1"></td></tr></tfoot>
        </table></div>
      </section>

      <section class="card pm-panel">
        <h2>٦. المخاطر وطرق معالجتها</h2>
        <textarea v-model="f.risks" class="input" rows="3" />
      </section>
    </fieldset>

    <div v-if="canEdit" class="bar no-print">
      <button class="btn" :disabled="busy" @click="save(false)">حفظ مسودة</button>
      <button class="btn btn-primary" :disabled="busy" @click="save(true)">حفظ وإرسال للاعتماد</button>
    </div>

    <section v-if="p.canDecide" class="card pm-panel decide no-print">
      <h2>قرارك في مرحلة: {{ p.currentStage?.name }}</h2>
      <div class="pm-actions">
        <button class="btn btn-primary" @click="decision = 'approve'">✓ موافقة</button>
        <button class="btn" @click="decision = 'return'">↩ طلب تعديل</button>
        <button class="btn btn-danger" @click="decision = 'reject'">✕ رفض</button>
      </div>
      <form v-if="decision" class="field" style="margin-top: 10px" @submit.prevent="decide">
        <label>{{ decision === 'approve' ? 'ملاحظة (اختياري)' : decision === 'reject' ? 'سبب الرفض *' : 'المطلوب تعديله *' }}</label>
        <textarea v-model="note" class="input" rows="2" :required="decision !== 'approve'" />
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">تأكيد</button><button type="button" class="btn" @click="decision = null">إلغاء</button></div>
      </form>
    </section>

    <section v-if="p.history?.length" class="card pm-panel">
      <h2>سجل الاعتماد</h2>
      <ol class="log">
        <li v-for="h in p.history" :key="h.id"><b>{{ h.userName }}</b> {{ ACTIONS[h.kind] ?? h.kind }}<template v-if="h.stageName"> ({{ h.stageName }})</template> · <span class="pm-muted" style="display: inline">{{ fmtDate(h.createdAt) }}</span><p v-if="h.note" class="pm-muted">{{ h.note }}</p></li>
      </ol>
    </section>
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
</template>

<style scoped>
.doc { display: grid; gap: 14px; }
.doc .pm-hero { margin-bottom: 0; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.chips .pm-pill { background: rgba(255,255,255,.12); }
.sheet { border: 0; padding: 0; margin: 0; display: grid; gap: 14px; min-width: 0; }
.sheet:disabled .input { background: transparent; border-color: transparent; color: var(--text); padding-inline: 0; resize: none; opacity: 1; }
.durations { display: grid; grid-template-columns: repeat(2, minmax(0, 260px)); gap: 10px; margin-bottom: 12px; }
.dur { display: flex; flex-direction: column; gap: 2px; padding: 12px; border: 1px solid var(--border); border-radius: 12px; cursor: pointer; position: relative; }
.dur input { position: absolute; inset-inline-end: 10px; top: 12px; }
.dur small { color: var(--muted); }
.dur.on { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.g3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 14px; }
.g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
.table td .input { min-width: 90px; }
.bar { position: sticky; bottom: 12px; display: flex; gap: 8px; justify-content: flex-end; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); z-index: 5; }
.decide { border: 1px solid var(--primary); }
.ok { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
.log { margin: 0; padding-inline-start: 18px; display: grid; gap: 6px; }
.log p { margin: 2px 0 0; }
@media (max-width: 760px) { .g3, .g2, .durations { grid-template-columns: 1fr; } }
@media print { .no-print { display: none !important; } .pm-hero { color: #000; background: none; box-shadow: none; } .card { box-shadow: none; break-inside: avoid; } }
</style>
