<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import CountUp from '../../beneficiaries/components/CountUp.vue';
import NodeForm from '../components/NodeForm.vue';
import { ACTIONS, color, fmtDate, label, links, pct, sar } from '../labels';
import type { Allocation, Amendment, Batch, LedgerEntry, Payment, Stage, Transfer, TreeNode } from '../types';
import '../projects.css';

interface Page extends TreeNode {
  program: { id: string; name: string }; axis: { id: string; name: string };
  history: { id: string; kind: string; stageName: string | null; note: string | null; userName: string; createdAt: string }[];
  stages: Stage[]; canDecide: boolean;
  summary: { funds: number; available: number; reserved: number; spent: number; pendingPayments: number; transfersIn: number; transfersOut: number; requests: number; served: number };
  requests: { id: string; requestNo: number; status: string; estimatedCost: number | null; supportPercent: number | null; services: string[]; createdAt: string; beneficiaryId: string; beneficiaryName: string; fileNo: number; covered: number; spent: number }[];
  batches: Batch[];
  donors: { id: string; name: string | null; amount: number; net: number; opportunities: { id: string; no: number | null }[] }[];
  allocations: Allocation[]; payments: Payment[]; transfers: Transfer[]; amendments: Amendment[]; entries: LedgerEntry[];
}

const route = useRoute();
const session = useSession();
const toast = useToast();
const p = ref<Page | null>(null);
const error = ref('');
const tab = ref<'funds' | 'beneficiaries' | 'support' | 'moves' | 'journal' | 'info'>('funds');
const editing = ref(false);

async function load() {
  try {
    p.value = await api<Page>(`/projects/${route.params.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(() => route.params.id, (id) => { if (id) { p.value = null; load(); } });

const s = computed(() => p.value?.summary);
const total = computed(() => Math.max(1, (s.value?.spent ?? 0) + (s.value?.reserved ?? 0) + (s.value?.available ?? 0)));
const editable = computed(() => ['draft', 'returned', 'rejected'].includes(p.value?.approvalStatus ?? ''));

async function act(path: string, body: Record<string, unknown> = {}, ok = 'تم') {
  try {
    await api(`/projects/${p.value!.id}/${path}`, { method: 'POST', json: body });
    toast.success(ok);
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function decide(decision: 'approve' | 'reject' | 'return') {
  const note = decision === 'approve' ? '' : prompt(decision === 'reject' ? 'سبب الرفض' : 'المطلوب تعديله');
  if (decision !== 'approve' && !note) return;
  act('decision', { decision, note }, 'تم تسجيل القرار');
}
function reopen() {
  const note = prompt('سبب إعادة فتح المشروع للتعديل');
  if (note) act('reopen', { note }, 'أُعيد المشروع مسودة للتعديل');
}
async function saved() {
  editing.value = false;
  await load();
}
const cond = (b: Batch) => {
  const c = b.conditions ?? {};
  const out: string[] = [];
  if (b.isZakat) out.push('زكاة');
  if (c.maxSpend) out.push(`حد أعلى ${sar(c.maxSpend)}`);
  if (c.acceptsPatientContribution === false) out.push('لا يقبل مساهمة المستفيد');
  if (c.nationalities?.length) out.push(`الجنسيات: ${c.nationalities.join('، ')}`);
  if (c.categories?.length) out.push(`الفئات: ${c.categories.map((x) => label('residency', x)).join('، ')}`);
  if (c.endDate) out.push(`ينتهي ${fmtDate(c.endDate)}`);
  return out;
};
</script>

<template>
  <div v-if="p && s">
    <section class="pm-hero">
      <div>
        <p class="pm-kicker">{{ p.code }} · {{ p.axis.name }} ← {{ p.program.name }}</p>
        <h1>{{ p.name }}</h1>
        <p v-if="p.description" class="pm-sub">{{ p.description }}</p>
        <div class="chips">
          <span class="chip" :style="{ '--c': color('approval', p.approvalStatus) }">{{ label('approval', p.approvalStatus) }}<template v-if="p.currentStage">: {{ p.currentStage.name }}</template></span>
          <span class="chip" :style="{ '--c': color('funding', p.fundingType) }">{{ label('funding', p.fundingType) }}</span>
          <span v-if="p.zakatEligible" class="chip" style="--c: #34d399">ضمن الزكاة</span>
          <span class="chip" :style="{ '--c': color('mode', p.spendingMode) }">{{ label('mode', p.spendingMode) }}</span>
        </div>
      </div>
      <div class="pm-actions">
        <template v-if="p.canDecide">
          <button class="btn btn-glow" @click="decide('approve')">✓ موافقة</button>
          <button class="btn btn-ghost" @click="decide('return')">↩ طلب تعديل</button>
          <button class="btn btn-ghost" @click="decide('reject')">✕ رفض</button>
        </template>
        <button v-if="editable && session.can('projects.projects.manage')" class="btn btn-glow" @click="act('submit', {}, 'أُرسل المشروع للاعتماد')">إرسال للاعتماد</button>
        <RouterLink v-if="p.approvalStatus === 'approved' && session.can('projects.support.manage')" :to="{ path: '/projects/support', query: { project: p.id } }" class="btn btn-ghost">إدارة الدعم</RouterLink>
        <button v-if="session.can('projects.projects.manage')" class="btn btn-ghost" @click="editing = true">تعديل البيانات</button>
        <button v-if="p.approvalStatus === 'approved' && session.can('projects.projects.manage')" class="btn btn-ghost" @click="reopen">إعادة فتح للتعديل</button>
      </div>
    </section>

    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #6366f1; --i: 0"><span>الدعم الوارد</span><strong><CountUp :value="s.funds" :decimals="2" /></strong><small>ريال من {{ p.donors.length }} داعم<template v-if="p.budget"> · {{ pct(s.funds, p.budget) }}% من الميزانية</template></small></div>
      <div class="pm-kpi" style="--a: #f59e0b; --i: 1"><span>محجوز</span><strong><CountUp :value="s.reserved" :decimals="2" /></strong><small>محمّل ولم يُصرف بعد</small></div>
      <div class="pm-kpi" style="--a: #10b981; --i: 2"><span>مخصوم (مصروف)</span><strong><CountUp :value="s.spent" :decimals="2" /></strong><small>{{ pct(s.spent, s.funds) }}% من الدعم الوارد</small></div>
      <div class="pm-kpi" style="--a: #0ea5e9; --i: 3"><span>المتاح للتحميل</span><strong><CountUp :value="s.available" :decimals="2" /></strong><small>صافي رصيد دفعات المشروع</small></div>
      <div class="pm-kpi" style="--a: #ec4899; --i: 4"><span>المستفيدون</span><strong><CountUp :value="s.served" /></strong><small>من {{ s.requests }} طلب<template v-if="p.targetBeneficiaries"> · المستهدف {{ p.targetBeneficiaries }}</template></small></div>
    </div>

    <section class="card pm-panel flow">
      <div class="pm-bar big">
        <i :style="{ width: (s.spent / total) * 100 + '%', background: '#10b981' }" />
        <i :style="{ width: (s.reserved / total) * 100 + '%', background: '#f59e0b' }" />
        <i :style="{ width: (s.available / total) * 100 + '%', background: '#0ea5e9' }" />
      </div>
      <div class="pm-legend">
        <span style="--c: #10b981">مخصوم {{ sar(s.spent) }}</span><span style="--c: #f59e0b">محجوز {{ sar(s.reserved) }}</span><span style="--c: #0ea5e9">متاح {{ sar(s.available) }}</span>
        <span v-if="s.pendingPayments" style="--c: #a855f7">طلبات صرف قيد التنفيذ {{ sar(s.pendingPayments) }}</span>
        <span v-if="s.transfersIn" style="--c: #6366f1">منقول إليه {{ sar(s.transfersIn) }}</span>
        <span v-if="s.transfersOut" style="--c: #94a3b8">منقول منه {{ sar(s.transfersOut) }}</span>
      </div>
    </section>

    <nav class="pm-tabs">
      <button :class="['pm-tab', { on: tab === 'funds' }]" @click="tab = 'funds'">الدفعات والداعمون <b>{{ p.batches.length }}</b></button>
      <button :class="['pm-tab', { on: tab === 'beneficiaries' }]" @click="tab = 'beneficiaries'">المستفيدون <b>{{ p.requests.length }}</b></button>
      <button :class="['pm-tab', { on: tab === 'support' }]" @click="tab = 'support'">التحميل والصرف <b>{{ p.allocations.length }}</b></button>
      <button :class="['pm-tab', { on: tab === 'moves' }]" @click="tab = 'moves'">المناقلات والتعديلات <b>{{ p.transfers.length + p.amendments.length }}</b></button>
      <button :class="['pm-tab', { on: tab === 'journal' }]" @click="tab = 'journal'">القيود المالية <b>{{ p.entries.length }}</b></button>
      <button :class="['pm-tab', { on: tab === 'info' }]" @click="tab = 'info'">البيانات والاعتماد</button>
    </nav>

    <Transition name="page" mode="out-in">
      <div v-if="tab === 'funds'" key="f" class="cols">
        <section class="card pm-panel">
          <h2>الداعمون</h2>
          <p v-if="!p.donors.length" class="pm-empty">لا يوجد دعم مباشر على المشروع بعد</p>
          <div v-for="d in p.donors" :key="d.id" class="donor">
            <div class="grow">
              <RouterLink :to="links.donor(d.id)" class="pm-link">{{ d.name }}</RouterLink>
              <div class="pm-muted">
                الفرص:
                <template v-for="(o, i) in d.opportunities" :key="o.id"><RouterLink :to="links.opportunity(o.id)" class="pm-link">#{{ o.no }}</RouterLink> (<RouterLink :to="links.receipt(o.id)" class="pm-link">سند القبض</RouterLink>)<template v-if="i < d.opportunities.length - 1">، </template></template>
              </div>
            </div>
            <div class="end"><span class="pm-money">{{ sar(d.amount) }}</span><small class="pm-muted">متاح {{ sar(d.net) }}</small></div>
          </div>
        </section>
        <section class="card pm-panel wide">
          <h2>دفعات الداعمين على المشروع وبرنامجه</h2>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>الدفعة</th><th>الداعم</th><th>المستوى</th><th>المبلغ</th><th>محجوز</th><th>مخصوم</th><th>منقول</th><th>المتاح</th><th>اشتراطات الداعم</th></tr></thead>
              <tbody>
                <tr v-for="b in p.batches" :key="b.id">
                  <td><RouterLink :to="links.batch(b.id)" class="pm-link">#{{ b.batchNo }}</RouterLink><RouterLink :to="links.opportunity(b.opportunityId)" class="pm-muted">الفرصة #{{ b.opportunityNo }}</RouterLink></td>
                  <td><RouterLink :to="links.donor(b.donorId)">{{ b.donorName }}</RouterLink></td>
                  <td><span class="pm-tag">{{ b.level === 'project' ? 'المشروع' : 'البرنامج' }}</span></td>
                  <td class="pm-money">{{ sar(b.amount) }}</td><td>{{ sar(b.reservedAmount) }}</td><td>{{ sar(b.spentAmount) }}</td><td>{{ sar(b.transferredAmount) }}</td>
                  <td class="pm-money" style="color: var(--primary)">{{ sar(b.net) }}</td>
                  <td class="conds"><span v-for="c in cond(b)" :key="c" class="pm-tag">{{ c }}</span><span v-if="!cond(b).length" class="pm-muted">بدون اشتراطات</span></td>
                </tr>
                <tr v-if="!p.batches.length"><td colspan="9" class="pm-empty">لا توجد دفعات بعد. تُنشأ الدفعات تلقائيًا عند اعتماد فرص التبرع في نظام الموارد المالية.</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section v-else-if="tab === 'beneficiaries'" key="b" class="card pm-panel">
        <h2>طلبات المستفيدين على المشروع</h2>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>الطلب</th><th>المستفيد</th><th>الخدمات</th><th>الحالة</th><th>التكلفة</th><th>نسبة الجمعية</th><th>المحمّل</th><th>المصروف</th></tr></thead>
            <tbody>
              <tr v-for="r in p.requests" :key="r.id">
                <td><RouterLink :to="links.request(r.id)" class="pm-link">#{{ r.requestNo }}</RouterLink><span class="pm-muted">{{ fmtDate(r.createdAt) }}</span></td>
                <td><RouterLink :to="links.beneficiary(r.beneficiaryId)">{{ r.beneficiaryName }}</RouterLink><span class="pm-muted">ملف #{{ r.fileNo }}</span></td>
                <td>{{ r.services?.join('، ') || '—' }}</td>
                <td><span class="pm-pill" :style="{ '--c': color('request', r.status) }">{{ label('request', r.status) }}</span></td>
                <td>{{ r.estimatedCost === null ? '—' : sar(r.estimatedCost) }}</td><td>{{ r.supportPercent ?? 100 }}%</td>
                <td class="pm-money">{{ sar(r.covered) }}</td><td class="pm-money" style="color: var(--success)">{{ sar(r.spent) }}</td>
              </tr>
              <tr v-if="!p.requests.length"><td colspan="8" class="pm-empty">لا توجد طلبات على المشروع</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <div v-else-if="tab === 'support'" key="s" class="stack">
        <section class="card pm-panel">
          <h2>التحميلات على الدفعات <RouterLink v-if="session.can('projects.support.manage')" :to="{ path: '/projects/support', query: { project: p.id } }" class="btn btn-sm">إدارة الدعم</RouterLink></h2>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>#</th><th>النوع</th><th>المستفيد / الطلب</th><th>الدفعة والداعم</th><th>المحمّل</th><th>المصروف</th><th>المتبقي محجوزًا</th><th>الحالة</th></tr></thead>
              <tbody>
                <tr v-for="a in p.allocations" :key="a.id">
                  <td>{{ a.allocationNo }}<span class="pm-muted">{{ fmtDate(a.createdAt) }}</span></td>
                  <td>{{ a.kind === 'general' ? 'صرف عام' : 'طلب مستفيد' }}</td>
                  <td><template v-if="a.requestId"><RouterLink :to="links.beneficiary(a.beneficiaryId!)">{{ a.beneficiaryName }}</RouterLink><RouterLink :to="links.request(a.requestId)" class="pm-muted">طلب #{{ a.requestNo }}</RouterLink></template><template v-else>—</template></td>
                  <td><RouterLink :to="links.batch(a.batchId)" class="pm-link">#{{ a.batchNo }}</RouterLink><span class="pm-muted">{{ a.donorName }}</span></td>
                  <td class="pm-money">{{ sar(a.amount) }}</td><td>{{ sar(a.spentAmount) }}</td><td>{{ sar(a.remaining) }}</td>
                  <td><span class="pm-pill" :style="{ '--c': color('alloc', a.status) }">{{ label('alloc', a.status) }}</span></td>
                </tr>
                <tr v-if="!p.allocations.length"><td colspan="8" class="pm-empty">لا توجد تحميلات بعد</td></tr>
              </tbody>
            </table>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>طلبات الصرف والصرف المالي</h2>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>طلب الصرف</th><th>المستفيد من الصرف</th><th>الطريقة</th><th>المبلغ</th><th>الحالة</th><th>السند / الفاتورة</th></tr></thead>
              <tbody>
                <tr v-for="x in p.payments" :key="x.id">
                  <td>#{{ x.requestNo }}<span class="pm-muted">{{ fmtDate(x.createdAt) }} · {{ x.requestedByName }}</span></td>
                  <td>{{ x.payeeName }}</td><td>{{ label('method', x.method) }}</td><td class="pm-money">{{ sar(x.amount) }}</td>
                  <td><span class="pm-pill" :style="{ '--c': color('pay', x.status) }">{{ label('pay', x.status) }}</span><span v-if="x.rejectReason" class="pm-muted">{{ x.rejectReason }}</span></td>
                  <td>{{ x.referenceNo ?? '—' }}<span v-if="x.paidOn" class="pm-muted">{{ fmtDate(x.paidOn) }} · {{ x.executedByName }}</span></td>
                </tr>
                <tr v-if="!p.payments.length"><td colspan="6" class="pm-empty">لا توجد طلبات صرف</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div v-else-if="tab === 'moves'" key="m" class="stack">
        <section class="card pm-panel">
          <h2>المناقلات</h2>
          <p v-if="!p.transfers.length" class="pm-empty">لا توجد مناقلات على المشروع</p>
          <div v-for="t in p.transfers" :key="t.id" class="move">
            <span :class="['dir', t.targetActivityId === p.id ? 'in' : 'out']">{{ t.targetActivityId === p.id ? 'وارد' : 'صادر' }}</span>
            <div class="grow">
              <b>مناقلة #{{ t.transferNo }}</b> · {{ t.donorName }}
              <div class="pm-muted">
                من <RouterLink v-if="t.sourceActivityId" :to="links.project(t.sourceActivityId)">{{ t.sourceName }}</RouterLink> (<RouterLink :to="links.batch(t.sourceBatchId)">دفعة #{{ t.sourceBatchNo }}</RouterLink>)
                إلى <RouterLink :to="links.project(t.targetActivityId)">{{ t.targetName }}</RouterLink> (<RouterLink :to="links.batch(t.targetBatchId)">دفعة #{{ t.targetBatchNo }}</RouterLink>) · {{ t.reason }}
              </div>
            </div>
            <span class="pm-money">{{ sar(t.amount) }}</span>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>تعديلات فرص التبرع</h2>
          <p v-if="!p.amendments.length" class="pm-empty">لا توجد تعديلات</p>
          <div v-for="a in p.amendments" :key="a.id" class="move">
            <span class="dir am">تعديل</span>
            <div class="grow">
              <b>تعديل #{{ a.amendmentNo }}</b> على <RouterLink :to="links.opportunity(a.opportunityId)">الفرصة #{{ a.opportunityNo }}</RouterLink> · يسري من {{ fmtDate(a.effectiveDate) }}
              <div class="pm-muted">{{ a.reason }} · موافقة الداعم: {{ a.donorApprovalRef || 'نعم' }} · أقر به {{ a.acknowledgedByName }}</div>
            </div>
            <span class="pm-money">{{ sar(a.amount) }}</span>
          </div>
        </section>
      </div>

      <section v-else-if="tab === 'journal'" key="j" class="card pm-panel">
        <h2>القيود المالية المرتبطة بالمشروع <RouterLink :to="links.journal" class="btn btn-sm">دفتر اليومية</RouterLink></h2>
        <p v-if="!p.entries.length" class="pm-empty">لا توجد قيود بعد</p>
        <article v-for="e in p.entries" :key="e.id" class="entry">
          <header><b>قيد #{{ e.entryNo }}</b><span class="pm-muted">{{ fmtDate(e.date) }}</span><span v-if="e.status === 'reversed'" class="pm-tag">معكوس</span><span class="grow">{{ e.description }}</span><span class="pm-money">{{ sar(e.total) }}</span></header>
          <table class="lines">
            <tr v-for="l in e.lines" :key="l.id"><td dir="ltr" class="code">{{ l.accountCode }}</td><td>{{ l.accountName }}</td><td class="dr">{{ l.debit ? sar(l.debit) : '' }}</td><td class="cr">{{ l.credit ? sar(l.credit) : '' }}</td></tr>
          </table>
        </article>
      </section>

      <div v-else key="i" class="cols">
        <section class="card pm-panel wide">
          <h2>بيانات المشروع</h2>
          <dl class="pm-dl">
            <div><dt>رقم المشروع</dt><dd>{{ p.code }}</dd></div>
            <div><dt>مدير المشروع</dt><dd>{{ p.managerName || '—' }}</dd></div>
            <div><dt>المدة</dt><dd>{{ fmtDate(p.startDate) }} ← {{ fmtDate(p.endDate) }}</dd></div>
            <div><dt>الميزانية</dt><dd>{{ p.budget ? sar(p.budget) : '—' }}</dd></div>
            <div><dt>المستفيدون المستهدفون</dt><dd>{{ p.targetBeneficiaries ?? '—' }}</dd></div>
            <div><dt>البوابة</dt><dd>{{ p.portalVisible ? 'يظهر بعد الاعتماد' : 'مخفي' }}</dd></div>
          </dl>
          <p v-if="p.goals" class="goals"><b>الأهداف:</b> {{ p.goals }}</p>
          <h2 style="margin-top: 16px">الخدمات</h2>
          <div class="svcs">
            <div v-for="sv in p.services" :key="sv.name" class="svc"><b>{{ sv.name }}</b><span v-if="sv.cost" class="pm-money">{{ sar(sv.cost) }}</span><small class="pm-muted">{{ sv.description }}</small><span class="pm-tag">{{ sv.portalVisible === false ? 'داخلية' : 'في البوابة' }}</span></div>
            <p v-if="!p.services.length" class="pm-muted">لا توجد خدمات</p>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>سجل الاعتماد</h2>
          <ol class="timeline">
            <li v-for="h in p.history" :key="h.id" :class="h.kind">
              <b>{{ h.userName }}</b> {{ ACTIONS[h.kind] ?? h.kind }}<template v-if="h.stageName"> في "{{ h.stageName }}"</template>
              <small class="pm-muted">{{ fmtDate(h.createdAt) }}</small>
              <p v-if="h.note" class="note">{{ h.note }}</p>
            </li>
          </ol>
        </section>
      </div>
    </Transition>

    <NodeForm v-if="editing" :node="p" level="project" @close="editing = false" @saved="saved" />
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
  <div v-else class="skeleton" />
</template>

<style scoped>
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.chip { font-size: .78rem; padding: 2px 10px; border-radius: 99px; background: color-mix(in srgb, var(--c) 25%, transparent); color: #fff; border: 1px solid color-mix(in srgb, var(--c) 60%, transparent); }
.btn-glow { background: linear-gradient(135deg, #f5c66b, #e8b04b); color: #3b2a06; border: 0; font-weight: 700; }
.flow { margin-bottom: 16px; }
.pm-bar.big { height: 14px; border-radius: 10px; }
.cols { display: grid; grid-template-columns: 1fr 2fr; gap: 14px; }
.cols .wide { min-width: 0; }
.stack { display: flex; flex-direction: column; gap: 14px; }
.donor, .move { display: flex; gap: 10px; align-items: center; padding: 10px 6px; border-bottom: 1px solid var(--border); }
.donor:last-child, .move:last-child { border: 0; }
.grow { flex: 1; min-width: 0; }
.end { text-align: left; display: flex; flex-direction: column; }
.conds { white-space: normal; min-width: 220px; }
.conds .pm-tag { margin: 1px; }
.dir { font-size: .72rem; font-weight: 700; padding: 3px 8px; border-radius: 6px; color: #fff; }
.dir.in { background: #6366f1; } .dir.out { background: #94a3b8; } .dir.am { background: #d97706; }
.entry { border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; margin-bottom: 10px; }
.entry header { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
.lines { width: 100%; font-size: .86rem; border-collapse: collapse; }
.lines td { padding: 4px 6px; border-top: 1px dashed var(--border); }
.code { color: var(--muted); width: 70px; }
.dr, .cr { text-align: left; width: 120px; font-variant-numeric: tabular-nums; }
.cr { color: #6366f1; }
.goals { margin: 12px 0 0; }
.svcs { display: flex; flex-direction: column; gap: 6px; }
.svc { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 8px 10px; border-radius: 10px; background: var(--surface-2); }
.timeline { list-style: none; margin: 0; padding: 0; position: relative; }
.timeline li { position: relative; padding: 0 18px 14px 0; border-inline-start: 2px solid var(--border); margin-inline-start: 6px; padding-inline-start: 16px; }
.timeline li::before { content: ''; position: absolute; inset-inline-start: -7px; top: 4px; width: 12px; height: 12px; border-radius: 50%; background: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.timeline li.rejected::before { background: var(--danger); } .timeline li.returned::before { background: #f97316; }
.timeline small { display: block; }
.note { margin: 4px 0 0; padding: 6px 10px; background: var(--surface-2); border-radius: 8px; font-size: .86rem; }
.skeleton { height: 220px; border-radius: 20px; background: linear-gradient(90deg, var(--surface-2), #eef3f5, var(--surface-2)); background-size: 200% 100%; animation: shimmer 1.2s infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
@media (max-width: 1000px) { .cols { grid-template-columns: 1fr; } }
</style>
