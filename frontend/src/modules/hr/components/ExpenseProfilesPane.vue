<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { accLabel, type AccLookups, type AllowanceType } from '../lib';

/**
 * حسابات المصروف حسب طبيعة الوظيفة: لكل فئة (إدارية، برامج وأنشطة، جمع أموال...) حساب مصروف لكل بند من بنود الراتب
 * ولحصة الجمعية في التأمينات. تُختار الفئة في الوصف الوظيفي، فيُحمَّل راتب كل موظف على حسابات فئة وظيفته.
 */
interface Profile { id: string; name: string; description: string | null; accounts: Record<string, string>; isDefault: boolean; jobs: number }
const toast = useToast();
const rows = ref<Profile[]>([]);
const types = ref<AllowanceType[]>([]);
const lk = ref<AccLookups | null>(null);
async function load() {
  try {
    const [p, t, c] = await Promise.all([api<Profile[]>('/hr/expense-profiles'), api<AllowanceType[]>('/hr/allowance-types'), api<AccLookups>('/hr/payroll-config')]);
    rows.value = p;
    types.value = t.filter((x) => x.isActive);
    lk.value = c;
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
/** البنود التي تحتاج حساب مصروف: بنود الراتب المفعّلة وحصة الجمعية في التأمينات */
const items = computed(() => [...types.value.map((t) => ({ code: t.code, name: t.name })), { code: 'gosi', name: 'التأمينات (حصة الجمعية)' }]);
const expenses = computed(() => lk.value?.accounts.filter((a) => a.nature === 'expenses') ?? []);
const editing = ref<Profile | null>(null);
const form = reactive({ show: false, name: '', description: '', isDefault: false, accounts: {} as Record<string, string> });
function openNew() {
  editing.value = null;
  // نبدأ من حسابات الفئة الافتراضية لتسهيل الإعداد
  const base = rows.value.find((r) => r.isDefault)?.accounts ?? {};
  Object.assign(form, { show: true, name: '', description: '', isDefault: false, accounts: Object.fromEntries(items.value.map((i) => [i.code, base[i.code] ?? ''])) });
}
function openEdit(p: Profile) {
  editing.value = p;
  Object.assign(form, { show: true, name: p.name, description: p.description ?? '', isDefault: p.isDefault, accounts: Object.fromEntries(items.value.map((i) => [i.code, p.accounts[i.code] ?? ''])) });
}
async function save() {
  try {
    const body = {
      name: form.name.trim(), description: form.description.trim() || null, isDefault: form.isDefault,
      accounts: Object.entries(form.accounts).filter(([, v]) => v).map(([code, accountId]) => ({ code, accountId })),
    };
    rows.value = editing.value
      ? await api<Profile[]>(`/hr/expense-profiles/${editing.value.id}`, { method: 'PUT', json: body })
      : await api<Profile[]>('/hr/expense-profiles', { method: 'POST', json: body });
    form.show = false;
    toast.success('حُفظت الفئة');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove() {
  if (!editing.value || !confirm(`حذف «${editing.value.name}»؟`)) return;
  try {
    rows.value = await api<Profile[]>(`/hr/expense-profiles/${editing.value.id}`, { method: 'DELETE' });
    form.show = false;
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const missing = (p: Profile) => items.value.filter((i) => !p.accounts[i.code]).length;
</script>

<template>
  <section class="card pm-panel">
    <div class="pm-row-head">
      <div>
        <h2>حسابات المصروف حسب طبيعة الوظيفة</h2>
        <p class="pm-muted">بعض الموظفين إداريون ورواتبهم مصروفات عمومية وإدارية، وآخرون يعملون في الأنشطة والبرامج أو جمع الأموال. عرّف لكل فئة حساب المصروف لكل بند، ثم اختر الفئة في <RouterLink to="/hr/jobs" class="pm-link">الوصف الوظيفي</RouterLink>. الوظيفة التي لم تُحدد فئتها تتبع الفئة الافتراضية.</p>
      </div>
      <button class="btn hr-glow" @click="openNew">+ فئة جديدة</button>
    </div>
    <p v-if="lk && !lk.accounts.length" class="alert alert-error">لم يُنصَّب دليل الحسابات في النظام المالي بعد، فلا يمكن ربط الفئات بالحسابات.</p>
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr)); gap: 14px">
      <article v-for="p in rows" :key="p.id" class="card pm-panel" style="margin: 0; min-width: 0">
        <div class="pm-row-head">
          <div>
            <h3 style="margin: 0">{{ p.name }} <span v-if="p.isDefault" class="pm-tag" style="background: #10b98122; color: #10b981">الافتراضية</span></h3>
            <p v-if="p.description" class="pm-muted" style="margin: 4px 0 0">{{ p.description }}</p>
          </div>
          <button class="btn btn-sm" @click="openEdit(p)">تعديل</button>
        </div>
        <p class="hr-mini">{{ p.jobs }} من الوظائف<span v-if="missing(p)" style="color: #ef4444"> · {{ missing(p) }} بند بلا حساب</span></p>
        <table class="table" style="table-layout: fixed; width: 100%">
          <tbody>
            <tr v-for="i in items" :key="i.code">
              <td style="width: 38%">{{ i.name }}</td>
              <td :style="{ color: p.accounts[i.code] ? undefined : '#ef4444' }">{{ p.accounts[i.code] ? accLabel(lk, p.accounts[i.code]) : 'غير محدد' }}</td>
            </tr>
          </tbody>
        </table>
      </article>
    </div>
    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" style="max-width: 680px" @submit.prevent="save">
        <h2>{{ editing ? editing.name : 'فئة جديدة' }}</h2>
        <div class="pm-grid2">
          <label class="field"><span>اسم الفئة</span><input v-model="form.name" class="input" required placeholder="مثل: البرامج والأنشطة" /></label>
          <label class="field"><span>وصف مختصر</span><input v-model="form.description" class="input" placeholder="لمن تُستخدم هذه الفئة" /></label>
        </div>
        <div class="hr-sec">حساب المصروف لكل بند</div>
        <label v-for="i in items" :key="i.code" class="field"><span>{{ i.name }}</span>
          <select v-model="form.accounts[i.code]" class="input"><option value="">—</option><option v-for="a in expenses" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select>
        </label>
        <label class="field" style="flex-direction: row; gap: 8px; align-items: center"><input v-model="form.isDefault" type="checkbox" :disabled="editing?.isDefault" /> <span>الفئة الافتراضية للوظائف التي لم تُحدد فئتها</span></label>
        <div class="modal-actions">
          <button class="btn btn-primary">حفظ</button>
          <button v-if="editing && !editing.isDefault" type="button" class="btn btn-danger" @click="remove">حذف</button>
          <button type="button" class="btn" @click="form.show = false">إلغاء</button>
        </div>
      </form>
    </div>
  </section>
</template>
