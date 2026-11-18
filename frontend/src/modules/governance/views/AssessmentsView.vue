<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { fmtDate, num, OPINIONS, P, scoreColor, STATUS } from '../lib';
import '../../projects/projects.css';
import '../gov.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const toast = useToast();
const router = useRouter();
const rows = ref<any[] | null>(null);
const y = new Date().getFullYear();
const q = Math.floor(new Date().getMonth() / 3);
const qStart = (i: number) => `${y}-${String(i * 3 + 1).padStart(2, '0')}-01`;
const qEnd = (i: number) => new Date(Date.UTC(y, i * 3 + 3, 0)).toISOString().slice(0, 10);
const form = reactive({
  show: false, title: '', kind: 'self', periodType: 'quarterly', periodFrom: qStart(Math.max(0, q - 1)), periodTo: qEnd(Math.max(0, q - 1)),
  opinion: 'unqualified', qualifiedItems: 0, copyPrevious: true, busy: false,
});
const ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع'];
function open() {
  Object.assign(form, { show: true, title: `التقييم الذاتي للربع ${ORD[Math.max(0, q - 1)]} ${y}` });
}
async function create() {
  form.busy = true;
  try {
    const res = await api<any>('/governance/assessments', { method: 'POST', json: {
      title: form.title, kind: form.kind, periodType: form.periodType, periodFrom: form.periodFrom, periodTo: form.periodTo,
      opinion: form.opinion, qualifiedItems: form.opinion === 'qualified' ? Number(form.qualifiedItems) : 0, copyPrevious: form.copyPrevious,
    } });
    router.push(`/governance/assessments/${res.assessment.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    form.busy = false;
  }
}
onMounted(async () => {
  rows.value = await api('/governance/assessments');
});
</script>

<template>
  <div>
    <section class="pm-hero gv-hero">
      <div>
        <p class="pm-kicker">التقييم الذاتي الدوري</p>
        <h1>قِس الحوكمة كل ربع قبل أن يقيسها المركز</h1>
        <p class="pm-sub">التقييم الذاتي أو التجريبي يعيد بطاقات الدليل نفسها بأسئلتها وشواهدها، ويقترح الإجابات من بيانات الأنظمة، ويتوقع الدرجة عند التقييم الفعلي. والتقييم الرسمي يسجّل نتيجة المركز للمقارنة.</p>
      </div>
      <div class="pm-actions"><button v-if="session.can(P.assess)" class="btn gv-glow" @click="open">تقييم جديد</button></div>
    </section>
    <section class="card pm-panel">
      <p v-if="rows && !rows.length" class="pm-empty">لا توجد تقييمات بعد. ابدأ بتقييم تجريبي لمعرفة وضع الجمعية.</p>
      <table v-else-if="rows" class="table">
        <thead><tr><th>الرمز</th><th>العنوان</th><th>النوع</th><th>الفترة</th><th>الحالة</th><th>الاكتمال</th><th>الدرجة</th><th>المتوقعة</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="gv-row" @click="router.push(`/governance/assessments/${r.id}`)">
            <td class="gv-code">{{ r.code }}</td>
            <td style="white-space: normal">{{ r.title }}</td>
            <td>{{ r.kindLabel }}<div class="pm-muted">{{ r.periodLabel }}</div></td>
            <td>{{ fmtDate(r.periodFrom) }} — {{ fmtDate(r.periodTo) }}</td>
            <td><span class="gv-pill" :style="{ '--c': STATUS[r.status].color }">{{ r.statusLabel }}</span></td>
            <td>{{ r.scores ? `${num(r.scores.coverage)}%` : '—' }}</td>
            <td class="gv-num" :style="{ color: scoreColor(r.scores?.overall) }">{{ r.scores ? `${num(r.scores.overall)}%` : '—' }}<div class="pm-muted">{{ r.scores?.grade }}</div></td>
            <td class="gv-num" :style="{ color: scoreColor(r.scores?.predicted) }">{{ r.scores ? `${num(r.scores.predicted)}%` : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" @submit.prevent="create">
        <h2>تقييم جديد</h2>
        <label class="field"><span>العنوان</span><input v-model="form.title" class="input" required /></label>
        <div class="pm-grid2">
          <label class="field"><span>النوع</span><select v-model="form.kind" class="input"><option value="self">تقييم ذاتي</option><option value="mock">تقييم تجريبي (محاكاة)</option><option value="official">نتيجة التقييم الرسمي</option></select></label>
          <label class="field"><span>الدورية</span><select v-model="form.periodType" class="input"><option value="quarterly">ربعي</option><option value="semiannual">نصف سنوي</option><option value="annual">سنوي</option></select></label>
          <label class="field"><span>من</span><input v-model="form.periodFrom" type="date" class="input" required /></label>
          <label class="field"><span>إلى</span><input v-model="form.periodTo" type="date" class="input" required /></label>
          <label class="field"><span>رأي المحاسب القانوني (آخر قوائم)</span><select v-model="form.opinion" class="input"><option v-for="(l, k) in OPINIONS" :key="k" :value="k">{{ l }}</option></select></label>
          <label v-if="form.opinion === 'qualified'" class="field"><span>عدد بنود التحفظ</span><input v-model.number="form.qualifiedItems" type="number" min="1" max="20" class="input" /></label>
        </div>
        <label v-if="form.kind !== 'official'" style="display: flex; gap: 6px; align-items: center; font-size: .86rem; margin: 6px 0"><input v-model="form.copyPrevious" type="checkbox" /> انسخ إجابات آخر تقييم معتمد ثم حدّث ما تغير</label>
        <p class="gv-note">تُستخرج أرقام الأداء المالي آلياً من القيود المرحّلة في النظام المالي للفترة المحددة، ويُقدّر أداء السنة كاملة منها.</p>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="form.busy">إنشاء</button><button type="button" class="btn" @click="form.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
