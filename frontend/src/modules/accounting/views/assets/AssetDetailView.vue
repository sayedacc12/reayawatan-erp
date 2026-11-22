<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../../api';
import { useSession } from '../../../../stores/session';
import { useToast } from '../../../../stores/toast';
import SearchSelect from '../../../../shared/SearchSelect.vue';
import AssetForm from '../../components/AssetForm.vue';
import MaintenanceForm from '../../components/MaintenanceForm.vue';
import { AF, CONDITIONS, STATUS_COLOR, imageUrl, useLookups, type AssetDetail } from '../../assets';
import { P, dt, sar, todayStr } from '../../lib';
import '../../../../shared/module.css';
import '../../acc.css';
import './assets.css';

const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const router = useRouter();
const { lookups, load: loadLookups } = useLookups();
const a = ref<AssetDetail | null>(null);
const error = ref('');
const img = ref<string | null>(null);
const tab = ref<'moves' | 'dep' | 'custody' | 'maint'>('moves');

async function load() {
  try {
    a.value = await api<AssetDetail>(`${AF}/${props.id}`);
    if (img.value) URL.revokeObjectURL(img.value);
    img.value = a.value.hasImage ? await imageUrl(a.value.id) : null;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => { load(); loadLookups().catch(() => {}); });
watch(() => props.id, load);
onBeforeUnmount(() => { if (img.value) URL.revokeObjectURL(img.value); });

const held = computed(() => !!a.value && ['draft', 'construction', 'pending_purchase', 'active', 'pending_sale'].includes(a.value.status));
const consumed = computed(() => (a.value && a.value.cost ? Math.min(100, Math.round((a.value.accum / a.value.cost) * 100)) : 0));
const fieldRows = computed(() => (a.value?.group.fields ?? []).map((f) => ({ ...f, value: a.value?.fieldValues[f.key] ?? null })));

const maintTotal = computed(() => (a.value?.maintenanceLog ?? []).reduce((s, m) => s + m.cost, 0));
const repairs = computed(() => (a.value?.maintenanceLog ?? []).filter((m) => m.kind === 'repair').length);
const recording = ref(false);
async function maintSaved() { recording.value = false; tab.value = 'maint'; await load(); }
async function removeMaint(id: string) {
  if (!confirm('حذف سجل الصيانة؟')) return;
  try {
    await api(`${AF}/maintenance/${id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const daysTo = (d: string) => Math.round((Date.parse(d) - Date.parse(todayStr())) / 86400_000);

// ---------------- الصورة ----------------
const fileInput = ref<HTMLInputElement | null>(null);
async function upload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || !a.value) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    await api(`${AF}/${a.value.id}/image`, { method: 'POST', body: fd });
    toast.success('تم حفظ صورة الأصل');
    await load();
  } catch (err) {
    toast.error((err as Error).message);
  }
}
async function removeImage() {
  if (!a.value || !confirm('حذف صورة الأصل؟')) return;
  await api(`${AF}/${a.value.id}/image`, { method: 'DELETE' }).catch((e) => toast.error((e as Error).message));
  await load();
}

// ---------------- التعديل والحذف ----------------
const editing = ref(false);
function saved(r: AssetDetail) { editing.value = false; a.value = r; }
async function remove() {
  if (!a.value || !confirm(`حذف الأصل ${a.value.code}؟`)) return;
  try {
    await api(`${AF}/${a.value.id}`, { method: 'DELETE' });
    toast.success('حُذف الأصل');
    router.push('/accounting/assets/register');
  } catch (e) {
    toast.error((e as Error).message);
  }
}

// ---------------- نقل العهدة ----------------
const moving = ref(false);
const mv = reactive({ kind: 'transfer' as 'transfer' | 'return', toEmployeeId: null as string | null, toLocation: '', date: todayStr(), condition: 'جيد', notes: '' });
const empOptions = computed(() => (lookups.value?.employees ?? []).filter((e) => e.status === 'active').map((e) => ({ id: e.id, label: e.fullName, sub: `رقم ${e.employeeNo}` })));
function openMove(kind: 'transfer' | 'return') {
  Object.assign(mv, { kind, toEmployeeId: null, toLocation: a.value?.location ?? '', date: todayStr(), condition: 'جيد', notes: '' });
  moving.value = true;
}
async function doMove() {
  if (!a.value) return;
  try {
    await api(`${AF}/${a.value.id}/custody`, { method: 'POST', json: { ...mv, toLocation: mv.toLocation || null, notes: mv.notes || null } });
    toast.success('صدر نموذج العهدة');
    moving.value = false;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function confirmForm(id: string) {
  try {
    await api(`${AF}/custody/forms/${id}/confirm`, { method: 'POST' });
    toast.success('تم تأكيد الاستلام');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div v-if="a">
    <section class="pm-hero ac-hero fa-hero">
      <div class="hero-in">
        <div class="pic">
          <img v-if="img" :src="img" alt="صورة الأصل" />
          <span v-else>🏷️</span>
        </div>
        <div>
          <p class="pm-kicker">{{ a.groupName }} · <span class="ac-code">{{ a.code }}</span></p>
          <h1>{{ a.name }}</h1>
          <p class="pm-sub"><span class="pm-pill" :style="{ '--c': STATUS_COLOR[a.status] }">{{ a.statusLabel }}</span>
            <template v-if="a.custodianName"> · في عهدة <b>{{ a.custodianName }}</b></template><template v-if="a.location"> · {{ a.location }}</template></p>
        </div>
      </div>
      <div class="pm-actions">
        <button v-if="session.can(P.assetsManage) && held" class="btn ac-glow" @click="editing = true">تعديل</button>
        <RouterLink v-if="session.can(P.assetsOperate) && held" :to="`/accounting/assets/operations?assetId=${a.id}`" class="btn ac-ghost">عملية على الأصل</RouterLink>
        <RouterLink :to="{ path: '/accounting/assets/labels', query: { ids: a.id } }" class="btn ac-ghost">ملصق QR</RouterLink>
        <RouterLink v-if="session.can(P.reports)" :to="{ path: '/accounting/reports', query: { r: 'accounting.assets.card', f_assetId: a.id } }" class="btn ac-ghost">بطاقة الأصل</RouterLink>
      </div>
    </section>

    <div v-for="(al, i) in a.alerts" :key="i" :class="['ac-warn', { pulse: al.expired }]"><b>{{ al.label }}</b>&nbsp;{{ al.expired ? 'انتهى في' : 'ينتهي في' }} {{ al.date }}</div>

    <div v-if="a.status === 'construction'" class="wip-box">
      <div><b>🏗️ أصل تحت التنفيذ</b><p>دفعات معتمدة {{ sar(a.wip.total) }}<template v-if="a.wip.pending"> · تنتظر الاعتماد {{ sar(a.wip.pending) }}</template> · عدد الدفعات {{ a.wip.count }}.
        لا يُهلك الأصل حتى رسملته، ويظهر رصيده في حساب المشروعات تحت التنفيذ.</p></div>
      <div v-if="session.can(P.assetsOperate)" class="fa-row">
        <RouterLink :to="`/accounting/assets/operations?assetId=${a.id}&op=wip`" class="btn btn-sm">دفعة جديدة</RouterLink>
        <RouterLink :to="`/accounting/assets/operations?assetId=${a.id}&op=capitalize`" class="btn btn-sm btn-primary">رسملة الأصل عند اكتماله</RouterLink>
      </div>
    </div>

    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #0ea5e9; --i: 0"><span>التكلفة</span><strong>{{ sar(a.cost) }}</strong><small>{{ a.inServiceDate ? `في الخدمة من ${a.inServiceDate}` : 'لم يدخل الدفاتر' }}</small></div>
      <div class="pm-kpi" style="--a: #f59e0b; --i: 1"><span>مجمع الإهلاك</span><strong>{{ sar(a.accum) }}</strong><small>{{ consumed }}% من التكلفة · حتى {{ a.depreciatedThrough ?? '—' }}</small></div>
      <div class="pm-kpi" style="--a: #10b981; --i: 2"><span>صافي القيمة الدفترية</span><strong>{{ sar(a.nbv) }}</strong><small>القيمة التخريدية {{ sar(a.salvageValue) }}</small></div>
      <div class="pm-kpi" style="--a: #8b5cf6; --i: 3"><span>الإهلاك</span><strong>{{ a.effective.methodLabel }}</strong><small>{{ a.effective.rate ? `${a.effective.rate}%` : '' }}{{ a.effective.lifeYears ? ` · ${a.effective.lifeYears} سنة` : '' }} · نحو {{ sar(a.effective.monthlyApprox) }} شهريًا</small></div>
    </div>
    <div class="life"><i :style="{ width: consumed + '%' }" /></div>

    <div class="fa-grid2">
      <section class="card pm-panel">
        <h2>بيانات الأصل</h2>
        <dl class="fa-dl">
          <dt>المجموعة</dt><dd>{{ a.group.name }} <span class="ac-code">{{ a.group.code }}</span></dd>
          <dt>الرقم التسلسلي</dt><dd class="ac-code">{{ a.serialNumber ?? '—' }}</dd>
          <dt>الإدارة المسؤولة</dt><dd>{{ a.unitName ?? '—' }}</dd>
          <dt>الموظف المسؤول</dt><dd>{{ a.custodianName ?? '—' }}<template v-if="a.custodianNo"> (رقم {{ a.custodianNo }})</template></dd>
          <dt>الموقع</dt><dd>{{ a.location ?? '—' }}</dd>
          <template v-for="f in fieldRows" :key="f.key"><dt>{{ f.label }}</dt><dd>{{ f.value ?? '—' }}</dd></template>
          <dt>سُجل بواسطة</dt><dd>{{ a.createdByName }} · {{ dt(a.createdAt) }}</dd>
        </dl>
        <p v-if="a.description" class="fa-sub" style="margin-top: 10px">{{ a.description }}</p>
        <div v-if="session.can(P.assetsManage) && held" class="fa-row" style="margin-top: 12px">
          <input ref="fileInput" type="file" accept="image/*" hidden @change="upload" />
          <button class="btn btn-sm" @click="fileInput?.click()">{{ img ? 'تغيير الصورة' : 'إضافة صورة (اختيارية)' }}</button>
          <button v-if="img" class="btn btn-sm" @click="removeImage">حذف الصورة</button>
          <button v-if="a.status === 'draft' && !a.moves.length" class="btn btn-sm btn-danger" @click="remove">حذف الأصل</button>
        </div>
      </section>
      <section class="card pm-panel">
        <h2>عقود الصيانة</h2>
        <p v-if="!a.maintenance.length" class="pm-empty">لا توجد عقود صيانة</p>
        <div v-for="m in a.maintenance" :key="m.id ?? m.provider" class="fa-grow">
          <span class="grow"><b>{{ m.provider }}</b><small class="pm-muted">من {{ m.startDate }} إلى {{ m.endDate }}{{ m.notes ? ` · ${m.notes}` : '' }}</small></span>
          <span class="ac-num">{{ m.cost !== null ? sar(m.cost) : '' }}</span>
        </div>
      </section>
    </div>

    <div class="fa-grid3">
      <section class="card pm-panel">
        <h2>🛡️ التأمين</h2>
        <template v-if="a.insurance">
          <dl class="fa-dl">
            <dt>شركة التأمين</dt><dd>{{ a.insurance.provider }}</dd>
            <dt>رقم الوثيقة</dt><dd class="ac-code">{{ a.insurance.policyNo ?? '—' }}</dd>
            <dt>المدة</dt><dd>{{ a.insurance.startDate }} ← {{ a.insurance.endDate }}</dd>
            <dt v-if="a.insurance.coverage !== null">مبلغ التغطية</dt><dd v-if="a.insurance.coverage !== null">{{ sar(a.insurance.coverage) }}</dd>
            <dt v-if="a.insurance.cost !== null">القسط</dt><dd v-if="a.insurance.cost !== null">{{ sar(a.insurance.cost) }}</dd>
          </dl>
          <p :class="['due', { late: daysTo(a.insurance.endDate) < 0 }]">{{ daysTo(a.insurance.endDate) < 0 ? 'انتهت الوثيقة' : `متبقٍ ${daysTo(a.insurance.endDate)} يومًا` }}</p>
        </template>
        <p v-else-if="a.insuranceRequired" class="ac-warn">الأصل يلزمه تأمين ولم تُسجل وثيقته بعد</p>
        <p v-else class="pm-empty">لا يلزم الأصل تأمين</p>
      </section>
      <section class="card pm-panel">
        <h2>🧾 الضمان</h2>
        <template v-if="a.warranty">
          <dl class="fa-dl">
            <dt>الضامن</dt><dd>{{ a.warranty.provider }}</dd>
            <dt>المدة</dt><dd>{{ a.warranty.startDate ?? '—' }} ← {{ a.warranty.endDate }}</dd>
            <template v-if="a.warranty.notes"><dt>ملاحظات</dt><dd>{{ a.warranty.notes }}</dd></template>
          </dl>
          <p :class="['due', { late: daysTo(a.warranty.endDate) < 0 }]">{{ daysTo(a.warranty.endDate) < 0 ? 'انتهى الضمان' : `متبقٍ ${daysTo(a.warranty.endDate)} يومًا` }}</p>
        </template>
        <p v-else-if="a.warrantyRequired" class="ac-warn">الأصل يلزمه ضمان ولم تُسجل بياناته بعد</p>
        <p v-else class="pm-empty">لا يلزم الأصل ضمان</p>
      </section>
      <section class="card pm-panel">
        <h2>🛠️ خطة الصيانة الدورية</h2>
        <template v-if="a.maintenancePlan">
          <dl class="fa-dl">
            <dt>كل</dt><dd>{{ a.maintenancePlan.intervalMonths }} شهر</dd>
            <dt>الموعد القادم</dt><dd>{{ a.maintenancePlan.nextDate }}</dd>
            <template v-if="a.maintenancePlan.notes"><dt>ما يلزم</dt><dd>{{ a.maintenancePlan.notes }}</dd></template>
          </dl>
          <p :class="['due', { late: daysTo(a.maintenancePlan.nextDate) < 0 }]">{{ daysTo(a.maintenancePlan.nextDate) < 0 ? `متأخرة ${-daysTo(a.maintenancePlan.nextDate)} يومًا` : `بعد ${daysTo(a.maintenancePlan.nextDate)} يومًا` }}</p>
        </template>
        <p v-else class="pm-empty">لا توجد خطة صيانة دورية. يمكن إضافتها من «تعديل».</p>
        <p class="fa-sub">سجل الصيانة: {{ a.maintenanceLog.length }} عملية، منها {{ repairs }} إصلاح، بتكلفة {{ sar(maintTotal) }}</p>
      </section>
    </div>

    <div class="pm-tabs" style="margin-top: 16px">
      <button :class="['pm-tab', { on: tab === 'moves' }]" @click="tab = 'moves'">الحركات <b>{{ a.moves.length }}</b></button>
      <button :class="['pm-tab', { on: tab === 'dep' }]" @click="tab = 'dep'">سجل الإهلاك <b>{{ a.depreciation.filter((d) => d.active).length }}</b></button>
      <button :class="['pm-tab', { on: tab === 'custody' }]" @click="tab = 'custody'">العهدة والنقل <b>{{ a.custody.length }}</b></button>
      <button :class="['pm-tab', { on: tab === 'maint' }]" @click="tab = 'maint'">الصيانة <b>{{ a.maintenanceLog.length }}</b></button>
    </div>

    <section v-if="tab === 'moves'" class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>رقم</th><th>العملية</th><th>التاريخ</th><th>القيمة</th><th>مجمع الإهلاك</th><th>المتحصل / الربح</th><th>السند والقيد</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="m in a.moves" :key="m.id" :class="{ voided: m.status === 'cancelled' }">
              <td class="ac-code">{{ m.moveNo }}</td><td><b>{{ m.kindLabel }}</b><span v-if="m.partyName" class="pm-muted">{{ m.partyName }}</span><span v-if="m.notes" class="pm-muted">{{ m.notes }}</span><span v-if="m.fundedAmount" class="pm-muted">ممول من {{ m.fundingName }}: {{ sar(m.fundedAmount) }}</span></td>
              <td>{{ m.date }}</td><td class="ac-num">{{ sar(m.amount) }}</td><td class="ac-num">{{ m.accumDelta ? sar(m.accumDelta) : '' }}</td>
              <td class="ac-num"><template v-if="m.proceeds">{{ sar(m.proceeds) }}<span :class="m.gainLoss >= 0 ? 'fa-money-pos' : 'fa-money-neg'">{{ m.gainLoss >= 0 ? 'ربح' : 'خسارة' }} {{ sar(Math.abs(m.gainLoss)) }}</span></template><template v-else-if="m.gainLoss">{{ sar(m.gainLoss) }}</template></td>
              <td>
                <RouterLink v-if="m.voucher" :to="`/accounting/vouchers/${m.voucher.id}`" class="pm-link">سند {{ m.voucher.kind === 'receipt' ? 'قبض' : 'صرف' }} {{ m.voucher.serial }}</RouterLink>
                <RouterLink v-if="m.entry" :to="`/accounting/entries/${m.entry.id}`" class="pm-link">القيد {{ m.entry.entryNo }}</RouterLink>
              </td>
              <td><span class="pm-tag">{{ m.status === 'done' ? 'منفذة' : m.status === 'pending' ? 'تنتظر اعتماد السند' : 'ملغاة' }}</span><span v-if="m.cancelReason" class="pm-muted">{{ m.cancelReason }}</span></td>
            </tr>
            <tr v-if="!a.moves.length"><td colspan="8" class="pm-empty">لم يدخل الأصل الدفاتر بعد: سجل له رصيدًا افتتاحيًا، أو شراءً، أو تبرعًا عينيًا</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="tab === 'dep'" class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الحركة</th><th>الفترة</th><th>من</th><th>إلى</th><th>المجمع قبل</th><th>الإهلاك</th><th>المجمع بعد</th><th>القيد</th></tr></thead>
          <tbody>
            <tr v-for="d in a.depreciation" :key="d.id" :class="{ voided: !d.active }">
              <td><RouterLink :to="`/accounting/assets/runs/${d.runId}`" class="pm-link ac-code">{{ d.runNo }}</RouterLink><span v-if="d.kind === 'disposal'" class="pm-tag">جزئي للاستبعاد</span></td>
              <td>{{ d.period }}</td><td>{{ d.from }}</td><td>{{ d.to }}</td><td class="ac-num">{{ sar(d.accumBefore) }}</td><td class="ac-num"><b>{{ sar(d.amount) }}</b></td>
              <td class="ac-num">{{ sar(d.accumBefore + d.amount) }}</td>
              <td><RouterLink v-if="d.entryId" :to="`/accounting/entries/${d.entryId}`" class="pm-link">{{ d.entryNo }}</RouterLink><span v-if="!d.active" class="pm-tag">ملغاة</span></td>
            </tr>
            <tr v-if="!a.depreciation.length"><td colspan="8" class="pm-empty">لم يُحتسب إهلاك لهذا الأصل بعد</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="tab === 'custody'" class="card pm-panel">
      <div v-if="held && session.can(P.assetsCustody)" class="fa-row" style="margin-bottom: 12px">
        <button class="btn btn-sm btn-primary" @click="openMove('transfer')">{{ a.custodianId ? 'نقل العهدة لموظف آخر أو موقع آخر' : 'تسليم الأصل لموظف' }}</button>
        <button v-if="a.custodianId" class="btn btn-sm" @click="openMove('return')">إرجاع للمستودع (استلام نيابة عن الجمعية)</button>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>النموذج</th><th>النوع</th><th>التاريخ</th><th>من</th><th>إلى</th><th>الحالة عند الاستلام</th><th>تأكيد الاستلام</th><th></th></tr></thead>
          <tbody>
            <tr v-for="c in a.custody" :key="c.id">
              <td class="ac-code">{{ c.formNo }}</td><td>{{ c.kindLabel }}</td><td>{{ c.date }}</td>
              <td>{{ c.fromName ?? '—' }}<span class="pm-muted">{{ c.fromLocation }}</span></td><td>{{ c.toName ?? '—' }}<span class="pm-muted">{{ c.toLocation }}</span></td>
              <td>{{ c.condition ?? '' }}</td>
              <td><span v-if="c.confirmedAt" class="pm-ok">✓ {{ c.confirmedByName }}</span><button v-else-if="c.toEmployeeId" class="btn btn-sm" @click="confirmForm(c.id)">تأكيد الاستلام</button></td>
              <td><RouterLink :to="`/accounting/assets/custody/forms/${c.id}`" class="pm-link">طباعة</RouterLink></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="tab === 'maint'" class="card pm-panel">
      <div v-if="held && session.can(P.assetsMaintain)" class="fa-row" style="margin-bottom: 12px">
        <button class="btn btn-sm btn-primary" @click="recording = true">تسجيل صيانة</button>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>رقم</th><th>التاريخ</th><th>النوع</th><th>الوصف</th><th>الجهة المنفذة</th><th>التكلفة</th><th>التوقف</th><th>السند</th><th></th></tr></thead>
          <tbody>
            <tr v-for="m in a.maintenanceLog" :key="m.id">
              <td class="ac-code">{{ m.recordNo }}</td><td>{{ m.date }}</td>
              <td><span class="pm-pill" :style="{ '--c': m.kind === 'repair' ? '#dc2626' : '#0ea5e9' }">{{ m.kindLabel }}</span></td>
              <td>{{ m.description }}<span v-if="m.notes" class="pm-muted">{{ m.notes }}</span></td><td>{{ m.vendor ?? '—' }}</td>
              <td class="ac-num">{{ sar(m.cost) }}</td><td>{{ m.downtimeDays ? `${m.downtimeDays} يوم` : '' }}</td>
              <td><RouterLink v-if="m.voucher" :to="`/accounting/vouchers/${m.voucher.id}`" class="pm-link">سند صرف {{ m.voucher.serial }}</RouterLink></td>
              <td><button v-if="session.can(P.assetsMaintain) && (!m.voucher || ['cancelled', 'rejected'].includes(m.voucher.status))" class="btn btn-sm" @click="removeMaint(m.id)">حذف</button></td>
            </tr>
            <tr v-if="!a.maintenanceLog.length"><td colspan="9" class="pm-empty">لم تُسجل صيانة لهذا الأصل</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <MaintenanceForm v-if="recording" :asset-id="a.id" :asset-label="`${a.code} ${a.name}`" @saved="maintSaved" @close="recording = false" />
    <AssetForm v-if="editing" :asset="a" @saved="saved" @close="editing = false" />

    <div v-if="moving" class="modal-backdrop" @click.self="moving = false">
      <form class="card modal" @submit.prevent="doMove">
        <h2>{{ mv.kind === 'return' ? 'إرجاع الأصل' : a.custodianId ? 'نقل العهدة' : 'تسليم الأصل' }}</h2>
        <p class="fa-sub">يصدر نموذج {{ mv.kind === 'return' ? 'إرجاع' : 'استلام' }} برقم مسلسل، ويبقى في سجل الأصل. {{ a.custodianName ? `الحالي: ${a.custodianName}` : '' }}</p>
        <label class="field"><span>{{ mv.kind === 'return' ? 'الموظف المستلم نيابة عن الجمعية (أمين المستودع)' : 'الموظف المستلم' }}</span><SearchSelect v-model="mv.toEmployeeId" :options="empOptions" placeholder="ابحث باسم الموظف" required /></label>
        <div class="field-row">
          <label class="field"><span>الموقع الجديد</span><input v-model="mv.toLocation" class="input" /></label>
          <label class="field"><span>التاريخ</span><input v-model="mv.date" type="date" class="input" :max="todayStr()" required /></label>
          <label class="field"><span>حالة الأصل</span><select v-model="mv.condition" class="input"><option v-for="c in CONDITIONS" :key="c">{{ c }}</option></select></label>
        </div>
        <label class="field"><span>ملاحظات</span><input v-model="mv.notes" class="input" /></label>
        <div class="modal-actions"><button class="btn btn-primary">إصدار النموذج</button><button type="button" class="btn" @click="moving = false">إلغاء</button></div>
      </form>
    </div>
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
</template>

<style scoped>
.hero-in { display: flex; gap: 16px; align-items: center; }
.pic { width: 88px; height: 88px; border-radius: 18px; overflow: hidden; background: rgba(255,255,255,.1); display: grid; place-items: center; font-size: 2.2rem; flex: 0 0 88px;
  border: 1px solid rgba(255,255,255,.2); box-shadow: 0 0 24px rgba(56,189,248,.25); }
.pic img { width: 100%; height: 100%; object-fit: cover; }
.life { height: 8px; border-radius: 99px; background: linear-gradient(90deg, #d1fae5, #fef3c7); margin: -6px 0 16px; overflow: hidden; }
.life i { display: block; height: 100%; background: linear-gradient(90deg, #f59e0b, #ef4444); animation: fa-growx 1s var(--ease) both; transform-origin: right; }
td .pm-muted, td .pm-link, td span.fa-money-pos, td span.fa-money-neg { display: block; }
.voided td { color: var(--muted); text-decoration: line-through; }
.fa-grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-top: 16px; }
.due { margin: 10px 0 0; font-weight: 700; color: #047857; }
.due.late { color: #b91c1c; }
.wip-box { display: flex; gap: 16px; align-items: center; justify-content: space-between; flex-wrap: wrap; border-radius: 16px; padding: 14px 18px; margin-bottom: 16px;
  background: linear-gradient(135deg, #fffbeb, #fef3c7); border: 1px solid #fcd34d; color: #78350f; }
.wip-box p { margin: 4px 0 0; font-size: .9rem; }
</style>
