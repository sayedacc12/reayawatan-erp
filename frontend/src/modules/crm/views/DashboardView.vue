<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import ActivityTimeline from '../components/ActivityTimeline.vue';
import LeadForm from '../components/LeadForm.vue';
import { CR, LEAD_COLOR, ROLE_COLOR, lookups } from '../lib';
import '../../../shared/module.css';
import '../crm.css';

const session = useSession();
const toast = useToast();
const router = useRouter();
const d = ref<any>(null);
const lk = ref<any>(null);
const adding = ref(false);
async function load() {
  try {
    [lk.value, d.value] = await Promise.all([lookups(), api('/crm/dashboard')]);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
const funnel = computed(() => {
  if (!d.value) return [];
  const l = d.value.leads;
  return [
    { key: 'new', label: 'جديد', n: l.new }, { key: 'contacted', label: 'تم التواصل', n: l.contacted }, { key: 'qualified', label: 'مؤهل', n: l.qualified },
    { key: 'converted', label: 'تحول لجهة (90 يومًا)', n: l.converted90 },
  ];
});
const maxFunnel = computed(() => Math.max(1, ...funnel.value.map((f) => f.n)));
const maxSource = computed(() => Math.max(1, ...(d.value?.bySource ?? []).map((s: any) => s.n)));
const maxWeek = computed(() => Math.max(1, ...(d.value?.trend ?? []).map((w: any) => w.n)));
const pct = (v: number | null) => (v === null || v === undefined ? '—' : `${v}%`);
</script>

<template>
  <div>
    <section class="pm-hero cr-hero">
      <div class="cr-funnel" aria-hidden="true"><i /><i /><i /><i /></div>
      <div>
        <p class="pm-kicker">علاقات العملاء والتسويق</p>
        <h1>ملف واحد لكل من يتعامل مع الشركة</h1>
        <p class="pm-sub">العملاء والأعضاء والمتطوعون والشركاء في سجل موحد يربط سجلاتهم في أنظمتها دون نقلها، مع العملاء المحتملين من الموقع والمعارض والاستيراد، وتوزيعهم على الفريق، ومتابعتهم بمهلة تواصل أول وأنشطة مجدولة.</p>
      </div>
      <div class="pm-actions">
        <button v-if="session.can(CR.manage)" class="btn cr-glow" @click="adding = true">+ عميل محتمل</button>
        <RouterLink to="/crm/parties" class="btn cr-ghost">الجهات</RouterLink>
        <RouterLink to="/crm/activities" class="btn cr-ghost">أنشطتي</RouterLink>
      </div>
    </section>
    <template v-if="d && lk">
      <div class="pm-kpis">
        <RouterLink to="/crm/parties" class="pm-kpi" style="--a: #0891b2; --i: 0"><span>الجهات</span><strong>{{ d.parties.total }}</strong><small>{{ d.parties.orgs }} منشأة · {{ d.parties.new30 }} جديدة خلال 30 يومًا</small></RouterLink>
        <RouterLink to="/crm/leads?status=open" class="pm-kpi" style="--a: #7c3aed; --i: 1"><span>عملاء محتملون مفتوحون</span><strong>{{ d.leads.open }}</strong><small>{{ d.leads.unassigned }} بلا مسؤول</small></RouterLink>
        <RouterLink to="/crm/leads?scope=overdue" class="pm-kpi" style="--a: #dc2626; --i: 2"><span>تجاوزوا مهلة التواصل</span><strong>{{ d.leads.overdue }}</strong><small>المهلة {{ d.slaHours }} ساعة من الوصول</small></RouterLink>
        <div class="pm-kpi" style="--a: #059669; --i: 3"><span>نسبة التحويل (90 يومًا)</span><strong>{{ pct(d.leads.conversionRate) }}</strong><small>التواصل في المهلة {{ pct(d.leads.onTimeRate) }} · متوسط أول تواصل {{ d.leads.avgHours ?? '—' }} ساعة</small></div>
      </div>
      <div class="cr-grid">
        <section class="card pm-panel">
          <h2>مسار العملاء المحتملين</h2>
          <div class="cr-bars">
            <RouterLink v-for="f in funnel" :key="f.key" class="r" :to="`/crm/leads?status=${f.key}`" style="color: inherit">
              <span>{{ f.label }}</span><div class="cr-bar"><i :style="{ width: `${(f.n / maxFunnel) * 100}%`, '--c': LEAD_COLOR[f.key] }" /></div><b>{{ f.n }}</b>
            </RouterLink>
          </div>
          <p class="cr-sec">المصادر خلال 90 يومًا (والمتحول منها)</p>
          <div v-if="!d.bySource.length" class="cr-empty">لا يوجد عملاء محتملون خلال الفترة</div>
          <div class="cr-bars">
            <div v-for="s in d.bySource" :key="s.source" class="r">
              <span>{{ s.label }}</span>
              <div class="cr-bar"><i :style="{ width: `${(s.n / maxSource) * 100}%` }" /><i class="conv" :style="{ width: `${(s.converted / maxSource) * 100}%` }" /></div>
              <b>{{ s.n }} <small class="pm-muted">({{ s.converted }})</small></b>
            </div>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>الأنشطة</h2>
          <div class="cr-stats">
            <div :class="{ 'alert-v': d.activities.overdue }"><b>{{ d.activities.overdue }}</b>متأخرة</div>
            <div><b>{{ d.activities.today }}</b>اليوم</div>
            <div><b>{{ d.activities.week }}</b>خلال 7 أيام</div>
            <div><b>{{ d.activities.done30 }}</b>منجزة خلال 30 يومًا</div>
          </div>
          <p class="cr-sec">أدوار الجهات</p>
          <div class="cr-chips">
            <RouterLink v-for="r in d.roles" :key="r.role" :to="`/crm/parties?role=${r.role}`" class="cr-chip" :style="{ '--c': ROLE_COLOR[r.role] }">{{ r.label }} {{ r.n }}</RouterLink>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>القادم من أنشطتك <RouterLink class="pm-link" to="/crm/activities" style="font-size: .8rem; font-weight: 400">التقويم ←</RouterLink></h2>
          <ActivityTimeline :items="d.upcoming" :lk="lk" :can-manage="session.can(CR.manage)" show-target @changed="load" />
        </section>
        <section class="card pm-panel">
          <template v-if="d.byOwner.length">
            <h2>الفريق</h2>
            <table class="table">
              <thead><tr><th>الموظف</th><th>مفتوح</th><th>متأخر</th><th>تحول</th></tr></thead>
              <tbody>
                <tr v-for="o in d.byOwner" :key="o.ownerId" class="cr-row" @click="router.push(`/crm/leads?owner=${o.ownerId}`)">
                  <td>{{ o.name }}</td><td>{{ o.open }}</td><td><span v-if="o.overdue" class="cr-flag">{{ o.overdue }}</span><template v-else>0</template></td><td>{{ o.converted }}</td>
                </tr>
              </tbody>
            </table>
          </template>
          <h2 :style="{ marginTop: d.byOwner.length ? '18px' : 0 }">العملاء المحتملون أسبوعيًا</h2>
          <div v-if="!d.trend.length" class="cr-empty">لا توجد بيانات بعد</div>
          <div class="cr-trend">
            <div v-for="w in d.trend" :key="w.week" :title="`أسبوع ${w.week}: ${w.n} (تحول ${w.converted})`"><i :style="{ height: `${(w.n / maxWeek) * 100}%` }" /></div>
          </div>
        </section>
      </div>
    </template>
    <LeadForm v-if="adding && lk" :lk="lk" @close="adding = false" @saved="(r) => router.push(`/crm/leads/${r.id}`)" />
  </div>
</template>
