<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { fmtDate, hijri, sar, todayStr } from '../lib';
import type { SepDetail } from '../separation';
import '../self/ess.css';

/** نموذج إخلاء الطرف وبيان المستحقات للطباعة أو الحفظ PDF */
const props = defineProps<{ id: string }>();
const s = ref<SepDetail | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    s.value = await api<SepDetail>(`/hr/separations/${props.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const st = computed(() => s.value?.settlement ?? s.value?.preview ?? null);
/** اعتمادات الدورة الأخيرة فقط (بعد آخر إعداد أو إرجاع للبيان) */
const approvals = computed(() => {
  const h = s.value?.history ?? [];
  let from = 0;
  h.forEach((x, i) => { if (x.action === 'settle' || x.action === 'return') from = i + 1; });
  return h.slice(from).filter((x) => x.action === 'approve');
});
const approvalOf = (name: string, i: number) => approvals.value.find((a) => a.stageName === name) ?? approvals.value[i];
const print = () => window.print();
const MARK: Record<string, string> = { cleared: '✔', blocked: '✖', pending: '…' };
</script>

<template>
  <div>
    <div class="ess-actions no-print" style="margin-bottom: 14px">
      <RouterLink :to="`/hr/separations/${id}`" class="btn btn-sm">→ العودة للملف</RouterLink>
      <button v-if="s" class="btn btn-sm btn-primary" @click="print">🖨️ طباعة أو حفظ PDF</button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <article v-else-if="s" class="ess-letter sep-print">
      <header>
        <div>
          <h2>{{ s.organizationName }}</h2>
          <p style="margin: 4px 0 0; color: #475569">نموذج إخلاء طرف وبيان مستحقات نهاية الخدمة</p>
        </div>
        <div class="meta">
          <div>رقم الملف: <b>{{ s.separationNo }}</b></div>
          <div>تاريخ الطباعة: {{ fmtDate(todayStr()) }}</div>
          <div>الموافق: {{ hijri(todayStr()) }}</div>
        </div>
      </header>

      <h3>أولًا: بيانات الموظف</h3>
      <table class="sp-grid">
        <tr><th>الاسم</th><td>{{ s.employee.fullName }}</td><th>الرقم الوظيفي</th><td>{{ s.employee.employeeNo }}</td></tr>
        <tr><th>الوظيفة</th><td>{{ s.employee.jobTitle }}</td><th>الوحدة</th><td>{{ s.employee.unitName }}</td></tr>
        <tr><th>رقم الهوية</th><td>{{ s.employee.nationalId ?? '—' }}</td><th>تاريخ التعيين</th><td>{{ fmtDate(s.employee.hireDate) }}</td></tr>
        <tr><th>سبب انتهاء الخدمة</th><td>{{ s.reasonLabel }}</td><th>آخر يوم عمل</th><td>{{ fmtDate(s.lastWorkingDay) }}</td></tr>
      </table>

      <h3>ثانيًا: إخلاء الطرف</h3>
      <table class="sp-table">
        <thead><tr><th>#</th><th>البند</th><th>المسؤول</th><th>الحالة</th><th>الخصم</th><th>الملاحظة</th><th>بواسطة والتاريخ</th></tr></thead>
        <tbody>
          <tr v-for="(it, i) in s.items" :key="it.code">
            <td>{{ i + 1 }}</td>
            <td>{{ it.name }}</td>
            <td>{{ it.approverName ?? it.roleName ?? it.kindLabel }}</td>
            <td :class="`sp-${it.status}`">{{ MARK[it.status] }} {{ it.statusLabel }}</td>
            <td>{{ it.deduction ? sar(it.deduction) : '—' }}</td>
            <td>{{ it.note ?? '' }}</td>
            <td><template v-if="it.actorName">{{ it.actorName }}<template v-if="it.onBehalf"> (نيابة)</template><br /><small>{{ it.at ? fmtDate(it.at) : '' }}</small></template></td>
          </tr>
        </tbody>
      </table>
      <p class="sp-note">أُخلي طرف الموظف من {{ s.items.filter((i) => i.status === 'cleared').length }} بندًا من {{ s.items.length }}.</p>

      <template v-if="st">
        <h3>ثالثًا: بيان المستحقات <small v-if="!s.settlement">(معاينة غير معتمدة)</small></h3>
        <table class="sp-table">
          <tbody>
            <tr><td>مكافأة نهاية الخدمة ({{ st.eos.years }} سنة و{{ st.eos.months }} شهر و{{ st.eos.days }} يوم)</td><td class="n">{{ sar(st.eos.amount) }}</td></tr>
            <tr v-if="st.leaveEncashment"><td>بدل رصيد الإجازة ({{ st.leaveDays }} يوم × {{ sar(st.dailyWage) }})</td><td class="n">{{ sar(st.leaveEncashment) }}</td></tr>
            <tr v-for="(a, i) in st.adjustments.filter((x) => x.kind === 'addition')" :key="`a${i}`"><td>{{ a.label }}</td><td class="n">{{ sar(a.amount) }}</td></tr>
            <tr class="sum"><td>إجمالي المستحقات</td><td class="n">{{ sar(st.gross) }}</td></tr>
            <tr v-if="st.advancesTotal"><td>يُخصم: السلف المتبقية</td><td class="n">({{ sar(st.advancesTotal) }})</td></tr>
            <tr v-if="st.clearanceDeductions"><td>يُخصم: خصومات إخلاء الطرف</td><td class="n">({{ sar(st.clearanceDeductions) }})</td></tr>
            <tr v-for="(a, i) in st.adjustments.filter((x) => x.kind === 'deduction')" :key="`d${i}`"><td>يُخصم: {{ a.label }}</td><td class="n">({{ sar(a.amount) }})</td></tr>
            <tr class="net"><td>صافي المستحقات</td><td class="n">{{ sar(st.net) }}</td></tr>
          </tbody>
        </table>
        <p class="sp-note">{{ st.eos.explanation }}</p>
        <p v-if="s.employee.iban" class="sp-note">يُصرف على الحساب: <span dir="ltr">{{ s.employee.iban }}</span></p>
      </template>

      <h3>{{ st ? 'رابعًا' : 'ثالثًا' }}: الاعتمادات</h3>
      <table class="sp-table">
        <thead><tr><th>المرحلة</th><th>الاسم</th><th>التاريخ</th><th>التوقيع</th></tr></thead>
        <tbody>
          <tr><td>إعداد بيان المستحقات</td><td>{{ s.settlement?.computedByName ?? '' }}</td><td>{{ s.settlement ? fmtDate(s.settlement.computedAt) : '' }}</td><td class="sig" /></tr>
          <tr v-for="(stg, i) in s.stages" :key="i">
            <td>{{ stg.name }}</td><td>{{ (stg.done || stg.current) ? approvalOf(stg.name, i)?.actorName ?? '' : '' }}</td><td>{{ stg.done && approvalOf(stg.name, i) ? fmtDate(approvalOf(stg.name, i)!.at) : '' }}</td><td class="sig" />
          </tr>
        </tbody>
      </table>
      <p v-if="s.entry" class="sp-note">القيد المحاسبي رقم {{ s.entry.entryNo }}<template v-if="s.voucher">، وسند الصرف رقم {{ s.voucher.serial }} ({{ s.voucher.statusLabel }})</template>.</p>

      <footer class="sp-foot">
        <div><div>الموظف</div><b>{{ s.employee.fullName }}</b><div>أقر باستلام مستحقاتي كاملة</div><div>التوقيع: ....................</div></div>
        <div><div>شؤون الموظفين</div><b>&nbsp;</b><div>&nbsp;</div><div>التوقيع: ....................</div></div>
      </footer>
      <span class="seal">{{ s.organizationName }}<br />شؤون الموظفين</span>
    </article>
    <div v-else class="ess-skeleton"><i /><i /></div>
  </div>
</template>

<style scoped>
.sep-print h3 { font-size: 1rem; color: #0f766e; margin: 22px 0 8px; }
.sep-print h3 small { color: #b45309; font-weight: 500; }
.sp-grid, .sp-table { width: 100%; border-collapse: collapse; font-size: .9rem; }
.sp-grid th, .sp-grid td, .sp-table th, .sp-table td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: start; vertical-align: top; }
.sp-grid th, .sp-table thead th { background: #f1f5f9; font-weight: 600; width: auto; }
.sp-table .n { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; width: 160px; }
.sp-table .sum td { font-weight: 600; background: #f8fafc; }
.sp-table .net td { font-weight: 700; background: #ecfdf5; color: #065f46; }
.sp-table .sig { width: 150px; }
.sp-cleared { color: #047857; } .sp-blocked { color: #b91c1c; } .sp-pending { color: #64748b; }
.sp-note { font-size: .85rem; color: #475569; margin: 6px 0 0; }
.sp-foot { margin-top: 50px; display: flex; justify-content: space-between; gap: 20px; }
.sp-foot > div { text-align: center; min-width: 220px; line-height: 2; }
@media print { :global(.sidebar) { display: none !important; } }
</style>
