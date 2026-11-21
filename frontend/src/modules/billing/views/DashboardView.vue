<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { BL, DOC_COLOR, fmtDate, sar } from '../lib';
import '../../projects/projects.css';
import '../../procurement/procurement.css';
import '../billing.css';

const session = useSession();
const toast = useToast();
const d = ref<any>(null);
onMounted(async () => {
  try {
    d.value = await api('/billing/dashboard');
  } catch (e) {
    toast.error((e as Error).message);
  }
});
const maxMonth = computed(() => Math.max(1, ...(d.value?.monthly ?? []).map((m: any) => Math.abs(m.sales))));
const maxTop = computed(() => Math.max(1, ...(d.value?.top ?? []).map((t: any) => t.total)));
const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'short' });
const taxPct = computed(() => (d.value ? Math.min(100, Math.round((d.value.kpis.last12 / d.value.thresholds.mandatory) * 100)) : 0));
</script>

<template>
  <div>
    <section class="pm-hero bl-hero">
      <div class="bl-qr" aria-hidden="true"><i v-for="n in 16" :key="n" /></div>
      <div>
        <p class="pm-kicker">الفوترة والمبيعات</p>
        <h1>فواتير ضريبية برمز QR، وقيود آلية، وتحصيل منظم</h1>
        <p class="pm-sub">فواتير المبيعات والإيجارات والخدمات بمعرّف فريد وعداد متسلسل ورمز QR، يُعدّها موظف ويصدرها آخر، فيُنشأ قيدها في النظام المالي تلقائيًا، ويُحصّل مبلغها بسندات القبض. تمهيدًا للربط مع منصة «فاتورة».</p>
      </div>
      <div class="pm-actions">
        <RouterLink v-if="session.can(BL.invoices)" to="/billing/invoices/new" class="btn bl-glow">+ فاتورة جديدة</RouterLink>
        <RouterLink v-if="session.can(BL.customers)" to="/billing/customers?new=1" class="btn pc-ghost">+ عميل جديد</RouterLink>
      </div>
    </section>
    <template v-if="d">
      <div v-if="!d.readiness.ready" class="alert" style="background: #fffbeb; margin-bottom: 14px">
        <b>النظام غير جاهز لإصدار الفواتير بعد.</b> ينقصه: {{ d.readiness.missing.join('، ') }}.
        <RouterLink v-if="session.can(BL.settings)" class="pm-link" to="/billing/settings">إكمال الإعدادات</RouterLink>
      </div>
      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #0369a1; --i: 0"><span>مبيعات الشهر (قبل الضريبة)</span><strong>{{ sar(d.kpis.salesMonth) }}</strong><small>ضريبة المخرجات {{ sar(d.kpis.vatMonth) }}</small></div>
        <div class="pm-kpi" style="--a: #7c3aed; --i: 1"><span>مبيعات السنة</span><strong>{{ sar(d.kpis.salesYear) }}</strong><small>ضريبة المخرجات {{ sar(d.kpis.vatYear) }}</small></div>
        <div class="pm-kpi" style="--a: #ca8a04; --i: 2"><span>المتبقي على العملاء</span><strong>{{ sar(d.kpis.outstanding) }}</strong><small>{{ d.kpis.open }} فاتورة غير محصلة بالكامل</small></div>
        <div class="pm-kpi" style="--a: #dc2626; --i: 3"><span>متأخرة السداد</span><strong>{{ d.kpis.overdue }}</strong><small>{{ sar(d.kpis.overdueAmount) }}</small></div>
      </div>
      <div class="pc-cards" style="margin-bottom: 18px">
        <RouterLink class="pc-kpi" :class="{ hot: d.kpis.pending }" to="/billing/invoices?view=pending"><small class="pm-muted">بانتظار الإصدار</small><b style="font-size: 1.5rem">{{ d.kpis.pending }}</b><small class="pm-muted">يصدرها موظف غير من أعدّها</small></RouterLink>
        <RouterLink class="pc-kpi" to="/billing/invoices?view=drafts"><small class="pm-muted">مسودات</small><b style="font-size: 1.5rem">{{ d.kpis.drafts }}</b><small class="pm-muted">لم تُرسل للإصدار</small></RouterLink>
        <RouterLink class="pc-kpi" to="/billing/customers"><small class="pm-muted">العملاء النشطون</small><b style="font-size: 1.5rem">{{ d.kpis.customers }}</b><small class="pm-muted">{{ d.kpis.items }} صنف وخدمة</small></RouterLink>
        <RouterLink class="pc-kpi" to="/billing/reconciliation"><small class="pm-muted">المطابقة مع الدليل</small><b style="font-size: 1.3rem" :style="{ color: d.reconciliation.ok ? '#047857' : '#b91c1c' }">{{ d.reconciliation.ok ? '✓ مطابق' : `✕ ${d.reconciliation.issues} فرق` }}</b><small class="pm-muted">الذمم وضريبة المخرجات</small></RouterLink>
      </div>
      <div class="pc-grid">
        <section class="card pm-panel">
          <h2>المبيعات الشهرية (آخر 12 شهرًا)</h2>
          <p v-if="!d.monthly.length" class="pc-empty">لا توجد فواتير صادرة بعد</p>
          <div class="bl-months">
            <div v-for="m in d.monthly" :key="m.m" class="c" :title="`${sar(m.sales)} · ضريبة ${sar(m.vat)}`">
              <i :style="{ height: `${(Math.abs(m.sales) / maxMonth) * 100}%` }" /><small>{{ monthName(m.m) }}</small>
            </div>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>الوضع الضريبي</h2>
          <p style="margin: 0 0 6px"><span class="pm-pill" style="--c: #0369a1">{{ d.modeLabel }}</span></p>
          <p class="pm-muted" style="font-size: .84rem">المبيعات الخاضعة في آخر 12 شهرًا {{ sar(d.kpis.last12) }}. التسجيل في ضريبة القيمة المضافة إلزامي عند تجاوز {{ sar(d.thresholds.mandatory) }} سنويًا، واختياري فوق {{ sar(d.thresholds.voluntary) }}.</p>
          <div class="pc-bar"><i :style="{ width: `${taxPct}%`, '--c': taxPct >= 100 ? '#dc2626' : '#0369a1' }" /></div>
          <small class="pm-muted">{{ taxPct }}% من حد التسجيل الإلزامي (تقدير من الفواتير الصادرة في النظام فقط)</small>
        </section>
        <section class="card pm-panel">
          <h2>أعلى العملاء هذا العام</h2>
          <p v-if="!d.top.length" class="pc-empty">لا يوجد</p>
          <div class="pc-bars">
            <div v-for="t in d.top" :key="t.name" class="r"><span>{{ t.name }}</span><div class="pc-bar"><i :style="{ width: (t.total / maxTop) * 100 + '%', '--c': '#7c3aed' }" /></div><b style="font-size: .78rem">{{ sar(t.total) }}</b></div>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>آخر المستندات <RouterLink to="/billing/invoices" class="pm-link">الكل</RouterLink></h2>
          <p v-if="!d.recent.length" class="pc-empty">لا توجد مستندات</p>
          <RouterLink v-for="r in d.recent" :key="r.id" :to="`/billing/invoices/${r.id}`" class="bl-line">
            <span><b class="pc-code">{{ r.code }}</b> {{ r.buyer }}<small class="pm-muted">{{ r.typeLabel }} · {{ fmtDate(r.date) }}</small></span>
            <span><span class="pm-pill" :style="{ '--c': DOC_COLOR[r.status] }">{{ sar(r.total) }}</span></span>
          </RouterLink>
        </section>
      </div>
    </template>
  </div>
</template>
