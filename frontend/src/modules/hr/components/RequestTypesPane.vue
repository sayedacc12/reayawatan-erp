<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { KIND_ICON, rulesHints, type Field, type ReqType, type Rules } from '../self/ess';
import '../self/ess.css';

/**
 * أنواع طلبات الخدمة الذاتية: لكل نوع سلوك (إجازة، استئذان، خروج وعودة، خطاب، سلفة، عام)،
 * وحقول إضافية، ومسار اعتماد يتبع التبعية الإدارية في الهيكل، وقيود مرنة.
 */
interface Step { kind: string; name: string; level?: number | null; roleId?: string | null }
interface Lookups {
  roles: { id: string; name: string }[]; leaveTypes: { code: string; name: string }[]; structureLevels: string[];
  approverKinds: { value: string; label: string }[]; kinds: { value: string; label: string }[]; letterVars: { key: string; label: string }[];
}
const toast = useToast();
const types = ref<ReqType[]>([]);
const lk = ref<Lookups | null>(null);
const busy = ref(false);

async function load() {
  try {
    const r = await api<{ types: ReqType[]; lookups: Lookups }>('/hr/request-types');
    types.value = r.types;
    lk.value = r.lookups;
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);

const groups = computed(() => {
  const m = new Map<string, ReqType[]>();
  for (const t of types.value) m.set(t.category, [...(m.get(t.category) ?? []), t]);
  return [...m.entries()];
});

const DEFAULT_RULES: Rules = {
  gender: null, nationality: 'all', minServiceMonths: 0, allowPastDays: 0, minNoticeDays: 0, maxFutureDays: null, maxPerMonth: null, maxPerYear: null,
  oneOpen: false, attachment: 'optional', attachmentHint: null, maxHoursPerMonth: null, maxSalaryMultiple: null, maxInstallments: null,
};
const empty = () => ({
  id: '', name: '', kind: 'general', category: 'طلبات عامة', color: '#6366f1', description: '', isActive: true, sortOrder: 0,
  fields: [] as (Field & { optionsText?: string })[], approval: [{ kind: 'direct_manager', name: 'المدير المباشر' }] as Step[], rules: { ...DEFAULT_RULES } as Rules,
  leaveTypes: [] as string[], permissionKinds: [] as { code: string; name: string; maxHours: number | null }[],
  templates: [] as { id: string; name: string; withSalary: boolean; body: string }[],
});
const ed = reactive({ show: false, f: empty() });
function edit(t?: ReqType) {
  const f = empty();
  if (t) {
    Object.assign(f, {
      id: t.id, name: t.name, kind: t.kind, category: t.category, color: t.color, description: t.description ?? '', isActive: t.isActive, sortOrder: t.sortOrder,
      fields: t.fields.map((x) => ({ ...x, optionsText: (x.options ?? []).join('، ') })),
      approval: t.approval.map((s) => ({ kind: s.kind, name: s.name, level: s.level ?? null, roleId: s.roleId ?? null })),
      rules: { ...DEFAULT_RULES, ...t.rules }, leaveTypes: [...t.leaveTypes], permissionKinds: t.permissionKinds.map((k) => ({ ...k })),
      templates: t.templates.map((x) => ({ id: x.id, name: x.name, withSalary: x.withSalary, body: x.body ?? '' })),
    });
  }
  ed.f = f;
  ed.show = true;
}
const nOrNull = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));
async function save() {
  const f = ed.f;
  busy.value = true;
  try {
    const body = {
      name: f.name, kind: f.kind, category: f.category, color: f.color, description: f.description || null, isActive: f.isActive, sortOrder: Number(f.sortOrder) || 0,
      fields: f.fields.map(({ optionsText, ...x }) => ({ ...x, options: x.type === 'select' ? (optionsText ?? '').split(/[،,\n]/).map((o) => o.trim()).filter(Boolean) : undefined })),
      approval: f.approval.map((s) => ({ kind: s.kind, name: s.name, level: s.kind === 'unit_head' ? Number(s.level ?? 0) : undefined, roleId: s.kind === 'role' ? s.roleId : undefined })),
      rules: {
        ...f.rules, minServiceMonths: Number(f.rules.minServiceMonths) || 0, allowPastDays: Number(f.rules.allowPastDays) || 0, minNoticeDays: Number(f.rules.minNoticeDays) || 0,
        maxFutureDays: nOrNull(f.rules.maxFutureDays), maxPerMonth: nOrNull(f.rules.maxPerMonth), maxPerYear: nOrNull(f.rules.maxPerYear),
        maxHoursPerMonth: nOrNull(f.rules.maxHoursPerMonth), maxSalaryMultiple: nOrNull(f.rules.maxSalaryMultiple), maxInstallments: nOrNull(f.rules.maxInstallments),
        attachmentHint: f.rules.attachmentHint || null,
      },
      leaveTypes: f.leaveTypes, permissionKinds: f.permissionKinds.map((k) => ({ ...k, maxHours: nOrNull(k.maxHours) })), templates: f.templates,
    };
    await api(f.id ? `/hr/request-types/${f.id}` : '/hr/request-types', { method: f.id ? 'PATCH' : 'POST', json: body });
    toast.success('حُفظ نوع الطلب');
    ed.show = false;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function remove(t: ReqType) {
  if (!confirm(`حذف نوع الطلب «${t.name}»؟`)) return;
  try {
    await api(`/hr/request-types/${t.id}`, { method: 'DELETE' });
    toast.success('حُذف نوع الطلب');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function toggle(t: ReqType) {
  edit(t);
  ed.show = false;
  ed.f.isActive = !t.isActive;
  await save();
}
async function defaults() {
  try {
    const r = await api<{ added: number }>('/hr/request-types/defaults', { method: 'POST' });
    toast.success(r.added ? `أُضيف ${r.added} من الأنواع الافتراضية` : 'كل الأنواع الافتراضية موجودة');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function move<T>(list: T[], i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}
const kindName = (k: string) => lk.value?.approverKinds.find((x) => x.value === k)?.label ?? k;
const stepWho = (s: Step) => (s.kind === 'unit_head' ? `${kindName(s.kind)}: ${lk.value?.structureLevels[s.level ?? 0] ?? ''}` : s.kind === 'role' ? lk.value?.roles.find((r) => r.id === s.roleId)?.name ?? 'دور' : kindName(s.kind));
function insertVar(i: number, key: string) {
  ed.f.templates[i].body += `{${key}}`;
}
const FIELD_TYPES = [
  { v: 'text', l: 'نص قصير' }, { v: 'textarea', l: 'نص طويل' }, { v: 'number', l: 'رقم' }, { v: 'date', l: 'تاريخ' }, { v: 'time', l: 'وقت' }, { v: 'select', l: 'قائمة اختيار' }, { v: 'checkbox', l: 'مربع اختيار' },
];
const isDated = computed(() => ['leave', 'permission', 'exit_reentry'].includes(ed.f.kind));
</script>

<template>
  <div>
    <section class="card pm-panel" style="margin-bottom: 14px">
      <div style="display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: center">
        <div>
          <h2 style="margin: 0">خدمات الموظفين وأنواع الطلبات</h2>
          <p class="pm-muted" style="margin: 4px 0 0">كل نوع طلب له مسار اعتماد يتبع التبعية الإدارية في الهيكل (المدير المباشر، مدير المدير، رئيس مستوى معين، المدير الأعلى) أو دورًا محددًا، وله قيود مرنة على التواريخ والعدد والمرفقات.</p>
        </div>
        <div class="ess-actions">
          <button class="btn btn-sm" @click="defaults">استعادة الأنواع الافتراضية</button>
          <button class="btn btn-sm btn-primary" @click="edit()">+ نوع طلب جديد</button>
        </div>
      </div>
    </section>

    <section v-for="[cat, list] in groups" :key="cat" class="card pm-panel" style="margin-bottom: 14px">
      <p class="hr-sec" style="margin-top: 0">{{ cat }}</p>
      <div class="rt-list">
        <div v-for="t in list" :key="t.id" :class="['rt', { off: !t.isActive }]" :style="{ '--c': t.color }">
          <div class="rt-head">
            <span class="rt-ic">{{ KIND_ICON[t.kind] ?? '📝' }}</span>
            <div style="flex: 1; min-width: 0">
              <b>{{ t.name }}</b>
              <div class="pm-muted">{{ t.kindLabel }} · {{ t.requests ?? 0 }} طلب{{ t.isActive ? '' : ' · موقوف' }}</div>
            </div>
            <div class="ess-actions">
              <button class="btn btn-sm" @click="edit(t)">تعديل</button>
              <button class="btn btn-sm" @click="toggle(t)">{{ t.isActive ? 'إيقاف' : 'تفعيل' }}</button>
              <button v-if="!t.requests" class="btn btn-sm btn-danger" @click="remove(t)">حذف</button>
            </div>
          </div>
          <div class="rt-chain">
            <span class="rt-node me">الموظف</span>
            <template v-for="(s, i) in t.approval" :key="i"><span class="rt-arrow">←</span><span class="rt-node">{{ s.name }}<small>{{ stepWho(s) }}</small></span></template>
          </div>
          <div class="ess-hints"><span v-for="h in rulesHints(t.rules, t.kind)" :key="h">{{ h }}</span></div>
        </div>
      </div>
    </section>
    <p v-if="!types.length" class="pm-empty">لا توجد أنواع طلبات. اضغط «استعادة الأنواع الافتراضية».</p>

    <div v-if="ed.show && lk" class="modal-backdrop" @click.self="ed.show = false">
      <form class="card modal" style="max-width: 980px; width: 100%" @submit.prevent="save">
        <h2>{{ ed.f.id ? 'تعديل نوع الطلب' : 'نوع طلب جديد' }}</h2>
        <div class="hr-fields">
          <label class="field"><span>اسم الطلب</span><input v-model="ed.f.name" class="input" required /></label>
          <label class="field"><span>سلوك الطلب</span>
            <select v-model="ed.f.kind" class="input" :disabled="!!ed.f.id"><option v-for="k in lk.kinds" :key="k.value" :value="k.value">{{ k.label }}</option></select>
          </label>
          <label class="field"><span>التصنيف</span><input v-model="ed.f.category" class="input" placeholder="مثل: الإجازات، الخطابات" /></label>
          <label class="field"><span>اللون</span><input v-model="ed.f.color" type="color" class="input" style="padding: 2px; height: 40px" /></label>
          <label class="field"><span>الترتيب</span><input v-model.number="ed.f.sortOrder" type="number" class="input" /></label>
          <label class="field" style="flex-direction: row; align-items: center; gap: 8px"><input v-model="ed.f.isActive" type="checkbox" /> <span>متاح للموظفين</span></label>
        </div>
        <label class="field"><span>وصف يظهر للموظف</span><textarea v-model="ed.f.description" class="input" rows="2" /></label>

        <template v-if="ed.f.kind === 'leave'">
          <p class="hr-sec">أنواع الإجازة المتاحة في هذا الطلب</p>
          <div class="hr-chips">
            <label v-for="l in lk.leaveTypes" :key="l.code" class="hr-chip"><input v-model="ed.f.leaveTypes" type="checkbox" :value="l.code" /> {{ l.name }}</label>
          </div>
          <p class="pm-muted">بدون اختيار تظهر كل أنواع الإجازة في اللائحة. الرصيد والتداخل يُتحقق منهما حسب اللائحة.</p>
        </template>

        <template v-if="ed.f.kind === 'permission'">
          <p class="hr-sec">أنواع الاستئذان</p>
          <div v-for="(k, i) in ed.f.permissionKinds" :key="i" style="display: grid; grid-template-columns: 1fr 160px auto; gap: 6px; margin-bottom: 6px">
            <input v-model="k.name" class="input" placeholder="مثل: تأخر صباحي" />
            <input v-model.number="k.maxHours" type="number" step="0.25" min="0.25" max="12" class="input" placeholder="أقصى ساعات" />
            <button type="button" class="btn btn-sm" @click="ed.f.permissionKinds.splice(i, 1)">✕</button>
          </div>
          <button type="button" class="btn btn-sm" @click="ed.f.permissionKinds.push({ code: '', name: '', maxHours: null })">+ نوع استئذان</button>
        </template>

        <template v-if="ed.f.kind === 'letter'">
          <p class="hr-sec">نماذج الخطاب</p>
          <div v-for="(tp, i) in ed.f.templates" :key="i" class="rt-tpl">
            <div style="display: grid; grid-template-columns: 1fr auto auto; gap: 6px; align-items: center">
              <input v-model="tp.name" class="input" placeholder="اسم النموذج، مثل: تعريف بالراتب" required />
              <label class="hr-chip"><input v-model="tp.withSalary" type="checkbox" /> يظهر فيه الراتب</label>
              <button type="button" class="btn btn-sm" @click="ed.f.templates.splice(i, 1)">✕</button>
            </div>
            <textarea v-model="tp.body" class="input" rows="6" required />
            <div class="hr-chips"><button v-for="v in lk.letterVars" :key="v.key" type="button" class="hr-chip" style="cursor: pointer" @click="insertVar(i, v.key)">+ {{ v.label }}</button></div>
          </div>
          <button type="button" class="btn btn-sm" @click="ed.f.templates.push({ id: '', name: '', withSalary: false, body: 'تشهد {اسم_الجمعية} بأن {اسم_الموظف} ...' })">+ نموذج</button>
        </template>

        <p class="hr-sec">حقول إضافية يعبئها الموظف</p>
        <div v-for="(fd, i) in ed.f.fields" :key="i" style="display: grid; grid-template-columns: 1fr 150px 1fr auto auto; gap: 6px; margin-bottom: 6px; align-items: center">
          <input v-model="fd.label" class="input" placeholder="عنوان الحقل" required />
          <select v-model="fd.type" class="input"><option v-for="t in FIELD_TYPES" :key="t.v" :value="t.v">{{ t.l }}</option></select>
          <input v-if="fd.type === 'select'" v-model="fd.optionsText" class="input" placeholder="الخيارات مفصولة بفاصلة" />
          <input v-else v-model="fd.hint" class="input" placeholder="تلميح (اختياري)" />
          <label class="hr-chip"><input v-model="fd.required" type="checkbox" /> إلزامي</label>
          <button type="button" class="btn btn-sm" @click="ed.f.fields.splice(i, 1)">✕</button>
        </div>
        <button type="button" class="btn btn-sm" :disabled="ed.f.fields.length >= 15" @click="ed.f.fields.push({ key: '', label: '', type: 'text', required: false, hint: null, optionsText: '' })">+ حقل</button>

        <p class="hr-sec">مسار الاعتماد</p>
        <p class="pm-muted" style="margin-top: 0">المعتمد يُحدد عند التقديم من الهيكل التنظيمي. الخطوة التي لا يوجد لها معتمد أو يكون معتمدها مقدم الطلب نفسه أو تكرر معتمدها تُتجاوز تلقائيًا.</p>
        <div v-for="(s, i) in ed.f.approval" :key="i" style="display: grid; grid-template-columns: 28px 1fr 1fr 1fr auto auto auto; gap: 6px; margin-bottom: 6px; align-items: center">
          <span class="pm-tag" style="text-align: center">{{ i + 1 }}</span>
          <input v-model="s.name" class="input" placeholder="اسم الخطوة" />
          <select v-model="s.kind" class="input"><option v-for="k in lk.approverKinds" :key="k.value" :value="k.value">{{ k.label }}</option></select>
          <select v-if="s.kind === 'unit_head'" v-model.number="s.level" class="input"><option v-for="(l, li) in lk.structureLevels" :key="li" :value="li">رئيس مستوى: {{ l }}</option></select>
          <select v-else-if="s.kind === 'role'" v-model="s.roleId" class="input" required><option value="" disabled>اختر الدور</option><option v-for="r in lk.roles" :key="r.id" :value="r.id">{{ r.name }}</option></select>
          <span v-else />
          <button type="button" class="btn btn-sm" :disabled="i === 0" @click="move(ed.f.approval, i, -1)">▲</button>
          <button type="button" class="btn btn-sm" :disabled="i === ed.f.approval.length - 1" @click="move(ed.f.approval, i, 1)">▼</button>
          <button type="button" class="btn btn-sm" :disabled="ed.f.approval.length === 1" @click="ed.f.approval.splice(i, 1)">✕</button>
        </div>
        <button type="button" class="btn btn-sm" :disabled="ed.f.approval.length >= 8" @click="ed.f.approval.push({ kind: 'hr', name: 'شؤون الموظفين', level: 0, roleId: '' })">+ خطوة</button>

        <p class="hr-sec">القيود</p>
        <div class="hr-fields">
          <template v-if="isDated">
            <label class="field"><span>إشعار مسبق (أيام قبل التاريخ)</span><input v-model.number="ed.f.rules.minNoticeDays" type="number" min="0" class="input" /></label>
            <label class="field"><span>يقبل تاريخًا سابقًا حتى (أيام)</span><input v-model.number="ed.f.rules.allowPastDays" type="number" min="0" class="input" :disabled="ed.f.rules.minNoticeDays > 0" /></label>
            <label class="field"><span>أبعد تاريخ من اليوم (أيام)</span><input v-model="ed.f.rules.maxFutureDays" type="number" min="1" class="input" placeholder="بلا حد" /></label>
          </template>
          <label class="field"><span>أقصى عدد في الشهر</span><input v-model="ed.f.rules.maxPerMonth" type="number" min="1" class="input" placeholder="بلا حد" /></label>
          <label class="field"><span>أقصى عدد في السنة</span><input v-model="ed.f.rules.maxPerYear" type="number" min="1" class="input" placeholder="بلا حد" /></label>
          <label class="field"><span>أقل مدة خدمة (أشهر)</span><input v-model.number="ed.f.rules.minServiceMonths" type="number" min="0" class="input" /></label>
          <label v-if="ed.f.kind === 'permission'" class="field"><span>رصيد الساعات في الشهر</span><input v-model="ed.f.rules.maxHoursPerMonth" type="number" min="0.5" step="0.5" class="input" placeholder="بلا حد" /></label>
          <template v-if="ed.f.kind === 'advance'">
            <label class="field"><span>الحد الأعلى (مضاعف إجمالي الراتب)</span><input v-model="ed.f.rules.maxSalaryMultiple" type="number" min="0.1" step="0.1" class="input" placeholder="بلا حد" /></label>
            <label class="field"><span>أقصى عدد أقساط</span><input v-model="ed.f.rules.maxInstallments" type="number" min="1" class="input" placeholder="بلا حد" /></label>
          </template>
          <label class="field"><span>الجنس</span><select v-model="ed.f.rules.gender" class="input"><option :value="null">الكل</option><option value="male">ذكور</option><option value="female">إناث</option></select></label>
          <label class="field"><span>الجنسية</span><select v-model="ed.f.rules.nationality" class="input"><option value="all">الكل</option><option value="saudi">سعوديون</option><option value="non_saudi">غير سعوديين</option></select></label>
          <label class="field"><span>المرفقات</span><select v-model="ed.f.rules.attachment" class="input"><option value="none">بدون</option><option value="optional">اختيارية</option><option value="required">إلزامية</option></select></label>
          <label v-if="ed.f.rules.attachment !== 'none'" class="field"><span>وصف المرفق المطلوب</span><input v-model="ed.f.rules.attachmentHint" class="input" placeholder="مثل: تقرير طبي معتمد" /></label>
          <label class="field" style="flex-direction: row; align-items: center; gap: 8px"><input v-model="ed.f.rules.oneOpen" type="checkbox" /> <span>طلب واحد مفتوح في الوقت نفسه</span></label>
        </div>
        <div class="ess-hints"><span v-for="h in rulesHints(ed.f.rules, ed.f.kind)" :key="h">{{ h }}</span></div>

        <div class="modal-actions">
          <button type="button" class="btn" @click="ed.show = false">إلغاء</button>
          <button class="btn btn-primary" :disabled="busy">{{ busy ? 'جارٍ الحفظ…' : 'حفظ' }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.rt-list { display: grid; gap: 10px; }
.rt { border: 1px solid var(--border); border-inline-start: 4px solid var(--c); border-radius: 14px; padding: 12px 14px; display: grid; gap: 8px; background: var(--surface); }
.rt.off { opacity: .6; }
.rt-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.rt-ic { width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; background: color-mix(in srgb, var(--c) 14%, transparent); font-size: 1.1rem; }
.rt-chain { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.rt-node { display: grid; padding: 4px 10px; border-radius: 10px; background: var(--surface-2); font-size: .84rem; font-weight: 600; }
.rt-node small { font-weight: 400; color: var(--muted); font-size: .72rem; }
.rt-node.me { background: color-mix(in srgb, var(--c) 16%, transparent); color: var(--c); }
.rt-arrow { color: var(--muted); }
.rt-tpl { display: grid; gap: 6px; padding: 10px; border: 1px dashed var(--border); border-radius: 12px; margin-bottom: 8px; }
.modal { max-height: 90vh; overflow-y: auto; }
</style>
