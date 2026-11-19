<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import ContractDocument from '../../../registration/ContractDocument.vue';
import { useToast } from '../../../stores/toast';
import ScreensPicker, { type Access } from '../components/ScreensPicker.vue';
import { CONTRACT_STATUS, copyText, CYCLES, fmtDate, fmtDateTime, HISTORY_STEP, money, uid, type ScreenModule } from '../labels';
import { waNumber } from '../siteLabels';
import '../platform.css';

interface Item { key: string; clauseId: string | null; title: string; paragraphs: string[]; mandatory: boolean }
interface Terms { price: number; billingCycle: string; vatRate: number; months: number; startsOn: string; screens: string[] | null; trialDays: number }
interface Contract {
  id: string; number: string; status: string; organizationId: string; organizationName: string; organizationSlug: string;
  terms: Terms; items: Item[]; rendered: { title: string; paragraphs: string[] }[] | null; contentHash: string | null;
  changeRequest: string | null; sentAt: string | null; signedAt: string | null; signerName: string | null; signerTitle: string | null;
  signerIp: string | null; history: { step: string; by: string; at: string; note?: string }[]; signPath: string | null;
  recipients: Recipient[];
}
interface Recipient { role: string; name: string; phone: string | null; email: string | null }
interface Clause { id: string; title: string; paragraphs: string[]; isMandatory: boolean; isActive: boolean }

const route = useRoute();
const toast = useToast();
const id = route.params.id as string;
const c = ref<Contract | null>(null);
const items = ref<Item[]>([]);
const terms = ref<Terms | null>(null);
const access = ref<Access>({ allScreens: true, screens: [], modules: [] });
const library = ref<Clause[]>([]);
const variables = ref<{ key: string; hint: string }[]>([]);
const catalog = ref<ScreenModule[]>([]);
const error = ref('');
const tab = ref<'clauses' | 'terms' | 'preview' | 'history'>('clauses');
const dirty = ref(false);
const busy = ref(false);

function apply(x: Contract) {
  c.value = x;
  items.value = x.items.map((i) => ({ ...i, paragraphs: [...i.paragraphs] }));
  terms.value = { ...x.terms };
  access.value = { allScreens: !x.terms.screens, screens: x.terms.screens ?? [], modules: [] };
  dirty.value = false;
  if (!editable.value && tab.value === 'clauses') tab.value = 'preview';
}
async function load() {
  try {
    const [x, lib, vars, screens] = await Promise.all([
      api<Contract>(`/platform/contracts/${id}`),
      api<Clause[]>('/platform/contract-clauses'),
      api<{ key: string; hint: string }[]>('/platform/contract-variables'),
      api<ScreenModule[]>('/platform/screens'),
    ]);
    library.value = lib;
    variables.value = vars;
    catalog.value = screens;
    apply(x);
    if (!editable.value) await loadPreview();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

const editable = computed(() => c.value?.status === 'draft' || c.value?.status === 'changes_requested');
const touch = () => (dirty.value = true);

// ---- تحرير البنود ----
function move(i: number, d: -1 | 1) {
  const j = i + d;
  if (j < 0 || j >= items.value.length) return;
  const arr = items.value;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  touch();
}
function remove(i: number) {
  if (!confirm(`حذف البند "${items.value[i].title}" من هذا العقد؟`)) return;
  items.value.splice(i, 1);
  touch();
}
const missingLibrary = computed(() => library.value.filter((l) => !items.value.some((i) => i.clauseId === l.id)));
const addPick = ref('');
function addFromLibrary() {
  const l = library.value.find((x) => x.id === addPick.value);
  if (!l) return;
  items.value.push({ key: uid(), clauseId: l.id, title: l.title, paragraphs: [...l.paragraphs], mandatory: l.isMandatory });
  addPick.value = '';
  touch();
}
function addCustom() {
  items.value.push({ key: uid(), clauseId: null, title: 'بند خاص', paragraphs: [''], mandatory: false });
  touch();
}
// إدراج متغير في آخر فقرة كان المؤشر فيها
let lastField: { el: HTMLTextAreaElement; item: Item; idx: number } | null = null;
function focusField(e: FocusEvent, item: Item, idx: number) {
  lastField = { el: e.target as HTMLTextAreaElement, item, idx };
}
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
  if (!terms.value) return;
  busy.value = true;
  try {
    const x = await api<Contract>(`/platform/contracts/${id}`, {
      method: 'PUT',
      json: { items: items.value, terms: { ...terms.value, allScreens: access.value.allScreens, screens: access.value.screens } },
    });
    apply(x);
    if (!silent) toast.success('تم حفظ العقد');
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  } finally {
    busy.value = false;
  }
}

// ---- المعاينة والإجراءات ----
const preview = ref<{ rendered: { title: string; paragraphs: string[] }[]; unknown: string[] } | null>(null);
async function loadPreview() {
  if (c.value?.rendered && !editable.value) {
    preview.value = { rendered: c.value.rendered, unknown: [] };
    return;
  }
  if (dirty.value && !(await save(true))) return;
  preview.value = await api(`/platform/contracts/${id}/preview`);
}
async function openTab(t: typeof tab.value) {
  tab.value = t;
  if (t === 'preview') await loadPreview().catch((e) => toast.error((e as Error).message));
}
async function action(path: string, ok: string, json?: unknown) {
  if (dirty.value && !(await save(true))) return;
  busy.value = true;
  try {
    const res = await api<Contract & { emailed?: string[] }>(`/platform/contracts/${id}/${path}`, { method: 'POST', json });
    apply(res);
    toast.success(res.emailed?.length ? `${ok}. وأُرسل الرابط بالبريد إلى: ${res.emailed.join('، ')}` : ok);
    if (!editable.value) await openTab('preview');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const send = () => confirm('اعتماد النص النهائي للعقد وتجهيز رابط التوقيع؟ لا يمكن تعديله بعدها إلا بسحبه.\n\nسيُرسل الرابط تلقائيًا بالبريد لجهات التواصل في الجمعية التي لها بريد، ويمكنك إرساله أيضًا عبر واتساب من الأزرار التي ستظهر.')
  && action('send', 'رابط التوقيع جاهز');
async function emailAgain() {
  busy.value = true;
  try {
    const r = await api<{ emailed: string[] }>(`/platform/contracts/${id}/email`, { method: 'POST' });
    if (r.emailed.length) toast.success(`أُرسل الرابط بالبريد إلى: ${r.emailed.join('، ')}`);
    else toast.error('لم يُرسل البريد. تأكد من ضبط البريد في «البريد الإلكتروني» بإدارة المنصة، ومن وجود بريد لجهات التواصل');
    apply(await api<Contract>(`/platform/contracts/${id}`));
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const withdraw = () => action('withdraw', 'تم سحب العقد وإعادته مسودة');
function cancel() {
  const note = prompt('سبب إلغاء العقد:');
  if (note && note.trim().length >= 3) action('cancel', 'تم إلغاء العقد', { note });
}
const signLink = computed(() => (c.value?.signPath ? `${location.origin}${c.value.signPath}` : ''));
const copyLink = () => { copyText(signLink.value); toast.success('تم نسخ رابط التوقيع'); };
const inviteText = (r?: Recipient) => `السلام عليكم${r?.name ? ` ${r.name}` : ''}،
أرسلت إدارة منصة سنابل عقد الاشتراك رقم ${c.value?.number} الخاص بـ${c.value?.organizationName}.
لمراجعة العقد وتوقيعه إلكترونيًا افتحوا الرابط التالي:
${signLink.value}
سيُطلب منكم رقم ترخيص الجمعية للتحقق.`;
const waHref = (r: Recipient) => `https://wa.me/${waNumber(r.phone!)}?text=${encodeURIComponent(inviteText(r))}`;
const mailHref = (r: Recipient) => `mailto:${r.email}?subject=${encodeURIComponent(`عقد الاشتراك ${c.value?.number} - منصة سنابل`)}&body=${encodeURIComponent(inviteText(r))}`;
const copyMessage = () => { copyText(inviteText()); toast.success('تم نسخ الرسالة مع الرابط'); };

const amounts = computed(() => {
  const t = terms.value;
  if (!t) return null;
  const cycle = CYCLES.find((x) => x.value === t.billingCycle)!;
  const vat = Math.round(t.price * t.vatRate) / 100;
  const cycles = Math.ceil(t.months / cycle.months);
  return { vat, gross: t.price + vat, total: (t.price + vat) * cycles, cycles };
});
const ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر', 'السادس عشر', 'السابع عشر', 'الثامن عشر', 'التاسع عشر', 'العشرون'];
</script>

<template>
  <div>
    <RouterLink to="/platform/contracts" class="back">→ العقود</RouterLink>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="c && terms">
      <section class="p-hero">
        <div>
          <p class="p-kicker">عقد اشتراك إلكتروني · <span dir="ltr">{{ c.number }}</span></p>
          <h1>{{ c.organizationName }}</h1>
          <p class="p-sub">{{ money(terms.price) }} لكل دورة {{ CYCLES.find((x) => x.value === terms!.billingCycle)?.label }} · {{ terms.months }} شهرًا من {{ fmtDate(terms.startsOn) }}</p>
        </div>
        <div class="actions">
          <span :class="['tone', `tone-${CONTRACT_STATUS[c.status].tone}`]">{{ CONTRACT_STATUS[c.status].label }}</span>
          <template v-if="editable">
            <button class="btn btn-ghost-light" :disabled="busy || !dirty" @click="save()">{{ dirty ? 'حفظ التعديلات' : 'محفوظ' }}</button>
            <button class="btn btn-gold" :disabled="busy" @click="send">اعتماد وتجهيز رابط التوقيع ←</button>
          </template>
          <button v-if="c.status === 'sent'" class="btn btn-ghost-light" :disabled="busy" @click="withdraw">سحب للتعديل</button>
          <button v-if="['draft', 'sent', 'changes_requested'].includes(c.status)" class="btn btn-ghost-light" :disabled="busy" @click="cancel">إلغاء العقد</button>
          <RouterLink :to="`/platform/organizations/${c.organizationId}`" class="btn btn-ghost-light">ملف الجمعية</RouterLink>
        </div>
      </section>

      <div v-if="c.status === 'changes_requested'" class="alert req">
        <b>طلبت الجمعية تعديلًا:</b> {{ c.changeRequest }}<br /><small>عدّل البنود أو الشروط ثم أعد الإرسال.</small>
      </div>
      <div v-if="signLink && c.status !== 'cancelled'" class="card p-panel sign-box">
        <div>
          <b>{{ c.status === 'signed' ? 'تم التوقيع إلكترونيًا' : 'رابط مراجعة العقد وتوقيعه للجمعية' }}</b>
          <p v-if="c.status === 'signed'" class="muted">{{ c.signerName }} ({{ c.signerTitle }}) · {{ fmtDateTime(c.signedAt) }}</p>
          <p v-else class="muted">يُرسل الرابط بالبريد تلقائيًا عند الاعتماد لجهات التواصل التي لها بريد. يمكنك إعادة إرساله بالبريد أو إرساله عبر واتساب من هنا، ويظهر للجمعية كذلك في صفحة متابعة طلب الاشتراك.</p>
        </div>
        <div class="p-link-box"><code>{{ signLink }}</code><button class="btn btn-sm" @click="copyLink">نسخ</button></div>
        <div v-if="c.status !== 'signed'" class="send-to">
          <b>إرسال الرابط للجمعية</b>
          <div v-for="r in c.recipients" :key="r.role" class="send-row">
            <span><small class="muted">{{ r.role }}</small> {{ r.name }}</span>
            <span class="send-btns">
              <a v-if="r.phone" class="btn btn-sm btn-wa" :href="waHref(r)" target="_blank" rel="noopener">واتساب <span dir="ltr">{{ r.phone }}</span></a>
              <a v-if="r.email" class="btn btn-sm" :href="mailHref(r)" title="فتح برنامج البريد على جهازك"><span dir="ltr">{{ r.email }}</span></a>
            </span>
          </div>
          <p v-if="!c.recipients.length" class="muted">لا توجد بيانات تواصل محفوظة لهذه الجمعية، فانسخ الرسالة وأرسلها بالطريقة المناسبة.</p>
          <div class="send-btns">
            <button v-if="c.status === 'sent' && c.recipients.some((r) => r.email)" class="btn btn-sm btn-primary" :disabled="busy" @click="emailAgain">إعادة إرسال الرابط بالبريد من سنابل</button>
            <button class="btn btn-sm" @click="copyMessage">نسخ رسالة جاهزة مع الرابط</button>
          </div>
        </div>
      </div>

      <nav class="p-tabs">
        <button v-if="editable" :class="['p-tab', { on: tab === 'clauses' }]" @click="openTab('clauses')">البنود ({{ items.length }})</button>
        <button v-if="editable" :class="['p-tab', { on: tab === 'terms' }]" @click="openTab('terms')">الشروط المالية والشاشات</button>
        <button :class="['p-tab', { on: tab === 'preview' }]" @click="openTab('preview')">{{ editable ? 'معاينة النص النهائي' : 'نص العقد' }}</button>
        <button :class="['p-tab', { on: tab === 'history' }]" @click="openTab('history')">سجل الإجراءات</button>
      </nav>

      <div v-if="tab === 'clauses'" class="editor">
        <div class="clauses">
          <TransitionGroup name="cl">
            <article v-for="(it, i) in items" :key="it.key" class="card clause">
              <header>
                <span class="ord">البند {{ ORD[i] ?? i + 1 }}</span>
                <input v-model="it.title" class="input title" @input="touch" />
                <span v-if="it.mandatory" class="tone tone-info" title="بند إلزامي لا يمكن حذفه">إلزامي</span>
                <span v-if="!it.clauseId" class="tone tone-muted">خاص بهذا العقد</span>
                <div class="tools">
                  <button class="icon" title="لأعلى" :disabled="i === 0" @click="move(i, -1)">▲</button>
                  <button class="icon" title="لأسفل" :disabled="i === items.length - 1" @click="move(i, 1)">▼</button>
                  <button v-if="!it.mandatory" class="icon danger" title="حذف البند" @click="remove(i)">✕</button>
                </div>
              </header>
              <div v-for="(p, j) in it.paragraphs" :key="j" class="para">
                <span class="pn">{{ i + 1 }}.{{ j + 1 }}</span>
                <textarea v-model="it.paragraphs[j]" class="input" rows="2" @input="touch(); grow($event)" @focus="focusField($event, it, j)" />
                <button class="icon danger" title="حذف الفقرة" @click="it.paragraphs.splice(j, 1); touch()">✕</button>
              </div>
              <button class="btn btn-sm add-para" @click="it.paragraphs.push(''); touch()">+ فقرة</button>
            </article>
          </TransitionGroup>
          <div class="card p-panel add">
            <select v-model="addPick" class="input">
              <option value="">إضافة بند من المكتبة...</option>
              <option v-for="l in missingLibrary" :key="l.id" :value="l.id">{{ l.title }}</option>
            </select>
            <button class="btn" :disabled="!addPick" @click="addFromLibrary">إضافة</button>
            <button class="btn" @click="addCustom">+ بند خاص بهذا العقد</button>
          </div>
        </div>
        <aside class="card vars">
          <h3>المتغيرات</h3>
          <p class="muted small">اضغط داخل فقرة ثم اختر متغيرًا لإدراجه. تُستبدل بالقيم الفعلية عند الإرسال.</p>
          <button v-for="v in variables" :key="v.key" class="var" :title="v.hint" @mousedown.prevent @click="insertVar(v.key)">{{ v.key }}</button>
        </aside>
      </div>

      <section v-else-if="tab === 'terms'" class="card p-panel">
        <div class="p-row-2">
          <div class="field"><label>قيمة الاشتراك لكل دورة (ريال، قبل الضريبة)</label><input v-model.number="terms.price" class="input" type="number" min="0" step="0.01" @input="touch" /></div>
          <div class="field"><label>دورة السداد</label><select v-model="terms.billingCycle" class="input" @change="touch"><option v-for="x in CYCLES" :key="x.value" :value="x.value">{{ x.label }}</option></select></div>
          <div class="field"><label>نسبة ضريبة القيمة المضافة %</label><input v-model.number="terms.vatRate" class="input" type="number" min="0" max="100" @input="touch" /></div>
          <div class="field"><label>مدة العقد (بالأشهر)</label><input v-model.number="terms.months" class="input" type="number" min="1" max="60" @input="touch" /></div>
          <div class="field"><label>بداية الاشتراك</label><input v-model="terms.startsOn" class="input" type="date" @input="touch" /></div>
          <div class="field"><label>أيام الفترة التجريبية (تظهر في نص العقد)</label><input v-model.number="terms.trialDays" class="input" type="number" min="0" max="180" @input="touch" /></div>
        </div>
        <div v-if="amounts" class="sum">
          <div><span>الضريبة</span><b>{{ money(amounts.vat) }}</b></div>
          <div><span>لكل دورة شامل الضريبة</span><b>{{ money(amounts.gross) }}</b></div>
          <div><span>إجمالي العقد ({{ amounts.cycles }} دفعة)</span><b>{{ money(amounts.total) }}</b></div>
        </div>
        <h3 style="margin: 18px 0 10px; font-size: 1rem">الشاشات المشمولة بالعقد</h3>
        <p class="muted small" style="margin-top: -6px">تُطبَّق على الجمعية تلقائيًا عند توقيع العقد.</p>
        <ScreensPicker :model-value="access" :catalog="catalog.map((m) => ({ ...m, optional: false }))" @update:model-value="access = $event; touch()" />
        <button class="btn btn-primary" style="margin-top: 14px" :disabled="busy || !dirty" @click="save()">حفظ الشروط</button>
      </section>

      <section v-else-if="tab === 'preview'">
        <div v-if="preview?.unknown.length" class="alert alert-error">متغيرات غير معروفة: {{ preview.unknown.join('، ') }}. صحّحها قبل الإرسال.</div>
        <ContractDocument v-if="preview" :number="c.number" :rendered="preview.rendered" :hash="c.contentHash"
          :signature="c.signedAt ? { name: c.signerName, title: c.signerTitle, at: c.signedAt } : null" />
      </section>

      <section v-else class="card p-panel">
        <ul class="p-timeline">
          <li v-for="(h, i) in c.history" :key="i"><b>{{ HISTORY_STEP[h.step] ?? h.step }}</b> · {{ h.by }}<small>{{ fmtDateTime(h.at) }}</small><small v-if="h.note">{{ h.note }}</small></li>
        </ul>
        <dl v-if="c.contentHash" class="p-dl" style="margin-top: 14px">
          <dt>بصمة النص (SHA-256)</dt><dd dir="ltr" style="font-size: .78rem">{{ c.contentHash }}</dd>
          <dt v-if="c.signerIp">عنوان IP للموقّع</dt><dd v-if="c.signerIp" dir="ltr" style="text-align: right">{{ c.signerIp }}</dd>
        </dl>
      </section>
    </template>
  </div>
</template>

<style scoped>
.back { display: inline-block; margin-bottom: 10px; font-size: .9rem; }
.actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.req { background: #e8f0ff; color: #1e3a8a; }
.sign-box { display: grid; grid-template-columns: 1fr 1.3fr; gap: 12px; align-items: center; }
.sign-box p { margin: 2px 0 0; font-size: .88rem; }
.sign-box .p-link-box { margin: 0; }
.send-to { grid-column: 1 / -1; display: grid; gap: 8px; border-top: 1px dashed var(--border); padding-top: 10px; }
.send-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.send-btns { display: flex; gap: 6px; flex-wrap: wrap; }
.send-to > .btn { justify-self: start; }
.btn-wa { background: #25d366; color: #fff; border-color: #25d366; }
@media (max-width: 700px) { .sign-box { grid-template-columns: 1fr; } }
.editor { display: grid; grid-template-columns: 1fr 240px; gap: 16px; align-items: start; }
.clauses { display: grid; gap: 12px; }
.clause { padding: 14px 16px; }
.clause header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.ord { color: #b07d1e; font-weight: 700; white-space: nowrap; }
.title { flex: 1; min-width: 180px; font-weight: 600; }
.tools { display: flex; gap: 4px; }
.icon { width: 30px; height: 30px; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; cursor: pointer; font-size: .75rem; color: var(--muted); }
.icon:hover:not(:disabled) { color: var(--primary); border-color: var(--primary); }
.icon.danger:hover { color: var(--danger); border-color: var(--danger); }
.icon:disabled { opacity: .35; cursor: default; }
.para { display: grid; grid-template-columns: 34px 1fr 30px; gap: 6px; align-items: start; margin-bottom: 6px; }
.pn { color: #a08a5a; font-size: .82rem; padding-top: 10px; }
.para textarea { resize: vertical; min-height: 44px; line-height: 1.7; }
.add-para { margin-inline-start: 40px; }
.add { display: flex; gap: 8px; flex-wrap: wrap; }
.add select { flex: 1; min-width: 200px; }
.vars { padding: 14px; position: sticky; top: 12px; max-height: calc(100vh - 40px); overflow-y: auto; }
.vars h3 { font-size: .95rem; }
.small { font-size: .84rem; }
.var { display: block; width: 100%; text-align: right; border: 1px solid var(--border); background: var(--surface-2); border-radius: 8px; padding: 5px 10px; margin-bottom: 5px; font: inherit; font-size: .84rem; cursor: pointer; transition: all .15s; }
.var:hover { border-color: var(--primary); background: var(--primary-soft); color: var(--primary); }
.sum { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.sum div { background: var(--primary-soft); border-radius: 10px; padding: 8px 12px; display: flex; flex-direction: column; }
.sum span { font-size: .8rem; color: var(--muted); }
.sum b { color: var(--primary); }
.cl-move { transition: transform .35s var(--ease); }
.cl-enter-active, .cl-leave-active { transition: all .3s var(--ease); }
.cl-enter-from, .cl-leave-to { opacity: 0; transform: translateX(-16px); }
@media (max-width: 900px) { .editor { grid-template-columns: 1fr; } .vars { position: static; max-height: none; } .sign-box { grid-template-columns: 1fr; } .sum { grid-template-columns: 1fr; } }
</style>
