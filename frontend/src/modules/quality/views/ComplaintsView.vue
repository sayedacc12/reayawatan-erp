<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { CHANNELS, P, PARTIES, STATUS_COLOR, errMsg, fmtDate, loadSettings, todayStr, type QSettings } from '../lib';
import '../../../shared/module.css';
import '../quality.css';

interface Complaint {
  id: string; code: string; channel: string; channelLabel: string; partyType: string; partyLabel: string; complainantName: string | null; contact: string | null;
  subject: string; details: string; category: string | null; department: string; departmentName: string; receivedDate: string; assignedTo: string | null;
  investigation: string | null; response: string | null; resolvedDate: string | null; satisfaction: number | null; status: string; statusLabel: string;
  ncrId: string | null; externalRef: string | null; days: number; late: boolean; targetDays: number;
  history: { action: string; byName: string; at: string; note?: string | null }[];
}
interface Portal { id: string; source: string; sourceLabel: string; ticketNo: string; subject: string; message: string; createdAt: string; name: string; phone: string | null }
const session = useSession();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const settings = ref<QSettings | null>(null);
const rows = ref<Complaint[]>([]);
const pending = ref(0);
const targetDays = ref(0);
const status = ref('open');
const portal = ref<Portal[] | null>(null);
async function load() {
  const r = await api<{ rows: Complaint[]; pendingImports: number; targetDays: number }>(`/quality/complaints${status.value === 'all' ? '' : `?status=${status.value}`}`);
  rows.value = r.rows;
  pending.value = r.pendingImports;
  targetDays.value = r.targetDays;
}
onMounted(async () => {
  settings.value = await loadSettings();
  await load();
});
watch(status, load);
const TABS = [
  { v: 'open', l: 'المفتوحة' }, { v: 'resolved', l: 'تم الرد' }, { v: 'closed', l: 'المغلقة' }, { v: 'rejected', l: 'غير المقبولة' }, { v: 'all', l: 'الكل' },
];

// ---------- تسجيل شكوى ----------
const empty = () => ({ channel: 'phone', partyType: 'beneficiary', complainantName: '', contact: '', subject: '', details: '', category: '', department: 'BEN', receivedDate: todayStr(), assignedTo: '' });
const form = reactive({ show: route.query.new === '1', ...empty() });
async function create() {
  try {
    const nil = (v: string) => v || null;
    await api('/quality/complaints', {
      method: 'POST', json: { channel: form.channel, partyType: form.partyType, complainantName: nil(form.complainantName), contact: nil(form.contact), subject: form.subject, details: form.details, category: nil(form.category), department: form.department, receivedDate: form.receivedDate, assignedTo: nil(form.assignedTo) },
    });
    Object.assign(form, empty(), { show: false });
    toast.success('سُجلت الشكوى');
    status.value = 'open';
    await load();
  } catch (e) {
    toast.error(errMsg(e));
  }
}

// ---------- شكاوى البوابة ----------
async function openPortal() {
  portal.value = await api<Portal[]>('/quality/complaints/portal');
}
async function importOne(p: Portal) {
  try {
    await api(`/quality/complaints/portal/${p.id}`, { method: 'POST' });
    portal.value = portal.value!.filter((x) => x.id !== p.id);
    toast.success('سُجلت الشكوى في سجل الجودة');
    await load();
  } catch (e) {
    toast.error(errMsg(e));
  }
}

// ---------- معالجة شكوى ----------
const cur = ref<Complaint | null>(null);
const act = reactive({ investigation: '', response: '', assignedTo: '', satisfaction: 0, severity: 'minor' as 'minor' | 'major' });
function open(c: Complaint) {
  cur.value = c;
  Object.assign(act, { investigation: c.investigation ?? '', response: c.response ?? '', assignedTo: c.assignedTo ?? '', satisfaction: 0, severity: 'minor' });
}
const isOpen = computed(() => cur.value && ['received', 'investigating'].includes(cur.value.status));
async function doAction(action: 'investigate' | 'resolve' | 'close' | 'reject' | 'ncr') {
  if (action === 'ncr' && !confirm('تسجيل حالة عدم مطابقة لهذه الشكوى لمعالجة سببها الجذري؟')) return;
  try {
    const body: Record<string, unknown> = { action };
    if (action === 'investigate') Object.assign(body, { investigation: act.investigation || null, assignedTo: act.assignedTo || null });
    if (action === 'resolve') Object.assign(body, { investigation: act.investigation || null, response: act.response || null });
    if (action === 'reject') body.response = act.response || null;
    if (action === 'close') body.satisfaction = act.satisfaction || null;
    if (action === 'ncr') body.severity = act.severity;
    cur.value = await api<Complaint>(`/quality/complaints/${cur.value!.id}/action`, { method: 'POST', json: body });
    toast.success('حُفظ الإجراء');
    await load();
  } catch (e) {
    toast.error(errMsg(e));
  }
}
const ACTION_LABEL: Record<string, string> = { received: 'استلام الشكوى', investigate: 'دراسة', resolve: 'الرد والمعالجة', close: 'إغلاق', reject: 'عدم قبول', ncr: 'تحويل لعدم مطابقة' };
const can = computed(() => session.can(P.feedback));
</script>

<template>
  <div>
    <section class="pm-hero q-hero">
      <div><p class="pm-kicker">البنود 8.2.1 و9.1.2 و10.2</p><h1>سجل الشكاوى</h1>
        <p class="pm-sub">استلام ← دراسة ← رد ومعالجة ← إغلاق مع قياس رضا صاحب الشكوى. المدة المستهدفة للمعالجة {{ targetDays }} يوم، والشكوى المتكررة أو الجسيمة تتحول لحالة عدم مطابقة.</p></div>
      <div class="pm-actions">
        <button v-if="can && pending" class="btn q-ghost" @click="openPortal">الشكاوى الواردة ({{ pending }})</button>
        <button v-if="can" class="btn q-glow" @click="form.show = true">تسجيل شكوى</button>
      </div>
    </section>
    <div v-if="pending && can" class="q-info">{{ pending }} شكوى واردة من نماذج الموقع أو صفحة التطوع لم تُسجل بعد في سجل الجودة. <a href="#" class="pm-link" @click.prevent="openPortal">راجعها وسجلها</a></div>
    <section class="card pm-panel">
      <div class="q-tabs"><button v-for="t in TABS" :key="t.v" :class="['q-tab', { on: status === t.v }]" @click="status = t.v">{{ t.l }}</button></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الرقم</th><th>الموضوع</th><th>صاحب الشكوى</th><th>القناة</th><th>الإدارة</th><th>الاستلام</th><th>المدة</th><th>الحالة</th></tr></thead>
        <tbody>
          <tr v-for="c in rows" :key="c.id" class="q-row" @click="open(c)">
            <td><span class="q-code">{{ c.code }}</span></td>
            <td><b>{{ c.subject }}</b><span class="pm-muted">{{ c.category ?? 'غير مصنفة' }}<template v-if="c.ncrId"> · حُولت لعدم مطابقة</template></span></td>
            <td>{{ c.complainantName ?? 'بدون اسم' }}<span class="pm-muted">{{ c.partyLabel }}</span></td>
            <td>{{ c.channelLabel }}</td>
            <td><span class="pm-tag">{{ c.department }}</span></td>
            <td class="q-num">{{ fmtDate(c.receivedDate) }}</td>
            <td class="q-num" :style="{ color: c.late ? 'var(--danger)' : '' }">{{ c.days }} يوم</td>
            <td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[c.status] }">{{ c.statusLabel }}</span></td>
          </tr>
          <tr v-if="!rows.length"><td colspan="8" class="pm-empty">لا توجد شكاوى</td></tr>
        </tbody>
      </table></div>
    </section>

    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" style="max-width: 680px" @submit.prevent="create">
        <h2>تسجيل شكوى</h2>
        <div class="q-fields">
          <label class="field"><span>القناة</span><select v-model="form.channel" class="input"><option v-for="x in CHANNELS" :key="x.value" :value="x.value">{{ x.label }}</option></select></label>
          <label class="field"><span>صاحب الشكوى</span><select v-model="form.partyType" class="input"><option v-for="x in PARTIES" :key="x.value" :value="x.value">{{ x.label }}</option></select></label>
          <label class="field"><span>الاسم (اختياري)</span><input v-model="form.complainantName" class="input" /></label>
          <label class="field"><span>وسيلة التواصل</span><input v-model="form.contact" class="input" dir="ltr" /></label>
          <label class="field"><span>الإدارة المعنية</span><select v-model="form.department" class="input"><option v-for="d in settings?.departments" :key="d.code" :value="d.code">{{ d.code }} · {{ d.name }}</option></select></label>
          <label class="field"><span>تاريخ الاستلام</span><input v-model="form.receivedDate" type="date" class="input" required /></label>
          <label class="field"><span>التصنيف</span><input v-model="form.category" class="input" placeholder="مثل: تأخر الصرف" /></label>
          <label class="field"><span>المكلف بالدراسة</span><input v-model="form.assignedTo" class="input" /></label>
        </div>
        <label class="field"><span>الموضوع</span><input v-model="form.subject" class="input" required /></label>
        <label class="field"><span>التفاصيل</span><textarea v-model="form.details" class="input" rows="4" required /></label>
        <div class="modal-actions"><button class="btn btn-primary">تسجيل</button><button type="button" class="btn" @click="form.show = false">إلغاء</button></div>
      </form>
    </div>

    <div v-if="portal" class="modal-backdrop" @click.self="portal = null">
      <div class="card modal" style="max-width: 720px">
        <h2>الشكاوى الواردة من البوابات</h2>
        <p class="pm-muted">شكاوى وصلت من المتطوعون وغيرهم من صفحة التطوع العامة. سجّلها في سجل الجودة لتُدرس ويُرد عليها وتدخل في المؤشرات.</p>
        <div v-for="p in portal" :key="p.id" class="card" style="padding: 12px; margin-bottom: 8px">
          <div style="display: flex; justify-content: space-between; gap: 8px"><b>{{ p.subject }}</b><span class="pm-muted q-num">{{ fmtDate(p.createdAt) }}</span></div>
          <p class="pm-muted" style="margin: 4px 0">{{ p.name }} · {{ p.sourceLabel }} · تذكرة رقم {{ p.ticketNo }}</p>
          <p class="q-pre">{{ p.message }}</p>
          <button class="btn btn-sm btn-primary" style="margin-top: 6px" @click="importOne(p)">تسجيل في سجل الشكاوى</button>
        </div>
        <p v-if="!portal.length" class="q-empty">لا توجد شكاوى جديدة</p>
        <div class="modal-actions"><button class="btn" @click="portal = null">إغلاق</button></div>
      </div>
    </div>

    <div v-if="cur" class="modal-backdrop" @click.self="cur = null">
      <div class="card modal" style="max-width: 760px">
        <div style="display: flex; justify-content: space-between; gap: 8px; align-items: center">
          <h2 style="margin: 0"><span class="q-code">{{ cur.code }}</span> {{ cur.subject }}</h2>
          <span class="pm-pill" :style="{ '--c': STATUS_COLOR[cur.status] }">{{ cur.statusLabel }}</span>
        </div>
        <p class="pm-muted">{{ cur.complainantName ?? 'بدون اسم' }} ({{ cur.partyLabel }}) · {{ cur.channelLabel }} · {{ cur.departmentName }} · {{ fmtDate(cur.receivedDate) }}<template v-if="cur.contact"> · <span dir="ltr">{{ cur.contact }}</span></template></p>
        <p class="q-pre">{{ cur.details }}</p>
        <div v-if="cur.late" class="q-warn">تجاوزت الشكوى المدة المستهدفة ({{ cur.targetDays }} يوم).</div>
        <RouterLink v-if="cur.ncrId" :to="`/quality/ncr/${cur.ncrId}`" class="pm-link">← حالة عدم المطابقة المرتبطة</RouterLink>

        <template v-if="can && isOpen">
          <div class="q-sec">الدراسة والرد</div>
          <label class="field"><span>المكلف بالدراسة</span><input v-model="act.assignedTo" class="input" /></label>
          <label class="field"><span>نتيجة الدراسة والسبب</span><textarea v-model="act.investigation" class="input" rows="3" /></label>
          <label class="field"><span>الرد على صاحب الشكوى والإجراء المتخذ</span><textarea v-model="act.response" class="input" rows="3" /></label>
          <div class="modal-actions" style="flex-wrap: wrap">
            <button class="btn" @click="doAction('investigate')">حفظ الدراسة</button>
            <button class="btn btn-primary" @click="doAction('resolve')">الرد ومعالجة الشكوى</button>
            <button class="btn" @click="doAction('reject')">غير مقبولة</button>
          </div>
        </template>
        <template v-else>
          <template v-if="cur.investigation"><div class="q-sec">نتيجة الدراسة</div><p class="q-pre">{{ cur.investigation }}</p></template>
          <template v-if="cur.response"><div class="q-sec">{{ cur.status === 'rejected' ? 'سبب عدم القبول' : 'الرد والإجراء' }}</div><p class="q-pre">{{ cur.response }}</p></template>
          <p v-if="cur.satisfaction" class="pm-muted">رضا صاحب الشكوى عن المعالجة: {{ '★'.repeat(cur.satisfaction) }}{{ '☆'.repeat(5 - cur.satisfaction) }}</p>
        </template>

        <template v-if="can && cur.status === 'resolved'">
          <div class="q-sec">الإغلاق بعد التواصل مع صاحب الشكوى</div>
          <p class="pm-muted">ما مدى رضاه عن المعالجة؟</p>
          <div class="q-stars"><button v-for="n in 5" :key="n" type="button" :class="{ on: act.satisfaction >= n }" @click="act.satisfaction = n">★</button></div>
          <div class="modal-actions"><button class="btn btn-primary" @click="doAction('close')">إغلاق الشكوى</button></div>
        </template>

        <template v-if="can && !cur.ncrId && cur.status !== 'rejected'">
          <div class="q-sec">عدم مطابقة</div>
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
            <span class="pm-muted">إذا تكررت الشكوى أو كانت جسيمة، سجّل حالة عدم مطابقة لمعالجة السبب الجذري:</span>
            <select v-model="act.severity" class="input" style="width: auto"><option value="minor">بسيطة</option><option value="major">جسيمة</option></select>
            <button class="btn btn-sm" @click="doAction('ncr')">تحويل لعدم مطابقة</button>
          </div>
        </template>

        <div class="q-sec">سجل الإجراءات</div>
        <ul class="q-timeline">
          <li v-for="(h, i) in cur.history" :key="i"><b>{{ ACTION_LABEL[h.action] ?? h.action }}</b> · {{ h.byName }} · <span class="q-num">{{ fmtDate(h.at) }}</span><p v-if="h.note" class="pm-muted" style="margin: 2px 0 0">{{ h.note }}</p></li>
        </ul>
        <div class="modal-actions"><button class="btn" @click="cur = null">إغلاق</button></div>
      </div>
    </div>
  </div>
</template>
