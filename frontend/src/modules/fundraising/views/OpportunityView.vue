<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, openProtectedFile } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import StageStepper from '../../beneficiaries/components/StageStepper.vue';
import JournalEntryCard from '../components/JournalEntryCard.vue';
import OpportunityReviewSheet from '../components/OpportunityReviewSheet.vue';
import { color, fmtDate, fmtDateTime, fmtNo, hijri, label, sar, today } from '../labels';
import type { Opportunity, Settings } from '../types';
import '../fr.css';

const route = useRoute();
const router = useRouter();
const session = useSession();
const toast = useToast();
const o = ref<Opportunity | null>(null);
const banks = ref<Settings['banks']>([]);
const error = ref('');
const tab = ref<'batches' | 'conditions' | 'documents' | 'log' | 'journal'>('batches');
const busy = ref(false);
const review = ref(false);

async function load() {
  try {
    o.value = await api<Opportunity>(`/fundraising/opportunities/${route.params.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await load();
  // ?review=1 يفتح الفرصة كاملة مباشرة (من قوائم الاعتماد والتنبيهات)
  if (route.query.review && o.value) review.value = true;
  const s = await api<Settings>('/fundraising/settings').catch(() => null);
  banks.value = s?.banks.filter((b) => b.isActive) ?? [];
  collect.bankAccountId = banks.value[0]?.id ?? '';
});

const editable = computed(() => {
  const x = o.value;
  if (!x || !session.can('fundraising.opportunities.create')) return false;
  return x.status === 'returned' || (x.status === 'in_progress' && !x.actions.some((a) => a.action === 'approve'));
});

// ---- القرار ----
const decision = reactive({ mode: null as null | 'approve' | 'return' | 'reject', notes: '' });
const currentStage = computed(() => o.value?.stages.find((s) => s.id === o.value?.currentStageId) ?? null);
async function decide() {
  if (!o.value || !decision.mode) return;
  busy.value = true;
  try {
    o.value = await api<Opportunity>(`/fundraising/opportunities/${o.value.id}/decision`, { method: 'POST', json: { decision: decision.mode, notes: decision.notes || null } });
    toast.success(decision.mode === 'approve' ? (o.value.status === 'approved' ? 'اعتُمدت الفرصة نهائيًا وصدر القيد' : 'تمت الموافقة وانتقلت الفرصة للمرحلة التالية') : decision.mode === 'return' ? 'أُعيدت الفرصة للتعديل' : 'رُفضت الفرصة');
    decision.mode = null;
    decision.notes = '';
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}

// ---- سداد الوعد ----
const collect = reactive({ open: false, date: today(), amount: null as number | null, bankAccountId: '', transferReference: '' });
const outstanding = computed(() => (o.value ? Math.round((o.value.totalAmount - o.value.collectedAmount) * 100) / 100 : 0));
async function saveCollect() {
  if (!o.value) return;
  busy.value = true;
  try {
    o.value = await api<Opportunity>(`/fundraising/opportunities/${o.value.id}/collections`, { method: 'POST', json: { ...collect, open: undefined, transferReference: collect.transferReference || null } });
    toast.success('تم تسجيل السداد وإصدار سند القبض والقيد');
    collect.open = false;
    collect.amount = null;
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}

// ---- المستندات ----
const doc = reactive({ title: '', file: null as File | null });
async function upload() {
  if (!o.value || !doc.file) return;
  busy.value = true;
  try {
    const fd = new FormData();
    fd.append('title', doc.title || doc.file.name);
    fd.append('file', doc.file);
    o.value = await api<Opportunity>(`/fundraising/opportunities/${o.value.id}/documents`, { method: 'POST', body: fd });
    toast.success('تم إرفاق المستند');
    doc.title = '';
    doc.file = null;
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function removeDoc(id: string) {
  if (!o.value || !confirm('حذف المستند؟')) return;
  try {
    o.value = await api<Opportunity>(`/fundraising/opportunities/${o.value.id}/documents/${id}`, { method: 'DELETE' });
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const openDoc = (id: string) => openProtectedFile(`/fundraising/opportunities/${o.value!.id}/documents/${id}`).catch((e) => toast.error((e as Error).message));

const batchTotals = computed(() => {
  const b = o.value?.batches ?? [];
  return { reserved: b.reduce((s, x) => s + x.reservedAmount, 0), spent: b.reduce((s, x) => s + x.spentAmount, 0), net: b.reduce((s, x) => s + x.net, 0) };
});
const cats = (c: string[]) => (c.length ? c.map((x) => label('category', x)).join('، ') : 'كل الفئات');
</script>

<template>
  <div v-if="o">
    <section class="fr-hero">
      <div>
        <p class="kicker">فرصة تبرع {{ fmtNo('FR', o.opportunityNo) }} · {{ label('kind', o.kind) }} <span v-if="o.isZakat" class="fr-zakat">زكاة</span></p>
        <h1>{{ sar(o.totalAmount) }}</h1>
        <p class="sub">
          من <RouterLink v-if="o.donor" :to="`/fundraising/donors/${o.donor.id}`" class="donor-link">{{ o.donor.name }}</RouterLink>
          · {{ fmtDate(o.date) }} ({{ hijri(o.date) }})
          <template v-if="o.supportManagerName"> · مدير الدعم: {{ o.supportManagerName }}</template>
        </p>
      </div>
      <div class="fr-hero-actions">
        <span class="fr-badge status" :style="{ '--c': color('status', o.status) }">{{ label('status', o.status) }}</span>
        <button class="btn btn-ghost-light" @click="review = true">📄 عرض الفرصة كاملة</button>
        <RouterLink v-if="editable" :to="`/fundraising/opportunities/${o.id}/edit`" class="btn btn-ghost-light">{{ o.status === 'returned' ? 'تعديل وإعادة التقديم' : 'تعديل' }}</RouterLink>
        <RouterLink v-if="o.receiptNo" :to="`/fundraising/opportunities/${o.id}/receipt`" class="btn btn-gold">سند القبض رقم {{ o.receiptNo }}</RouterLink>
      </div>
    </section>

    <section v-if="o.stages.length" class="fr-panel stepper-panel">
      <StageStepper :stages="o.stages.map((s) => ({ id: s.id!, name: s.name }))" :current-id="o.currentStageId" :status="o.status" />
      <p v-if="o.status === 'returned'" class="returned">أُعيدت الفرصة لمُنشئها للتعديل: {{ o.actions.filter((a) => a.action === 'return').at(-1)?.notes }}</p>
    </section>

    <!-- صندوق القرار -->
    <section v-if="o.canDecide" class="fr-panel decide">
      <h2>قرارك في مرحلة "{{ o.stageName }}" <button class="btn btn-primary btn-sm push" @click="review = true">📄 مراجعة الفرصة كاملة واتخاذ القرار</button></h2>
      <p v-if="currentStage?.instructions" class="muted">{{ currentStage.instructions }}</p>
      <div class="dec-btns">
        <button :class="['dec', 'ok', { on: decision.mode === 'approve' }]" @click="decision.mode = 'approve'">✓ موافقة</button>
        <button v-if="currentStage?.canReturn !== false" :class="['dec', 'ret', { on: decision.mode === 'return' }]" @click="decision.mode = 'return'">↺ طلب تعديل</button>
        <button v-if="currentStage?.canReject !== false" :class="['dec', 'bad', { on: decision.mode === 'reject' }]" @click="decision.mode = 'reject'">✕ رفض</button>
      </div>
      <div v-if="decision.mode" class="dec-form">
        <textarea v-model="decision.notes" class="input" rows="2" :placeholder="decision.mode === 'approve' ? 'ملاحظات (اختياري)' : decision.mode === 'reject' ? 'سبب الرفض (إلزامي)' : 'المطلوب تعديله (إلزامي)'" />
        <button class="btn btn-primary" :disabled="busy" @click="decide">تأكيد القرار</button>
      </div>
    </section>

    <div class="fr-kpis">
      <div class="fr-kpi" style="--a: #14b8a6; --i: 0"><span class="k-label">الدفعات</span><strong>{{ o.batches.length }}</strong><span class="k-foot">{{ o.batches[0] ? `من ${fmtNo('B', o.batches[0].batchNo)}` : '' }}</span></div>
      <div class="fr-kpi" style="--a: #f59e0b; --i: 1"><span class="k-label">محجوز</span><strong>{{ sar(batchTotals.reserved) }}</strong><span class="k-foot">محمّل على طلبات دون صرف</span></div>
      <div class="fr-kpi" style="--a: #0f766e; --i: 2"><span class="k-label">مخصوم</span><strong>{{ sar(batchTotals.spent) }}</strong><span class="k-foot">صُرف من المالية</span></div>
      <div class="fr-kpi" style="--a: #10b981; --i: 3"><span class="k-label">صافي متاح</span><strong>{{ sar(batchTotals.net) }}</strong><span class="k-foot">للتحميل أو المناقلة</span></div>
      <div v-if="o.kind === 'pledge'" class="fr-kpi" style="--a: #8b5cf6; --i: 4"><span class="k-label">المتبقي على الوعد</span><strong>{{ sar(outstanding) }}</strong><span class="k-foot">سُدد {{ sar(o.collectedAmount) }}</span></div>
    </div>

    <nav class="fr-tabs">
      <button :class="['fr-tab', { on: tab === 'batches' }]" @click="tab = 'batches'">الدفعات</button>
      <button :class="['fr-tab', { on: tab === 'conditions' }]" @click="tab = 'conditions'">البيانات والاشتراطات</button>
      <button :class="['fr-tab', { on: tab === 'documents' }]" @click="tab = 'documents'">المستندات ({{ o.documents.length }})</button>
      <button :class="['fr-tab', { on: tab === 'log' }]" @click="tab = 'log'">سجل الأنشطة ({{ o.actions.length }})</button>
      <button :class="['fr-tab', { on: tab === 'journal' }]" @click="tab = 'journal'">القيود ({{ o.entries.length }})</button>
    </nav>

    <Transition name="page" mode="out-in">
      <div v-if="tab === 'batches'" key="b">
        <div class="card table-wrap">
          <table class="table">
            <thead><tr><th>رقم الدفعة</th><th>التصنيف</th><th>الجهة</th><th>التوزيع</th><th>المبلغ</th><th>محجوز</th><th>مخصوم</th><th>صافي</th><th>الحالة</th></tr></thead>
            <tbody>
              <tr v-for="b in o.batches" :key="b.id" class="fr-row-link" @click="router.push(`/fundraising/batches/${b.id}`)">
                <td><span class="fr-no">{{ fmtNo('B', b.batchNo) }}</span></td>
                <td><span class="fr-badge" :style="{ '--c': color('target', b.isZakat ? 'zakat' : b.targetKind) }">{{ b.isZakat ? 'زكاة' : label('target', b.targetKind) }}</span></td>
                <td class="wrap">{{ b.targetName }}
                  <RouterLink v-if="b.beneficiaryRequestId" :to="`/beneficiaries/requests/${b.beneficiaryRequestId}`" class="small-link" @click.stop>عرض الطلب ←</RouterLink></td>
                <td>{{ b.allocationMode === 'percent' ? `${b.percent}%` : 'مبلغ' }}</td>
                <td class="fr-amount">{{ sar(b.amount) }}</td><td>{{ sar(b.reservedAmount) }}</td><td>{{ sar(b.spentAmount) }}</td><td><b>{{ sar(b.net) }}</b></td>
                <td><span class="fr-badge" :style="{ '--c': color('batch', b.status) }">{{ label('batch', b.status) }}</span><span v-if="b.isPromised" class="muted" title="وعد بالدفع: يُصرف قبل السداد ويبقى مستحقًا على الداعم"> · تبرع آجل</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <section v-if="o.kind === 'pledge' && o.status === 'approved'" class="fr-panel collect">
          <h2>دفعات سداد الوعد <span class="muted">· المستحق على الداعم {{ sar(outstanding) }}</span>
            <button v-if="outstanding > 0 && session.can('fundraising.pledges.collect')" class="btn btn-primary btn-sm push" @click="collect.open = !collect.open; collect.amount = outstanding">+ إضافة دفعة سداد</button></h2>
          <div v-if="collect.open" class="collect-form">
            <input v-model="collect.date" type="date" class="input" />
            <input v-model.number="collect.amount" type="number" min="0.01" step="0.01" class="input" placeholder="المبلغ" />
            <select v-model="collect.bankAccountId" class="input"><option v-for="b in banks" :key="b.id" :value="b.id">{{ b.bankName }} · {{ b.iban || b.accountNumber }}</option></select>
            <input v-model="collect.transferReference" class="input" placeholder="رقم الحوالة" dir="ltr" />
            <button class="btn btn-primary" :disabled="busy" @click="saveCollect">حفظ وإصدار سند قبض</button>
          </div>
          <table v-if="o.collections.length" class="table">
            <thead><tr><th>سند القبض</th><th>التاريخ</th><th>المبلغ</th><th>البنك</th><th>المرجع</th><th /></tr></thead>
            <tbody>
              <tr v-for="c in o.collections" :key="c.id">
                <td><span class="fr-no">{{ c.receiptNo }}</span></td><td>{{ fmtDate(c.collectedOn) }}</td><td class="fr-amount">{{ sar(c.amount) }}</td><td>{{ c.bankName }}</td>
                <td dir="ltr">{{ c.transferReference ?? '—' }}</td>
                <td><RouterLink :to="{ path: `/fundraising/opportunities/${o.id}/receipt`, query: { collection: c.id } }" class="btn btn-sm">طباعة السند</RouterLink></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="fr-empty">لم يسدد الداعم شيئًا بعد</p>
        </section>
      </div>

      <section v-else-if="tab === 'conditions'" key="c" class="fr-panel">
        <dl class="fr-kv">
          <div><dt>الحساب البنكي</dt><dd>{{ o.bankAccount ? `${o.bankAccount.bankName} · ${o.bankAccount.iban || o.bankAccount.accountNumber}` : '—' }}</dd></div>
          <div><dt>رقم الحوالة</dt><dd dir="ltr">{{ o.transferReference ?? '—' }}</dd></div>
          <div><dt>يقبل مساهمة المستفيد</dt><dd>{{ o.conditions.acceptsPatientContribution ? 'نعم' : 'لا' }}</dd></div>
          <div><dt>الحد الأعلى للصرف</dt><dd>{{ o.conditions.maxSpend ? sar(o.conditions.maxSpend) : 'بدون حد' }}</dd></div>
          <div><dt>الفئات</dt><dd>{{ cats(o.conditions.categories) }}</dd></div>
          <div><dt>الجنسيات</dt><dd>{{ o.conditions.nationalities.length ? o.conditions.nationalities.join('، ') : 'كل الجنسيات' }}</dd></div>
          <div><dt>تاريخ انتهاء المشروع</dt><dd>{{ o.conditions.endDate ? `${fmtDate(o.conditions.endDate)} (${hijri(o.conditions.endDate)})` : '—' }}</dd></div>
          <div><dt>سجّلها</dt><dd>{{ o.createdByName ?? '—' }} · {{ fmtDateTime(o.createdAt) }}</dd></div>
        </dl>
        <template v-if="o.inKindDescription"><h3 class="sec">وصف التبرع العيني</h3><p class="text">{{ o.inKindDescription }}</p></template>
        <template v-if="o.conditionsText"><h3 class="sec">اشتراطات وإضافات</h3><p class="text">{{ o.conditionsText }}</p></template>
      </section>

      <section v-else-if="tab === 'documents'" key="d" class="fr-panel">
        <div v-if="session.can('fundraising.opportunities.create')" class="upload">
          <input v-model="doc.title" class="input" placeholder="اسم المستند، مثل: اتفاقية الدعم" />
          <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" class="input" @change="doc.file = ($event.target as HTMLInputElement).files?.[0] ?? null" />
          <button class="btn btn-primary" :disabled="!doc.file || busy" @click="upload">إرفاق</button>
        </div>
        <div class="docs">
          <div v-for="d in o.documents" :key="d.id" class="doc">
            <span class="doc-ic">{{ d.mimeType === 'application/pdf' ? 'PDF' : 'IMG' }}</span>
            <div class="grow"><b>{{ d.title }}</b><small class="muted">{{ d.fileName }} · {{ Math.ceil(d.sizeBytes / 1024) }} ك.ب · {{ d.uploadedByName }} · {{ fmtDateTime(d.createdAt) }}</small></div>
            <button class="btn btn-sm" @click="openDoc(d.id)">فتح</button>
            <button v-if="session.can('fundraising.opportunities.create')" class="btn btn-sm btn-danger" @click="removeDoc(d.id)">حذف</button>
          </div>
        </div>
        <p v-if="!o.documents.length" class="fr-empty">لا توجد مستندات. أرفق الاتفاقيات أو إشعارات التحويل (PDF أو صور حتى 10 ميجابايت)</p>
      </section>

      <section v-else-if="tab === 'log'" key="l" class="fr-panel">
        <ol class="timeline">
          <li v-for="a in o.actions" :key="a.id" :style="{ '--c': color('action', a.action) }">
            <span class="dot" />
            <div><b>{{ label('action', a.action) }}</b><small v-if="a.stageName" class="muted"> · {{ a.stageName }}</small>
              <p v-if="a.notes" class="note">{{ a.notes }}</p>
              <small class="muted">{{ a.actorName }} · {{ fmtDateTime(a.createdAt) }}</small></div>
          </li>
        </ol>
      </section>

      <section v-else key="j" class="journal">
        <JournalEntryCard v-for="e in o.entries" :key="e.id" :entry="e" />
        <p v-if="!o.entries.length" class="fr-empty card">يصدر القيد عند الاعتماد النهائي للفرصة</p>
      </section>
    </Transition>
    <OpportunityReviewSheet v-if="review" :opp="o" @close="review = false" @decided="(r) => { o = r; review = false; }" />
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
  <div v-else class="fr-skeleton" />
</template>

<style scoped>
.donor-link { color: #fde68a; font-weight: 600; }
.status { background: rgba(255,255,255,.12); color: #fff; padding: 4px 14px; font-size: .86rem; }
.stepper-panel { margin-bottom: 16px; }
.returned { margin: 12px 0 0; padding: 8px 12px; border-radius: 10px; background: #fef3c7; color: #92400e; }
.decide { margin-bottom: 16px; border: 1px solid #99f6e4; box-shadow: 0 0 0 4px rgba(20,184,166,.08), 0 12px 30px rgba(20,184,166,.12); }
.dec-btns { display: flex; gap: 10px; flex-wrap: wrap; }
.dec { font: inherit; font-weight: 700; padding: 10px 22px; border-radius: 12px; border: 2px solid var(--border); background: var(--surface); cursor: pointer; transition: all .2s; }
.dec.ok { --c: #10b981; } .dec.ret { --c: #f59e0b; } .dec.bad { --c: #ef4444; }
.dec:hover, .dec.on { border-color: var(--c); color: var(--c); }
.dec.on { background: color-mix(in srgb, var(--c) 10%, var(--surface)); box-shadow: 0 0 18px color-mix(in srgb, var(--c) 35%, transparent); }
.dec-form { display: flex; gap: 10px; margin-top: 12px; align-items: flex-start; }
.dec-form textarea { flex: 1; }
.wrap { white-space: normal; min-width: 220px; }
.small-link { display: block; font-size: .78rem; }
.collect { margin-top: 16px; }
.push { margin-inline-start: auto; }
.collect-form { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.collect-form .input { width: auto; flex: 1; min-width: 140px; }
.sec { font-size: .92rem; margin: 18px 0 6px; color: var(--primary); }
.text { white-space: pre-wrap; margin: 0; padding: 10px 14px; border-radius: 10px; background: var(--surface-2); }
.upload { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.upload .input { flex: 1; min-width: 200px; }
.docs { display: flex; flex-direction: column; gap: 8px; }
.doc { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; }
.doc small { display: block; }
.doc-ic { width: 42px; height: 42px; border-radius: 10px; display: grid; place-items: center; font-size: .72rem; font-weight: 700; color: #fff; background: linear-gradient(135deg, #f87171, #b91c1c); }
.grow { flex: 1; min-width: 0; }
.timeline { list-style: none; margin: 0; padding: 0; position: relative; }
.timeline::before { content: ''; position: absolute; top: 6px; bottom: 6px; inset-inline-start: 7px; width: 2px; background: var(--border); }
.timeline li { position: relative; display: flex; gap: 14px; padding: 0 0 16px; animation: fr-rise .35s var(--ease) both; }
.timeline .dot { width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0; background: var(--c); box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 18%, transparent), 0 0 12px var(--c); position: relative; z-index: 1; margin-top: 3px; }
.note { margin: 4px 0; padding: 6px 10px; border-radius: 8px; background: var(--surface-2); white-space: pre-wrap; }
.journal { display: flex; flex-direction: column; gap: 12px; }
@media (max-width: 600px) { .dec-form { flex-direction: column; align-items: stretch; } }
</style>
