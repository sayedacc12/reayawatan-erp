
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import ExcelImportDialog from '../../../components/ExcelImportDialog.vue';
import { fmtDate, P, WF_STATUS } from '../lib';
import '../../../shared/module.css';
import '../risk.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const router = useRouter();
const rows = ref<any[] | null>(null);
const importing = ref(false);
async function load() { rows.value = await api<any[]>('/risk/analyses'); }
onMounted(load);
</script>

<template>
  <div>
    <section class="pm-hero rk-hero">
      <div><p class="pm-kicker">أدوات التحليل</p><h1>PESTEL وSWOT</h1>
        <p class="pm-sub">PESTEL لفهم البيئة الخارجية بستة عوامل، وSWOT لنقاط القوة والضعف والفرص والتهديدات مع استراتيجيات TOWS. ويُنقل أي تهديد أو ضعف إلى سجل المخاطر بنقرة.</p></div>
      <div v-if="session.can(P.analysis)" class="pm-actions">
        <RouterLink to="/risk/analysis/new?kind=pestel" class="btn rk-glow">تحليل PESTEL</RouterLink>
        <RouterLink to="/risk/analysis/new?kind=swot" class="btn rk-ghost">تحليل SWOT</RouterLink>
        <button v-if="session.can(P.register)" class="btn rk-ghost" @click="importing = true">استيراد من Excel</button>
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
    <ExcelImportDialog v-if="importing" title="استيراد التحليلات والمخاطر من Excel"
      intro="ملف واحد فيه تحليل PESTEL وتحليل SWOT واستراتيجيات TOWS والمخاطر المرتبطة بعواملها. يُفحص أولًا دون حفظ، ثم يُحفظ كله أو لا شيء، ولا يُكرر تحليلًا أو خطرًا موجودًا بالعنوان نفسه."
      template-url="/risk/analyses/import/template" template-name="نموذج استيراد التحليلات والمخاطر.xlsx" upload-url="/risk/analyses/import"
      @close="importing = false" @done="load">
      <template #summary="{ report }">
        <ul class="pm-sub" style="margin: 0">
          <li v-for="a in (report.analyses as any[])" :key="a.kind">{{ a.kind === 'pestel' ? 'PESTEL' : 'SWOT' }}: {{ a.title }} · {{ a.items }} عاملًا<template v-if="a.strategies"> · {{ a.strategies }} استراتيجية</template> · {{ a.status === 'exists' ? 'موجود مسبقًا' : a.code ?? 'جديد' }}</li>
          <li>المخاطر: {{ (report.risks as any[]).filter((r) => r.status === 'new').length }} جديدًا من {{ (report.risks as any[]).length }}</li>
        </ul>
      </template>
    </ExcelImportDialog>
  </div>
</template>
