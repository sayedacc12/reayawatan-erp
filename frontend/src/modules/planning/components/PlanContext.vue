<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { errMsg } from '../lib';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** القضايا الجوهرية أو خارطة المعنيين للخطة: عرض وإضافة وتعديل وحذف (التعديل على خطة معتمدة يفتح مسودة تعديل) */
const props = defineProps<{ plan: any; kind: 'issue' | 'stakeholder'; editable: boolean }>();
const emit = defineEmits<{ changed: [v: any] }>();
const toast = useToast();

const isIssue = computed(() => props.kind === 'issue');
const rows = computed<any[]>(() => (isIssue.value ? props.plan.issues : props.plan.stakeholders) ?? []);
const base = computed(() => (isIssue.value ? 'issues' : 'stakeholders'));
const lines = (t: string | null) => (t ?? '').split('\n').map((x) => x.trim()).filter(Boolean);

// ----- التصنيفات (خارطة المعنيين)
const SUGGESTED = ['الجهة المالكة', 'الحوكمة', 'الإدارة التنفيذية', 'فريق العمل', 'العملاء', 'المستفيدون', 'الجهات التنظيمية والإشرافية', 'الشركاء', 'المتعاملون', 'الموردون', 'المجتمع'];
const categories = computed(() => {
  const seen = new Map<string, number>();
  for (const r of rows.value) seen.set(r.category, (seen.get(r.category) ?? 0) + 1);
  return [...seen.entries()];
});
const categoryOptions = computed(() => [...new Set([...categories.value.map(([c]) => c), ...SUGGESTED])]);
const cat = ref('');
const q = ref('');
const shown = computed(() => {
  const s = q.value.trim();
  return rows.value.filter((r) => (!cat.value || r.category === cat.value)
    && (!s || JSON.stringify([r.title, r.summary, r.recommendations, r.name, r.definition, r.expectsFromUs, r.weExpect]).includes(s)));
});
const grouped = computed(() => {
  const m = new Map<string, any[]>();
  for (const r of shown.value) m.set(r.category, [...(m.get(r.category) ?? []), r]);
  return [...m.entries()];
});
const PALETTE = ['#0ea5e9', '#10b981', '#f59e0b', '#a78bfa', '#ef4444', '#14b8a6', '#6366f1', '#ec4899', '#84cc16', '#f97316', '#64748b'];
const color = (c: string) => PALETTE[Math.max(0, categoryOptions.value.indexOf(c)) % PALETTE.length];

// ----- النموذج
const form = reactive({ open: false, id: null as string | null, busy: false, v: {} as Record<string, any> });
function open(r: any | null) {
  form.id = r?.id ?? null;
  form.v = isIssue.value
    ? { title: r?.title ?? '', summary: r?.summary ?? '', recommendations: r?.recommendations ?? '' }
    : { name: r?.name ?? '', category: r?.category ?? cat.value ?? '', definition: r?.definition ?? '', expectsFromUs: r?.expectsFromUs ?? '', weExpect: r?.weExpect ?? '' };
  form.open = true;
}
const reopenNote = computed(() => props.plan.status === 'approved' ? 'الخطة معتمدة: الحفظ يفتح مسودة تعديل على الخطة، وتُرفع للاعتماد كإصدار جديد.' : '');
async function save() {
  form.busy = true;
  try {
    const v = await api(form.id ? `/planning/${base.value}/${form.id}` : `/planning/plans/${props.plan.id}/${base.value}`, { method: form.id ? 'PATCH' : 'POST', json: form.v });
    form.open = false;
    toast.success('حُفظ');
    emit('changed', v);
  } catch (e) { toast.error(errMsg(e)); } finally { form.busy = false; }
}
async function remove(r: any) {
  if (!confirm(`حذف ${r.code} «${r.title ?? r.name}»؟`)) return;
  try { emit('changed', await api(`/planning/${base.value}/${r.id}`, { method: 'DELETE' })); } catch (e) { toast.error(errMsg(e)); }
}
</script>

<template>
  <section class="card pm-panel">
    <h2>
      <span>{{ isIssue ? 'القضايا الجوهرية' : 'خارطة المعنيين' }} <span class="pm-muted">{{ rows.length }} {{ isIssue ? 'قضية' : 'معنيًا' }}</span></span>
      <span class="pl-flex">
        <input v-model="q" class="input" style="width: 200px" placeholder="بحث" />
        <button v-if="editable" class="btn btn-sm btn-primary" @click="open(null)">+ {{ isIssue ? 'قضية جوهرية' : 'معني' }}</button>
      </span>
    </h2>
    <p class="pm-muted" style="margin-top: -6px">
      {{ isIssue ? 'القضايا التي بُنيت عليها توجهات الخطة: عنوان كل قضية وملخصها والتوصيات المتوقعة منها.' : 'الجهات المعنية بالخطة مصنفة، مع ما يتوقعه كل معني من الشركة وما تتوقعه الشركة منه.' }}
    </p>

    <div v-if="!isIssue && categories.length" class="rk-tabs" style="margin: 0 0 12px">
      <button :class="['rk-tab', { on: !cat }]" @click="cat = ''">الكل ({{ rows.length }})</button>
      <button v-for="[c, n] in categories" :key="c" :class="['rk-tab', { on: cat === c }]" @click="cat = c">{{ c }} ({{ n }})</button>
    </div>

    <p v-if="!rows.length" class="pm-empty">{{ isIssue ? 'لا توجد قضايا جوهرية بعد.' : 'لا يوجد معنيون بعد.' }}</p>
    <p v-else-if="!shown.length" class="pm-empty">لا توجد نتائج</p>

    <!-- القضايا -->
    <div v-if="isIssue" class="pc-list">
      <article v-for="r in shown" :key="r.id" class="pc-card" style="--c: #0ea5e9">
        <header>
          <span><span class="rk-code">{{ r.code }}</span> <b>{{ r.title }}</b></span>
          <span v-if="editable" class="pl-flex"><button class="btn btn-sm" @click="open(r)">تعديل</button><button class="btn btn-sm" @click="remove(r)">✕</button></span>
        </header>
        <div class="pc-cols">
          <div><h4>ملخص القضية</h4><p>{{ r.summary }}</p></div>
          <div v-if="lines(r.recommendations).length"><h4>التوصيات المتوقعة</h4><ul><li v-for="(x, i) in lines(r.recommendations)" :key="i">{{ x }}</li></ul></div>
        </div>
      </article>
    </div>

    <!-- المعنيون -->
    <template v-else>
      <div v-for="[c, list] in grouped" :key="c" class="pc-group">
        <h3><span class="pc-dot" :style="{ background: color(c) }" />{{ c }} <span class="pm-muted">{{ list.length }}</span></h3>
        <div class="pc-list">
          <article v-for="r in list" :key="r.id" class="pc-card" :style="{ '--c': color(c) }">
            <header>
              <span><span class="rk-code">{{ r.code }}</span> <b>{{ r.name }}</b></span>
              <span v-if="editable" class="pl-flex"><button class="btn btn-sm" @click="open(r)">تعديل</button><button class="btn btn-sm" @click="remove(r)">✕</button></span>
            </header>
            <p v-if="r.definition" class="pc-def">{{ r.definition }}</p>
            <div class="pc-cols">
              <div><h4>ما يتوقعه من الشركة</h4><ul v-if="lines(r.expectsFromUs).length"><li v-for="(x, i) in lines(r.expectsFromUs)" :key="i">{{ x }}</li></ul><p v-else class="pm-muted">—</p></div>
              <div><h4>ما تتوقعه الشركة منه</h4><ul v-if="lines(r.weExpect).length"><li v-for="(x, i) in lines(r.weExpect)" :key="i">{{ x }}</li></ul><p v-else class="pm-muted">—</p></div>
            </div>
          </article>
        </div>
      </div>
    </template>

    <div v-if="form.open" class="modal-backdrop" @click.self="form.open = false">
      <form class="card modal" style="max-width: 720px" @submit.prevent="save">
        <h2>{{ form.id ? 'تعديل' : 'إضافة' }} {{ isIssue ? 'قضية جوهرية' : 'معني' }}</h2>
        <p v-if="reopenNote" class="pm-muted">{{ reopenNote }}</p>
        <template v-if="isIssue">
          <label class="field"><span>عنوان القضية</span><input v-model="form.v.title" class="input" required minlength="3" maxlength="300" /></label>
          <label class="field"><span>ملخص القضية</span><textarea v-model="form.v.summary" class="input" rows="5" required maxlength="3000" /></label>
          <label class="field"><span>التوصيات المتوقعة <small class="pm-muted">توصية في كل سطر</small></span><textarea v-model="form.v.recommendations" class="input" rows="5" maxlength="3000" /></label>
        </template>
        <template v-else>
          <div class="rk-fields">
            <label class="field"><span>المعني</span><input v-model="form.v.name" class="input" required minlength="2" maxlength="200" /></label>
            <label class="field"><span>التصنيف</span><input v-model="form.v.category" class="input" list="pc-categories" required minlength="2" maxlength="100" />
              <datalist id="pc-categories"><option v-for="c in categoryOptions" :key="c" :value="c" /></datalist></label>
          </div>
          <label class="field"><span>التعريف</span><textarea v-model="form.v.definition" class="input" rows="2" maxlength="2000" /></label>
          <label class="field"><span>ما يتوقعه من الشركة <small class="pm-muted">بند في كل سطر</small></span><textarea v-model="form.v.expectsFromUs" class="input" rows="4" maxlength="2000" /></label>
          <label class="field"><span>ما تتوقعه الشركة منه <small class="pm-muted">بند في كل سطر</small></span><textarea v-model="form.v.weExpect" class="input" rows="4" maxlength="2000" /></label>
        </template>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="form.busy">حفظ</button><button type="button" class="btn" @click="form.open = false">إلغاء</button></div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.pc-list { display: grid; gap: 12px; }
.pc-group { margin-top: 14px; }
.pc-group h3 { display: flex; align-items: center; gap: 8px; font-size: 1rem; margin: 0 0 8px; }
.pc-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.pc-card { border: 1px solid #e2e8f0; border-inline-start: 4px solid var(--c); border-radius: 10px; padding: 12px 14px; background: #fff; }
.pc-card header { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
.pc-def { margin: 6px 0 0; color: #475569; }
.pc-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin-top: 8px; }
.pc-cols h4 { margin: 0 0 4px; font-size: 0.85rem; color: #0f766e; }
.pc-cols p { margin: 0; white-space: pre-line; line-height: 1.7; }
.pc-cols ul { margin: 0; padding-inline-start: 18px; line-height: 1.7; }
</style>
