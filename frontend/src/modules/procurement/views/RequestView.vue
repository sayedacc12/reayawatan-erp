<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, openProtectedFile } from '../../../api';
import { useToast } from '../../../stores/toast';
import { ORDER_COLOR, PRIORITY_COLOR, REQ_COLOR, RFQ_COLOR, fmtDate, fmtDateTime, fmtSize, sar, upload } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const props = defineProps<{ id: string }>();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const r = ref<any>(null);
const busy = ref(false);
const similar = ref<any[] | null>(null);
const decision = ref<'' | 'approve' | 'return' | 'reject' | 'cancel'>('');
const note = ref('');
const base = () => `/procurement/requests/${props.id}`;

async function load() {
  try {
    r.value = await api(base());
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(async () => {
  await load();
  if (route.query.submit === '1' && r.value?.can.submit) {
    router.replace({ query: {} });
    await startSubmit();
  }
});
watch(() => props.id, load);

async function run(fn: () => Promise<any>, ok: string) {
  busy.value = true;
  try {
    const x = await fn();
    if (x?.id === props.id) r.value = x;
    else await load();
    toast.success(ok);
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  } finally {
    busy.value = false;
  }
}
async function startSubmit() {
  try {
    const s = await api<any[]>(`${base()}/similar`);
    if (s.length) similar.value = s;
    else await run(() => api(`${base()}/submit`, { method: 'POST', json: {} }), 'أُرسل الطلب للاعتماد');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function confirmSubmit() {
  if (await run(() => api(`${base()}/submit`, { method: 'POST', json: { confirmDuplicate: true } }), 'أُرسل الطلب للاعتماد')) similar.value = null;
}
async function decide() {
  const d = decision.value;
  const ok = d === 'cancel'
    ? await run(() => api(`${base()}/cancel`, { method: 'POST', json: { reason: note.value } }), 'أُلغي الطلب')
    : await run(() => api(`${base()}/${d}`, { method: 'POST', json: { note: note.value || null } }), { approve: 'اعتُمد الطلب', return: 'أُعيد الطلب لصاحبه', reject: 'رُفض الطلب' }[d as 'approve']);
  if (ok) { decision.value = ''; note.value = ''; }
}
const pick = (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; return f; };
const addFile = (e: Event) => { const f = pick(e); if (f) run(() => upload(`${base()}/attachments`, f), 'أُرفق الملف'); };
const removeFile = (key: string) => run(() => api(`${base()}/attachments/${key.split('/').pop()}`, { method: 'DELETE' }), 'حُذف المرفق');
const openFile = (key: string) => openProtectedFile(`${base()}/files/${key.split('/').pop()}`).catch((e) => toast.error(e.message));
const TITLES = { approve: 'اعتماد الطلب', return: 'إعادة الطلب للتعديل', reject: 'رفض الطلب', cancel: 'إلغاء الطلب' };
</script>

<template>
  <div v-if="r">
    <div class="page-head">
      <div>
        <h1>{{ r.title }}</h1>
        <p class="muted">
          <span class="pc-code">{{ r.code }}</span> · {{ r.kindLabel }} · {{ r.requestedByName }} ·
          <span class="pm-pill" :style="{ '--c': REQ_COLOR[r.status] }">{{ r.statusLabel }}</span>
          <span v-if="r.priority !== 'normal'" class="pc-chip" :style="{ '--c': PRIORITY_COLOR[r.priority] }">{{ r.priorityLabel }}</span>
        </p>
      </div>
      <div class="pc-inline">
        <button v-if="r.can.edit" class="btn" @click="router.push(`/procurement/requests/${r.id}/edit`)">تعديل</button>
        <button v-if="r.can.submit" class="btn btn-primary" :disabled="busy" @click="startSubmit">إرسال للاعتماد</button>
        <template v-if="r.can.decide">
          <button class="btn btn-primary" @click="decision = 'approve'">اعتماد</button>
          <button class="btn" @click="decision = 'return'">إعادة للتعديل</button>
          <button class="btn btn-danger" @click="decision = 'reject'">رفض</button>
        </template>
        <template v-if="r.can.source && ['approved', 'sourcing'].includes(r.status)">
          <button v-if="['quotes', 'tender'].includes(r.method) && !r.rfqs.some((q: any) => !['cancelled', 'awarded'].includes(q.status))" class="btn btn-primary" @click="router.push(`/procurement/rfqs/new?request=${r.id}`)">طرح منافسة</button>
          <button v-if="['direct', 'emergency'].includes(r.method)" class="btn btn-primary" @click="router.push(`/procurement/orders/new?request=${r.id}`)">إعداد التعميد</button>
        </template>
        <button v-if="r.can.source && r.status === 'ordered' && ['direct', 'emergency'].includes(r.method) && r.lines.some((l: any) => l.orderedQty < l.qty)" class="btn" @click="router.push(`/procurement/orders/new?request=${r.id}`)">تعميد للكمية المتبقية</button>
        <button v-if="r.can.cancel" class="btn btn-ghost" @click="decision = 'cancel'">إلغاء الطلب</button>
      </div>
    </div>

    <div v-if="r.decisionNote && ['returned', 'rejected'].includes(r.status)" class="alert alert-error">{{ r.statusLabel }}: {{ r.decisionNote }}</div>

    <div class="pc-grid" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)">
      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <dl class="pc-dl">
            <div><dt>الإدارة</dt><dd>{{ r.unitName ?? '—' }}</dd></div>
            <div><dt>المشروع</dt><dd>{{ r.projectName ?? '—' }}</dd></div>
            <div><dt>تاريخ الاحتياج</dt><dd>{{ fmtDate(r.neededBy) }}</dd></div>
            <div><dt>أسلوب الشراء</dt><dd>{{ r.methodLabel ?? r.suggestedMethodLabel }}<small v-if="r.method && r.method !== r.suggestedMethod" class="pc-warn" style="margin-inline-start: 6px">المقترح: {{ r.suggestedMethodLabel }}</small></dd></div>
            <div v-if="r.beneficiaryRef"><dt>مرجع المستفيد</dt><dd class="pc-code">{{ r.beneficiaryRef }}</dd></div>
            <div v-if="r.methodReason" style="grid-column: 1 / -1"><dt>مبرر الأسلوب</dt><dd>{{ r.methodReason }}</dd></div>
            <div v-if="r.justification" style="grid-column: 1 / -1"><dt>المبررات</dt><dd style="white-space: pre-line">{{ r.justification }}</dd></div>
          </dl>
        </section>
        <section class="card pm-panel">
          <h2>البنود</h2>
          <div class="table-wrap">
            <table class="pc-lines">
              <thead><tr><th>#</th><th>البند</th><th>الكمية</th><th>السعر التقديري</th><th>الإجمالي</th><th v-if="r.orders.length">صدر به تعميد</th></tr></thead>
              <tbody>
                <tr v-for="(l, i) in r.lines" :key="l.id">
                  <td>{{ i + 1 }}</td>
                  <td><b>{{ l.description }}</b><span v-if="l.item" class="pc-code" style="margin-inline-start: 6px">{{ l.item.code }}</span><div v-if="l.specs" class="pm-muted" style="font-size: .8rem">{{ l.specs }}</div></td>
                  <td class="pc-num">{{ l.qty }} {{ l.uomName ?? '' }}</td>
                  <td class="pc-num">{{ sar(l.estPrice) }}</td>
                  <td class="pc-num">{{ sar(l.total) }}</td>
                  <td v-if="r.orders.length" class="pc-num">{{ l.orderedQty }}</td>
                </tr>
              </tbody>
              <tfoot><tr><td colspan="4">الإجمالي التقديري</td><td class="pc-num">{{ sar(r.estimatedTotal) }}</td><td v-if="r.orders.length" /></tr></tfoot>
            </table>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>المرفقات</h2>
          <ul class="pc-log" style="gap: 4px">
            <li v-for="f in r.attachments" :key="f.key"><span><a class="pm-link" href="#" @click.prevent="openFile(f.key)">{{ f.name }}</a> <small class="pm-muted">{{ fmtSize(f.size) }} · {{ f.byName }}</small>
              <button v-if="r.can.edit" class="btn btn-ghost" style="padding: 0 6px" @click="removeFile(f.key)">✕</button></span></li>
            <li v-if="!r.attachments.length" class="pm-muted">لا توجد مرفقات</li>
          </ul>
          <label v-if="!['closed', 'cancelled', 'rejected'].includes(r.status)" class="btn" style="margin-top: 8px">+ إرفاق مستند<input type="file" hidden @change="addFile" /></label>
        </section>
      </div>

      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2>مصدر الصرف</h2>
          <dl class="pc-dl" style="grid-template-columns: 1fr">
            <div><dt>مصدر التمويل</dt><dd>{{ r.funding?.label ?? '—' }}</dd></div>
            <div><dt>بند الموازنة</dt><dd>{{ r.budgetLine ? `${r.budgetLine.name} · ${r.budgetLine.budgetCode}` : '—' }}</dd></div>
          </dl>
          <div v-if="r.liveCheck ?? r.budgetCheck" :class="['pc-check-box', (r.liveCheck ?? r.budgetCheck).allowed ? 'ok' : 'bad']" style="margin-top: 10px">
            <b>{{ (r.liveCheck ?? r.budgetCheck).allowed ? '✓' : '✕' }} {{ (r.liveCheck ?? r.budgetCheck).message }}</b>
            <div v-for="w in (r.liveCheck ?? r.budgetCheck).warnings" :key="w" style="font-size: .8rem; margin-top: 4px">• {{ w }}</div>
          </div>
          <p class="pm-muted" style="font-size: .78rem; margin-top: 6px">يُحجز المبلغ فعليًا عند اعتماد التعميد.</p>
        </section>
        <section v-if="r.rfqs.length || r.orders.length" class="card pm-panel">
          <h2>المنافسات والتعميدات</h2>
          <ul class="pc-log" style="gap: 6px">
            <li v-for="q in r.rfqs" :key="q.id"><span><RouterLink class="pm-link" :to="`/procurement/rfqs/${q.id}`">{{ q.code }}</RouterLink> {{ q.title }} <span class="pm-pill" :style="{ '--c': RFQ_COLOR[q.status] }">{{ q.statusLabel }}</span></span></li>
            <li v-for="o in r.orders" :key="o.id"><span><RouterLink class="pm-link" :to="`/procurement/orders/${o.id}`">{{ o.code }}</RouterLink> {{ o.supplierName }} · {{ sar(o.total) }} <span class="pm-pill" :style="{ '--c': ORDER_COLOR[o.status] }">{{ o.statusLabel }}</span></span></li>
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

    <div v-if="similar" class="modal-backdrop" @click.self="similar = null">
      <div class="card modal">
        <h2>طلبات مشابهة مفتوحة</h2>
        <p class="pm-muted">توجد طلبات فيها نفس الأصناف خلال آخر 90 يومًا. تأكد أن طلبك ليس تكرارًا لها.</p>
        <ul class="pc-log">
          <li v-for="s in similar" :key="s.id"><span><RouterLink class="pm-link" :to="`/procurement/requests/${s.id}`" target="_blank">{{ s.code }}</RouterLink> {{ s.title }} · {{ s.requestedByName }} <span class="pm-pill" :style="{ '--c': REQ_COLOR[s.status] }">{{ s.statusLabel }}</span></span></li>
        </ul>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy" @click="confirmSubmit">ليس تكرارًا، أرسل الطلب</button><button class="btn" @click="similar = null">رجوع</button></div>
      </div>
    </div>

    <div v-if="decision" class="modal-backdrop" @click.self="decision = ''">
      <form class="card modal" @submit.prevent="decide">
        <h2>{{ TITLES[decision] }}</h2>
        <p v-if="decision === 'approve' && r.liveCheck && !r.liveCheck.allowed" class="alert alert-error">{{ r.liveCheck.message }}</p>
        <label class="field"><span>{{ decision === 'approve' ? 'ملاحظة (اختياري)' : 'السبب' }}</span><textarea v-model="note" class="input" rows="3" :required="decision !== 'approve'" /></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">تأكيد</button><button type="button" class="btn" @click="decision = ''">رجوع</button></div>
      </form>
    </div>
  </div>
</template>
