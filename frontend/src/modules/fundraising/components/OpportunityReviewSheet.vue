<script setup lang="ts">
/**
 * عرض الفرصة كاملة في صفحة واحدة قبل اتخاذ قرار الاعتماد:
 * الداعم، البيانات المالية، التوزيع على البنود، الاشتراطات، المستندات، ومسار الاعتماد،
 * ثم شريط القرار (موافقة، طلب تعديل، رفض) أسفل الصفحة. وتصلح للطباعة.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { api, openProtectedFile } from '../../../api';
import BrandMark from '../../../components/BrandMark.vue';
import { useToast } from '../../../stores/toast';
import { color, fmtDate, fmtDateTime, fmtNo, hijri, label, sar, tafqeet } from '../labels';
import type { Opportunity } from '../types';

const props = defineProps<{ opp: Opportunity }>();
const emit = defineEmits<{ close: []; decided: [Opportunity] }>();
const toast = useToast();
const o = computed(() => props.opp);
const stage = computed(() => o.value.stages.find((s) => s.id === o.value.currentStageId) ?? null);
const d = reactive({ mode: null as null | 'approve' | 'return' | 'reject', notes: '' });
const busy = ref(false);
const read = ref(false);
const body = ref<HTMLElement | null>(null);

const allocated = computed(() => o.value.batches.filter((b) => !b.parentBatchId && b.status !== 'cancelled').reduce((s, b) => s + b.amount, 0));
const cats = (c: string[]) => (c.length ? c.map((x) => label('category', x)).join('، ') : 'كل الفئات');
const openDoc = (id: string) => openProtectedFile(`/fundraising/opportunities/${o.value.id}/documents/${id}`).catch((e) => toast.error((e as Error).message));
const needNotes = computed(() => d.mode === 'return' || d.mode === 'reject');

function onScroll() {
  const el = body.value;
  if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 40) read.value = true;
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close'); }
onMounted(() => { document.addEventListener('keydown', onKey); document.body.style.overflow = 'hidden'; setTimeout(onScroll, 300); });
onBeforeUnmount(() => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; });

async function decide() {
  if (!d.mode) return;
  if (needNotes.value && !d.notes.trim()) { toast.error(d.mode === 'reject' ? 'اكتب سبب الرفض' : 'اكتب المطلوب تعديله'); return; }
  busy.value = true;
  try {
    const r = await api<Opportunity>(`/fundraising/opportunities/${o.value.id}/decision`, { method: 'POST', json: { decision: d.mode, notes: d.notes.trim() || null } });
    toast.success(d.mode === 'approve' ? (r.status === 'approved' ? 'اعتُمدت الفرصة نهائيًا وصدر القيد' : 'تمت الموافقة وانتقلت الفرصة للمرحلة التالية') : d.mode === 'return' ? 'أُعيدت الفرصة للتعديل' : 'رُفضت الفرصة');
    emit('decided', r);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const print = () => window.print();
</script>

<template>
  <Teleport to="body">
    <div class="rs-backdrop" @click.self="emit('close')">
      <div class="rs" role="dialog" aria-modal="true">
        <header class="rs-top no-print">
          <b>مراجعة فرصة التبرع {{ fmtNo('FR', o.opportunityNo) }}</b>
          <span v-if="o.canDecide" class="pill">بانتظار قرارك · {{ o.stageName }}</span>
          <span class="grow" />
          <button class="btn btn-sm" @click="print">طباعة</button>
          <button class="btn btn-sm" @click="emit('close')">إغلاق ✕</button>
        </header>

        <div ref="body" class="rs-body" @scroll.passive="onScroll">
          <article class="paper">
            <div class="ph">
              <BrandMark class="logo" />
              <div class="grow">
                <h1>فرصة تبرع {{ label('kind', o.kind) }} <span v-if="o.isZakat" class="fr-zakat">زكاة</span></h1>
                <p class="muted">رقم {{ fmtNo('FR', o.opportunityNo) }} · بتاريخ {{ fmtDate(o.date) }} ({{ hijri(o.date) }})</p>
              </div>
              <div class="amt">
                <strong>{{ sar(o.totalAmount) }}</strong>
                <small>{{ tafqeet(o.totalAmount) }}</small>
                <span class="fr-badge" :style="{ '--c': color('status', o.status) }">{{ label('status', o.status) }}</span>
              </div>
            </div>

            <section>
              <h2><i>1</i> الداعم</h2>
              <dl class="kv">
                <div><dt>الاسم</dt><dd><b>{{ o.donor?.name ?? '—' }}</b> <small v-if="o.donor" class="muted">رقم {{ o.donor.donorNo }}</small></dd></div>
                <div><dt>المستوى</dt><dd>{{ o.donor?.levelName ?? '—' }}</dd></div>
                <div><dt>الجوال</dt><dd dir="ltr">{{ o.donor?.phone ?? '—' }}</dd></div>
                <div><dt>البريد</dt><dd dir="ltr">{{ o.donor?.email ?? '—' }}</dd></div>
                <div v-if="o.donor?.identifier"><dt>السجل التجاري</dt><dd dir="ltr">{{ o.donor.identifier }}</dd></div>
                <div><dt>مدير الدعم</dt><dd>{{ o.supportManager ? `${o.supportManager.name} (${o.supportManager.kind === 'employee' ? 'موظف' : 'من خارج الجمعية'})` : '—' }}</dd></div>
              </dl>
            </section>

            <section>
              <h2><i>2</i> البيانات المالية</h2>
              <dl class="kv">
                <div><dt>نوع الفرصة</dt><dd>{{ label('kind', o.kind) }}{{ o.isZakat ? ' · زكاة' : '' }}</dd></div>
                <div v-if="o.kind === 'cash'"><dt>الحساب البنكي</dt><dd>{{ o.bankAccount ? `${o.bankAccount.bankName} · ${o.bankAccount.iban || o.bankAccount.accountNumber}` : '—' }}</dd></div>
                <div v-if="o.kind === 'cash'"><dt>رقم الحوالة</dt><dd dir="ltr">{{ o.transferReference ?? '—' }}</dd></div>
                <div v-if="o.kind === 'pledge'"><dt>المعالجة</dt><dd>مستحق على حساب الداعم المدين، ويسدد بدفعات من داخل الفرصة</dd></div>
                <div v-if="o.kind === 'pledge'"><dt>المسدد / المتبقي</dt><dd>{{ sar(o.collectedAmount) }} / {{ sar(o.totalAmount - o.collectedAmount) }}</dd></div>
                <div><dt>سجّلها</dt><dd>{{ o.createdByName ?? '—' }} · {{ fmtDateTime(o.createdAt) }}</dd></div>
              </dl>
              <template v-if="o.inKindDescription"><h3>وصف التبرع العيني</h3><p class="text">{{ o.inKindDescription }}</p></template>
            </section>

            <section>
              <h2><i>3</i> التوزيع على البنود (الدفعات)</h2>
              <table class="table">
                <thead><tr><th>#</th><th>الدفعة</th><th>التصنيف</th><th>الجهة</th><th>التوزيع</th><th>المبلغ</th></tr></thead>
                <tbody>
                  <tr v-for="(b, i) in o.batches.filter((x) => !x.parentBatchId)" :key="b.id">
                    <td>{{ i + 1 }}</td><td><span class="fr-no">{{ fmtNo('B', b.batchNo) }}</span></td>
                    <td><span class="fr-badge" :style="{ '--c': color('target', b.isZakat ? 'zakat' : b.targetKind) }">{{ b.isZakat ? 'زكاة' : label('target', b.targetKind) }}</span></td>
                    <td class="wrap">{{ b.targetName }}</td>
                    <td>{{ b.allocationMode === 'percent' ? `${b.percent}%` : 'مبلغ' }}</td>
                    <td class="fr-amount">{{ sar(b.amount) }}</td>
                  </tr>
                </tbody>
                <tfoot><tr><td colspan="5">الإجمالي الموزع</td><td :class="['fr-amount', { bad: Math.abs(allocated - o.totalAmount) > 0.009 }]">{{ sar(allocated) }}</td></tr></tfoot>
              </table>
            </section>

            <section>
              <h2><i>4</i> اشتراطات الداعم</h2>
              <dl class="kv">
                <div><dt>يقبل مساهمة المستفيد</dt><dd>{{ o.conditions.acceptsPatientContribution ? 'نعم' : 'لا' }}</dd></div>
                <div><dt>الحد الأعلى للصرف للحالة</dt><dd>{{ o.conditions.maxSpend ? sar(o.conditions.maxSpend) : 'بدون حد' }}</dd></div>
                <div><dt>الفئات</dt><dd>{{ cats(o.conditions.categories) }}</dd></div>
                <div><dt>الجنسيات</dt><dd>{{ o.conditions.nationalities.length ? o.conditions.nationalities.join('، ') : 'كل الجنسيات' }}</dd></div>
                <div><dt>انتهاء المشروع</dt><dd>{{ o.conditions.endDate ? `${fmtDate(o.conditions.endDate)} (${hijri(o.conditions.endDate)})` : '—' }}</dd></div>
              </dl>
              <template v-if="o.conditionsText"><h3>اشتراطات وإضافات</h3><p class="text">{{ o.conditionsText }}</p></template>
            </section>

            <section>
              <h2><i>5</i> المستندات المرفقة</h2>
              <div v-for="doc in o.documents" :key="doc.id" class="doc">
                <span class="doc-ic">{{ doc.mimeType === 'application/pdf' ? 'PDF' : 'IMG' }}</span>
                <div class="grow"><b>{{ doc.title }}</b><small class="muted">{{ doc.fileName }} · {{ doc.uploadedByName }}</small></div>
                <button class="btn btn-sm no-print" @click="openDoc(doc.id)">فتح</button>
              </div>
              <p v-if="!o.documents.length" class="muted">لا توجد مستندات مرفقة</p>
            </section>

            <section>
              <h2><i>6</i> مسار الاعتماد</h2>
              <ol class="path">
                <li v-for="s in o.stages" :key="s.id" :class="{ cur: s.id === o.currentStageId }">
                  <b>{{ s.name }}</b><small v-if="s.id === o.currentStageId"> · المرحلة الحالية</small>
                  <p v-if="s.instructions" class="muted">{{ s.instructions }}</p>
                </li>
              </ol>
              <h3>سجل الأنشطة</h3>
              <ul class="log">
                <li v-for="a in o.actions" :key="a.id"><i :style="{ background: color('action', a.action) }" /><b>{{ label('action', a.action) }}</b>
                  <small class="muted"> · {{ a.actorName }} · {{ fmtDateTime(a.createdAt) }}{{ a.stageName ? ` · ${a.stageName}` : '' }}</small>
                  <span v-if="a.notes" class="note">{{ a.notes }}</span></li>
              </ul>
            </section>
          </article>
        </div>

        <footer v-if="o.canDecide" class="rs-decide no-print">
          <div class="who"><b>قرارك في مرحلة "{{ o.stageName }}"</b><small v-if="stage?.instructions" class="muted">{{ stage.instructions }}</small>
            <small v-if="!read" class="hint">راجع الفرصة حتى نهايتها قبل القرار ↓</small></div>
          <div class="btns">
            <button :class="['dec', 'ok', { on: d.mode === 'approve' }]" @click="d.mode = 'approve'">✓ موافقة</button>
            <button v-if="stage?.canReturn !== false" :class="['dec', 'ret', { on: d.mode === 'return' }]" @click="d.mode = 'return'">↺ طلب تعديل</button>
            <button v-if="stage?.canReject !== false" :class="['dec', 'bad', { on: d.mode === 'reject' }]" @click="d.mode = 'reject'">✕ رفض</button>
          </div>
          <div v-if="d.mode" class="form">
            <input v-model="d.notes" class="input" :placeholder="d.mode === 'approve' ? 'ملاحظات (اختياري)' : d.mode === 'reject' ? 'سبب الرفض (إلزامي)' : 'المطلوب تعديله (إلزامي)'" @keydown.enter="decide" />
            <button class="btn btn-primary" :disabled="busy || (needNotes && !d.notes.trim())" @click="decide">تأكيد القرار</button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.rs-backdrop { position: fixed; inset: 0; z-index: 60; background: rgba(2, 6, 23, .55); backdrop-filter: blur(4px); display: grid; place-items: center; padding: 16px; animation: fade .2s; }
@keyframes fade { from { opacity: 0; } }
.rs { width: min(980px, 100%); height: min(94vh, 1200px); display: flex; flex-direction: column; background: var(--surface-2); border-radius: 18px; overflow: hidden;
  box-shadow: 0 30px 80px rgba(0, 0, 0, .35); animation: rise .3s var(--ease); }
@keyframes rise { from { transform: translateY(18px); opacity: 0; } }
.rs-top { display: flex; align-items: center; gap: 10px; padding: 12px 18px; background: linear-gradient(120deg, #0b1f2a, #0f3b3a); color: #fff; }
.pill { background: rgba(245, 158, 11, .2); color: #fde68a; border: 1px solid rgba(245, 158, 11, .4); padding: 2px 10px; border-radius: 999px; font-size: .8rem; }
.grow { flex: 1; }
.rs-body { flex: 1; overflow: auto; padding: 22px; }
.paper { background: var(--surface); border-radius: 14px; padding: 28px 32px; box-shadow: 0 6px 24px rgba(15, 23, 42, .06); }
.ph { display: flex; gap: 16px; align-items: center; padding-bottom: 18px; border-bottom: 2px solid var(--border); margin-bottom: 8px; }
.ph .logo { width: 48px; height: 48px; }
.ph h1 { margin: 0; font-size: 1.3rem; }
.ph p { margin: 2px 0 0; }
.amt { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; text-align: left; }
.amt strong { font-size: 1.5rem; color: var(--primary); }
.amt small { color: var(--muted); font-size: .78rem; max-width: 280px; }
section { padding: 16px 0; border-bottom: 1px dashed var(--border); }
section:last-child { border-bottom: 0; }
h2 { display: flex; align-items: center; gap: 8px; font-size: 1rem; margin: 0 0 12px; }
h2 i { font-style: normal; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 8px; background: var(--primary); color: #fff; font-size: .8rem; }
h3 { font-size: .9rem; color: var(--primary); margin: 14px 0 6px; }
.kv { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px 20px; margin: 0; }
.kv dt { color: var(--muted); font-size: .8rem; }
.kv dd { margin: 2px 0 0; }
.text { white-space: pre-wrap; margin: 0; line-height: 1.8; }
.wrap { white-space: normal; }
tfoot td { font-weight: 700; background: var(--surface-2); }
.bad { color: #dc2626; }
.doc { display: flex; gap: 10px; align-items: center; padding: 8px 0; }
.doc small { display: block; }
.doc-ic { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 10px; background: #fee2e2; color: #b91c1c; font-size: .7rem; font-weight: 700; }
.path { margin: 0; padding-inline-start: 20px; }
.path li { padding: 4px 0; }
.path li.cur b { color: #b45309; }
.path p { margin: 2px 0 0; font-size: .84rem; }
.log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.log li i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-inline-end: 6px; }
.log .note { display: block; margin: 2px 16px 0 0; color: var(--text); font-size: .88rem; }
.rs-decide { display: grid; grid-template-columns: 1fr auto; gap: 10px 16px; align-items: center; padding: 14px 18px; background: var(--surface); border-top: 1px solid var(--border);
  box-shadow: 0 -10px 30px rgba(15, 23, 42, .08); }
.who { display: flex; flex-direction: column; gap: 2px; }
.who .hint { color: #b45309; }
.btns { display: flex; gap: 8px; }
.dec { border: 1px solid var(--border); background: var(--surface); padding: 9px 16px; border-radius: 10px; font: inherit; font-weight: 600; cursor: pointer; transition: all .15s; }
.dec.ok.on { background: #10b981; color: #fff; border-color: #10b981; }
.dec.ret.on { background: #f59e0b; color: #fff; border-color: #f59e0b; }
.dec.bad.on { background: #dc2626; color: #fff; border-color: #dc2626; }
.form { grid-column: 1 / -1; display: flex; gap: 8px; }
.form .input { flex: 1; }
@media (max-width: 700px) { .rs-decide { grid-template-columns: 1fr; } .paper { padding: 18px; } .ph { flex-wrap: wrap; } .amt { align-items: flex-start; } }
@media print {
  .rs-backdrop { position: static; background: none; padding: 0; backdrop-filter: none; }
  .rs { height: auto; box-shadow: none; border-radius: 0; }
  .rs-body { overflow: visible; padding: 0; }
  .paper { box-shadow: none; }
}
</style>
