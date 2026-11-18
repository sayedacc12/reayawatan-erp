<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, token } from '../../../api';
import { useToast } from '../../../stores/toast';
import { num } from '../lib';
import { KIND_ICON, isoDay, loadSummary, rulesHints, type ReqType } from './ess';

const props = defineProps<{ typeId?: string }>();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const types = ref<ReqType[]>([]);
const error = ref('');
const editId = computed(() => (typeof route.query.edit === 'string' ? route.query.edit : null));
interface Bal { code: string; name: string; available: number | null; entitlement: number | null; accrual: string; taken: number; pending: number; note: string | null }
const balances = ref<Bal[]>([]);
const gross = ref(0);
const advanceLeft = ref(0);

onMounted(async () => {
  try {
    const [t, me] = await Promise.all([api<ReqType[]>('/hr/me/types'), api<{ balances: Bal[]; salary: { gross: number }; advances: { remaining: number } }>('/hr/me')]);
    types.value = t;
    balances.value = me.balances;
    gross.value = me.salary.gross;
    advanceLeft.value = me.advances.remaining;
    if (editId.value) await loadEdit(editId.value);
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const selected = computed(() => types.value.find((t) => t.id === props.typeId) ?? null);
const groups = computed(() => {
  const m = new Map<string, ReqType[]>();
  types.value.forEach((t) => m.set(t.category, [...(m.get(t.category) ?? []), t]));
  return [...m.entries()];
});

const form = reactive({
  leaveType: '', startDate: '', endDate: '', note: '',
  permissionKind: '', date: isoDay(1), fromTime: '', toTime: '',
  visaType: 'single', travelDate: '', returnDate: '', destination: '', dependents: 0,
  templateId: '', addressee: '',
  amount: 0, installments: 1, reason: '',
  fields: {} as Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
});
const files = ref<File[]>([]);
const over = ref(false);
const busy = ref(false);

watch(selected, (t) => {
  if (!t || editId.value) return;
  form.leaveType = t.leaveOptions?.[0]?.code ?? '';
  form.permissionKind = t.permissionKinds[0]?.code ?? '';
  form.templateId = t.templates[0]?.id ?? '';
  form.startDate = isoDay(t.rules.minNoticeDays || 0);
  form.endDate = form.startDate;
  form.fields = {};
  files.value = [];
}, { immediate: true });

async function loadEdit(id: string) {
  const r = await api<{ typeId: string; data: Record<string, unknown> }>(`/hr/me/requests/${id}`);
  if (props.typeId !== r.typeId) await router.replace({ path: `/me/new/${r.typeId}`, query: { edit: id } });
  const d = r.data;
  Object.assign(form, {
    leaveType: d.leaveType ?? '', startDate: d.startDate ?? '', endDate: d.endDate ?? '', note: d.note ?? '',
    permissionKind: d.permissionKind ?? '', date: d.date ?? isoDay(1), fromTime: d.fromTime ?? '', toTime: d.toTime ?? '',
    visaType: d.visaType ?? 'single', travelDate: d.travelDate ?? '', returnDate: d.returnDate ?? '', destination: d.destination ?? '', dependents: d.dependents ?? 0,
    templateId: d.templateId ?? '', addressee: d.addressee ?? '', amount: d.amount ?? 0, installments: d.installments ?? 1, reason: d.reason ?? '',
    fields: { ...((d.extra as Record<string, any>) ?? {}) },
  });
}

const days = computed(() => (form.startDate && form.endDate && form.endDate >= form.startDate ? Math.round((Date.parse(form.endDate) - Date.parse(form.startDate)) / 86400000) + 1 : 0));
const hours = computed(() => {
  if (!/^\d\d:\d\d$/.test(form.fromTime) || !/^\d\d:\d\d$/.test(form.toTime)) return 0;
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  return Math.max(0, Math.round(((m(form.toTime) - m(form.fromTime)) / 60) * 100) / 100);
});
const bal = computed(() => balances.value.find((b) => b.code === form.leaveType));
const kind = computed(() => selected.value?.permissionKinds.find((k) => k.code === form.permissionKind));
const minDate = computed(() => (selected.value ? isoDay(selected.value.rules.minNoticeDays ? selected.value.rules.minNoticeDays : -selected.value.rules.allowPastDays) : undefined));
const maxDate = computed(() => (selected.value?.rules.maxFutureDays ? isoDay(selected.value.rules.maxFutureDays) : undefined));
const maxAdvance = computed(() => (selected.value?.rules.maxSalaryMultiple ? Math.round(gross.value * selected.value.rules.maxSalaryMultiple) : null));
const hints = computed(() => (selected.value ? rulesHints(selected.value.rules, selected.value.kind) : []));

function pick(e: Event | DragEvent) {
  const list = (e as DragEvent).dataTransfer?.files ?? (e.target as HTMLInputElement).files;
  if (!list) return;
  files.value = [...files.value, ...Array.from(list)].slice(0, 5);
  over.value = false;
}

function payload() {
  const t = selected.value!;
  const data: Record<string, unknown> =
    t.kind === 'leave' ? { leaveType: form.leaveType, startDate: form.startDate, endDate: form.endDate, note: form.note || null }
      : t.kind === 'permission' ? { permissionKind: form.permissionKind, date: form.date, fromTime: form.fromTime, toTime: form.toTime, note: form.note || null }
        : t.kind === 'exit_reentry' ? { visaType: form.visaType, travelDate: form.travelDate, returnDate: form.returnDate, destination: form.destination, dependents: Number(form.dependents) || 0, note: form.note || null }
          : t.kind === 'letter' ? { templateId: form.templateId, addressee: form.addressee || null, note: form.note || null }
            : t.kind === 'advance' ? { amount: Number(form.amount), installments: Number(form.installments), reason: form.reason }
              : {};
  return { typeId: t.id, data, fields: form.fields };
}

async function submit() {
  if (!selected.value || busy.value) return;
  busy.value = true;
  try {
    const fd = new FormData();
    fd.append('payload', JSON.stringify(payload()));
    files.value.forEach((f) => fd.append('files', f, f.name));
    const t = token.get();
    const res = await fetch(editId.value ? `/api/hr/me/requests/${editId.value}` : '/api/hr/me/requests', {
      method: editId.value ? 'PATCH' : 'POST', body: fd, headers: t ? { Authorization: `Bearer ${t}` } : {},
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(Array.isArray(body.message) ? body.message.join('، ') : body.message || 'تعذر إرسال الطلب');
    toast.success(editId.value ? 'أُعيد تقديم الطلب' : `أُرسل طلبك رقم ${body.requestNo} إلى ${body.currentStep ?? 'الاعتماد'}`);
    loadSummary(true);
    router.push(`/me/requests/${body.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>{{ editId ? 'تعديل الطلب وإعادة تقديمه' : selected ? selected.name : 'طلب جديد' }}</h1>
        <p class="muted">{{ selected ? selected.description : 'اختر نوع الطلب، وسيصل لمعتمديه حسب موقعك في الهيكل التنظيمي.' }}</p>
      </div>
      <RouterLink v-if="selected && !editId" to="/me/new" class="btn">كل أنواع الطلبات</RouterLink>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <template v-if="!selected">
      <div v-for="[cat, list] in groups" :key="cat" class="ess-cat">
        <h3>{{ cat }}</h3>
        <div class="ess-types">
          <RouterLink v-for="(t, i) in list" :key="t.id" :to="`/me/new/${t.id}`" class="ess-type" :style="{ '--c': t.color, '--i': i }">
            <span class="em">{{ KIND_ICON[t.kind] }}</span><b>{{ t.name }}</b><small>{{ t.description }}</small>
            <small style="color: var(--text)">المعتمدون: {{ t.approval.map((s) => s.name).join(' ← ') }}</small>
          </RouterLink>
        </div>
      </div>
      <p v-if="!types.length && !error" class="pm-empty">لا توجد طلبات متاحة لك حاليًا</p>
    </template>

    <form v-else class="card ess-card" style="max-width: 760px" @submit.prevent="submit">
      <div class="ess-hints">
        <span>المسار: {{ selected.approval.map((s) => s.name).join(' ← ') }}</span>
        <span v-for="h in hints" :key="h">{{ h }}</span>
      </div>

      <template v-if="selected.kind === 'leave'">
        <label class="field"><span>نوع الإجازة</span>
          <select v-model="form.leaveType" class="input" required><option v-for="o in selected.leaveOptions" :key="o.code" :value="o.code">{{ o.name }}</option></select>
        </label>
        <p v-if="bal" class="pm-muted">
          <template v-if="bal.accrual === 'per_request'">{{ bal.entitlement ? `حتى ${bal.entitlement} أيام في المرة` : 'حسب المدة المثبتة' }}</template>
          <template v-else>رصيدك المتاح <b>{{ num(bal.available) }}</b> يوم (المأخوذ {{ bal.taken }}، قيد الاعتماد {{ bal.pending }})</template>
          <template v-if="bal.note"> · {{ bal.note }}</template>
        </p>
        <div class="pm-grid2">
          <label class="field"><span>من</span><input v-model="form.startDate" type="date" class="input" :min="minDate" :max="maxDate" required /></label>
          <label class="field"><span>إلى</span><input v-model="form.endDate" type="date" class="input" :min="form.startDate" required /></label>
        </div>
        <p v-if="days" class="pm-muted">المدة {{ days }} يوم{{ bal && bal.available !== null && bal.accrual !== 'per_request' && days > bal.available ? ' · أكثر من رصيدك المتاح' : '' }}</p>
      </template>

      <template v-else-if="selected.kind === 'permission'">
        <label class="field"><span>نوع الاستئذان</span>
          <select v-model="form.permissionKind" class="input" required><option v-for="k in selected.permissionKinds" :key="k.code" :value="k.code">{{ k.name }}{{ k.maxHours ? ` (حتى ${k.maxHours} ساعة)` : '' }}</option></select>
        </label>
        <div class="pm-grid2">
          <label class="field"><span>التاريخ</span><input v-model="form.date" type="date" class="input" :min="minDate" :max="maxDate" required /></label>
          <div class="pm-grid2">
            <label class="field"><span>من الساعة</span><input v-model="form.fromTime" type="time" class="input" required /></label>
            <label class="field"><span>إلى الساعة</span><input v-model="form.toTime" type="time" class="input" required /></label>
          </div>
        </div>
        <p v-if="hours" class="pm-muted">المدة {{ hours }} ساعة<span v-if="kind?.maxHours && hours > kind.maxHours" style="color: var(--danger)"> · أكثر من المسموح لهذا النوع</span></p>
      </template>

      <template v-else-if="selected.kind === 'exit_reentry'">
        <label class="field"><span>نوع التأشيرة</span>
          <select v-model="form.visaType" class="input"><option value="single">خروج وعودة مفردة</option><option value="multiple">خروج وعودة متعددة</option></select>
        </label>
        <div class="pm-grid2">
          <label class="field"><span>تاريخ السفر</span><input v-model="form.travelDate" type="date" class="input" :min="minDate" :max="maxDate" required /></label>
          <label class="field"><span>تاريخ العودة</span><input v-model="form.returnDate" type="date" class="input" :min="form.travelDate" required /></label>
        </div>
        <div class="pm-grid2">
          <label class="field"><span>جهة السفر</span><input v-model="form.destination" class="input" required /></label>
          <label class="field"><span>عدد المرافقين</span><input v-model.number="form.dependents" type="number" min="0" max="20" class="input" /></label>
        </div>
      </template>

      <template v-else-if="selected.kind === 'letter'">
        <div class="field"><span>نموذج الخطاب</span>
          <div class="ess-types" style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))">
            <button v-for="(tp, i) in selected.templates" :key="tp.id" type="button" :class="['ess-type', { on: form.templateId === tp.id }]" :style="{ '--c': selected.color, '--i': i }" @click="form.templateId = tp.id">
              <span class="em">📄</span><b>{{ tp.name }}</b><small>{{ tp.withSalary ? 'يظهر فيه الراتب' : 'بدون الراتب' }}</small>
            </button>
          </div>
        </div>
        <label class="field"><span>الجهة الموجه إليها الخطاب</span><input v-model="form.addressee" class="input" placeholder="إلى من يهمه الأمر" /></label>
      </template>

      <template v-else-if="selected.kind === 'advance'">
        <div class="pm-grid2">
          <label class="field"><span>مبلغ السلفة (ريال)</span><input v-model.number="form.amount" type="number" min="1" :max="maxAdvance ?? undefined" class="input" required /></label>
          <label class="field"><span>عدد الأقساط الشهرية</span><input v-model.number="form.installments" type="number" min="1" :max="selected.rules.maxInstallments ?? 60" class="input" required /></label>
        </div>
        <p class="pm-muted">
          <template v-if="form.amount && form.installments">القسط الشهري {{ num(Math.round((form.amount / form.installments) * 100) / 100) }} ريال يُخصم من مسير الرواتب بدءًا من الشهر التالي للاعتماد. </template>
          <template v-if="maxAdvance">الحد الأعلى لك {{ num(maxAdvance) }} ريال. </template>
          <template v-if="advanceLeft">عليك سلفة متبقية {{ num(advanceLeft) }} ريال.</template>
        </p>
        <label class="field"><span>سبب السلفة</span><textarea v-model="form.reason" class="input" rows="2" required /></label>
      </template>

      <template v-for="f in selected.fields" :key="f.key">
        <label v-if="f.type === 'checkbox'" class="field" style="flex-direction: row; align-items: center"><input v-model="form.fields[f.key]" type="checkbox" /> <span>{{ f.label }}</span></label>
        <label v-else class="field"><span>{{ f.label }}{{ f.required ? ' *' : '' }}</span>
          <textarea v-if="f.type === 'textarea'" v-model="form.fields[f.key]" class="input" rows="3" :required="f.required" />
          <select v-else-if="f.type === 'select'" v-model="form.fields[f.key]" class="input" :required="f.required"><option value="" disabled>اختر</option><option v-for="o in f.options" :key="o" :value="o">{{ o }}</option></select>
          <input v-else v-model="form.fields[f.key]" :type="f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'" class="input" :required="f.required" />
          <small v-if="f.hint" class="pm-muted">{{ f.hint }}</small>
        </label>
      </template>

      <label v-if="selected.kind !== 'advance' && selected.kind !== 'general'" class="field"><span>ملاحظة</span><textarea v-model="form.note" class="input" rows="2" /></label>

      <div v-if="selected.rules.attachment !== 'none'" class="field">
        <span>المرفقات {{ selected.rules.attachment === 'required' ? '(إلزامي)' : '(اختياري)' }}{{ selected.rules.attachmentHint ? `: ${selected.rules.attachmentHint}` : '' }}</span>
        <label :class="['ess-drop', { over }]" @dragover.prevent="over = true" @dragleave="over = false" @drop.prevent="pick">
          <input type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" @change="pick" />
          اسحب الملفات هنا أو اضغط للاختيار (PDF أو صورة، حتى 10 ميجابايت للملف)
        </label>
        <div class="ess-files">
          <button v-for="(f, i) in files" :key="i" type="button" class="ess-file" @click="files.splice(i, 1)">📎 {{ f.name }} ✕</button>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn ess-cta" :disabled="busy">{{ busy ? 'جارٍ الإرسال...' : editId ? 'إعادة التقديم' : 'إرسال الطلب' }}</button>
        <RouterLink :to="editId ? `/me/requests/${editId}` : '/me/new'" class="btn">إلغاء</RouterLink>
      </div>
    </form>
  </div>
</template>
