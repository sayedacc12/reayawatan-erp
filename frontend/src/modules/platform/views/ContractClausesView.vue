<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import '../platform.css';

interface Clause { id: string; sequence: number; title: string; paragraphs: string[]; isMandatory: boolean; isActive: boolean }
const toast = useToast();
const clauses = ref<Clause[]>([]);
const variables = ref<{ key: string; hint: string }[]>([]);
const provider = reactive({ name: '', crNumber: '', vatNumber: '', address: '', email: '', courtCity: '', vatRate: 15 });
const error = ref('');
const tab = ref<'clauses' | 'provider'>('clauses');

async function load() {
  try {
    const [c, v, p] = await Promise.all([
      api<Clause[]>('/platform/contract-clauses'),
      api<{ key: string; hint: string }[]>('/platform/contract-variables'),
      api<typeof provider>('/platform/provider'),
    ]);
    clauses.value = c;
    variables.value = v;
    Object.assign(provider, p);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

// ---- تحرير بند ----
const editing = ref<(Omit<Clause, 'id' | 'sequence'> & { id?: string; text: string }) | null>(null);
function edit(c?: Clause) {
  editing.value = c
    ? { id: c.id, title: c.title, paragraphs: c.paragraphs, isMandatory: c.isMandatory, isActive: c.isActive, text: c.paragraphs.join('\n\n') }
    : { title: '', paragraphs: [], isMandatory: false, isActive: true, text: '' };
}
const busy = ref(false);
async function saveClause() {
  const e = editing.value!;
  // كل فقرة يفصلها سطر فارغ
  const body = { title: e.title, paragraphs: e.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean), isMandatory: e.isMandatory, isActive: e.isActive };
  busy.value = true;
  try {
    await api(e.id ? `/platform/contract-clauses/${e.id}` : '/platform/contract-clauses', { method: e.id ? 'PUT' : 'POST', json: body });
    toast.success('تم حفظ البند');
    editing.value = null;
    await load();
  } catch (x) {
    toast.error((x as Error).message);
  } finally {
    busy.value = false;
  }
}
async function toggle(c: Clause, key: 'isActive' | 'isMandatory') {
  try {
    await api(`/platform/contract-clauses/${c.id}`, { method: 'PUT', json: { title: c.title, paragraphs: c.paragraphs, isMandatory: c.isMandatory, isActive: c.isActive, [key]: !c[key] } });
    c[key] = !c[key];
  } catch (x) {
    toast.error((x as Error).message);
  }
}
async function remove(c: Clause) {
  if (!confirm(`حذف البند "${c.title}" من المكتبة؟ العقود الصادرة لا تتأثر.`)) return;
  await api(`/platform/contract-clauses/${c.id}`, { method: 'DELETE' }).catch((x) => toast.error((x as Error).message));
  await load();
}
async function move(i: number, d: -1 | 1) {
  const j = i + d;
  if (j < 0 || j >= clauses.value.length) return;
  const ids = clauses.value.map((c) => c.id);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  clauses.value = await api<Clause[]>('/platform/contract-clauses/order', { method: 'PUT', json: { ids } });
}
async function restore() {
  if (!confirm('استعادة المسودة المقترحة؟ ستُستبدل كل بنود المكتبة الحالية (العقود الصادرة لا تتأثر).')) return;
  clauses.value = await api<Clause[]>('/platform/contract-clauses/restore-defaults', { method: 'POST' });
  toast.success('تمت استعادة المسودة المقترحة');
}
async function saveProvider() {
  busy.value = true;
  try {
    await api('/platform/provider', { method: 'PUT', json: provider });
    toast.success('تم حفظ بيانات مقدم الخدمة');
  } catch (x) {
    toast.error((x as Error).message);
  } finally {
    busy.value = false;
  }
}
function insertVar(key: string) {
  if (editing.value) editing.value.text += `{{${key}}}`;
}
const ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر', 'السادس عشر', 'السابع عشر', 'الثامن عشر', 'التاسع عشر', 'العشرون'];
const highlight = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!).replace(/\{\{([^{}]+)\}\}/g, '<mark>$1</mark>');
</script>

<template>
  <div>
    <section class="p-hero">
      <div>
        <p class="p-kicker">العقود الإلكترونية</p>
        <h1>بنود عقد الاشتراك</h1>
        <p class="p-sub">كل بند كائن مستقل له عنوان وفقرات ومتغيرات. العقود الجديدة تُبنى من البنود الفعّالة بهذا الترتيب، ويمكن تعديل أي عقد بمفرده قبل إرساله.</p>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap">
        <button class="btn btn-ghost-light" @click="restore">استعادة المسودة المقترحة</button>
        <button class="btn btn-gold" @click="edit()">+ بند جديد</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <nav class="p-tabs">
      <button :class="['p-tab', { on: tab === 'clauses' }]" @click="tab = 'clauses'">البنود ({{ clauses.length }})</button>
      <button :class="['p-tab', { on: tab === 'provider' }]" @click="tab = 'provider'">بيانات مقدم الخدمة</button>
    </nav>

    <template v-if="tab === 'clauses'">
      <p class="alert note">مسودة مقترحة مبنية على الأنظمة السعودية (التعاملات الإلكترونية، حماية البيانات الشخصية، ضريبة القيمة المضافة). يُنصح بمراجعتها من مستشار قانوني قبل اعتمادها.</p>
      <article v-for="(c, i) in clauses" :key="c.id" :class="['card', 'clause', { off: !c.isActive }]" :style="{ '--i': i }">
        <header>
          <span class="ord">البند {{ ORD[i] ?? i + 1 }}</span>
          <h3>{{ c.title }}</h3>
          <label class="check small" title="البند الإلزامي لا يمكن حذفه من أي عقد"><input type="checkbox" :checked="c.isMandatory" @change="toggle(c, 'isMandatory')" /> إلزامي</label>
          <label class="check small" title="البند غير الفعّال لا يدخل في العقود الجديدة"><input type="checkbox" :checked="c.isActive" @change="toggle(c, 'isActive')" /> فعّال</label>
          <div class="tools">
            <button class="icon" :disabled="i === 0" @click="move(i, -1)">▲</button>
            <button class="icon" :disabled="i === clauses.length - 1" @click="move(i, 1)">▼</button>
            <button class="btn btn-sm" @click="edit(c)">تعديل</button>
            <button class="icon danger" title="حذف" @click="remove(c)">✕</button>
          </div>
        </header>
        <ol>
          <li v-for="(p, j) in c.paragraphs" :key="j"><span class="pn">{{ i + 1 }}.{{ j + 1 }}</span> <span v-html="highlight(p)" /></li>
        </ol>
      </article>
    </template>

    <section v-else class="card p-panel">
      <p class="muted" style="margin-top: 0">تظهر هذه البيانات في تمهيد العقد وبنوده عبر المتغيرات.</p>
      <form @submit.prevent="saveProvider">
        <div class="p-row-2">
          <div class="field"><label>اسم مقدم الخدمة (الطرف الأول)</label><input v-model="provider.name" class="input" required /></div>
          <div class="field"><label>رقم السجل التجاري</label><input v-model="provider.crNumber" class="input" dir="ltr" /></div>
          <div class="field"><label>الرقم الضريبي</label><input v-model="provider.vatNumber" class="input" dir="ltr" /></div>
          <div class="field"><label>البريد الرسمي</label><input v-model="provider.email" class="input" dir="ltr" /></div>
          <div class="field"><label>العنوان</label><input v-model="provider.address" class="input" /></div>
          <div class="field"><label>مدينة المحكمة المختصة</label><input v-model="provider.courtCity" class="input" /></div>
          <div class="field"><label>نسبة ضريبة القيمة المضافة الافتراضية %</label><input v-model.number="provider.vatRate" class="input" type="number" min="0" max="100" /></div>
        </div>
        <button class="btn btn-primary" :disabled="busy">حفظ</button>
      </form>
    </section>

    <div v-if="editing" class="modal-backdrop" @click.self="editing = null">
      <form class="card modal modal-wide" @submit.prevent="saveClause">
        <h2 style="margin-bottom: 14px">{{ editing.id ? 'تعديل بند' : 'بند جديد' }}</h2>
        <div class="field"><label>عنوان البند</label><input v-model="editing.title" class="input" required minlength="2" /></div>
        <div class="field">
          <label>الفقرات <small class="muted">(افصل بين كل فقرة وأخرى بسطر فارغ)</small></label>
          <textarea v-model="editing.text" class="input" rows="10" style="line-height: 1.8" />
        </div>
        <div class="vars">
          <span class="muted small">إدراج متغير:</span>
          <button v-for="v in variables" :key="v.key" type="button" class="var" :title="v.hint" @click="insertVar(v.key)">{{ v.key }}</button>
        </div>
        <div style="display: flex; gap: 16px; margin: 10px 0">
          <label class="check"><input v-model="editing.isMandatory" type="checkbox" /> بند إلزامي</label>
          <label class="check"><input v-model="editing.isActive" type="checkbox" /> فعّال في العقود الجديدة</label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" :disabled="busy">حفظ البند</button>
          <button type="button" class="btn" @click="editing = null">إلغاء</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.note { background: #fff8e8; color: #7a5a14; border: 1px solid #f0d9a6; }
.clause { padding: 14px 18px; margin-bottom: 10px; animation: p-rise .4s var(--ease) both; animation-delay: calc(min(var(--i), 12) * 30ms); }
.clause.off { opacity: .55; }
.clause header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
.clause h3 { font-size: 1rem; flex: 1; color: #0f5c55; }
.ord { color: #b07d1e; font-weight: 700; }
.small { font-size: .85rem; }
.tools { display: flex; gap: 4px; align-items: center; }
.icon { width: 30px; height: 30px; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; cursor: pointer; font-size: .75rem; color: var(--muted); }
.icon:disabled { opacity: .35; }
.icon.danger:hover { color: var(--danger); border-color: var(--danger); }
ol { list-style: none; margin: 0; padding: 0; line-height: 1.9; }
.pn { color: #a08a5a; font-size: .82rem; }
:deep(mark) { background: #e9f1ec; color: var(--primary); padding: 0 5px; border-radius: 5px; font-weight: 600; }
.vars { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.var { border: 1px solid var(--border); background: var(--surface-2); border-radius: 999px; padding: 2px 10px; font: inherit; font-size: .8rem; cursor: pointer; }
.var:hover { border-color: var(--primary); color: var(--primary); }
</style>
