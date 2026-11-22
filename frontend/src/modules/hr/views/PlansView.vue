<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import CountUp from '../../../shared/CountUp.vue';
import { FUNDING, MONTHS, P, STATUS_COLOR, sar, thisYear, type JobRow } from '../lib';
import '../../../shared/module.css';
import '../hr.css';

interface Item {
  id: string; jobId: string; jobTitle: string; jobCode: string; unitName: string; gradeName: string | null; count: number; plannedMonth: number; fundingSource: string; fundingLabel: string;
  fundingNote: string | null; forSaudi: boolean; justification: string | null; status: string; statusLabel: string; decisionNote: string | null; decidedByName: string | null;
  monthlyCost: { gross: number; gosiEmployer: number; eosProvision: number; total: number }; yearCost: number; annualCost: number; filled: number;
}
const session = useSession();
const toast = useToast();
const year = ref(thisYear());
const data = ref<{ items: Item[]; totals: Record<string, number> } | null>(null);
const jobs = ref<JobRow[]>([]);
const error = ref('');
async function load() {
  try {
    data.value = await api(`/hr/plans?year=${year.value}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await load();
  jobs.value = await api<JobRow[]>('/hr/jobs').catch(() => []);
});
watch(year, load);
const editing = ref<Item | null>(null);
const form = reactive({ show: false, jobId: '', count: 1, plannedMonth: 1, fundingSource: 'own', fundingNote: '', forSaudi: true, justification: '' });
function openNew() {
  editing.value = null;
  Object.assign(form, { show: true, jobId: '', count: 1, plannedMonth: Math.min(12, new Date().getMonth() + 2), fundingSource: 'own', fundingNote: '', forSaudi: true, justification: '' });
}
function openEdit(i: Item) {
  editing.value = i;
  Object.assign(form, { show: true, jobId: i.jobId, count: i.count, plannedMonth: i.plannedMonth, fundingSource: i.fundingSource, fundingNote: i.fundingNote ?? '', forSaudi: i.forSaudi, justification: i.justification ?? '' });
}
async function save() {
  try {
    const body = { year: year.value, jobId: form.jobId, count: Number(form.count), plannedMonth: form.plannedMonth, fundingSource: form.fundingSource, fundingNote: form.fundingNote || null, forSaudi: form.forSaudi, justification: form.justification || null };
    if (editing.value) await api(`/hr/plans/${editing.value.id}`, { method: 'PATCH', json: body });
    else await api('/hr/plans', { method: 'POST', json: body });
    form.show = false;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function act(i: Item, action: 'submit' | 'approve' | 'reject' | 'delete') {
  try {
    if (action === 'submit') await api(`/hr/plans/${i.id}/submit`, { method: 'POST' });
    else if (action === 'delete') { if (!confirm('حذف البند؟')) return; await api(`/hr/plans/${i.id}`, { method: 'DELETE' }); }
    else {
      const note = action === 'reject' ? prompt('سبب الرفض') : null;
      if (action === 'reject' && !note) return;
      await api(`/hr/plans/${i.id}/decision`, { method: 'POST', json: { decision: action, note } });
    }
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <section class="pm-hero hr-hero">
      <div><p class="pm-kicker">التنظيم والتخطيط</p><h1>خطط التعيين {{ year }}</h1>
        <p class="pm-sub">لكل وظيفة: العدد وشهر التعيين ومصدر التمويل، والتكلفة تُحسب تلقائيًا من سلم الرواتب مع التأمينات ومخصص نهاية الخدمة، فتدخل ميزانية المشروع أو المنحة بتكلفتها الحقيقية.</p></div>
      <div class="pm-actions">
        <select v-model.number="year" class="input" style="width: auto"><option v-for="y in [thisYear() - 1, thisYear(), thisYear() + 1]" :key="y" :value="y">{{ y }}</option></select>
        <button v-if="session.can(P.plans)" class="btn hr-glow" @click="openNew">بند جديد</button>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="data">
      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #a78bfa; --i: 0"><span>تعيينات معتمدة</span><strong><CountUp :value="data.totals.positions" /></strong><small>منها {{ data.totals.saudi }} سعودي</small></div>
        <div class="pm-kpi" style="--a: #2f7a57; --i: 1"><span>تم شغلها</span><strong><CountUp :value="data.totals.filled" /></strong><small>من التعيينات المعتمدة</small></div>
        <div class="pm-kpi" style="--a: #f472b6; --i: 2"><span>تكلفة السنة الحالية</span><strong><CountUp :value="data.totals.yearCost" /></strong><small>من شهر التعيين حتى نهاية السنة</small></div>
        <div class="pm-kpi" style="--a: #f59e0b; --i: 3"><span>التكلفة السنوية الكاملة</span><strong><CountUp :value="data.totals.annualCost" /></strong><small>{{ data.totals.pending }} بند بانتظار الاعتماد</small></div>
      </div>
      <section class="card pm-panel">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>الوظيفة</th><th>العدد</th><th>الشهر</th><th>التمويل</th><th>التكلفة الشهرية للفرد</th><th>تكلفة السنة</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              <tr v-for="i in data.items" :key="i.id">
                <td><b>{{ i.jobTitle }}</b><span class="pm-muted">{{ i.unitName }} · {{ i.gradeName ?? 'بدون مرتبة' }} · {{ i.forSaudi ? 'سعودي' : 'غير سعودي' }}</span><span v-if="i.justification" class="pm-muted">{{ i.justification }}</span></td>
                <td class="hr-num">{{ i.count }}<span v-if="i.status === 'approved'" class="pm-muted">شُغل {{ i.filled }}</span></td>
                <td>{{ MONTHS[i.plannedMonth - 1] }}</td>
                <td>{{ i.fundingLabel }}<span v-if="i.fundingNote" class="pm-muted">{{ i.fundingNote }}</span></td>
                <td class="hr-num" :title="`راتب ${sar(i.monthlyCost.gross)} + تأمينات ${sar(i.monthlyCost.gosiEmployer)} + نهاية خدمة ${sar(i.monthlyCost.eosProvision)}`">{{ sar(i.monthlyCost.total) }}<span class="pm-muted">راتب {{ sar(i.monthlyCost.gross) }}</span></td>
                <td class="pm-money">{{ sar(i.yearCost) }}</td>
                <td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[i.status] }">{{ i.statusLabel }}</span><span v-if="i.decisionNote" class="pm-muted">{{ i.decisionNote }}</span></td>
                <td style="white-space: nowrap">
                  <template v-if="session.can(P.plans) && (i.status === 'draft' || i.status === 'rejected')">
                    <button class="btn btn-sm btn-primary" @click="act(i, 'submit')">إرسال للاعتماد</button>
                    <button class="btn btn-sm" @click="openEdit(i)">تعديل</button>
                    <button class="btn btn-sm" @click="act(i, 'delete')">حذف</button>
                  </template>
                  <template v-if="session.can(P.approvePlans) && i.status === 'submitted'">
                    <button class="btn btn-sm btn-primary" @click="act(i, 'approve')">اعتماد</button>
                    <button class="btn btn-sm" @click="act(i, 'reject')">رفض</button>
                  </template>
                </td>
              </tr>
              <tr v-if="!data.items.length"><td colspan="8" class="pm-empty">لا توجد بنود في خطة هذه السنة</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" @submit.prevent="save">
        <h2>{{ editing ? 'تعديل بند' : 'بند جديد في خطة التعيين' }}</h2>
        <label class="field"><span>الوظيفة</span>
          <select v-model="form.jobId" class="input" required><option value="" disabled>اختر</option><option v-for="j in jobs" :key="j.id" :value="j.id">{{ j.title }} · {{ j.unitName }}{{ j.status === 'draft' ? ' (وصف غير معتمد)' : '' }}</option></select>
        </label>
        <div class="pm-grid2">
          <label class="field"><span>العدد</span><input v-model.number="form.count" type="number" min="1" class="input" /></label>
          <label class="field"><span>شهر التعيين المتوقع</span><select v-model.number="form.plannedMonth" class="input"><option v-for="(m, i) in MONTHS" :key="i" :value="i + 1">{{ m }}</option></select></label>
          <label class="field"><span>مصدر التمويل</span><select v-model="form.fundingSource" class="input"><option v-for="f in FUNDING" :key="f.value" :value="f.value">{{ f.label }}</option></select></label>
          <label class="field"><span>الجنسية</span><select v-model="form.forSaudi" class="input"><option :value="true">سعودي</option><option :value="false">غير سعودي</option></select></label>
        </div>
        <label class="field"><span>تفاصيل التمويل (اسم المشروع أو المنحة)</span><input v-model="form.fundingNote" class="input" /></label>
        <label class="field"><span>المبرر</span><textarea v-model="form.justification" class="input" rows="2" /></label>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="form.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
