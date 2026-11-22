<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { DOC_TYPES, ISO_CLAUSES, P, STATUS_COLOR, errMsg, fmtDate, loadSettings, type DocRow, type QSettings } from '../lib';
import '../../../shared/module.css';
import '../quality.css';

interface Section { title: string; body: string }
interface Copy { copyNo: number; holder: string; revision: number; issuedAt: string; acknowledgedAt: string | null; withdrawnAt: string | null }
interface Rev { id: string; revision: number; revisionLabel: string; title: string; sections: Section[]; changeSummary: string | null; reviewedByName: string | null; approvedByName: string; effectiveDate: string; supersededAt: string | null }
interface Doc extends DocRow {
  sections: Section[]; relatedCodes: string[]; retention: string | null; changeSummary: string | null; createdByName: string; distribution: Copy[]; revision: number;
  history: { action: string; actionLabel: string; byName: string; at: string; note: string | null; revisionLabel: string | null }[];
  revisions: Rev[]; maps: { id: string; code: string; title: string }[]; related: { id: string; code: string; title: string; path: string; status: string }[];
  referencedBy: { id: string; code: string; title: string; path: string }[]; canEdit: boolean;
}
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const router = useRouter();
const doc = ref<Doc | null>(null);
const settings = ref<QSettings | null>(null);
const tab = ref<'content' | 'revisions' | 'distribution' | 'history' | 'links'>('content');
const editing = ref(false);
const viewRev = ref<Rev | null>(null);
const form = reactive({ title: '', docType: '', department: '', code: '', ownerName: '', isoClauses: [] as string[], sections: [] as Section[], relatedCodes: '', retention: '', changeSummary: '' });

async function load() {
  doc.value = await api<Doc>(`/quality/documents/${props.id}`);
}
onMounted(async () => {
  settings.value = await loadSettings();
  await load();
});
function startEdit() {
  const d = doc.value!;
  Object.assign(form, {
    title: d.title, docType: d.docType, department: d.department, code: d.code, ownerName: d.ownerName ?? '', isoClauses: [...d.isoClauses],
    sections: d.sections.map((s) => ({ ...s })), relatedCodes: d.relatedCodes.join('، '), retention: d.retention ?? '', changeSummary: d.changeSummary ?? '',
  });
  editing.value = true;
}
async function save() {
  try {
    doc.value = await api<Doc>(`/quality/documents/${props.id}`, {
      method: 'PUT', json: {
        title: form.title, docType: form.docType, department: form.department, code: form.code || null, ownerName: form.ownerName || null, isoClauses: form.isoClauses,
        sections: form.sections.filter((s) => s.title.trim()), relatedCodes: form.relatedCodes.split(/[،,\s]+/).map((c) => c.trim()).filter(Boolean),
        retention: form.retention || null, changeSummary: form.changeSummary || null,
      },
    });
    editing.value = false;
    toast.success('حُفظت المسودة');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
const ACTIONS: Record<string, { label: string; ask?: string; done: string }> = {
  submit: { label: 'رفع لمراجعة الجودة', done: 'رُفعت الوثيقة لمراجعة الجودة' },
  pass: { label: 'اجتازت مراجعة الجودة', done: 'أُحيلت الوثيقة للاعتماد' },
  return: { label: 'إعادة للتعديل', ask: 'سبب الإعادة', done: 'أعيدت الوثيقة لمالكها' },
  approve: { label: 'اعتماد وإصدار', done: 'اعتُمدت الوثيقة وأصبحت سارية' },
  revise: { label: 'إصدار جديد', ask: 'ملخص التغيير المطلوب في الإصدار الجديد', done: 'بدأ إصدار جديد، والإصدار الحالي يبقى ساريًا حتى اعتماده' },
  obsolete: { label: 'إلغاء الوثيقة', ask: 'سبب الإلغاء (تُسحب كل النسخ الموزعة)', done: 'أُلغيت الوثيقة وسُحبت نسخها' },
};
async function act(action: string) {
  const a = ACTIONS[action];
  let note: string | null = null;
  if (a.ask) {
    note = prompt(a.ask);
    if (!note) return;
  } else if (action === 'approve' && !confirm('اعتماد الوثيقة؟ سيُسحب الإصدار السابق ونسخه الموزعة تلقائيًا.')) return;
  try {
    doc.value = await api<Doc>(`/quality/documents/${props.id}/action`, { method: 'POST', json: { action, note } });
    toast.success(a.done);
  } catch (e) {
    toast.error(errMsg(e));
  }
}
const available = computed(() => {
  const d = doc.value;
  if (!d) return [];
  const can = (p: string) => session.can(p);
  const list: string[] = [];
  if (d.status === 'draft' && can(P.documents)) list.push('submit');
  if (d.status === 'review' && can(P.reviewDocs)) list.push('pass', 'return');
  if (d.status === 'approval' && can(P.approveDocs)) list.push('approve', 'return');
  if (d.status === 'approved' && can(P.documents)) list.push('revise');
  if (d.status !== 'obsolete' && d.approvedRevision !== null && can(P.approveDocs)) list.push('obsolete');
  return list;
});
const holders = ref('');
async function distribute() {
  try {
    doc.value = await api<Doc>(`/quality/documents/${props.id}/distribute`, { method: 'POST', json: { holders: holders.value.split(/[،,\n]+/).map((h) => h.trim()).filter(Boolean) } });
    holders.value = '';
    toast.success('وُزعت النسخ المضبوطة');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
async function ack(c: Copy) {
  try {
    doc.value = await api<Doc>(`/quality/documents/${props.id}/copies/${c.copyNo}/acknowledge`, { method: 'POST' });
    toast.success('سُجل تأكيد الاستلام');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
async function remove() {
  if (!confirm('حذف هذه المسودة نهائيًا؟')) return;
  try {
    await api(`/quality/documents/${props.id}`, { method: 'DELETE' });
    router.push('/quality/documents');
  } catch (e) {
    toast.error(errMsg(e));
  }
}
const printPage = () => window.print();
const current = computed(() => doc.value?.revisions.find((r) => !r.supersededAt) ?? null);
const stepIdx = computed(() => ({ draft: 1, review: 2, approval: 3, approved: 4, obsolete: 4 })[doc.value?.status ?? 'draft'] ?? 1);
function toggleClause(c: string) {
  const i = form.isoClauses.indexOf(c);
  if (i >= 0) form.isoClauses.splice(i, 1);
  else form.isoClauses.push(c);
}
</script>

<template>
  <div v-if="doc">
    <section class="pm-hero q-hero no-print">
      <div>
        <p class="pm-kicker"><span class="q-code" style="background: rgba(255,255,255,.12); color: #fcd34d">{{ doc.code }}</span> · {{ doc.typeLabel }} · {{ doc.departmentName }}</p>
        <h1>{{ doc.title }}</h1>
        <p class="pm-sub">الإصدار الساري <b>{{ doc.revisionLabel }}</b><template v-if="doc.workingRevision"> · قيد الإعداد {{ doc.workingRevision }}</template> · {{ doc.statusLabel }}</p>
      </div>
      <div class="pm-actions">
        <button v-if="doc.canEdit && !editing" class="btn q-ghost" @click="startEdit">تعديل المسودة</button>
        <button v-for="a in available" :key="a" :class="['btn', a === 'approve' || a === 'pass' || a === 'submit' ? 'q-glow' : 'q-ghost']" @click="act(a)">{{ ACTIONS[a].label }}</button>
        <RouterLink v-for="m in doc.maps" :key="m.id" :to="`/quality/maps/${m.id}`" class="btn q-ghost">خريطة الإجراء</RouterLink>
        <button class="btn q-ghost" @click="printPage">طباعة</button>
      </div>
    </section>

    <div class="q-steps no-print">
      <div data-n="1" :class="{ done: stepIdx >= 1, cur: stepIdx === 1 }">مسودة</div>
      <div data-n="2" :class="{ done: stepIdx >= 2, cur: stepIdx === 2 }">مراجعة الجودة</div>
      <div data-n="3" :class="{ done: stepIdx >= 3, cur: stepIdx === 3 }">الاعتماد</div>
      <div data-n="4" :class="{ done: stepIdx >= 4 }">{{ doc.status === 'obsolete' ? 'ملغاة' : 'سارية وموزعة' }}</div>
    </div>
    <div v-if="doc.status === 'obsolete'" class="q-warn">هذه الوثيقة ملغاة ومحفوظة للأرشيف فقط، ولا يجوز استخدامها.</div>
    <div v-else-if="doc.workingRevision && current" class="q-info">يُعد الآن الإصدار {{ doc.workingRevision }} ({{ doc.changeSummary }}). الإصدار الساري للعمل به هو {{ doc.revisionLabel }} حتى اعتماد الجديد.</div>

    <div class="q-tabs no-print">
      <button :class="['q-tab', { on: tab === 'content' }]" @click="tab = 'content'">المحتوى</button>
      <button :class="['q-tab', { on: tab === 'revisions' }]" @click="tab = 'revisions'">الإصدارات <b>{{ doc.revisions.length }}</b></button>
      <button :class="['q-tab', { on: tab === 'distribution' }]" @click="tab = 'distribution'">التوزيع <b>{{ doc.copies }}</b></button>
      <button :class="['q-tab', { on: tab === 'links' }]" @click="tab = 'links'">الوثائق المرتبطة <b>{{ doc.related.length + doc.referencedBy.length }}</b></button>
      <button :class="['q-tab', { on: tab === 'history' }]" @click="tab = 'history'">سجل الاعتماد</button>
    </div>

    <template v-if="tab === 'content'">
      <section v-if="editing" class="card pm-panel">
        <h2>تعديل المسودة <span class="q-rev">Rev.{{ String(doc.revision).padStart(2, '0') }}</span></h2>
        <div class="pm-grid2">
          <label class="field"><span>العنوان</span><input v-model="form.title" class="input" /></label>
          <label class="field"><span>الكود</span><input v-model="form.code" class="input" dir="ltr" :disabled="doc.approvedRevision !== null" /></label>
        </div>
        <div class="q-fields">
          <label class="field"><span>النوع</span><select v-model="form.docType" class="input"><option v-for="t in DOC_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option></select></label>
          <label class="field"><span>الإدارة</span><select v-model="form.department" class="input"><option v-for="d in settings?.departments" :key="d.code" :value="d.code">{{ d.code }} · {{ d.name }}</option></select></label>
          <label class="field"><span>الجهة المالكة</span><input v-model="form.ownerName" class="input" /></label>
          <label class="field"><span>مدة الحفظ ومكانه (للسجلات)</span><input v-model="form.retention" class="input" /></label>
        </div>
        <div class="field"><span>بنود المواصفة</span>
          <div class="q-chips"><button v-for="c in ISO_CLAUSES" :key="c" type="button" :class="['q-chip', { on: form.isoClauses.includes(c) }]" @click="toggleClause(c)">{{ c }}</button></div>
        </div>
        <label class="field"><span>الوثائق المرتبطة (أكواد مفصولة بفاصلة)</span><input v-model="form.relatedCodes" class="input" dir="ltr" placeholder="QF-QMS-01, QP-QMS-03" /></label>
        <label class="field"><span>ملخص التغيير في هذا الإصدار</span><input v-model="form.changeSummary" class="input" /></label>
        <p class="q-sec">أقسام الوثيقة</p>
        <div v-for="(s, i) in form.sections" :key="i" class="card" style="padding: 12px; margin-bottom: 10px">
          <div style="display: flex; gap: 6px; margin-bottom: 6px">
            <input v-model="s.title" class="input" style="font-weight: 700" />
            <button class="btn btn-sm" :disabled="i === 0" @click="form.sections.splice(i - 1, 0, form.sections.splice(i, 1)[0])">▲</button>
            <button class="btn btn-sm" @click="form.sections.splice(i, 1)">✕</button>
          </div>
          <textarea v-model="s.body" class="input" rows="5" />
        </div>
        <button class="btn btn-sm" @click="form.sections.push({ title: 'قسم جديد', body: '' })">+ قسم</button>
        <div class="modal-actions">
          <button class="btn btn-primary" @click="save">حفظ المسودة</button><button class="btn" @click="editing = false">إلغاء</button>
          <button v-if="doc.approvedRevision === null" class="btn" style="color: var(--danger); margin-inline-start: auto" @click="remove">حذف المسودة</button>
        </div>
      </section>
      <div v-else class="q-paper">
        <div class="q-paper-head">
          <div><div class="pm-muted">الكود</div><b class="q-code">{{ doc.code }}</b></div>
          <div class="t">{{ doc.title }}</div>
          <div><div class="pm-muted">الإصدار</div><b class="q-rev" style="font-size: .9rem; color: var(--text)">{{ doc.workingRevision ?? doc.revisionLabel }}</b>
            <div style="margin-top: 4px"><span class="q-stamp" :style="{ '--c': STATUS_COLOR[doc.status] }">{{ doc.status === 'approved' ? 'نسخة مضبوطة' : doc.statusLabel }}</span></div></div>
        </div>
        <div class="q-paper-body">
          <template v-for="(s, i) in doc.sections" :key="i"><h3>{{ s.title }}</h3><p class="q-pre">{{ s.body || '—' }}</p></template>
          <template v-if="doc.retention"><h3>الحفظ</h3><p>{{ doc.retention }}</p></template>
        </div>
        <div class="q-paper-foot">
          <div>تاريخ السريان: <b>{{ fmtDate(doc.effectiveDate) }}</b></div>
          <div>المراجعة القادمة: <b :style="{ color: doc.reviewOverdue ? 'var(--danger)' : '' }">{{ fmtDate(doc.nextReviewDate) }}</b></div>
          <div>البنود: <span v-for="c in doc.isoClauses" :key="c" class="pm-tag" style="margin-inline-end: 3px">{{ c }}</span></div>
        </div>
        <div class="q-paper-foot">
          <div>الإعداد: <b>{{ doc.createdByName }}</b></div>
          <div>المراجعة: <b>{{ current?.reviewedByName ?? '—' }}</b></div>
          <div>الاعتماد: <b>{{ current?.approvedByName ?? '—' }}</b></div>
        </div>
      </div>
    </template>

    <section v-else-if="tab === 'revisions'" class="card pm-panel">
      <h2>سجل الإصدارات</h2>
      <p class="pm-muted">كل إصدار معتمد يُحفظ كما هو. عند اعتماد إصدار أحدث يُعلَّم السابق ملغى ويُسحب من التداول.</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الإصدار</th><th>ملخص التغيير</th><th>المراجعة</th><th>الاعتماد</th><th>السريان</th><th>الحالة</th><th /></tr></thead>
        <tbody>
          <tr v-for="r in doc.revisions" :key="r.id">
            <td><span class="q-rev" style="font-weight: 700; color: var(--text)">{{ r.revisionLabel }}</span></td>
            <td>{{ r.changeSummary ?? '—' }}</td><td>{{ r.reviewedByName ?? '—' }}</td><td>{{ r.approvedByName }}</td><td class="q-num">{{ fmtDate(r.effectiveDate) }}</td>
            <td><span class="pm-pill" :style="{ '--c': r.supersededAt ? '#ef4444' : '#10b981' }">{{ r.supersededAt ? `ملغى منذ ${fmtDate(r.supersededAt)}` : 'ساري' }}</span></td>
            <td><button class="btn btn-sm" @click="viewRev = r">عرض</button></td>
          </tr>
          <tr v-if="!doc.revisions.length"><td colspan="7" class="pm-empty">لم يُعتمد أي إصدار بعد</td></tr>
        </tbody>
      </table></div>
    </section>

    <section v-else-if="tab === 'distribution'" class="card pm-panel">
      <h2>التوزيع المضبوط للنسخ</h2>
      <p class="pm-muted">كل نسخة مرقمة باسم الجهة المستلمة. عند صدور إصدار جديد تُسحب النسخ القديمة تلقائيًا وتُعاد للجهات نفسها بالإصدار الجديد.</p>
      <div v-if="doc.status === 'approved' && session.can(P.documents)" class="q-toolbar">
        <input v-model="holders" class="input grow" placeholder="الجهات المستلمة مفصولة بفاصلة، مثل: إدارة البرامج، الإدارة المالية" />
        <button class="btn btn-primary" :disabled="!holders.trim()" @click="distribute">توزيع</button>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>رقم النسخة</th><th>الجهة</th><th>الإصدار</th><th>تاريخ التسليم</th><th>تأكيد الاستلام</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="c in [...doc.distribution].reverse()" :key="c.copyNo" :style="{ opacity: c.withdrawnAt ? .55 : 1 }">
            <td class="q-num">{{ c.copyNo }}</td><td><b>{{ c.holder }}</b></td><td class="q-rev">Rev.{{ String(c.revision).padStart(2, '0') }}</td><td>{{ fmtDate(c.issuedAt) }}</td>
            <td><template v-if="c.acknowledgedAt">✓ {{ fmtDate(c.acknowledgedAt) }}</template><button v-else-if="!c.withdrawnAt" class="btn btn-sm" @click="ack(c)">تأكيد الاستلام</button><template v-else>—</template></td>
            <td><span class="pm-pill" :style="{ '--c': c.withdrawnAt ? '#ef4444' : '#10b981' }">{{ c.withdrawnAt ? `مسحوبة ${fmtDate(c.withdrawnAt)}` : 'سارية' }}</span></td>
          </tr>
          <tr v-if="!doc.distribution.length"><td colspan="6" class="pm-empty">لم تُوزع نسخ بعد</td></tr>
        </tbody>
      </table></div>
    </section>

    <section v-else-if="tab === 'links'" class="card pm-panel">
      <h2>ترتبط بها</h2>
      <div class="q-chips"><RouterLink v-for="r in doc.related" :key="r.code" :to="r.path" class="q-chip"><span class="q-code">{{ r.code }}</span> {{ r.title }}</RouterLink></div>
      <p v-if="!doc.related.length" class="pm-muted">لا توجد</p>
      <h2 style="margin-top: 16px">تشير إليها</h2>
      <div class="q-chips"><RouterLink v-for="r in doc.referencedBy" :key="r.code" :to="r.path" class="q-chip"><span class="q-code">{{ r.code }}</span> {{ r.title }}</RouterLink></div>
      <p v-if="!doc.referencedBy.length" class="pm-muted">لا توجد</p>
      <h2 style="margin-top: 16px">خرائط الإجراء</h2>
      <div class="q-chips"><RouterLink v-for="m in doc.maps" :key="m.id" :to="`/quality/maps/${m.id}`" class="q-chip"><span class="q-code">{{ m.code }}</span> {{ m.title }}</RouterLink></div>
      <p v-if="!doc.maps.length" class="pm-muted">لا توجد. <RouterLink v-if="session.can(P.documents)" :to="`/quality/maps?new=1&doc=${doc.id}`" class="pm-link">ارسم خريطة لهذا الإجراء</RouterLink></p>
    </section>

    <section v-else class="card pm-panel">
      <h2>سجل الإعداد والمراجعة والاعتماد</h2>
      <ul class="q-timeline">
        <li v-for="(h, i) in [...doc.history].reverse()" :key="i">
          <b>{{ h.actionLabel }}</b> <span v-if="h.revisionLabel" class="q-rev">{{ h.revisionLabel }}</span> · {{ h.byName }} · <span class="pm-muted">{{ new Date(h.at).toLocaleString('ar-SA-u-ca-gregory') }}</span>
          <div v-if="h.note" class="pm-muted">{{ h.note }}</div>
        </li>
      </ul>
    </section>

    <div v-if="viewRev" class="modal-backdrop" @click.self="viewRev = null">
      <div class="card modal" style="max-width: 760px; max-height: 85vh; overflow: auto">
        <h2>{{ viewRev.title }} <span class="q-rev">{{ viewRev.revisionLabel }}</span></h2>
        <p class="pm-muted">اعتمده {{ viewRev.approvedByName }} · سرى من {{ fmtDate(viewRev.effectiveDate) }}<template v-if="viewRev.supersededAt"> حتى {{ fmtDate(viewRev.supersededAt) }} (ملغى)</template></p>
        <template v-for="(s, i) in viewRev.sections" :key="i"><p class="q-sec">{{ s.title }}</p><p class="q-pre">{{ s.body || '—' }}</p></template>
        <div class="modal-actions"><button class="btn" @click="viewRev = null">إغلاق</button></div>
      </div>
    </div>
  </div>
</template>
