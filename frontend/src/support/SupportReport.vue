<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { CATEGORY, PRIORITY, hoursLabel, type TicketSummary } from './support';

/** تقرير الدعم الفني: الالتزام بمستويات الخدمة لكل مستوى */
interface Report {
  totals: { total: number; open: number; breached: number; atRisk: number; needsEscalation: number; avgRating: number | null };
  byPriority: { priority: string; name: string; total: number; open: number; responseCompliance: number | null; resolutionCompliance: number | null; avgResolutionHours: number | null }[];
  byCategory: { category: string; total: number }[];
  byOrganization: { name: string; total: number; open: number }[];
  attention: TicketSummary[];
}
const r = ref<Report | null>(null);
const error = ref('');
onMounted(async () => {
  try { r.value = await api<Report>('/platform/support/report'); } catch (e) { error.value = (e as Error).message; }
});
const pct = (n: number | null) => (n === null ? '—' : `${n}%`);
const tone = (n: number | null) => (n === null ? 'muted' : n >= 90 ? 'ok' : n >= 70 ? 'warn' : 'bad');
const max = (xs: { total: number }[]) => Math.max(1, ...xs.map((x) => x.total));
</script>

<template>
  <div class="support-report">
    <h2 class="title">🛠️ تقارير الدعم الفني ومستويات الخدمة</h2>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="r">
      <div class="nums">
        <div><b>{{ r.totals.total }}</b><span>إجمالي الطلبات</span></div>
        <div><b>{{ r.totals.open }}</b><span>مفتوحة</span></div>
        <div class="bad"><b>{{ r.totals.breached }}</b><span>تجاوزت المهلة</span></div>
        <div class="warn"><b>{{ r.totals.atRisk }}</b><span>قاربت على الانتهاء</span></div>
        <div class="warn"><b>{{ r.totals.needsEscalation }}</b><span>تحتاج تصعيدًا</span></div>
        <div class="gold"><b>{{ r.totals.avgRating ?? '—' }}</b><span>متوسط تقييم الجمعيات من 5</span></div>
      </div>

      <section class="card p-panel">
        <h2>الالتزام بالمهل حسب المستوى</h2>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>المستوى</th><th>الطلبات</th><th>المفتوحة</th><th>الالتزام بمهلة الرد</th><th>الالتزام بمهلة الحل</th><th>متوسط زمن الحل</th></tr></thead>
            <tbody>
              <tr v-for="p in r.byPriority" :key="p.priority">
                <td><b :style="{ color: PRIORITY[p.priority].color }">{{ p.name }}</b></td>
                <td>{{ p.total }}</td><td>{{ p.open }}</td>
                <td><span :class="['tone', `tone-${tone(p.responseCompliance)}`]">{{ pct(p.responseCompliance) }}</span></td>
                <td><span :class="['tone', `tone-${tone(p.resolutionCompliance)}`]">{{ pct(p.resolutionCompliance) }}</span></td>
                <td>{{ p.avgResolutionHours === null ? '—' : hoursLabel(p.avgResolutionHours) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="p-grid">
        <section class="card p-panel">
          <h2>حسب نوع الطلب</h2>
          <div v-for="c in r.byCategory" :key="c.category" class="hb">
            <span>{{ CATEGORY[c.category] }}</span>
            <div class="tr"><div class="fl" :style="{ width: (c.total / max(r.byCategory)) * 100 + '%' }" /></div><b>{{ c.total }}</b>
          </div>
        </section>
        <section class="card p-panel">
          <h2>أكثر الجمعيات طلبًا</h2>
          <div v-for="o in r.byOrganization" :key="o.name" class="hb">
            <span>{{ o.name }}</span>
            <div class="tr"><div class="fl" :style="{ width: (o.total / max(r.byOrganization)) * 100 + '%' }" /></div><b>{{ o.total }}</b>
          </div>
          <p v-if="!r.byOrganization.length" class="muted">لا توجد طلبات بعد.</p>
        </section>
        <section class="card p-panel">
          <h2>تحتاج انتباهًا الآن</h2>
          <RouterLink v-for="t in r.attention" :key="t.id" :to="`/platform/support/${t.id}`" class="att">
            <i :style="{ background: PRIORITY[t.priority].color }" />
            <span class="grow">{{ t.subject }}<small class="muted"> · {{ t.organization?.name }}</small></span>
            <span v-if="t.sla.needsEscalation" class="tone tone-bad">تصعيد</span>
          </RouterLink>
          <p v-if="!r.attention.length" class="muted">لا توجد طلبات متأخرة. 👏</p>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.title { font-size: 1.1rem; margin: 26px 0 12px; }
.nums { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
@media (max-width: 900px) { .nums { grid-template-columns: repeat(2, 1fr); } }
.nums div { --k: var(--primary); background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; }
.nums b { font-size: 1.5rem; color: var(--k); }
.nums span { color: var(--muted); font-size: .82rem; }
.nums .bad { --k: #b91c1c; } .nums .warn { --k: #ea580c; } .nums .gold { --k: #d69e2e; }
.hb { display: grid; grid-template-columns: 140px 1fr 30px; gap: 10px; align-items: center; margin-bottom: 8px; font-size: .9rem; }
.hb span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tr { height: 10px; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
.fl { height: 100%; background: var(--grad); border-radius: 999px; }
.att { display: flex; align-items: center; gap: 8px; padding: 7px 6px; border-radius: 8px; color: var(--text); }
.att:hover { background: var(--surface-2); }
.att i { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.grow { flex: 1; }
</style>
