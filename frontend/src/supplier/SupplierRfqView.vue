<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { fmtDateTime, fmtSize, sar } from '../modules/procurement/lib';
import { openSupplierFile, supplierApi, supplierUpload } from './supplier';

const route = useRoute();
const id = computed(() => route.params.id as string);
const q = ref<any>(null);
const busy = ref(false);
const error = ref('');
const ok = ref('');
const question = ref('');
const form = ref<any>({ lines: [], vatRate: 15, deliveryDays: null, validityDays: 30, technicalNote: '' });

function fill(v: any) {
  q.value = v;
  const mine = new Map<string, any>((v.quote?.lines ?? []).map((l: any) => [l.lineId, l]));
  form.value = {
    vatRate: v.quote?.vatRate ?? 15, deliveryDays: v.quote?.deliveryDays ?? null, validityDays: v.quote?.validityDays ?? 30, technicalNote: v.quote?.technicalNote ?? '',
    lines: v.lines.map((l: any) => ({ ...l, unitPrice: mine.get(l.id)?.unitPrice ?? null, note: mine.get(l.id)?.note ?? '' })),
  };
}
onMounted(async () => {
  try {
    fill(await supplierApi(`/rfqs/${id.value}`));
  } catch (e) {
    error.value = (e as Error).message;
  }
});
async function act(fn: () => Promise<any>, msg: string) {
  busy.value = true;
  error.value = '';
  ok.value = '';
  try {
    fill(await fn());
    ok.value = msg;
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    return false;
  } finally {
    busy.value = false;
  }
}
const subtotal = computed(() => form.value.lines.reduce((s: number, l: any) => s + (Number(l.unitPrice) || 0) * l.qty, 0));
const vat = computed(() => Math.round(subtotal.value * Number(form.value.vatRate)) / 100);
function save(submit: boolean) {
  const f = form.value;
  if (submit && !confirm('إرسال العرض نهائيًا؟ يمكنكم تعديله وإعادة إرساله حتى موعد الإغلاق.')) return;
  return act(() => supplierApi(`/rfqs/${id.value}/quote`, {
    method: 'PUT',
    json: {
      submit, vatRate: Number(f.vatRate), deliveryDays: f.deliveryDays === null || f.deliveryDays === '' ? null : Number(f.deliveryDays),
      validityDays: f.validityDays ? Number(f.validityDays) : null, technicalNote: f.technicalNote || null,
      lines: f.lines.filter((l: any) => l.unitPrice !== null && l.unitPrice !== '').map((l: any) => ({ lineId: l.id, unitPrice: Number(l.unitPrice), note: l.note || null })),
    },
  }), submit ? 'أُرسل عرضكم ✓ ويبقى مختومًا حتى موعد الفتح' : 'حُفظ العرض مسودة');
}
const withdraw = () => confirm('سحب العرض المقدم؟') && act(() => supplierApi(`/rfqs/${id.value}/withdraw`, { method: 'POST' }), 'سُحب العرض');
async function ask() {
  if (await act(() => supplierApi(`/rfqs/${id.value}/questions`, { method: 'POST', json: { question: question.value } }), 'أُرسل الاستفسار، ويصلكم الرد هنا')) question.value = '';
}
function addFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (f) act(() => supplierUpload(`/rfqs/${id.value}/files`, f, {}), 'أُرفق الملف بالعرض');
}
const removeFile = (k: string) => act(() => supplierApi(`/rfqs/${id.value}/files/${k}`, { method: 'DELETE' }), 'حُذف المرفق');
const open = (k: string) => openSupplierFile(`/rfqs/${id.value}/files/${k}`).catch((e) => (error.value = e.message));
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="ok" class="alert alert-success">{{ ok }}</div>
    <template v-if="q">
      <div class="page-head">
        <div><h1>{{ q.title }}</h1><p class="muted"><span class="pc-code">{{ q.code }}</span> · {{ q.methodLabel }} · آخر موعد للعروض {{ fmtDateTime(q.closesAt) }}<span v-if="q.questionsUntil"> · للاستفسارات {{ fmtDateTime(q.questionsUntil) }}</span></p></div>
        <span v-if="q.result" :class="q.result.won ? 'pc-okflag' : 'pc-flag'" style="font-size: .9rem">{{ q.result.label }}{{ q.result.winner ? ` (الفائز: ${q.result.winner})` : '' }}</span>
        <span v-else :class="q.open ? 'pc-okflag' : 'pc-warn'" style="font-size: .9rem">{{ q.open ? 'مفتوحة للعروض' : q.statusLabel }}</span>
      </div>

      <div class="pc-grid" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)">
        <div style="display: grid; gap: 16px; align-content: start">
          <section class="card pm-panel">
            <h2>عرض الأسعار <small v-if="q.quote" class="pc-chip">{{ q.quote.statusLabel }}</small></h2>
            <div class="table-wrap">
              <table class="pc-lines">
                <thead><tr><th>البند</th><th style="width: 90px">الكمية</th><th style="width: 130px">سعر الوحدة (قبل الضريبة)</th><th style="width: 110px">الإجمالي</th></tr></thead>
                <tbody>
                  <tr v-for="l in form.lines" :key="l.id">
                    <td><b>{{ l.description }}</b><div v-if="l.specs" class="pm-muted" style="font-size: .8rem">{{ l.specs }}</div>
                      <input v-if="q.canQuote" v-model="l.note" class="input" placeholder="ملاحظة (العلامة، المنشأ...)" style="margin-top: 4px; font-size: .82rem" /><small v-else-if="l.note" class="pm-muted">{{ l.note }}</small></td>
                    <td class="pc-num">{{ l.qty }} {{ l.uomName ?? '' }}</td>
                    <td><input v-if="q.canQuote" v-model.number="l.unitPrice" type="number" min="0" step="any" class="input" /><span v-else class="pc-num">{{ l.unitPrice === null ? '—' : sar(l.unitPrice) }}</span></td>
                    <td class="pc-num">{{ sar((Number(l.unitPrice) || 0) * l.qty) }}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr><td colspan="3">قبل الضريبة</td><td class="pc-num">{{ sar(subtotal) }}</td></tr>
                  <tr><td colspan="3">ضريبة القيمة المضافة {{ form.vatRate }}%</td><td class="pc-num">{{ sar(vat) }}</td></tr>
                  <tr><td colspan="3"><b>الإجمالي</b></td><td class="pc-num"><b>{{ sar(subtotal + vat) }}</b></td></tr>
                </tfoot>
              </table>
            </div>
            <div class="pc-fields" style="margin-top: 10px">
              <label class="field"><span>الضريبة</span><select v-model.number="form.vatRate" class="input" :disabled="!q.canQuote"><option :value="15">15%</option><option :value="0">0% (غير مسجلين)</option></select></label>
              <label class="field"><span>مدة التوريد (يوم)</span><input v-model.number="form.deliveryDays" type="number" min="0" class="input" :disabled="!q.canQuote" /></label>
              <label class="field"><span>سريان العرض (يوم) *</span><input v-model.number="form.validityDays" type="number" min="1" class="input" :disabled="!q.canQuote" /></label>
              <label class="field" style="grid-column: 1 / -1"><span>العرض الفني والملاحظات</span><textarea v-model="form.technicalNote" class="input" rows="3" :disabled="!q.canQuote" /></label>
            </div>
            <div v-if="q.quote?.revisions?.length" class="pm-muted" style="font-size: .82rem; margin-top: 6px">
              <div v-for="r in q.quote.revisions" :key="r.round">جولة تفاوض {{ r.round }}: الإجمالي بعد التعديل {{ sar(r.after) }} · {{ fmtDateTime(r.at) }}</div>
            </div>
            <div v-if="q.canQuote" class="pc-inline" style="margin-top: 12px">
              <button class="btn btn-primary" :disabled="busy" @click="save(true)">{{ q.quote?.status === 'submitted' ? 'تحديث العرض المرسل' : 'إرسال العرض' }}</button>
              <button v-if="q.quote?.status !== 'submitted'" class="btn" :disabled="busy" @click="save(false)">حفظ مسودة</button>
              <button v-if="q.quote?.status === 'submitted'" class="btn btn-ghost" :disabled="busy" @click="withdraw">سحب العرض</button>
            </div>
            <p v-else-if="q.open" class="pm-muted" style="font-size: .82rem">تقديم العروض لمدير الحساب ومستخدم المبيعات.</p>
          </section>

          <section class="card pm-panel">
            <h2>مرفقات العرض</h2>
            <ul class="pc-log" style="gap: 4px">
              <li v-for="f in q.quote?.attachments ?? []" :key="f.key"><span><a class="pm-link" href="#" @click.prevent="open(f.key)">{{ f.name }}</a> <small class="pm-muted">{{ fmtSize(f.size) }}</small>
                <button v-if="q.canQuote" class="btn btn-ghost" style="padding: 0 6px" @click="removeFile(f.key)">✕</button></span></li>
              <li v-if="!q.quote?.attachments?.length" class="pm-muted">لا توجد مرفقات</li>
            </ul>
            <label v-if="q.canQuote" class="btn" style="margin-top: 8px">+ إرفاق ملف (العرض الفني، الكتالوج...)<input type="file" hidden @change="addFile" /></label>
          </section>
        </div>

        <div style="display: grid; gap: 16px; align-content: start">
          <section class="card pm-panel">
            <h2>الكراسة</h2>
            <p v-if="q.scope" style="white-space: pre-line; font-size: .9rem">{{ q.scope }}</p>
            <h3 v-if="q.terms" style="font-size: .9rem; margin: 10px 0 4px">الشروط</h3>
            <p v-if="q.terms" style="white-space: pre-line; font-size: .88rem">{{ q.terms }}</p>
            <h3 style="font-size: .9rem; margin: 10px 0 4px">معايير التقييم</h3>
            <ul class="pc-log" style="gap: 2px"><li v-for="c in q.criteria" :key="c.name"><span>{{ c.name }} <b>{{ c.weight }}%</b></span></li></ul>
            <h3 v-if="q.attachments.length" style="font-size: .9rem; margin: 10px 0 4px">مستندات المنافسة</h3>
            <ul class="pc-log" style="gap: 2px"><li v-for="f in q.attachments" :key="f.key"><a class="pm-link" href="#" @click.prevent="open(f.key)">{{ f.name }}</a></li></ul>
          </section>
          <section class="card pm-panel">
            <h2>الاستفسارات</h2>
            <ul class="pc-log">
              <li v-for="x in q.questions" :key="x.id"><span><b>{{ x.question }}</b><small v-if="x.mine" class="pm-muted"> (استفساركم)</small>
                <div v-if="x.answer" style="font-size: .85rem; color: #047857">الجواب: {{ x.answer }}</div><div v-else class="pm-muted" style="font-size: .8rem">بانتظار الرد</div></span></li>
              <li v-if="!q.questions.length" class="pm-muted">لا توجد استفسارات</li>
            </ul>
            <form v-if="q.canAsk" style="margin-top: 8px; display: grid; gap: 6px" @submit.prevent="ask">
              <textarea v-model="question" class="input" rows="2" placeholder="اكتب استفساركم" required minlength="5" />
              <button class="btn" :disabled="busy">إرسال الاستفسار</button>
            </form>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>
