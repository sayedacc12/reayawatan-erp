<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { accLabel, sar, type AccLookups, type AllowanceType } from '../lib';

/** بنود الراتب: الأساسي والبدلات، ولكل بند حساب مصروف وحساب استحقاق وبنك صرف مستقل */
const toast = useToast();
const rows = ref<AllowanceType[]>([]);
const lk = ref<AccLookups | null>(null);
async function load() {
  try {
    const [r, c] = await Promise.all([api<AllowanceType[]>('/hr/allowance-types'), api<AccLookups & { config: unknown }>('/hr/payroll-config')]);
    rows.value = r;
    lk.value = c;
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
const expenses = computed(() => lk.value?.accounts.filter((a) => a.nature === 'expenses') ?? []);
const liabilities = computed(() => lk.value?.accounts.filter((a) => a.nature === 'liabilities') ?? []);
const bankName = (id: string | null) => lk.value?.cashAccounts.find((c) => c.id === id)?.name ?? '';
const editing = ref<AllowanceType | null>(null);
const form = reactive({ show: false, code: '', name: '', defaultKind: 'fixed' as 'percent' | 'fixed', defaultValue: 0, expenseAccountId: '', payableAccountId: '', cashAccountId: '', isActive: true, sortOrder: 0 });
function openNew() {
  editing.value = null;
  Object.assign(form, { show: true, code: '', name: '', defaultKind: 'fixed', defaultValue: 0, expenseAccountId: '', payableAccountId: '', cashAccountId: '', isActive: true, sortOrder: rows.value.length });
}
function openEdit(t: AllowanceType) {
  editing.value = t;
  Object.assign(form, {
    show: true, code: t.code, name: t.name, defaultKind: t.defaultKind, defaultValue: t.defaultValue, expenseAccountId: t.expenseAccountId ?? '',
    payableAccountId: t.payableAccountId ?? '', cashAccountId: t.cashAccountId ?? '', isActive: t.isActive, sortOrder: t.sortOrder,
  });
}
async function save() {
  try {
    const body = {
      code: form.code.trim(), name: form.name, defaultKind: form.defaultKind, defaultValue: Number(form.defaultValue), expenseAccountId: form.expenseAccountId || null,
      payableAccountId: form.payableAccountId || null, cashAccountId: form.cashAccountId || null, isActive: form.isActive, sortOrder: Number(form.sortOrder),
    };
    rows.value = editing.value
      ? await api<AllowanceType[]>(`/hr/allowance-types/${editing.value.id}`, { method: 'PUT', json: body })
      : await api<AllowanceType[]>('/hr/allowance-types', { method: 'POST', json: body });
    form.show = false;
    toast.success('حُفظ البند');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove() {
  if (!editing.value || !confirm(`حذف «${editing.value.name}»؟`)) return;
  try {
    rows.value = await api<AllowanceType[]>(`/hr/allowance-types/${editing.value.id}`, { method: 'DELETE' });
    form.show = false;
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <section class="card pm-panel">
    <div class="pm-row-head">
      <div>
        <h2>البدلات وبنود الراتب</h2>
        <p class="pm-muted">عرّف كل بند مرة واحدة هنا، ثم اختره في سلم الرواتب وملف الموظف. لكل بند حساب مصروف في دليل الحسابات، وحساب استحقاق، وبنك يُصرف منه، فيصدر لكل بنك سند صرف مستقل.</p>
      </div>
      <button class="btn hr-glow" @click="openNew">+ بدل جديد</button>
    </div>
    <p v-if="lk && !lk.accounts.length" class="alert alert-error">لم يُنصَّب دليل الحسابات في النظام المالي بعد، فلا يمكن ربط البنود بالحسابات.</p>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>البند</th><th>القيمة الافتراضية</th><th>حساب المصروف</th><th>حساب الاستحقاق</th><th>بنك الصرف</th><th>الموظفون</th><th></th></tr></thead>
        <tbody>
          <tr v-for="t in rows" :key="t.id" :style="{ opacity: t.isActive ? 1 : 0.5 }">
            <td><b>{{ t.name }}</b><span class="pm-muted hr-code">{{ t.code }}</span><span v-if="!t.isActive" class="pm-tag">موقوف</span></td>
            <td>{{ t.isSystem ? 'حسب المرتبة والدرجة' : t.defaultKind === 'percent' ? `${t.defaultValue}% من الأساسي` : sar(t.defaultValue) }}</td>
            <td :style="{ color: t.expenseAccountId ? '' : 'var(--danger)' }">{{ t.expenseAccountId ? accLabel(lk, t.expenseAccountId) : 'لم يُحدد' }}</td>
            <td>{{ t.payableAccountId ? accLabel(lk, t.payableAccountId) : 'الرواتب المستحقة (العام)' }}</td>
            <td>{{ t.cashAccountId ? bankName(t.cashAccountId) : 'البنك الافتراضي للرواتب' }}</td>
            <td class="hr-num">{{ t.employees }}</td>
            <td><button class="btn btn-sm" @click="openEdit(t)">تعديل</button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" style="max-width: 640px" @submit.prevent="save">
        <h2>{{ editing ? editing.name : 'بدل جديد' }}</h2>
        <div class="pm-grid2">
          <label class="field"><span>الاسم</span><input v-model="form.name" class="input" required placeholder="مثل: بدل طبيعة عمل" /></label>
          <label class="field"><span>الرمز (بالإنجليزية)</span><input v-model="form.code" class="input hr-code" :disabled="!!editing" required placeholder="nature" /></label>
          <template v-if="!editing?.isSystem">
            <label class="field"><span>طريقة القيمة الافتراضية</span><select v-model="form.defaultKind" class="input"><option value="percent">نسبة من الأساسي</option><option value="fixed">مبلغ ثابت</option></select></label>
            <label class="field"><span>{{ form.defaultKind === 'percent' ? 'النسبة %' : 'المبلغ' }}</span><input v-model.number="form.defaultValue" type="number" min="0" step="0.01" class="input" /></label>
          </template>
        </div>
        <div class="hr-sec">الربط المحاسبي</div>
        <label class="field"><span>حساب المصروف</span>
          <select v-model="form.expenseAccountId" class="input"><option value="">—</option><option v-for="a in expenses" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select>
        </label>
        <label class="field"><span>حساب الاستحقاق (اختياري)</span>
          <select v-model="form.payableAccountId" class="input"><option value="">الرواتب المستحقة (من تبويب الربط المحاسبي)</option><option v-for="a in liabilities" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select>
        </label>
        <label class="field"><span>البنك الذي يُصرف منه</span>
          <select v-model="form.cashAccountId" class="input"><option value="">البنك الافتراضي للرواتب</option><option v-for="c in lk?.cashAccounts ?? []" :key="c.id" :value="c.id">{{ c.name }}</option></select>
        </label>
        <label v-if="!editing?.isSystem" class="field" style="flex-direction: row; gap: 8px; align-items: center"><input v-model="form.isActive" type="checkbox" /> <span>البند مفعّل</span></label>
        <div class="modal-actions">
          <button class="btn btn-primary">حفظ</button>
          <button v-if="editing && !editing.isSystem" type="button" class="btn btn-danger" @click="remove">حذف</button>
          <button type="button" class="btn" @click="form.show = false">إلغاء</button>
        </div>
      </form>
    </div>
  </section>
</template>
