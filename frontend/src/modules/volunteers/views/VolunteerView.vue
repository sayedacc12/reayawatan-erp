<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import CountUp from '../../beneficiaries/components/CountUp.vue';
import StatusPill from '../components/StatusPill.vue';
import VolunteerForm from '../components/VolunteerForm.vue';
import { CONTRACT_STATUS, KIND_LABEL, P, PART_STATUS, addDays, fmtDate, loadLookups, lookups, num, todayStr, type FormField } from '../lib';
import '../../projects/projects.css';
import '../volunteers.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const v = ref<any>(null);
const error = ref('');
const editing = ref(false);
async function load() {
  try {
    v.value = await api(`/volunteers/volunteers/${props.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await loadLookups().catch(() => null);
  await load();
});
const answerText = (f: FormField) => {
  const a = v.value.answers?.[f.key];
  if (a === undefined || a === null || a === '') return '—';
  if (f.type === 'checkbox') return a ? 'نعم' : 'لا';
  if (f.type === 'date') return fmtDate(a);
  return String(a);
};
async function setStatus(status: 'active' | 'inactive' | 'rejected') {
  let note: string | null = null;
  if (status !== 'active') {
    note = prompt(status === 'rejected' ? 'سبب رفض طلب التسجيل' : 'سبب إيقاف المتطوع');
    if (!note) return;
  }
  try {
    v.value = await api(`/volunteers/volunteers/${props.id}/status`, { method: 'POST', json: { status, note } });
    toast.success(status === 'active' ? 'المتطوع نشط الآن' : 'حُدّثت حالة المتطوع');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove() {
  if (!confirm('حذف المتطوع نهائيًا؟')) return;
  try {
    await api(`/volunteers/volunteers/${props.id}`, { method: 'DELETE' });
    toast.success('حُذف المتطوع');
    history.back();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function saved() {
  editing.value = false;
  toast.success('حُفظت بيانات المتطوع');
  load();
}

// شهادة أو عقد من ملف المتطوع
const cert = reactive({ show: false, kind: 'hours' as 'hours' | 'thanks', eventId: '', periodFrom: '', periodTo: '' });
const attendedEvents = computed(() => (v.value?.events ?? []).filter((e: any) => e.status === 'attended'));
async function issueCert() {
  try {
    const c = await api<{ id: string }>('/volunteers/certificates', {
      method: 'POST', json: { volunteerId: props.id, kind: cert.kind, eventId: cert.eventId || null, periodFrom: cert.eventId ? null : cert.periodFrom || null, periodTo: cert.eventId ? null : cert.periodTo || null },
    });
    cert.show = false;
    toast.success('صدرت الشهادة');
    window.open(`/volunteers/certificates/${c.id}`, '_blank');
    load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const contract = reactive({ show: false, startDate: todayStr(), endDate: addDays(todayStr(), 364) });
async function issueContract() {
  try {
    await api('/volunteers/contracts', { method: 'POST', json: { volunteerId: props.id, startDate: contract.startDate, endDate: contract.endDate } });
    contract.show = false;
    toast.success('صدر عقد التطوع، وانسخ رابط التوقيع من قائمة العقود');
    load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div v-if="v">
    <section class="pm-hero vt-hero">
      <div><p class="pm-kicker">متطوع رقم {{ v.volunteerNo }} · {{ v.source === 'public' ? 'تسجيل ذاتي' : `سجّله ${v.createdByName ?? 'موظف'}` }}</p>
        <h1>{{ v.fullName }}</h1>
        <p class="pm-sub">{{ v.typeName ?? 'نوع التطوع غير محدد' }}{{ v.fields.length ? ` · ${v.fields.join('، ')}` : '' }}</p></div>
      <div class="pm-actions">
        <StatusPill :status="v.status" :label="v.statusLabel" style="background: rgba(255,255,255,.9)" />
        <template v-if="session.can(P.volunteers)">
          <button v-if="v.status !== 'active'" class="btn vt-glow" @click="setStatus('active')">{{ v.status === 'pending' ? 'قبول المتطوع' : 'إعادة التفعيل' }}</button>
          <button v-if="v.status === 'pending'" class="btn vt-ghost" @click="setStatus('rejected')">رفض الطلب</button>
          <button v-if="v.status === 'active'" class="btn vt-ghost" @click="setStatus('inactive')">إيقاف</button>
          <button class="btn vt-ghost" @click="editing = true">تعديل البيانات</button>
        </template>
      </div>
    </section>
    <div v-if="v.statusNote" class="alert alert-error">{{ v.statusLabel }}: {{ v.statusNote }}</div>
    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #facc15; --i: 0"><span>ساعات التطوع المعتمدة</span><strong><CountUp :value="v.totals.hours" /></strong><small>من الحضور الفعلي</small></div>
      <div class="pm-kpi" style="--a: #10b981; --i: 1"><span>فعاليات شارك فيها</span><strong><CountUp :value="v.totals.events" /></strong><small>من {{ v.events.length }} ترشيح</small></div>
      <div class="pm-kpi" style="--a: #6366f1; --i: 2"><span>الشهادات</span><strong><CountUp :value="v.certificates.length" /></strong><small>ساعات وشكر</small></div>
      <div class="pm-kpi" style="--a: #0ea5e9; --i: 3"><span>تاريخ الانضمام</span><strong style="font-size: 1.05rem">{{ fmtDate(v.joinedOn) }}</strong><small>&nbsp;</small></div>
    </div>
    <div class="vt-grid">
      <section class="card pm-panel">
        <h2>الفعاليات والساعات</h2>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>الفعالية</th><th>الدور</th><th>الحضور</th><th>الساعات</th><th>تقييم المشرف</th></tr></thead>
            <tbody>
              <tr v-for="e in v.events" :key="e.id" class="vt-row" @click="$router.push(`/volunteers/events/${e.eventId}`)">
                <td class="vt-wrap"><b>{{ e.title }}</b><span class="pm-muted" style="display: block">{{ e.eventNo }} · {{ KIND_LABEL[e.kind] }} · {{ fmtDate(e.startDate) }}</span></td>
                <td>{{ e.role ?? '—' }}</td>
                <td><StatusPill :status="e.status" :label="PART_STATUS[e.status]" /></td>
                <td class="vt-num">{{ num(e.hours) }}</td>
                <td><span v-if="e.rating" class="vt-stars">{{ '★'.repeat(e.rating) }}{{ '☆'.repeat(5 - e.rating) }}</span><span v-else>—</span></td>
              </tr>
              <tr v-if="!v.events.length"><td colspan="5" class="pm-empty">لم يُرشح لأي فعالية بعد</td></tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="card pm-panel">
        <h2>البيانات</h2>
        <dl class="pm-dl">
          <div><dt>رقم الهوية</dt><dd class="vt-code">{{ v.nationalId }}</dd></div>
          <div><dt>الجوال</dt><dd class="vt-code">{{ v.mobile }}</dd></div>
          <div><dt>البريد</dt><dd class="vt-code">{{ v.email ?? '—' }}</dd></div>
          <div><dt>الجنس</dt><dd>{{ v.gender === 'female' ? 'أنثى' : 'ذكر' }}</dd></div>
          <div><dt>تاريخ الميلاد</dt><dd>{{ fmtDate(v.birthDate) }}</dd></div>
          <div><dt>المدينة</dt><dd>{{ v.city ?? '—' }}</dd></div>
          <div><dt>المؤهل</dt><dd>{{ v.qualification ?? '—' }}</dd></div>
          <div><dt>أوقات الإتاحة</dt><dd>{{ v.availability.join('، ') || '—' }}</dd></div>
          <div><dt>المهارات</dt><dd>{{ v.skills ?? '—' }}</dd></div>
          <div v-for="f in v.registrationFields" :key="f.key"><dt>{{ f.label }}</dt><dd>{{ answerText(f) }}</dd></div>
        </dl>
        <button v-if="session.can(P.volunteers) && !v.events.length && !v.certificates.length && !v.contracts.length" class="btn btn-sm btn-danger" style="margin-top: 12px" @click="remove">حذف المتطوع</button>
      </section>
      <section class="card pm-panel">
        <h2>الشهادات <button v-if="session.can(P.certificates) && ['active', 'inactive'].includes(v.status)" class="btn btn-sm btn-primary" @click="cert.show = true">إصدار شهادة</button></h2>
        <p v-if="!v.certificates.length" class="vt-empty">لا توجد شهادات</p>
        <div v-for="c in v.certificates" :key="c.id" class="vt-chip" style="display: flex; margin-bottom: 6px; border-radius: 10px; padding: 6px 10px">
          <RouterLink :to="`/volunteers/certificates/${c.id}`" class="pm-link">{{ c.title }}</RouterLink>
          <span class="pm-muted">{{ c.certificateNo }} · {{ fmtDate(c.issuedOn) }}{{ c.kind === 'hours' ? ` · ${num(c.hours)} ساعة` : '' }}</span>
          <span v-if="c.isRevoked" class="pm-pill" style="--c: #ef4444">ملغاة</span>
        </div>
      </section>
      <section class="card pm-panel">
        <h2>عقود التطوع <button v-if="session.can(P.contracts) && v.status === 'active'" class="btn btn-sm btn-primary" @click="contract.show = true">إصدار عقد</button></h2>
        <p v-if="!v.contracts.length" class="vt-empty">لا توجد عقود</p>
        <div v-for="c in v.contracts" :key="c.id" class="vt-chip" style="display: flex; margin-bottom: 6px; border-radius: 10px; padding: 6px 10px">
          <RouterLink :to="`/volunteers/contracts/${c.id}`" class="pm-link">{{ c.contractNo }}</RouterLink>
          <span class="pm-muted">{{ fmtDate(c.startDate) }} إلى {{ fmtDate(c.endDate) }}</span>
          <StatusPill :status="c.status" :label="CONTRACT_STATUS[c.status]" />
        </div>
      </section>
    </div>

    <div v-if="editing && lookups" class="modal-backdrop" @click.self="editing = false">
      <div class="card modal modal-wide"><h2>تعديل بيانات المتطوع</h2><VolunteerForm :lookups="lookups" :initial="v" :id="v.id" @saved="saved" @cancel="editing = false" /></div>
    </div>
    <div v-if="cert.show" class="modal-backdrop" @click.self="cert.show = false">
      <form class="card modal" @submit.prevent="issueCert">
        <h2>إصدار شهادة للمتطوع</h2>
        <label class="field"><span>نوع الشهادة</span><select v-model="cert.kind" class="input"><option value="hours">شهادة ساعات تطوعية</option><option value="thanks">شهادة شكر وتقدير</option></select></label>
        <label class="field"><span>عن فعالية محددة</span>
          <select v-model="cert.eventId" class="input"><option value="">كل الفعاليات خلال فترة</option><option v-for="e in attendedEvents" :key="e.eventId" :value="e.eventId">{{ e.title }} ({{ num(e.hours) }} ساعة)</option></select>
        </label>
        <div v-if="!cert.eventId" class="pm-grid2">
          <label class="field"><span>من تاريخ</span><input v-model="cert.periodFrom" type="date" class="input" /></label>
          <label class="field"><span>إلى تاريخ</span><input v-model="cert.periodTo" type="date" class="input" /></label>
        </div>
        <p class="pm-muted">الساعات تُحسب تلقائيًا من الحضور المعتمد في الفعاليات، ونص الشهادة من قالبها في الإعدادات.</p>
        <div class="modal-actions"><button class="btn btn-primary">إصدار</button><button type="button" class="btn" @click="cert.show = false">إلغاء</button></div>
      </form>
    </div>
    <div v-if="contract.show" class="modal-backdrop" @click.self="contract.show = false">
      <form class="card modal" @submit.prevent="issueContract">
        <h2>إصدار عقد تطوع</h2>
        <div class="pm-grid2">
          <label class="field"><span>تاريخ البداية</span><input v-model="contract.startDate" type="date" class="input" required /></label>
          <label class="field"><span>تاريخ النهاية</span><input v-model="contract.endDate" type="date" class="input" required /></label>
        </div>
        <p class="pm-muted">يُنشأ العقد من الفقرات المفعّلة في الإعدادات وتُعبأ بيانات المتطوع تلقائيًا، ثم يوقّعه المتطوع إلكترونيًا من رابطه أو ورقيًا.</p>
        <div class="modal-actions"><button class="btn btn-primary">إصدار العقد</button><button type="button" class="btn" @click="contract.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
</template>
