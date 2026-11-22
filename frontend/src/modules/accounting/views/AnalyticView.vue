<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, loadAnalytic, type Analytic } from '../lib';
import '../../../shared/module.css';
import '../acc.css';

const session = useSession();
const toast = useToast();
const rows = ref<Analytic[]>([]);
const levels = ref(3);
const error = ref('');
async function load() {
  try {
    const r = await loadAnalytic();
    rows.value = r.accounts;
    levels.value = r.levels;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
const ordered = computed(() => {
  const out: Analytic[] = [];
  const walk = (pid: string | null) => rows.value.filter((r) => r.parentId === pid).forEach((r) => { out.push(r); walk(r.id); });
  walk(null);
  return out;
});
const canManage = computed(() => session.can(P.accounts));
const show = ref(false);
const editing = ref<Analytic | null>(null);
const form = reactive({ code: '', name: '', kind: 'sub' as 'main' | 'sub', parentId: null as string | null, description: '', isActive: true });
const mains = computed(() => rows.value.filter((r) => r.kind === 'main' && r.level < levels.value));
function openNew(parent?: Analytic) {
  editing.value = null;
  Object.assign(form, { code: parent ? `${parent.code}-` : '', name: '', kind: parent ? (parent.level + 1 >= levels.value ? 'sub' : 'sub') : 'main', parentId: parent?.id ?? null, description: '', isActive: true });
  show.value = true;
}
function openEdit(a: Analytic) {
  editing.value = a;
  Object.assign(form, { code: a.code, name: a.name, kind: a.kind, parentId: a.parentId, description: a.description ?? '', isActive: a.isActive });
  show.value = true;
}
async function save() {
  try {
    if (editing.value) {
      await api(`/accounting/analytic/${editing.value.id}`, { method: 'PATCH', json: { code: form.code, name: form.name, description: form.description || null, isActive: form.isActive } });
    } else {
      await api('/accounting/analytic', { method: 'POST', json: { ...form, description: form.description || null } });
    }
    toast.success('تم الحفظ');
    show.value = false;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove(a: Analytic) {
  if (!confirm(`حذف الحساب التحليلي ${a.name}؟`)) return;
  try {
    await api(`/accounting/analytic/${a.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <section class="pm-hero ac-hero">
      <div>
        <p class="pm-kicker">النظام المالي</p>
        <h1>الحسابات التحليلية (مراكز التكلفة)</h1>
        <p class="pm-sub">رئيسي وفرعي حتى {{ levels }} مستويات. التسجيل على الفرعي فقط، ويمكن توزيع سطر القيد على أكثر من حساب تحليلي بنسب.</p>
      </div>
      <div class="pm-actions"><button v-if="canManage" class="btn ac-glow" @click="openNew()">حساب تحليلي رئيسي</button></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <section class="card pm-panel">
      <div v-if="!rows.length" class="ac-empty-state"><div class="ic">🎯</div><h3>لا توجد حسابات تحليلية</h3><p class="pm-muted">تُنشأ مراكز التكلفة حسب التصنيف الوظيفي للمصروفات تلقائيًا عند تنصيب الدليل الموحد.</p></div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead><tr><th>الرمز والاسم</th><th>النوع</th><th>المستوى</th><th>عدد الحركات</th><th v-if="canManage"></th></tr></thead>
          <tbody>
            <tr v-for="a in ordered" :key="a.id" :class="{ off: !a.isActive }">
              <td><span class="ac-indent" :style="{ width: (a.level - 1) * 22 + 'px' }" /><span class="ac-code" :class="{ sub: a.kind === 'sub' }">{{ a.code }}</span> <b v-if="a.kind === 'main'">{{ a.name }}</b><span v-else>{{ a.name }}</span></td>
              <td><span class="pm-pill" :style="{ '--c': a.kind === 'main' ? '#8b5cf6' : '#10b981' }">{{ a.kind === 'main' ? 'رئيسي' : 'فرعي' }}</span></td>
              <td class="ac-code">{{ a.level }}</td><td class="ac-code">{{ a.moves }}</td>
              <td v-if="canManage" class="acts">
                <button v-if="a.kind === 'main' && a.level < levels" class="btn btn-sm" @click="openNew(a)">+</button>
                <button class="btn btn-sm" @click="openEdit(a)">تعديل</button>
                <button v-if="!a.moves && !a.children" class="btn btn-sm btn-danger" @click="remove(a)">حذف</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="show" class="modal-backdrop" @click.self="show = false">
      <form class="card modal" @submit.prevent="save">
        <h2>{{ editing ? 'تعديل حساب تحليلي' : 'حساب تحليلي جديد' }}</h2>
        <label v-if="!editing" class="field"><span>النوع</span>
          <select v-model="form.kind" class="input"><option value="main">رئيسي</option><option value="sub">فرعي (يُسجَّل عليه)</option></select>
        </label>
        <label v-if="!editing" class="field"><span>الحساب الرئيسي الأب</span>
          <select v-model="form.parentId" class="input" :required="form.kind === 'sub'"><option :value="null">— بدون (أعلى مستوى) —</option><option v-for="m in mains" :key="m.id" :value="m.id">{{ m.code }} {{ m.name }}</option></select>
        </label>
        <div class="field-row">
          <label class="field"><span>الرمز</span><input v-model="form.code" class="input ac-code" required /></label>
          <label class="field"><span>الاسم</span><input v-model="form.name" class="input" required /></label>
        </div>
        <label class="field"><span>وصف</span><input v-model="form.description" class="input" /></label>
        <label class="check"><input v-model="form.isActive" type="checkbox" /> نشط</label>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.ac-code.sub { color: var(--primary); }
.off { opacity: .55; }
.acts { white-space: nowrap; display: flex; gap: 4px; justify-content: flex-end; }
.check { display: flex; gap: 8px; align-items: center; }
</style>
