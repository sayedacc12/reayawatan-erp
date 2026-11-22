<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, dt } from '../lib';
import '../../../shared/module.css';
import '../acc.css';

interface Seq { voucherType: string; label: string; continuous: boolean; startSerial: number; endSerial: number | null; nextSerial: number }
interface Year {
  id: string; name: number; startDate: string; endDate: string; isFirst: boolean; status: 'open' | 'closed'; closedAt: string | null; closedByName: string | null;
  reopenedAt: string | null; reopenedByName: string | null; isCurrent: boolean; months: { month: string; closed: boolean; closedByName: string | null }[];
  sequences: Seq[]; entries: Record<string, number>; inventory: 'draft' | 'approved' | null;
}
interface Overview {
  configured: boolean; taxNumber: string | null; organizationName: string; today: string; years: Year[];
  nextYear: { name: number; startDate: string; endDate: string; opensOn: string; canOpen: boolean } | null;
  mismatches: { fromYear: number; toYear: number; toYearId: string; rows: { accountCode: string; accountName: string; partnerName: string | null; expected: number; actual: number }[] }[];
}
const session = useSession();
const toast = useToast();
const data = ref<Overview | null>(null);
const error = ref('');
const busy = ref(false);
const selected = ref<string | null>(null);

async function load() {
  try {
    data.value = await api<Overview>('/accounting/setup');
    if (!selected.value || !data.value.years.some((y) => y.id === selected.value)) {
      selected.value = (data.value.years.find((y) => y.isCurrent) ?? data.value.years.at(-1))?.id ?? null;
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
const year = computed(() => data.value?.years.find((y) => y.id === selected.value) ?? null);

// ---------------- الإعداد الأول ----------------
const y0 = new Date().getFullYear();
const form = reactive({
  fiscalYear: y0, startDate: `${y0}-01-01`, endDate: `${y0}-12-31`, isFirstYear: true, firstYearStart: `${y0}-01-01`, firstYearEnd: `${y0}-12-31`,
  taxNumber: '', receiptStart: null as number | null, paymentStart: null as number | null,
});
watch(() => form.fiscalYear, (v) => {
  form.startDate = `${v}-01-01`; form.endDate = `${v}-12-31`; form.firstYearStart = form.startDate; form.firstYearEnd = form.endDate;
});
watch(() => form.startDate, (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
  const d = new Date(`${v}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(d.getUTCDate() - 1);
  form.endDate = d.toISOString().slice(0, 10);
});
async function submitSetup() {
  busy.value = true;
  try {
    data.value = await api<Overview>('/accounting/setup', {
      method: 'POST',
      json: {
        fiscalYear: form.fiscalYear, startDate: form.startDate, endDate: form.endDate, isFirstYear: form.isFirstYear,
        firstYearStart: form.isFirstYear ? form.firstYearStart : null, firstYearEnd: form.isFirstYear ? form.firstYearEnd : null,
        taxNumber: form.taxNumber || null, receiptStart: form.isFirstYear ? null : form.receiptStart, paymentStart: form.isFirstYear ? null : form.paymentStart,
      },
    });
    selected.value = data.value.years[0]?.id ?? null;
    toast.success('تم حفظ الافتتاحيات وفتح السنة المالية');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}

// ---------------- الإجراءات ----------------
async function act(path: string, body: unknown, msg: string, confirmText?: string) {
  if (confirmText && !confirm(confirmText)) return;
  busy.value = true;
  try {
    await api(path, { method: 'POST', json: body ?? {} });
    toast.success(msg);
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const openNext = () => act('/accounting/years/next', {}, 'فُتحت السنة المالية الجديدة وأُنشئ قيدها الافتتاحي',
  `فتح السنة المالية ${data.value!.nextYear!.name}؟ سيُنشأ قيد افتتاحي آلي بأرصدة الأصول والالتزامات وصافي الأصول، وتُقفل نتيجة النشاط (الإيرادات والمصروفات) في صافي الأصول ولا تُرحَّل أرصدتها.`);
const refresh = (id: string, name: number) => act(`/accounting/years/${id}/refresh-opening`, {}, 'حُدّث القيد الافتتاحي', `تحديث القيد الافتتاحي للسنة ${name} من أرصدة نهاية السنة السابقة؟ يُلغى القيد الحالي ويُنشأ قيد جديد.`);

// ---------------- المدى والأرقام ----------------
const seqEdit = ref<Seq[] | null>(null);
function editSeq() {
  seqEdit.value = year.value!.sequences.map((s) => ({ ...s }));
}
async function saveSeq() {
  busy.value = true;
  try {
    await api(`/accounting/years/${year.value!.id}/sequences`, { method: 'PUT', json: { sequences: seqEdit.value!.map((s) => ({ voucherType: s.voucherType, startSerial: Number(s.startSerial), endSerial: s.endSerial ? Number(s.endSerial) : null })) } });
    toast.success('تم حفظ مدى أرقام السندات');
    seqEdit.value = null;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const tax = ref('');
watch(data, (d) => { tax.value = d?.taxNumber ?? ''; });
async function saveTax() {
  try {
    await api('/accounting/setup', { method: 'PATCH', json: { taxNumber: tax.value || null } });
    toast.success('تم حفظ الرقم الضريبي');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <section class="pm-hero ac-hero">
      <div>
        <p class="pm-kicker">النظام المالي</p>
        <h1>الافتتاحيات والسنوات المالية</h1>
        <p class="pm-sub">بيانات السنة المالية، ومدى أرقام السندات، وإغلاق الشهور والسنوات، وفتح السنة الجديدة بقيد افتتاحي آلي.</p>
      </div>
      <div v-if="data?.nextYear && session.can(P.setup)" class="pm-actions">
        <button class="btn ac-glow" :disabled="!data.nextYear.canOpen || busy" @click="openNext">فتح السنة المالية {{ data.nextYear.name }}</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <template v-if="data">
      <div v-for="m in data.mismatches" :key="m.toYearId" class="ac-warn pulse">
        <div style="flex: 1">
          <b>أرصدة نهاية السنة {{ m.fromYear }} تختلف عن الأرصدة الافتتاحية للسنة {{ m.toYear }}</b>
          <ul class="pm-muted" style="margin: 6px 0 0; padding-inline-start: 18px">
            <li v-for="r in m.rows.slice(0, 5)" :key="r.accountCode + r.partnerName"><span class="ac-code">{{ r.accountCode }}</span> {{ r.accountName }}<template v-if="r.partnerName"> · {{ r.partnerName }}</template>: المتوقع {{ r.expected }} والمسجل {{ r.actual }}</li>
          </ul>
        </div>
        <button v-if="session.can(P.setup)" class="btn btn-sm btn-primary" :disabled="busy" @click="refresh(m.toYearId, m.toYear)">تحديث القيد الافتتاحي</button>
      </div>

      <!-- الإعداد الأول -->
      <section v-if="!data.configured" class="card pm-panel setup">
        <h2>شاشة الافتتاحيات</h2>
        <p v-if="!session.can(P.setup)" class="pm-empty">لم تُعدّ الافتتاحيات بعد، والإعداد يحتاج صلاحية الافتتاحيات.</p>
        <form v-else @submit.prevent="submitSetup">
          <div class="field-row">
            <label class="field"><span>السنة المالية</span><input v-model.number="form.fiscalYear" class="input" type="number" min="2000" max="2100" required /></label>
            <label class="field"><span>بداية السنة المالية</span><input v-model="form.startDate" class="input" type="date" required /></label>
            <label class="field"><span>نهاية السنة المالية</span><input v-model="form.endDate" class="input" type="date" required /></label>
            <label class="field"><span>الرقم الضريبي (من البيانات الأساسية للجمعية)</span><input v-model="form.taxNumber" class="input ac-code" inputmode="numeric" maxlength="15" placeholder="15 رقمًا" /></label>
          </div>
          <label class="check first"><input v-model="form.isFirstYear" type="checkbox" /> هل هذه هي السنة المالية الأولى للجمعية؟</label>
          <Transition name="fade">
            <div v-if="form.isFirstYear" class="field-row firstbox">
              <label class="field"><span>بداية السنة المالية الأولى</span><input v-model="form.firstYearStart" class="input" type="date" required /></label>
              <label class="field"><span>نهاية السنة المالية الأولى</span><input v-model="form.firstYearEnd" class="input" type="date" required /></label>
              <p class="pm-muted" style="grid-column: 1 / -1; margin: 0">السنة الأولى قد تكون أقصر أو أطول من 12 شهرًا (حتى 24 شهرًا). أرقام سندات القبض والصرف تبدأ فيها من 1 تلقائيًا.</p>
            </div>
            <div v-else class="field-row firstbox">
              <label class="field"><span>أول رقم لسندات القبض</span><input v-model.number="form.receiptStart" class="input" type="number" min="1" required /></label>
              <label class="field"><span>أول رقم لسندات الصرف</span><input v-model.number="form.paymentStart" class="input" type="number" min="1" required /></label>
              <p class="pm-muted" style="grid-column: 1 / -1; margin: 0">الرقم التالي لآخر رقم في محضر جرد السندات للسنة السابقة.</p>
            </div>
          </Transition>
          <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ الافتتاحيات وفتح السنة</button></div>
        </form>
      </section>

      <template v-else>
        <div class="years">
          <button v-for="y in data.years" :key="y.id" :class="['ycard', { on: y.id === selected, closed: y.status === 'closed' }]" @click="selected = y.id; seqEdit = null">
            <b>{{ y.name }}</b>
            <small>{{ y.startDate }} ← {{ y.endDate }}</small>
            <span class="pm-pill" :style="{ '--c': y.status === 'closed' ? '#64748b' : '#10b981' }">{{ y.status === 'closed' ? 'مغلقة' : y.isCurrent ? 'الحالية' : 'مفتوحة' }}</span>
          </button>
          <div v-if="data.nextYear" class="ycard next">
            <b>{{ data.nextYear.name }}</b>
            <small>{{ data.nextYear.startDate }} ← {{ data.nextYear.endDate }}</small>
            <span class="pm-muted">{{ data.nextYear.canOpen ? 'متاح فتحها الآن' : `تُفتح من ${data.nextYear.opensOn}` }}</span>
          </div>
        </div>

        <template v-if="year">
          <div class="ac-split">
            <section class="card pm-panel">
              <h2>السنة المالية {{ year.name }} <span v-if="year.isFirst" class="pm-tag">السنة الأولى</span></h2>
              <dl class="pm-dl">
                <div><dt>من</dt><dd>{{ year.startDate }}</dd></div>
                <div><dt>إلى</dt><dd>{{ year.endDate }}</dd></div>
                <div><dt>القيود المرحّلة</dt><dd>{{ year.entries.posted ?? 0 }}</dd></div>
                <div><dt>غير المرحّلة</dt><dd>{{ year.entries.draft ?? 0 }}</dd></div>
                <div><dt>محضر الجرد</dt><dd>{{ year.inventory === 'approved' ? 'معتمد' : year.inventory === 'draft' ? 'مُعدّ ولم يُعتمد' : 'لم يُعدّ' }}</dd></div>
                <div v-if="year.closedAt"><dt>أُغلقت</dt><dd>{{ dt(year.closedAt) }} · {{ year.closedByName }}</dd></div>
                <div v-if="year.reopenedAt"><dt>آخر فتح</dt><dd>{{ dt(year.reopenedAt) }} · {{ year.reopenedByName }}</dd></div>
              </dl>
              <div class="modal-actions" style="margin-top: 16px">
                <RouterLink v-if="session.can(P.closePeriods) || session.can(P.reopenPeriods)" :to="`/accounting/periods?year=${year.id}`" class="btn btn-primary">إغلاق الفترات</RouterLink>
                <RouterLink to="/accounting/inventory" class="btn">محضر جرد السندات</RouterLink>
              </div>
              <p class="pm-muted" style="margin-top: 10px">إغلاق الشهور والسنة وفتحها من شاشة «إغلاق الفترات».</p>
            </section>

            <section class="card pm-panel">
              <h2>أرقام السندات ومداها
                <button v-if="session.can(P.setup) && year.status === 'open' && !seqEdit" class="btn btn-sm" @click="editSeq">تعديل المدى</button>
              </h2>
              <div class="table-wrap">
                <table class="table">
                  <thead><tr><th>نوع السند</th><th>أول رقم</th><th>آخر رقم مسموح</th><th>الرقم التالي</th></tr></thead>
                  <tbody v-if="!seqEdit">
                    <tr v-for="s in year.sequences" :key="s.voucherType">
                      <td>{{ s.label }} <small v-if="s.continuous" class="pm-muted">(مستمر بين السنوات)</small><small v-else class="pm-muted">(يتبعه رقم السنة)</small></td>
                      <td class="ac-code">{{ s.startSerial }}</td><td class="ac-code">{{ s.endSerial ?? '—' }}</td><td class="ac-code">{{ s.continuous ? s.nextSerial : `${s.nextSerial}/${year.name}` }}</td>
                    </tr>
                  </tbody>
                  <tbody v-else>
                    <tr v-for="s in seqEdit" :key="s.voucherType">
                      <td>{{ s.label }}</td>
                      <td><input v-model.number="s.startSerial" class="input" type="number" min="1" style="width: 100px" /></td>
                      <td><input v-model.number="s.endSerial" class="input" type="number" min="1" placeholder="بلا حد" style="width: 110px" /></td>
                      <td class="ac-code">{{ s.nextSerial }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-if="seqEdit" class="modal-actions"><button class="btn btn-primary" :disabled="busy" @click="saveSeq">حفظ</button><button class="btn" @click="seqEdit = null">إلغاء</button></div>
              <p class="pm-muted">أول رقم لا يُعدَّل بعد إصدار سندات من النوع، وآخر رقم مسموح يمنع تجاوز المدى المحدد.</p>
            </section>
          </div>


          <section v-if="session.can(P.setup)" class="card pm-panel" style="margin-top: 16px">
            <h2>البيانات الأساسية</h2>
            <div class="ac-toolbar">
              <label class="field" style="margin: 0"><span>الرقم الضريبي للجمعية</span><input v-model="tax" class="input ac-code" maxlength="15" style="width: 220px" /></label>
              <button class="btn" style="align-self: flex-end" @click="saveTax">حفظ</button>
            </div>
          </section>
        </template>
      </template>
    </template>
  </div>
</template>

<style scoped>
.setup form { max-width: 880px; }
.check.first { display: flex; gap: 8px; align-items: center; margin: 6px 0 12px; font-weight: 600; }
.firstbox { padding: 14px; border-radius: 14px; background: var(--surface-2); border: 1px dashed var(--border); margin-bottom: 12px; }
.fade-enter-active, .fade-leave-active { transition: opacity .25s, transform .25s var(--ease); }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(-6px); }
.years { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 16px; }
.ycard { flex: 0 0 auto; min-width: 190px; text-align: start; border: 1px solid var(--border); background: var(--surface); border-radius: 16px; padding: 14px 16px; font: inherit; cursor: pointer;
  display: flex; flex-direction: column; gap: 4px; transition: transform .2s var(--ease), box-shadow .2s; box-shadow: var(--shadow); }
.ycard b { font-size: 1.4rem; }
.ycard small { color: var(--muted); }
.ycard:hover { transform: translateY(-2px); }
.ycard.on { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft), 0 10px 26px rgba(15,118,110,.15); }
.ycard.closed b { color: var(--muted); }
.ycard.next { border-style: dashed; cursor: default; background: transparent; box-shadow: none; }
</style>
