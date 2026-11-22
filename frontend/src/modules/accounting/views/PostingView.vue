<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, SOURCE_TYPES, VOUCHER_STATUS, allTypes, loadDocTypes, sar, todayStr } from '../lib';
import '../../../shared/module.css';
import '../acc.css';
import CloseFlow from '../components/CloseFlow.vue';

interface PendingV { id: string; kind: string; voucherNo: string; voucherDate: string; partyName: string; amount: number; status: string; requestKind: string | null }
/** كل أنواع المستندات ما عدا القيد الافتتاحي (لا يخضع للترحيل) */
const TYPES = computed(() => allTypes.value.filter((x) => x.value !== 'opening' && !SOURCE_TYPES.includes(x.value)));
loadDocTypes();
interface Cand { id: string; entryNo: number; voucherLabel: string; voucherNo: string; documentDate: string; description: string; total: number }
const session = useSession();
const toast = useToast();
const router = useRouter();
const mode = ref<'date' | 'serial'>('date');
const t = todayStr();
const f = reactive({ dateFrom: `${t.slice(0, 7)}-01`, dateTo: t, voucherType: '', serialFrom: null as number | null, serialTo: null as number | null });
const cands = ref<Cand[] | null>(null);
const pendingV = ref<PendingV[]>([]);
const result = ref<{ posted: number; failed: { entryNo: number; voucherNo: string; reason: string }[] } | null>(null);
const busy = ref(false);
const body = (preview: boolean) => ({
  dateFrom: f.dateFrom, dateTo: f.dateTo, preview,
  voucherType: mode.value === 'serial' ? f.voucherType || null : f.voucherType || null,
  serialFrom: mode.value === 'serial' ? f.serialFrom : null, serialTo: mode.value === 'serial' ? f.serialTo : null,
});
async function preview() {
  busy.value = true;
  result.value = null;
  try {
    const r = await api<{ candidates: Cand[]; pendingVouchers: PendingV[] }>('/accounting/posting/batch', { method: 'POST', json: body(true) });
    cands.value = r.candidates;
    pendingV.value = r.pendingVouchers ?? [];
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function run() {
  if (!confirm(`ترحيل ${cands.value?.length ?? 0} قيد؟ القيود المرحّلة لا تُعدَّل إلا بفك ترحيلها في شهر مفتوح.`)) return;
  busy.value = true;
  try {
    result.value = await api('/accounting/posting/batch', { method: 'POST', json: body(false) });
    cands.value = null;
    toast.success(`تم ترحيل ${result.value!.posted} قيد`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <section class="pm-hero ac-hero">
      <div>
        <p class="pm-kicker">النظام المالي</p>
        <h1>الترحيل والإغلاق · ترحيل القيود</h1>
        <p class="pm-sub">ترحيل جماعي خلال فترة، أو حسب نوع المستند ومدى أرقامه. بعد الترحيل لا يُعدَّل القيد، وفي الشهر المغلق لا يُفك الترحيل إلا بعد فتح الشهر من شاشة إغلاق الفترات.</p>
      </div>
    </section>
    <CloseFlow />

    <p v-if="!session.can(P.post)" class="alert">ليست لديك صلاحية ترحيل القيود. انتقل إلى الخطوة التالية من الإجراء أعلاه.</p>
    <section v-if="session.can(P.post)" class="card pm-panel">
      <h2>الترحيل الجماعي <span class="ac-switch"><button :class="{ on: mode === 'date' }" @click="mode = 'date'">خلال فترة</button><button :class="{ on: mode === 'serial' }" @click="mode = 'serial'">بنوع المستند وأرقامه</button></span></h2>
      <div class="field-row">
        <label class="field"><span>من تاريخ</span><input v-model="f.dateFrom" class="input" type="date" /></label>
        <label class="field"><span>إلى تاريخ</span><input v-model="f.dateTo" class="input" type="date" /></label>
        <label class="field"><span>نوع المستند</span>
          <select v-model="f.voucherType" class="input" :required="mode === 'serial'"><option value="">{{ mode === 'serial' ? 'اختر النوع' : 'كل الأنواع' }}</option><option v-for="v in TYPES" :key="v.value" :value="v.value">{{ v.label }}</option></select>
        </label>
        <template v-if="mode === 'serial'">
          <label class="field"><span>من رقم</span><input v-model.number="f.serialFrom" class="input" type="number" min="1" /></label>
          <label class="field"><span>إلى رقم</span><input v-model.number="f.serialTo" class="input" type="number" min="1" /></label>
        </template>
      </div>
      <p class="pm-muted">سندات القبض والصرف تُرحَّل تلقائيًا عند اعتمادها النهائي، وتظهر هنا السندات التي لم يكتمل اعتمادها لمتابعتها. القيد الافتتاحي لا يخضع للترحيل، ويسري أثره بمجرد حفظه.</p>
      <div class="modal-actions"><button class="btn btn-primary" :disabled="busy" @click="preview">عرض القيود غير المرحّلة</button></div>
    </section>

    <section v-if="cands" class="card pm-panel" style="margin-top: 16px">
      <h2>{{ cands.length }} قيد جاهز للترحيل <button v-if="cands.length" class="btn ac-glow" :disabled="busy" @click="run">ترحيل الكل</button></h2>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>رقم القيد</th><th>المستند</th><th>التاريخ</th><th>البيان</th><th>المبلغ</th></tr></thead>
          <tbody>
            <tr v-for="c in cands" :key="c.id" class="ac-row-click" @click="router.push(`/accounting/entries/${c.id}`)">
              <td class="ac-code">{{ c.entryNo }}</td><td>{{ c.voucherLabel }} <span class="ac-code">{{ c.voucherNo }}</span></td><td>{{ c.documentDate }}</td><td>{{ c.description }}</td><td class="pm-money">{{ sar(c.total) }}</td>
            </tr>
            <tr v-if="!cands.length"><td colspan="5" class="pm-empty">لا توجد قيود غير مرحّلة بهذه الشروط</td></tr>
          </tbody>
        </table>
      </div>
    </section>

 <section v-if="cands && pendingV.length" class="card pm-panel" style="margin-top: 16px">
      <h2>{{ pendingV.length }} سند قبض أو صرف لم يكتمل اعتماده <small class="pm-muted">يُرحَّل تلقائيًا عند الاعتماد النهائي</small></h2>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>السند</th><th>التاريخ</th><th>الجهة</th><th>المبلغ</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="v in pendingV" :key="v.id" class="ac-row-click" @click="router.push(`/accounting/vouchers/${v.id}`)">
              <td>{{ v.kind === 'receipt' ? 'سند قبض' : 'سند صرف' }} <span class="ac-code">{{ v.voucherNo }}</span></td><td>{{ v.voucherDate }}</td><td>{{ v.partyName }}</td>
              <td class="pm-money">{{ sar(v.amount) }}</td>
              <td><span class="pm-pill" :style="{ '--c': VOUCHER_STATUS[v.status].color }">{{ v.requestKind ? 'عليه طلب معلق' : VOUCHER_STATUS[v.status].label }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="result" class="card pm-panel result" style="margin-top: 16px">
      <h2>نتيجة الترحيل</h2>
      <p class="pm-ok" style="font-size: 1rem">✓ رُحّل {{ result.posted }} قيد</p>
      <div v-if="result.failed.length">
        <p class="alert alert-error">تعذر ترحيل {{ result.failed.length }} قيد:</p>
        <ul><li v-for="x in result.failed" :key="x.entryNo">القيد {{ x.entryNo }} ({{ x.voucherNo }}): {{ x.reason }}</li></ul>
      </div>
    </section>
  </div>
</template>
