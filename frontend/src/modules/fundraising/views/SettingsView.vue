<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import ModulePermissionsPane from '../../../components/ModulePermissionsPane.vue';
import { useToast } from '../../../stores/toast';
import { FIELD_TYPES, sar } from '../labels';
import type { AccountRef, DonorField, JournalRouting, Settings, Stage } from '../types';
import '../fr.css';

const toast = useToast();
const route = useRoute();
type Tab = 'fields' | 'levels' | 'managers' | 'banks' | 'waqf' | 'stages' | 'routing' | 'permissions';
const tabs: { key: Tab; label: string; hint: string }[] = [
  { key: 'fields', label: 'حقول الداعمين', hint: 'حقول إضافية بضوابطها' },
  { key: 'levels', label: 'مستويات الداعمين', hint: 'ماسي، النخبة، بلاتيني...' },
  { key: 'managers', label: 'مدراء الدعم', hint: 'موظفون أو جهات خارجية' },
  { key: 'banks', label: 'الحسابات البنكية', hint: 'حسابات استقبال التبرعات' },
  { key: 'waqf', label: 'مشاريع الأوقاف', hint: 'جهات تبرعات الأوقاف' },
  { key: 'stages', label: 'مراحل الاعتماد', hint: 'اعتماد فرص التبرع' },
  { key: 'routing', label: 'التوجيه المحاسبي', hint: 'حسابات قيود الفرص' },
  { key: 'permissions', label: 'الصلاحيات', hint: 'مهام كل دور' },
];
const tab = ref<Tab>('fields');
watch(() => route.query.tab, (q) => { if (tabs.some((t) => t.key === q)) tab.value = q as Tab; }, { immediate: true });

const s = ref<Settings | null>(null);
const error = ref('');
const roles = ref<{ id: string; name: string }[]>([]);
const users = ref<{ id: string; fullName: string }[]>([]);

async function load() {
  try {
    const [settings, r, u] = await Promise.all([
      api<Settings>('/fundraising/settings'),
      api<{ id: string; name: string }[]>('/fundraising/settings/roles'),
      api<{ id: string; fullName: string }[]>('/fundraising/settings/users'),
    ]);
    s.value = settings;
    roles.value = r;
    users.value = u;
    fields.value = settings.donorFields.filter((f) => f.isActive).map((f) => ({ ...f, optionsText: (f.options ?? []).join('، ') }));
    stages.value = settings.stages.map((x) => ({ ...x }));
    routing.value = JSON.parse(JSON.stringify(settings.journalRouting));
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

// ---------------- الحقول المرنة ----------------
type FieldRow = DonorField & { optionsText: string };
const fields = ref<FieldRow[]>([]);
const savingFields = ref(false);
function addField() {
  fields.value.push({ key: '', label: '', type: 'text', required: false, isActive: true, optionsText: '', min: null, max: null });
}
async function saveFields() {
  savingFields.value = true;
  try {
    const donorFields = fields.value.map((f) => ({
      key: f.key || undefined, label: f.label, type: f.type, required: f.required, isActive: true,
      options: f.type === 'select' ? f.optionsText.split(/[،,\n]/).map((x) => x.trim()).filter(Boolean) : undefined,
      min: ['number', 'percent'].includes(f.type) ? f.min : undefined, max: ['number', 'percent'].includes(f.type) ? f.max : undefined,
    }));
    await api('/fundraising/settings/general', { method: 'PUT', json: { donorFields } });
    toast.success('تم حفظ حقول سجل الداعمين');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    savingFields.value = false;
  }
}

// ---------------- القوائم (مستويات، مدراء، بنوك، أوقاف) ----------------
type ListKey = 'levels' | 'managers' | 'banks' | 'waqf';
const editing = ref<{ list: ListKey; id: string | null; form: Record<string, any> } | null>(null);
const savingItem = ref(false);
const blank: Record<ListKey, () => Record<string, unknown>> = {
  levels: () => ({ name: '', color: '#e8b04b', minAmount: null, sortOrder: (s.value?.levels.length ?? 0) + 1 }),
  managers: () => ({ name: '', kind: 'employee', userId: null, entityName: '', phone: '', email: '', isActive: true }),
  banks: () => ({ bankName: '', accountName: '', accountNumber: '', iban: '', glCode: '', glName: '', isActive: true }),
  waqf: () => ({ name: '', description: '', targetAmount: null, isActive: true }),
};
const titles: Record<ListKey, string> = { levels: 'مستوى داعمين', managers: 'مدير دعم', banks: 'حساب بنكي', waqf: 'مشروع وقف' };
function openItem(list: ListKey, row?: Record<string, unknown>) {
  const form = blank[list]();
  if (row) for (const k of Object.keys(form)) form[k] = row[k] ?? form[k];
  editing.value = { list, id: (row?.id as string) ?? null, form };
}
async function saveItem() {
  if (!editing.value) return;
  savingItem.value = true;
  const { list, id, form } = editing.value;
  const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]));
  try {
    await api(`/fundraising/settings/${list}${id ? `/${id}` : ''}`, { method: id ? 'PATCH' : 'POST', json: body });
    toast.success('تم الحفظ');
    editing.value = null;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    savingItem.value = false;
  }
}
async function removeItem(list: ListKey, id: string) {
  if (!confirm('هل تريد الحذف؟')) return;
  try {
    await api(`/fundraising/settings/${list}/${id}`, { method: 'DELETE' });
    toast.success('تم الحذف');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}

// ---------------- مراحل الاعتماد ----------------
const stages = ref<Stage[]>([]);
const savingStages = ref(false);
function addStage() {
  stages.value.push({ name: '', instructions: null, roleId: null, canReject: true, canReturn: true });
}
function move(i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= stages.value.length) return;
  const arr = stages.value;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}
async function saveStages() {
  savingStages.value = true;
  try {
    await api('/fundraising/settings/stages', { method: 'PUT', json: { stages: stages.value.map(({ id, name, instructions, roleId, canReject, canReturn }) => ({ id, name, instructions, roleId, canReject, canReturn })) } });
    toast.success('تم حفظ مراحل الاعتماد');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    savingStages.value = false;
  }
}

// ---------------- التوجيه المحاسبي ----------------
const routing = ref<JournalRouting | null>(null);
const savingRouting = ref(false);
const creditRows: { key: keyof JournalRouting['credit']; label: string }[] = [
  { key: 'operational', label: 'التبرعات التشغيلية' },
  { key: 'restricted', label: 'التبرعات المقيدة (البرامج والمشاريع)' },
  { key: 'zakat', label: 'الزكاة' },
  { key: 'waqf', label: 'تبرعات الأوقاف' },
  { key: 'case', label: 'تبرعات الحالات المحددة' },
];
async function saveRouting() {
  savingRouting.value = true;
  try {
    await api('/fundraising/settings/general', { method: 'PUT', json: { journalRouting: routing.value } });
    toast.success('تم حفظ التوجيه المحاسبي');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    savingRouting.value = false;
  }
}
const acct = (a: AccountRef) => (a.code ? `${a.code} · ${a.name ?? ''}` : a.name ?? '—');
const activeCount = computed(() => fields.value.length);
const editingTitle = computed(() => (editing.value ? titles[editing.value.list] : ''));
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>إعدادات الموارد المالية</h1><p class="muted sub">جهّز الحقول والحسابات والمراحل مرة واحدة، وستسير عليها فرص التبرع تلقائيًا</p></div>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <nav class="stabs">
      <button v-for="(t, i) in tabs" :key="t.key" :class="['stab', { on: tab === t.key }]" :style="{ '--i': i }" @click="tab = t.key">
        <span class="n">{{ i + 1 }}</span><span><b>{{ t.label }}</b><small>{{ t.hint }}</small></span>
      </button>
    </nav>

    <template v-if="s">
      <Transition name="page" mode="out-in">
        <!-- الحقول المرنة -->
        <section v-if="tab === 'fields'" key="fields" class="fr-panel">
          <h2>الحقول الإضافية في سجل الداعمين <span class="muted">({{ activeCount }} حقل)</span></h2>
          <p class="muted hint">الحقول الأساسية (الاسم، النوع، رقم الهوية أو السجل، الجوال، البريد، المدينة، المستوى، مدير الدعم) موجودة دائمًا. أضف هنا أي بيانات أخرى تحتاجها الجمعية. الحقل المحذوف يُوقف فقط وتبقى بياناته محفوظة.</p>
          <div v-for="(f, i) in fields" :key="i" class="field-row">
            <input v-model="f.label" class="input" placeholder="اسم الحقل" />
            <select v-model="f.type" class="input">
              <option v-for="t in FIELD_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
            <input v-if="f.type === 'select'" v-model="f.optionsText" class="input wide" placeholder="الخيارات مفصولة بفاصلة" />
            <template v-else-if="f.type === 'number' || f.type === 'percent'">
              <input v-model.number="f.min" type="number" class="input small" placeholder="أقل قيمة" />
              <input v-model.number="f.max" type="number" class="input small" placeholder="أعلى قيمة" />
            </template>
            <span v-else class="wide" />
            <label class="check"><input v-model="f.required" type="checkbox" /> إلزامي</label>
            <button class="btn btn-sm btn-danger" @click="fields.splice(i, 1)">حذف</button>
          </div>
          <p v-if="!fields.length" class="fr-empty">لا توجد حقول إضافية بعد</p>
          <div class="actions">
            <button class="btn" @click="addField">+ إضافة حقل</button>
            <button class="btn btn-primary" :disabled="savingFields" @click="saveFields">{{ savingFields ? 'جارٍ الحفظ...' : 'حفظ الحقول' }}</button>
          </div>
        </section>

        <!-- مستويات الداعمين -->
        <section v-else-if="tab === 'levels'" key="levels" class="fr-panel">
          <h2>مستويات الداعمين <button class="btn btn-primary btn-sm push" @click="openItem('levels')">+ مستوى</button></h2>
          <div class="level-cards">
            <div v-for="l in s.levels" :key="l.id" class="level" :style="{ '--c': l.color }">
              <span class="gem" />
              <b>{{ l.name }}</b>
              <small class="muted">{{ l.minAmount ? `من ${sar(l.minAmount)}` : 'بدون حد أدنى' }}</small>
              <div class="row-actions"><button class="btn btn-sm" @click="openItem('levels', l as never)">تعديل</button><button class="btn btn-sm btn-danger" @click="removeItem('levels', l.id)">حذف</button></div>
            </div>
          </div>
          <p v-if="!s.levels.length" class="fr-empty">أضف مستويات مثل: ماسي، النخبة، بلاتيني، ذهبي</p>
        </section>

        <!-- مدراء الدعم -->
        <section v-else-if="tab === 'managers'" key="managers" class="fr-panel">
          <h2>مدراء الدعم <button class="btn btn-primary btn-sm push" @click="openItem('managers')">+ مدير دعم</button></h2>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>الاسم</th><th>النوع</th><th>المستخدم / الجهة</th><th>الجوال</th><th>الحالة</th><th /></tr></thead>
              <tbody>
                <tr v-for="m in s.managers" :key="m.id">
                  <td><b>{{ m.name }}</b></td>
                  <td>{{ m.kind === 'employee' ? 'موظف بالجمعية' : 'جهة خارجية' }}</td>
                  <td>{{ m.kind === 'employee' ? m.userName ?? '—' : m.entityName }}</td>
                  <td dir="ltr">{{ m.phone ?? '—' }}</td>
                  <td><span class="fr-badge" :style="{ '--c': m.isActive ? '#10b981' : '#94a3b8' }">{{ m.isActive ? 'نشط' : 'موقوف' }}</span></td>
                  <td class="row-actions"><button class="btn btn-sm" @click="openItem('managers', m as never)">تعديل</button><button class="btn btn-sm btn-danger" @click="removeItem('managers', m.id)">حذف</button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!s.managers.length" class="fr-empty">لا يوجد مدراء دعم بعد</p>
        </section>

        <!-- الحسابات البنكية -->
        <section v-else-if="tab === 'banks'" key="banks" class="fr-panel">
          <h2>حسابات الجمعية البنكية <button class="btn btn-primary btn-sm push" @click="openItem('banks')">+ حساب بنكي</button></h2>
          <p class="muted hint">تظهر هذه الحسابات في قائمة منسدلة داخل فرصة التبرع. الحساب المحاسبي المقابل هو الطرف المدين في قيد التبرع النقدي.</p>
          <div class="bank-cards">
            <div v-for="b in s.banks" :key="b.id" :class="['bank', { off: !b.isActive }]">
              <div class="chip" />
              <b>{{ b.bankName }}</b>
              <span class="acc" dir="ltr">{{ b.iban || b.accountNumber }}</span>
              <small>{{ b.accountName ?? '' }}</small>
              <small class="gl">{{ b.glCode ? `الحساب المحاسبي: ${b.glCode} · ${b.glName ?? ''}` : 'لم يُحدد الحساب المحاسبي' }}</small>
              <div class="row-actions"><button class="btn btn-sm btn-ghost-light" @click="openItem('banks', b as never)">تعديل</button><button class="btn btn-sm btn-ghost-light" @click="removeItem('banks', b.id)">حذف</button></div>
            </div>
          </div>
          <p v-if="!s.banks.length" class="fr-empty">أضف حسابًا بنكيًا واحدًا على الأقل لتسجيل التبرعات النقدية</p>
        </section>

        <!-- الأوقاف -->
        <section v-else-if="tab === 'waqf'" key="waqf" class="fr-panel">
          <h2>مشاريع الأوقاف (سجلات سابقة)</h2>
          <p class="alert alert-info">مشاريع الأوقاف تُنشأ وتُعتمد الآن من قائمة المشاريع في إدارة المشاريع، وتظهر تلقائيًا في فرص التبرع. هذه القائمة للسجلات السابقة فقط.</p>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>المشروع</th><th>الوصف</th><th>المبلغ المستهدف</th><th>الحالة</th><th /></tr></thead>
              <tbody>
                <tr v-for="w in s.waqf" :key="w.id">
                  <td><b>{{ w.name }}</b></td><td class="muted wrap">{{ w.description ?? '—' }}</td><td>{{ w.targetAmount ? sar(w.targetAmount) : '—' }}</td>
                  <td><span class="fr-badge" :style="{ '--c': w.isActive ? '#10b981' : '#94a3b8' }">{{ w.isActive ? 'نشط' : 'موقوف' }}</span></td>
                  <td class="row-actions"><button class="btn btn-sm btn-danger" @click="removeItem('waqf', w.id)">حذف</button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!s.waqf.length" class="fr-empty">لا توجد مشاريع أوقاف بعد</p>
        </section>

        <!-- مراحل الاعتماد -->
        <section v-else-if="tab === 'stages'" key="stages" class="fr-panel">
          <h2>مراحل اعتماد فرص التبرع</h2>
          <p class="muted hint">الموافقة تنقل الفرصة للمرحلة التالية، وبعد آخر مرحلة تُعتمد نهائيًا ويصدر القيد وسند القبض. الرفض يلغي الفرصة مع ذكر السبب، وطلب التعديل يعيدها للمرحلة السابقة (ومن أول مرحلة إلى مُنشئها). بدون مراحل تُعتمد الفرص مباشرة عند الحفظ.</p>
          <ol class="stage-list">
            <li v-for="(st, i) in stages" :key="i" :style="{ '--i': i }">
              <span class="bubble">{{ i + 1 }}</span>
              <div class="stage-body">
                <div class="stage-row">
                  <input v-model="st.name" class="input" placeholder="اسم المرحلة، مثل: مراجعة تنمية الموارد" />
                  <select v-model="st.roleId" class="input">
                    <option :value="null">أي مستخدم لديه صلاحية الاعتماد</option>
                    <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
                  </select>
                </div>
                <div class="stage-row">
                  <label class="check"><input v-model="st.canReject" type="checkbox" /> يسمح بالرفض</label>
                  <label class="check"><input v-model="st.canReturn" type="checkbox" /> يسمح بطلب التعديل</label>
                  <span class="grow" />
                  <button class="btn btn-sm" :disabled="i === 0" @click="move(i, -1)">↑</button>
                  <button class="btn btn-sm" :disabled="i === stages.length - 1" @click="move(i, 1)">↓</button>
                  <button class="btn btn-sm btn-danger" @click="stages.splice(i, 1)">حذف</button>
                </div>
              </div>
            </li>
            <li class="final"><span class="bubble">★</span><div class="stage-body"><b>اعتماد نهائي</b><small class="muted"> · تفعيل الدفعات وإصدار القيد وسند القبض</small></div></li>
          </ol>
          <div class="actions">
            <button class="btn" @click="addStage">+ إضافة مرحلة</button>
            <button class="btn btn-primary" :disabled="savingStages" @click="saveStages">{{ savingStages ? 'جارٍ الحفظ...' : 'حفظ المراحل' }}</button>
          </div>
        </section>

        <!-- التوجيه المحاسبي -->
        <section v-else-if="tab === 'routing' && routing" key="routing" class="fr-panel">
          <h2>توجيه قيود فرص التبرع</h2>
          <p class="muted hint">عند الاعتماد النهائي يصدر قيد واحد متوازن: الطرف المدين حسب نوع الفرصة، والطرف الدائن سطر لكل دفعة حسب تصنيفها. التبرع الزكوي يُقيَّد كله على حساب الزكاة.</p>
          <h3 class="sec">الطرف المدين حسب نوع الفرصة</h3>
          <div class="route-grid">
            <div class="route-card"><b>فرصة تبرع نقدية</b><small class="muted">المدين: الحساب المحاسبي للحساب البنكي المختار في الفرصة</small>
              <input v-model="routing.cash.description" class="input" placeholder="بيان القيد" /></div>
            <div class="route-card"><b>فرصة تبرع عينية</b>
              <div class="pair"><input v-model="routing.inKind.debit.code" class="input code" placeholder="رقم الحساب" dir="ltr" /><input v-model="routing.inKind.debit.name" class="input" placeholder="اسم الحساب" /></div>
              <input v-model="routing.inKind.description" class="input" placeholder="بيان القيد" /></div>
            <div class="route-card"><b>وعد بالدفع</b>
              <div class="pair"><input v-model="routing.pledge.debit.code" class="input code" placeholder="رقم الحساب" dir="ltr" /><input v-model="routing.pledge.debit.name" class="input" placeholder="اسم الحساب" /></div>
              <input v-model="routing.pledge.description" class="input" placeholder="بيان القيد" /></div>
            <div class="route-card"><b>سداد وعد بالدفع</b><small class="muted">مدين: البنك المحصَّل فيه · دائن: حساب ذمم الوعود أعلاه</small>
              <input v-model="routing.pledgeCollection.description" class="input" placeholder="بيان القيد" /></div>
          </div>
          <h3 class="sec">الطرف الدائن حسب تصنيف البند</h3>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>التصنيف</th><th>رقم الحساب</th><th>اسم الحساب</th></tr></thead>
              <tbody>
                <tr v-for="c in creditRows" :key="c.key">
                  <td><b>{{ c.label }}</b></td>
                  <td><input v-model="routing.credit[c.key].code" class="input code" dir="ltr" /></td>
                  <td><input v-model="routing.credit[c.key].name" class="input" /></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="actions"><button class="btn btn-primary" :disabled="savingRouting" @click="saveRouting">{{ savingRouting ? 'جارٍ الحفظ...' : 'حفظ التوجيه' }}</button>
            <small class="muted">الحالي للزكاة: {{ acct(s.journalRouting.credit.zakat) }}</small></div>
        </section>

        <ModulePermissionsPane v-else-if="tab === 'permissions'" key="perm" module="fundraising" />
      </Transition>
    </template>
    <div v-else-if="!error" class="fr-skeleton" />

    <!-- نافذة الإضافة والتعديل -->
    <div v-if="editing" class="modal-backdrop" @click.self="editing = null">
      <form class="card modal" @submit.prevent="saveItem">
        <h2>{{ editing.id ? 'تعديل' : 'إضافة' }} {{ editingTitle }}</h2>
        <template v-if="editing.list === 'levels'">
          <div class="field"><label>اسم المستوى</label><input v-model="editing.form.name" class="input" required /></div>
          <div class="two">
            <div class="field"><label>اللون</label><input v-model="editing.form.color" type="color" class="input color" /></div>
            <div class="field"><label>الحد الأدنى للتبرعات (ر.س)</label><input v-model.number="editing.form.minAmount" type="number" min="0" class="input" /></div>
          </div>
          <div class="field"><label>الترتيب</label><input v-model.number="editing.form.sortOrder" type="number" min="0" class="input" /></div>
        </template>
        <template v-else-if="editing.list === 'managers'">
          <div class="field"><label>الاسم</label><input v-model="editing.form.name" class="input" required /></div>
          <div class="field"><label>النوع</label>
            <div class="fr-pills"><button type="button" :class="['fr-pill', { on: editing.form.kind === 'employee' }]" @click="editing.form.kind = 'employee'">موظف بالجمعية</button>
              <button type="button" :class="['fr-pill', { on: editing.form.kind === 'external' }]" @click="editing.form.kind = 'external'">جهة خارجية</button></div></div>
          <div v-if="editing.form.kind === 'employee'" class="field"><label>حساب الموظف في النظام (اختياري)</label>
            <select v-model="editing.form.userId" class="input"><option :value="null">—</option><option v-for="u in users" :key="u.id" :value="u.id">{{ u.fullName }}</option></select></div>
          <div v-else class="field"><label>اسم الجهة الخارجية</label><input v-model="editing.form.entityName" class="input" /></div>
          <div class="two">
            <div class="field"><label>الجوال</label><input v-model="editing.form.phone" class="input" dir="ltr" placeholder="05xxxxxxxx" /></div>
            <div class="field"><label>البريد الإلكتروني</label><input v-model="editing.form.email" class="input" dir="ltr" /></div>
          </div>
          <label class="check"><input v-model="editing.form.isActive" type="checkbox" /> نشط</label>
        </template>
        <template v-else-if="editing.list === 'banks'">
          <div class="two">
            <div class="field"><label>اسم البنك</label><input v-model="editing.form.bankName" class="input" required /></div>
            <div class="field"><label>اسم الحساب</label><input v-model="editing.form.accountName" class="input" /></div>
          </div>
          <div class="two">
            <div class="field"><label>رقم الحساب</label><input v-model="editing.form.accountNumber" class="input" dir="ltr" required /></div>
            <div class="field"><label>الآيبان</label><input v-model="editing.form.iban" class="input" dir="ltr" placeholder="SA..." /></div>
          </div>
          <div class="two">
            <div class="field"><label>رقم الحساب المحاسبي</label><input v-model="editing.form.glCode" class="input" dir="ltr" placeholder="1121" /></div>
            <div class="field"><label>اسم الحساب المحاسبي</label><input v-model="editing.form.glName" class="input" /></div>
          </div>
          <label class="check"><input v-model="editing.form.isActive" type="checkbox" /> نشط</label>
        </template>
        <template v-else>
          <div class="field"><label>اسم المشروع</label><input v-model="editing.form.name" class="input" required /></div>
          <div class="field"><label>الوصف</label><textarea v-model="editing.form.description" class="input" rows="3" /></div>
          <div class="field"><label>المبلغ المستهدف (ر.س)</label><input v-model.number="editing.form.targetAmount" type="number" min="0" class="input" /></div>
          <label class="check"><input v-model="editing.form.isActive" type="checkbox" /> نشط</label>
        </template>
        <div class="modal-actions">
          <button class="btn btn-primary" :disabled="savingItem">{{ savingItem ? 'جارٍ الحفظ...' : 'حفظ' }}</button>
          <button type="button" class="btn" @click="editing = null">إلغاء</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.sub { margin: 2px 0 0; font-size: .88rem; }
.hint { font-size: .86rem; margin: -6px 0 14px; }
.push { margin-inline-start: auto; }
.stabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
.stab { display: flex; align-items: center; gap: 10px; padding: 11px 13px; text-align: right; font: inherit; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); cursor: pointer;
  transition: all .2s; animation: fr-rise .4s calc(var(--i) * 50ms) var(--ease) both; }
.stab small { display: block; color: var(--muted); font-size: .74rem; }
.stab .n { width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; background: var(--surface-2); color: var(--muted); font-weight: 700; flex-shrink: 0; transition: all .2s; }
.stab:hover { border-color: var(--primary); }
.stab.on { border-color: var(--gold); box-shadow: 0 10px 24px rgba(232,176,75,.18); }
.stab.on .n { background: linear-gradient(135deg, #f5c66b, #d99a2b); color: #3b2a06; box-shadow: 0 0 14px rgba(232,176,75,.6); }
.field-row { display: grid; grid-template-columns: 1.4fr 1fr 1.4fr auto auto; gap: 8px; align-items: center; margin-bottom: 8px; animation: fr-rise .3s var(--ease) both; }
.field-row .small { min-width: 0; }
.field-row:has(.small) { grid-template-columns: 1.4fr 1fr .7fr .7fr auto auto; }
.actions { display: flex; gap: 8px; align-items: center; margin-top: 14px; flex-wrap: wrap; }
.row-actions { display: flex; gap: 6px; }
.wrap { white-space: normal; max-width: 320px; }
.level-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.level { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 4px; padding: 16px; border-radius: 14px; border: 1px solid var(--border);
  background: linear-gradient(160deg, color-mix(in srgb, var(--c) 14%, var(--surface)), var(--surface)); }
.level .gem { width: 26px; height: 26px; transform: rotate(45deg); border-radius: 6px; background: linear-gradient(135deg, #fff, var(--c)); box-shadow: 0 0 16px var(--c); margin-bottom: 6px; animation: fr-glint 3s ease-in-out infinite; }
@keyframes fr-glint { 50% { box-shadow: 0 0 26px var(--c); filter: brightness(1.2); } }
.level .row-actions { margin-top: 8px; }
.bank-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.bank { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 4px; padding: 18px; border-radius: 16px; color: #fff; min-height: 170px;
  background: linear-gradient(135deg, #0b2a2e, #0f766e 60%, #14b8a6); box-shadow: 0 14px 30px rgba(15,118,110,.3); }
.bank::after { content: ''; position: absolute; width: 220px; height: 220px; border-radius: 50%; inset-inline-end: -80px; top: -90px; background: radial-gradient(circle, rgba(245,198,107,.45), transparent 70%); }
.bank.off { filter: grayscale(.8); opacity: .7; }
.bank .chip { width: 38px; height: 28px; border-radius: 6px; background: linear-gradient(135deg, #f5c66b, #b7791f); margin-bottom: 8px; }
.bank .acc { font-family: ui-monospace, Menlo, monospace; letter-spacing: 1px; font-size: .95rem; opacity: .95; }
.bank small { opacity: .8; font-size: .8rem; }
.bank .row-actions { margin-top: auto; padding-top: 8px; position: relative; z-index: 1; }
.stage-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.stage-list li { display: flex; gap: 12px; align-items: flex-start; animation: fr-rise .35s calc(var(--i, 0) * 50ms) var(--ease) both; }
.stage-list .bubble { width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0; display: grid; place-items: center; font-weight: 700; color: #fff; background: var(--grad); box-shadow: 0 0 14px rgba(20,184,166,.5); }
.stage-list .final .bubble { background: linear-gradient(135deg, #f5c66b, #d99a2b); box-shadow: 0 0 16px rgba(232,176,75,.6); }
.stage-body { flex: 1; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); }
.stage-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.stage-row .input { flex: 1; min-width: 180px; }
.grow { flex: 1; }
.sec { font-size: .92rem; margin: 18px 0 10px; color: var(--primary); }
.route-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.route-card { display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface-2); }
.pair { display: flex; gap: 6px; }
.code { max-width: 110px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.color { padding: 2px; height: 40px; }
@media (max-width: 900px) { .stabs { grid-template-columns: 1fr 1fr; } .field-row, .field-row:has(.small) { grid-template-columns: 1fr 1fr; } }
@media (max-width: 560px) { .two { grid-template-columns: 1fr; } }
</style>
