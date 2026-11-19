<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { errMsg, money, num } from '../lib';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** الربط بالمخاطر وتحليلات PESTEL/SWOT والمراجعة الداخلية والأداء الوظيفي: قراءة من الأنظمة المصدر، والخطة تستجيب لها */
const props = defineProps<{ plan: any; editable: boolean }>();
const emit = defineEmits<{ (e: 'changed', v: any): void; (e: 'select', id: string): void }>();
const toast = useToast();
const d = ref<any>(null);
const err = ref('');
const sec = ref<'risks' | 'audit' | 'analysis' | 'hr'>('risks');

async function load() {
  try { d.value = await api(`/planning/plans/${props.plan.id}/integrations`); err.value = ''; } catch (e) { err.value = errMsg(e); }
}
onMounted(load);

const ALERT_C: Record<string, string> = { danger: '#dc2626', warning: '#d97706', info: '#0284c7' };
const parents = computed(() => (props.plan.items ?? []).filter((i: any) => i.level < props.plan.levels.length - 1 && i.state !== 'cancelled'));
const leaves = computed(() => (props.plan.items ?? []).filter((i: any) => i.state !== 'cancelled'));
const covPct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 100);

// نشاط معالجة أو إجراء تصحيحي جديد
const tf = reactive({ open: false, system: 'risk' as 'risk' | 'audit', ref: null as any, parentId: '', title: '', ownerName: '', endDate: '', year: 0, cost: 0, busy: false });
const childLevel = computed(() => { const p = (props.plan.items ?? []).find((i: any) => i.id === tf.parentId); return props.plan.levels[(p?.level ?? 0) + 1]?.name ?? 'نشاط'; });
function openTreatment(system: 'risk' | 'audit', r: any) {
  const y = props.plan.periods?.[0] ?? new Date().getFullYear();
  Object.assign(tf, {
    open: true, system, ref: r, parentId: parents.value.find((p: any) => p.level === 0)?.id ?? parents.value[0]?.id ?? '',
    title: system === 'risk' ? `معالجة الخطر ${r.code}: ${r.title}` : `تنفيذ الإجراء التصحيحي ${r.code}: ${r.title}`,
    ownerName: r.ownerName ?? '', endDate: system === 'audit' ? r.dueDate ?? '' : '', year: y, cost: 0, busy: false,
  });
}
async function saveTreatment() {
  tf.busy = true;
  try {
    const plan = await api(`/planning/items/${tf.parentId}/treatment`, {
      method: 'POST',
      json: { system: tf.system, refId: tf.ref.id, title: tf.title.slice(0, 300), ownerName: tf.ownerName || null, endDate: tf.endDate || null, costByYear: tf.cost ? { [String(tf.year)]: Number(tf.cost) } : {} },
    });
    emit('changed', plan);
    toast.success(tf.system === 'risk' ? 'أُضيف نشاط المعالجة وربط بالخطر' : 'أُضيف الإجراء التصحيحي وربط بالتوصية');
    tf.open = false;
    await load();
  } catch (e) { toast.error(errMsg(e)); } finally { tf.busy = false; }
}

// ربط عنصر قائم في الخطة
const lf = reactive({ open: false, system: '', ref: null as any, itemId: '', note: '', busy: false });
function openLink(system: string, r: any) { Object.assign(lf, { open: true, system, ref: r, itemId: '', note: '', busy: false }); }
async function saveLink() {
  lf.busy = true;
  try {
    emit('changed', await api(`/planning/items/${lf.itemId}/refs`, { method: 'POST', json: { system: lf.system, refId: lf.ref.id, note: lf.note || null } }));
    toast.success('أُضيف الربط');
    lf.open = false;
    await load();
  } catch (e) { toast.error(errMsg(e)); } finally { lf.busy = false; }
}
const refsOf = (system: string) => (d.value?.refs ?? []).filter((r: any) => r.system === system);
</script>

<template>
  <p v-if="err" class="bg-err">{{ err }}</p>
  <div v-else-if="d" class="ig-wrap">
    <div class="pm-kpis">
      <div class="pm-kpi" :style="{ '--a': d.coverage.materialCovered < d.coverage.materialTotal ? '#ef4444' : '#10b981', '--i': 0 }"><span>المخاطر الجوهرية المغطاة</span>
        <strong>{{ d.coverage.materialCovered }} / {{ d.coverage.materialTotal }}</strong><small>تكلفة المعالجة {{ money(d.coverage.treatmentCost) }}</small></div>
      <div class="pm-kpi" :style="{ '--a': d.coverage.actionsCovered < d.coverage.actionsOpen ? '#f59e0b' : '#10b981', '--i': 1 }"><span>توصيات المراجعة المفتوحة في الخطة</span>
        <strong>{{ d.coverage.actionsCovered }} / {{ d.coverage.actionsOpen }}</strong><small>تكلفة الإجراءات {{ money(d.coverage.actionsCost) }}</small></div>
      <div class="pm-kpi" style="--a: #0ea5e9; --i: 2"><span>عناصر التحليل المستجاب لها</span>
        <strong>{{ d.coverage.factors.filter((f: any) => f.items.length).length }} / {{ d.coverage.factors.length }}</strong><small>من تحليلات PESTEL وSWOT المعتمدة</small></div>
      <div class="pm-kpi" style="--a: #a78bfa; --i: 3"><span>أهداف وظيفية مرتبطة</span><strong>{{ d.hr.linked }}</strong><small>لـ {{ d.hr.employees }} موظف</small></div>
      <div class="pm-kpi" :style="{ '--a': d.alerts.length ? '#dc2626' : '#10b981', '--i': 4 }"><span>تنبيهات من الأنظمة</span><strong>{{ d.alerts.length }}</strong><small>{{ d.unowned.length }} عنصر بلا مسؤول</small></div>
    </div>

    <section v-if="d.alerts.length" class="card pm-panel">
      <h2>التنبيهات</h2>
      <p class="pm-muted" style="margin-top: -6px">تغيرات في الأنظمة المصدر منذ الربط. الخطة لا تتغير تلقائيًا، وأي تعديل يمر بمسار الاعتماد المعتاد.</p>
      <div v-for="(a, i) in d.alerts" :key="i" class="ig-alert" :style="{ '--c': ALERT_C[a.level] ?? '#64748b' }">
        <b>{{ a.system }}</b>
        <span><RouterLink v-if="a.url" :to="a.url" class="pm-link">{{ a.ref }}</RouterLink><template v-else>{{ a.ref }}</template> ← <a href="#" class="pm-link" @click.prevent="emit('select', a.item.id)">{{ a.item.code }} {{ a.item.title }}</a></span>
        <em>{{ a.message }}</em>
      </div>
    </section>

    <div class="rk-tabs" style="margin: 0">
      <button :class="['rk-tab', { on: sec === 'risks' }]" @click="sec = 'risks'">المخاطر ({{ d.coverage.risks.length }})</button>
      <button :class="['rk-tab', { on: sec === 'audit' }]" @click="sec = 'audit'">توصيات المراجعة الداخلية ({{ d.coverage.actions.length }})</button>
      <button :class="['rk-tab', { on: sec === 'analysis' }]" @click="sec = 'analysis'">تحليلات PESTEL وSWOT ({{ d.coverage.factors.length }})</button>
      <button :class="['rk-tab', { on: sec === 'hr' }]" @click="sec = 'hr'">الأداء الوظيفي والمسؤوليات</button>
    </div>

    <!-- المخاطر -->
    <section v-if="sec === 'risks'" class="card pm-panel">
      <h2>تغطية المخاطر الجوهرية بخطط معالجة</h2>
      <p class="pm-muted" style="margin-top: -6px">المخاطر المرتفعة والحرجة من سجل المخاطر، وما يعالجها في هذه الخطة. التقييم ومالك الخطر يبقيان في نظام المخاطر.</p>
      <div class="ig-cov"><i :style="{ width: `${covPct(d.coverage.materialCovered, d.coverage.materialTotal)}%` }" /><span>{{ covPct(d.coverage.materialCovered, d.coverage.materialTotal) }}% مغطى</span></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الخطر</th><th>المستوى</th><th>المالك</th><th>العناصر المعالجة في الخطة</th><th>التكلفة</th><th>الإنجاز</th><th /></tr></thead>
        <tbody>
          <tr v-for="r in d.coverage.risks" :key="r.id" :class="{ 'ig-gap': r.material && !r.items.length }">
            <td><RouterLink :to="r.url" class="rk-code">{{ r.code }}</RouterLink> {{ r.title }}</td>
            <td><span class="pm-pill" :style="{ '--c': r.color }">{{ r.levelName }} ({{ r.score }})</span></td>
            <td>{{ r.ownerName ?? '—' }}</td>
            <td><template v-if="r.items.length"><a v-for="i in r.items" :key="i.id" href="#" class="pm-link ig-item" @click.prevent="emit('select', i.id)">{{ i.code }} {{ i.title }}</a></template><b v-else-if="r.material" style="color: #dc2626">غير مغطى</b><span v-else>—</span></td>
            <td class="num">{{ r.cost ? money(r.cost) : '—' }}</td>
            <td class="num">{{ r.progress === null ? '—' : `${num(r.progress)}%` }}</td>
            <td><span v-if="editable" class="pl-flex" style="flex-wrap: nowrap"><button class="btn btn-sm btn-primary" @click="openTreatment('risk', r)">+ نشاط معالجة</button><button class="btn btn-sm" @click="openLink('risk', r)">ربط بعنصر</button></span></td>
          </tr>
          <tr v-if="!d.coverage.risks.length"><td colspan="7" class="pm-empty">لا توجد مخاطر مرتفعة أو حرجة مفتوحة في سجل المخاطر.</td></tr>
        </tbody>
      </table></div>
    </section>

    <!-- المراجعة الداخلية -->
    <section v-if="sec === 'audit'" class="card pm-panel">
      <h2>الإجراءات التصحيحية لتوصيات المراجعة الداخلية</h2>
      <p class="pm-muted" style="margin-top: -6px">من تقارير المراجعة المعتمدة فقط. الحالة ونسبة الإنجاز من نظام المراجعة الداخلية، والتحقق والإغلاق من صلاحيته وحده.</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الإجراء</th><th>الأولوية</th><th>الجهة</th><th>الموعد</th><th>الحالة</th><th>أنشطة الخطة</th><th>التكلفة</th><th /></tr></thead>
        <tbody>
          <tr v-for="x in d.coverage.actions" :key="x.id" :class="{ 'ig-gap': x.overdue }">
            <td><RouterLink :to="x.url" class="rk-code">{{ x.code }}</RouterLink> {{ x.title }}<small class="pm-muted" style="display: block">{{ x.engagement }}</small></td>
            <td>{{ x.priorityName }}</td><td>{{ x.unitName ?? '—' }}</td>
            <td :style="{ color: x.overdue ? '#dc2626' : undefined, fontWeight: x.overdue ? 700 : undefined }">{{ x.dueDate }}</td>
            <td><span class="pm-pill" :style="{ '--c': x.status === 'closed' ? '#10b981' : x.overdue ? '#ef4444' : '#0ea5e9' }">{{ x.statusName }} · {{ num(x.progress) }}%</span></td>
            <td><a v-for="i in x.items" :key="i.id" href="#" class="pm-link ig-item" @click.prevent="emit('select', i.id)">{{ i.code }} {{ i.title }}</a><span v-if="!x.items.length">—</span></td>
            <td class="num">{{ x.cost ? money(x.cost) : '—' }}</td>
            <td><span v-if="editable && x.status !== 'closed'" class="pl-flex" style="flex-wrap: nowrap"><button class="btn btn-sm btn-primary" @click="openTreatment('audit', x)">+ إجراء في الخطة</button><button class="btn btn-sm" @click="openLink('audit', x)">ربط بعنصر</button></span></td>
          </tr>
          <tr v-if="!d.coverage.actions.length"><td colspan="8" class="pm-empty">لا توجد إجراءات تصحيحية مفتوحة من تقارير المراجعة.</td></tr>
        </tbody>
      </table></div>
    </section>

    <!-- التحليل -->
    <section v-if="sec === 'analysis'" class="card pm-panel">
      <h2>استجابة الخطة للفرص والتهديدات ونقاط القوة والضعف</h2>
      <div class="ig-factors">
        <div v-for="f in d.coverage.byFactor" :key="f.factor" class="ig-factor" :class="f.factor">
          <b>{{ f.name }}</b><span>{{ f.linked }} من {{ f.total }}</span><div class="ig-cov"><i :style="{ width: `${covPct(f.linked, f.total)}%` }" /></div>
        </div>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>التحليل</th><th>العامل</th><th>العنصر</th><th>الأثر</th><th>العناصر المستجيبة في الخطة</th><th /></tr></thead>
        <tbody>
          <tr v-for="f in d.coverage.factors" :key="f.id">
            <td><RouterLink :to="f.url" class="pm-link">{{ f.group }}</RouterLink> <small class="pm-muted">{{ f.version }}</small></td>
            <td><span class="ig-fac" :class="f.factor">{{ f.factorName }}</span></td><td>{{ f.text }}</td><td class="num">{{ f.impact }}</td>
            <td><a v-for="i in f.items" :key="i.id" href="#" class="pm-link ig-item" @click.prevent="emit('select', i.id)">{{ i.code }} {{ i.title }}</a><span v-if="!f.items.length">—</span></td>
            <td><button v-if="editable" class="btn btn-sm" @click="openLink('risk_analysis', f)">ربط بعنصر</button></td>
          </tr>
          <tr v-if="!d.coverage.factors.length"><td colspan="6" class="pm-empty">لا توجد تحليلات PESTEL أو SWOT معتمدة في نظام المخاطر.</td></tr>
        </tbody>
      </table></div>
    </section>

    <!-- الأداء الوظيفي -->
    <template v-if="sec === 'hr'">
      <section class="card pm-panel">
        <h2>أهداف الموظفين المرتبطة بعناصر الخطة</h2>
        <p class="pm-muted" style="margin-top: -6px">نسبة الإنجاز من بطاقة الأداء في الموارد البشرية. تغيير الخطة لا يغيّر تقييم الموظف أو مستحقاته. ولاحتساب أثر العلاوات حسب التقدير استخدم «قواعد العلاوات» في الموازنة.</p>
        <p v-if="!d.canHr" class="pm-muted">تفاصيل أهداف الموظفين تظهر لمن يملك صلاحية الأداء الوظيفي.</p>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>الهدف</th><th>عنصر الخطة</th><th>الحالة</th><th>الإنجاز</th></tr></thead>
          <tbody>
            <tr v-for="r in refsOf('hr_performance')" :key="r.id">
              <td><RouterLink v-if="r.live.url" :to="r.live.url" class="pm-link">{{ r.refLabel }}</RouterLink><template v-else>{{ r.refLabel }}</template><small class="pm-muted" style="display: block">{{ r.live.detail }}</small></td>
              <td><a href="#" class="pm-link" @click.prevent="emit('select', r.item.id)">{{ r.item.code }} {{ r.item.title }}</a></td>
              <td>{{ r.live.statusName ?? '—' }}</td><td class="num">{{ r.live.progress === null ? '—' : `${num(r.live.progress)}%` }}</td>
            </tr>
            <tr v-if="!refsOf('hr_performance').length"><td colspan="4" class="pm-empty">لا توجد أهداف وظيفية مرتبطة. اربطها من لوحة العنصر في «هيكل الخطة».</td></tr>
          </tbody>
        </table></div>
      </section>
      <section class="card pm-panel">
        <h2>عناصر تنفيذية بلا مسؤول ({{ d.unowned.length }})</h2>
        <div class="pl-contrib" style="margin-top: 0"><a v-for="i in d.unowned" :key="i.id" href="#" @click.prevent="emit('select', i.id)"><span><span class="rk-code">{{ i.code }}</span> {{ i.title }}</span><span class="pm-muted">{{ i.levelName }}</span></a></div>
        <p v-if="!d.unowned.length" class="pm-muted">لكل الأنشطة مسؤول محدد.</p>
      </section>
    </template>

    <!-- نشاط معالجة -->
    <div v-if="tf.open" class="modal-backdrop" @click.self="tf.open = false">
      <form class="card modal" @submit.prevent="saveTreatment">
        <h2>{{ tf.system === 'risk' ? 'نشاط لمعالجة الخطر' : 'إجراء تصحيحي في الخطة' }}</h2>
        <p class="pm-muted">يُضاف «{{ childLevel }}» تحت العنصر المختار ويُربط بـ «{{ tf.ref.code }}». تكلفته تدخل الموازنة مع باقي الأنشطة، ولا يتغير شيء في {{ tf.system === 'risk' ? 'سجل المخاطر' : 'نظام المراجعة الداخلية' }}.</p>
        <label class="field"><span>تحت العنصر</span><select v-model="tf.parentId" class="input" required><option v-for="p in parents" :key="p.id" :value="p.id">{{ plan.levels[p.level]?.name }}: {{ p.code }} {{ p.title }}</option></select></label>
        <label class="field"><span>العنوان</span><input v-model="tf.title" class="input" required maxlength="300" /></label>
        <div class="rk-fields">
          <label class="field"><span>المسؤول</span><input v-model="tf.ownerName" class="input" maxlength="200" /></label>
          <label class="field"><span>تاريخ الانتهاء</span><input v-model="tf.endDate" type="date" class="input" /></label>
          <label class="field"><span>التكلفة التقديرية</span><input v-model.number="tf.cost" type="number" min="0" class="input" /></label>
          <label class="field"><span>السنة</span><select v-model.number="tf.year" class="input"><option v-for="y in plan.periods" :key="y" :value="y">{{ y }}</option></select></label>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="tf.busy || !tf.parentId">إضافة وربط</button><button type="button" class="btn" @click="tf.open = false">إلغاء</button></div>
      </form>
    </div>

    <!-- ربط بعنصر قائم -->
    <div v-if="lf.open" class="modal-backdrop" @click.self="lf.open = false">
      <form class="card modal" @submit.prevent="saveLink">
        <h2>ربط «{{ lf.ref.code }}» بعنصر في الخطة</h2>
        <p class="pm-muted">{{ lf.ref.title ?? lf.ref.text }}</p>
        <label class="field"><span>العنصر</span><select v-model="lf.itemId" class="input" required><option value="">—</option><option v-for="i in leaves" :key="i.id" :value="i.id">{{ plan.levels[i.level]?.name }}: {{ i.code }} {{ i.title }}</option></select></label>
        <label class="field"><span>ملاحظة</span><input v-model="lf.note" class="input" maxlength="500" placeholder="كيف يستجيب العنصر لهذا المرجع" /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="lf.busy">ربط</button><button type="button" class="btn" @click="lf.open = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
