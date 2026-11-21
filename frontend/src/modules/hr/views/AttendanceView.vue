<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import CountUp from '../../../shared/CountUp.vue';
import { P, fmtDate, monthLabel, todayStr } from '../lib';
import '../../../shared/module.css';
import '../hr.css';

/** الحضور والانصراف: ملخص الشهر لكل موظف، رفع ملفات البصمة، وتقويم الموظف مع الإدخال اليدوي */
interface Row {
  employeeId: string; employeeNo: number; fullName: string; unitName: string; code: string; exempt: boolean; tracked: boolean; workDays: number; presentDays: number;
  absentDays: number; leaveDays: number; lateMinutes: number; earlyMinutes: number; deductibleMinutes: number; missingOut: number;
}
interface Summary { month: string; config: { enabled: boolean; workStart: string; workEnd: string }; coverageEnd: string | null; punchCount: number; unknownCodes: { code: string; n: number }[]; rows: Row[] }
interface Imp { id: string; fileName: string; format: string; rows: number; added: number; duplicates: number; invalid: number; unknownCodes: string[]; dateFrom: string | null; dateTo: string | null; createdByName: string; createdAt: string }
interface Day {
  date: string; weekday: number; status: string; statusLabel: string; holiday: string | null; checkIn: string | null; checkOut: string | null; late: number; early: number; deductible: number; missingOut: boolean;
  punches: { id: string; time: string; source: string; sourceLabel: string; note: string | null }[];
}
interface EmpMonth { employee: { id: string; fullName: string; employeeNo: number; code: string; exempt: boolean }; tracked: boolean; coverageEnd: string | null; totals: Omit<Row, 'employeeId' | 'employeeNo' | 'fullName' | 'unitName' | 'code' | 'exempt' | 'tracked'>; days: Day[] }

const session = useSession();
const toast = useToast();
const month = ref(todayStr().slice(0, 7));
const data = ref<Summary | null>(null);
const imports = ref<Imp[]>([]);
const q = ref('');
const busy = ref(false);
const over = ref(false);
const lastImport = ref<Imp | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const canManage = computed(() => session.can(P.attendance));

async function load() {
  try {
    const [s, i] = await Promise.all([api<Summary>(`/hr/attendance?month=${month.value}`), api<Imp[]>('/hr/attendance/imports')]);
    data.value = s;
    imports.value = i;
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
watch(month, load);

const rows = computed(() => (data.value?.rows ?? []).filter((r) => !q.value || r.fullName.includes(q.value) || r.code.includes(q.value) || r.unitName.includes(q.value)));
const kpi = computed(() => {
  const t = (data.value?.rows ?? []).filter((r) => r.tracked);
  return {
    tracked: t.length, absent: t.reduce((s, r) => s + r.absentDays, 0), late: t.reduce((s, r) => s + r.deductibleMinutes, 0),
    missing: t.reduce((s, r) => s + r.missingOut, 0), lateEmployees: t.filter((r) => r.deductibleMinutes > 0).length,
  };
});
const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} س ${m % 60 ? `${m % 60} د` : ''}` : `${m} د`);

async function upload(f: File | undefined) {
  if (!f) return;
  busy.value = true;
  try {
    const fd = new FormData();
    fd.append('file', f);
    lastImport.value = await api<Imp>('/hr/attendance/import', { method: 'POST', body: fd });
    toast.success(`أُضيفت ${lastImport.value.added} بصمة`);
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}
function drop(e: DragEvent) {
  over.value = false;
  upload(e.dataTransfer?.files[0]);
}

// تقويم الموظف
const emp = ref<EmpMonth | null>(null);
const sel = ref<Day | null>(null);
const punch = reactive({ time: '08:00', note: '' });
async function openEmp(id: string) {
  try {
    emp.value = await api<EmpMonth>(`/hr/attendance/employees/${id}?month=${month.value}`);
    sel.value = null;
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const lead = computed(() => (emp.value?.days.length ? emp.value.days[0].weekday : 0));
function pick(d: Day) {
  sel.value = d;
  punch.time = d.checkIn ? '15:00' : '08:00';
  punch.note = '';
}
async function addPunch() {
  if (!emp.value || !sel.value) return;
  try {
    const date = sel.value.date;
    emp.value = await api<EmpMonth>('/hr/attendance/punches', { method: 'POST', json: { employeeId: emp.value.employee.id, date, time: punch.time, note: punch.note } });
    sel.value = emp.value.days.find((d) => d.date === date) ?? null;
    punch.note = '';
    toast.success('سُجلت البصمة');
    load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function removePunch(id: string) {
  if (!emp.value || !confirm('حذف البصمة اليدوية؟')) return;
  try {
    await api(`/hr/attendance/punches/${id}`, { method: 'DELETE' });
    const date = sel.value?.date;
    await openEmp(emp.value.employee.id);
    sel.value = emp.value?.days.find((d) => d.date === date) ?? null;
    load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const WD = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
</script>

<template>
  <div>
    <section class="pm-hero hr-hero">
      <div>
        <p class="pm-kicker">شؤون الموظفين</p>
        <h1>الحضور والانصراف</h1>
        <p class="pm-sub">البصمات تصل من الأجهزة تلقائيًا أو من ملفات Excel والملفات النصية. الغياب والتأخير المحسوبان هنا يُخصمان في كشف الرواتب حسب اللائحة.</p>
      </div>
      <div class="pm-actions">
        <input v-model="month" type="month" class="input" style="width: auto" />
        <RouterLink v-if="session.can(P.settings)" to="/hr/settings?tab=attendance" class="btn hr-ghost">إعدادات الدوام والأجهزة</RouterLink>
      </div>
    </section>

    <div v-if="data && !data.config.enabled" class="alert alert-warn">احتساب الحضور في الرواتب غير مفعّل. تظهر البيانات هنا للمتابعة فقط، ولا تُخصم من الرواتب حتى تفعّله من الإعدادات.</div>

    <template v-if="data">
      <div class="pm-kpis">
        <div class="pm-kpi" style="--a: #a78bfa; --i: 0"><span>الموظفون المتابَعون</span><strong><CountUp :value="kpi.tracked" /></strong><small>الدوام {{ data.config.workStart }} – {{ data.config.workEnd }}</small></div>
        <div class="pm-kpi" style="--a: #0ea5e9; --i: 1"><span>البصمات هذا الشهر</span><strong><CountUp :value="data.punchCount" /></strong><small>{{ data.coverageEnd ? `آخر بيانات: ${fmtDate(data.coverageEnd)}` : 'لم تصل بيانات بعد' }}</small></div>
        <div class="pm-kpi" style="--a: #ef4444; --i: 2"><span>أيام الغياب</span><strong><CountUp :value="kpi.absent" /></strong><small>بدون إجازة معتمدة</small></div>
        <div class="pm-kpi" style="--a: #f59e0b; --i: 3"><span>التأخير والخروج المبكر</span><strong>{{ hm(kpi.late) }}</strong><small>{{ kpi.lateEmployees }} موظف بعد فترة السماح</small></div>
        <div class="pm-kpi" style="--a: #f472b6; --i: 4"><span>انصراف بلا بصمة</span><strong><CountUp :value="kpi.missing" /></strong><small>يوم</small></div>
      </div>

      <div class="hr-grid" style="grid-template-columns: 2fr 1fr">
        <section class="card pm-panel">
          <div class="pm-row-head"><h2>حضور {{ monthLabel(month) }}</h2><input v-model="q" class="input" style="max-width: 220px" placeholder="بحث بالاسم أو رقم البصمة" /></div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>الموظف</th><th>رقم البصمة</th><th>أيام العمل</th><th>حضور</th><th>غياب</th><th>إجازة</th><th>تأخير يُخصم</th><th>انصراف ناقص</th><th></th></tr></thead>
              <tbody>
                <tr v-for="r in rows" :key="r.employeeId" :style="{ opacity: r.tracked ? 1 : 0.55 }">
                  <td><b>{{ r.fullName }}</b><span class="pm-muted">{{ r.unitName }}</span></td>
                  <td class="hr-code">{{ r.code }}</td>
                  <td class="hr-num">{{ r.workDays }}</td>
                  <td class="hr-num">{{ r.presentDays }}</td>
                  <td class="hr-num" :style="{ color: r.absentDays ? 'var(--danger)' : '' }">{{ r.absentDays || '—' }}</td>
                  <td class="hr-num">{{ r.leaveDays || '—' }}</td>
                  <td class="hr-num" :style="{ color: r.deductibleMinutes ? '#d97706' : '' }">{{ r.deductibleMinutes ? hm(r.deductibleMinutes) : '—' }}</td>
                  <td class="hr-num">{{ r.missingOut || '—' }}</td>
                  <td><span v-if="r.exempt" class="pm-tag">معفى</span><button v-else class="btn btn-sm" @click="openEmp(r.employeeId)">التفاصيل</button></td>
                </tr>
                <tr v-if="!rows.length"><td colspan="9" class="pm-empty">لا يوجد موظفون</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <div>
          <section v-if="canManage" class="card pm-panel">
            <h2>رفع ملف بصمات</h2>
            <div :class="['hr-drop', { over }]" @click="fileInput?.click()" @dragover.prevent="over = true" @dragleave="over = false" @drop.prevent="drop">
              <div style="font-size: 1.8rem">⇪</div>
              <b>{{ busy ? 'جارٍ القراءة…' : 'اسحب الملف هنا أو اضغط للاختيار' }}</b>
              <p class="pm-muted" style="margin: 6px 0 0">Excel ‏(xlsx) أو ملف نصي (txt / csv / dat) فيه: رقم الموظف في الجهاز، التاريخ، الوقت. ملف attlog من أجهزة ZKTeco مقبول كما هو.</p>
            </div>
            <input ref="fileInput" type="file" accept=".xlsx,.csv,.txt,.dat,.tsv" hidden @change="upload(($event.target as HTMLInputElement).files?.[0])" />
            <div v-if="lastImport" class="alert" style="margin-top: 10px; background: #10b98115">
              قُرئ {{ lastImport.rows }} سطرًا: أُضيفت {{ lastImport.added }} بصمة، و{{ lastImport.duplicates }} مكررة سبق تسجيلها<template v-if="lastImport.invalid">، و{{ lastImport.invalid }} سطرًا غير مقروء</template>.
              <template v-if="lastImport.unknownCodes.length"><br />أرقام غير مرتبطة بموظف: <span class="hr-code">{{ lastImport.unknownCodes.join('، ') }}</span></template>
            </div>
          </section>
          <section v-if="data.unknownCodes.length" class="card pm-panel" style="margin-top: 16px">
            <h2>أرقام بصمة غير مرتبطة</h2>
            <p class="pm-muted">وصلت بصمات بهذه الأرقام ولا يوجد موظف بها. اكتب الرقم في «رقم البصمة» في ملف الموظف.</p>
            <div style="display: flex; flex-wrap: wrap; gap: 6px"><span v-for="u in data.unknownCodes" :key="u.code" class="pm-tag hr-code">{{ u.code }} ({{ u.n }})</span></div>
          </section>
          <section class="card pm-panel" style="margin-top: 16px">
            <h2>آخر الملفات المرفوعة</h2>
            <div v-for="i in imports.slice(0, 8)" :key="i.id" style="padding: 6px 0; border-bottom: 1px solid var(--border)">
              <b style="font-size: .85rem">{{ i.fileName }}</b>
              <span class="hr-mini">{{ i.added }} بصمة جديدة من {{ i.rows }} · {{ i.dateFrom ? `${fmtDate(i.dateFrom)} – ${fmtDate(i.dateTo)}` : '' }} · {{ i.createdByName }}</span>
            </div>
            <p v-if="!imports.length" class="pm-empty">لم يُرفع ملف بعد</p>
          </section>
        </div>
      </div>
    </template>

    <div v-if="emp" class="modal-backdrop" @click.self="emp = null">
      <div class="card modal" style="max-width: 900px">
        <div class="pm-row-head"><h2>{{ emp.employee.fullName }} · {{ monthLabel(month) }}</h2><span class="pm-tag hr-code">بصمة {{ emp.employee.code }}</span></div>
        <div class="pm-kpis" style="margin-bottom: 12px">
          <div class="pm-kpi" style="--a: #10b981"><span>حضور</span><strong>{{ emp.totals.presentDays }} <small style="font-size: .8rem">من {{ emp.totals.workDays }} يوم</small></strong></div>
          <div class="pm-kpi" style="--a: #ef4444"><span>غياب</span><strong>{{ emp.totals.absentDays }}</strong></div>
          <div class="pm-kpi" style="--a: #f59e0b"><span>تأخير يُخصم</span><strong>{{ hm(emp.totals.deductibleMinutes) }}</strong></div>
          <div class="pm-kpi" style="--a: #f472b6"><span>انصراف ناقص</span><strong>{{ emp.totals.missingOut }}</strong></div>
        </div>
        <div class="hr-cal">
          <div v-for="w in WD" :key="w" class="h">{{ w }}</div>
          <div v-for="n in lead" :key="`e${n}`"></div>
          <div v-for="d in emp.days" :key="d.date" :class="['hr-day', d.status, { sel: sel?.date === d.date }]" style="cursor: pointer" @click="pick(d)">
            <b>{{ Number(d.date.slice(8)) }}</b>
            <span class="hr-mini">{{ d.holiday ?? d.statusLabel }}</span>
            <span v-if="d.checkIn" class="hr-mini" style="color: inherit">دخول {{ d.checkIn.slice(0, 5) }}</span>
            <span v-if="d.checkOut" class="hr-mini" style="color: inherit">خروج {{ d.checkOut.slice(0, 5) }}</span>
            <span v-if="d.deductible" class="late">{{ hm(d.deductible) }}</span>
            <span v-if="d.missingOut" class="late">بلا انصراف</span>
          </div>
        </div>
        <div v-if="sel" class="card" style="margin-top: 12px; padding: 12px">
          <b>{{ fmtDate(sel.date) }} · {{ sel.statusLabel }}</b>
          <span v-if="sel.late || sel.early" class="hr-mini">تأخير {{ sel.late }} د · خروج مبكر {{ sel.early }} د · يُخصم {{ sel.deductible }} د</span>
          <div v-for="p in sel.punches" :key="p.id" style="display: flex; gap: 8px; align-items: center; margin-top: 6px">
            <span class="hr-code">{{ p.time.slice(0, 5) }}</span><span class="pm-tag">{{ p.sourceLabel }}</span><span class="pm-muted">{{ p.note }}</span>
            <button v-if="p.source === 'manual' && canManage" class="btn btn-sm" @click="removePunch(p.id)">✕</button>
          </div>
          <p v-if="!sel.punches.length" class="pm-muted">لا توجد بصمات في هذا اليوم</p>
          <form v-if="canManage && sel.date <= todayStr()" style="display: grid; grid-template-columns: 120px 1fr auto; gap: 6px; margin-top: 8px" @submit.prevent="addPunch">
            <input v-model="punch.time" type="time" class="input" required />
            <input v-model="punch.note" class="input" required minlength="3" placeholder="سبب الإدخال اليدوي (مثل: عطل في الجهاز)" />
            <button class="btn btn-primary">إضافة بصمة</button>
          </form>
        </div>
        <div class="modal-actions"><button class="btn" @click="emp = null">إغلاق</button></div>
      </div>
    </div>
  </div>
</template>
