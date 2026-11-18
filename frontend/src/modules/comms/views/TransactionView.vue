<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useSession } from '../../../stores/session';
import { api, openProtectedFile } from '../../../api';
import { useToast } from '../../../stores/toast';
import SearchSelect from '../../fundraising/components/SearchSelect.vue';
import AnalyticPicker, { type Share } from '../../accounting/components/AnalyticPicker.vue';
import { loadAnalytic, useAccounts, type Analytic, type CashAccount } from '../../accounting/lib';
import ConfBadge from '../components/ConfBadge.vue';
import PersonPicker from '../components/PersonPicker.vue';
import { MOVE_AR, PRIORITY_COLOR, PURPOSES, STATUS_COLOR, addDays, fmtDate, fmtDateTime, loadLookups, money, todayStr, unitOptions, type Lookups, type TxnRow } from '../lib';
import '../../projects/projects.css';
import '../comms.css';

interface Movement { at: string; kind: string; byId: string; byName: string; toName?: string | null; toUnitName?: string | null; purpose?: string | null; note?: string | null; dueDate?: string | null }
interface Txn extends TxnRow {
  body: string; externalRef: string | null; partyName: string | null; categoryCode: string | null;
  followers: { userId: string; name: string; unitName?: string | null }[]; recipients: { userId: string; name: string; unitName?: string | null; readAt: string | null }[];
  movements: Movement[]; attachments: { id: string; name: string; mime: string; size: number; byName: string; at: string }[];
  closeNote: string | null; closedAt: string | null; closedByName: string | null; voucherId: string | null;
  tasks: { id: string; refNo: string; title: string; ownerName: string; status: string; dueDate: string }[];
  can: { act: boolean; edit: boolean; follow: boolean; attach: boolean; voucher: boolean; reopen: boolean; cancel: boolean; task: boolean };
}

const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const t = ref<Txn | null>(null);
const L = ref<Lookups | null>(null);
const error = ref('');
const busy = ref(false);
const modal = ref<'' | 'refer' | 'return' | 'note' | 'close' | 'followers' | 'reopen' | 'cancel' | 'task'>('');
const f = reactive({
  toMode: 'user' as 'user' | 'unit', toUserId: null as string | null, toUnitId: '', purpose: 'action', dueDate: '', note: '',
  closeKind: 'done' as 'done' | 'archive' | 'voucher', followers: [] as string[], taskTitle: '', taskOwner: null as string | null, taskDue: '',
  voucherDate: todayStr(), amount: null as number | null, partyName: '', method: 'transfer', methodRef: '', cashAccountId: null as string | null, counterAccountId: null as string | null,
  analytic: [] as Share[],
});
const fileInput = ref<HTMLInputElement | null>(null);

async function load() {
  try {
    t.value = await api<Txn>(`/comms/transactions/${props.id}`);
    error.value = '';
    // فتح القرار أو التعميم يسجل الاطلاع تلقائيًا
    const mine = t.value.recipients.find((r) => r.readAt === null && r.userId === session.user?.id);
    if (t.value.status === 'issued' && mine) {
      await api(`/comms/transactions/${props.id}/ack`, { method: 'POST' });
      t.value = await api<Txn>(`/comms/transactions/${props.id}`);
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await load();
  loadLookups().then((l) => (L.value = l)).catch(() => {});
});

const units = computed(() => unitOptions(L.value?.units ?? []));
const color = computed(() => STATUS_COLOR[t.value?.status ?? 'open']);
const flow = computed(() => [...(t.value?.movements ?? [])].reverse());
const initials = (n: string | null) => (n ?? '؟').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join(' ');

function openModal(m: typeof modal.value) {
  Object.assign(f, { note: '', toUserId: null, toUnitId: '', purpose: 'action', dueDate: t.value?.dueDate ?? '', closeKind: t.value?.kind === 'financial' && t.value.can.voucher ? 'voucher' : 'done' });
  if (m === 'followers') f.followers = (t.value?.followers ?? []).map((x) => x.userId);
  if (m === 'task') Object.assign(f, { taskTitle: t.value?.subject ?? '', taskOwner: null, taskDue: addDays(todayStr(), 7) });
  if (m === 'close' && t.value?.kind === 'financial') {
    Object.assign(f, { amount: t.value.amount, partyName: t.value.partyName ?? t.value.externalParty ?? '', voucherDate: todayStr(), analytic: [] });
    if (t.value.can.voucher) loadFinance();
  }
  modal.value = m;
}

// بيانات السند: البنوك والصناديق والحسابات من النظام المالي
const { accounts, load: loadAccounts, subOptions } = useAccounts();
const cash = ref<CashAccount[]>([]);
const analytic = ref<Analytic[]>([]);
const financeError = ref('');
const picker = ref(false);
let financeLoaded = false;
async function loadFinance() {
  if (financeLoaded) return;
  try {
    await Promise.all([
      loadAccounts(),
      api<CashAccount[]>('/accounting/cash-accounts').then((r) => { cash.value = r.filter((c) => c.isActive); if (cash.value.length === 1) f.cashAccountId = cash.value[0].id; }),
      loadAnalytic().then((r) => { analytic.value = r.accounts; }),
    ]);
    financeLoaded = true;
    financeError.value = '';
  } catch (e) {
    financeError.value = `تعذر تحميل حسابات النظام المالي: ${(e as Error).message}`;
  }
}
const cashOptions = computed(() => cash.value.map((c) => ({ id: c.id, label: c.name, sub: c.kind === 'bank' ? 'بنك' : 'صندوق' })));
const counterOptions = computed(() => subOptions((a) => !cash.value.some((c) => c.glAccount?.id === a.id)));
const counter = computed(() => accounts.value.find((a) => a.id === f.counterAccountId));
const analyticText = computed(() => f.analytic.map((s) => `${analytic.value.find((a) => a.id === s.analyticId)?.name ?? ''}${f.analytic.length > 1 ? ` ${s.percent}%` : ''}`).join('، '));

async function run(path: string, body: unknown, done: string, method = 'POST') {
  busy.value = true;
  try {
    await api(`/comms/transactions/${props.id}/${path}`, { method, json: body });
    toast.success(done);
    modal.value = '';
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const refer = () => run('refer', { toUserId: f.toMode === 'user' ? f.toUserId : null, toUnitId: f.toMode === 'unit' ? f.toUnitId || null : null, purpose: f.purpose, dueDate: f.dueDate || null, note: f.note || null }, 'أُحيلت المعاملة');
const close = () => run('close', f.closeKind === 'voucher'
  ? { closeKind: 'voucher', note: f.note || null, voucherDate: f.voucherDate, amount: f.amount, partyName: f.partyName || null, method: f.method, methodRef: f.methodRef || null,
      cashAccountId: f.cashAccountId, counterAccountId: f.counterAccountId, analytic: f.analytic }
  : { closeKind: f.closeKind, note: f.note }, f.closeKind === 'voucher' ? 'أُنشئ السند مسودةً في النظام المالي' : f.closeKind === 'archive' ? 'حُفظت المعاملة' : 'أُنجزت المعاملة');

async function upload(file: File | undefined) {
  if (!file) return;
  busy.value = true;
  try {
    const fd = new FormData();
    fd.append('file', file);
    await api(`/comms/transactions/${props.id}/attachments`, { method: 'POST', body: fd });
    toast.success('أُرفق الملف');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}
const openFile = (fid: string) => openProtectedFile(`/comms/transactions/${props.id}/attachments/${fid}`).catch((e) => toast.error((e as Error).message));
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} م.ب` : `${Math.max(1, Math.round(n / 1024))} ك.ب`);
const moveColor = (k: string) => ({ refer: '#0ea5e9', return: '#f59e0b', note: '#6366f1', done: '#10b981', voucher: '#10b981', archive: '#64748b', cancel: '#dc2626', reopen: '#f97316', task: '#14b8a6', ack: '#10b981', issue: '#8b5cf6' })[k] ?? '#94a3b8';
const purposeLabel = (p: string | null | undefined) => PURPOSES.find((x) => x.value === p)?.label ?? '';
const readCount = computed(() => t.value?.recipients.filter((r) => r.readAt).length ?? 0);
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-error">{{ error }} <RouterLink to="/comms/inbox">العودة إلى معاملاتي</RouterLink></div>
    <template v-if="t">
      <section class="pm-hero cm-hero">
        <div style="display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: flex-end">
          <div>
            <p class="pm-kicker">{{ t.docLabel }} · <span class="cm-code" style="color: inherit">{{ t.refNo }}</span></p>
            <h1>{{ t.subject }}</h1>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px">
              <span class="pm-pill" :style="{ '--c': color }">{{ t.statusLabel }}</span>
              <ConfBadge :level="t.confidentiality" :label="t.confidentialityLabel" />
              <span class="pm-pill" :style="{ '--c': PRIORITY_COLOR[t.priority] }">{{ t.priorityLabel }}</span>
              <span v-if="t.docType === 'transaction'" class="pm-pill" style="--c: #6366f1">{{ t.kindLabel }} · {{ t.directionLabel }}</span>
            </div>
          </div>
          <div class="pm-actions">
            <RouterLink v-if="t.can.edit" :to="`/comms/edit/${t.id}`" class="btn cm-glow">تعديل وإرسال</RouterLink>
            <button v-if="t.can.cancel" class="btn cm-ghost" @click="openModal('cancel')">إلغاء</button>
            <button v-if="t.can.reopen" class="btn cm-ghost" @click="openModal('reopen')">إعادة فتح</button>
          </div>
        </div>
      </section>

      <div class="cm-grid">
        <div>
          <!-- عند من المعاملة الآن -->
          <div v-if="t.status === 'open' && t.holderName" class="cm-holder">
            <div class="av">{{ initials(t.holderName) }}</div>
            <div style="flex: 1">
              <small>المعاملة الآن عند</small>
              <div style="font-weight: 800; font-size: 1.05rem">{{ t.isHolder ? 'أنت' : t.holderName }} <small v-if="t.holderUnitName">· {{ t.holderUnitName }}</small></div>
              <small>{{ t.holderPurposeLabel }} منذ {{ fmtDateTime(t.holderSince) }}<template v-if="t.dueDate"> · الإنجاز قبل {{ fmtDate(t.dueDate) }}</template></small>
            </div>
            <span v-if="t.overdue" class="pm-pill" style="--c: #fecdd3">متأخرة</span>
          </div>

          <section v-if="t.can.act" class="card pm-panel" style="border: 1.5px solid #14b8a6">
            <h2 style="margin-bottom: 4px">إجراءك على المعاملة</h2>
            <p class="pm-muted" style="margin-top: 0">المعاملة عندك: أحلها أو أعدها بإفادتك، أو أنهها.</p>
            <div class="pm-actions" style="flex-wrap: wrap">
              <button class="btn btn-primary" @click="openModal('refer')">إحالة</button>
              <button class="btn" @click="openModal('return')">إعادة لمن أحالها</button>
              <button class="btn" @click="openModal('note')">إفادة</button>
              <button v-if="t.can.task" class="btn" @click="openModal('task')">إسناد مهمة</button>
              <button class="btn cm-glow" @click="openModal('close')">{{ t.kind === 'financial' ? 'إنهاء (سند أو حفظ)' : 'إنهاء أو حفظ' }}</button>
            </div>
          </section>

          <section class="card pm-panel">
            <h2>{{ t.docType === 'transaction' ? 'نص المعاملة' : 'النص' }}</h2>
            <p v-if="t.externalParty" class="pm-muted" style="margin-top: -6px">{{ t.direction === 'incoming' ? 'واردة من' : 'صادرة إلى' }}: <b>{{ t.externalParty }}</b><template v-if="t.externalRef"> · رقم خطابها {{ t.externalRef }}</template></p>
            <p class="cm-text">{{ t.body || '—' }}</p>
            <div v-if="t.kind === 'financial'" class="card" style="padding: 12px 14px; background: var(--surface-2); margin-top: 14px; display: flex; gap: 18px; flex-wrap: wrap">
              <span>معاملة مالية: <b>{{ t.financialType === 'receipt' ? 'قبض' : 'صرف' }}</b></span>
              <span>المبلغ: <b>{{ money(t.amount) }}</b></span>
              <span v-if="t.partyName">الجهة: <b>{{ t.partyName }}</b></span>
              <span v-if="t.voucherSerial">السند: <RouterLink v-if="t.voucherId" :to="`/accounting/vouchers/${t.voucherId}`"><b>رقم {{ t.voucherSerial }}</b></RouterLink></span>
            </div>
            <div v-if="t.closeNote && ['closed', 'archived'].includes(t.status)" class="alert" style="margin-top: 14px; background: #ecfdf5; color: #047857">
              {{ t.status === 'archived' ? 'حُفظت' : 'أُنهيت' }} بواسطة {{ t.closedByName }} في {{ fmtDateTime(t.closedAt) }}: {{ t.closeNote }}
            </div>
          </section>

          <section class="card pm-panel">
            <h2>مسار المعاملة</h2>
            <ol class="cm-flow">
              <li v-for="(m, i) in flow" :key="i" :class="{ now: i === 0 && t.status === 'open' }" :style="{ '--i': i, '--c': moveColor(m.kind) }">
                <b>{{ m.byName }}</b> {{ MOVE_AR[m.kind] ?? m.kind }}
                <template v-if="m.toName"> <b>{{ m.toName }}</b><span v-if="m.toUnitName" class="pm-muted"> ({{ m.toUnitName }})</span></template>
                <span v-if="m.purpose" class="pm-muted"> {{ purposeLabel(m.purpose) }}</span>
                <span v-if="m.dueDate && m.kind === 'refer'" class="pm-muted"> · قبل {{ fmtDate(m.dueDate) }}</span>
                <span class="when">{{ fmtDateTime(m.at) }}</span>
                <p v-if="m.note">{{ m.note }}</p>
              </li>
            </ol>
          </section>
        </div>

        <div>
          <section class="card pm-panel">
            <h2>بيانات</h2>
            <dl class="pm-dl" style="display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0">
              <dt class="pm-muted">أنشأها</dt><dd style="margin: 0">{{ t.createdByName }}<span v-if="t.originUnitName" class="pm-muted"> · {{ t.originUnitName }}</span></dd>
              <dt class="pm-muted">التاريخ</dt><dd style="margin: 0">{{ fmtDateTime(t.issuedAt ?? t.createdAt) }}</dd>
              <template v-if="t.categoryName"><dt class="pm-muted">التصنيف</dt><dd style="margin: 0">{{ t.categoryName }}</dd></template>
              <template v-if="t.dueDate"><dt class="pm-muted">الإنجاز قبل</dt><dd style="margin: 0">{{ fmtDate(t.dueDate) }}</dd></template>
            </dl>
          </section>

          <section v-if="t.docType !== 'transaction'" class="card pm-panel">
            <h2>الموجه إليهم <small class="pm-muted">اطلع {{ readCount }} من {{ t.recipientsCount || t.recipients.length }}</small></h2>
            <div class="cm-chips">
              <span v-for="r in t.recipients" :key="r.userId" :class="['cm-chip', { read: r.readAt }]" :title="r.readAt ? `اطلع ${fmtDateTime(r.readAt)}` : 'لم يطلع بعد'">{{ r.readAt ? '✓' : '○' }} {{ r.name }}</span>
            </div>
          </section>

          <section class="card pm-panel">
            <h2 style="display: flex; justify-content: space-between; align-items: center">المتابعون <button v-if="t.can.follow" class="btn btn-sm" @click="openModal('followers')">تعديل</button></h2>
            <p v-if="t.confidentiality === 'top_secret'" class="pm-muted">عالية السرية: لا متابعين لها.</p>
            <div v-else-if="t.followers.length" class="cm-chips"><span v-for="x in t.followers" :key="x.userId" class="cm-chip">{{ x.name }}</span></div>
            <p v-else class="pm-muted">لا يوجد متابعون. المتابع يطلع على المعاملة ومسارها دون أن يتدخل في إجراءاتها.</p>
          </section>

          <section class="card pm-panel">
            <h2 style="display: flex; justify-content: space-between; align-items: center">المرفقات
              <button v-if="t.can.attach" class="btn btn-sm" :disabled="busy" @click="fileInput?.click()">+ إرفاق</button></h2>
            <input ref="fileInput" type="file" hidden accept=".pdf,image/*" @change="upload(($event.target as HTMLInputElement).files?.[0])" />
            <div v-if="t.attachments.length" style="display: grid; gap: 6px">
              <button v-for="a in t.attachments" :key="a.id" class="btn" style="justify-content: space-between; display: flex" @click="openFile(a.id)">
                <span>📎 {{ a.name }}</span><small class="pm-muted">{{ kb(a.size) }} · {{ a.byName }}</small>
              </button>
            </div>
            <p v-else class="pm-muted">لا توجد مرفقات.</p>
          </section>

          <section v-if="t.tasks.length" class="card pm-panel">
            <h2>المهام المسندة منها</h2>
            <RouterLink v-for="k in t.tasks" :key="k.id" :to="`/comms/tasks/${k.id}`" class="cm-chip" style="display: flex; justify-content: space-between; margin-bottom: 6px; border-radius: 10px; padding: 8px 10px">
              <span><span class="cm-code">{{ k.refNo }}</span> {{ k.title }}</span><small class="pm-muted">{{ k.ownerName }} · {{ fmtDate(k.dueDate) }}</small>
            </RouterLink>
          </section>
        </div>
      </div>
    </template>

    <!-- النوافذ -->
    <div v-if="modal && t" class="modal-backdrop" @click.self="modal = ''">
      <div class="modal card" style="max-width: 620px">
        <template v-if="modal === 'refer'">
          <h2>إحالة المعاملة</h2>
          <div class="cm-seg" style="margin-bottom: 10px"><button type="button" :class="{ on: f.toMode === 'user' }" @click="f.toMode = 'user'">إلى موظف</button><button type="button" :class="{ on: f.toMode === 'unit' }" @click="f.toMode = 'unit'">إلى إدارة أو قسم</button></div>
          <div v-if="f.toMode === 'user'" class="field"><PersonPicker v-model="f.toUserId" :people="L?.people ?? []" placeholder="اختر الموظف" /></div>
          <label v-else class="field"><select v-model="f.toUnitId" class="input"><option value="">اختر الإدارة</option><option v-for="u in units" :key="u.id" :value="u.id">{{ u.label }}{{ u.manager ? ` (${u.manager})` : '' }}</option></select></label>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px">
            <label class="field"><span>الغرض</span><select v-model="f.purpose" class="input"><option v-for="p in PURPOSES" :key="p.value" :value="p.value">{{ p.label }}</option></select></label>
            <label class="field"><span>الإنجاز قبل</span><input v-model="f.dueDate" type="date" class="input" /></label>
          </div>
          <label class="field"><span>توجيهك</span><textarea v-model="f.note" class="input" rows="3" /></label>
          <div class="modal-actions"><button class="btn btn-primary" :disabled="busy || (f.toMode === 'user' ? !f.toUserId : !f.toUnitId)" @click="refer">إحالة</button><button class="btn" @click="modal = ''">إلغاء</button></div>
        </template>

        <template v-else-if="modal === 'return' || modal === 'note' || modal === 'reopen' || modal === 'cancel'">
          <h2>{{ { return: 'إعادة المعاملة لمن أحالها', note: 'إفادة على المعاملة', reopen: 'إعادة فتح المعاملة', cancel: 'إلغاء المعاملة' }[modal] }}</h2>
          <p class="pm-muted" style="margin-top: -6px">{{ { return: 'تعود المعاملة لآخر من أحالها إليك مع إفادتك.', note: 'تُسجل في مسار المعاملة وتبقى المعاملة عندك.', reopen: 'تعود المعاملة مفتوحة وتكون عندك.', cancel: 'تُلغى المعاملة ولا يمكن الإجراء عليها بعد ذلك.' }[modal] }}</p>
          <label class="field"><span>{{ modal === 'cancel' ? 'سبب الإلغاء' : modal === 'reopen' ? 'سبب إعادة الفتح' : 'الإفادة' }}</span><textarea v-model="f.note" class="input" rows="4" required /></label>
          <div class="modal-actions">
            <button :class="['btn', modal === 'cancel' ? 'btn-danger' : 'btn-primary']" :disabled="busy || f.note.trim().length < 2" @click="run(modal === 'return' ? 'return' : modal, { note: f.note }, 'تم')">تأكيد</button>
            <button class="btn" @click="modal = ''">رجوع</button>
          </div>
        </template>

        <template v-else-if="modal === 'followers'">
          <h2>المتابعون</h2>
          <p class="pm-muted" style="margin-top: -6px">يطلع المتابع على المعاملة ومسارها ويتلقى جديدها، ولا يستطيع الإجراء عليها.</p>
          <PersonPicker v-model="f.followers" :people="L?.people ?? []" multiple placeholder="أضف متابعًا" />
          <div class="modal-actions" style="margin-top: 14px"><button class="btn btn-primary" :disabled="busy" @click="run('followers', { userIds: f.followers }, 'حُدّث المتابعون', 'PUT')">حفظ</button><button class="btn" @click="modal = ''">إلغاء</button></div>
        </template>

        <template v-else-if="modal === 'task'">
          <h2>إسناد مهمة من المعاملة</h2>
          <p class="pm-muted" style="margin-top: -6px">تصل المهمة للمسؤول في «مهامي» وجرس المهام، وتبقى مرتبطة بالمعاملة.</p>
          <label class="field"><span>عنوان المهمة</span><input v-model="f.taskTitle" class="input" /></label>
          <div class="field"><span>المسؤول عن التنفيذ</span><PersonPicker v-model="f.taskOwner" :people="L?.people ?? []" /></div>
          <label class="field"><span>موعد الإغلاق</span><input v-model="f.taskDue" type="date" class="input" :min="todayStr()" /></label>
          <div class="modal-actions"><button class="btn btn-primary" :disabled="busy || !f.taskOwner" @click="run('task', { title: f.taskTitle, ownerUserId: f.taskOwner, dueDate: f.taskDue }, 'أُسندت المهمة')">إسناد</button><button class="btn" @click="modal = ''">إلغاء</button></div>
        </template>

        <template v-else-if="modal === 'close'">
          <h2>إنهاء المعاملة</h2>
          <div class="cm-seg" style="margin-bottom: 14px">
            <button v-if="t.kind === 'financial'" type="button" :class="{ on: f.closeKind === 'voucher' }" :disabled="!t.can.voucher" @click="f.closeKind = 'voucher'; loadFinance()">{{ t.financialType === 'receipt' ? 'بسند قبض' : 'بسند صرف' }}</button>
            <button v-else type="button" :class="{ on: f.closeKind === 'done' }" @click="f.closeKind = 'done'">إنجاز</button>
            <button type="button" :class="{ on: f.closeKind === 'archive' }" @click="f.closeKind = 'archive'">حفظ</button>
          </div>
          <p v-if="t.kind === 'financial' && !t.can.voucher" class="pm-muted">إنشاء السند يحتاج صلاحية «إنهاء المعاملات المالية بسند»، ويمكنك إحالتها لمن يملكها.</p>
          <template v-if="f.closeKind === 'voucher'">
            <div v-if="financeError" class="alert alert-error">{{ financeError }}</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px">
              <label class="field"><span>تاريخ السند</span><input v-model="f.voucherDate" type="date" class="input" /></label>
              <label class="field"><span>المبلغ</span><input v-model.number="f.amount" type="number" step="0.01" min="0.01" class="input" /></label>
              <label class="field"><span>{{ t.financialType === 'receipt' ? 'استلمنا من' : 'يُصرف إلى' }}</span><input v-model="f.partyName" class="input" /></label>
              <label class="field"><span>طريقة الدفع</span><select v-model="f.method" class="input"><option value="transfer">تحويل</option><option value="cash">نقدًا</option><option value="cheque">شيك</option><option value="card">بطاقة</option></select></label>
            </div>
            <div class="field"><span>البنك أو الصندوق</span><SearchSelect v-model="f.cashAccountId" :options="cashOptions" placeholder="اختر البنك أو الصندوق" /></div>
            <div class="field"><span>الحساب المقابل</span><SearchSelect v-model="f.counterAccountId" :options="counterOptions" placeholder="ابحث برقم الحساب أو اسمه" /></div>
            <div class="field"><span>الحساب التحليلي {{ counter?.requiresAnalytic ? '(إلزامي لهذا الحساب)' : '(اختياري)' }}</span>
              <button type="button" class="btn" @click="picker = true">{{ f.analytic.length ? analyticText : 'اختر الحساب التحليلي' }}</button></div>
            <p class="pm-muted">يُنشأ السند مسودةً في النظام المالي ويمر باعتماده المعتاد، وتُغلق المعاملة مرتبطة برقمه.</p>
          </template>
          <label class="field"><span>{{ f.closeKind === 'archive' ? 'سبب الحفظ' : f.closeKind === 'done' ? 'ما تم في المعاملة' : 'ملاحظة (اختيارية)' }}</span><textarea v-model="f.note" class="input" rows="3" /></label>
          <div class="modal-actions">
            <button class="btn btn-primary" :disabled="busy || (f.closeKind === 'voucher' ? !f.cashAccountId || !f.counterAccountId || !f.amount : f.note.trim().length < 3)" @click="close">تأكيد الإنهاء</button>
            <button class="btn" @click="modal = ''">إلغاء</button>
          </div>
        </template>
      </div>
    </div>
    <AnalyticPicker v-if="picker" v-model="f.analytic" :analytic="analytic" :amount="Number(f.amount || 0)" :required="counter?.requiresAnalytic" @close="picker = false" />
  </div>
</template>
