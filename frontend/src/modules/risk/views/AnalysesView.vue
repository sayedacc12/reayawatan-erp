
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { fmtDate, P, WF_STATUS } from '../lib';
import '../../../shared/module.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const router = useRouter();
const rows = ref<any[] | null>(null);
onMounted(async () => { rows.value = await api<any[]>('/risk/analyses'); });
</script>

<template>
  <div>
    <section class="pm-hero rk-hero">
      <div><p class="pm-kicker">أدوات التحليل</p><h1>PESTEL وSWOT</h1>
        <p class="pm-sub">PESTEL لفهم البيئة الخارجية بستة عوامل، وSWOT لنقاط القوة والضعف والفرص والتهديدات مع استراتيجيات TOWS. ويُنقل أي تهديد أو ضعف إلى سجل المخاطر بنقرة.</p></div>
      <div v-if="session.can(P.analysis)" class="pm-actions">
        <RouterLink to="/risk/analysis/new?kind=pestel" class="btn rk-glow">تحليل PESTEL</RouterLink>
        <RouterLink to="/risk/analysis/new?kind=swot" class="btn rk-ghost">تحليل SWOT</RouterLink>
      </div>
    </section>
    <section class="card">
      <p v-if="rows && !rows.length" class="pm-empty">لا توجد تحليلات بعد</p>
      <div v-else class="table-wrap"><table class="table">
        <thead><tr><th>الرمز</th><th>النوع</th><th>العنوان</th><th>النطاق</th><th>التاريخ</th><th>العوامل</th><th>نُقلت للسجل</th><th>الاعتماد</th></tr></thead>
        <tbody><tr v-for="a in rows" :key="a.id" class="rk-row" @click="router.push(`/risk/analysis/${a.id}`)">
          <td class="rk-code">{{ a.code }}</td><td><span class="pm-tag">{{ a.kind === 'pestel' ? 'PESTEL' : 'SWOT' }}</span></td>
          <td style="white-space: normal"><b>{{ a.title }}</b></td><td>{{ a.scope ?? 'الشركة' }}</td><td>{{ fmtDate(a.analysisDate) }}</td>
          <td>{{ a.items }}</td><td>{{ a.linkedRisks }}</td><td><span class="pm-pill" :style="{ '--c': WF_STATUS[a.status].color }">{{ WF_STATUS[a.status].label }}</span></td>
        </tr></tbody>
      </table></div>
    </section>
  </div>
</template>
