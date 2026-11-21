<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import CountUp from '../../../shared/CountUp.vue';
import { PR, fmtDate, sar } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

const session = useSession();
const toast = useToast();
const d = ref<any>(null);
onMounted(async () => {
  try {
    d.value = await api('/procurement/dashboard');
  } catch (e) {
    toast.error((e as Error).message);
  }
});
const sup = (k: string) => d.value?.suppliers[k] ?? 0;
const maxGroup = computed(() => Math.max(1, ...(d.value?.groups ?? []).map((g: any) => g.n)));
const maxWh = computed(() => Math.max(1, ...(d.value?.stock?.byWarehouse ?? []).map((w: any) => w.value)));
const maxAct = computed(() => Math.max(1, ...(d.value?.activities ?? []).map((g: any) => g.n)));
const pendingTotal = computed(() => (d.value ? d.value.approvals.suppliers + d.value.approvals.docs + d.value.approvals.banks : 0));
async function copyPortal() {
  try {
    await navigator.clipboard.writeText(d.value.portalUrl);
    toast.success('نُسخ رابط بوابة الموردين');
  } catch {
    toast.error('تعذر النسخ، انسخ الرابط يدويًا');
  }
}
</script>

<template>
  <div>
    <section class="pm-hero pc-hero">
      <div class="pc-crates" aria-hidden="true"><i /><i /><i /><i /></div>
      <div>
        <p class="pm-kicker">المشتريات والمستودعات</p>
        <h1>دليل أصناف موحد، ومستودعات منظمة، وموردون موثوقون</h1>
        <p class="pm-sub">كل صنف بترميز واحد وحساباته، وكل مستودع بمواقعه وأمنائه، وكل مورد بملف مكتمل ومستندات سارية وحساب بنكي معتمد قبل التعامل معه.</p>
      </div>
      <div class="pm-actions">
        <RouterLink v-if="session.can(PR.items)" to="/procurement/items?new=1" class="btn pc-glow">+ صنف جديد</RouterLink>
        <RouterLink v-if="session.can(PR.suppliers)" to="/procurement/suppliers?new=1" class="btn pc-ghost">+ مورد جديد</RouterLink>
        <button v-if="d?.portalUrl" class="btn pc-ghost" @click="copyPortal">نسخ رابط بوابة الموردين</button>
      </div>
    </section>
    <template v-if="d">
      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #164e38; --i: 0"><span>الأصناف النشطة</span><strong><CountUp :value="d.items.active" /></strong><small>من {{ d.items.total }} · {{ d.items.services }} خدمة · {{ d.items.assets }} أصل</small></div>
        <div class="pm-kpi" style="--a: #0369a1; --i: 1"><span>المستودعات</span><strong><CountUp :value="d.warehouses.active" /></strong><small>{{ d.warehouses.locations }} موقع تخزين</small></div>
        <div class="pm-kpi" style="--a: #059669; --i: 2"><span>الموردون المعتمدون</span><strong><CountUp :value="sup('approved')" /></strong><small>{{ sup('pending') }} بانتظار المراجعة · {{ sup('draft') }} مسودة في البوابة</small></div>
        <div class="pm-kpi" style="--a: #db2777; --i: 3"><span>مستندات تنتهي قريبًا</span><strong><CountUp :value="d.expiring.length" /></strong><small>{{ d.expiring.filter((x: any) => x.expired).length }} منتهية</small></div>
      </div>
      <div v-if="d.sourcing" class="pc-cards" style="margin-bottom: 18px">
        <RouterLink class="pc-kpi" to="/procurement/requests?status=submitted"><small class="pm-muted">طلبات شراء بانتظار الاعتماد</small><b style="font-size: 1.5rem">{{ d.sourcing.requests.submitted }}</b><small class="pm-muted">{{ d.sourcing.requests.approved }} معتمدة بانتظار التوريد</small></RouterLink>
        <RouterLink class="pc-kpi" to="/procurement/rfqs"><small class="pm-muted">منافسات مفتوحة للعروض</small><b style="font-size: 1.5rem">{{ d.sourcing.rfqs.open }}</b><small class="pm-muted">{{ d.sourcing.rfqs.toOpen }} بانتظار الفتح · {{ d.sourcing.rfqs.evaluating }} قيد التقييم</small></RouterLink>
        <RouterLink class="pc-kpi" to="/procurement/orders?status=pending"><small class="pm-muted">تعميدات بانتظار الاعتماد</small><b style="font-size: 1.5rem">{{ d.sourcing.orders.pending }}</b><small class="pm-muted">مستويات حسب القيمة</small></RouterLink>
        <RouterLink class="pc-kpi" to="/procurement/orders?status=issued"><small class="pm-muted">تعميدات سارية</small><b style="font-size: 1.5rem">{{ d.sourcing.orders.live }}</b><small class="pm-muted">{{ sar(d.sourcing.orders.liveTotal) }}<span v-if="d.sourcing.orders.late" class="pc-flag" style="margin-inline-start: 6px">{{ d.sourcing.orders.late }} متأخر</span></small></RouterLink>
      </div>
      <template v-if="d.stock">
        <div v-if="!d.stock.configured.grni || !d.stock.configured.adjust" class="alert" style="background: #fffbeb; margin-bottom: 14px">
          حدد حسابات قيود المستودعات قبل الاستلام: <RouterLink class="pm-link" to="/procurement/settings">الإعدادات ← المستودعات</RouterLink>
        </div>
        <div class="pc-cards" style="margin-bottom: 18px">
          <RouterLink class="pc-kpi" to="/procurement/stock"><small class="pm-muted">قيمة المخزون</small><b style="font-size: 1.4rem">{{ sar(d.stock.value) }}</b><small class="pm-muted">{{ d.stock.lines }} رصيد · صُرف هذا الشهر {{ sar(d.stock.docs.issuedMonth) }}</small></RouterLink>
          <RouterLink class="pc-kpi" :class="{ hot: d.stock.expired || d.stock.expiring }" to="/procurement/stock?alert=expiry"><small class="pm-muted">تنبيهات الصلاحية</small><b style="font-size: 1.5rem">{{ d.stock.expired + d.stock.expiring }}</b><small class="pm-muted">{{ d.stock.expired }} منتهية · {{ d.stock.expiring }} خلال {{ d.stock.expiryAlertDays }} يومًا</small></RouterLink>
          <RouterLink class="pc-kpi" :class="{ hot: d.stock.reorder.length }" to="/procurement/stock?alert=reorder"><small class="pm-muted">أصناف بلغت حد إعادة الطلب</small><b style="font-size: 1.5rem">{{ d.stock.reorder.length }}</b><small class="pm-muted">اطلب شراءها قبل النفاد</small></RouterLink>
          <RouterLink class="pc-kpi" :class="{ hot: d.stock.issueRequests.submitted }" to="/procurement/issue-requests?todo=1"><small class="pm-muted">طلبات صرف</small><b style="font-size: 1.5rem">{{ d.stock.issueRequests.submitted }}</b><small class="pm-muted">بانتظار الاعتماد · {{ d.stock.issueRequests.toIssue }} بانتظار الصرف</small></RouterLink>
          <RouterLink class="pc-kpi" :class="{ hot: d.stock.docs.pendingWriteoffs || d.stock.counts.submitted }" to="/procurement/stock-docs?status=pending"><small class="pm-muted">بانتظار الاعتماد</small><b style="font-size: 1.5rem">{{ d.stock.docs.pendingWriteoffs + d.stock.counts.submitted }}</b><small class="pm-muted">{{ d.stock.docs.pendingWriteoffs }} إتلاف · {{ d.stock.counts.submitted }} جرد</small></RouterLink>
          <RouterLink class="pc-kpi" to="/procurement/warehouses?tab=reconcile"><small class="pm-muted">المطابقة مع الدليل</small><b style="font-size: 1.3rem" :style="{ color: d.stock.reconcile?.ok === false ? '#b91c1c' : '#047857' }">{{ d.stock.reconcile ? (d.stock.reconcile.ok ? '✓ مطابق' : `✕ ${d.stock.reconcile.issues} فرق`) : '—' }}</b><small class="pm-muted">حسابات المخزون مقابل المستودعات</small></RouterLink>
        </div>
      </template>

      <div class="pc-grid">
        <section v-if="d.stock?.dueOrders.length" class="card pm-panel">
          <h2>تعميدات بانتظار الاستلام <RouterLink to="/procurement/receipts" class="pm-link">الاستلام</RouterLink></h2>
          <RouterLink v-for="o in d.stock.dueOrders" :key="o.id" :to="`/procurement/orders/${o.id}`" class="line">
            <span><b>{{ o.title }}</b><small class="pm-muted">{{ o.supplierName }}</small></span>
            <span :class="o.late ? 'pc-flag' : 'pc-warn'">{{ o.status === 'partial' ? 'مستلم جزئيًا' : o.late ? 'متأخر' : 'التسليم' }} {{ fmtDate(o.deliveryDate) }}</span>
          </RouterLink>
        </section>
        <section v-if="d.stock?.byWarehouse.length" class="card pm-panel">
          <h2>قيمة المخزون حسب المستودع</h2>
          <div class="pc-bars">
            <div v-for="w in d.stock.byWarehouse" :key="w.name" class="r"><span>{{ w.name }}</span><div class="pc-bar"><i :style="{ width: (w.value / maxWh) * 100 + '%', '--c': '#0369a1' }" /></div><b style="font-size: .78rem">{{ sar(w.value) }}</b></div>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>تحت الإجراء</h2>
          <div class="queue">
            <RouterLink to="/procurement/supplier-approvals" class="q"><span>موردون بانتظار الاعتماد</span><b>{{ d.approvals.suppliers }}</b></RouterLink>
            <RouterLink to="/procurement/supplier-approvals" class="q"><span>مستندات محدّثة بانتظار المراجعة</span><b>{{ d.approvals.docs }}</b></RouterLink>
            <RouterLink to="/procurement/supplier-approvals" class="q hot"><span>حسابات بنكية بانتظار الاعتماد</span><b>{{ d.approvals.banks }}</b></RouterLink>
            <RouterLink to="/procurement/suppliers?status=returned" class="q"><span>طلبات معادة للمورد للاستكمال</span><b>{{ sup('returned') }}</b></RouterLink>
            <RouterLink to="/procurement/suppliers?status=suspended" class="q"><span>موردون موقوفون</span><b>{{ sup('suspended') }}</b></RouterLink>
          </div>
          <p v-if="!pendingTotal" class="pm-muted" style="margin: 10px 0 0">لا يوجد ما ينتظر قرارك ✓</p>
        </section>
        <section class="card pm-panel">
          <h2>بوابة الموردين</h2>
          <p class="pm-muted">يسجل المورد بنفسه، ويرفع مستنداته، ويطلب تغيير حسابه البنكي، ويتابع حالة طلبه.</p>
          <p class="pc-code" style="word-break: break-all; white-space: normal">{{ d.portalUrl }}</p>
          <div class="pc-inline"><button class="btn btn-sm" @click="copyPortal">نسخ الرابط</button><a :href="d.portalUrl" target="_blank" rel="noopener" class="btn btn-sm">فتح البوابة</a></div>
        </section>

        <section class="card pm-panel">
          <h2>مستندات الموردين المنتهية أو القريبة من الانتهاء</h2>
          <p v-if="!d.expiring.length" class="pc-empty">كل المستندات سارية ✓</p>
          <RouterLink v-for="x in d.expiring" :key="x.id" :to="`/procurement/suppliers/${x.supplierId}`" class="line">
            <span><b>{{ x.supplier }}</b><small class="pm-muted">{{ x.title }}</small></span>
            <span :class="x.expired ? 'pc-flag' : 'pc-warn'">{{ x.expired ? 'منتهي' : 'ينتهي' }} {{ fmtDate(x.expiryDate) }}</span>
          </RouterLink>
        </section>
        <section class="card pm-panel">
          <h2>أنشطة الموردين المعتمدين</h2>
          <p v-if="!d.activities.length" class="pc-empty">لا يوجد موردون معتمدون بعد</p>
          <div class="pc-bars">
            <div v-for="a in d.activities" :key="a.name" class="r"><span>{{ a.name }}</span><div class="pc-bar"><i :style="{ width: (a.n / maxAct) * 100 + '%' }" /></div><b>{{ a.n }}</b></div>
          </div>
        </section>
        <section class="card pm-panel wide">
          <h2>الأصناف حسب المجموعة <RouterLink to="/procurement/item-groups" class="pm-link">المجموعات</RouterLink></h2>
          <div class="pc-bars">
            <div v-for="g in d.groups" :key="g.name" class="r"><span>{{ g.name }}</span><div class="pc-bar"><i :style="{ width: (g.n / maxGroup) * 100 + '%', '--c': '#164e38' }" /></div><b>{{ g.n }}</b></div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.queue { display: grid; gap: 6px; }
.q { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 12px; border: 1px solid var(--border); color: var(--text); transition: all .2s; }
.q:hover { border-color: #38bdf8; background: #f0f9ff; transform: translateX(-3px); }
.q b { min-width: 30px; text-align: center; border-radius: 999px; background: var(--surface-2); padding: 1px 8px; }
.q.hot b { background: #fce7f3; color: #be185d; }
.line { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 4px; border-bottom: 1px solid var(--border); color: var(--text); }
.line:hover { background: var(--surface-2); }
.line small { display: block; }
</style>
