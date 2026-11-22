<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { dateOnly, num, P, riyadh, SOURCES, STATUSES, type Any } from '../lib';
import '../../../shared/module.css';
import '../../../shared/ws.css';
import '../website.css';

const session = useSession();
const d = ref<Any>(null);
const error = ref('');
onMounted(async () => {
  try { d.value = await api('/website/dashboard'); } catch (e) { error.value = (e as Error).message; }
});
const maxSource = computed(() => Math.max(1, ...(d.value?.bySource ?? []).map((s: Any) => s.n)));
const maxWeek = computed(() => Math.max(1, ...(d.value?.weekly ?? []).map((s: Any) => s.n)));
</script>

<template>
  <div>
    <section class="pm-hero rw-hero">
      <div style="display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: flex-end">
        <div>
          <p class="pm-kicker">الموقع الإلكتروني · reayawatan.com</p>
          <h1>لوحة الموقع والعملاء المحتملين</h1>
          <p class="pm-sub">كل نموذج يرسله زائر الموقع يصل هنا: طلبات الاستشارة، ونتائج الحاسبة وتقييم الجاهزية، وتنزيل الأدلة، وحجوزات جلسات التشخيص.</p>
        </div>
        <div class="pm-actions" style="display: flex; gap: 8px; flex-wrap: wrap">
          <a href="/" target="_blank" class="btn btn-ghost">فتح الموقع ↗</a>
          <RouterLink v-if="session.can(P.leadsRead)" to="/website/leads" class="btn btn-ghost">العملاء المحتملون</RouterLink>
        </div>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="d">
      <div class="ws-kpis">
        <div class="ws-kpi" style="--c: #c2410c"><span class="v">{{ num(d.totals.new) }}</span><span class="l">طلبات جديدة بانتظار التواصل</span></div>
        <div class="ws-kpi"><span class="v">{{ num(d.totals.open) }}</span><span class="l">قيد المتابعة</span></div>
        <div class="ws-kpi" style="--c: #067647"><span class="v">{{ num(d.totals.won) }}</span><span class="l">تم التعاقد</span></div>
        <div class="ws-kpi" style="--c: #8f6a45"><span class="v">{{ num(d.totals.last30) }}</span><span class="l">طلبات آخر ٣٠ يومًا</span></div>
        <div class="ws-kpi" style="--c: #2563eb"><span class="v">{{ d.totals.avgScore ?? '—' }}</span><span class="l">متوسط درجة تقييم الجاهزية</span></div>
      </div>
      <div class="rw-grid2">
        <section class="card ws-panel">
          <h2>أحدث الطلبات</h2>
          <p v-if="!d.recent.length" class="ws-muted">لم يصل أي طلب بعد.</p>
          <ul class="rw-list">
            <li v-for="r in d.recent" :key="r.id">
              <RouterLink :to="`/website/leads/${r.id}`"><b>{{ r.name }}</b> <small v-if="r.orgName">· {{ r.orgName }}</small><br><small>{{ SOURCES[r.source]?.l }} · {{ dateOnly(r.createdAt) }}</small></RouterLink>
              <span class="ws-pill" :style="{ '--c': STATUSES[r.status]?.c }">{{ STATUSES[r.status]?.l }}</span>
            </li>
          </ul>
        </section>
        <section class="card ws-panel">
          <h2>جلسات التشخيص القادمة</h2>
          <p v-if="!d.upcoming.length" class="ws-muted">لا توجد جلسات محجوزة.</p>
          <ul class="rw-list">
            <li v-for="b in d.upcoming" :key="b.id">
              <RouterLink :to="`/website/leads/${b.leadId}`"><b>{{ b.name }}</b> <small v-if="b.orgName">· {{ b.orgName }}</small><br><small>{{ riyadh(b.startsAt) }}</small></RouterLink>
              <span class="ws-pill" :style="{ '--c': b.status === 'confirmed' ? '#067647' : '#c2410c' }">{{ b.status === 'confirmed' ? 'مؤكد' : 'بانتظار التأكيد' }}</span>
            </li>
          </ul>
        </section>
        <section class="card ws-panel">
          <h2>مصادر الطلبات (آخر ٩٠ يومًا)</h2>
          <div class="rw-bars">
            <div v-for="(s, k) in SOURCES" :key="k" class="rw-bar" :style="{ '--c': s.c }">
              <span>{{ s.l }}</span><i><em :style="{ width: `${(100 * (d.bySource.find((x: Any) => x.source === k)?.n ?? 0)) / maxSource}%` }" /></i>
              <b>{{ d.bySource.find((x: Any) => x.source === k)?.n ?? 0 }}</b>
            </div>
          </div>
        </section>
        <section class="card ws-panel">
          <h2>الطلبات أسبوعيًا</h2>
          <p v-if="!d.weekly.length" class="ws-muted">لا بيانات بعد.</p>
          <div class="rw-bars">
            <div v-for="w in d.weekly" :key="w.week" class="rw-bar"><span>أسبوع {{ w.week }}</span><i><em :style="{ width: `${(100 * w.n) / maxWeek}%` }" /></i><b>{{ w.n }}</b></div>
          </div>
          <h2 style="margin-top: 16px">الأدلة الأكثر تنزيلًا</h2>
          <p v-if="!d.guides.length" class="ws-muted">لم تُنشر أدلة بعد.</p>
          <ul class="rw-list"><li v-for="g in d.guides" :key="g.title"><span>{{ g.title }}</span><b>{{ num(g.downloads) }}</b></li></ul>
        </section>
      </div>
    </template>
  </div>
</template>
