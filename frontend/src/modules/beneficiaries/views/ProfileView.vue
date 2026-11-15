<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, openProtectedFile } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import BeneficiaryForm from '../components/BeneficiaryForm.vue';
import CountUp from '../components/CountUp.vue';
import StatusBadge from '../components/StatusBadge.vue';
import {
  age, AID_TYPES, color, DECISIONS, DOC_TYPES, fmtDate, GENDERS, label, money, RELATIONS, today,
} from '../labels';
import type { Aid, Beneficiary, FamilyMember, Page, RequestRow } from '../types';
import { passwordProblem } from '../../../validation';

const route = useRoute();
const router = useRouter();
const session = useSession();
const toast = useToast();
const id = route.params.id as string;

const b = ref<Beneficiary | null>(null);
const error = ref('');
const tab = ref<'info' | 'family' | 'requests' | 'research' | 'aid' | 'docs'>('info');
const requests = ref<RequestRow[]>([]);
const editing = ref(false);

const can = {
  manage: computed(() => session.can('beneficiaries.cases.manage')),
  delete: computed(() => session.can('beneficiaries.cases.delete')),
  research: computed(() => session.can('beneficiaries.research.manage')),
  aid: computed(() => session.can('beneficiaries.aid.manage')),
  docs: computed(() => session.can('beneficiaries.documents.manage')),
};

async function load() {
  try {
    b.value = await api<Beneficiary>(`/beneficiaries/${id}`);
    if (session.can('beneficiaries.requests.read')) {
      requests.value = (await api<Page<RequestRow>>(`/beneficiaries/requests?beneficiaryId=${id}&pageSize=100`)).items;
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

const tabs = computed(() => [
  { key: 'info', label: 'البيانات' },
  { key: 'family', label: 'الأسرة', count: b.value?.family.length },
  ...(session.can('beneficiaries.requests.read') ? [{ key: 'requests', label: 'الطلبات', count: requests.value.length }] as const : []),
  { key: 'research', label: 'البحث الاجتماعي', count: b.value?.researches.length },
  { key: 'aid', label: 'المساعدات', count: b.value?.aids.length },
  { key: 'docs', label: 'المستندات', count: b.value?.documents.length },
] as const);

const aidBlocked = computed(() => b.value && ['ineligible', 'suspended'].includes(b.value.status));

// ---------- نافذة عامة للإضافة ----------
type Dialog = 'family' | 'research' | 'aid' | 'doc' | 'portal' | null;
const dialog = ref<Dialog>(null);
const dialogError = ref('');
const busy = ref(false);
const editingMember = ref<FamilyMember | null>(null);

const memberForm = reactive({ fullName: '', relation: '', gender: 'male', birthDate: '', nationalId: '', occupation: '', monthlyIncome: 0 as number | string, healthStatus: '' });
const researchForm = reactive({ visitDate: today(), researcherName: '', findings: '', decision: 'eligible', recommendedAid: '', nextReviewDate: '' });
const aidForm = reactive({ aidType: 'cash', amount: '' as number | string, description: '', disbursedOn: today(), referenceNo: '', requestId: null as string | null });
const portalForm = reactive({ password: '' });
const approvedRequests = computed(() => requests.value.filter((r) => r.status === 'approved'));
const docForm = reactive({ title: '', docType: 'national_id', file: null as File | null });

function openDialog(d: Exclude<Dialog, null>, member?: FamilyMember) {
  dialogError.value = '';
  if (d === 'family') {
    editingMember.value = member ?? null;
    Object.assign(memberForm, {
      fullName: member?.fullName ?? '', relation: member?.relation ?? '', gender: member?.gender ?? 'male',
      birthDate: member?.birthDate ?? '', nationalId: member?.nationalId ?? '', occupation: member?.occupation ?? '',
      monthlyIncome: member?.monthlyIncome ?? 0, healthStatus: member?.healthStatus ?? '',
    });
  }
  if (d === 'research') Object.assign(researchForm, { visitDate: today(), researcherName: session.user?.fullName ?? '', findings: '', decision: 'eligible', recommendedAid: '', nextReviewDate: '' });
  if (d === 'aid') Object.assign(aidForm, { aidType: 'cash', amount: '', description: '', disbursedOn: today(), referenceNo: '', requestId: approvedRequests.value[0]?.id ?? null });
  if (d === 'portal') portalForm.password = '';
  if (d === 'doc') Object.assign(docForm, { title: '', docType: 'national_id', file: null });
  dialog.value = d;
}

async function submit(fn: () => Promise<unknown>, success: string) {
  dialogError.value = '';
  busy.value = true;
  try {
    await fn();
    dialog.value = null;
    toast.success(success);
    await load();
  } catch (e) {
    dialogError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

const saveMember = () => submit(async () => {
  const body = { ...memberForm, monthlyIncome: Number(memberForm.monthlyIncome) || 0 };
  if (editingMember.value) await api(`/beneficiaries/${id}/family/${editingMember.value.id}`, { method: 'PATCH', json: body });
  else await api(`/beneficiaries/${id}/family`, { method: 'POST', json: body });
}, editingMember.value ? 'تم تعديل بيانات الفرد' : 'تمت إضافة فرد للأسرة');

const saveResearch = () => submit(
  () => api(`/beneficiaries/${id}/researches`, { method: 'POST', json: researchForm }),
  'تم تسجيل البحث وتحديث حالة الملف',
);

const saveAid = () => submit(
  () => api(`/beneficiaries/${id}/aids`, { method: 'POST', json: { ...aidForm, amount: Number(aidForm.amount) || 0 } }),
  'تم تسجيل المساعدة',
);

const savePortal = () => submit(async () => {
  const problem = passwordProblem(portalForm.password);
  if (problem) throw new Error(problem);
  await api(`/beneficiaries/${id}/portal-access`, { method: 'POST', json: { password: portalForm.password } });
}, 'تم تفعيل دخول المستفيد للبوابة');

async function revokePortal() {
  if (!confirm('إيقاف دخول المستفيد للبوابة؟')) return;
  await api(`/beneficiaries/${id}/portal-access`, { method: 'DELETE' });
  toast.success('تم إيقاف دخول البوابة');
  await load();
}

const saveDoc = () => submit(async () => {
  if (!docForm.file) throw new Error('اختر الملف أولًا');
  const fd = new FormData();
  fd.append('title', docForm.title);
  fd.append('docType', docForm.docType);
  fd.append('file', docForm.file);
  await api(`/beneficiaries/${id}/documents`, { method: 'POST', body: fd });
}, 'تم رفع المستند');

function pickFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0] ?? null;
  docForm.file = f;
  if (f && !docForm.title) docForm.title = f.name.replace(/\.[^.]+$/, '');
}

async function remove(path: string, what: string) {
  if (!confirm(`متأكد من حذف ${what}؟`)) return;
  try {
    await api(`/beneficiaries/${id}${path}`, { method: 'DELETE' });
    toast.success('تم الحذف');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}

async function removeFile() {
  if (!b.value || !confirm(`متأكد من حذف ملف ${b.value.fullName} بالكامل؟ هيتحذف معاه الأسرة والأبحاث والمساعدات والمستندات.`)) return;
  try {
    await api(`/beneficiaries/${id}`, { method: 'DELETE' });
    toast.success('تم حذف الملف');
    router.push('/beneficiaries/files');
  } catch (e) {
    toast.error((e as Error).message);
  }
}

async function viewDoc(docId: string) {
  try {
    await openProtectedFile(`/beneficiaries/${id}/documents/${docId}/file`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}

function saved(nb: Beneficiary) {
  editing.value = false;
  b.value = nb;
}

const aidByType = computed(() => {
  const m = new Map<string, number>();
  for (const a of b.value?.aids ?? []) m.set(a.aidType, (m.get(a.aidType) ?? 0) + a.amount);
  const total = [...m.values()].reduce((s, v) => s + v, 0) || 1;
  return [...m.entries()].map(([type, amount]) => ({ type, amount, pct: (amount / total) * 100 }));
});
const fileSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} ميجا` : `${Math.ceil(n / 1024)} ك.ب`);
const aidRowTitle = (a: Aid) => a.description || label('aid', a.aidType);
</script>

<template>
  <div>
    <RouterLink to="/beneficiaries/files" class="back">→ كل الملفات</RouterLink>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <template v-if="b">
      <section class="profile-hero">
        <div class="glow" aria-hidden="true" />
        <div class="identity">
          <span :class="['big-av', b.gender]">{{ b.fullName.charAt(0) }}</span>
          <div>
            <div class="meta"><span class="file">ملف رقم {{ b.fileNo }}</span><StatusBadge :value="b.status" class="on-dark" /></div>
            <h1>{{ b.fullName }}</h1>
            <p class="facts">
              <span>{{ label('category', b.category) }}</span>
              <span v-if="age(b.birthDate) !== null">{{ age(b.birthDate) }} سنة</span>
              <span v-if="b.city">{{ b.city }}</span>
              <span v-if="b.phone" dir="ltr">{{ b.phone }}</span>
            </p>
          </div>
        </div>
        <div class="hero-actions">
          <button v-if="can.manage.value" class="btn btn-ghost" @click="editing = true">تعديل البيانات</button>
          <button v-if="can.manage.value && !b.hasPortalAccess" class="btn btn-ghost" @click="openDialog('portal')">تفعيل البوابة</button>
          <button v-if="can.manage.value && b.hasPortalAccess" class="btn btn-ghost portal-on" title="اضغط لإيقاف دخول البوابة" @click="revokePortal">● البوابة مفعّلة</button>
          <button v-if="can.aid.value && !aidBlocked" class="btn btn-gold" @click="tab = 'aid'; openDialog('aid')">+ صرف مساعدة</button>
        </div>
      </section>

      <div class="summary">
        <div class="tile" style="--a: #14b8a6"><span>أفراد الأسرة</span><strong><CountUp :value="b.summary.familySize" /></strong></div>
        <div class="tile" style="--a: #0ea5e9"><span>دخل الأسرة الشهري</span><strong><CountUp :value="b.summary.householdIncome" :decimals="2" /></strong></div>
        <div class="tile" style="--a: #8b5cf6" title="(دخل الأسرة − الإيجار) ÷ عدد الأفراد"><span>نصيب الفرد من الدخل</span><strong><CountUp :value="b.summary.perCapitaIncome" :decimals="2" /></strong></div>
        <div class="tile" style="--a: #e8b04b"><span>إجمالي المساعدات</span><strong><CountUp :value="b.summary.aidTotal" :decimals="2" /></strong><small>{{ b.summary.aidCount }} مرة · آخرها {{ fmtDate(b.summary.lastAidOn) }}</small></div>
      </div>

      <nav class="tabs" role="tablist">
        <button v-for="t in tabs" :key="t.key" role="tab" :aria-selected="tab === t.key" :class="['tab', { on: tab === t.key }]" @click="tab = t.key">
          {{ t.label }}<span v-if="'count' in t && t.count" class="count">{{ t.count }}</span>
        </button>
      </nav>

      <Transition name="page" mode="out-in">
        <!-- البيانات -->
        <section v-if="tab === 'info'" key="info" class="card pane">
          <dl class="info">
            <div><dt>رقم الهوية</dt><dd dir="ltr">{{ b.nationalId || '—' }}</dd></div>
            <div><dt>النوع</dt><dd>{{ label('gender', b.gender) }}</dd></div>
            <div><dt>تاريخ الميلاد</dt><dd>{{ fmtDate(b.birthDate) }}</dd></div>
            <div><dt>الحالة الاجتماعية</dt><dd>{{ label('marital', b.maritalStatus) }}</dd></div>
            <div><dt>الموبايل</dt><dd dir="ltr">{{ b.phone || '—' }}</dd></div>
            <div><dt>رقم إضافي</dt><dd dir="ltr">{{ b.altPhone || '—' }}</dd></div>
            <div><dt>المدينة</dt><dd>{{ b.city || '—' }}</dd></div>
            <div><dt>العنوان</dt><dd>{{ b.address || '—' }}</dd></div>
            <div><dt>الدخل الشهري</dt><dd>{{ money(b.monthlyIncome) }}</dd></div>
            <div><dt>مصدر الدخل</dt><dd>{{ b.incomeSource || '—' }}</dd></div>
            <div><dt>السكن</dt><dd>{{ label('housing', b.housingType) }}<template v-if="b.monthlyRent"> · إيجار {{ money(b.monthlyRent) }}</template></dd></div>
            <div><dt>الحالة الصحية</dt><dd>{{ b.healthStatus || '—' }}</dd></div>
            <div class="wide"><dt>ملاحظات</dt><dd class="pre">{{ b.notes || '—' }}</dd></div>
          </dl>
          <div v-if="can.delete.value" class="danger-zone">
            <button class="btn btn-danger btn-sm" @click="removeFile">حذف الملف نهائيًا</button>
          </div>
        </section>

        <!-- الأسرة -->
        <section v-else-if="tab === 'family'" key="family" class="pane">
          <div class="pane-head"><h2>أفراد الأسرة</h2><button v-if="can.manage.value" class="btn btn-primary btn-sm" @click="openDialog('family')">+ إضافة فرد</button></div>
          <p v-if="!b.family.length" class="card empty">لم يُسجل أفراد للأسرة بعد.</p>
          <div class="members">
            <article v-for="(m, i) in b.family" :key="m.id" class="card member" :style="{ '--i': i }">
              <span :class="['av', m.gender]">{{ m.fullName.charAt(0) }}</span>
              <div class="grow">
                <b>{{ m.fullName }}</b>
                <p class="muted">{{ m.relation }}<template v-if="age(m.birthDate) !== null"> · {{ age(m.birthDate) }} سنة</template><template v-if="m.occupation"> · {{ m.occupation }}</template></p>
                <p v-if="m.monthlyIncome || m.healthStatus" class="muted small">
                  <template v-if="m.monthlyIncome">دخل {{ money(m.monthlyIncome) }}</template>
                  <template v-if="m.healthStatus"> · {{ m.healthStatus }}</template>
                </p>
              </div>
              <div v-if="can.manage.value" class="row-actions">
                <button class="icon-btn" title="تعديل" @click="openDialog('family', m)">✎</button>
                <button class="icon-btn danger" title="حذف" @click="remove(`/family/${m.id}`, m.fullName)">✕</button>
              </div>
            </article>
          </div>
        </section>

        <!-- الطلبات -->
        <section v-else-if="tab === 'requests'" key="requests" class="pane">
          <div class="pane-head"><h2>طلبات المستفيد</h2><RouterLink to="/beneficiaries/requests" class="btn btn-sm">كل الطلبات</RouterLink></div>
          <p v-if="!requests.length" class="card empty">لا توجد طلبات لهذا المستفيد.</p>
          <div v-else class="card table-wrap">
            <table class="table">
              <thead><tr><th>رقم الطلب</th><th>المشروع</th><th>المرحلة</th><th>الحالة</th><th>التاريخ</th></tr></thead>
              <tbody>
                <tr v-for="r in requests" :key="r.id" class="clickable" @click="router.push(`/beneficiaries/requests/${r.id}`)">
                  <td><b>#{{ r.requestNo }}</b></td><td>{{ r.project.name }}</td><td>{{ r.stage?.name ?? '—' }}</td>
                  <td><StatusBadge :value="r.status" kind="request" /></td><td class="muted">{{ fmtDate(r.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- البحث الاجتماعي -->
        <section v-else-if="tab === 'research'" key="research" class="pane">
          <div class="pane-head"><h2>سجل البحث الاجتماعي</h2><button v-if="can.research.value" class="btn btn-primary btn-sm" @click="openDialog('research')">+ تسجيل بحث</button></div>
          <p v-if="!b.researches.length" class="card empty">لم يُسجل بحث اجتماعي بعد. تسجيل البحث بيحدد هل الحالة مستحقة.</p>
          <ol class="timeline">
            <li v-for="r in b.researches" :key="r.id" :style="{ '--c': color('decision', r.decision) }">
              <div class="card t-card">
                <div class="t-head">
                  <StatusBadge :value="r.decision" kind="decision" />
                  <span class="muted">{{ fmtDate(r.visitDate) }} · {{ r.researcherName }}</span>
                  <button v-if="can.research.value" class="icon-btn danger" title="حذف" @click="remove(`/researches/${r.id}`, 'هذا البحث')">✕</button>
                </div>
                <p class="pre">{{ r.findings }}</p>
                <p v-if="r.recommendedAid" class="small"><b>المساعدة المقترحة:</b> {{ r.recommendedAid }}</p>
                <p v-if="r.nextReviewDate" class="small muted">المراجعة القادمة: {{ fmtDate(r.nextReviewDate) }}</p>
              </div>
            </li>
          </ol>
        </section>

        <!-- المساعدات -->
        <section v-else-if="tab === 'aid'" key="aid" class="pane">
          <div class="pane-head"><h2>المساعدات المصروفة</h2><button v-if="can.aid.value && !aidBlocked" class="btn btn-primary btn-sm" @click="openDialog('aid')">+ صرف مساعدة</button></div>
          <div v-if="aidBlocked" class="alert alert-error">الحالة {{ label('status', b.status) }}، لذلك لا يمكن صرف مساعدات لها حاليًا.</div>
          <div v-if="aidByType.length" class="card mix">
            <div class="mix-bar"><span v-for="t in aidByType" :key="t.type" :style="{ width: t.pct + '%', background: color('aid', t.type) }" :title="label('aid', t.type)" /></div>
            <div class="mix-legend"><span v-for="t in aidByType" :key="t.type"><i :style="{ background: color('aid', t.type) }" />{{ label('aid', t.type) }} {{ money(t.amount) }}</span></div>
          </div>
          <p v-if="!b.aids.length" class="card empty">لم تُصرف مساعدات لهذه الحالة بعد.</p>
          <div v-else class="card table-wrap">
            <table class="table">
              <thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>القيمة</th><th>رقم الإيصال</th><th v-if="can.aid.value"></th></tr></thead>
              <tbody>
                <tr v-for="a in b.aids" :key="a.id">
                  <td>{{ fmtDate(a.disbursedOn) }}</td>
                  <td><StatusBadge :value="a.aidType" kind="aid" /></td>
                  <td>{{ aidRowTitle(a) }}</td>
                  <td><b class="amt">{{ money(a.amount) }}</b></td>
                  <td class="muted">{{ a.referenceNo || '—' }}</td>
                  <td v-if="can.aid.value"><button class="icon-btn danger" title="حذف" @click="remove(`/aids/${a.id}`, 'هذه المساعدة')">✕</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- المستندات -->
        <section v-else key="docs" class="pane">
          <div class="pane-head"><h2>المستندات</h2><button v-if="can.docs.value" class="btn btn-primary btn-sm" @click="openDialog('doc')">+ رفع مستند</button></div>
          <p v-if="!b.documents.length" class="card empty">لا توجد مستندات. ارفع صورة البطاقة والأوراق الداعمة للحالة.</p>
          <div class="docs">
            <article v-for="(d, i) in b.documents" :key="d.id" class="card doc" :style="{ '--i': i }">
              <button class="doc-open" @click="viewDoc(d.id)">
                <span :class="['doc-icon', d.mimeType === 'application/pdf' ? 'pdf' : 'img']">{{ d.mimeType === 'application/pdf' ? 'PDF' : 'IMG' }}</span>
                <span class="grow"><b>{{ d.title }}</b><small class="muted">{{ label('doc', d.docType) }} · {{ fileSize(d.size) }}</small></span>
              </button>
              <button v-if="can.docs.value" class="icon-btn danger" title="حذف" @click="remove(`/documents/${d.id}`, d.title)">✕</button>
            </article>
          </div>
        </section>
      </Transition>
    </template>
    <div v-else-if="!error" class="skeleton" />

    <BeneficiaryForm v-if="editing && b" :beneficiary="b" @close="editing = false" @saved="saved" />

    <!-- نوافذ الإضافة -->
    <div v-if="dialog" class="modal-backdrop" @click.self="dialog = null">
      <form v-if="dialog === 'family'" class="card modal" @submit.prevent="saveMember">
        <h2 class="mtitle">{{ editingMember ? 'تعديل بيانات فرد' : 'إضافة فرد للأسرة' }}</h2>
        <div v-if="dialogError" class="alert alert-error">{{ dialogError }}</div>
        <div class="field"><label>الاسم *</label><input v-model="memberForm.fullName" class="input" required /></div>
        <div class="two">
          <div class="field"><label>صلة القرابة *</label><input v-model="memberForm.relation" class="input" list="relations" required /><datalist id="relations"><option v-for="r in RELATIONS" :key="r" :value="r" /></datalist></div>
          <div class="field"><label>النوع</label><select v-model="memberForm.gender" class="input"><option v-for="g in GENDERS" :key="g.value" :value="g.value">{{ g.label }}</option></select></div>
          <div class="field"><label>تاريخ الميلاد</label><input v-model="memberForm.birthDate" class="input" type="date" /></div>
          <div class="field"><label>رقم الهوية</label><input v-model="memberForm.nationalId" class="input" dir="ltr" inputmode="numeric" /></div>
          <div class="field"><label>الدراسة / العمل</label><input v-model="memberForm.occupation" class="input" /></div>
          <div class="field"><label>الدخل الشهري</label><input v-model="memberForm.monthlyIncome" class="input" type="number" min="0" step="0.01" /></div>
        </div>
        <div class="field"><label>الحالة الصحية</label><input v-model="memberForm.healthStatus" class="input" /></div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ</button><button type="button" class="btn" @click="dialog = null">إلغاء</button></div>
      </form>

      <form v-else-if="dialog === 'research'" class="card modal" @submit.prevent="saveResearch">
        <h2 class="mtitle">تسجيل بحث اجتماعي</h2>
        <div v-if="dialogError" class="alert alert-error">{{ dialogError }}</div>
        <div class="two">
          <div class="field"><label>تاريخ الزيارة *</label><input v-model="researchForm.visitDate" class="input" type="date" required /></div>
          <div class="field"><label>اسم الباحث *</label><input v-model="researchForm.researcherName" class="input" required /></div>
        </div>
        <div class="field"><label>نتيجة البحث *</label><textarea v-model="researchForm.findings" class="input" rows="4" required placeholder="وصف حالة الأسرة والسكن والاحتياجات..." /></div>
        <div class="field"><label>القرار *</label>
          <div class="decisions">
            <label v-for="d in DECISIONS" :key="d.value" :class="{ on: researchForm.decision === d.value }" :style="{ '--c': d.color }">
              <input v-model="researchForm.decision" type="radio" :value="d.value" />{{ d.label }}
            </label>
          </div>
        </div>
        <div class="two">
          <div class="field"><label>المساعدة المقترحة</label><input v-model="researchForm.recommendedAid" class="input" placeholder="كفالة شهرية، علاج..." /></div>
          <div class="field"><label>موعد المراجعة القادمة</label><input v-model="researchForm.nextReviewDate" class="input" type="date" /></div>
        </div>
        <p class="muted small">حالة الملف هتتغير تلقائيًا حسب القرار.</p>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ البحث</button><button type="button" class="btn" @click="dialog = null">إلغاء</button></div>
      </form>

      <form v-else-if="dialog === 'aid'" class="card modal" @submit.prevent="saveAid">
        <h2 class="mtitle">صرف مساعدة لـ {{ b?.fullName }}</h2>
        <div v-if="dialogError" class="alert alert-error">{{ dialogError }}</div>
        <div class="field"><label>نوع المساعدة *</label>
          <div class="types">
            <label v-for="t in AID_TYPES" :key="t.value" :class="{ on: aidForm.aidType === t.value }" :style="{ '--c': t.color }">
              <input v-model="aidForm.aidType" type="radio" :value="t.value" />{{ t.label }}
            </label>
          </div>
        </div>
        <div class="two">
          <div class="field"><label>{{ aidForm.aidType === 'cash' ? 'المبلغ *' : 'القيمة التقديرية *' }}</label><input v-model="aidForm.amount" class="input" type="number" min="0" step="0.01" required /></div>
          <div class="field"><label>تاريخ الصرف *</label><input v-model="aidForm.disbursedOn" class="input" type="date" required /></div>
          <div class="field"><label>البيان</label><input v-model="aidForm.description" class="input" placeholder="كرتونة رمضان، مصاريف مدرسة..." /></div>
          <div class="field"><label>رقم الإيصال</label><input v-model="aidForm.referenceNo" class="input" /></div>
        </div>
        <div v-if="approvedRequests.length" class="field"><label>على الطلب المعتمد</label>
          <select v-model="aidForm.requestId" class="input"><option :value="null">بدون ربط بطلب</option><option v-for="r in approvedRequests" :key="r.id" :value="r.id">طلب #{{ r.requestNo }} · {{ r.project.name }}</option></select>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">تسجيل الصرف</button><button type="button" class="btn" @click="dialog = null">إلغاء</button></div>
      </form>

      <form v-else-if="dialog === 'portal'" class="card modal" @submit.prevent="savePortal">
        <h2 class="mtitle">تفعيل بوابة المستفيد</h2>
        <div v-if="dialogError" class="alert alert-error">{{ dialogError }}</div>
        <p class="muted small">المستفيد هيدخل البوابة برقم الهوية <b dir="ltr">{{ b?.nationalId || '(سجّل رقم الهوية أولًا)' }}</b> وكلمة المرور دي. ابعتهاله وهو يقدر يتابع طلباته.</p>
        <div class="field"><label>كلمة المرور (8 أحرف إنجليزي على الأقل)</label><input v-model="portalForm.password" class="input" dir="ltr" required minlength="8" autocomplete="new-password" /></div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">تفعيل</button><button type="button" class="btn" @click="dialog = null">إلغاء</button></div>
      </form>

      <form v-else-if="dialog === 'doc'" class="card modal" @submit.prevent="saveDoc">
        <h2 class="mtitle">رفع مستند</h2>
        <div v-if="dialogError" class="alert alert-error">{{ dialogError }}</div>
        <label class="drop" :class="{ has: docForm.file }">
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" @change="pickFile" />
          <span class="drop-icon">⬆</span>
          <span v-if="docForm.file"><b>{{ docForm.file.name }}</b> · {{ fileSize(docForm.file.size) }}</span>
          <span v-else>اضغط لاختيار صورة أو ملف PDF (حتى 10 ميجا)</span>
        </label>
        <div class="two">
          <div class="field"><label>اسم المستند *</label><input v-model="docForm.title" class="input" required /></div>
          <div class="field"><label>النوع</label><select v-model="docForm.docType" class="input"><option v-for="d in DOC_TYPES" :key="d.value" :value="d.value">{{ d.label }}</option></select></div>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy || !docForm.file">{{ busy ? 'جارٍ الرفع...' : 'رفع' }}</button><button type="button" class="btn" @click="dialog = null">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.back { display: inline-block; margin-bottom: 12px; color: var(--muted); font-size: .9rem; }
.back:hover { color: var(--primary); }
.portal-on { color: #86efac !important; border-color: rgba(134,239,172,.4) !important; }
.clickable { cursor: pointer; }

.profile-hero { position: relative; overflow: hidden; border-radius: 20px; padding: 26px 28px; color: #fff; background: var(--grad-dark);
  display: flex; align-items: center; justify-content: space-between; gap: 18px; flex-wrap: wrap; box-shadow: 0 16px 40px rgba(6,20,26,.18); }
.glow { position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(380px 200px at 90% -10%, rgba(45,212,191,.45), transparent 70%), radial-gradient(360px 200px at 0% 130%, rgba(232,176,75,.35), transparent 70%);
  animation: breathe 9s ease-in-out infinite; }
@keyframes breathe { 50% { opacity: .65; } }
.identity { position: relative; display: flex; align-items: center; gap: 18px; animation: rise .5s var(--ease) both; min-width: 0; }
.big-av { width: 72px; height: 72px; border-radius: 22px; display: grid; place-items: center; font-size: 2rem; font-weight: 700; flex-shrink: 0;
  background: linear-gradient(135deg, #a78bfa, #6366f1); box-shadow: 0 0 0 3px rgba(255,255,255,.18), 0 12px 30px rgba(99,102,241,.5); }
.big-av.male { background: linear-gradient(135deg, #2dd4bf, #0f766e); box-shadow: 0 0 0 3px rgba(255,255,255,.18), 0 12px 30px rgba(20,184,166,.5); }
.meta { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.file { font-size: .8rem; color: #5eead4; font-weight: 600; letter-spacing: .3px; }
.on-dark { background: rgba(255,255,255,.92) !important; }
.profile-hero h1 { font-size: 1.55rem; }
.facts { margin: 6px 0 0; display: flex; flex-wrap: wrap; gap: 6px; }
.facts span { font-size: .82rem; padding: 2px 10px; border-radius: 999px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.14); }
.hero-actions { position: relative; display: flex; gap: 10px; flex-wrap: wrap; }
.btn-ghost { background: rgba(255,255,255,.08); color: #fff; border-color: rgba(255,255,255,.2); }
.btn-ghost:hover { background: rgba(255,255,255,.16); }
.btn-gold { background: linear-gradient(135deg, #f5c66b, #e8b04b); color: #3b2a06; border: 0; font-weight: 700; box-shadow: 0 8px 22px rgba(232,176,75,.4); }
.btn-gold:hover { background: linear-gradient(135deg, #f8d48a, #eab558); transform: translateY(-1px); }

.summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: -22px 18px 18px; position: relative; }
.tile { background: var(--surface); border-radius: 14px; padding: 14px 16px; border: 1px solid var(--border); box-shadow: 0 10px 28px rgba(16,24,40,.08);
  display: flex; flex-direction: column; border-top: 3px solid var(--a); animation: rise .5s .15s var(--ease) both; }
.tile > span { font-size: .8rem; color: var(--muted); }
.tile strong { font-size: 1.35rem; }
.tile small { font-size: .74rem; color: var(--muted); }

.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 16px; overflow-x: auto; }
.tab { position: relative; font: inherit; background: none; border: 0; padding: 10px 16px; cursor: pointer; color: var(--muted); font-weight: 500; white-space: nowrap; transition: color .2s; }
.tab:hover { color: var(--text); }
.tab.on { color: var(--primary); font-weight: 700; }
.tab.on::after { content: ''; position: absolute; inset-inline: 10px; bottom: -1px; height: 3px; border-radius: 3px; background: var(--grad); box-shadow: 0 0 12px rgba(20,184,166,.6); }
.count { margin-inline-start: 6px; font-size: .72rem; background: var(--primary-soft); color: var(--primary); padding: 0 7px; border-radius: 999px; }

.pane { min-height: 120px; }
.card.pane { padding: 20px; }
.pane-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 10px; }
.pane-head h2 { font-size: 1rem; }
.empty { padding: 26px; text-align: center; color: var(--muted); margin: 0 0 12px; }
.info { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px 24px; margin: 0; }
.info dt { font-size: .8rem; color: var(--muted); }
.info dd { margin: 2px 0 0; font-weight: 500; text-align: right; }
.info .wide { grid-column: 1 / -1; }
.pre { white-space: pre-wrap; }
.danger-zone { margin-top: 20px; padding-top: 14px; border-top: 1px dashed var(--border); }

.members { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.member { display: flex; gap: 12px; padding: 14px; align-items: flex-start; animation: rise .45s calc(var(--i) * 60ms) var(--ease) both; transition: transform .2s, box-shadow .2s; }
.member:hover { transform: translateY(-2px); box-shadow: 0 12px 26px rgba(16,24,40,.08); }
.member p { margin: 2px 0 0; font-size: .86rem; }
.av { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; color: #fff; font-weight: 700; flex-shrink: 0; background: linear-gradient(135deg, #a78bfa, #6366f1); }
.av.male { background: linear-gradient(135deg, #2dd4bf, #0f766e); }
.grow { flex: 1; min-width: 0; }
.small { font-size: .82rem; }
.row-actions { display: flex; gap: 2px; }
.icon-btn { background: none; border: 0; cursor: pointer; width: 30px; height: 30px; border-radius: 8px; color: var(--muted); font-size: .95rem; }
.icon-btn:hover { background: var(--surface-2); color: var(--text); }
.icon-btn.danger:hover { background: var(--danger-soft); color: var(--danger); }

.timeline { list-style: none; margin: 0; padding: 0 22px 0 0; position: relative; }
.timeline::before { content: ''; position: absolute; right: 7px; top: 6px; bottom: 6px; width: 2px; background: linear-gradient(var(--primary-soft), var(--border)); }
.timeline li { position: relative; margin-bottom: 14px; animation: rise .45s var(--ease) both; }
.timeline li::before { content: ''; position: absolute; right: -21px; top: 18px; width: 12px; height: 12px; border-radius: 50%; background: var(--c);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 20%, transparent), 0 0 14px var(--c); }
.t-card { padding: 14px 16px; }
.t-card p { margin: 8px 0 0; }
.t-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.t-head .icon-btn { margin-inline-start: auto; }

.mix { padding: 14px; margin-bottom: 12px; }
.mix-bar { display: flex; height: 12px; border-radius: 12px; overflow: hidden; gap: 2px; }
.mix-bar span { animation: fill .9s var(--ease) both; transform-origin: right; }
@keyframes fill { from { transform: scaleX(0); } }
.mix-legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px; font-size: .84rem; }
.mix-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-inline-end: 6px; }
.amt { color: var(--primary); }

.docs { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.doc { display: flex; align-items: center; padding: 8px; animation: rise .45s calc(var(--i) * 60ms) var(--ease) both; }
.doc-open { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; background: none; border: 0; font: inherit; color: inherit; text-align: right; cursor: pointer; padding: 6px; border-radius: 8px; }
.doc-open:hover { background: var(--surface-2); }
.doc-open small { display: block; font-size: .78rem; }
.doc-icon { width: 44px; height: 52px; border-radius: 8px; display: grid; place-items: center; font-size: .7rem; font-weight: 800; color: #fff; flex-shrink: 0; letter-spacing: .5px; }
.doc-icon.pdf { background: linear-gradient(160deg, #f87171, #b91c1c); }
.doc-icon.img { background: linear-gradient(160deg, #38bdf8, #0369a1); }

.mtitle { margin-bottom: 14px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
textarea.input { resize: vertical; }
.decisions, .types { display: flex; flex-wrap: wrap; gap: 8px; }
.decisions label, .types label { --c: var(--primary); padding: 7px 14px; border: 1px solid var(--border); border-radius: 999px; cursor: pointer; font-weight: 500; font-size: .9rem; transition: all .2s; }
.decisions label.on, .types label.on { border-color: var(--c); background: color-mix(in srgb, var(--c) 14%, transparent); color: color-mix(in srgb, var(--c) 80%, #000); font-weight: 700; }
.decisions input, .types input { display: none; }
.drop { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 24px; margin-bottom: 14px; border: 2px dashed var(--border); border-radius: 14px;
  cursor: pointer; text-align: center; color: var(--muted); transition: all .2s; }
.drop:hover { border-color: var(--primary); background: var(--primary-soft); }
.drop.has { border-style: solid; border-color: var(--primary); color: var(--text); background: var(--primary-soft); }
.drop input { display: none; }
.drop-icon { font-size: 1.6rem; color: var(--primary); }

.skeleton { height: 160px; border-radius: 20px; background: linear-gradient(90deg, var(--surface-2), #eef3f5, var(--surface-2)); background-size: 200% 100%; animation: shimmer 1.2s infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
@keyframes rise { from { opacity: 0; transform: translateY(12px); } }

@media (max-width: 900px) { .summary { grid-template-columns: 1fr 1fr; margin: 14px 0; } .info { grid-template-columns: 1fr 1fr; } }
@media (max-width: 600px) {
  .profile-hero { padding: 20px 16px; } .profile-hero h1 { font-size: 1.2rem; }
  .big-av { width: 56px; height: 56px; font-size: 1.5rem; border-radius: 18px; }
  .info, .two { grid-template-columns: 1fr; }
}
</style>
