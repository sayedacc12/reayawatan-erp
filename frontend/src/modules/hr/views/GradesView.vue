<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, sar, type AllowanceType, type Grade, type GradeAllowance } from '../lib';
import '../../projects/projects.css';
import '../hr.css';

const session = useSession();
const toast = useToast();
const rows = ref<Grade[]>([]);
const levels = ref<string[]>([]);
const error = ref('');
const open = ref<string | null>(null);
const types = ref<AllowanceType[]>([]);
async function load() {
  try {
    [rows.value, levels.value, types.value] = await Promise.all([
      api<Grade[]>('/hr/grades'), api<{ structureLevels: string[] }>('/hr/settings').then((s) => s.structureLevels),
      api<AllowanceType[]>('/hr/allowance-types').then((t) => t.filter((x) => !x.isSystem)),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
const top = computed(() => Math.max(1, ...rows.value.map((g) => g.maxSalary)));
const editing = ref<Grade | null>(null);
const form = reactive({ show: false, code: '', name: '', structureLevel: '' as number | '', minSalary: 0, maxSalary: 0, steps: 5, stepIncrement: 3, allowances: [] as GradeAllowance[], sortOrder: 0 });
const defaults = (): GradeAllowance[] => types.value.filter((t) => t.isActive && ['housing', 'transport'].includes(t.code)).map((t) => ({ code: t.code, name: t.name, kind: t.defaultKind, value: t.defaultValue }));
const choices = (code: string) => types.value.filter((t) => (t.isActive || t.code === code) && (t.code === code || !form.allowances.some((a) => a.code === t.code)));
function addAllowance() {
  const t = choices('')[0];
  if (t) form.allowances.push({ code: t.code, name: t.name, kind: t.defaultKind, value: t.defaultValue });
}
function openNew() {
  editing.value = null;
  Object.assign(form, { show: true, code: `G${rows.value.length + 1}`, name: '', structureLevel: '', minSalary: 0, maxSalary: 0, steps: 5, stepIncrement: 3, allowances: defaults(), sortOrder: rows.value.length + 1 });
}
function openEdit(g: Grade) {
  editing.value = g;
  Object.assign(form, { show: true, code: g.code, name: g.name, structureLevel: g.structureLevel ?? '', minSalary: g.minSalary, maxSalary: g.maxSalary, steps: g.steps, stepIncrement: g.stepIncrement, allowances: g.allowances.map((a) => ({ ...a })), sortOrder: g.sortOrder });
}
async function save() {
  try {
    const body = { ...form, structureLevel: form.structureLevel === '' ? null : form.structureLevel, show: undefined };
    delete (body as Record<string, unknown>).show;
    if (editing.value) await api(`/hr/grades/${editing.value.id}`, { method: 'PATCH', json: body });
    else await api('/hr/grades', { method: 'POST', json: body });
    toast.success('تم الحفظ');
    form.show = false;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove() {
  if (!editing.value || !confirm('حذف المرتبة؟')) return;
  try {
    await api(`/hr/grades/${editing.value.id}`, { method: 'DELETE' });
    form.show = false;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <section class="pm-hero hr-hero">
      <div><p class="pm-kicker">التنظيم والتخطيط</p><h1>سلم الرواتب</h1>
        <p class="pm-sub">مراتب مرتبطة بمستويات الهيكل والوظائف، لكل مرتبة حد أدنى وأعلى ودرجات بعلاوة سنوية وبدلات افتراضية. راتب الموظف خارج حدود مرتبته يحتاج سببًا مكتوبًا.</p></div>
      <div class="pm-actions"><button v-if="session.can(P.grades)" class="btn hr-glow" @click="openNew">مرتبة جديدة</button></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <section class="card pm-panel">
      <p v-if="!rows.length" class="pm-empty">لم تُعرّف مراتب بعد</p>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>المرتبة</th><th>المستوى</th><th style="width: 32%">النطاق</th><th>الدرجات</th><th>البدلات</th><th>الوظائف</th><th>الموظفون</th><th></th></tr></thead>
          <tbody>
            <template v-for="g in rows" :key="g.id">
              <tr class="hr-row-click" @click="open = open === g.id ? null : g.id">
                <td><b class="hr-code">{{ g.code }}</b> {{ g.name }}</td>
                <td>{{ g.structureLevelName ?? '—' }}</td>
                <td>
                  <div class="hr-range"><i :style="{ insetInlineStart: (g.minSalary / top) * 100 + '%', width: ((g.maxSalary - g.minSalary) / top) * 100 + '%' }" />
                    <b v-if="g.averageBasic" :title="`متوسط رواتب الموظفين ${sar(g.averageBasic)}`" :style="{ insetInlineStart: (g.averageBasic / top) * 100 + '%' }" /></div>
                  <span class="pm-muted">{{ sar(g.minSalary) }} - {{ sar(g.maxSalary) }}</span>
                </td>
                <td>{{ g.steps }} <span class="pm-muted">علاوة {{ g.stepIncrement }}%</span></td>
                <td><span v-for="a in g.allowances" :key="a.code" class="pm-tag" style="margin: 1px">{{ a.name }} {{ a.kind === 'percent' ? `${a.value}%` : sar(a.value) }}</span></td>
                <td>{{ g.jobs.length }}</td><td>{{ g.employees }}</td>
                <td><button v-if="session.can(P.grades)" class="btn btn-sm" @click.stop="openEdit(g)">تعديل</button></td>
              </tr>
              <tr v-if="open === g.id">
                <td colspan="8" style="background: var(--surface-2)">
                  <div class="hr-scale"><i v-for="(s, i) in g.scale" :key="s.step" :style="{ '--i': i, height: (s.basic / g.maxSalary) * 100 + '%' }" :title="`الدرجة ${s.step}: ${sar(s.basic)}`" /></div>
                  <table class="table" style="margin-top: 8px">
                    <thead><tr><th>الدرجة</th><th>الأساسي</th><th v-for="a in g.allowances" :key="a.code">{{ a.name }}</th><th>الإجمالي</th></tr></thead>
                    <tbody><tr v-for="s in g.scale" :key="s.step"><td>{{ s.step }}</td><td class="hr-num">{{ sar(s.basic) }}</td><td v-for="a in s.allowances" :key="a.code" class="hr-num">{{ sar(a.amount) }}</td><td class="pm-money">{{ sar(s.gross) }}</td></tr></tbody>
                  </table>
                  <p v-if="g.jobs.length" class="pm-muted">الوظائف: {{ g.jobs.map((j) => j.title).join('، ') }}</p>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>
    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" @submit.prevent="save">
        <h2>{{ editing ? `تعديل المرتبة ${editing.code}` : 'مرتبة جديدة' }}</h2>
        <div class="pm-grid2">
          <label class="field"><span>الرمز</span><input v-model="form.code" class="input hr-code" required /></label>
          <label class="field"><span>الاسم</span><input v-model="form.name" class="input" required /></label>
          <label class="field"><span>مستوى الهيكل المناسب</span><select v-model="form.structureLevel" class="input"><option value="">—</option><option v-for="(l, i) in levels" :key="i" :value="i">{{ l }}</option></select></label>
          <label class="field"><span>الترتيب</span><input v-model.number="form.sortOrder" type="number" class="input" /></label>
          <label class="field"><span>الحد الأدنى للراتب الأساسي</span><input v-model.number="form.minSalary" type="number" min="0" class="input" required /></label>
          <label class="field"><span>الحد الأعلى</span><input v-model.number="form.maxSalary" type="number" min="0" class="input" required /></label>
          <label class="field"><span>عدد الدرجات</span><input v-model.number="form.steps" type="number" min="1" max="30" class="input" /></label>
          <label class="field"><span>العلاوة بين الدرجات %</span><input v-model.number="form.stepIncrement" type="number" min="0" step="0.5" class="input" /></label>
        </div>
        <div class="hr-sec">البدلات الافتراضية</div>
        <div v-for="(a, i) in form.allowances" :key="i" style="display: grid; grid-template-columns: 1fr 100px 90px auto; gap: 6px; margin-bottom: 6px">
          <select v-model="a.code" class="input"><option v-for="t in choices(a.code)" :key="t.code" :value="t.code">{{ t.name }}</option></select>
          <select v-model="a.kind" class="input"><option value="percent">نسبة %</option><option value="fixed">مبلغ</option></select>
          <input v-model.number="a.value" type="number" min="0" class="input" />
          <button type="button" class="btn btn-sm" @click="form.allowances.splice(i, 1)">✕</button>
        </div>
        <button type="button" class="btn btn-sm" :disabled="!choices('').length" @click="addAllowance">+ بدل</button>
        <span class="pm-muted" style="margin-inline-start: 8px">البدلات وحساباتها تُعرَّف في <RouterLink to="/hr/settings?tab=allowances" class="pm-link">الإعدادات</RouterLink></span>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button v-if="editing" type="button" class="btn btn-danger" @click="remove">حذف</button><button type="button" class="btn" @click="form.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
