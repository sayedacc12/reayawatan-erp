<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../../api';
import { useSession } from '../../../../stores/session';
import { useToast } from '../../../../stores/toast';
import { AF, useLookups } from '../../assets';
import { P, dt, sar } from '../../lib';
import '../../../projects/projects.css';
import '../../acc.css';
import './assets.css';

interface Head {
  id: string; title: string; status: 'draft' | 'approved'; statusLabel: string; externalRef: string | null; year: { id: string; name: number; start: string; end: string };
  lines: number; planned: number; actual: number; committed: number; remaining: number; createdByName: string; approvedByName: string | null; approvedAt: string | null;
}
interface MoveRef { id: string; kind: string; kindLabel: string; status: string; amount: number; date: string; asset: { id: string; code: string; name: string }; groupName?: string }
interface Line {
  id: string; lineNo: number; groupId: string; groupName: string; description: string; quantity: number; amount: number; quarter: number | null; unitId: string | null;
  unitName: string | null; externalRef: string | null; notes: string | null; actual: number; committed: number; remaining: number; usedPct: number; over: boolean; moves: MoveRef[];
}
interface Detail extends Omit<Head, 'lines'> {
  notes: string | null; lines: Line[]; unbudgeted: MoveRef[]; unbudgetedTotal: number; quarters: { quarter: number; planned: number }[];
  byGroup: { groupId: string; groupName: string; planned: number; actual: number; committed: number; unbudgeted: number; unbudgetedPending: number }[];
}
interface EditLine { id?: string; groupId: string; description: string; quantity: number; amount: number | null; quarter: number | null; unitId: string | null; externalRef: string; notes: string }

const props = defineProps<{ id?: string }>();
const session = useSession();
const toast = useToast();
const router = useRouter();
const { lookups, load: loadLookups } = useLookups();
const list = ref<Head[]>([]);
const b = ref<Detail | null>(null);
const error = ref('');
const open = ref<string | null>(null);
const canEdit = computed(() => session.can(P.assetsBudget));

async function load() {
  error.value = '';
  try {
    if (props.id) b.value = await api<Detail>(`${AF}/budgets/${props.id}`);
    else list.value = await api<Head[]>(`${AF}/budgets`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => { load(); loadLookups().catch(() => {}); });
watch(() => props.id, () => { b.value = null; editing.value = false; load(); });

// ---------------- الإنشاء والتعديل ----------------
const editing = ref(false);
const busy = ref(false);
const form = reactive({ fiscalYearId: '', title: '', externalRef: '', notes: '', lines: [] as EditLine[] });
const usedYears = computed(() => new Set(list.value.map((x) => x.year.id)));
const freeYears = computed(() => (lookups.value?.years ?? []).filter((y) => !usedYears.value.has(y.id)).slice().reverse());
const blank = (): EditLine => ({ groupId: '', description: '', quantity: 1, amount: null, quarter: null, unitId: null, externalRef: '', notes: '' });
function startNew() {
  Object.assign(form, { fiscalYearId: freeYears.value[0]?.id ?? '', title: '', externalRef: '', notes: '', lines: [blank()] });
  editing.value = true;
}
function startEdit() {
  if (!b.value) return;
  Object.assign(form, {
    fiscalYearId: b.value.year.id, title: b.value.title, externalRef: b.value.externalRef ?? '', notes: b.value.notes ?? '',
    lines: b.value.lines.map((l) => ({ id: l.id, groupId: l.groupId, description: l.description, quantity: l.quantity, amount: l.amount, quarter: l.quarter, unitId: l.unitId, externalRef: l.externalRef ?? '', notes: l.notes ?? '' })),
  });
  editing.value = true;
}
const formTotal = computed(() => form.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));
async function save() {
  busy.value = true;
  try {
    const json = {
      fiscalYearId: form.fiscalYearId, title: form.title || null, externalRef: form.externalRef || null, notes: form.notes || null,
      lines: form.lines.map((l) => ({ ...l, externalRef: l.externalRef || null, notes: l.notes || null })),
    };
    const r = b.value
      ? await api<Detail>(`${AF}/budgets/${b.value.id}`, { method: 'PUT', json })
      : await api<Detail>(`${AF}/budgets`, { method: 'POST', json });
    toast.success('حُفظت الموازنة الرأسمالية');
    editing.value = false;
    if (b.value) b.value = r;
    else router.push(`/accounting/assets/budget/${r.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function act(kind: 'approve' | 'reopen' | 'remove') {
  if (!b.value) return;
  const ask = { approve: 'اعتماد الموازنة؟ بعد الاعتماد تُربط بها عمليات الشراء ولا تُعدَّل إلا بإعادتها لمسودة.', reopen: 'إعادة الموازنة لمسودة لتعديلها؟ لا تُربط بها عمليات جديدة حتى تُعتمد مرة أخرى.', remove: 'حذف الموازنة نهائيًا؟' }[kind];
  if (!confirm(ask)) return;
  try {
    if (kind === 'remove') {
      await api(`${AF}/budgets/${b.value.id}`, { method: 'DELETE' });
      toast.success('حُذفت الموازنة');
      router.push('/accounting/assets/budget');
      return;
    }
    b.value = await api<Detail>(`${AF}/budgets/${b.value.id}/${kind}`, { method: 'POST' });
    toast.success(kind === 'approve' ? 'اعتُمدت الموازنة' : 'أُعيدت الموازنة لمسودة');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const pct = (a: number, p: number) => (p ? Math.min(100, Math.round((a / p) * 100)) : 0);
const MOVE_STATUS: Record<string, string> = { done: 'منفذة', pending: 'تنتظر الاعتماد' };
</script>

<template>
  <div>
    <section class="pm-hero ac-hero fa-hero">
      <div>
        <p class="pm-kicker">الأصول الثابتة</p>
        <h1>{{ b ? b.title : 'الموازنة الرأسمالية' }}</h1>
        <p class="pm-sub" v-if="!b">موازنة سنوية لشراء الأصول، بنودها حسب مجموعة الأصل والربع والجهة. تُربط بها عمليات الشراء والإضافة والدفعات تحت التنفيذ فيظهر المنفذ والمتبقي لكل بند. وفي كل موازنة وبند حقل «مرجع خارجي» لربطها لاحقًا بنظام الخطة والموازنة.</p>
        <p class="pm-sub" v-else>السنة المالية {{ b.year.name }} ({{ b.year.start }} ← {{ b.year.end }}) · <span class="pm-pill" :style="{ '--c': b.status === 'approved' ? '#10b981' : '#64748b' }">{{ b.statusLabel }}</span>
          <template v-if="b.approvedByName"> · اعتمدها {{ b.approvedByName }} {{ b.approvedAt ? dt(b.approvedAt) : '' }}</template></p>
      </div>
      <div class="pm-actions">
        <template v-if="!b">
          <button v-if="canEdit && freeYears.length" class="btn ac-glow" @click="startNew">موازنة جديدة</button>
        </template>
        <template v-else>
          <RouterLink to="/accounting/assets/budget" class="btn ac-ghost">كل الموازنات</RouterLink>
          <template v-if="canEdit">
            <button v-if="b.status === 'draft'" class="btn ac-ghost" @click="startEdit">تعديل</button>
            <button v-if="b.status === 'draft'" class="btn ac-glow" @click="act('approve')">اعتماد</button>
            <button v-if="b.status === 'approved'" class="btn ac-ghost" @click="act('reopen')">إعادة لمسودة</button>
            <button v-if="b.status === 'draft'" class="btn ac-ghost" @click="act('remove')">حذف</button>
          </template>
          <RouterLink v-if="session.can(P.reports)" :to="{ path: '/accounting/reports', query: { r: 'accounting.assets.capital-budget', f_budgetId: b.id } }" class="btn ac-ghost">تقرير</RouterLink>
        </template>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <!-- قائمة الموازنات -->
    <section v-if="!props.id" class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>السنة</th><th>الموازنة</th><th>البنود</th><th>المخطط</th><th>المنفذ</th><th>تحت الاعتماد</th><th>المتبقي</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="x in list" :key="x.id" class="ac-row-click" @click="router.push(`/accounting/assets/budget/${x.id}`)">
              <td><b>{{ x.year.name }}</b></td><td>{{ x.title }}<span v-if="x.externalRef" class="pm-muted ac-code">{{ x.externalRef }}</span></td><td>{{ x.lines }}</td>
              <td class="ac-num">{{ sar(x.planned) }}</td><td class="ac-num">{{ sar(x.actual) }}</td><td class="ac-num">{{ sar(x.committed) }}</td>
              <td class="ac-num"><b :class="{ neg: x.remaining < 0 }">{{ sar(x.remaining) }}</b></td>
              <td><span class="pm-pill" :style="{ '--c': x.status === 'approved' ? '#10b981' : '#64748b' }">{{ x.statusLabel }}</span></td>
            </tr>
            <tr v-if="!list.length"><td colspan="8" class="pm-empty">لا توجد موازنات رأسمالية بعد</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- تفاصيل موازنة -->
    <template v-if="b">
      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #6366f1; --i: 0"><span>المخطط</span><strong>{{ sar(b.planned) }}</strong><small>{{ b.lines.length }} بند</small></div>
        <div class="pm-kpi" style="--a: #10b981; --i: 1"><span>المنفذ</span><strong>{{ sar(b.actual) }}</strong><small>{{ pct(b.actual, b.planned) }}% من المخطط</small></div>
        <div class="pm-kpi" style="--a: #f59e0b; --i: 2"><span>تحت الاعتماد</span><strong>{{ sar(b.committed) }}</strong><small>سندات لم تُعتمد بعد</small></div>
        <div class="pm-kpi" style="--a: #0ea5e9; --i: 3"><span>المتبقي</span><strong :class="{ neg: b.remaining < 0 }">{{ sar(b.remaining) }}</strong><small>خارج الموازنة {{ sar(b.unbudgetedTotal) }}</small></div>
      </div>
      <div class="life"><i class="done" :style="{ width: pct(b.actual, b.planned) + '%' }" /><i class="pend" :style="{ width: pct(b.committed, b.planned) + '%' }" /></div>

      <section class="card pm-panel">
        <h2>بنود الموازنة</h2>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>#</th><th>البند</th><th>المجموعة</th><th>الكمية</th><th>الربع</th><th>المخطط</th><th>المنفذ</th><th>تحت الاعتماد</th><th>المتبقي</th><th>الاستخدام</th></tr></thead>
            <tbody>
              <template v-for="l in b.lines" :key="l.id">
                <tr class="ac-row-click" :class="{ over: l.over }" @click="open = open === l.id ? null : l.id">
                  <td>{{ l.lineNo }}</td>
                  <td><b>{{ l.description }}</b><span class="pm-muted">{{ l.unitName ?? '' }}{{ l.externalRef ? ` · ${l.externalRef}` : '' }}</span></td>
                  <td>{{ l.groupName }}</td><td>{{ l.quantity }}</td><td>{{ l.quarter ? `الربع ${l.quarter}` : '—' }}</td>
                  <td class="ac-num">{{ sar(l.amount) }}</td><td class="ac-num">{{ sar(l.actual) }}</td><td class="ac-num">{{ sar(l.committed) }}</td>
                  <td class="ac-num"><b :class="{ neg: l.over }">{{ sar(l.remaining) }}</b></td>
                  <td><div class="bar"><i :style="{ width: Math.min(100, l.usedPct) + '%' }" :class="{ over: l.over }" /></div><small>{{ l.usedPct }}%{{ l.over ? ' · تجاوز' : '' }}</small></td>
                </tr>
                <tr v-if="open === l.id" class="sub">
                  <td colspan="10">
                    <p v-if="!l.moves.length" class="pm-empty">لم تُربط عمليات بهذا البند بعد</p>
                    <div v-for="m in l.moves" :key="m.id" class="fa-grow">
                      <span class="grow"><RouterLink :to="`/accounting/assets/${m.asset.id}`" class="pm-link">{{ m.asset.code }} {{ m.asset.name }}</RouterLink><small class="pm-muted">{{ m.kindLabel }} · {{ m.date }} · {{ MOVE_STATUS[m.status] ?? m.status }}</small></span>
                      <span class="ac-num">{{ sar(m.amount) }}</span>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </section>

      <div class="fa-grid2" style="margin-top: 16px">
        <section class="card pm-panel">
          <h2>حسب مجموعة الأصول</h2>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>المجموعة</th><th>المخطط</th><th>المنفذ</th><th>تحت الاعتماد</th><th>خارج الموازنة</th></tr></thead>
              <tbody>
                <tr v-for="g in b.byGroup" :key="g.groupId">
                  <td>{{ g.groupName }}</td><td class="ac-num">{{ sar(g.planned) }}</td><td class="ac-num">{{ sar(g.actual) }}</td><td class="ac-num">{{ sar(g.committed) }}</td>
                  <td class="ac-num"><span :class="{ neg: g.unbudgeted + g.unbudgetedPending > 0 }">{{ sar(g.unbudgeted + g.unbudgetedPending) }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <h2 style="margin-top: 16px">التوزيع على الأرباع</h2>
          <div class="qs">
            <div v-for="q in b.quarters" :key="q.quarter" class="q"><span>الربع {{ q.quarter }}</span><b>{{ sar(q.planned) }}</b></div>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>إنفاق رأسمالي خارج الموازنة</h2>
          <p class="fa-sub">عمليات شراء أو إضافة أو دفعات تحت التنفيذ في سنة الموازنة لم تُربط بأي بند.</p>
          <p v-if="!b.unbudgeted.length" class="pm-empty">كل الإنفاق الرأسمالي مربوط ببنود الموازنة</p>
          <div v-for="m in b.unbudgeted" :key="m.id" class="fa-grow">
            <span class="grow"><RouterLink :to="`/accounting/assets/${m.asset.id}`" class="pm-link">{{ m.asset.code }} {{ m.asset.name }}</RouterLink><small class="pm-muted">{{ m.groupName }} · {{ m.kindLabel }} · {{ m.date }} · {{ MOVE_STATUS[m.status] ?? m.status }}</small></span>
            <span class="ac-num">{{ sar(m.amount) }}</span>
          </div>
        </section>
      </div>
      <p v-if="b.notes || b.externalRef" class="fa-sub" style="margin-top: 12px">{{ b.externalRef ? `المرجع الخارجي: ${b.externalRef}. ` : '' }}{{ b.notes ?? '' }}</p>
    </template>

    <!-- نافذة الإنشاء والتعديل -->
    <div v-if="editing" class="modal-backdrop" @click.self="editing = false">
      <form class="card modal wide" @submit.prevent="save">
        <h2>{{ b ? 'تعديل الموازنة الرأسمالية' : 'موازنة رأسمالية جديدة' }}</h2>
        <div class="field-row">
          <label class="field"><span>السنة المالية</span>
            <select v-model="form.fiscalYearId" class="input" :disabled="!!b" required>
              <option v-if="b" :value="b.year.id">{{ b.year.name }}</option>
              <option v-for="y in freeYears" :key="y.id" :value="y.id">{{ y.name }}</option>
            </select></label>
          <label class="field"><span>العنوان (اختياري)</span><input v-model="form.title" class="input" maxlength="200" placeholder="الموازنة الرأسمالية لسنة ..." /></label>
          <label class="field"><span>مرجع خارجي (اختياري)</span><input v-model="form.externalRef" class="input ac-code" maxlength="120" placeholder="رقمها في نظام الخطة والموازنة" /></label>
        </div>
        <div class="table-wrap">
          <table class="table lines">
            <thead><tr><th>المجموعة</th><th>وصف البند</th><th>الكمية</th><th>المبلغ</th><th>الربع</th><th>الجهة</th><th>مرجع خارجي</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(l, i) in form.lines" :key="i">
                <td><select v-model="l.groupId" class="input" required><option value="" disabled>اختر</option><option v-for="g in lookups?.groups ?? []" :key="g.id" :value="g.id">{{ g.name }}</option></select></td>
                <td><input v-model="l.description" class="input" maxlength="300" required /></td>
                <td><input v-model.number="l.quantity" type="number" min="1" class="input sm" /></td>
                <td><input v-model.number="l.amount" type="number" min="0" step="0.01" class="input" required /></td>
                <td><select v-model="l.quarter" class="input sm"><option :value="null">—</option><option v-for="q in 4" :key="q" :value="q">{{ q }}</option></select></td>
                <td><select v-model="l.unitId" class="input"><option :value="null">—</option><option v-for="u in lookups?.units ?? []" :key="u.id" :value="u.id">{{ u.name }}</option></select></td>
                <td><input v-model="l.externalRef" class="input ac-code" maxlength="120" /></td>
                <td><button type="button" class="btn btn-sm" :disabled="form.lines.length === 1" @click="form.lines.splice(i, 1)">✕</button></td>
              </tr>
            </tbody>
            <tfoot><tr><td colspan="3"><button type="button" class="btn btn-sm" @click="form.lines.push(blank())">+ بند</button></td><td class="ac-num"><b>{{ sar(formTotal) }}</b></td><td colspan="4" /></tr></tfoot>
          </table>
        </div>
        <label class="field"><span>ملاحظات</span><input v-model="form.notes" class="input" maxlength="1000" /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ كمسودة</button><button type="button" class="btn" @click="editing = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped>
td .pm-muted { display: block; }
.neg { color: #b91c1c; }
tr.over td { background: #fef2f2; }
tr.sub td { background: #f8fafc; }
.bar { width: 90px; height: 6px; border-radius: 99px; background: #e2e8f0; overflow: hidden; }
.bar i { display: block; height: 100%; background: linear-gradient(90deg, #10b981, #0ea5e9); }
.bar i.over { background: linear-gradient(90deg, #f59e0b, #dc2626); }
.life { display: flex; height: 8px; border-radius: 99px; background: #e2e8f0; margin: -6px 0 16px; overflow: hidden; }
.life i.done { background: linear-gradient(90deg, #10b981, #059669); }
.life i.pend { background: #fcd34d; }
.qs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.q { border-radius: 12px; padding: 10px; background: #f1f5f9; display: flex; flex-direction: column; gap: 4px; font-size: .85rem; }
.modal.wide { max-width: 1100px; width: 96vw; }
.lines .input { min-width: 90px; }
.lines .input.sm { min-width: 60px; width: 70px; }
</style>
