<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { ISR_COLOR, STOCK_DOC_COLOR, fmtDate, fmtDateTime, fmtQty, sar, today } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const props = defineProps<{ id: string }>();
const router = useRouter();
const toast = useToast();
const r = ref<any>(null);
const busy = ref(false);
const modal = ref<'' | 'approve' | 'return' | 'reject' | 'cancel' | 'issue'>('');
const note = ref('');
const iss = ref<any>({ date: today(), receiverName: '', notes: '', lines: [] as any[] });
const base = () => `/procurement/issue-requests/${props.id}`;

async function load() {
  try {
    r.value = await api(base());
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
watch(() => props.id, load);

async function openIssue() {
  const lines = r.value.lines.filter((l: any) => l.remaining > 0).map((l: any) => ({ ...l, out: Math.min(l.remaining, l.available), lot: '', lots: [] as any[] }));
  iss.value = { date: today(), receiverName: r.value.receiverName ?? '', notes: '', lines };
  modal.value = 'issue';
  for (const l of iss.value.lines) {
    if (!l.trackBatch) continue;
    l.lots = await api<any[]>(`/procurement/stock/lots?item=${l.itemId}&warehouse=${r.value.warehouseId}`).catch(() => []);
  }
}
async function confirm() {
  busy.value = true;
  const m = modal.value;
  try {
    if (m === 'issue') {
      const lines = iss.value.lines.filter((l: any) => Number(l.out) > 0).map((l: any) => ({ itemId: l.itemId, qty: Number(l.out), refLineId: l.id, lot: l.lot || null }));
      if (!lines.length) throw new Error('اكتب الكمية المصروفة لصنف واحد على الأقل');
      const d = await api<any>('/procurement/stock-docs/issue', {
        method: 'POST', json: { issueRequestId: props.id, date: iss.value.date, receiverName: iss.value.receiverName || null, notes: iss.value.notes || null, lines },
      });
      toast.success(`صدر سند الصرف ${d.code}`);
      modal.value = '';
      await load();
      return;
    }
    const json = m === 'cancel' ? { reason: note.value } : { note: note.value || null };
    r.value = await api(`${base()}/${m}`, { method: 'POST', json });
    toast.success({ approve: 'اعتُمد طلب الصرف', return: 'أعيد الطلب للتعديل', reject: 'رُفض الطلب', cancel: 'أُلغي الطلب' }[m as 'approve']);
    modal.value = '';
    note.value = '';
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function submit() {
  busy.value = true;
  try {
    r.value = await api(`${base()}/submit`, { method: 'POST', json: {} });
    toast.success('أُرسل الطلب للاعتماد');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const TITLES: Record<string, string> = { approve: 'اعتماد طلب الصرف', return: 'إعادة الطلب للتعديل', reject: 'رفض طلب الصرف', cancel: 'إلغاء طلب الصرف', issue: 'صرف المواد' };
</script>

<template>
  <div v-if="r">
    <div class="page-head">
      <div>
        <h1>{{ r.purpose }}</h1>
        <p class="muted"><span class="pc-code">{{ r.code }}</span> · <span class="pm-pill" :style="{ '--c': ISR_COLOR[r.status] }">{{ r.statusLabel }}</span> · {{ r.requestedByName }}</p>
      </div>
      <div class="pc-inline">
        <button v-if="r.can.edit" class="btn" @click="router.push(`${base()}/edit`)">تعديل</button>
        <button v-if="r.can.submit" class="btn btn-primary" :disabled="busy" @click="submit">إرسال للاعتماد</button>
        <template v-if="r.can.decide">
          <button class="btn btn-primary" @click="note = ''; modal = 'approve'">اعتماد</button>
          <button class="btn" @click="note = ''; modal = 'return'">إعادة للتعديل</button>
          <button class="btn btn-ghost" @click="note = ''; modal = 'reject'">رفض</button>
        </template>
        <button v-if="r.can.issue" class="btn btn-primary" @click="openIssue">صرف المواد</button>
        <button v-if="r.can.cancel" class="btn btn-ghost" @click="note = ''; modal = 'cancel'">إلغاء الطلب</button>
      </div>
    </div>
    <div v-if="r.can.decideWhy" class="alert" style="background: #fffbeb">{{ r.can.decideWhy }}</div>
    <div v-if="r.decisionNote && ['returned', 'rejected'].includes(r.status)" class="alert alert-error">{{ r.decidedByName }}: {{ r.decisionNote }}</div>

    <div class="pc-grid" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)">
      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <dl class="pc-dl">
            <div><dt>المستودع</dt><dd>{{ r.warehouse.code }} · {{ r.warehouse.name }}</dd></div>
            <div><dt>الإدارة</dt><dd>{{ r.unitName ?? '—' }}</dd></div>
            <div><dt>المستلم</dt><dd>{{ r.receiverName ?? '—' }}</dd></div>
            <div><dt>مطلوب قبل</dt><dd>{{ fmtDate(r.neededBy) }}</dd></div>
            <div><dt>مركز التكلفة</dt><dd>{{ r.analytic ? `${r.analytic.code} · ${r.analytic.name}` : '—' }}</dd></div>
            <div><dt>المشروع</dt><dd>{{ r.projectName ?? '—' }}</dd></div>
            <div><dt>مصدر التمويل</dt><dd>{{ r.funding?.label ?? '—' }}</dd></div>
            <div v-if="r.beneficiaryRef"><dt>مرجع المستفيد</dt><dd class="pc-code">{{ r.beneficiaryRef }}</dd></div>
          </dl>
        </section>
        <section class="card pm-panel">
          <h2>الأصناف</h2>
          <table class="pc-lines">
            <thead><tr><th>الصنف</th><th>المطلوب</th><th>المصروف</th><th>المتبقي</th><th>المتاح في المستودع</th></tr></thead>
            <tbody>
              <tr v-for="l in r.lines" :key="l.id">
                <td><b>{{ l.itemName }}</b> <span class="pc-code">{{ l.itemCode }}</span><small v-if="l.note" class="pm-muted" style="display: block">{{ l.note }}</small></td>
                <td class="pc-num">{{ fmtQty(l.qty) }} {{ l.uomName }}</td>
                <td class="pc-num">{{ fmtQty(l.issuedQty) }}</td>
                <td class="pc-num">{{ fmtQty(l.remaining) }}</td>
                <td class="pc-num">{{ fmtQty(l.available) }}<span v-if="l.remaining > l.available" class="pc-flag" style="display: flex">غير كافٍ</span></td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
      <div style="display: grid; gap: 16px; align-content: start">
        <section v-if="r.docs.length" class="card pm-panel">
          <h2>سندات الصرف</h2>
          <ul class="pc-log">
            <li v-for="d in r.docs" :key="d.id"><span><RouterLink class="pm-link" :to="`/procurement/stock-docs/${d.id}`">{{ d.code }}</RouterLink> · {{ fmtDate(d.date) }} · {{ sar(d.total) }} <span class="pm-pill" :style="{ '--c': STOCK_DOC_COLOR[d.status] }">{{ d.status === 'posted' ? 'مرحّل' : d.status === 'pending' ? 'معلق' : 'ملغى' }}</span></span></li>
          </ul>
        </section>
        <section class="card pm-panel">
          <h2>السجل</h2>
          <ul class="pc-log">
            <li v-for="(x, i) in [...r.log].reverse()" :key="i"><span><b>{{ x.action }}</b> · {{ x.byName }} <small class="pm-muted">{{ fmtDateTime(x.at) }}</small><div v-if="x.note" class="pm-muted" style="font-size: .8rem">{{ x.note }}</div></span></li>
          </ul>
        </section>
      </div>
    </div>

    <div v-if="modal" class="modal-backdrop" @click.self="modal = ''">
      <form class="card modal" :style="modal === 'issue' ? 'max-width: 720px' : ''" @submit.prevent="confirm">
        <h2>{{ TITLES[modal] }}</h2>
        <template v-if="modal === 'issue'">
          <p class="pm-muted" style="font-size: .85rem">يُصرف من الأقرب انتهاءً أو الأقدم حسب سياسة الصنف، إلا إذا اخترت تشغيلة محددة. المنتهي لا يُصرف.</p>
          <div class="pc-fields">
            <label class="field"><span>تاريخ الصرف</span><input v-model="iss.date" type="date" class="input" :max="today()" required /></label>
            <label class="field"><span>المستلم</span><input v-model="iss.receiverName" class="input" maxlength="200" /></label>
          </div>
          <table class="pc-lines">
            <thead><tr><th>الصنف</th><th>المتبقي</th><th>المتاح</th><th style="width: 110px">المصروف</th><th style="width: 160px">التشغيلة</th></tr></thead>
            <tbody>
              <tr v-for="l in iss.lines" :key="l.id">
                <td>{{ l.itemName }}</td><td class="pc-num">{{ fmtQty(l.remaining) }}</td><td class="pc-num">{{ fmtQty(l.available) }}</td>
                <td><input v-model.number="l.out" type="number" min="0" :max="l.remaining" step="any" class="input" /></td>
                <td>
                  <select v-if="l.lots.length" v-model="l.lot" class="input">
                    <option value="">تلقائي</option>
                    <option v-for="x in l.lots.filter((y: any) => !y.expired && y.lot)" :key="`${x.lot}-${x.expiryDate}`" :value="x.lot">{{ x.lot }} · {{ fmtQty(x.qty) }}{{ x.expiryDate ? ` · ${x.expiryDate}` : '' }}</option>
                  </select>
                  <span v-else class="pm-muted" style="font-size: .8rem">تلقائي</span>
                </td>
              </tr>
            </tbody>
          </table>
          <label class="field"><span>ملاحظات</span><textarea v-model="iss.notes" class="input" rows="2" /></label>
        </template>
        <label v-else class="field"><span>{{ modal === 'approve' ? 'ملاحظة (اختياري)' : 'السبب' }}</span><textarea v-model="note" class="input" rows="3" :required="modal !== 'approve'" /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">تأكيد</button><button type="button" class="btn" @click="modal = ''">رجوع</button></div>
      </form>
    </div>
  </div>
</template>
