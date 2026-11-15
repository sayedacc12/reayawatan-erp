<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import StatusBadge from '../modules/beneficiaries/components/StatusBadge.vue';
import { fmtDateTime } from '../modules/beneficiaries/labels';
import { portalApi, type PortalRequestRow } from './portal';

const slug = useRoute().params.slug as string;
const rows = ref<PortalRequestRow[] | null>(null);
const name = ref('');
const error = ref('');

onMounted(async () => {
  try {
    const [me, list] = await Promise.all([
      portalApi<{ profile: { fullName: string } }>('/me'),
      portalApi<PortalRequestRow[]>('/requests'),
    ]);
    name.value = me.profile.fullName;
    rows.value = list;
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const progress = (r: PortalRequestRow) => {
  if (r.status === 'approved') return 100;
  if (!r.stageCount || !r.stageIndex) return 4;
  return Math.round(((r.stageIndex - 1) / r.stageCount) * 100) + 6;
};
</script>

<template>
  <div>
    <section class="welcome">
      <div>
        <h1>أهلًا {{ name.split(' ')[0] }} 👋</h1>
        <p class="muted">هنا تقدر تتابع كل طلباتك ومرحلة كل طلب.</p>
      </div>
      <RouterLink :to="`/portal/${slug}/apply`" class="btn btn-primary big">+ تقديم طلب جديد</RouterLink>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="rows && !rows.length" class="card empty">
      <div class="art">🌾</div>
      <p>لسه ما قدمتش أي طلب.</p>
      <RouterLink :to="`/portal/${slug}/apply`" class="btn btn-primary">قدّم أول طلب</RouterLink>
    </div>
    <div class="list">
      <RouterLink v-for="(r, i) in rows ?? []" :key="r.id" :to="`/portal/${slug}/requests/${r.id}`" :class="['card req', r.status, { action: r.contributionStatus === 'awaiting' }]" :style="{ '--i': i }">
        <div class="top">
          <span class="no">طلب #{{ r.requestNo }}</span>
          <StatusBadge :value="r.status" kind="request" />
        </div>
        <h3>{{ r.project }}</h3>
        <p class="muted small">
          <template v-if="r.status === 'in_progress' && r.contributionStatus === 'awaiting'"><b class="need">💰 مطلوب منك رفع إثبات مساهمتك</b></template>
          <template v-else-if="r.status === 'in_progress'">المرحلة الحالية: <b>{{ r.stage }}</b> ({{ r.stageIndex }} من {{ r.stageCount }})</template>
          <template v-else-if="r.status === 'returned'">⚠ الطلب محتاج منك استكمال بيانات، افتحه وشوف المطلوب</template>
          <template v-else-if="r.status === 'approved'">🎉 تم اعتماد طلبك</template>
          <template v-else>آخر تحديث {{ fmtDateTime(r.updatedAt) }}</template>
        </p>
        <div class="bar"><span :style="{ width: progress(r) + '%' }" /></div>
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.welcome { display: flex; justify-content: space-between; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 20px; }
.welcome h1 { font-size: 1.6rem; }
.welcome p { margin: 4px 0 0; }
.big { min-height: 48px; padding: 10px 22px; font-size: 1.02rem; }
.empty { padding: 40px; text-align: center; }
.art { font-size: 2.6rem; animation: sway 3s ease-in-out infinite; display: inline-block; }
@keyframes sway { 50% { transform: rotate(-8deg); } }
.list { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.req { padding: 18px; color: var(--text); display: flex; flex-direction: column; gap: 6px; transition: transform .25s var(--ease), box-shadow .25s; animation: rise .45s calc(var(--i) * 70ms) var(--ease) both; position: relative; overflow: hidden; }
.req:hover { transform: translateY(-4px); box-shadow: 0 16px 34px rgba(16,24,40,.1); }
.req.action { border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.15); }
.need { color: #b45309; }
.req.returned { border-color: #fcd34d; background: #fffbeb; }
.req.approved::after { content: ''; position: absolute; inset: 0; background: radial-gradient(300px 120px at 100% 0%, rgba(232,176,75,.22), transparent 70%); pointer-events: none; }
.top { display: flex; justify-content: space-between; align-items: center; }
.no { font-size: .8rem; color: var(--primary); font-weight: 700; }
.req h3 { font-size: 1.08rem; }
.small { font-size: .86rem; margin: 0; }
.bar { height: 7px; border-radius: 7px; background: var(--surface-2); overflow: hidden; margin-top: 6px; }
.bar span { display: block; height: 100%; border-radius: 7px; background: linear-gradient(90deg, #2dd4bf, #0f766e); box-shadow: 0 0 10px rgba(20,184,166,.6); animation: grow 1s var(--ease) both; transform-origin: right; }
.approved .bar span { background: linear-gradient(90deg, #f5c66b, #d99a2b); }
.rejected .bar span, .cancelled .bar span { background: #cbd5e1; box-shadow: none; }
@keyframes grow { from { transform: scaleX(0); } }
@keyframes rise { from { opacity: 0; transform: translateY(12px); } }
</style>
