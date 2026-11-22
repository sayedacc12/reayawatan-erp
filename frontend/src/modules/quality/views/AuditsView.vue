<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { ISO_CLAUSES, P, STATUS_COLOR, errMsg, fmtDate, loadSettings, thisYear, todayStr, type QSettings } from '../lib';
import '../../../shared/module.css';
import '../quality.css';

interface Audit {
  id: string; code: string; title: string; scope: string; department: string; departmentName: string; clauses: string[]; leadAuditor: string; auditeeName: string | null;
  plannedDate: string; actualDate: string | null; status: string; statusLabel: string; overdue: boolean; questions: number; answered: number;
  findings: { conform: number; minor: number; major: number; observation: number; ofi: number };
}
const session = useSession();
const toast = useToast();
const router = useRouter();
const year = ref(thisYear());
const audits = ref<Audit[]>([]);
const settings = ref<QSettings | null>(null);
async function load() {
  audits.value = await api<Audit[]>(`/quality/audits?year=${year.value}`);
}
onMounted(async () => {
  settings.value = await loadSettings();
  await load();
});
watch(year, load);
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const done = computed(() => audits.value.filter((a) => a.status === 'completed').length);
const active = computed(() => audits.value.filter((a) => a.status !== 'cancelled').length);
const form = reactive({ show: false, title: '', scope: '', department: 'QMS', clauses: [] as string[], leadAuditor: session.user?.fullName ?? '', auditors: '', auditeeName: '', plannedDate: todayStr() });
function toggle(c: string) {
  const i = form.clauses.indexOf(c);
  if (i >= 0) form.clauses.splice(i, 1);
  else form.clauses.push(c);
}
async function create() {
  try {
    const a = await api<{ id: string }>('/quality/audits', {
      method: 'POST', json: { ...form, show: undefined, auditors: form.auditors || null, auditeeName: form.auditeeName || null, checklist: form.clauses.map((c) => ({ clause: c, question: `هل متطلبات البند ${c} مطبقة في ${form.scope}؟` })) },
    });
    toast.success('أُضيفت المراجعة للبرنامج، أكمل قائمة التحقق');
    router.push(`/quality/audits/${a.id}`);
  } catch (e) {
    toast.error(errMsg(e));
  }
}
</script>

<template>
  <div>
    <section class="pm-hero q-hero">
      <div><p class="pm-kicker">البند 9.2</p><h1>برنامج المراجعة الداخلية</h1>
        <p class="pm-sub">خطة المراجعات السنوية وقوائم التحقق ونتائجها. عند إنهاء المراجعة يُصدر النظام حالة عدم مطابقة لكل نتيجة غير مطابقة تلقائيًا.</p></div>
      <div class="pm-actions">
        <select v-model.number="year" class="input" style="width: auto"><option v-for="y in [thisYear() + 1, thisYear(), thisYear() - 1, thisYear() - 2]" :key="y" :value="y">{{ y }}</option></select>
        <button v-if="session.can(P.audits)" class="btn q-glow" @click="form.show = true">مراجعة جديدة</button>
      </div>
    </section>
    <div class="pm-kpis">
      <div class="pm-kpi" style="--a: #6366f1"><span>المراجعات المخططة</span><strong>{{ active }}</strong></div>
      <div class="pm-kpi" style="--a: #10b981"><span>المنفذة</span><strong>{{ done }}</strong><small>{{ active ? Math.round((done / active) * 100) : 0 }}% من البرنامج</small></div>
      <div class="pm-kpi" style="--a: #ef4444"><span>عدم مطابقة (جسيمة / بسيطة)</span><strong>{{ audits.reduce((s, a) => s + a.findings.major, 0) }} / {{ audits.reduce((s, a) => s + a.findings.minor, 0) }}</strong></div>
      <div class="pm-kpi" style="--a: #0ea5e9"><span>ملاحظات وفرص تحسين</span><strong>{{ audits.reduce((s, a) => s + a.findings.observation + a.findings.ofi, 0) }}</strong></div>
    </div>
    <section class="card pm-panel">
      <h2>الجدول الزمني {{ year }}</h2>
      <div style="display: grid; grid-template-columns: repeat(12, 1fr); gap: 4px; margin-bottom: 16px">
        <div v-for="(m, i) in MONTHS" :key="m" style="text-align: center">
          <div class="pm-muted" style="font-size: .7rem">{{ m }}</div>
          <div style="min-height: 34px; border-radius: 8px; background: var(--surface-2); display: grid; gap: 2px; padding: 3px">
            <RouterLink v-for="a in audits.filter((x) => Number(x.plannedDate.slice(5, 7)) === i + 1)" :key="a.id" :to="`/quality/audits/${a.id}`" :title="a.title"
              :style="{ height: '8px', borderRadius: '4px', background: a.overdue ? '#ef4444' : STATUS_COLOR[a.status] }" />
          </div>
        </div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الرقم</th><th>المراجعة</th><th>الإدارة</th><th>البنود</th><th>الموعد</th><th>رئيس الفريق</th><th>النتائج</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="a in audits" :key="a.id" class="q-row" @click="router.push(`/quality/audits/${a.id}`)">
              <td><span class="q-code">{{ a.code }}</span></td>
              <td><b>{{ a.title }}</b><span class="pm-muted">{{ a.scope }}</span></td>
              <td><span class="pm-tag">{{ a.department }}</span></td>
              <td><span v-for="c in a.clauses" :key="c" class="pm-tag" style="margin-inline-end: 3px">{{ c }}</span></td>
              <td class="q-num">{{ fmtDate(a.plannedDate) }}<span v-if="a.overdue" class="pm-muted" style="color: var(--danger)">متأخرة</span></td>
              <td>{{ a.leadAuditor }}</td>
              <td class="q-num">{{ a.answered }}/{{ a.questions }}<span class="pm-muted"><template v-if="a.findings.major">جسيمة {{ a.findings.major }} · </template><template v-if="a.findings.minor">بسيطة {{ a.findings.minor }}</template></span></td>
              <td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[a.status] }">{{ a.statusLabel }}</span></td>
            </tr>
            <tr v-if="!audits.length"><td colspan="8" class="pm-empty">لا توجد مراجعات في هذا العام</td></tr>
          </tbody>
        </table>
      </div>
    </section>
    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" style="max-width: 640px" @submit.prevent="create">
        <h2>إضافة مراجعة للبرنامج</h2>
        <label class="field"><span>العنوان</span><input v-model="form.title" class="input" required placeholder="مثال: مراجعة عملية طلبات المستفيدين" /></label>
        <div class="pm-grid2">
          <label class="field"><span>العملية محل المراجعة</span><input v-model="form.scope" class="input" required /></label>
          <label class="field"><span>الإدارة</span><select v-model="form.department" class="input"><option v-for="d in settings?.departments" :key="d.code" :value="d.code">{{ d.code }} · {{ d.name }}</option></select></label>
          <label class="field"><span>رئيس فريق المراجعة</span><input v-model="form.leadAuditor" class="input" required /></label>
          <label class="field"><span>أعضاء الفريق</span><input v-model="form.auditors" class="input" /></label>
          <label class="field"><span>ممثل الإدارة محل المراجعة</span><input v-model="form.auditeeName" class="input" /></label>
          <label class="field"><span>الموعد</span><input v-model="form.plannedDate" type="date" class="input" required /></label>
        </div>
        <div class="field"><span>البنود المشمولة (يُنشأ لكل بند سؤال تحقق يمكنك تعديله)</span>
          <div class="q-chips"><button v-for="c in ISO_CLAUSES" :key="c" type="button" :class="['q-chip', { on: form.clauses.includes(c) }]" @click="toggle(c)">{{ c }}</button></div>
        </div>
        <p class="pm-muted">شرط الحياد: لا يراجع المراجع عمل إدارته.</p>
        <div class="modal-actions"><button class="btn btn-primary">إضافة</button><button type="button" class="btn" @click="form.show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
