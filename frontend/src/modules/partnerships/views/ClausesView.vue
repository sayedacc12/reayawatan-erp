<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { highlight, lookups, setLookups } from '../lib';
import '../../../shared/module.css';
import '../partnerships.css';

const toast = useToast();
const lk = ref<any>(null);
const clauses = ref<any[]>([]);
const cat = ref<string>('all');
const q = ref('');
const busy = ref(false);
async function load() {
  try {
    [lk.value, clauses.value] = await Promise.all([lookups(true), api<any[]>('/partnerships/clauses')]);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
const cats = computed<any[]>(() => lk.value?.categories ?? []);
const typeName = (id: string) => lk.value?.types.find((t: any) => t.id === id);
const visible = computed(() => clauses.value.filter((c) => (cat.value === 'all' || c.categoryId === cat.value)
  && (!q.value.trim() || `${c.title} ${c.paragraphs.join(' ')}`.includes(q.value.trim()))));
const grouped = computed(() => cats.value.map((x) => ({ ...x, items: visible.value.filter((c) => c.categoryId === x.id) })).filter((g) => g.items.length));
const count = (id: string) => clauses.value.filter((c) => c.categoryId === id).length;

// ---- تحرير بند ----
const editing = ref<any>(null);
function edit(c?: any) {
  editing.value = c
    ? { id: c.id, categoryId: c.categoryId, title: c.title, text: c.paragraphs.join('\n\n'), typeIds: [...c.typeIds], isMandatory: c.isMandatory, isDefault: c.isDefault, isActive: c.isActive }
    : { categoryId: cat.value === 'all' ? cats.value[0]?.id : cat.value, title: '', text: '', typeIds: [], isMandatory: false, isDefault: true, isActive: true };
}
let area: HTMLTextAreaElement | null = null;
const setArea = (e: FocusEvent) => { area = e.target as HTMLTextAreaElement; };
function insertVar(key: string) {
  const e = editing.value;
  const pos = area?.selectionStart ?? e.text.length;
  e.text = `${e.text.slice(0, pos)}{{${key}}}${e.text.slice(area?.selectionEnd ?? pos)}`;
}
function toggleType(id: string) {
  const e = editing.value;
  e.typeIds = e.typeIds.includes(id) ? e.typeIds.filter((x: string) => x !== id) : [...e.typeIds, id];
}
async function saveClause() {
  const e = editing.value;
  const body = {
    categoryId: e.categoryId, title: e.title, typeIds: e.typeIds, isMandatory: e.isMandatory, isDefault: e.isDefault || e.isMandatory, isActive: e.isActive,
    paragraphs: e.text.split(/\n\s*\n/).map((p: string) => p.trim()).filter(Boolean),
  };
  busy.value = true;
  try {
    await api(e.id ? `/partnerships/clauses/${e.id}` : '/partnerships/clauses', { method: e.id ? 'PUT' : 'POST', json: body });
    toast.success('حُفظ البند في المكتبة');
    editing.value = null;
    clauses.value = await api('/partnerships/clauses');
  } catch (x) {
    toast.error((x as Error).message);
  } finally {
    busy.value = false;
  }
}
async function remove(c: any) {
  if (!confirm(`حذف البند «${c.title}» من المكتبة؟ العقود الصادرة لا تتأثر.`)) return;
  try {
    await api(`/partnerships/clauses/${c.id}`, { method: 'DELETE' });
    clauses.value = clauses.value.filter((x) => x.id !== c.id);
  } catch (x) {
    toast.error((x as Error).message);
  }
}
async function move(c: any, d: -1 | 1) {
  const same = clauses.value.filter((x) => x.categoryId === c.categoryId);
  const j = same.indexOf(c) + d;
  if (j < 0 || j >= same.length) return;
  const ids = clauses.value.map((x) => x.id);
  const a = ids.indexOf(c.id);
  const b = ids.indexOf(same[j].id);
  [ids[a], ids[b]] = [ids[b], ids[a]];
  clauses.value = await api('/partnerships/clauses/order', { method: 'PUT', json: { ids } });
}
async function restore() {
  if (!confirm('إضافة البنود المقترحة الناقصة إلى المكتبة؟ لن تتغير البنود التي عدّلتها.')) return;
  const r = await api<any>('/partnerships/clauses/restore', { method: 'POST' });
  clauses.value = r.clauses;
  await lookups(true).then((v) => (lk.value = v));
  toast.success(r.added ? `أُضيف ${r.added} بندًا مقترحًا` : 'كل البنود المقترحة موجودة');
}

// ---- إدارة التبويب ----
const catEdit = ref<any[] | null>(null);
const openCats = () => (catEdit.value = cats.value.map((x) => ({ ...x })));
function moveCat(i: number, d: number) {
  const a = catEdit.value!;
  const j = i + d;
  if (j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]];
}
async function saveCats() {
  try {
    const list = await api<any[]>('/partnerships/settings/categories', { method: 'PUT', json: { categories: catEdit.value!.map((x) => ({ id: x.id || undefined, name: x.name, color: x.color })) } });
    setLookups({ ...lk.value, categories: list });
    lk.value = { ...lk.value, categories: list };
    catEdit.value = null;
    toast.success('حُفظ تبويب البنود');
    clauses.value = await api('/partnerships/clauses');
  } catch (x) {
    toast.error((x as Error).message);
  }
}
</script>

<template>
  <div>
    <section class="pm-hero pt-hero">
      <div class="pt-rings" aria-hidden="true"><i /><i /></div>
      <div>
        <p class="pm-kicker">صياغة العقود</p>
        <h1>مكتبة بنود عقود الشراكة</h1>
        <p class="pm-sub">كل بند كائن مستقل له تبويب وعنوان وفقرات ومتغيرات. العقد الجديد يُبنى من البنود الأساسية العامة والخاصة بنوع الشراكة، ويُعدّل لكل عقد بمفرده.</p>
      </div>
      <div class="pm-actions">
        <button class="btn pt-glow" @click="edit()">+ بند جديد</button>
        <button class="btn pt-ghost" @click="openCats">تبويب البنود</button>
        <button class="btn pt-ghost" @click="restore">إضافة البنود المقترحة الناقصة</button>
      </div>
    </section>
    <p class="alert note">البنود المقترحة صيغت على أساس الأنظمة السعودية (الجمعيات والمؤسسات الأهلية، التعاملات الإلكترونية، حماية البيانات الشخصية). يُنصح بمراجعتها من مستشار قانوني قبل اعتمادها.</p>

    <div v-if="lk" class="lib">
      <aside class="card side">
        <button :class="['cat', { on: cat === 'all' }]" style="--c: #b45309" @click="cat = 'all'"><i />كل البنود<b>{{ clauses.length }}</b></button>
        <button v-for="x in cats" :key="x.id" :class="['cat', { on: cat === x.id }]" :style="{ '--c': x.color }" @click="cat = x.id"><i />{{ x.name }}<b>{{ count(x.id) }}</b></button>
      </aside>
      <div>
        <input v-model="q" class="input" placeholder="بحث في عناوين البنود ونصوصها" style="margin-bottom: 12px" />
        <section v-for="g in grouped" :key="g.id" class="grp" :style="{ '--c': g.color }">
          <h3 class="grp-head"><span class="bullet" />{{ g.name }}</h3>
          <article v-for="(c, i) in g.items" :key="c.id" :class="['card', 'clause', { off: !c.isActive }]" :style="{ '--i': i }">
            <header>
              <h4>{{ c.title }}</h4>
              <span v-if="c.isMandatory" class="pt-chip" style="--c: #0369a1">إلزامي</span>
              <span v-else-if="!c.isDefault" class="pt-chip" style="--c: #7c3aed">اختياري</span>
              <span v-if="!c.isActive" class="pt-chip" style="--c: #94a3b8">موقوف</span>
              <span v-if="!c.typeIds.length" class="pt-chip" style="--c: #64748b">كل الأنواع</span>
              <span v-for="t in c.typeIds" :key="t" class="pt-chip" :style="{ '--c': typeName(t)?.color }">{{ typeName(t)?.name }}</span>
              <div class="tools">
                <button class="icon" :disabled="i === 0" @click="move(c, -1)">▲</button>
                <button class="icon" :disabled="i === g.items.length - 1" @click="move(c, 1)">▼</button>
                <button class="btn btn-sm" @click="edit(c)">تعديل</button>
                <button class="icon danger" title="حذف" @click="remove(c)">✕</button>
              </div>
            </header>
            <ol><li v-for="(p, j) in c.paragraphs" :key="j"><span class="pn">{{ j + 1 }}.</span> <span v-html="highlight(p)" /></li></ol>
          </article>
        </section>
        <p v-if="!grouped.length" class="card pt-empty">لا توجد بنود</p>
      </div>
    </div>

    <div v-if="editing" class="modal-backdrop" @click.self="editing = null">
      <form class="card modal pt-modal-wide" @submit.prevent="saveClause">
        <h2 style="margin-bottom: 12px">{{ editing.id ? 'تعديل بند' : 'بند جديد في المكتبة' }}</h2>
        <div class="pt-fields">
          <div class="field" style="grid-column: span 2"><label>عنوان البند</label><input v-model="editing.title" class="input" required minlength="2" /></div>
          <div class="field"><label>التبويب</label><select v-model="editing.categoryId" class="input" required><option v-for="x in cats" :key="x.id" :value="x.id">{{ x.name }}</option></select></div>
        </div>
        <div class="field">
          <label>الفقرات <small class="pm-muted">(افصل بين كل فقرة وأخرى بسطر فارغ)</small></label>
          <textarea v-model="editing.text" class="input" rows="9" style="line-height: 1.8" @focus="setArea" />
        </div>
        <div class="vars"><span class="pm-muted">إدراج متغير:</span>
          <button v-for="v in lk.variables" :key="v.key" type="button" class="var" :title="v.hint" @mousedown.prevent @click="insertVar(v.key)">{{ v.key }}</button></div>
        <div class="field" style="margin-top: 10px"><label>يدخل تلقائيًا في عقود أنواع الشراكة <small class="pm-muted">(بدون اختيار = كل الأنواع)</small></label>
          <div class="pt-chips"><button v-for="t in lk.types" :key="t.id" type="button" :class="['pt-chip', { on: editing.typeIds.includes(t.id) }]" :style="{ '--c': t.color }" @click="toggleType(t.id)">{{ t.name }}</button></div>
        </div>
        <div class="flags">
          <label class="check"><input v-model="editing.isMandatory" type="checkbox" /> إلزامي (لا يُحذف من أي عقد)</label>
          <label class="check"><input v-model="editing.isDefault" type="checkbox" :disabled="editing.isMandatory" /> أساسي (يدخل العقد تلقائيًا، وغير ذلك يُضاف عند الحاجة)</label>
          <label class="check"><input v-model="editing.isActive" type="checkbox" /> فعّال</label>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ البند</button><button type="button" class="btn" @click="editing = null">إلغاء</button></div>
      </form>
    </div>

    <div v-if="catEdit" class="modal-backdrop" @click.self="catEdit = null">
      <div class="card modal pt-modal-wide">
        <h2 style="margin-bottom: 4px">تبويب بنود العقود</h2>
        <p class="pm-muted" style="margin-top: 0">ترتيب التبويب هو ترتيب أقسام العقد. التبويب الذي فيه بنود لا يُحذف.</p>
        <div v-for="(x, i) in catEdit" :key="x.id ?? i" class="crow">
          <input v-model="x.color" type="color" class="color" />
          <input v-model="x.name" class="input" placeholder="اسم التبويب" />
          <button class="btn btn-sm" @click="moveCat(i, -1)">↑</button><button class="btn btn-sm" @click="moveCat(i, 1)">↓</button>
          <button class="btn btn-sm btn-danger" @click="catEdit.splice(i, 1)">حذف</button>
        </div>
        <div class="modal-actions" style="justify-content: space-between">
          <button class="btn" @click="catEdit.push({ name: '', color: '#164e38' })">+ تبويب</button>
          <span><button class="btn btn-primary" @click="saveCats">حفظ</button> <button class="btn" @click="catEdit = null">إلغاء</button></span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.note { background: #fff8e8; color: #7a5a14; border: 1px solid #f0d9a6; }
.lib { display: grid; grid-template-columns: 240px 1fr; gap: 16px; align-items: start; }
.side { padding: 10px; position: sticky; top: 12px; display: grid; gap: 3px; }
.cat { display: flex; align-items: center; gap: 8px; border: 0; background: none; font: inherit; font-size: .88rem; padding: 8px 10px; border-radius: 10px; cursor: pointer; text-align: right; color: var(--text); transition: all .15s; }
.cat i { width: 10px; height: 10px; border-radius: 3px; background: var(--c); flex-shrink: 0; }
.cat b { margin-inline-start: auto; font-size: .76rem; color: var(--muted); }
.cat:hover { background: var(--surface-2); }
.cat.on { background: color-mix(in srgb, var(--c) 12%, transparent); color: var(--c); font-weight: 700; }
.grp { margin-bottom: 14px; }
.grp-head { display: flex; align-items: center; gap: 8px; color: var(--c); font-size: .95rem; margin: 0 0 8px; }
.bullet { width: 12px; height: 12px; border-radius: 4px; background: var(--c); box-shadow: 0 0 10px var(--c); }
.clause { padding: 12px 16px; margin-bottom: 8px; border-inline-start: 3px solid var(--c); animation: pm-rise .35s calc(min(var(--i), 10) * 30ms) var(--ease) both; }
.clause.off { opacity: .55; }
.clause header { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.clause h4 { font-size: .98rem; margin: 0; color: #0f5c55; margin-inline-end: 4px; }
.tools { display: flex; gap: 4px; margin-inline-start: auto; align-items: center; }
.icon { width: 30px; height: 30px; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; cursor: pointer; font-size: .75rem; color: var(--muted); }
.icon:disabled { opacity: .35; }
.icon.danger:hover { color: var(--danger); border-color: var(--danger); }
ol { list-style: none; margin: 0; padding: 0; line-height: 1.9; font-size: .92rem; }
.pn { color: #a08a5a; font-size: .8rem; }
:deep(mark) { background: #fef3c7; color: #92400e; padding: 0 5px; border-radius: 5px; font-weight: 600; }
.vars { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.var { border: 1px solid var(--border); background: var(--surface-2); border-radius: 999px; padding: 2px 10px; font: inherit; font-size: .78rem; cursor: pointer; }
.var:hover { border-color: #f59e0b; color: #b45309; }
.flags { display: grid; gap: 6px; margin: 12px 0; }
.crow { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.crow .input { flex: 1; }
.color { width: 42px; height: 38px; border: 1px solid var(--border); border-radius: 8px; padding: 2px; }
@media (max-width: 900px) { .lib { grid-template-columns: 1fr; } .side { position: static; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); } }
</style>
