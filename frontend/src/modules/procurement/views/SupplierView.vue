<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { api, openProtectedFile } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import SupplierFields from '../components/SupplierFields.vue';
import { BANK_COLOR, DOC_COLOR, INV_READ, PR, SUPPLIER_COLOR, fmtDate, fmtDateTime, ibanView, lookups, supplierForm, supplierPayload, upload } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const s = ref<any>(null);
const lk = ref<any>(null);
const tab = ref<'profile' | 'docs' | 'banks' | 'users' | 'log'>('profile');
const busy = ref(false);
const editing = ref(false);
const form = ref(supplierForm());
const note = ref('');
const suspending = ref(false);
const reason = ref('');
const doc = ref({ docType: '', number: '', issueDate: '', expiryDate: '', file: null as File | null });
const bank = ref({ bankName: '', iban: '', accountName: '', file: null as File | null });
const invite = ref({ fullName: '', email: '', phone: '', role: 'owner' });
const temp = ref<any>(null);
const reviewNotes = ref<Record<string, string>>({});
const P = PR;
const can = (p: string) => session.can(p);
const base = computed(() => `/procurement/suppliers/${props.id}`);

async function load() {
  try {
    [s.value, lk.value] = await Promise.all([api(base.value), lookups()]);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
watch(() => props.id, load);

async function run(fn: () => Promise<any>, ok: string) {
  busy.value = true;
  try {
    const r = await fn();
    if (r && r.id === props.id) s.value = r;
    else await load();
    toast.success(ok);
    return r ?? true;
  } catch (e) {
    toast.error((e as Error).message);
    return null;
  } finally {
    busy.value = false;
  }
}
const docTypes = computed(() => (lk.value?.settings.supplierDocTypes ?? []).filter((d: any) => d.isActive && (!d.entityTypes.length || d.entityTypes.includes(s.value?.entityType))));
const docType = computed(() => docTypes.value.find((d: any) => d.key === doc.value.docType));
const pendingDocs = computed(() => (s.value?.docs ?? []).filter((d: any) => d.isCurrent && d.status === 'pending').length);
const pendingBanks = computed(() => (s.value?.banks ?? []).filter((b: any) => b.status === 'pending').length);

function startEdit() {
  form.value = supplierForm(s.value);
  editing.value = true;
}
const saveEdit = async () => { if (await run(() => api(base.value, { method: 'PUT', json: supplierPayload(form.value) }), 'حُفظت بيانات المورد')) editing.value = false; };
async function decide(decision: 'approve' | 'return' | 'reject') {
  if (decision !== 'approve' && note.value.trim().length < 3) return toast.error('اكتب ملاحظة توضح للمورد ما المطلوب أو سبب الرفض');
  if (await run(() => api(`${base.value}/decision`, { method: 'POST', json: { decision, note: note.value.trim() || null } }),
    { approve: 'اعتُمد المورد', return: 'أُعيد الطلب للمورد للاستكمال', reject: 'رُفض طلب المورد' }[decision])) note.value = '';
}
const doSuspend = async () => { if (await run(() => api(`${base.value}/suspend`, { method: 'POST', json: { reason: reason.value } }), 'أُوقف المورد')) { suspending.value = false; reason.value = ''; } };
const reactivate = () => run(() => api(`${base.value}/reactivate`, { method: 'POST' }), 'أُعيد تفعيل المورد');
const createPartner = () => run(() => api(`${base.value}/partner`, { method: 'POST' }), 'أُنشئ حساب المورد في النظام المالي');
const unlinkPartner = () => confirm('فك ربط المورد بحسابه في النظام المالي؟') && run(() => api(`${base.value}/partner`, { method: 'PUT', json: { partnerId: null } }), 'فُك الربط');

function pickFile(e: Event, target: { file: File | null }) {
  target.file = (e.target as HTMLInputElement).files?.[0] ?? null;
}
async function addDoc() {
  const d = doc.value;
  if (!d.file) return toast.error('اختر ملف المستند');
  const ok = await run(() => upload(`${base.value}/docs`, d.file!, { docType: d.docType, number: d.number, issueDate: d.issueDate, expiryDate: d.expiryDate }), 'رُفع المستند');
  if (ok) doc.value = { docType: '', number: '', issueDate: '', expiryDate: '', file: null };
}
const reviewDoc = (d: any, decision: 'accept' | 'reject') => {
  const n = (reviewNotes.value[d.id] ?? '').trim();
  if (decision === 'reject' && n.length < 3) return toast.error('اكتب سبب رفض المستند');
  return run(() => api(`${base.value}/docs/${d.id}/review`, { method: 'POST', json: { decision, note: n || null } }), decision === 'accept' ? 'قُبل المستند' : 'رُفض المستند');
};
const removeDoc = (d: any) => confirm(`حذف «${d.title}»؟`) && run(() => api(`${base.value}/docs/${d.id}`, { method: 'DELETE' }), 'حُذف المستند');
const openDoc = (d: any) => openProtectedFile(`${base.value}/docs/${d.id}/file`).catch((e) => toast.error(e.message));
async function addBank() {
  const b = bank.value;
  const ok = b.file
    ? await run(() => upload(`${base.value}/banks`, b.file!, { bankName: b.bankName, iban: b.iban, accountName: b.accountName }), 'سُجّل طلب الحساب البنكي، ويعتمده موظف آخر')
    : await run(() => { const fd = new FormData(); fd.append('bankName', b.bankName); fd.append('iban', b.iban); fd.append('accountName', b.accountName); return api(`${base.value}/banks`, { method: 'POST', body: fd }); }, 'سُجّل طلب الحساب البنكي، ويعتمده موظف آخر');
  if (ok) bank.value = { bankName: '', iban: '', accountName: '', file: null };
}
const decideBank = (b: any, decision: 'approve' | 'reject') => run(() => api(`${base.value}/banks/${b.id}/decision`, { method: 'POST', json: { decision, note: (reviewNotes.value[b.id] ?? '').trim() || null } }), decision === 'approve' ? 'اعتُمد الحساب البنكي' : 'رُفض الحساب البنكي');
const openBank = (b: any) => openProtectedFile(`${base.value}/banks/${b.id}/file`).catch((e) => toast.error(e.message));

async function inviteUser() {
  const r = await run(() => api(`${base.value}/users`, { method: 'POST', json: { ...invite.value, phone: invite.value.phone || null } }), 'أُنشئ حساب البوابة');
  if (r?.tempPassword) {
    temp.value = { name: invite.value.fullName, email: invite.value.email, password: r.tempPassword, url: r.loginUrl };
    invite.value = { fullName: '', email: '', phone: '', role: 'owner' };
  }
}
async function resetUser(u: any) {
  if (!confirm(`إصدار كلمة مرور مؤقتة جديدة لـ ${u.fullName}؟ تتوقف كلمته الحالية.`)) return;
  const r = await run(() => api(`${base.value}/users/${u.id}/reset`, { method: 'POST' }), 'صدرت كلمة مرور مؤقتة');
  if (r?.tempPassword) temp.value = { name: u.fullName, email: u.email, password: r.tempPassword, url: r.loginUrl };
}
const setActive = (u: any, active: boolean) => run(() => api(`${base.value}/users/${u.id}/active`, { method: 'POST', json: { active } }), active ? 'فُعّل المستخدم' : 'أُوقف المستخدم');
const tempText = computed(() => temp.value && `السلام عليكم ${temp.value.name}،\nتم إنشاء حسابكم في بوابة الموردين:\nالرابط: ${temp.value.url}\nالبريد: ${temp.value.email}\nكلمة المرور المؤقتة: ${temp.value.password}\nسيُطلب منكم تغييرها عند أول دخول.`);
async function copyTemp() {
  try { await navigator.clipboard.writeText(tempText.value); toast.success('نُسخت الرسالة'); } catch { toast.error('تعذر النسخ'); }
}
const EVENT: Record<string, string> = {
  register: 'تسجيل من البوابة', login: 'دخول', login_failed: 'محاولة دخول فاشلة', locked: 'قفل الحساب مؤقتًا', submitted: 'إرسال الطلب', doc_uploaded: 'رفع مستند',
  doc_removed: 'حذف مستند', bank_requested: 'طلب حساب بنكي', profile_updated: 'تحديث البيانات', user_added: 'إضافة مستخدم', user_updated: 'تعديل مستخدم',
  reset_requested: 'طلب استعادة كلمة المرور', password_reset: 'تعيين كلمة مرور جديدة', password_changed: 'تغيير كلمة المرور',
};
</script>

<template>
  <div v-if="s && lk">
    <div class="page-head">
      <div>
        <h1>{{ s.name }}</h1>
        <p class="muted"><span class="pc-code">{{ s.code }}</span> · {{ s.entityTypeLabel }} · {{ s.kindLabel }} ·
          <span class="pm-pill" :style="{ '--c': SUPPLIER_COLOR[s.status] }">{{ s.statusLabel }}</span>
          <span class="pm-muted"> · {{ s.source === 'portal' ? 'سجّل عبر البوابة' : 'سجّله موظف' }}</span></p>
      </div>
      <div class="pc-inline">
        <RouterLink v-if="INV_READ.some(can)" class="btn" :to="`/procurement/suppliers/${s.id}/statement`">كشف الحساب</RouterLink>
        <button v-if="can(P.suppliers)" class="btn" @click="startEdit">تعديل البيانات</button>
        <button v-if="can(P.approveSuppliers) && s.status === 'approved'" class="btn btn-danger" @click="suspending = true">إيقاف التعامل</button>
        <button v-if="can(P.approveSuppliers) && s.status === 'suspended'" class="btn" :disabled="busy" @click="reactivate">إعادة التفعيل</button>
      </div>
    </div>

    <div v-if="s.reviewNote && ['returned', 'rejected', 'suspended'].includes(s.status)" class="alert alert-error">{{ s.statusLabel }}: {{ s.reviewNote }}</div>

    <div class="pc-tabs">
      <button :class="{ on: tab === 'profile' }" @click="tab = 'profile'">الملف</button>
      <button :class="{ on: tab === 'docs' }" @click="tab = 'docs'">المستندات<b v-if="pendingDocs">{{ pendingDocs }}</b></button>
      <button :class="{ on: tab === 'banks' }" @click="tab = 'banks'">الحساب البنكي<b v-if="pendingBanks">{{ pendingBanks }}</b></button>
      <button :class="{ on: tab === 'users' }" @click="tab = 'users'">حسابات البوابة</button>
      <button :class="{ on: tab === 'log' }" @click="tab = 'log'">السجل</button>
    </div>

    <div v-if="tab === 'profile'" class="pc-grid">
      <section class="card pm-panel">
        <h2>بيانات المنشأة</h2>
        <dl class="pc-dl">
          <div v-if="s.nameEn"><dt>الاسم بالإنجليزية</dt><dd dir="ltr">{{ s.nameEn }}</dd></div>
          <div v-if="s.entityType !== 'individual'"><dt>السجل التجاري</dt><dd class="pc-code">{{ s.crNumber ?? '—' }}</dd></div>
          <div v-if="s.entityType !== 'individual'"><dt>انتهاء السجل</dt><dd>{{ fmtDate(s.crExpiry) }}</dd></div>
          <div v-else><dt>رقم الهوية</dt><dd class="pc-code">{{ s.nationalId ?? '—' }}</dd></div>
          <div><dt>الرقم الضريبي</dt><dd class="pc-code">{{ s.vatNumber ?? '—' }}</dd></div>
          <div><dt>المدينة</dt><dd>{{ s.city ?? '—' }}</dd></div>
          <div><dt>الهاتف</dt><dd dir="ltr">{{ s.phone ?? '—' }}</dd></div>
          <div><dt>البريد</dt><dd dir="ltr">{{ s.email ?? '—' }}</dd></div>
          <div v-if="s.website"><dt>الموقع</dt><dd><a :href="s.website" target="_blank" rel="noopener" class="pm-link" dir="ltr">{{ s.website }}</a></dd></div>
          <div class="wide" style="grid-column: 1 / -1"><dt>العنوان</dt><dd>{{ s.address ?? '—' }}</dd></div>
        </dl>
        <div class="pc-sec">الأنشطة والتصنيف</div>
        <div class="pc-chips"><span v-for="a in s.activities" :key="a" class="pc-chip">{{ a }}</span><span v-for="c in s.categories" :key="c.id" class="pc-chip" :style="{ '--c': c.color }">{{ c.name }}</span></div>
        <p v-if="s.about" style="white-space: pre-line">{{ s.about }}</p>
        <template v-if="s.contacts.length">
          <div class="pc-sec">جهات التواصل</div>
          <div v-for="(c, i) in s.contacts" :key="i" style="font-size: .88rem; padding: 4px 0"><b>{{ c.name }}</b> {{ c.title ? `· ${c.title}` : '' }} <span dir="ltr">{{ c.phone }}</span> <span dir="ltr">{{ c.email }}</span> <span v-if="c.authorized" class="pc-okflag">مفوض</span></div>
        </template>
        <template v-if="s.branches.length">
          <div class="pc-sec">الفروع</div>
          <div v-for="(b, i) in s.branches" :key="i" style="font-size: .88rem; padding: 4px 0"><b>{{ b.name }}</b> · {{ [b.city, b.address].filter(Boolean).join('، ') }} <span dir="ltr">{{ b.phone }}</span></div>
        </template>
      </section>

      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2>اكتمال الملف</h2>
          <ul class="pc-check">
            <li v-for="d in s.checklist.docs" :key="d.key" :class="d.uploaded && d.status === 'accepted' && !d.expired ? 'ok' : d.required ? 'bad' : ''">
              <span>{{ d.name }}<small v-if="d.required" class="pm-muted"> · مطلوب</small></span>
              <span class="st">
                <span v-if="!d.uploaded" class="pm-muted">لم يُرفع</span>
                <span v-else-if="d.expired" class="pc-flag">منتهي</span>
                <span v-else class="pc-chip" :style="{ '--c': DOC_COLOR[d.status] }">{{ lk.docStatus[d.status] }}</span>
              </span>
            </li>
          </ul>
          <p v-if="s.checklist.missingProfile.length" class="pc-flag" style="margin-top: 8px; white-space: normal">ناقص: {{ s.checklist.missingProfile.join('، ') }}</p>
          <p v-if="s.checklist.complete" class="pc-okflag" style="margin-top: 8px">✓ الملف مكتمل</p>
        </section>

        <section v-if="can(P.approveSuppliers) && s.status === 'pending'" class="card pm-panel">
          <h2>قرار الاعتماد</h2>
          <p class="pm-muted" style="font-size: .85rem">لا يُعتمد المورد إلا بملف مكتمل ومستندات مطلوبة مقبولة وسارية.</p>
          <textarea v-model="note" class="input" rows="2" placeholder="ملاحظة للمورد (إلزامية عند الإعادة أو الرفض)" />
          <div class="pc-inline" style="margin-top: 8px">
            <button class="btn btn-primary" :disabled="busy || !s.checklist.complete" @click="decide('approve')">اعتماد</button>
            <button class="btn" :disabled="busy" @click="decide('return')">إعادة للاستكمال</button>
            <button class="btn btn-danger" :disabled="busy" @click="decide('reject')">رفض</button>
          </div>
        </section>

        <section class="card pm-panel">
          <h2>الربط بالنظام المالي</h2>
          <template v-if="s.partner">
            <p>مرتبط بحساب المورد <b class="pc-code">{{ s.partner.code }}</b> {{ s.partner.name }}</p>
            <button v-if="can(P.suppliers)" class="btn btn-sm" :disabled="busy" @click="unlinkPartner">فك الربط</button>
          </template>
          <template v-else>
            <p class="pm-muted" style="font-size: .86rem">يُنشأ حساب المورد في النظام المالي تلقائيًا عند الاعتماد إذا حُددت الإعدادات المحاسبية، أو أنشئه الآن.</p>
            <button v-if="can(P.suppliers) && s.status === 'approved'" class="btn btn-sm" :disabled="busy" @click="createPartner">إنشاء حساب المورد في المالي</button>
          </template>
        </section>
      </div>
    </div>

    <div v-else-if="tab === 'docs'">
      <div class="card table-wrap">
        <table class="table">
          <thead><tr><th>المستند</th><th>الرقم</th><th>الانتهاء</th><th>الحالة</th><th>رفعه</th><th /></tr></thead>
          <tbody>
            <tr v-for="d in s.docs" :key="d.id" :class="{ off: !d.isCurrent }">
              <td><button class="pm-link" style="background: none; border: 0; cursor: pointer; font: inherit; font-weight: 700" @click="openDoc(d)">{{ d.title }}</button>
                <small v-if="!d.isCurrent" class="pm-muted"> (نسخة سابقة)</small></td>
              <td class="pc-code">{{ d.number ?? '—' }}</td>
              <td><span v-if="d.expired" class="pc-flag">{{ fmtDate(d.expiryDate) }}</span><span v-else-if="d.expiring" class="pc-warn">{{ fmtDate(d.expiryDate) }}</span><span v-else>{{ fmtDate(d.expiryDate) }}</span></td>
              <td><span class="pc-chip" :style="{ '--c': DOC_COLOR[d.status] }">{{ d.statusLabel }}</span><small v-if="d.reviewNote" class="pm-muted" style="display: block">{{ d.reviewNote }}</small></td>
              <td style="font-size: .82rem">{{ d.uploadedByName }}<small class="pm-muted" style="display: block">{{ d.uploadedVia === 'portal' ? 'البوابة' : 'موظف' }} · {{ fmtDateTime(d.createdAt) }}</small></td>
              <td style="min-width: 230px">
                <div v-if="d.isCurrent && d.status === 'pending' && can(P.approveSuppliers)" class="pc-inline">
                  <input v-model="reviewNotes[d.id]" class="input" placeholder="ملاحظة" />
                  <button class="btn btn-sm btn-primary" :disabled="busy" @click="reviewDoc(d, 'accept')">قبول</button>
                  <button class="btn btn-sm" :disabled="busy" @click="reviewDoc(d, 'reject')">رفض</button>
                </div>
                <button v-else-if="can(P.suppliers) && d.status !== 'accepted'" class="btn btn-sm" :disabled="busy" @click="removeDoc(d)">حذف</button>
              </td>
            </tr>
            <tr v-if="!s.docs.length"><td colspan="6" class="pc-empty">لم تُرفع مستندات</td></tr>
          </tbody>
        </table>
      </div>
      <section v-if="can(P.suppliers)" class="card pm-panel" style="margin-top: 14px">
        <h2>رفع مستند</h2>
        <form class="pc-fields" @submit.prevent="addDoc">
          <label class="field"><span>نوع المستند *</span><select v-model="doc.docType" class="input" required><option value="" disabled>اختر</option><option v-for="t in docTypes" :key="t.key" :value="t.key">{{ t.name }}</option></select></label>
          <label class="field"><span>الرقم</span><input v-model="doc.number" class="input" dir="ltr" /></label>
          <label class="field"><span>تاريخ الإصدار</span><input v-model="doc.issueDate" class="input" type="date" /></label>
          <label v-if="docType?.hasExpiry" class="field"><span>تاريخ الانتهاء *</span><input v-model="doc.expiryDate" class="input" type="date" required /></label>
          <label class="field"><span>الملف (PDF أو صورة) *</span><input class="input" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required @change="pickFile($event, doc)" /></label>
          <div class="field" style="justify-content: flex-end"><button class="btn btn-primary" :disabled="busy">رفع</button></div>
        </form>
      </section>
    </div>

    <div v-else-if="tab === 'banks'">
      <p class="alert alert-info">لا يُعتمد الحساب البنكي إلا من موظف غير الذي سجّله، ويصبح المعتمد هو الحساب الرئيسي ويتوقف السابق.</p>
      <div class="card table-wrap">
        <table class="table">
          <thead><tr><th>البنك</th><th>الآيبان</th><th>صاحب الحساب</th><th>الحالة</th><th>الطلب</th><th /></tr></thead>
          <tbody>
            <tr v-for="b in s.banks" :key="b.id" :class="{ off: b.status === 'inactive' || b.status === 'rejected' }">
              <td><b>{{ b.bankName }}</b> <span v-if="b.isPrimary" class="pc-okflag">الرئيسي</span></td>
              <td class="pc-code">{{ ibanView(b.iban) }}</td>
              <td>{{ b.accountName }}</td>
              <td><span class="pc-chip" :style="{ '--c': BANK_COLOR[b.status] }">{{ b.statusLabel }}</span><small v-if="b.decisionNote" class="pm-muted" style="display: block">{{ b.decisionNote }}</small></td>
              <td style="font-size: .82rem">{{ b.requestedByName }}<small class="pm-muted" style="display: block">{{ b.requestedVia === 'portal' ? 'البوابة' : 'موظف' }} · {{ fmtDateTime(b.createdAt) }}</small>
                <button v-if="b.fileName" class="pm-link" style="background: none; border: 0; cursor: pointer; font: inherit; font-size: .8rem; padding: 0" @click="openBank(b)">خطاب البنك</button></td>
              <td style="min-width: 220px">
                <div v-if="b.status === 'pending' && can(P.approveBanks)" class="pc-inline">
                  <input v-model="reviewNotes[b.id]" class="input" placeholder="ملاحظة" />
                  <button class="btn btn-sm btn-primary" :disabled="busy" @click="decideBank(b, 'approve')">اعتماد</button>
                  <button class="btn btn-sm" :disabled="busy" @click="decideBank(b, 'reject')">رفض</button>
                </div>
              </td>
            </tr>
            <tr v-if="!s.banks.length"><td colspan="6" class="pc-empty">لا يوجد حساب بنكي</td></tr>
          </tbody>
        </table>
      </div>
      <section v-if="can(P.suppliers)" class="card pm-panel" style="margin-top: 14px">
        <h2>طلب حساب بنكي جديد أو تغييره</h2>
        <form class="pc-fields" @submit.prevent="addBank">
          <label class="field"><span>البنك *</span><input v-model="bank.bankName" class="input" required /></label>
          <label class="field"><span>الآيبان *</span><input v-model="bank.iban" class="input" dir="ltr" required placeholder="SA.." /></label>
          <label class="field"><span>اسم صاحب الحساب *</span><input v-model="bank.accountName" class="input" required /></label>
          <label class="field"><span>خطاب البنك</span><input class="input" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" @change="pickFile($event, bank)" /></label>
          <div class="field" style="justify-content: flex-end"><button class="btn btn-primary" :disabled="busy">إرسال للاعتماد</button></div>
        </form>
      </section>
    </div>

    <div v-else-if="tab === 'users'">
      <p class="pm-muted">رابط البوابة: <span class="pc-code" style="word-break: break-all">{{ s.portalUrl }}</span></p>
      <div class="card table-wrap">
        <table class="table">
          <thead><tr><th>المستخدم</th><th>البريد</th><th>الدور</th><th>آخر دخول</th><th /></tr></thead>
          <tbody>
            <tr v-for="u in s.users" :key="u.id" :class="{ off: !u.isActive }">
              <td><b>{{ u.fullName }}</b> <span v-if="!u.isActive" class="pc-flag">موقوف</span><span v-else-if="u.mustChangePassword" class="pc-warn">كلمة مؤقتة</span></td>
              <td dir="ltr" style="text-align: start">{{ u.email }}</td>
              <td>{{ u.roleLabel }}</td>
              <td style="font-size: .82rem">{{ fmtDateTime(u.lastLoginAt) }}</td>
              <td v-if="can(P.suppliers)" style="white-space: nowrap">
                <button class="btn btn-sm" :disabled="busy" @click="resetUser(u)">كلمة مؤقتة</button>
                <button class="btn btn-sm" :disabled="busy" @click="setActive(u, !u.isActive)">{{ u.isActive ? 'إيقاف' : 'تفعيل' }}</button>
              </td><td v-else />
            </tr>
            <tr v-if="!s.users.length"><td colspan="5" class="pc-empty">لا توجد حسابات في البوابة لهذا المورد</td></tr>
          </tbody>
        </table>
      </div>
      <section v-if="can(P.suppliers)" class="card pm-panel" style="margin-top: 14px">
        <h2>إنشاء حساب في البوابة</h2>
        <form class="pc-fields" @submit.prevent="inviteUser">
          <label class="field"><span>الاسم *</span><input v-model="invite.fullName" class="input" required /></label>
          <label class="field"><span>البريد *</span><input v-model="invite.email" class="input" dir="ltr" type="email" required /></label>
          <label class="field"><span>الجوال</span><input v-model="invite.phone" class="input" dir="ltr" /></label>
          <label class="field"><span>الدور</span><select v-model="invite.role" class="input"><option v-for="(l, k) in lk.portalRoles" :key="k" :value="k">{{ l }}</option></select></label>
          <div class="field" style="justify-content: flex-end"><button class="btn btn-primary" :disabled="busy">إنشاء وإرسال</button></div>
        </form>
      </section>
    </div>

    <div v-else class="pc-grid">
      <section class="card pm-panel">
        <h2>سجل الإجراءات</h2>
        <ul class="pc-log"><li v-for="(l, k) in [...s.log].reverse()" :key="k"><div><b>{{ l.action }}</b> <span v-if="l.note">· {{ l.note }}</span><small>{{ l.byName }} · {{ fmtDateTime(l.at) }}</small></div></li></ul>
      </section>
      <section class="card pm-panel">
        <h2>نشاط البوابة</h2>
        <p v-if="!s.events.length" class="pc-empty">لا يوجد نشاط</p>
        <ul class="pc-log"><li v-for="e in s.events" :key="e.id"><div><b>{{ EVENT[e.event] ?? e.event }}</b> <span v-if="e.detail">· {{ e.detail }}</span><small>{{ e.userName ?? '—' }} · {{ fmtDateTime(e.at) }}</small></div></li></ul>
      </section>
    </div>

    <div v-if="editing" class="modal-backdrop" @click.self="editing = false">
      <form class="card modal modal-wide" @submit.prevent="saveEdit">
        <h2>تعديل بيانات المورد</h2>
        <SupplierFields v-model="form" :entity-types="lk.entityTypes" :supplier-kinds="lk.supplierKinds" :categories="lk.categories" :activities="lk.settings.activities" />
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ</button><button type="button" class="btn" @click="editing = false">إلغاء</button></div>
      </form>
    </div>
    <div v-if="suspending" class="modal-backdrop" @click.self="suspending = false">
      <form class="card modal" @submit.prevent="doSuspend">
        <h2>إيقاف التعامل مع المورد</h2>
        <label class="field"><span>السبب *</span><textarea v-model="reason" class="input" rows="3" required minlength="3" /></label>
        <div class="modal-actions"><button class="btn btn-danger" :disabled="busy">إيقاف</button><button type="button" class="btn" @click="suspending = false">إلغاء</button></div>
      </form>
    </div>
    <div v-if="temp" class="modal-backdrop">
      <div class="card modal">
        <h2>كلمة مرور مؤقتة</h2>
        <p class="pm-muted">تظهر مرة واحدة فقط. أرسلها للمورد، وسيُطلب منه تغييرها عند أول دخول.</p>
        <pre style="white-space: pre-wrap; background: var(--surface-2); padding: 12px; border-radius: 10px; font: inherit">{{ tempText }}</pre>
        <div class="modal-actions"><button class="btn btn-primary" @click="copyTemp">نسخ الرسالة</button><button class="btn" @click="temp = null">تم</button></div>
      </div>
    </div>
  </div>
</template>
