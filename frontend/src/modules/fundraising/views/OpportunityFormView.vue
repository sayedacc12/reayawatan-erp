<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { CATEGORIES, color, hijri, label, sar, today } from '../labels';
import type { DonorRow, Opportunity, Settings, Targets } from '../types';
import '../fr.css';

type Kind = 'cash' | 'in_kind' | 'pledge';
type TargetKind = 'operational' | 'program' | 'waqf' | 'case';
interface Line { targetKind: TargetKind; activityId: string | null; waqfProjectId: string | null; beneficiaryRequestId: string | null; mode: 'amount' | 'percent'; percent: number | null; amount: number | null }

const route = useRoute();
const router = useRouter();
const toast = useToast();
const editId = computed(() => (route.params.id as string | undefined) ?? null);
const settings = ref<Settings | null>(null);
const targets = ref<Targets | null>(null);
const error = ref('');
const saving = ref(false);

const form = reactive({
  kind: 'cash' as Kind, donorId: '' as string, supportManagerId: null as string | null, date: today(), totalAmount: null as number | null,
  bankAccountId: null as string | null, transferReference: '', isZakat: false, conditionsText: '', inKindDescription: '',
  conditions: { acceptsPatientContribution: false, maxSpend: null as number | null, nationalities: [] as string[], categories: [] as string[], endDate: '' },
  lines: [] as Line[],
});
const donorName = ref('');
const donorSearch = ref('');
const donorResults = ref<DonorRow[]>([]);
const natInput = ref('');
const casePicker = ref<number | null>(null);
const caseSearch = ref('');

onMounted(async () => {
  try {
    [settings.value, targets.value] = await Promise.all([api<Settings>('/fundraising/settings'), api<Targets>('/fundraising/targets')]);
    if (editId.value) {
      const o = await api<Opportunity>(`/fundraising/opportunities/${editId.value}`);
      Object.assign(form, {
        kind: o.kind, donorId: o.donorId, supportManagerId: o.supportManagerId, date: o.date, totalAmount: o.totalAmount, bankAccountId: o.bankAccountId,
        transferReference: o.transferReference ?? '', isZakat: o.isZakat, conditionsText: o.conditionsText ?? '', inKindDescription: o.inKindDescription ?? '',
        conditions: { ...o.conditions, endDate: o.conditions.endDate ?? '' },
        lines: o.batches.filter((b) => !b.parentBatchId).map((b) => ({
          targetKind: b.targetKind as TargetKind, activityId: b.targetKind === 'case' ? null : b.activityId, waqfProjectId: b.waqfProjectId,
          beneficiaryRequestId: b.beneficiaryRequestId, mode: b.allocationMode, percent: b.percent, amount: b.allocationMode === 'amount' ? b.amount : null,
        })),
      });
      donorName.value = o.donor?.name ?? '';
    } else {
      const donorId = route.query.donor as string | undefined;
      if (donorId) {
        const d = await api<{ id: string; name: string; supportManagerId: string | null }>(`/fundraising/donors/${donorId}`);
        form.donorId = d.id;
        donorName.value = d.name;
        form.supportManagerId = d.supportManagerId;
      }
      const firstBank = settings.value.banks.find((b) => b.isActive);
      if (firstBank) form.bankAccountId = firstBank.id;
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
});

let t: ReturnType<typeof setTimeout> | undefined;
watch(donorSearch, (v) => {
  clearTimeout(t);
  if (!v.trim()) { donorResults.value = []; return; }
  t = setTimeout(async () => {
    const r = await api<{ items: DonorRow[] }>(`/fundraising/donors?active=true&pageSize=8&search=${encodeURIComponent(v)}`).catch(() => ({ items: [] }));
    donorResults.value = r.items;
  }, 250);
});
async function pickDonor(d: DonorRow) {
  form.donorId = d.id;
  donorName.value = d.name;
  donorSearch.value = '';
  donorResults.value = [];
  const full = await api<{ supportManagerId: string | null }>(`/fundraising/donors/${d.id}`).catch(() => null);
  if (full?.supportManagerId && !form.supportManagerId) form.supportManagerId = full.supportManagerId;
}

const total = computed(() => Number(form.totalAmount) || 0);
const lineAmount = (l: Line) => (l.mode === 'percent' ? Math.round(total.value * (Number(l.percent) || 0)) / 100 : Number(l.amount) || 0);
const allocated = computed(() => Math.round(form.lines.reduce((s, l) => s + lineAmount(l), 0) * 100) / 100);
const allPct = computed(() => form.lines.length > 0 && form.lines.every((l) => l.mode === 'percent') && Math.abs(form.lines.reduce((s, l) => s + (Number(l.percent) || 0), 0) - 100) < 0.0001);
const remaining = computed(() => (allPct.value ? 0 : Math.round((total.value - allocated.value) * 100) / 100));
const balanced = computed(() => total.value > 0 && form.lines.length > 0 && remaining.value === 0);
const fillPct = computed(() => (total.value ? Math.min(100, (allocated.value / total.value) * 100) : 0));

const programs = computed(() => (targets.value?.programs ?? []).filter((p) => !form.isZakat || p.zakatEligible));
const cases = computed(() => (targets.value?.cases ?? []).filter((c) => (!form.isZakat || c.zakatEligible) && (!caseSearch.value || `${c.beneficiaryName} ${c.requestNo} ${c.projectName}`.includes(caseSearch.value))));
watch(() => form.isZakat, (z) => {
  if (z) {
    const before = form.lines.length;
    form.lines = form.lines.filter((l) => l.targetKind === 'program' || l.targetKind === 'case');
    if (form.lines.length < before) toast.error('حُذفت البنود التشغيلية والأوقاف لأن الزكاة تُصرف في مصارفها فقط');
  }
});

function addLine(kind: TargetKind) {
  form.lines.push({ targetKind: kind, activityId: null, waqfProjectId: null, beneficiaryRequestId: null, mode: 'amount', percent: null, amount: form.lines.length ? (remaining.value > 0 ? remaining.value : null) : total.value || null });
  if (kind === 'case') casePicker.value = form.lines.length - 1;
}
function pickCase(c: Targets['cases'][number]) {
  const l = form.lines[casePicker.value!];
  l.beneficiaryRequestId = c.id;
  if (!l.amount && c.estimatedCost) l.amount = Math.max(0, c.estimatedCost - c.funded);
  casePicker.value = null;
}
const caseOf = (id: string | null) => targets.value?.cases.find((c) => c.id === id);
function addNat() {
  const v = natInput.value.trim();
  if (v && !form.conditions.nationalities.includes(v)) form.conditions.nationalities.push(v);
  natInput.value = '';
}
function toggleCat(c: string) {
  const arr = form.conditions.categories;
  const i = arr.indexOf(c);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(c);
}

async function save() {
  error.value = '';
  if (!form.donorId) { error.value = 'اختر الداعم'; return; }
  saving.value = true;
  try {
    const body = {
      ...form, totalAmount: total.value, transferReference: form.transferReference || null, conditionsText: form.conditionsText || null,
      inKindDescription: form.kind === 'in_kind' ? form.inKindDescription || null : null, bankAccountId: form.bankAccountId || null,
      conditions: { ...form.conditions, endDate: form.conditions.endDate || null, maxSpend: form.conditions.maxSpend || null },
      lines: form.lines.map((l) => ({ ...l, percent: l.mode === 'percent' ? Number(l.percent) : null, amount: l.mode === 'amount' ? Number(l.amount) : null })),
    };
    const o = await api<Opportunity>(editId.value ? `/fundraising/opportunities/${editId.value}` : '/fundraising/opportunities', { method: editId.value ? 'PUT' : 'POST', json: body });
    toast.success(editId.value ? 'تم حفظ التعديلات' : `تم تسجيل الفرصة رقم ${o.opportunityNo} وتوليد ${o.batches.length} دفعة`);
    router.push(`/fundraising/opportunities/${o.id}`);
  } catch (e) {
    error.value = (e as Error).message;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } finally {
    saving.value = false;
  }
}
const kinds: { value: Kind; title: string; hint: string; icon: string }[] = [
  { value: 'cash', title: 'تبرع نقدي', hint: 'تحويل إلى أحد حسابات الجمعية، ويصدر له سند قبض', icon: '﷼' },
  { value: 'in_kind', title: 'تبرع عيني', hint: 'أصناف ومواد تُقيَّم بقيمتها', icon: '📦' },
  { value: 'pledge', title: 'وعد بالدفع', hint: 'يُنفَّذ المشروع ويسدد الداعم بعد الانتهاء', icon: '🤝' },
];
const addButtons = computed(() => ([
  { kind: 'program' as const, label: 'تبرع مقيد (برنامج أو مشروع)', show: true },
  { kind: 'case' as const, label: 'حالة محددة', show: true },
  { kind: 'operational' as const, label: 'تبرع تشغيلي', show: !form.isZakat },
  { kind: 'waqf' as const, label: 'تبرع أوقاف', show: !form.isZakat },
]).filter((b) => b.show));
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>{{ editId ? 'تعديل فرصة تبرع' : 'فرصة تبرع جديدة' }}</h1><p class="muted sub">عند الحفظ تُولَّد الدفعات بأرقام مستقلة، وتبدأ الفرصة مراحل الاعتماد</p></div>
      <RouterLink to="/fundraising/opportunities" class="btn">رجوع</RouterLink>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <form v-if="settings && targets" class="layout" @submit.prevent="save">
      <div class="main">
        <!-- 1. نوع الفرصة -->
        <section class="fr-panel">
          <h2><span class="step">1</span> نوع الفرصة</h2>
          <div class="kinds">
            <button v-for="k in kinds" :key="k.value" type="button" :class="['kind', { on: form.kind === k.value }]" :style="{ '--c': color('kind', k.value) }" @click="form.kind = k.value">
              <span class="ic">{{ k.icon }}</span><b>{{ k.title }}</b><small>{{ k.hint }}</small>
            </button>
          </div>
        </section>

        <!-- 2. الداعم والمبلغ -->
        <section class="fr-panel">
          <h2><span class="step">2</span> الداعم وبيانات التبرع</h2>
          <div class="grid2">
            <div class="field span2"><label>الداعم *</label>
              <div v-if="form.donorId" class="picked"><b>{{ donorName }}</b><button type="button" class="btn btn-sm" @click="form.donorId = ''">تغيير</button></div>
              <div v-else class="search-box">
                <input v-model="donorSearch" class="input" placeholder="ابحث باسم الداعم أو جواله أو رقمه" />
                <ul v-if="donorResults.length" class="results">
                  <li v-for="d in donorResults" :key="d.id" @click="pickDonor(d)"><b>{{ d.name }}</b><small class="muted"> · رقم {{ d.donorNo }}{{ d.levelName ? ` · ${d.levelName}` : '' }}</small></li>
                </ul>
                <small class="muted">الداعم غير مسجل؟ <RouterLink to="/fundraising/donors">أضفه من سجل الداعمين</RouterLink></small>
              </div>
            </div>
            <div class="field"><label>إجمالي التبرع (ر.س) *</label><input v-model.number="form.totalAmount" type="number" min="1" step="0.01" class="input big" required /></div>
            <div class="field"><label>تاريخ الفرصة *</label><input v-model="form.date" type="date" class="input" required /><small class="muted">{{ hijri(form.date) }}</small></div>
            <div v-if="form.kind !== 'in_kind'" class="field"><label>الحساب البنكي {{ form.kind === 'cash' ? '*' : '(اختياري للوعد)' }}</label>
              <select v-model="form.bankAccountId" class="input" :required="form.kind === 'cash'"><option :value="null">—</option>
                <option v-for="b in settings.banks.filter((x) => x.isActive)" :key="b.id" :value="b.id">{{ b.bankName }} · {{ b.iban || b.accountNumber }}</option></select>
              <small v-if="!settings.banks.length" class="muted">أضف حسابات الجمعية من الإعدادات أولًا</small></div>
            <div v-if="form.kind === 'cash'" class="field"><label>رقم الحوالة أو المرجع</label><input v-model="form.transferReference" class="input" dir="ltr" /></div>
            <div class="field"><label>مدير الدعم</label>
              <select v-model="form.supportManagerId" class="input"><option :value="null">—</option><option v-for="m in settings.managers.filter((x) => x.isActive)" :key="m.id" :value="m.id">{{ m.name }}</option></select></div>
            <div v-if="form.kind === 'in_kind'" class="field span2"><label>وصف التبرع العيني (الأصناف والكميات) *</label><textarea v-model="form.inKindDescription" class="input" rows="3" /></div>
          </div>
        </section>

        <!-- 3. التوزيع -->
        <section class="fr-panel">
          <h2><span class="step">3</span> توزيع التبرع على البنود (الدفعات)</h2>
          <label :class="['zakat-toggle', { on: form.isZakat }]">
            <input v-model="form.isZakat" type="checkbox" />
            <span class="sw" /><span><b>هذا التبرع زكاة</b><small>تظهر فقط المشاريع المقيدة المعتمدة ضمن مصارف الزكاة، ولا يُوجَّه للتشغيلي أو الأوقاف</small></span>
          </label>

          <TransitionGroup name="line" tag="div" class="lines">
            <div v-for="(l, i) in form.lines" :key="i" class="line" :style="{ '--c': color('target', form.isZakat ? 'zakat' : l.targetKind) }">
              <div class="line-head">
                <span class="fr-badge">{{ label('target', l.targetKind) }}</span>
                <span class="grow" />
                <span class="fr-amount">{{ sar(lineAmount(l)) }}</span>
                <button type="button" class="btn btn-sm btn-danger" @click="form.lines.splice(i, 1)">حذف</button>
              </div>
              <div class="line-body">
                <select v-if="l.targetKind === 'program'" v-model="l.activityId" class="input target" required>
                  <option :value="null" disabled>اختر البرنامج أو المشروع</option>
                  <option v-for="p in programs" :key="p.id" :value="p.id">{{ p.path }}{{ p.zakatEligible ? ' ✦ زكاة' : '' }}</option>
                </select>
                <select v-else-if="l.targetKind === 'operational'" v-model="l.activityId" class="input target">
                  <option :value="null">التبرعات التشغيلية العامة</option>
                  <option v-for="p in targets.operational" :key="p.id" :value="p.id">{{ p.path }}</option>
                </select>
                <select v-else-if="l.targetKind === 'waqf'" v-model="l.waqfProjectId" class="input target" required>
                  <option :value="null" disabled>اختر مشروع الوقف</option>
                  <option v-for="w in targets.waqf" :key="w.id" :value="w.id">{{ w.name }}</option>
                </select>
                <button v-else type="button" class="input target case-btn" @click="casePicker = i">
                  <template v-if="caseOf(l.beneficiaryRequestId)">{{ caseOf(l.beneficiaryRequestId)!.beneficiaryName }} · طلب {{ caseOf(l.beneficiaryRequestId)!.requestNo }} · {{ caseOf(l.beneficiaryRequestId)!.projectName }}</template>
                  <template v-else>اختر طلب المستفيد...</template>
                </button>
                <div class="mode">
                  <button type="button" :class="['fr-pill', { on: l.mode === 'amount' }]" @click="l.mode = 'amount'">مبلغ</button>
                  <button type="button" :class="['fr-pill', { on: l.mode === 'percent' }]" @click="l.mode = 'percent'">نسبة %</button>
                </div>
                <input v-if="l.mode === 'amount'" v-model.number="l.amount" type="number" min="0" step="0.01" class="input val" placeholder="المبلغ" />
                <input v-else v-model.number="l.percent" type="number" min="0" max="100" step="0.001" class="input val" placeholder="النسبة" />
              </div>
            </div>
          </TransitionGroup>
          <p v-if="!form.lines.length" class="fr-empty">أضف بندًا واحدًا على الأقل. يمكن تجزئة التبرع على عدة بنود منها جزء تشغيلي.</p>
          <div class="add-row">
            <button v-for="b in addButtons" :key="b.kind" type="button" class="btn btn-sm add" :style="{ '--c': color('target', b.kind) }" @click="addLine(b.kind)">+ {{ b.label }}</button>
          </div>

          <div :class="['balance', { ok: balanced, over: remaining < 0 }]">
            <div class="fr-progress"><i :style="{ width: fillPct + '%', background: balanced ? 'linear-gradient(90deg,#34d399,#059669)' : remaining < 0 ? '#ef4444' : 'linear-gradient(90deg,#2dd4bf,#0f766e)' }" /></div>
            <div class="nums">
              <span>الموزع: <b>{{ sar(allPct ? total : allocated) }}</b></span>
              <span>الإجمالي: <b>{{ sar(total) }}</b></span>
              <span v-if="balanced" class="state">✓ التوزيع مطابق للإجمالي</span>
              <span v-else-if="remaining > 0" class="state">متبقٍ بدون توزيع: {{ sar(remaining) }}</span>
              <span v-else-if="remaining < 0" class="state">التوزيع أكبر من الإجمالي بـ {{ sar(-remaining) }}</span>
            </div>
          </div>
        </section>

        <!-- 4. الاشتراطات -->
        <section class="fr-panel">
          <h2><span class="step">4</span> اشتراطات الداعم</h2>
          <p class="muted hint">تنتقل نسخة من الاشتراطات لكل دفعة، ويتحقق منها نظام إدارة المشاريع عند تحميل طلبات المستفيدين.</p>
          <div class="grid2">
            <label class="check span2"><input v-model="form.conditions.acceptsPatientContribution" type="checkbox" /> الداعم يقبل مساهمة المستفيد (المريض) في التكلفة</label>
            <div class="field"><label>الحد الأعلى للصرف للحالة (ر.س)</label><input v-model.number="form.conditions.maxSpend" type="number" min="0" class="input" placeholder="بدون حد" /></div>
            <div class="field"><label>تاريخ انتهاء المشروع المتفق عليه</label><input v-model="form.conditions.endDate" type="date" class="input" /><small class="muted">{{ hijri(form.conditions.endDate) }}</small></div>
            <div class="field"><label>الفئات المستهدفة</label>
              <div class="fr-pills"><button v-for="c in CATEGORIES" :key="c.value" type="button" :class="['fr-pill', { on: form.conditions.categories.includes(c.value) }]" @click="toggleCat(c.value)">{{ c.label }}</button></div>
              <small class="muted">بدون اختيار = كل الفئات</small></div>
            <div class="field"><label>جنسيات محددة</label>
              <div class="tags"><span v-for="(n, i) in form.conditions.nationalities" :key="n" class="tag">{{ n }} <button type="button" @click="form.conditions.nationalities.splice(i, 1)">×</button></span>
                <input v-model="natInput" class="input tag-in" placeholder="اكتب الجنسية ثم Enter" @keydown.enter.prevent="addNat" @blur="addNat" /></div>
              <small class="muted">بدون جنسيات = كل الجنسيات</small></div>
            <div class="field span2"><label>اشتراطات أو إضافات أخرى</label><textarea v-model="form.conditionsText" class="input" rows="3" placeholder="مثل: تقرير ربع سنوي للداعم، تسمية المشروع باسم الداعم..." /></div>
          </div>
          <p class="muted hint">المستندات مثل الاتفاقيات تُرفق من صفحة الفرصة بعد الحفظ.</p>
        </section>
      </div>

      <aside class="side">
        <div class="summary">
          <p class="kicker">ملخص الفرصة</p>
          <strong class="sum-amount">{{ sar(total) }}</strong>
          <span class="muted-l">{{ kinds.find((k) => k.value === form.kind)!.title }}{{ form.isZakat ? ' · زكاة' : '' }}</span>
          <ul>
            <li v-for="(l, i) in form.lines" :key="i"><i :style="{ background: color('target', form.isZakat ? 'zakat' : l.targetKind) }" />{{ label('target', l.targetKind) }}<b>{{ sar(lineAmount(l)) }}</b></li>
          </ul>
          <button class="btn btn-gold full" :disabled="saving || !balanced">{{ saving ? 'جارٍ الحفظ...' : editId ? 'حفظ التعديلات' : 'حفظ وتوليد الدفعات' }}</button>
          <small v-if="!balanced" class="muted-l">لا يمكن الحفظ حتى يتساوى مجموع البنود مع إجمالي التبرع</small>
        </div>
      </aside>
    </form>
    <div v-else-if="!error" class="fr-skeleton" />

    <div v-if="casePicker !== null && targets" class="modal-backdrop" @click.self="casePicker = null">
      <div class="card modal modal-wide">
        <h2>اختر طلب المستفيد</h2>
        <p class="muted">الطلبات المفتوحة والمعتمدة{{ form.isZakat ? ' في مشاريع الزكاة' : '' }}. ستصبح الدفعة مقيدة لهذه الحالة.</p>
        <input v-model="caseSearch" class="input" placeholder="ابحث باسم المستفيد أو رقم الطلب" />
        <div class="table-wrap cases">
          <table class="table">
            <thead><tr><th>الطلب</th><th>المستفيد</th><th>المشروع ونوع الطلب</th><th>التكلفة</th><th>مموَّل</th></tr></thead>
            <tbody>
              <tr v-for="c in cases" :key="c.id" class="fr-row-link" @click="pickCase(c)">
                <td><span class="fr-no">{{ c.requestNo }}</span></td><td><b>{{ c.beneficiaryName }}</b></td>
                <td>{{ c.projectName }}<small v-if="c.services?.length" class="muted"> · {{ c.services.join('، ') }}</small> <span v-if="c.zakatEligible" class="fr-zakat">زكاة</span></td>
                <td>{{ c.estimatedCost ? sar(c.estimatedCost) : '—' }}</td><td>{{ sar(c.funded) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!cases.length" class="fr-empty">لا توجد طلبات مطابقة</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sub { margin: 2px 0 0; font-size: .88rem; }
.layout { display: grid; grid-template-columns: 1fr 300px; gap: 18px; align-items: start; }
.main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.step { width: 26px; height: 26px; border-radius: 8px; display: inline-grid; place-items: center; background: var(--grad); color: #fff; font-size: .82rem; box-shadow: 0 0 12px rgba(20,184,166,.5); }
.hint { font-size: .85rem; margin: -6px 0 12px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
.span2 { grid-column: span 2; }
.kinds { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.kind { position: relative; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; text-align: right; padding: 16px; border-radius: 14px; border: 2px solid var(--border);
  background: var(--surface); cursor: pointer; font: inherit; transition: all .25s var(--ease); overflow: hidden; }
.kind small { color: var(--muted); font-size: .8rem; }
.kind .ic { font-size: 1.5rem; line-height: 1; margin-bottom: 4px; }
.kind:hover { transform: translateY(-2px); border-color: var(--c); }
.kind.on { border-color: var(--c); background: color-mix(in srgb, var(--c) 8%, var(--surface)); box-shadow: 0 12px 28px color-mix(in srgb, var(--c) 25%, transparent); }
.kind.on::after { content: '✓'; position: absolute; top: 10px; inset-inline-end: 12px; width: 22px; height: 22px; border-radius: 50%; background: var(--c); color: #fff; display: grid; place-items: center; font-size: .75rem; }
.picked { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 10px; background: var(--primary-soft); }
.picked b { flex: 1; }
.search-box { position: relative; }
.results { position: absolute; z-index: 5; inset-inline: 0; top: 44px; list-style: none; margin: 0; padding: 6px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 14px 30px rgba(0,0,0,.12); }
.results li { padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.results li:hover { background: var(--surface-2); }
.big { font-size: 1.2rem; font-weight: 700; }
.zakat-toggle { display: flex; gap: 12px; align-items: center; padding: 12px 14px; border-radius: 12px; border: 1px dashed #e8b04b; background: #fffbeb; cursor: pointer; margin-bottom: 14px; transition: all .25s; }
.zakat-toggle input { display: none; }
.zakat-toggle small { display: block; color: #92400e; font-size: .8rem; }
.zakat-toggle .sw { width: 42px; height: 24px; border-radius: 24px; background: #e5e7eb; position: relative; flex-shrink: 0; transition: background .25s; }
.zakat-toggle .sw::after { content: ''; position: absolute; top: 3px; inset-inline-start: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.2); transition: all .25s var(--ease); }
.zakat-toggle.on { border-style: solid; background: linear-gradient(135deg, #fef3c7, #fde68a); box-shadow: 0 0 0 4px rgba(232,176,75,.15), 0 0 24px rgba(232,176,75,.35); }
.zakat-toggle.on .sw { background: linear-gradient(135deg, #f5c66b, #d99a2b); }
.zakat-toggle.on .sw::after { inset-inline-start: 21px; }
.lines { display: flex; flex-direction: column; gap: 10px; }
.line { border: 1px solid var(--border); border-inline-start: 4px solid var(--c); border-radius: 12px; padding: 10px 12px; background: linear-gradient(90deg, color-mix(in srgb, var(--c) 6%, var(--surface)), var(--surface)); }
.line .fr-badge { --c: inherit; }
.line-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.line-body { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.target { flex: 1; min-width: 240px; }
.case-btn { text-align: right; cursor: pointer; color: var(--text); }
.mode { display: flex; gap: 4px; }
.val { width: 140px; }
.grow { flex: 1; }
.add-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.add { border-color: color-mix(in srgb, var(--c) 45%, var(--border)); color: var(--c); font-weight: 600; }
.add:hover { background: color-mix(in srgb, var(--c) 10%, var(--surface)); }
.balance { margin-top: 16px; padding: 12px 14px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); transition: all .3s; }
.balance .fr-progress { height: 10px; }
.balance .nums { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 8px; font-size: .88rem; }
.balance .state { margin-inline-start: auto; font-weight: 700; color: #b45309; }
.balance.ok { border-color: #34d399; background: #ecfdf5; box-shadow: 0 0 22px rgba(16,185,129,.2); }
.balance.ok .state { color: #047857; }
.balance.over .state { color: var(--danger); }
.tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 4px; border: 1px solid var(--border); border-radius: 8px; }
.tag { display: inline-flex; align-items: center; gap: 4px; background: var(--primary-soft); color: var(--primary); border-radius: 999px; padding: 2px 10px; font-size: .85rem; }
.tag button { border: 0; background: none; cursor: pointer; color: inherit; font-size: 1rem; line-height: 1; }
.tag-in { border: 0 !important; flex: 1; min-width: 140px; outline: none !important; }
.side { position: sticky; top: 84px; }
.summary { position: relative; overflow: hidden; border-radius: 18px; padding: 20px; color: #fff; background: var(--grad-dark); box-shadow: 0 16px 36px rgba(6,20,26,.22); display: flex; flex-direction: column; gap: 6px; }
.summary::before { content: ''; position: absolute; inset: 0; background: radial-gradient(260px 160px at 90% 0%, rgba(232,176,75,.45), transparent 70%); pointer-events: none; animation: fr-breathe 8s ease-in-out infinite; }
.summary > * { position: relative; }
.summary .kicker { margin: 0; color: #f5c66b; font-weight: 600; font-size: .85rem; }
.sum-amount { font-size: 1.8rem; letter-spacing: -.5px; }
.muted-l { color: rgba(255,255,255,.7); font-size: .82rem; }
.summary ul { list-style: none; padding: 0; margin: 8px 0; display: flex; flex-direction: column; gap: 6px; font-size: .86rem; }
.summary li { display: flex; align-items: center; gap: 8px; }
.summary li i { width: 9px; height: 9px; border-radius: 3px; box-shadow: 0 0 8px currentColor; }
.summary li b { margin-inline-start: auto; }
.full { width: 100%; margin-top: 6px; }
.cases { max-height: 50vh; overflow: auto; margin-top: 10px; }
.line-enter-active, .line-leave-active { transition: all .3s var(--ease); }
.line-enter-from, .line-leave-to { opacity: 0; transform: translateX(-14px); }
@media (max-width: 980px) { .layout { grid-template-columns: 1fr; } .side { position: static; } }
@media (max-width: 640px) { .kinds, .grid2 { grid-template-columns: 1fr; } .span2 { grid-column: auto; } .val { width: 100%; } }
</style>
