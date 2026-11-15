<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { COMP_KINDS, P, type Competency } from '../lib';
import '../../projects/projects.css';
import '../hr.css';

const session = useSession();
const toast = useToast();
const rows = ref<Competency[]>([]);
const kind = ref('all');
const error = ref('');
async function load() {
  try {
    rows.value = await api<Competency[]>('/hr/competencies');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
const shown = computed(() => rows.value.filter((r) => kind.value === 'all' || r.kind === kind.value));
const KIND_C: Record<string, string> = { core: '#14b8a6', leadership: '#a78bfa', technical: '#f59e0b' };
const editing = ref<Competency | null>(null);
const form = reactive({ show: false, name: '', kind: 'core', description: '', levels: [] as { level: number; description: string }[], isActive: true });
const blank = () => [1, 2, 3, 4, 5].map((level) => ({ level, description: '' }));
function openNew() {
  editing.value = null;
  Object.assign(form, { show: true, name: '', kind: 'core', description: '', levels: blank(), isActive: true });
}
function openEdit(c: Competency) {
  editing.value = c;
  const lv = blank().map((b) => ({ ...b, description: c.levels.find((l) => l.level === b.level)?.description ?? '' }));
  Object.assign(form, { show: true, name: c.name, kind: c.kind, description: c.description ?? '', levels: lv, isActive: c.isActive });
}
async function save() {
  try {
    const body = { name: form.name, kind: form.kind, description: form.description || null, levels: form.levels.filter((l) => l.description.trim()), isActive: form.isActive };
    if (editing.value) await api(`/hr/competencies/${editing.value.id}`, { method: 'PATCH', json: body });
    else await api('/hr/competencies', { method: 'POST', json: body });
    toast.success('تم الحفظ');
    form.show = false;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove() {
  if (!editing.value || !confirm('حذف الجدارة؟')) return;
  try {
    await api(`/hr/competencies/${editing.value.id}`, { method: 'DELETE' });
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
      <div><p class="pm-kicker">التنظيم والتخطيط</p><h1>نماذج الجدارات</h1>
        <p class="pm-sub">مكتبة الجدارات الأساسية والقيادية والفنية، ولكل جدارة خمسة مستويات سلوكية. تُربط بالأوصاف الوظيفية بالمستوى المطلوب، ويُقيَّم عليها الموظف في بطاقة الأداء.</p></div>
      <div class="pm-actions"><button v-if="session.can(P.competencies)" class="btn hr-glow" @click="openNew">جدارة جديدة</button></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div class="hr-tabs">
      <button :class="['hr-tab', { on: kind === 'all' }]" @click="kind = 'all'">الكل ({{ rows.length }})</button>
      <button v-for="k in COMP_KINDS" :key="k.value" :class="['hr-tab', { on: kind === k.value }]" @click="kind = k.value">{{ k.label }} ({{ rows.filter((r) => r.kind === k.value).length }})</button>
    </div>
    <p v-if="!shown.length" class="card pm-empty">لا توجد جدارات</p>
    <div class="hr-cards">
      <article v-for="(c, i) in shown" :key="c.id" class="card hr-card" :style="{ '--i': i, opacity: c.isActive ? 1 : .55 }">
        <h3>{{ c.name }} <span class="pm-pill" :style="{ '--c': KIND_C[c.kind] }">{{ c.kindLabel }}</span></h3>
        <p v-if="c.description" class="pm-muted" style="margin: 0">{{ c.description }}</p>
        <div v-for="l in c.levels" :key="l.level" class="hr-level"><span class="n">{{ l.level }}</span><span>{{ l.description }}</span></div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: auto">
          <span class="pm-muted">في {{ c.jobs }} وصف وظيفي</span>
          <button v-if="session.can(P.competencies)" class="btn btn-sm" @click="openEdit(c)">تعديل</button>
        </div>
      </article>
    </div>
    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" @submit.prevent="save">
        <h2>{{ editing ? 'تعديل جدارة' : 'جدارة جديدة' }}</h2>
        <div class="pm-grid2">
          <label class="field"><span>الاسم</span><input v-model="form.name" class="input" required /></label>
          <label class="field"><span>النوع</span><select v-model="form.kind" class="input"><option v-for="k in COMP_KINDS" :key="k.value" :value="k.value">{{ k.label }}</option></select></label>
        </div>
        <label class="field"><span>التعريف</span><textarea v-model="form.description" class="input" rows="2" /></label>
        <div class="hr-sec">المستويات السلوكية</div>
        <label v-for="l in form.levels" :key="l.level" class="field"><span>المستوى {{ l.level }}</span><input v-model="l.description" class="input" /></label>
        <label class="check" style="display: flex; gap: 8px"><input v-model="form.isActive" type="checkbox" /> نشطة</label>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button v-if="editing" type="button" class="btn btn-danger" @click="remove">حذف</button><button type="button" class="btn" @click="form.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
