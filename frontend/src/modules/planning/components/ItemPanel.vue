<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import ProgressRing from './ProgressRing.vue';
import {
  BAND, errMsg, EXEC, fmtDate, fmtDateTime, FUNDING, money, num, P, pct, REF_SYSTEMS, RESOURCE_KINDS, STATES, TARGET_KINDS, todayStr, type Item, type Lookups, type PlanningConfig,
} from '../lib';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** لوحة العنصر المحدد: التفاصيل، تحديث الإنجاز، الربط بالعناصر والأنظمة، والترحيل */
const props = defineProps<{ plan: any; item: Item; lookups: Lookups; config: PlanningConfig; canManage: boolean; linkOptions: any[]; plans: any[] }>();
const emit = defineEmits<{ (e: 'changed', v: any): void; (e: 'edit'): void; (e: 'add-child'): void; (e: 'select', id: string): void; (e: 'add-kpi'): void; (e: 'kpi', k: any): void }>();
const session = useSession();
const toast = useToast();
const level = computed(() => props.plan.levels[props.item.level]);
const children = computed(() => props.plan.items.filter((i: Item) => i.parentId === props.item.id));
const kpis = computed(() => props.plan.kpis.filter((k: any) => k.itemId === props.item.id));
const outLinks = computed(() => props.plan.links.filter((l: any) => l.fromItemId === props.item.id));
const inLinks = computed(() => props.plan.links.filter((l: any) => l.toItemId === props.item.id));
const ex = computed(() => EXEC[props.item.execStatus] ?? EXEC.not_started);
const editable = computed(() => props.canManage && ['draft', 'returned', 'approved'].includes(props.plan.status));
const ownProgress = computed(() => props.item.progressSource === 'own');
const canProgress = computed(() => session.can(P.progress) && props.plan.version > 0 && ownProgress.value && props.item.state !== 'carried_over');

const pf = reactive({ open: false, progress: 0, state: '', updateDate: '', note: '', correctiveAction: '', milestones: [] as boolean[] });
function openProgress() {
  Object.assign(pf, { open: true, progress: props.item.progress, state: props.item.state, updateDate: todayStr(), note: '', correctiveAction: props.item.correctiveAction ?? '', milestones: props.item.milestones.map((m) => m.done) });
}
watch(() => props.item.id, () => { pf.open = false; lf.open = false; rf.open = false; cf.open = false; });
async function call(path: string, method: string, json: unknown, msg: string) {
  try {
    emit('changed', await api(path, { method, json }));
    toast.success(msg);
    return true;
  } catch (e) {
    toast.error(errMsg(e));
    return false;
  }
}
async function saveProgress() {
  if (await call(`/planning/items/${props.item.id}/progress`, 'POST', {
    progress: Number(pf.progress), state: pf.state, updateDate: pf.updateDate || null, note: pf.note || null, correctiveAction: pf.correctiveAction || null,
    ...(pf.milestones.length ? { milestonesDone: pf.milestones } : {}),
  }, 'سُجل تحديث الإنجاز')) pf.open = false;
}

const lf = reactive({ open: false, toItemId: '', relation: 'contributes', contribution: null as number | null, note: '' });
const linkTargets = computed(() => props.linkOptions.filter((o) => o.id !== props.item.id));
async function addLink() {
  if (await call('/planning/links', 'POST', { fromItemId: props.item.id, toItemId: lf.toItemId, relation: lf.relation, contribution: lf.contribution || null, note: lf.note || null }, 'أُضيف الربط')) lf.open = false;
}
const removeLink = (l: any) => confirm('حذف هذا الربط؟') && call(`/planning/links/${l.id}`, 'DELETE', undefined, 'حُذف الربط');
const relName = (c: string) => props.config.relationTypes.find((r) => r.code === c)?.name ?? c;

const rf = reactive({ open: false, system: 'risk', refId: '', contribution: null as number | null, note: '', options: [] as any[], loading: false });
const REF_FORM: Record<string, string> = { risk: 'خطر من سجل المخاطر', risk_analysis: 'عنصر من تحليل PESTEL أو SWOT', audit: 'توصية مراجعة داخلية (إجراء تصحيحي)', hr_performance: 'هدف وظيفي في بطاقة أداء', projects: 'مشروع', capital_budget: 'بند موازنة رأسمالية (الأصول)' };
async function loadRefOptions() {
  rf.refId = ''; rf.loading = true;
  try { rf.options = await api<any[]>(`/planning/ref-options?system=${rf.system}`); } catch (e) { toast.error(errMsg(e)); rf.options = []; } finally { rf.loading = false; }
}
watch(() => rf.open, (v) => { if (v && !rf.options.length) loadRefOptions(); });
const refGroups = computed(() => {
  const g = new Map<string, any[]>();
  for (const o of rf.options) g.set(o.group ?? '', [...(g.get(o.group ?? '') ?? []), o]);
  return [...g.entries()].map(([name, opts]) => ({ name, opts }));
});
async function addRef() {
  if (await call(`/planning/items/${props.item.id}/refs`, 'POST', { system: rf.system, refId: rf.refId, contribution: rf.contribution || null, note: rf.note || null }, 'أُضيف الربط')) rf.open = false;
}
const removeRef = (r: any) => confirm('إلغاء هذا الربط؟ لا يتأثر العنصر في نظامه.') && call(`/planning/refs/${r.id}`, 'DELETE', undefined, 'أُلغي الربط');
const refLink = (r: any) => r.live?.url ?? (r.system === 'projects' ? `/projects/${r.refId}` : r.system === 'capital_budget' ? '/accounting/assets/budget' : null);
const ALERT_C: Record<string, string> = { danger: '#dc2626', warning: '#d97706', info: '#0284c7' };

const cf = reactive({ open: false, targetPlanId: '', targetParentId: '', note: '' });
const carryPlans = computed(() => props.plans.filter((p) => p.kind === 'operational' && p.id !== props.plan.id && p.startYear >= props.plan.endYear && !['in_review', 'rejected'].includes(p.status)));
const carryParents = ref<any[]>([]);
watch(() => cf.targetPlanId, async (id) => {
  carryParents.value = [];
  cf.targetParentId = '';
  if (id && props.item.level > 0) {
    const t = await api<any>(`/planning/plans/${id}`);
    carryParents.value = t.items.filter((i: Item) => i.level === props.item.level - 1);
  }
});
async function carry() {
  try {
    const res = await api<any>(`/planning/items/${props.item.id}/carry`, { method: 'POST', json: { targetPlanId: cf.targetPlanId, targetParentId: cf.targetParentId || null, note: cf.note } });
    toast.success(`رُحّل إلى ${res.code}`);
    cf.open = false;
    emit('changed', await api(`/planning/plans/${props.plan.id}`));
  } catch (e) {
    toast.error(errMsg(e));
  }
}
const canCarry = computed(() => session.can(P.operational) && props.plan.kind === 'operational' && props.plan.version > 0 && !['completed', 'cancelled', 'carried_over'].includes(props.item.state));
async function remove() {
  if (!confirm(`حذف ${props.item.code} ${props.item.title}${props.item.hasChildren ? ' وكل فروعه' : ''}؟`)) return;
  await call(`/planning/items/${props.item.id}`, 'DELETE', undefined, 'حُذف العنصر');
}
const kpiBand = (k: any) => BAND[k.stat?.band ?? 'none'];
</script>

<template>
  <section class="card pm-panel">
    <div style="display: flex; gap: 14px; align-items: center">
      <ProgressRing :value="item.rolledProgress" :planned="item.plannedProgress" :color="ex.color" :size="86" label="منجز" />
      <div style="min-width: 0">
        <div class="pl-flex"><span class="pl-lvl">{{ level?.name }}</span><span class="rk-code">{{ item.code }}</span><span class="pm-pill" :style="{ '--c': ex.color }">{{ ex.label }}</span></div>
        <h2 style="margin: 6px 0 0; justify-content: flex-start">{{ item.title }}</h2>
        <p class="pm-muted" style="margin: 2px 0 0">المخطط حتى اليوم {{ pct(item.plannedProgress) }}<template v-if="item.performance !== null"> · تحقق المؤشرات {{ pct(item.performance) }}</template>
          · {{ item.progressSource === 'children' ? 'يُحسب من الفروع' : item.progressSource === 'links' ? 'يُحسب من العناصر المرتبطة' : 'يُحدّث مباشرة' }}</p>
      </div>
    </div>
    <div class="pm-actions" style="margin-top: 12px">
      <button v-if="canProgress" class="btn btn-primary btn-sm" @click="openProgress">تحديث الإنجاز</button>
      <button v-if="editable" class="btn btn-sm" @click="emit('edit')">تعديل</button>
      <button v-if="editable && item.level < plan.levels.length - 1" class="btn btn-sm" @click="emit('add-child')">+ {{ plan.levels[item.level + 1].name }}</button>
      <button v-if="canCarry" class="btn btn-sm" @click="cf.open = !cf.open">ترحيل لخطة لاحقة</button>
      <button v-if="editable" class="btn btn-sm btn-danger" style="margin-inline-start: auto" @click="remove">حذف</button>
    </div>
    <div v-if="item.carriedToId || item.carriedFromId" class="rk-warn" style="margin-top: 10px">{{ item.progressNote }}</div>

    <form v-if="pf.open" class="card" style="padding: 12px; margin-top: 12px; background: var(--surface-2)" @submit.prevent="saveProgress">
      <div class="rk-fields">
        <label class="field"><span>نسبة الإنجاز {{ pf.progress }}%</span><input v-model.number="pf.progress" type="range" min="0" max="100" step="5" /></label>
        <label class="field"><span>الحالة</span><select v-model="pf.state" class="input"><option v-for="(l, k) in STATES" :key="k" :value="k">{{ l }}</option></select></label>
        <label class="field"><span>تاريخ التحديث</span><input v-model="pf.updateDate" type="date" class="input" :max="todayStr()" /></label>
      </div>
      <div v-if="item.milestones.length" class="pl-flex" style="margin-bottom: 8px">
        <label v-for="(m, i) in item.milestones" :key="i" class="pm-tag pl-flex"><input v-model="pf.milestones[i]" type="checkbox" /> {{ m.title }}</label>
      </div>
      <label class="field"><span>ملاحظة الإنجاز {{ pf.state === 'cancelled' ? '(سبب الإلغاء إلزامي)' : '' }}</span><textarea v-model="pf.note" class="input" rows="2" /></label>
      <label class="field"><span>الإجراء التصحيحي (عند التأخر)</span><textarea v-model="pf.correctiveAction" class="input" rows="2" /></label>
      <div class="pm-actions"><button class="btn btn-primary btn-sm">حفظ التحديث</button><button type="button" class="btn btn-sm" @click="pf.open = false">إلغاء</button></div>
    </form>

    <form v-if="cf.open" class="card" style="padding: 12px; margin-top: 12px; background: var(--surface-2)" @submit.prevent="carry">
      <p class="pm-muted">ينقل النشاط وفروعه غير المنتهية إلى خطة تشغيلية لاحقة، ويبقى هنا بحالة «مُرحّل» للتتبع.</p>
      <label class="field"><span>الخطة الهدف</span><select v-model="cf.targetPlanId" class="input" required><option value="">—</option><option v-for="p in carryPlans" :key="p.id" :value="p.id">{{ p.code }} {{ p.title }} ({{ p.startYear }})</option></select></label>
      <label v-if="item.level > 0" class="field"><span>تحت العنصر ({{ plan.levels[item.level - 1]?.name }})</span>
        <select v-model="cf.targetParentId" class="input" required><option value="">—</option><option v-for="c in carryParents" :key="c.id" :value="c.id">{{ c.code }} {{ c.title }}</option></select></label>
      <label class="field"><span>سبب الترحيل</span><textarea v-model="cf.note" class="input" rows="2" required /></label>
      <p v-if="!carryPlans.length" class="pm-muted">لا توجد خطة تشغيلية لاحقة متاحة. أنشئ خطة السنة التالية أولًا.</p>
      <div class="pm-actions"><button class="btn btn-primary btn-sm" :disabled="!cf.targetPlanId">ترحيل</button><button type="button" class="btn btn-sm" @click="cf.open = false">إلغاء</button></div>
    </form>

    <p v-if="item.description" style="margin: 12px 0 0; white-space: pre-line">{{ item.description }}</p>
    <dl class="pm-dl pl-dl" style="margin-top: 12px">
      <dt>المسؤول</dt><dd>{{ item.ownerName ?? '—' }}</dd>
      <dt>الإدارة</dt><dd>{{ item.unitName ?? plan.unitName ?? '—' }}<span v-if="item.participants.length" class="pm-muted"> بمشاركة {{ item.participants.map((p) => p.name).join('، ') }}</span></dd>
      <dt>المدة</dt><dd>{{ item.startDate || item.endDate ? `${fmtDate(item.startDate)} ← ${fmtDate(item.endDate)}` : '—' }}</dd>
      <dt>الوزن</dt><dd>{{ num(item.weight) }}</dd>
      <dt>التكلفة</dt><dd><span class="pm-money">{{ money(item.rolledCost) }}</span><span v-if="item.fundingType" class="pm-tag" style="margin-inline-start: 6px">{{ FUNDING[item.fundingType] }}</span>
        <span v-if="item.costCenterName" class="pm-muted"> مركز التكلفة: {{ item.costCenterName }}</span></dd>
    </dl>
    <div v-if="Object.keys(item.rolledCostByYear).length" class="pl-flex" style="margin-top: 6px">
      <span v-for="(v, y) in item.rolledCostByYear" :key="y" class="pm-tag">{{ y }}: {{ money(v) }}</span>
    </div>
    <template v-if="Object.keys(item.customValues ?? {}).length">
      <div class="rk-sec">حقول إضافية</div>
      <dl class="pm-dl"><template v-for="c in config.customFields" :key="c.key"><template v-if="item.customValues[c.key] !== undefined && item.customValues[c.key] !== null"><dt>{{ c.label }}</dt><dd>{{ item.customValues[c.key] }}</dd></template></template></dl>
    </template>

    <template v-if="item.targets.length">
      <div class="rk-sec">المستهدفات</div>
      <ul class="rk-log"><li v-for="(t, i) in item.targets" :key="i"><b>{{ TARGET_KINDS[t.kind] }}</b><span>{{ t.text }}<template v-if="t.value !== null"> · {{ num(t.value) }} {{ t.unit }}</template><template v-if="t.dueDate"> · {{ fmtDate(t.dueDate) }}</template></span></li></ul>
    </template>
    <template v-if="item.milestones.length">
      <div class="rk-sec">المعالم</div>
      <ul class="rk-log"><li v-for="(m, i) in item.milestones" :key="i"><b :style="{ color: m.done ? '#10b981' : m.dueDate && m.dueDate < todayStr() ? '#ef4444' : undefined }">{{ m.done ? '✓' : '○' }}</b><span>{{ m.title }} · {{ fmtDate(m.dueDate) }}<template v-if="m.doneDate"> · أُنجز {{ fmtDate(m.doneDate) }}</template></span></li></ul>
    </template>
    <template v-if="item.resources.length">
      <div class="rk-sec">الموارد</div>
      <ul class="rk-log"><li v-for="(r, i) in item.resources" :key="i"><b>{{ RESOURCE_KINDS[r.kind] }}</b><span>{{ r.name }}<template v-if="r.quantity !== null"> · {{ num(r.quantity) }} {{ r.unit }}</template><template v-if="r.cost !== null"> · {{ money(r.cost) }}</template></span></li></ul>
    </template>
    <template v-if="children.length">
      <div class="rk-sec">الفروع ({{ children.length }})</div>
      <div class="pl-contrib" style="margin-top: 0"><a v-for="c in children" :key="c.id" href="#" @click.prevent="emit('select', c.id)"><span><span class="rk-code">{{ c.code }}</span> {{ c.title }}</span><b>{{ pct(c.rolledProgress) }}</b></a></div>
    </template>

    <div class="rk-sec">مؤشرات الأداء <button v-if="editable || session.can(P.kpis)" class="btn btn-sm" @click="emit('add-kpi')">+ مؤشر</button></div>
    <p v-if="!kpis.length" class="pm-muted">لا توجد مؤشرات لهذا العنصر.</p>
    <div v-else class="pl-contrib" style="margin-top: 0"><a v-for="k in kpis" :key="k.id" href="#" @click.prevent="emit('kpi', k)"><span><span class="pl-band" :style="{ '--c': kpiBand(k).color }" /> {{ k.name }}</span><b>{{ k.stat?.ach === null || k.stat?.ach === undefined ? '—' : `${num(k.stat.ach)}%` }}</b></a></div>

    <div class="rk-sec">يسهم في <button v-if="editable" class="btn btn-sm" @click="lf.open = !lf.open">+ ربط</button></div>
    <form v-if="lf.open" class="card" style="padding: 12px; margin-bottom: 8px; background: var(--surface-2)" @submit.prevent="addLink">
      <label class="field"><span>العنصر المستفيد (من أي خطة)</span>
        <select v-model="lf.toItemId" class="input" required><option value="">—</option>
          <option v-for="o in linkTargets" :key="o.id" :value="o.id">{{ o.planCode }} · {{ o.levelName }} {{ o.code }} {{ o.title }}</option></select></label>
      <div class="rk-fields">
        <label class="field"><span>نوع العلاقة</span><select v-model="lf.relation" class="input"><option v-for="r in config.relationTypes" :key="r.code" :value="r.code">{{ r.name }}</option></select></label>
        <label class="field"><span>نسبة المساهمة %</span><input v-model.number="lf.contribution" type="number" min="0.01" max="100" step="any" class="input" placeholder="تُترك فارغة للتساوي" /></label>
      </div>
      <div class="pm-actions"><button class="btn btn-primary btn-sm">ربط</button><button type="button" class="btn btn-sm" @click="lf.open = false">إلغاء</button></div>
    </form>
    <p v-if="!outLinks.length" class="pm-muted">لا يرتبط بعناصر أخرى.</p>
    <div v-else class="pl-contrib" style="margin-top: 0">
      <RouterLink v-for="l in outLinks" :key="l.id" :to="`/planning/plans/${l.to?.planId}?item=${l.toItemId}`">
        <span>{{ relName(l.relation) }} <span class="rk-code">{{ l.to?.planCode }} · {{ l.to?.code }}</span> {{ l.to?.title }}</span>
        <span class="pl-flex"><b>{{ l.contribution === null ? '' : `${num(l.contribution)}%` }}</b><button v-if="editable" type="button" class="btn btn-sm" @click.prevent="removeLink(l)">✕</button></span>
      </RouterLink>
    </div>
    <template v-if="inLinks.length">
      <div class="rk-sec">يسهم فيه</div>
      <div class="pl-contrib" style="margin-top: 0">
        <RouterLink v-for="l in inLinks" :key="l.id" :to="`/planning/plans/${l.from?.planId}?item=${l.fromItemId}`">
          <span><span class="rk-code">{{ l.from?.planCode }} · {{ l.from?.code }}</span> {{ l.from?.title }} <span class="pm-muted">{{ l.from?.unitName }}</span></span>
          <span class="pl-flex"><b>{{ pct(l.from?.progress) }}</b><span class="pm-tag">{{ l.contribution === null ? 'بالتساوي' : `${num(l.contribution)}%` }}</span></span>
        </RouterLink>
      </div>
    </template>

    <div class="rk-sec">مرتبط في الأنظمة الأخرى <button v-if="editable" class="btn btn-sm" @click="rf.open = !rf.open">+ ربط</button></div>
    <form v-if="rf.open" class="card" style="padding: 12px; margin-bottom: 8px; background: var(--surface-2)" @submit.prevent="addRef">
      <div class="rk-fields">
        <label class="field"><span>النظام</span><select v-model="rf.system" class="input" @change="loadRefOptions"><option v-for="(l, k) in REF_FORM" :key="k" :value="k">{{ l }}</option></select></label>
        <label class="field"><span>نسبة المساهمة %</span><input v-model.number="rf.contribution" type="number" min="0.01" max="100" step="any" class="input" /></label>
      </div>
      <label class="field"><span>العنصر</span><select v-model="rf.refId" class="input" required><option value="">{{ rf.loading ? 'جارٍ التحميل…' : rf.options.length ? '—' : 'لا توجد عناصر متاحة' }}</option>
        <optgroup v-for="g in refGroups" :key="g.name" :label="g.name || '—'"><option v-for="o in g.opts" :key="o.id" :value="o.id">{{ o.code }} {{ o.label }}</option></optgroup></select></label>
      <label class="field"><span>ملاحظة</span><input v-model="rf.note" class="input" maxlength="500" placeholder="سبب الربط أو أساسه التحليلي" /></label>
      <p class="pm-muted" style="margin: 0 0 8px">الربط للقراءة فقط: يبقى العنصر وتقييمه وحالته في نظامه، ويُحفظ وضعه الحالي للمقارنة لاحقًا.</p>
      <div class="pm-actions"><button class="btn btn-primary btn-sm">ربط</button><button type="button" class="btn btn-sm" @click="rf.open = false">إلغاء</button></div>
    </form>
    <p v-if="!item.refs.length" class="pm-muted">لا يوجد ربط بالمشاريع أو المخاطر أو التحليلات أو المراجعة الداخلية أو الأداء الوظيفي.</p>
    <ul v-else class="rk-log">
      <li v-for="r in item.refs" :key="r.id"><b>{{ REF_SYSTEMS[r.system] }}</b>
        <span><RouterLink v-if="refLink(r)" :to="refLink(r)!" class="pm-link">{{ r.refCode }} {{ r.refLabel }}</RouterLink><template v-else>{{ r.refCode }} {{ r.refLabel }}</template>
          <template v-if="r.contribution !== null"> · {{ num(r.contribution) }}%</template>
          <span v-if="r.live?.statusName" class="pm-pill" :style="{ '--c': r.live.color ?? '#64748b', marginInlineStart: '6px' }">{{ r.live.statusName }}{{ r.live.progress !== null ? ` · ${num(r.live.progress)}%` : '' }}</span>
          <button v-if="editable" class="btn btn-sm" style="margin-inline-start: 6px" @click="removeRef(r)">✕</button>
          <small v-if="r.live?.detail" class="pm-muted" style="display: block">{{ r.live.detail }}</small>
          <small v-if="r.live?.alert" style="display: block; font-weight: 600" :style="{ color: ALERT_C[r.live.level] ?? '#64748b' }">⚠ {{ r.live.alert }}</small></span></li>
    </ul>

    <template v-if="item.updates.length">
      <div class="rk-sec">سجل تحديثات الإنجاز</div>
      <ul class="rk-log">
        <li v-for="u in item.updates" :key="u.id"><b>{{ num(u.progress) }}%</b>
          <span>{{ STATES[u.state] ?? EXEC[u.state]?.label }} · {{ fmtDate(u.updateDate) }} · {{ u.byName }}<span v-if="u.note" class="pm-muted"> — {{ u.note }}</span>
            <span v-if="u.correctiveAction" class="pm-muted"> · تصحيح: {{ u.correctiveAction }}</span></span></li>
      </ul>
      <p class="pm-muted">آخر تحديث {{ fmtDateTime(item.updates[0].createdAt) }}</p>
    </template>
  </section>
</template>
