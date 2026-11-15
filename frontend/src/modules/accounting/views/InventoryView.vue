<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { P, dt } from '../lib';
import '../../projects/projects.css';
import '../acc.css';

interface Row { voucherType: string; label: string; continuous: boolean; first: number | null; last: number | null; firstNo: string | null; lastNo: string | null; count: number; posted: number; cancelled: number; draft: number; missing: number[]; rangeStart: number; rangeEnd: number | null }
interface Inv {
  year: { id: string; name: number; startDate: string; endDate: string; status: string }; organizationName: string;
  inventory: { id: string; status: 'draft' | 'approved'; notes: string | null; preparedByName: string; preparedAt: string; approvedByName: string | null; approvedAt: string | null } | null;
  outdated: boolean; rows: Row[]; canApprove: boolean;
}
const session = useSession();
const toast = useToast();
const years = ref<{ id: string; name: number; isCurrent: boolean }[]>([]);
const yearId = ref('');
const data = ref<Inv | null>(null);
const notes = ref('');
const busy = ref(false);
const error = ref('');
onMounted(async () => {
  try {
    const s = await api<{ years: { id: string; name: number; isCurrent: boolean }[] }>('/accounting/setup');
    years.value = s.years;
    yearId.value = (s.years.find((y) => y.isCurrent) ?? s.years.at(-1))?.id ?? '';
  } catch (e) {
    error.value = (e as Error).message;
  }
});
watch(yearId, async (id) => {
  if (!id) return;
  data.value = await api<Inv>(`/accounting/inventory/${id}`);
  notes.value = data.value.inventory?.notes ?? '';
});
async function run(path: string, body: unknown, msg: string, confirmText?: string) {
  if (confirmText && !confirm(confirmText)) return;
  busy.value = true;
  try {
    data.value = await api<Inv>(path, { method: 'POST', json: body ?? {} });
    toast.success(msg);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const prepare = () => run('/accounting/inventory/prepare', { fiscalYearId: yearId.value, notes: notes.value || null }, 'تم إعداد المحضر من واقع السندات');
const approve = () => run(`/accounting/inventory/${yearId.value}/approve`, {}, 'اعتُمد محضر جرد السندات', 'اعتماد المحضر؟ بعد الاعتماد لا تُقبل سندات جديدة في السنة، وتبدأ أرقام القبض والصرف في السنة التالية بعد آخر رقم فيه.');
const revoke = () => run(`/accounting/inventory/${yearId.value}/revoke`, {}, 'أُلغي اعتماد المحضر', 'إلغاء اعتماد المحضر؟');
const totals = computed(() => (data.value?.rows ?? []).reduce((t, r) => ({ count: t.count + r.count, posted: t.posted + r.posted, cancelled: t.cancelled + r.cancelled, draft: t.draft + r.draft }), { count: 0, posted: 0, cancelled: 0, draft: 0 }));
const canPrepare = computed(() => session.can(P.closePeriods) || session.can(P.setup));
</script>

<template>
  <div>
    <section class="pm-hero ac-hero no-print">
      <div>
        <p class="pm-kicker">النظام المالي</p>
        <h1>محضر جرد السندات الإلكتروني</h1>
        <p class="pm-sub">يحدد لكل نوع سند أول رقم وآخر رقم تُغلق عليه السنة، ويعتمده مدير النظام بنفسه. لا تُغلق السنة بدونه، ولا تُقبل في السنة المغلقة سندات خارج مداه.</p>
      </div>
      <div class="pm-actions">
        <select v-model="yearId" class="input" style="width: auto"><option v-for="y in years" :key="y.id" :value="y.id">السنة المالية {{ y.name }}</option></select>
        <button class="btn ac-ghost" onclick="window.print()">طباعة</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <template v-if="data">
      <div v-if="data.outdated && data.inventory?.status === 'draft'" class="ac-warn no-print">تغيرت السندات بعد إعداد المحضر. أعد إعداده قبل الاعتماد.</div>
      <article class="card doc">
        <header>
          <div><h2>{{ data.organizationName }}</h2><p class="pm-muted">محضر جرد السندات للسنة المالية {{ data.year.name }} ({{ data.year.startDate }} – {{ data.year.endDate }})</p></div>
          <div class="seal" :class="data.inventory?.status ?? 'none'">
            {{ data.inventory?.status === 'approved' ? 'معتمد' : data.inventory ? 'مسودة' : 'لم يُعدّ' }}
          </div>
        </header>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>نوع السند</th><th>أول رقم</th><th>آخر رقم</th><th>العدد</th><th>مرحّل</th><th>ملغي</th><th>غير مرحّل</th><th>المدى المحدد</th><th>أرقام مفقودة</th></tr></thead>
            <tbody>
              <tr v-for="r in data.rows" :key="r.voucherType" :class="{ warn: r.draft || r.missing.length }">
                <td><b>{{ r.label }}</b></td>
                <td class="ac-code">{{ r.firstNo ?? '—' }}</td><td class="ac-code">{{ r.lastNo ?? '—' }}</td>
                <td class="ac-code">{{ r.count }}</td><td class="ac-code ok">{{ r.posted }}</td><td class="ac-code bad">{{ r.cancelled }}</td>
                <td class="ac-code" :class="{ bad: r.draft }">{{ r.draft }}</td>
                <td class="ac-code">{{ r.rangeStart }} – {{ r.rangeEnd ?? '∞' }}</td>
                <td class="ac-code" :class="{ bad: r.missing.length }">{{ r.missing.length ? r.missing.join('، ') : '—' }}</td>
              </tr>
            </tbody>
            <tfoot><tr><td><b>الإجمالي</b></td><td></td><td></td><td class="ac-code">{{ totals.count }}</td><td class="ac-code">{{ totals.posted }}</td><td class="ac-code">{{ totals.cancelled }}</td><td class="ac-code">{{ totals.draft }}</td><td></td><td></td></tr></tfoot>
          </table>
        </div>
        <p v-if="data.inventory?.notes" class="notes">ملاحظات: {{ data.inventory.notes }}</p>
        <div class="sign">
          <div><span>أعدّه</span><b>{{ data.inventory?.preparedByName ?? '' }}</b><small>{{ dt(data.inventory?.preparedAt) }}</small></div>
          <div><span>اعتمده مدير النظام</span><b>{{ data.inventory?.approvedByName ?? '' }}</b><small>{{ dt(data.inventory?.approvedAt) }}</small></div>
        </div>
      </article>

      <section class="card pm-panel no-print" style="margin-top: 16px">
        <h2>الإجراءات</h2>
        <label v-if="canPrepare && data.inventory?.status !== 'approved'" class="field"><span>ملاحظات المحضر</span><textarea v-model="notes" class="input" rows="2" /></label>
        <div class="modal-actions">
          <button v-if="canPrepare && data.inventory?.status !== 'approved'" class="btn btn-primary" :disabled="busy" @click="prepare">{{ data.inventory ? 'إعادة إعداد المحضر' : 'إعداد المحضر' }}</button>
          <button v-if="data.canApprove && data.inventory?.status === 'draft'" class="btn ac-glow" :disabled="busy || data.outdated" @click="approve">اعتماد المحضر</button>
          <button v-if="data.canApprove && data.inventory?.status === 'approved' && data.year.status !== 'closed'" class="btn btn-danger" :disabled="busy" @click="revoke">إلغاء الاعتماد</button>
        </div>
        <p v-if="!data.canApprove" class="pm-muted">اعتماد المحضر لمدير النظام بنفسه فقط.</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.doc { padding: 24px; }
.doc header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px double var(--border); margin-bottom: 14px; padding-bottom: 10px; }
.doc h2 { margin: 0; }
.seal { width: 92px; height: 92px; border-radius: 50%; display: grid; place-items: center; font-weight: 900; transform: rotate(-12deg); border: 4px double #94a3b8; color: #64748b; }
.seal.approved { border-color: #059669; color: #059669; box-shadow: 0 0 22px rgba(5,150,105,.3); animation: pm-rise .6s var(--ease) both; }
.seal.draft { border-color: #f59e0b; color: #b45309; }
.ok { color: var(--success); }
.bad { color: var(--danger); font-weight: 700; }
tr.warn { background: #fffbeb; }
.notes { background: var(--surface-2); border-radius: 10px; padding: 10px; }
.sign { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 30px; text-align: center; }
.sign div { display: flex; flex-direction: column; gap: 6px; }
.sign b { border-top: 1px solid #94a3b8; padding-top: 6px; min-height: 1.6em; }
.sign span, .sign small { color: var(--muted); }
</style>
