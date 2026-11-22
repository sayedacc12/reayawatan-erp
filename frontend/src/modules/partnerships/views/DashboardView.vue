<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import CountUp from '../../../shared/CountUp.vue';
import PartnerForm from '../components/PartnerForm.vue';
import NewContractForm from '../components/NewContractForm.vue';
import { PARTNER_COLOR, PT, fmtDate, sar } from '../lib';
import '../../../shared/module.css';
import '../partnerships.css';

const session = useSession();
const d = ref<any>(null);
const error = ref('');
const adding = ref(false);
const contracting = ref(false);
async function load() {
  try {
    d.value = await api('/partnerships/overview');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
const tierTotal = computed(() => Math.max(1, d.value?.byTier.reduce((a: number, t: any) => a + t.count, 0) ?? 1));
const donut = computed(() => {
  if (!d.value) return '';
  let acc = 0;
  const parts = d.value.byTier.filter((t: any) => t.count).map((t: any) => {
    const from = (acc / tierTotal.value) * 100;
    acc += t.count;
    return `${t.color} ${from}% ${(acc / tierTotal.value) * 100}%`;
  });
  return parts.length ? `conic-gradient(${parts.join(', ')})` : 'conic-gradient(var(--surface-2) 0 100%)';
});
const maxType = computed(() => Math.max(1, ...(d.value?.byType ?? []).map((t: any) => t.partners)));
const maxClass = computed(() => Math.max(1, ...(d.value?.byClass ?? []).map((t: any) => t.count)));
</script>

<template>
  <div>
    <section class="pm-hero pt-hero">
      <div class="pt-rings" aria-hidden="true"><i /><i /></div>
      <div>
        <p class="pm-kicker">الشراكات</p>
        <h1>شراكات مختارة بمعايير، وعقود محكمة البنود</h1>
        <p class="pm-sub">سجل الشركاء وتقييمهم الموزون واعتمادهم، وصياغة الاتفاقيات من مكتبة بنود مبوبة، والتوقيع الإلكتروني ومتابعة الالتزامات حتى التجديد.</p>
      </div>
      <div class="pm-actions">
        <button v-if="session.can(PT.partners)" class="btn pt-glow" @click="adding = true">+ شريك جديد</button>
        <button v-if="session.can(PT.contracts)" class="btn pt-ghost" @click="contracting = true">عقد شراكة جديد</button>
        <RouterLink v-if="session.can(PT.contracts)" to="/partnerships/clauses" class="btn pt-ghost">مكتبة البنود</RouterLink>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="d">
      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #059669; --i: 0"><span>الشركاء المعتمدون</span><strong><CountUp :value="d.partners.approved" /></strong><small>متوسط الدرجة {{ d.partners.avgScore }} من 100 · {{ d.partners.prospects }} محتمل</small></div>
        <div class="pm-kpi" style="--a: #f59e0b; --i: 1"><span>العقود السارية</span><strong><CountUp :value="d.contracts.active" /></strong><small>بقيمة {{ sar(d.contracts.value) }}</small></div>
        <div class="pm-kpi" style="--a: #db2777; --i: 2"><span>تنتهي خلال {{ d.alertDays }} يومًا</span><strong><CountUp :value="d.contracts.expiring" /></strong><small>{{ d.contracts.expired }} منتهية · {{ d.partners.evaluationDue }} شريك مستحق إعادة التقييم</small></div>
        <div class="pm-kpi" style="--a: #0369a1; --i: 3"><span>التزامات متأخرة</span><strong><CountUp :value="d.followups.overdue" /></strong><small>{{ d.followups.soon }} تستحق خلال 30 يومًا · {{ d.followups.done }} منجزة</small></div>
      </div>

      <div class="pt-grid">
        <section class="card pm-panel">
          <h2>تحت الإجراء</h2>
          <div class="queue">
            <RouterLink to="/partnerships/approvals" class="q"><span>تقييمات بانتظار الاعتماد</span><b>{{ d.pendingEvaluations }}</b></RouterLink>
            <RouterLink to="/partnerships/contracts?status=review" class="q"><span>عقود بانتظار الاعتماد الداخلي</span><b>{{ d.contracts.review }}</b></RouterLink>
            <RouterLink to="/partnerships/contracts?status=changes_requested" class="q hot"><span>طلب الشريك تعديل العقد</span><b>{{ d.contracts.changes }}</b></RouterLink>
            <RouterLink to="/partnerships/contracts?status=sent" class="q"><span>عقود معتمدة أو مرسلة بانتظار التوقيع</span><b>{{ d.contracts.awaitingSign }}</b></RouterLink>
            <RouterLink to="/partnerships/contracts?status=draft" class="q"><span>مسودات عقود</span><b>{{ d.contracts.drafts }}</b></RouterLink>
            <RouterLink to="/partnerships/partners?status=evaluating" class="q"><span>شركاء قيد التقييم أو محتملون</span><b>{{ d.partners.prospects }}</b></RouterLink>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>مستويات الشركاء</h2>
          <div class="donut-wrap">
            <div class="donut" :style="{ background: donut }"><b>{{ d.partners.approved }}</b></div>
            <div class="legend">
              <div v-for="t in d.byTier" :key="t.key"><i :style="{ background: t.color }" />{{ t.label }}<b>{{ t.count }}</b></div>
            </div>
          </div>
        </section>

        <section class="card pm-panel">
          <h2>عقود تنتهي قريبًا <RouterLink to="/partnerships/followups" class="pm-link">المتابعة والتنبيهات</RouterLink></h2>
          <p v-if="!d.expiring.length" class="pt-empty">لا توجد عقود تنتهي خلال {{ d.alertDays }} يومًا</p>
          <RouterLink v-for="c in d.expiring" :key="c.id" :to="`/partnerships/contracts/${c.id}`" class="line">
            <span><b>{{ c.partnerName }}</b><small class="pm-muted"><span class="pt-code">{{ c.number }}</span> · {{ c.title }}</small></span>
            <span :class="['pt-days', { late: c.daysLeft < 15 }]">{{ c.daysLeft }} يوم</span>
          </RouterLink>
        </section>
        <section class="card pm-panel">
          <h2>التزامات متأخرة</h2>
          <p v-if="!d.overdue.length" class="pt-empty">لا توجد التزامات متأخرة ✓</p>
          <RouterLink v-for="f in d.overdue" :key="f.id" :to="`/partnerships/contracts/${f.contractId}`" class="line">
            <span><b>{{ f.title }}</b><small class="pm-muted">{{ f.partnerName }} · {{ f.party === 'partner' ? 'على الشريك' : 'على الجمعية' }}</small></span>
            <span class="pt-days late">منذ {{ -f.daysLeft }} يوم</span>
          </RouterLink>
        </section>

        <section class="card pm-panel">
          <h2>الشركاء حسب نوع الشراكة</h2>
          <div class="pt-bars">
            <div v-for="t in d.byType" :key="t.id" class="r"><span>{{ t.name }}</span><div class="pt-bar"><i :style="{ width: (t.partners / maxType) * 100 + '%', '--c': t.color }" /></div><b>{{ t.partners }}</b></div>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>حسب تصنيف الشريك</h2>
          <div class="pt-bars">
            <div v-for="c in d.byClass" :key="c.id" class="r"><span>{{ c.name }}</span><div class="pt-bar"><i :style="{ width: (c.count / maxClass) * 100 + '%', '--c': c.color }" /></div><b>{{ c.count }}</b></div>
          </div>
        </section>

        <section class="card pm-panel wide">
          <h2>آخر الشركاء تحديثًا <RouterLink to="/partnerships/partners" class="pm-link">سجل الشركاء</RouterLink></h2>
          <div class="table-wrap">
            <table class="table">
              <tbody>
                <tr v-for="p in d.recent" :key="p.id" class="pt-row" @click="$router.push(`/partnerships/partners/${p.id}`)">
                  <td class="pt-code">{{ p.code }}</td><td><b>{{ p.name }}</b><span class="pm-muted">{{ p.className ?? '—' }}</span></td>
                  <td><div class="pt-chips"><span v-for="t in p.types" :key="t.id" class="pt-chip" :style="{ '--c': t.color }">{{ t.name }}</span></div></td>
                  <td><span class="pm-pill" :style="{ '--c': PARTNER_COLOR[p.status] }">{{ p.statusLabel }}</span></td>
                  <td><span v-if="p.tierLabel" class="pt-tier" :style="{ '--c': p.tierColor }">{{ p.tierLabel }}</span></td>
                  <td class="pm-muted">{{ fmtDate(p.updatedAt) }}</td>
                </tr>
                <tr v-if="!d.recent.length"><td colspan="6" class="pt-empty">لا يوجد شركاء بعد. ابدأ بتسجيل أول شريك.</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </template>
    <PartnerForm v-if="adding" @close="adding = false" @saved="(p) => $router.push(`/partnerships/partners/${p.id}`)" />
    <NewContractForm v-if="contracting" @close="contracting = false" @saved="(c) => $router.push(`/partnerships/contracts/${c.id}`)" />
  </div>
</template>

<style scoped>
.queue { display: grid; gap: 6px; }
.q { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 12px; border: 1px solid var(--border); color: var(--text); transition: all .2s; }
.q:hover { border-color: #f59e0b; background: #fffbeb; transform: translateX(-3px); }
.q b { min-width: 30px; text-align: center; border-radius: 999px; background: var(--surface-2); padding: 1px 8px; }
.q.hot b { background: #fce7f3; color: #be185d; }
.donut-wrap { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
.donut { width: 140px; height: 140px; border-radius: 50%; display: grid; place-items: center; position: relative; animation: pt-spin .9s var(--ease) both; }
.donut::after { content: ''; position: absolute; inset: 22px; border-radius: 50%; background: var(--surface); }
.donut b { position: relative; z-index: 1; font-size: 1.5rem; }
.legend { display: grid; gap: 6px; flex: 1; min-width: 130px; }
.legend div { display: flex; align-items: center; gap: 8px; font-size: .88rem; }
.legend i { width: 12px; height: 12px; border-radius: 4px; }
.legend b { margin-inline-start: auto; }
.line { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 4px; border-bottom: 1px solid var(--border); color: var(--text); }
.line:hover { background: var(--surface-2); }
.line small { display: block; }
</style>
