<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import ContractDocument from '../../../registration/ContractDocument.vue';
import { useToast } from '../../../stores/toast';
import { CONTRACT_COLOR, KIND_ICON, ORD, fmtDate, fmtDateTime, lookups, sar, today, uid } from '../lib';
import '../../projects/projects.css';
import '../partnerships.css';

const props = defineProps<{ id: string }>();
const router = useRouter();
const printDoc = () => window.print();
const toast = useToast();
const c = ref<any>(null);
const lk = ref<any>(null);
const library = ref<any[]>([]);
const projects = ref<any[]>([]);
const items = ref<any[]>([]);
const terms = ref<any>(null);
const error = ref('');
const tab = ref<'clauses' | 'terms' | 'preview' | 'followups' | 'versions' | 'log'>('clauses');
const dirty = ref(false);
const busy = ref(false);
const touch = () => (dirty.value = true);

function apply(x: any) {
  c.value = x;
  items.value = x.items.map((i: any) => ({ ...i, paragraphs: [...i.paragraphs] }));
  terms.value = { title: x.title, startsOn: x.startsOn, endsOn: x.endsOn, value: x.value, projectId: x.projectId ?? '', orgSignerName: x.orgSignerName ?? '', orgSignerTitle: x.orgSignerTitle ?? '' };
  dirty.value = false;
  if (!x.can.edit && (tab.value === 'clauses' || tab.value === 'terms')) openTab('preview');
}
async function load() {
  try {
    const [x, l, lib, picks] = await Promise.all([api(`/partnerships/contracts/${props.id}`), lookups(), api<any[]>('/partnerships/clauses'), api<any>('/partnerships/picks')]);
    lk.value = l;
    library.value = lib;
    projects.value = picks.projects;
    apply(x);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(() => props.id, load);

// عقود الموردين المرتبطة بهذه الشراكة (عندما يكون الشريك موردًا أيضًا)، لمن يملك عرض عقود المشتريات
const supplyContracts = ref<any[]>([]);
async function loadSupply() {
  supplyContracts.value = await api<any[]>(`/procurement/contracts?ptContract=${props.id}`).catch(() => []);
}
onMounted(loadSupply);
watch(() => props.id, loadSupply);

// ---------- البنود مجمعة حسب التبويب ----------
const cats = computed<any[]>(() => lk.value?.categories ?? []);
const rank = (id: string) => { const i = cats.value.findIndex((x) => x.id === id); return i === -1 ? 99 : i; };
const groups = computed(() => {
  const list = cats.value.map((cat) => ({ ...cat, items: items.value.filter((i) => i.categoryId === cat.id) }));
  const orphan = items.value.filter((i) => !cats.value.some((x) => x.id === i.categoryId));
  if (orphan.length) list.push({ id: '_', name: 'أخرى', color: '#64748b', items: orphan });
  return list;
});
/** رقم البند في العقد (حسب ترتيب التبويب) */
const ordered = computed(() => [...items.value].sort((a, b) => rank(a.categoryId) - rank(b.categoryId)));
const numberOf = (it: any) => ordered.value.indexOf(it);
const filledGroups = computed(() => groups.value.filter((g) => g.items.length));
function move(it: any, d: -1 | 1) {
  const g = items.value.filter((x) => x.categoryId === it.categoryId);
  const j = g.indexOf(it) + d;
  if (j < 0 || j >= g.length) return;
  const a = items.value.indexOf(it);
  const b = items.value.indexOf(g[j]);
  [items.value[a], items.value[b]] = [items.value[b], items.value[a]];
  touch();
}
function remove(it: any) {
  if (!confirm(`حذف البند «${it.title}» من هذا العقد؟`)) return;
  items.value.splice(items.value.indexOf(it), 1);
  touch();
}
function addCustom(categoryId: string) {
  items.value.push({ key: uid(), clauseId: null, categoryId, title: 'بند خاص بهذا العقد', paragraphs: [''], mandatory: false });
  touch();
}
const inContract = computed(() => new Set(items.value.map((i) => i.clauseId).filter(Boolean)));
const missingLibrary = computed(() => library.value.filter((l) => l.isActive && !inContract.value.has(l.id)));
const addPick = ref('');
async function addFromLibrary() {
  if (!addPick.value) return;
  if (dirty.value && !(await save(true))) return;
  try {
    apply(await api(`/partnerships/contracts/${props.id}/clauses/${addPick.value}`, { method: 'POST' }));
    addPick.value = '';
    toast.success('أُضيف البند في تبويبه');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
let lastField: { el: HTMLTextAreaElement; item: any; idx: number } | null = null;
const focusField = (e: FocusEvent, item: any, idx: number) => { lastField = { el: e.target as HTMLTextAreaElement, item, idx }; };
function insertVar(key: string) {
  if (!lastField) return toast.error('اضغط داخل فقرة أولًا ثم اختر المتغير');
  const { el, item, idx } = lastField;
  const pos = el.selectionStart ?? item.paragraphs[idx].length;
  const token = `{{${key}}}`;
  item.paragraphs[idx] = item.paragraphs[idx].slice(0, pos) + token + item.paragraphs[idx].slice(el.selectionEnd ?? pos);
  touch();
  requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos + token.length, pos + token.length); });
}
const grow = (e: Event) => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; };

async function save(silent = false) {
  busy.value = true;
  try {
    const sorted = [...items.value].sort((a, b) => rank(a.categoryId) - rank(b.categoryId));
    apply(await api(`/partnerships/contracts/${props.id}`, {
      method: 'PUT', json: { items: sorted, terms: { ...terms.value, value: terms.value.value || null, projectId: terms.value.projectId || null } },
    }));
    if (!silent) toast.success('حُفظ العقد');
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  } finally {
    busy.value = false;
  }
}

// ---------- المعاينة والإصدارات ----------
const preview = ref<any>(null);
async function openTab(t: typeof tab.value) {
  tab.value = t;
  if (t === 'preview') {
    if (dirty.value && !(await save(true))) return;
    preview.value = await api(`/partnerships/contracts/${props.id}/preview`).catch((e) => { toast.error((e as Error).message); return null; });
  }
}
const version = ref<any>(null);
async function showVersion(v: number) {
  version.value = await api(`/partnerships/contracts/${props.id}/versions/${v}`);
}

// ---------- الإجراءات ----------
async function action(path: string, ok: string, json?: unknown) {
  if (dirty.value && !(await save(true))) return;
  busy.value = true;
  try {
    const x = await api<any>(`/partnerships/contracts/${props.id}/${path}`, { method: 'POST', json });
    if (x.id !== props.id) {
      toast.success(ok);
      return router.push(`/partnerships/contracts/${x.id}`);
    }
    apply(x);
    toast.success(ok);
    if (!x.can.edit) await openTab('preview');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const ask = (q: string) => { const n = prompt(q); return n && n.trim().length >= 3 ? n.trim() : null; };
const submit = () => action('submit', 'رُفع العقد للاعتماد الداخلي');
const approve = () => action('approve', 'اعتُمد العقد داخليًا، ويمكن إرساله للشريك');
const ret = () => { const note = ask('سبب إرجاع العقد للتعديل:'); if (note) action('return', 'أُعيد العقد للتعديل', { note }); };
const send = () => confirm('إرسال العقد للشريك؟ سيُثبَّت النص النهائي إصدارًا جديدًا ويظهر رابط التوقيع.') && action('send', 'أُرسل العقد للشريك');
const withdraw = () => confirm('سحب العقد المرسل وإعادته مسودة؟') && action('withdraw', 'سُحب العقد للتعديل');
const cancel = () => { const note = ask('سبب إلغاء العقد:'); if (note) action('cancel', 'أُلغي العقد', { note }); };
const terminate = () => { const note = ask('سبب إنهاء العقد قبل موعده:'); if (note) action('terminate', 'أُنهي العقد', { note }); };
const renew = () => confirm('إنشاء مسودة تجديد بنفس البنود والمدة تبدأ بعد نهاية هذا العقد؟') && action('renew', 'أُنشئت مسودة التجديد');
async function removeDraft() {
  if (!confirm('حذف مسودة العقد نهائيًا؟')) return;
  try {
    await api(`/partnerships/contracts/${props.id}`, { method: 'DELETE' });
    router.push('/partnerships/contracts');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const manual = ref<any>(null);
const doManual = async () => { await action('manual-sign', 'سُجّل توقيع الشريك', manual.value); manual.value = null; };
const signLink = computed(() => (c.value?.signPath ? `${location.origin}${c.value.signPath}` : ''));
async function copyLink() {
  await navigator.clipboard?.writeText(signLink.value).catch(() => undefined);
  toast.success('نُسخ رابط التوقيع');
}

// ---------- الالتزامات ----------
const fu = reactive({ title: '', kind: 'obligation', party: 'org', dueDate: today(), responsible: '', note: '' });
async function addFollowup() {
  try {
    c.value.followups = await api(`/partnerships/contracts/${props.id}/followups`, { method: 'POST', json: fu });
    fu.title = '';
    fu.note = '';
    toast.success('أُضيف الالتزام');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function toggleDone(f: any) {
  try {
    c.value.followups = await api(`/partnerships/followups/${f.id}/done`, { method: 'POST', json: { done: !f.doneAt } });
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function removeFollowup(f: any) {
  if (!confirm(`حذف «${f.title}»؟`)) return;
  c.value.followups = await api(`/partnerships/followups/${f.id}`, { method: 'DELETE' });
}

const STEPS = [['draft', 'المسودة'], ['review', 'الاعتماد الداخلي'], ['approved', 'جاهز للإرسال'], ['sent', 'عند الشريك'], ['signed', 'موقّع وساري']];
const stepIdx = computed(() => {
  const s = c.value?.status;
  if (s === 'changes_requested') return 0;
  if (['signed', 'expired', 'terminated'].includes(s)) return 5;
  return STEPS.findIndex(([k]) => k === s);
});
const docSub = computed(() => (c.value ? `الإصدار ${c.value.version || 'قيد الإعداد'} · بين الجمعية و${c.value.partnerName}` : ''));
</script>

<template>
  <div>
    <RouterLink to="/partnerships/contracts" class="back">→ عقود الشراكة</RouterLink>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="c && terms">
      <section class="pm-hero pt-hero">
        <div>
          <p class="pm-kicker">اتفاقية شراكة · <span class="pt-code">{{ c.number }}</span><template v-if="c.version"> · الإصدار {{ c.version }}</template></p>
          <h1>{{ c.title }}</h1>
          <p class="pm-sub">
            <RouterLink :to="`/partnerships/partners/${c.partnerId}`" style="color: #fde68a">{{ c.partnerName }}</RouterLink>
            · {{ c.typeName }} · {{ fmtDate(c.startsOn) }} ← {{ fmtDate(c.endsOn) }}<template v-if="c.value"> · {{ sar(c.value) }}</template>
          </p>
        </div>
        <div class="pm-actions">
          <span class="pm-pill status" :style="{ '--c': CONTRACT_COLOR[c.status] }">{{ c.statusLabel }}</span>
          <template v-if="c.can.edit"><button class="btn pt-ghost" :disabled="busy || !dirty" @click="save()">{{ dirty ? 'حفظ التعديلات' : 'محفوظ' }}</button></template>
          <button v-if="c.can.submit" class="btn pt-glow" :disabled="busy" @click="submit">رفع للاعتماد ←</button>
          <template v-if="c.can.decide"><button class="btn pt-glow" :disabled="busy" @click="approve">اعتماد العقد</button><button class="btn pt-ghost" :disabled="busy" @click="ret">إرجاع للتعديل</button></template>
          <button v-if="c.can.send" class="btn pt-glow" :disabled="busy" @click="send">إرسال للشريك للتوقيع ←</button>
          <button v-if="c.can.withdraw" class="btn pt-ghost" :disabled="busy" @click="withdraw">سحب للتعديل</button>
          <button v-if="c.can.manualSign" class="btn pt-ghost" :disabled="busy" @click="manual = { signerName: c.partner.contactName ?? '', signerTitle: c.partner.contactTitle ?? '', signedOn: today() }">تسجيل توقيع ورقي</button>
          <button v-if="c.can.renew" class="btn pt-glow" :disabled="busy" @click="renew">تجديد العقد</button>
          <button v-if="c.can.terminate" class="btn pt-ghost" :disabled="busy" @click="terminate">إنهاء</button>
          <button v-if="c.can.cancel" class="btn pt-ghost" :disabled="busy" @click="cancel">إلغاء</button>
          <button v-if="c.can.remove" class="btn pt-ghost" :disabled="busy" @click="removeDraft">حذف المسودة</button>
        </div>
      </section>
      <section v-if="supplyContracts.length" class="card pm-panel" style="margin-bottom: 14px; border-inline-start: 4px solid #b45309">
        <h2>عقود توريد مشتركة مع هذا الشريك</h2>
        <p class="pm-muted" style="font-size: .85rem; margin: 0 0 6px">الشريك مورد للجمعية أيضًا، وهذه عقود التوريد المرتبطة بهذه الشراكة في نظام المشتريات.</p>
        <ul style="margin: 0; padding-inline-start: 18px">
          <li v-for="k in supplyContracts" :key="k.id"><RouterLink :to="`/procurement/contracts/${k.id}`">{{ k.code }} · {{ k.title }}</RouterLink> · {{ k.statusLabel }} · {{ sar(k.value) }} (المستخدم {{ sar(k.used) }})</li>
        </ul>
      </section>

      <div v-if="!['cancelled', 'terminated'].includes(c.status)" class="pt-steps">
        <div v-for="([k, l], i) in STEPS" :key="k" :class="['pt-step', { done: i < stepIdx, cur: i === stepIdx }]"><i />{{ l }}</div>
      </div>
      <div v-if="c.status === 'changes_requested'" class="alert req"><b>طلب الشريك تعديلًا:</b> {{ c.changeRequest }}<br /><small>عدّل البنود أو البيانات ثم ارفعه للاعتماد من جديد، ويُرسل بإصدار جديد.</small></div>
      <div v-if="c.endReason" class="alert alert-error"><b>{{ c.status === 'cancelled' ? 'سبب الإلغاء' : 'سبب الإنهاء' }}:</b> {{ c.endReason }}</div>
      <div v-if="c.previous || c.renewals.length" class="alert soft">
        <template v-if="c.previous">هذا العقد تجديد للعقد <RouterLink :to="`/partnerships/contracts/${c.previous.id}`" class="pm-link pt-code">{{ c.previous.number }}</RouterLink>. </template>
        <template v-for="r in c.renewals" :key="r.id">جُدّد بالعقد <RouterLink :to="`/partnerships/contracts/${r.id}`" class="pm-link pt-code">{{ r.number }}</RouterLink>. </template>
      </div>
      <div v-if="signLink && !['cancelled', 'terminated'].includes(c.status)" class="card pm-panel sign-box">
        <div>
          <b>{{ c.status === 'signed' || c.status === 'expired' ? (c.signMethod === 'manual' ? 'وُقّع ورقيًا وسُجّل في النظام' : 'وقّعه الشريك إلكترونيًا') : 'رابط مراجعة العقد وتوقيعه للشريك' }}</b>
          <p v-if="c.signedAt" class="pm-muted" style="margin: 2px 0 0">{{ c.signerName }} ({{ c.signerTitle }}) · {{ fmtDateTime(c.signedAt) }}</p>
          <p v-else class="pm-muted" style="margin: 2px 0 0">أرسله إلى {{ c.partner.contactName ?? 'ممثل الشريك' }}{{ c.partner.email ? ` على ${c.partner.email}` : '' }}.<template v-if="c.partner.registrationNo"> يُطلب منه رقم السجل للتحقق.</template></p>
        </div>
        <div class="link"><code dir="ltr">{{ signLink }}</code><button class="btn btn-sm" @click="copyLink">نسخ</button></div>
      </div>

      <nav class="pm-tabs">
        <button v-if="c.can.edit" :class="['pm-tab', { on: tab === 'clauses' }]" @click="openTab('clauses')">البنود <b>{{ items.length }}</b></button>
        <button v-if="c.can.edit" :class="['pm-tab', { on: tab === 'terms' }]" @click="openTab('terms')">بيانات العقد</button>
        <button :class="['pm-tab', { on: tab === 'preview' }]" @click="openTab('preview')">{{ c.can.edit ? 'معاينة النص النهائي' : 'نص العقد' }}</button>
        <button :class="['pm-tab', { on: tab === 'followups' }]" @click="openTab('followups')">الالتزامات والمتابعة <b>{{ c.followups.filter((f: any) => !f.doneAt).length }}</b></button>
        <button :class="['pm-tab', { on: tab === 'versions' }]" @click="openTab('versions')">الإصدارات <b>{{ c.versions.length }}</b></button>
        <button :class="['pm-tab', { on: tab === 'log' }]" @click="openTab('log')">السجل</button>
      </nav>

      <!-- البنود مبوبة -->
      <div v-if="tab === 'clauses'" class="editor">
        <aside class="card toc">
          <h3>تبويب العقد</h3>
          <a v-for="g in filledGroups" :key="g.id" :href="`#cat-${g.id}`" :style="{ '--c': g.color }"><i />{{ g.name }}<b>{{ g.items.length }}</b></a>
          <div class="pt-sec">المتغيرات</div>
          <p class="pm-muted" style="margin-top: 0">اضغط داخل فقرة ثم اختر متغيرًا، ويُستبدل بقيمته عند الإرسال.</p>
          <button v-for="v in lk.variables" :key="v.key" class="var" :title="v.hint" @mousedown.prevent @click="insertVar(v.key)">{{ v.key }}</button>
        </aside>
        <div class="clauses">
          <section v-for="g in groups" :id="`cat-${g.id}`" :key="g.id" class="grp" :style="{ '--c': g.color }">
            <header class="grp-head"><span class="bullet" />{{ g.name }} <small class="pm-muted">{{ g.items.length }} بند</small>
              <button class="btn btn-sm" style="margin-inline-start: auto" @click="addCustom(g.id)">+ بند خاص</button></header>
            <TransitionGroup name="cl">
              <article v-for="(it, j) in g.items" :key="it.key" class="card clause">
                <header>
                  <span class="ord">البند {{ ORD[numberOf(it)] ?? numberOf(it) + 1 }}</span>
                  <input v-model="it.title" class="input title" @input="touch" />
                  <span v-if="it.mandatory" class="pt-chip" style="--c: #0369a1" title="بند إلزامي لا يُحذف">إلزامي</span>
                  <span v-if="!it.clauseId" class="pt-chip" style="--c: #7c3aed">خاص بهذا العقد</span>
                  <select v-model="it.categoryId" class="input cat" title="نقل البند إلى تبويب آخر" @change="touch"><option v-for="x in cats" :key="x.id" :value="x.id">{{ x.name }}</option></select>
                  <div class="tools">
                    <button class="icon" title="لأعلى" :disabled="j === 0" @click="move(it, -1)">▲</button>
                    <button class="icon" title="لأسفل" :disabled="j === g.items.length - 1" @click="move(it, 1)">▼</button>
                    <button v-if="!it.mandatory" class="icon danger" title="حذف البند" @click="remove(it)">✕</button>
                  </div>
                </header>
                <div v-for="(p, k) in it.paragraphs" :key="k" class="para">
                  <span class="pn">{{ numberOf(it) + 1 }}.{{ k + 1 }}</span>
                  <textarea v-model="it.paragraphs[k]" class="input" rows="2" @input="touch(); grow($event)" @focus="focusField($event, it, k)" />
                  <button class="icon danger" title="حذف الفقرة" @click="it.paragraphs.splice(k, 1); touch()">✕</button>
                </div>
                <button class="btn btn-sm add-para" @click="it.paragraphs.push(''); touch()">+ فقرة</button>
              </article>
            </TransitionGroup>
            <p v-if="!g.items.length" class="pm-muted empty-grp">لا توجد بنود في هذا التبويب</p>
          </section>
          <div class="card pm-panel add">
            <select v-model="addPick" class="input">
              <option value="">إضافة بند من المكتبة...</option>
              <optgroup v-for="cat in cats" :key="cat.id" :label="cat.name">
                <option v-for="l in missingLibrary.filter((x) => x.categoryId === cat.id)" :key="l.id" :value="l.id">{{ l.title }}{{ l.isDefault ? '' : ' (اختياري)' }}</option>
              </optgroup>
            </select>
            <button class="btn btn-primary" :disabled="!addPick" @click="addFromLibrary">إضافة</button>
          </div>
        </div>
      </div>

      <section v-else-if="tab === 'terms'" class="card pm-panel">
        <div class="pt-fields">
          <div class="field" style="grid-column: 1 / -1"><label>عنوان العقد</label><input v-model="terms.title" class="input" @input="touch" /></div>
          <div class="field"><label>تاريخ البداية</label><input v-model="terms.startsOn" type="date" class="input" @input="touch" /></div>
          <div class="field"><label>تاريخ النهاية</label><input v-model="terms.endsOn" type="date" class="input" @input="touch" /></div>
          <div class="field"><label>قيمة الشراكة (ريال)</label><input v-model.number="terms.value" type="number" min="0" step="0.01" class="input" @input="touch" /></div>
          <div class="field"><label>المشروع المرتبط</label><select v-model="terms.projectId" class="input" @change="touch"><option value="">بدون مشروع</option><option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option></select></div>
          <div class="field"><label>ممثل الجمعية في التوقيع</label><input v-model="terms.orgSignerName" class="input" @input="touch" /></div>
          <div class="field"><label>صفته</label><input v-model="terms.orgSignerTitle" class="input" @input="touch" /></div>
        </div>
        <p class="pm-muted">بيانات الشريك (الاسم والسجل وممثله) تُؤخذ من <RouterLink :to="`/partnerships/partners/${c.partnerId}`" class="pm-link">ملف الشريك</RouterLink>.</p>
        <button class="btn btn-primary" :disabled="busy || !dirty" @click="save()">حفظ البيانات</button>
      </section>

      <section v-else-if="tab === 'preview'">
        <div v-if="preview?.unknown.length" class="alert alert-error">متغيرات غير معروفة: {{ preview.unknown.join('، ') }}. صحّحها قبل الرفع.</div>
        <div class="print-bar"><button class="btn btn-sm" @click="printDoc">طباعة</button></div>
        <ContractDocument v-if="preview" heading="اتفاقية شراكة" :sub="docSub" :number="c.number" :rendered="preview.rendered" :hash="c.can.edit ? null : c.contentHash"
          :signature="c.signedAt ? { name: c.signerName, title: c.signerTitle, at: c.signedAt } : null" />
      </section>

      <section v-else-if="tab === 'followups'" class="card pm-panel">
        <form v-if="c.can.followups" class="fu-form" @submit.prevent="addFollowup">
          <input v-model="fu.title" class="input grow" placeholder="الالتزام أو الموعد (مثل: التقرير الربعي)" required minlength="3" />
          <select v-model="fu.kind" class="input"><option v-for="(l, k) in lk.followupKinds" :key="k" :value="k">{{ l }}</option></select>
          <select v-model="fu.party" class="input"><option value="org">على الجمعية</option><option value="partner">على الشريك</option></select>
          <input v-model="fu.dueDate" type="date" class="input" required />
          <input v-model="fu.responsible" class="input" placeholder="المكلف" />
          <button class="btn btn-primary">+ إضافة</button>
        </form>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>الالتزام</th><th>على</th><th>المكلف</th><th>الاستحقاق</th><th>الحالة</th><th /></tr></thead>
            <tbody>
              <tr v-for="f in c.followups" :key="f.id" :class="{ donerow: f.doneAt }">
                <td>{{ KIND_ICON[f.kind] }} <b>{{ f.title }}</b><span class="pm-muted">{{ f.kindLabel }}{{ f.note ? ` · ${f.note}` : '' }}</span></td>
                <td>{{ f.party === 'partner' ? 'الشريك' : 'الجمعية' }}</td><td>{{ f.responsible ?? '—' }}</td><td>{{ fmtDate(f.dueDate) }}</td>
                <td><span v-if="f.doneAt" class="pt-days ok">منجز {{ fmtDate(f.doneAt) }}</span><span v-else-if="f.overdue" class="pt-days late">متأخر {{ -f.daysLeft }} يوم</span><span v-else class="pt-days">بعد {{ f.daysLeft }} يوم</span></td>
                <td style="white-space: nowrap"><template v-if="c.can.followups">
                  <button class="btn btn-sm" @click="toggleDone(f)">{{ f.doneAt ? 'إعادة فتح' : '✓ تم' }}</button>
                  <button class="btn btn-sm btn-danger" @click="removeFollowup(f)">حذف</button></template></td>
              </tr>
              <tr v-if="!c.followups.length"><td colspan="6" class="pt-empty">سجّل التزامات العقد ومواعيده (الدفعات والتقارير والاجتماعات) لتصلك تنبيهاتها.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-else-if="tab === 'versions'" class="card pm-panel">
        <p class="pm-muted" style="margin-top: 0">كل إرسال للشريك يثبت نسخة من النص وبصمتها الرقمية، ويبقى محفوظًا للرجوع إليه.</p>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>الإصدار</th><th>تاريخ الإرسال</th><th>البنود</th><th>النتيجة</th><th>البصمة (SHA-256)</th><th /></tr></thead>
            <tbody>
              <tr v-for="v in [...c.versions].reverse()" :key="v.version">
                <td><b>{{ v.version }}</b></td><td>{{ fmtDateTime(v.sentAt) }}</td><td>{{ v.clauses }}</td><td>{{ v.outcome ?? 'بانتظار الشريك' }}</td>
                <td class="pt-code" style="font-size: .7rem">{{ v.hash.slice(0, 24) }}…</td><td><button class="btn btn-sm" @click="showVersion(v.version)">عرض النص</button></td>
              </tr>
              <tr v-if="!c.versions.length"><td colspan="6" class="pt-empty">لم يُرسل العقد للشريك بعد</td></tr>
            </tbody>
          </table>
        </div>
        <div v-if="version" style="margin-top: 14px">
          <div class="print-bar"><b>نص الإصدار {{ version.version }}</b><button class="btn btn-sm" @click="version = null">إغلاق</button></div>
          <ContractDocument heading="اتفاقية شراكة" :sub="`الإصدار ${version.version}`" :number="c.number" :rendered="version.rendered" :hash="version.hash" />
        </div>
      </section>

      <section v-else class="card pm-panel">
        <ul class="pt-log">
          <li v-for="(l, i) in c.log" :key="i"><b>{{ l.action }}</b> · {{ l.byName }}<small>{{ fmtDateTime(l.at) }}</small><small v-if="l.note">{{ l.note }}</small></li>
        </ul>
        <dl v-if="c.signerIp" class="pm-dl" style="margin-top: 14px"><dt>عنوان IP للموقّع</dt><dd class="pt-code" style="text-align: right">{{ c.signerIp }}</dd></dl>
      </section>
    </template>

    <div v-if="manual" class="modal-backdrop" @click.self="manual = null">
      <form class="card modal" @submit.prevent="doManual">
        <h2 style="margin-bottom: 6px">تسجيل توقيع الشريك</h2>
        <p class="pm-muted" style="margin-top: 0">لعقد وقّعه الشريك ورقيًا من النص المعتمد. يُثبَّت النص إصدارًا ويصبح العقد ساريًا.</p>
        <div class="field"><label>اسم الموقّع عن الشريك</label><input v-model="manual.signerName" class="input" required minlength="3" /></div>
        <div class="field"><label>صفته</label><input v-model="manual.signerTitle" class="input" required /></div>
        <div class="field"><label>تاريخ التوقيع</label><input v-model="manual.signedOn" type="date" class="input" required /></div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">تسجيل التوقيع</button><button type="button" class="btn" @click="manual = null">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.back { display: inline-block; margin-bottom: 10px; font-size: .9rem; }
.status { background: rgba(255,255,255,.92); }
.req { background: #fdf2f8; color: #9d174d; border: 1px solid #fbcfe8; }
.soft { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
.sign-box { display: grid; grid-template-columns: 1fr 1.3fr; gap: 12px; align-items: center; margin-bottom: 14px; }
.link { display: flex; gap: 8px; align-items: center; background: var(--surface-2); border-radius: 10px; padding: 6px 10px; min-width: 0; }
.link code { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .8rem; }
.editor { display: grid; grid-template-columns: 250px 1fr; gap: 16px; align-items: start; }
.toc { padding: 14px; position: sticky; top: 12px; max-height: calc(100vh - 40px); overflow-y: auto; }
.toc h3 { font-size: .95rem; }
.toc a { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; color: var(--text); font-size: .86rem; }
.toc a:hover { background: var(--surface-2); }
.toc a i { width: 10px; height: 10px; border-radius: 3px; background: var(--c); box-shadow: 0 0 8px var(--c); }
.toc a b { margin-inline-start: auto; font-size: .76rem; color: var(--muted); }
.var { display: block; width: 100%; text-align: right; border: 1px solid var(--border); background: var(--surface-2); border-radius: 8px; padding: 4px 9px; margin-bottom: 4px; font: inherit; font-size: .8rem; cursor: pointer; transition: all .15s; }
.var:hover { border-color: #f59e0b; background: #fffbeb; color: #b45309; }
.clauses { display: grid; gap: 14px; min-width: 0; }
.grp { scroll-margin-top: 12px; }
.grp-head { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--c); margin-bottom: 8px; padding-bottom: 6px; border-bottom: 2px solid color-mix(in srgb, var(--c) 30%, transparent); }
.bullet { width: 12px; height: 12px; border-radius: 4px; background: var(--c); box-shadow: 0 0 10px var(--c); }
.empty-grp { margin: 0 0 4px; font-size: .82rem; }
.clause { padding: 12px 14px; margin-bottom: 8px; border-inline-start: 3px solid var(--c); }
.clause header { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.ord { color: #b07d1e; font-weight: 700; white-space: nowrap; font-size: .88rem; }
.title { flex: 1; min-width: 160px; font-weight: 600; }
.cat { width: auto; max-width: 170px; font-size: .8rem; padding: 5px 8px; }
.tools { display: flex; gap: 4px; }
.icon { width: 30px; height: 30px; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; cursor: pointer; font-size: .75rem; color: var(--muted); }
.icon:hover:not(:disabled) { color: var(--primary); border-color: var(--primary); }
.icon.danger:hover { color: var(--danger); border-color: var(--danger); }
.icon:disabled { opacity: .35; cursor: default; }
.para { display: grid; grid-template-columns: 38px 1fr 30px; gap: 6px; align-items: start; margin-bottom: 6px; }
.pn { color: #a08a5a; font-size: .8rem; padding-top: 10px; }
.para textarea { resize: vertical; min-height: 44px; line-height: 1.7; }
.add-para { margin-inline-start: 44px; }
.add { display: flex; gap: 8px; flex-wrap: wrap; }
.add select { flex: 1; min-width: 220px; }
.print-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 8px; }
.fu-form { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.fu-form .input { width: auto; min-width: 130px; }
.fu-form .grow { flex: 1; min-width: 220px; }
.donerow { opacity: .6; }
.cl-move { transition: transform .35s var(--ease); }
.cl-enter-active, .cl-leave-active { transition: all .3s var(--ease); }
.cl-enter-from, .cl-leave-to { opacity: 0; transform: translateX(-16px); }
@media (max-width: 960px) { .editor { grid-template-columns: 1fr; } .toc { position: static; max-height: none; } .sign-box { grid-template-columns: 1fr; } }
@media print { .back, .pm-hero, .pt-steps, .pm-tabs, .print-bar, .alert, .sign-box { display: none !important; } }
</style>
