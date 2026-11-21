<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import CountUp from '../../../shared/CountUp.vue';
import StatusPill from '../components/StatusPill.vue';
import { MONTHS, P, copy, fmtDate, num, publicUrl, sar } from '../lib';
import '../../../shared/module.css';
import '../members.css';

interface Dash {
  year: number;
  members: { current: number; active: number; expiring: number; grace: number; expired: number; suspended: number; terminated: number; total: number; female: number; voting: number };
  quorum: number;
  applications: { inReview: number; returned: number; awaitingPayment: number; mine: number };
  invoices: { unpaid: number; unpaidAmount: number; review: number };
  collected: number; monthly: number[]; joins: number[];
  byType: { code: string; name: string; color: string; count: number }[];
  expiring: { id: string; memberNo: number; fullName: string; typeName: string; endDate: string; daysLeft: number; status: string; statusLabel: string }[];
  recent: { id: string; applicationNo: string; fullName: string; typeName: string; status: string; statusLabel: string; source: string; createdAt: string }[];
  publicEnabled: boolean;
}
const session = useSession();
const toast = useToast();
const data = ref<Dash | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    data.value = await api<Dash>('/members/dashboard');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const maxMonth = computed(() => Math.max(1, ...(data.value?.monthly ?? [1])));
const typeTotal = computed(() => Math.max(1, data.value?.byType.reduce((a, t) => a + t.count, 0) ?? 1));
/** مخطط دائري لأنواع العضوية */
const donut = computed(() => {
  if (!data.value) return '';
  let acc = 0;
  const parts = data.value.byType.filter((t) => t.count).map((t) => {
    const from = (acc / typeTotal.value) * 100;
    acc += t.count;
    return `${t.color} ${from}% ${(acc / typeTotal.value) * 100}%`;
  });
  return parts.length ? `conic-gradient(${parts.join(', ')})` : 'conic-gradient(var(--surface-2) 0 100%)';
});
async function copyLink() {
  if (await copy(publicUrl(`/m/${session.user?.organizationSlug}`))) toast.success('نُسخ رابط صفحة العضوية العامة');
}
</script>

<template>
  <div>
    <section class="pm-hero mb-hero">
      <div>
        <p class="pm-kicker">العضوية</p>
        <h1>الجمعية العمومية في لمحة</h1>
        <p class="pm-sub">طلبات العضوية من الموقع ومراحل اعتمادها، سجل الأعضاء واشتراكاتهم، التجديد والتنبيهات، وأصحاب حق التصويت.</p>
      </div>
      <div class="pm-actions">
        <RouterLink v-if="session.can(P.applications)" to="/members/applications?new=1" class="btn mb-glow">طلب عضوية جديد</RouterLink>
        <button class="btn mb-ghost" @click="copyLink">نسخ رابط صفحة العضوية</button>
        <RouterLink to="/members/assembly" class="btn mb-ghost">كشف الجمعية العمومية</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="data">
      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #0f766e; --i: 0"><span>الأعضاء الساريون</span><strong><CountUp :value="data.members.current" /></strong><small>{{ data.members.female }} عضوة · {{ data.members.current - data.members.female }} عضو</small></div>
        <div class="pm-kpi" style="--a: #1e3a8a; --i: 1"><span>أصحاب حق التصويت</span><strong><CountUp :value="data.members.voting" /></strong><small>النصاب {{ data.quorum }} عضوًا (النصف + 1)</small></div>
        <div class="pm-kpi" style="--a: #f59e0b; --i: 2"><span>تنتهي قريبًا</span><strong><CountUp :value="data.members.expiring + data.members.grace" /></strong><small>{{ data.members.grace }} في مهلة السماح · {{ data.members.expired }} منتهية</small></div>
        <div class="pm-kpi" style="--a: #fbbf24; --i: 3"><span>تحصيل الاشتراكات {{ data.year }}</span><strong><CountUp :value="data.collected" /></strong><small>ريال · {{ data.invoices.unpaid }} مطالبة بانتظار السداد ({{ sar(data.invoices.unpaidAmount) }})</small></div>
      </div>

      <div class="mb-grid">
        <section class="card pm-panel">
          <h2>بانتظار إجراء</h2>
          <div class="mb-chips" style="flex-direction: column; align-items: stretch">
            <RouterLink to="/members/approvals" class="mb-chip">طلبات بانتظار قرارك <b style="margin-inline-start: auto">{{ data.applications.mine }}</b></RouterLink>
            <RouterLink to="/members/applications?status=in_review" class="mb-chip">طلبات قيد الاعتماد <b style="margin-inline-start: auto">{{ data.applications.inReview }}</b></RouterLink>
            <RouterLink to="/members/applications?status=returned" class="mb-chip">طلبات معادة للمتقدم <b style="margin-inline-start: auto">{{ data.applications.returned }}</b></RouterLink>
            <RouterLink to="/members/applications?status=awaiting_payment" class="mb-chip">معتمدة بانتظار السداد <b style="margin-inline-start: auto">{{ data.applications.awaitingPayment }}</b></RouterLink>
            <RouterLink to="/members/invoices?status=review" class="mb-chip">تحويلات بنكية بانتظار التأكيد <b style="margin-inline-start: auto">{{ data.invoices.review }}</b></RouterLink>
            <RouterLink to="/members/renewals" class="mb-chip">عضويات تحتاج تنبيهًا أو تجديدًا <b style="margin-inline-start: auto">{{ data.members.expiring + data.members.grace }}</b></RouterLink>
          </div>
          <p v-if="!data.publicEnabled" class="pm-muted">التقديم من الموقع متوقف من الإعدادات.</p>
        </section>
        <section class="card pm-panel">
          <h2>الأعضاء حسب النوع</h2>
          <div class="donut-wrap">
            <div class="donut" :style="{ background: donut }"><b>{{ data.members.current }}</b></div>
            <div class="legend">
              <div v-for="t in data.byType" :key="t.code"><i :style="{ background: t.color }" />{{ t.name }}<b>{{ t.count }}</b></div>
            </div>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>تحصيل الاشتراكات حسب الشهر {{ data.year }}</h2>
          <div class="mb-cols">
            <div v-for="(h, i) in data.monthly" :key="i" :title="`${MONTHS[i]}: ${sar(h)} · ${data.joins[i]} عضو جديد`"><span>{{ h ? num(h) : '' }}</span><i :style="{ height: (h / maxMonth) * 100 + '%', animationDelay: i * 40 + 'ms' }" /><span>{{ MONTHS[i].slice(0, 3) }}</span></div>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>عضويات تنتهي قريبًا <RouterLink to="/members/renewals" class="pm-link">التجديد والتنبيهات</RouterLink></h2>
          <p v-if="!data.expiring.length" class="mb-empty">لا توجد عضويات تنتهي قريبًا</p>
          <div v-for="m in data.expiring" :key="m.id" class="exp" @click="$router.push(`/members/list/${m.id}`)">
            <span><b>{{ m.fullName }}</b><small class="pm-muted" style="display: block">{{ m.memberNo }} · {{ m.typeName }} · {{ fmtDate(m.endDate) }}</small></span>
            <span :class="['days', { late: m.daysLeft < 0 }]">{{ m.daysLeft < 0 ? `انتهت منذ ${-m.daysLeft} يوم` : `${m.daysLeft} يوم` }}</span>
          </div>
        </section>
        <section class="card pm-panel wide">
          <h2>أحدث الطلبات <RouterLink to="/members/applications" class="pm-link">كل الطلبات</RouterLink></h2>
          <div class="table-wrap">
            <table class="table">
              <tbody>
                <tr v-for="a in data.recent" :key="a.id" class="mb-row" @click="$router.push(`/members/applications/${a.id}`)">
                  <td class="mb-code">{{ a.applicationNo }}</td><td><b>{{ a.fullName }}</b></td><td>{{ a.typeName }}</td>
                  <td>{{ a.source === 'public' ? 'من الموقع' : 'إدخال موظف' }}</td><td>{{ fmtDate(a.createdAt) }}</td><td><StatusPill :status="a.status" :label="a.statusLabel" /></td>
                </tr>
                <tr v-if="!data.recent.length"><td colspan="6" class="pm-empty">لا توجد طلبات بعد. شارك رابط صفحة العضوية العامة.</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.donut-wrap { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
.donut { width: 140px; height: 140px; border-radius: 50%; display: grid; place-items: center; position: relative; animation: mb-spin .9s var(--ease) both; }
.donut::after { content: ''; position: absolute; inset: 22px; border-radius: 50%; background: var(--surface); }
.donut b { position: relative; z-index: 1; font-size: 1.5rem; }
.legend { display: grid; gap: 6px; flex: 1; min-width: 140px; }
.legend div { display: flex; align-items: center; gap: 8px; font-size: .88rem; }
.legend i { width: 12px; height: 12px; border-radius: 4px; }
.legend b { margin-inline-start: auto; }
.exp { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 4px; border-bottom: 1px solid var(--border); cursor: pointer; }
.exp:hover { background: var(--surface-2); }
.days { font-size: .8rem; font-weight: 700; color: #b45309; background: #fef3c7; border-radius: 999px; padding: 2px 10px; white-space: nowrap; }
.days.late { color: #b91c1c; background: #fee2e2; }
</style>
