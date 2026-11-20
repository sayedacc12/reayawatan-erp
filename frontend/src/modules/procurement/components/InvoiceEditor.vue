<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed } from 'vue';
import { fmtQty, sar, today } from '../lib';

/**
 * محرر بنود الفاتورة أو الإشعار الدائن على تعميد (مشترك بين الموظف وبوابة المورد):
 * يعرض لكل بند المعمد والمستلم المقبول والمفوتر سابقًا والمتبقي، ويُظهر استثناءات المطابقة قبل الإرسال.
 */
const props = defineProps<{ billable: any; form: any; tolerance?: number }>();

const byLine = computed(() => new Map((props.billable?.lines ?? []).map((l: any) => [l.orderLineId, l])));
const row = (id: string) => props.form.lines.find((x: any) => x.orderLineId === id);
const r2 = (n: number) => Math.round(n * 100) / 100;
const totals = computed(() => {
  const lines = props.form.lines.filter((l: any) => Number(l.qty) > 0);
  const sub = r2(lines.reduce((t: number, l: any) => t + r2(Number(l.qty) * Number(l.unitPrice || 0)), 0) + Number(props.form.extraAmount || 0));
  const rate = props.form.vatRate ?? props.billable?.order.vatRate ?? 15;
  const vat = r2((sub * rate) / 100);
  return { sub, vat, total: r2(sub + vat), rate };
});
/** تنبيه البند: كمية أكبر من المتبقي أو سعر أعلى من التعميد */
const warn = (id: string) => {
  const l: any = byLine.value.get(id);
  const x = row(id);
  if (!l || !x || !(Number(x.qty) > 0)) return '';
  if (props.form.kind === 'credit_note') return Number(x.qty) > l.invoiced + 0.0005 ? 'أكبر من المفوتر' : '';
  const out: string[] = [];
  if (Number(x.qty) > l.left + 0.0005) out.push(`أكبر من المستلم غير المفوتر (${fmtQty(l.left)})`);
  if (Number(x.unitPrice) > r2(l.unitPrice * (1 + (props.tolerance ?? 0) / 100)) + 0.005) out.push(`أعلى من سعر التعميد (${l.unitPrice})`);
  return out.join(' · ');
};
const fillLeft = () => {
  for (const l of props.billable?.lines ?? []) {
    const x = row(l.orderLineId);
    if (x) {
      x.qty = props.form.kind === 'credit_note' ? 0 : l.left;
      if (!x.unitPrice) x.unitPrice = l.unitPrice;
    }
  }
};
defineExpose({ totals });
</script>

<template>
  <div style="display: grid; gap: 14px">
    <section class="card pm-panel">
      <div class="pc-fields">
        <label class="field"><span>نوع المستند</span>
          <select v-model="form.kind" class="input" :disabled="!!form.id"><option value="invoice">فاتورة ضريبية</option><option value="credit_note" :disabled="!billable?.invoices?.length">إشعار دائن (خصم أو مرتجع)</option></select>
        </label>
        <label v-if="form.kind === 'credit_note'" class="field"><span>الفاتورة الأصلية</span>
          <select v-model="form.refInvoiceId" class="input" required><option value="">اختر…</option><option v-for="i in billable?.invoices ?? []" :key="i.id" :value="i.id">{{ i.code }} · رقم المورد {{ i.supplierInvoiceNo }} · المتبقي {{ sar(i.outstanding) }}</option></select>
        </label>
        <label class="field"><span>{{ form.kind === 'credit_note' ? 'رقم الإشعار لدى المورد' : 'رقم الفاتورة لدى المورد' }}</span><input v-model="form.supplierInvoiceNo" class="input" maxlength="60" required /></label>
        <label class="field"><span>التاريخ</span><input v-model="form.invoiceDate" type="date" class="input" :max="today()" required /></label>
        <label class="field"><span>تاريخ الاستحقاق (اختياري)</span><input v-model="form.dueDate" type="date" class="input" :min="form.invoiceDate" /></label>
        <label class="field"><span>نسبة الضريبة %</span><input v-model.number="form.vatRate" type="number" min="0" max="100" step="any" class="input" /></label>
      </div>
    </section>

    <section class="card pm-panel">
      <div class="pc-inline" style="justify-content: space-between; margin-bottom: 8px">
        <h2 style="margin: 0">البنود</h2>
        <button v-if="form.kind === 'invoice'" type="button" class="btn btn-ghost" @click="fillLeft">تعبئة المستلم غير المفوتر</button>
      </div>
      <div class="table-wrap">
        <table class="pc-lines">
          <thead><tr><th>البند</th><th>المعمد</th><th>المستلم المقبول</th><th>المفوتر سابقًا</th><th>سعر التعميد</th><th style="width: 110px">{{ form.kind === 'credit_note' ? 'الكمية المخصومة' : 'الكمية المفوترة' }}</th><th style="width: 120px">سعر الوحدة</th><th>المبلغ</th></tr></thead>
          <tbody>
            <tr v-for="l in billable?.lines ?? []" :key="l.orderLineId">
              <td><b>{{ l.description }}</b><small v-if="warn(l.orderLineId)" class="pc-warn" style="display: flex">{{ warn(l.orderLineId) }}</small></td>
              <td class="pc-num">{{ fmtQty(l.ordered) }}</td>
              <td class="pc-num">{{ fmtQty(l.received) }}</td>
              <td class="pc-num">{{ fmtQty(l.invoiced) }}</td>
              <td class="pc-num">{{ l.unitPrice }}</td>
              <td><input v-model.number="row(l.orderLineId).qty" type="number" min="0" step="any" class="input" /></td>
              <td><input v-model.number="row(l.orderLineId).unitPrice" type="number" min="0" step="any" class="input" /></td>
              <td class="pc-num">{{ sar(r2(Number(row(l.orderLineId).qty || 0) * Number(row(l.orderLineId).unitPrice || 0))) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pc-fields" style="margin-top: 10px">
        <label class="field"><span>مصاريف نقل وتخليص مفوترة (قبل الضريبة)</span><input v-model.number="form.extraAmount" type="number" min="0" step="any" class="input" />
          <small v-if="form.kind === 'invoice' && billable" class="pm-muted">غير المفوتر من مصاريف الاستلام: {{ sar(billable.extraLeft) }}</small>
        </label>
        <dl class="pc-dl" style="grid-template-columns: repeat(3, minmax(0, 1fr))">
          <div><dt>قبل الضريبة</dt><dd>{{ sar(totals.sub) }}</dd></div>
          <div><dt>الضريبة {{ totals.rate }}%</dt><dd>{{ sar(totals.vat) }}</dd></div>
          <div><dt>الإجمالي</dt><dd><b>{{ sar(totals.total) }}</b></dd></div>
        </dl>
      </div>
      <label class="field" style="margin-top: 10px"><span>ملاحظات</span><textarea v-model="form.notes" class="input" rows="2" maxlength="2000" /></label>
    </section>
  </div>
</template>
