<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { errMsg, PERIODICITY, type ConfigPayload, type Level, type Lookups } from '../lib';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** إنشاء خطة (فارغة أو من قالب) أو تعديل بياناتها العامة ومستويات هيكلها */
const props = defineProps<{ kind: 'strategic' | 'operational'; plan: any | null; cfg: ConfigPayload; lookups: Lookups; strategicPlans: any[] }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', v: any): void }>();
const toast = useToast();
const p = props.plan;
const y = new Date().getFullYear();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const templates = computed(() => props.cfg.templates.filter((t) => t.kind === props.kind));
const f = reactive({
  templateKey: '' as string, title: p?.title ?? '', description: p?.description ?? '',
  startYear: p?.startYear ?? (props.kind === 'strategic' ? y : y + 1), endYear: p?.endYear ?? (props.kind === 'strategic' ? y + 4 : y + 1),
  periodicity: p?.periodicity ?? (props.kind === 'strategic' ? 'annual' : 'quarterly'), vision: p?.vision ?? '', mission: p?.mission ?? '', values: (p?.values ?? []).join('، '),
  unitId: p?.unitId ?? '', sharedUnitIds: (p?.sharedUnits ?? []).map((u: any) => u.id) as string[], parentPlanId: p?.parentPlanId ?? '', ownerName: p?.ownerName ?? '',
  levels: clone((p?.levels ?? (props.kind === 'strategic' ? props.cfg.config.strategicLevels : props.cfg.config.operationalLevels)) as Level[]),
});
watch(() => f.templateKey, (k) => {
  const t = props.cfg.templates.find((x) => x.key === k);
  f.levels = clone(t ? t.levels : props.kind === 'strategic' ? props.cfg.config.strategicLevels : props.cfg.config.operationalLevels);
  if (t) f.periodicity = t.periodicity;
});
watch(() => f.parentPlanId, (id) => {
  const s = props.strategicPlans.find((x) => x.id === id);
  if (s && !p && (f.startYear < s.startYear || f.endYear > s.endYear)) { f.startYear = Math.max(s.startYear, Math.min(f.startYear, s.endYear)); f.endYear = f.startYear; }
});
function addLevel() {
  const used = new Set(f.levels.map((l) => l.prefix));
  const prefix = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((c) => !used.has(c)) ?? 'Z';
  f.levels.push({ key: `l${Date.now().toString(36)}`, name: '', prefix });
}
async function save() {
  const n = (v: any) => (v === '' || v === undefined ? null : v);
  const body: any = {
    title: f.title, description: n(f.description), startYear: Number(f.startYear), endYear: Number(f.endYear), periodicity: f.periodicity,
    vision: n(f.vision), mission: n(f.mission), values: f.values.split(/[،,\n]/).map((v: string) => v.trim()).filter(Boolean),
    unitId: n(f.unitId), sharedUnitIds: f.sharedUnitIds, ownerName: n(f.ownerName), levels: f.levels,
    ...(props.kind === 'operational' ? { parentPlanId: n(f.parentPlanId) } : {}),
  };
  if (!p) Object.assign(body, { kind: props.kind, templateKey: n(f.templateKey) });
  if (!p && f.templateKey) delete body.levels;
  try {
    const res = p ? await api(`/planning/plans/${p.id}`, { method: 'PATCH', json: body }) : await api('/planning/plans', { method: 'POST', json: body });
    toast.success(p ? 'حُفظت بيانات الخطة' : 'أُنشئت الخطة');
    emit('saved', res);
  } catch (e) {
    toast.error(errMsg(e));
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <form class="card modal modal-wide" style="max-width: 880px" @submit.prevent="save">
      <h2>{{ p ? 'بيانات الخطة' : kind === 'strategic' ? 'خطة استراتيجية جديدة' : 'خطة تشغيلية جديدة' }}</h2>
      <template v-if="!p">
        <div class="rk-sec">ابدأ من</div>
        <div class="pl-cards" style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); margin-bottom: 8px">
          <div :class="['pl-tpl', { on: !f.templateKey }]" @click="f.templateKey = ''"><b>خطة فارغة</b><small>بمستويات الهيكل المعتمدة في الإعدادات</small></div>
          <div v-for="t in templates" :key="t.key" :class="['pl-tpl', { on: f.templateKey === t.key }]" @click="f.templateKey = t.key"><b>{{ t.name }}</b><small>{{ t.description }}</small></div>
        </div>
      </template>
      <p v-if="p?.status === 'approved'" class="rk-warn">الخطة معتمدة. الحفظ يفتح مسودة تعديل، ويبقى الإصدار المعتمد محفوظًا.</p>
      <label class="field"><span>عنوان الخطة</span><input v-model="f.title" class="input" required :placeholder="kind === 'strategic' ? 'مثل: الخطة الاستراتيجية 2026 - 2030' : 'مثل: الخطة التشغيلية لإدارة البرامج 2026'" /></label>
      <div class="rk-fields">
        <label class="field"><span>سنة البداية</span><input v-model.number="f.startYear" type="number" min="2000" max="2100" class="input" /></label>
        <label class="field"><span>سنة النهاية</span><input v-model.number="f.endYear" type="number" min="2000" max="2100" class="input" /></label>
        <label class="field"><span>دورية المتابعة</span><select v-model="f.periodicity" class="input"><option v-for="(l, k) in PERIODICITY" :key="k" :value="k">{{ l }}</option></select></label>
        <label class="field"><span>{{ kind === 'strategic' ? 'المالك (الجهة المسؤولة)' : 'مدير الخطة' }}</span><input v-model="f.ownerName" class="input" /></label>
        <label class="field"><span>{{ kind === 'strategic' ? 'الإدارة المسؤولة' : 'الإدارة' }}</span>
          <select v-model="f.unitId" class="input"><option value="">—</option><option v-for="u in lookups.units" :key="u.id" :value="u.id">{{ '— '.repeat(u.level) }}{{ u.name }}</option></select></label>
        <label v-if="kind === 'operational'" class="field"><span>تتبع الخطة الاستراتيجية</span>
          <select v-model="f.parentPlanId" class="input"><option value="">—</option><option v-for="s in strategicPlans" :key="s.id" :value="s.id">{{ s.code }} {{ s.title }} ({{ s.startYear }} - {{ s.endYear }})</option></select></label>
      </div>
      <label v-if="kind === 'operational'" class="field"><span>إدارات مشاركة في الخطة</span>
        <select v-model="f.sharedUnitIds" multiple class="input" style="min-height: 64px"><option v-for="u in lookups.units" :key="u.id" :value="u.id">{{ u.name }}</option></select></label>
      <template v-if="kind === 'strategic'">
        <label class="field"><span>الرؤية</span><textarea v-model="f.vision" class="input" rows="2" :placeholder="f.templateKey ? 'تُؤخذ من القالب إن تُركت فارغة' : ''" /></label>
        <label class="field"><span>الرسالة</span><textarea v-model="f.mission" class="input" rows="2" /></label>
        <label class="field"><span>القيم (افصل بينها بفاصلة)</span><input v-model="f.values" class="input" /></label>
      </template>
      <label class="field"><span>وصف مختصر</span><textarea v-model="f.description" class="input" rows="2" /></label>
      <template v-if="!f.templateKey || p">
        <div class="rk-sec">مستويات هيكل الخطة <button type="button" class="btn btn-sm" :disabled="f.levels.length >= 6" @click="addLevel">+ مستوى</button></div>
        <p class="pm-muted">الرمز حروف إنجليزية تُكوّن أكواد العناصر (مثل P1 ثم P1-G2). لا يُحذف مستوى فيه عناصر.</p>
        <div class="pl-mini-list">
          <div v-for="(l, i) in f.levels" :key="l.key">
            <span class="pm-tag">المستوى {{ i + 1 }}</span><input v-model="l.name" class="input" placeholder="اسم المستوى" style="grid-column: span 2" />
            <input v-model="l.prefix" class="input" maxlength="3" style="direction: ltr" @input="l.prefix = l.prefix.toUpperCase()" />
            <button type="button" class="btn btn-sm" :disabled="f.levels.length === 1 || i !== f.levels.length - 1" @click="f.levels.pop()">✕</button>
          </div>
        </div>
      </template>
      <div class="modal-actions">
        <button class="btn btn-primary">{{ p ? 'حفظ' : 'إنشاء الخطة' }}</button>
        <button type="button" class="btn" @click="emit('close')">إغلاق</button>
      </div>
    </form>
  </div>
</template>
