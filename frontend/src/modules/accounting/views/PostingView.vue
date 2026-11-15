<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, VOUCHER_TYPES, sar, todayStr } from '../lib';
import '../../projects/projects.css';
import '../acc.css';

interface Cand { id: string; entryNo: number; voucherLabel: string; voucherNo: string; documentDate: string; description: string; total: number }
const session = useSession();
const toast = useToast();
const router = useRouter();
const mode = ref<'date' | 'serial'>('date');
const t = todayStr();
const f = reactive({ dateFrom: `${t.slice(0, 7)}-01`, dateTo: t, voucherType: '', serialFrom: null as number | null, serialTo: null as number | null });
const cands = ref<Cand[] | null>(null);
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
    cands.value = (await api<{ candidates: Cand[] }>('/accounting/posting/batch', { method: 'POST', json: body(true) })).candidates;
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
        <h1>الترحيل وإغلاق الفترات</h1>
        <p class="pm-sub">ترحيل جماعي خلال فترة، أو حسب نوع المستند ومدى أرقامه. بعد الترحيل لا يُعدَّل القيد، وفي الشهر المغلق لا يُفك الترحيل إلا بعد فك إغلاق الشهر.</p>
      </div>
      <div class="pm-actions">
        <RouterLink v-if="session.can(P.closePeriods) || session.can(P.reopenPeriods)" to="/accounting/setup" class="btn ac-ghost">إغلاق الشهور والسنوات</RouterLink>
        <RouterLink to="/accounting/inventory" class="btn ac-ghost">محضر جرد السندات</RouterLink>
      </div>
    </section>

    <section v-if="session.can(P.post)" class="card pm-panel">
      <h2>الترحيل الجماعي <span class="ac-switch"><button :class="{ on: mode === 'date' }" @click="mode = 'date'">خلال فترة</button><button :class="{ on: mode === 'serial' }" @click="mode = 'serial'">بنوع المستند وأرقامه</button></span></h2>
      <div class="field-row">
        <label class="field"><span>من تاريخ</span><input v-model="f.dateFrom" class="input" type="date" /></label>
        <label class="field"><span>إلى تاريخ</span><input v-model="f.dateTo" class="input" type="date" /></label>
        <label class="field"><span>نوع المستند</span>
          <select v-model="f.voucherType" class="input" :required="mode === 'serial'"><option value="">{{ mode === 'serial' ? 'اختر النوع' : 'كل الأنواع' }}</option><option v-for="v in VOUCHER_TYPES.filter((x) => x.value !== 'receipt' && x.value !== 'payment')" :key="v.value" :value="v.value">{{ v.label }}</option></select>
        </label>
        <template v-if="mode === 'serial'">
          <label class="field"><span>من رقم</span><input v-model.number="f.serialFrom" class="input" type="number" min="1" /></label>
          <label class="field"><span>إلى رقم</span><input v-model.number="f.serialTo" class="input" type="number" min="1" /></label>
        </template>
      </div>
      <p class="pm-muted">سندات القبض والصرف تُرحَّل تلقائيًا عند اعتمادها النهائي، فلا تظهر هنا.</p>
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
