<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../../../api';
import CountUp from '../../../shared/CountUp.vue';
import LaunchCard from '../../../onboarding/LaunchCard.vue';
import { fmtDate, hijri, num, sar } from '../lib';
import { DAY_AR, DAY_COLOR, KIND_ICON, REQ_COLOR, rel, type ReqRow, type ReqType } from './ess';

interface Bal { code: string; name: string; entitlement: number | null; taken: number; pending: number; available: number | null; accrual: string; note: string | null }
interface Dash {
  employee: {
    fullName: string; employeeNo: number; gender: string; jobTitle: string; unitName: string; gradeName: string | null; managerName: string | null; hireDate: string;
    nationality: string; contractTypeLabel: string; contractEnd: string | null; idExpiry: string | null; email: string | null; phone: string | null; iban: string | null; gosiNumber: string | null;
  };
  service: { years: number; months: number; days: number; totalDays: number; hireDate: string };
  balances: Bal[];
  advances: { total: number; paid: number; remaining: number; items: { id: string; amount: number; paid: number; remaining: number; installmentAmount: number; paidInstallments: number; installments: number; startMonth: string }[] };
  salary: { items: { code: string; name: string; amount: number }[]; gross: number; gosiEmployee: number; net: number; dailyWage: number };
  attendance: {
    enabled: boolean; tracked: boolean; workStart: string; workEnd: string; month: string;
    totals: { workDays: number; presentDays: number; absentDays: number; leaveDays: number; lateMinutes: number; earlyMinutes: number; missingOut: number };
    today: { checkIn: string | null; checkOut: string | null };
    recent: { date: string; status: string; checkIn: string | null; checkOut: string | null; late: number }[];
  };
  performance: { id: string; year: number; statusLabel: string; finalScore: number | null; rating: string | null; history: { year: number; finalScore: number | null; rating: string | null; statusLabel: string }[] } | null;
  requests: { pending: number; returned: number; approvedThisYear: number; recent: ReqRow[] };
  upcoming: { leaveType: string; startDate: string; endDate: string; days: number }[];
  alerts: { level: string; text: string }[];
  activity: { at: string; text: string; kind: string; link?: string }[];
  types: ReqType[];
  manager: { isManager: boolean; direct: number; team: number; awaiting: number };
  separation: { id: string; separationNo: number; status: string; lastWorkingDay: string; items: number; cleared: number } | null;
}
interface Clock { date: string; allowed: boolean; reason: string | null; workStart: string; workEnd: string; sites: { name: string }[]; maxAccuracy: number; punches: { time: string; sourceLabel: string }[]; next: 'in' | 'out' }
const data = ref<Dash | null>(null);
const clock = ref<Clock | null>(null);
const clockBusy = ref(false);
const clockMsg = ref<{ ok: boolean; text: string } | null>(null);
/** التسجيل من الجوال: يقرأ الموقع من المتصفح (مجانًا) ويرسله، والخادم يتحقق من النطاق ويسجل بوقته هو */
function punch() {
  if (!navigator.geolocation) {
    clockMsg.value = { ok: false, text: 'المتصفح لا يدعم تحديد الموقع' };
    return;
  }
  clockBusy.value = true;
  clockMsg.value = null;
  navigator.geolocation.getCurrentPosition(async (p) => {
    try {
      clock.value = await api<Clock>('/hr/me/attendance', { method: 'POST', json: { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy } });
      const last = clock.value.punches.at(-1);
      clockMsg.value = { ok: true, text: `سُجلت بصمتك الساعة ${last?.time.slice(0, 5) ?? ''}` };
    } catch (e) {
      clockMsg.value = { ok: false, text: (e as Error).message };
    } finally {
      clockBusy.value = false;
    }
  }, (err) => {
    clockBusy.value = false;
    clockMsg.value = { ok: false, text: err.code === err.PERMISSION_DENIED ? 'اسمح للمتصفح باستخدام موقعك ثم حاول مرة أخرى' : 'تعذر تحديد موقعك. فعّل الموقع في الجوال وحاول مرة أخرى' };
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}
const error = ref('');
const now = ref(Date.now());
let timer = 0;
onMounted(async () => {
  try {
    data.value = await api<Dash>('/hr/me');
    api<Clock>('/hr/me/attendance').then((c) => (clock.value = c)).catch(() => undefined);
  } catch (e) {
    error.value = (e as Error).message;
  }
  timer = window.setInterval(() => (now.value = Date.now()), 1000);
});
onBeforeUnmount(() => clearInterval(timer));

const greeting = computed(() => {
  const h = new Date().getHours();
  return h < 12 ? 'صباح الخير' : h < 18 ? 'مساء النور' : 'مساء الخير';
});
const first = computed(() => data.value?.employee.fullName.split(' ')[0] ?? '');

/** عداد مدة الخدمة الحي: سنوات وأشهر وأيام بالتقويم ثم ساعات ودقائق وثوانٍ */
const counter = computed(() => {
  if (!data.value) return null;
  const start = new Date(`${data.value.service.hireDate}T00:00:00+03:00`);
  const n = new Date(now.value);
  let y = n.getFullYear() - start.getFullYear();
  let m = n.getMonth() - start.getMonth();
  let anchor = new Date(start);
  anchor.setFullYear(start.getFullYear() + y);
  if (anchor > n) { y--; anchor = new Date(start); anchor.setFullYear(start.getFullYear() + y); }
  m = (n.getFullYear() - anchor.getFullYear()) * 12 + n.getMonth() - anchor.getMonth();
  let mAnchor = new Date(anchor);
  mAnchor.setMonth(anchor.getMonth() + m);
  if (mAnchor > n) { m--; mAnchor = new Date(anchor); mAnchor.setMonth(anchor.getMonth() + m); }
  let rest = Math.floor((n.getTime() - mAnchor.getTime()) / 1000);
  const d = Math.floor(rest / 86400); rest -= d * 86400;
  const h = Math.floor(rest / 3600); rest -= h * 3600;
  const mi = Math.floor(rest / 60);
  const s = rest - mi * 60;
  return { y, m, d, h, mi, s, total: Math.floor((n.getTime() - start.getTime()) / 86400000) };
});
const pad = (v: number) => String(v).padStart(2, '0');

const annual = computed(() => data.value?.balances.find((b) => b.code === 'annual'));
const otherBalances = computed(() => data.value?.balances.filter((b) => b.code !== 'annual') ?? []);
const annualPct = computed(() => {
  const a = annual.value;
  if (!a?.entitlement) return 0;
  return Math.max(0, Math.min(100, ((a.available ?? 0) / a.entitlement) * 100));
});


const ACT_COLOR: Record<string, string> = { leave: '#2f7a57', permission: '#f59e0b', letter: '#8b5cf6', advance: '#ec4899', performance: '#6366f1', attendance: '#10b981', general: '#64748b', exit_reentry: '#0ea5e9' };
const quick = computed(() => data.value?.types.slice(0, 6) ?? []);
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <template v-if="data && counter">
      <section class="ess-hero" data-tour="dash">
        <div class="ess-hero-top">
          <div>
            <p class="ess-kicker">الخدمة الذاتية</p>
            <h1>{{ greeting }}، {{ first }}</h1>
            <p class="sub">{{ data.employee.jobTitle }} · {{ data.employee.unitName }}<template v-if="data.employee.managerName"> · مديرك المباشر {{ data.employee.managerName }}</template></p>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <RouterLink to="/me/new" class="btn ess-cta">طلب جديد</RouterLink>
            <RouterLink v-if="data.manager.isManager" to="/me/manager" class="btn btn-ghost">لوحة المدير ({{ data.manager.team }})</RouterLink>
          </div>
        </div>
        <div class="ess-counter" aria-label="مدة الخدمة في الشركة">
          <div class="u" style="--i: 0"><b>{{ counter.y }}</b><span>سنة</span></div>
          <div class="u" style="--i: 1"><b>{{ counter.m }}</b><span>شهر</span></div>
          <div class="u" style="--i: 2"><b>{{ counter.d }}</b><span>يوم</span></div>
          <div class="u tick" style="--i: 3"><b>{{ pad(counter.h) }}:{{ pad(counter.mi) }}:{{ pad(counter.s) }}</b><span>ساعة</span></div>
          <span class="cap">مدة خدمتك في الشركة منذ {{ fmtDate(data.service.hireDate) }} ({{ counter.total.toLocaleString('ar-SA') }} يومًا)</span>
        </div>
      </section>

      <LaunchCard />

      <section v-if="clock?.allowed" class="card ess-card" style="margin-bottom: 14px">
        <div class="ess-clock">
          <button class="btn btn-primary ess-clock-btn" :disabled="clockBusy" @click="punch">
            {{ clockBusy ? 'جارٍ تحديد موقعك…' : clock.next === 'in' ? '📍 تسجيل الحضور' : '📍 تسجيل الانصراف' }}
          </button>
          <div style="flex: 1; min-width: 200px">
            <b>الحضور من الجوال</b>
            <p class="pm-muted" style="margin: 2px 0">الدوام {{ clock.workStart }} - {{ clock.workEnd }} · يُقبل التسجيل داخل: {{ clock.sites.map((x) => x.name).join('، ') }}</p>
            <div class="ess-clock-times"><span v-for="(p, i) in clock.punches" :key="i" class="pm-tag">{{ p.time.slice(0, 5) }} · {{ p.sourceLabel }}</span><span v-if="!clock.punches.length" class="pm-muted">لم تسجل اليوم بعد</span></div>
          </div>
        </div>
        <div v-if="clockMsg" :class="['alert', clockMsg.ok ? '' : 'alert-error']" :style="clockMsg.ok ? { background: '#10b98115', marginTop: '10px' } : { marginTop: '10px' }">{{ clockMsg.text }}</div>
      </section>

      <div v-for="(a, i) in data.alerts" :key="i" :class="['alert', a.level === 'danger' ? 'alert-error' : '']" :style="a.level !== 'danger' ? { background: '#fff7ed', color: '#9a3412' } : {}">{{ a.text }}</div>
      <RouterLink v-if="data.separation && data.separation.status !== 'paid'" :to="`/hr/separations/${data.separation.id}`" class="btn btn-sm" style="margin-bottom: 12px">🚪 متابعة ملف إنهاء خدمتي (إخلاء الطرف {{ data.separation.cleared }} / {{ data.separation.items }}) ←</RouterLink>

      <div class="ess-kpis">
        <div class="ess-kpi" style="--a: #ec4899; --i: 0"><span class="ic">🌴</span><span>رصيد الإجازة السنوية</span><strong><CountUp :value="annual?.available ?? 0" :decimals="1" /> <small>يوم</small></strong><small>المأخوذ {{ annual?.taken ?? 0 }} · بانتظار الاعتماد {{ annual?.pending ?? 0 }}</small></div>
        <div class="ess-kpi" style="--a: #f59e0b; --i: 1"><span class="ic">💳</span><span>رصيد السلف المتبقي</span><strong><CountUp :value="data.advances.remaining" /> <small>ريال</small></strong><small>سُدد {{ num(data.advances.paid) }} من {{ num(data.advances.total) }}</small></div>
        <div class="ess-kpi" style="--a: #10b981; --i: 2"><span class="ic">💰</span><span>صافي الراتب الشهري</span><strong><CountUp :value="data.salary.net" /> <small>ريال</small></strong><small>الإجمالي {{ sar(data.salary.gross) }}</small></div>
        <div class="ess-kpi" style="--a: #0ea5e9; --i: 3"><span class="ic">🕘</span><span>حضور هذا الشهر</span><strong>{{ data.attendance.totals.presentDays }} <small>/ {{ data.attendance.totals.workDays }} يوم</small></strong><small>تأخير {{ data.attendance.totals.lateMinutes }} دقيقة · غياب {{ data.attendance.totals.absentDays }}</small></div>
        <div class="ess-kpi" style="--a: #6366f1; --i: 4"><span class="ic">⭐</span><span>تقييم الأداء</span><strong>{{ data.performance?.finalScore ?? '—' }}</strong><small>{{ data.performance ? `${data.performance.rating ?? data.performance.statusLabel} · ${data.performance.year}` : 'لا توجد بطاقة بعد' }}</small></div>
        <RouterLink to="/me/requests" class="ess-kpi" style="--a: #a78bfa; --i: 5"><span class="ic">📋</span><span>طلباتي</span><strong>{{ data.requests.pending }} <small>قيد الاعتماد</small></strong><small>{{ data.requests.returned }} معاد · {{ data.requests.approvedThisYear }} معتمد هذا العام</small></RouterLink>
      </div>

      <div class="ess-grid">
        <section class="card ess-card">
          <h2>رصيد الإجازات <RouterLink to="/me/new">طلب إجازة</RouterLink></h2>
          <div v-if="annual" class="ess-ring" :style="{ '--v': annualPct }"><b>{{ num(annual.available) }}<small>يوم متاح من {{ num(annual.entitlement) }}</small></b></div>
          <div class="ess-bal">
            <div v-for="b in otherBalances" :key="b.code" class="r">
              <span>{{ b.name }}</span>
              <b class="hr-num">{{ b.accrual === 'per_request' ? (b.entitlement ? `${b.entitlement} في المرة` : 'حسب الحاجة') : `${num(b.available)} / ${num(b.entitlement)}` }}</b>
              <div v-if="b.entitlement && b.accrual !== 'per_request'" class="bar">
                <i class="t" :style="{ width: `${(b.taken / b.entitlement) * 100}%` }" /><i class="p" :style="{ width: `${(b.pending / b.entitlement) * 100}%` }" />
              </div>
            </div>
          </div>
          <div v-if="data.upcoming.length" style="margin-top: 14px">
            <p class="pm-muted">إجازاتك القادمة</p>
            <div v-for="u in data.upcoming" :key="u.startDate" class="hr-chip" style="margin: 4px 0">{{ u.leaveType }}: {{ fmtDate(u.startDate) }} ← {{ fmtDate(u.endDate) }} ({{ u.days }})</div>
          </div>
        </section>

        <section class="card ess-card">
          <h2>بيانات الراتب الرئيسية</h2>
          <div class="ess-list">
            <div v-for="(it, i) in data.salary.items" :key="it.code" class="ess-item" :style="{ '--i': i, '--c': it.code === 'basic' ? '#10b981' : '#0ea5e9' }">
              <span class="em">{{ it.code === 'basic' ? '🏦' : '➕' }}</span><span class="tx"><b>{{ it.name }}</b></span><b class="hr-num">{{ sar(it.amount) }}</b>
            </div>
            <div class="ess-item" style="--c: #ef4444"><span class="em">➖</span><span class="tx"><b>حصتك في التأمينات الاجتماعية</b></span><b class="hr-num">{{ sar(data.salary.gosiEmployee) }}</b></div>
          </div>
          <dl class="pm-dl" style="margin-top: 12px">
            <div><dt>الإجمالي</dt><dd>{{ sar(data.salary.gross) }}</dd></div>
            <div><dt>الصافي التقريبي</dt><dd style="color: var(--success)">{{ sar(data.salary.net) }}</dd></div>
            <div v-if="data.employee.iban"><dt>حساب الراتب</dt><dd class="hr-code">{{ data.employee.iban }}</dd></div>
          </dl>
          <div v-if="data.advances.items.length" style="margin-top: 14px">
            <p class="pm-muted">السلف القائمة</p>
            <div v-for="a in data.advances.items" :key="a.id" class="ess-bal"><div class="r">
              <span>سلفة {{ sar(a.amount) }} · قسط {{ sar(a.installmentAmount) }}</span><b class="hr-num">باقي {{ sar(a.remaining) }}</b>
              <div class="bar"><i class="t" :style="{ width: `${(a.paid / a.amount) * 100}%` }" /></div>
            </div></div>
          </div>
        </section>

        <section class="card ess-card">
          <h2>الحضور والانصراف</h2>
          <p v-if="!data.attendance.enabled" class="pm-empty">نظام البصمة غير مفعل في الشركة</p>
          <template v-else>
            <div class="ess-today">
              <div><span class="pm-muted">حضور اليوم</span><b>{{ data.attendance.today.checkIn ?? '—' }}</b></div>
              <div><span class="pm-muted">انصراف اليوم</span><b>{{ data.attendance.today.checkOut ?? '—' }}</b></div>
            </div>
            <p class="pm-muted">الدوام {{ data.attendance.workStart }} - {{ data.attendance.workEnd }}{{ data.attendance.tracked ? '' : ' · أنت معفى من البصمة' }}</p>
            <div class="ess-days">
              <span v-for="(d, i) in data.attendance.recent" :key="d.date" class="ess-day" :style="{ '--c': DAY_COLOR[d.status] ?? '#94a3b8', '--i': i }" :title="`${fmtDate(d.date)}: ${DAY_AR[d.status] ?? d.status}${d.checkIn ? ` ${d.checkIn}` : ''}${d.late ? ` (تأخير ${d.late} د)` : ''}`">{{ Number(d.date.slice(8)) }}</span>
            </div>
            <div class="pm-legend"><span v-for="(c, k) in DAY_COLOR" :key="k" :style="{ '--c': c }">{{ DAY_AR[k] }}</span></div>
          </template>
        </section>

        <section class="card ess-card">
          <h2>تقييم الأداء</h2>
          <p v-if="!data.performance" class="pm-empty">لا توجد بطاقة أداء بعد</p>
          <template v-else>
            <div class="ess-ring" :style="{ '--v': data.performance.finalScore ?? 0 }"><b>{{ data.performance.finalScore ?? '—' }}<small>{{ data.performance.rating ?? data.performance.statusLabel }}</small></b></div>
            <div class="ess-list">
              <div v-for="(h, i) in data.performance.history" :key="h.year" class="ess-item" :style="{ '--i': i, '--c': '#6366f1' }">
                <span class="em">{{ h.year }}</span><span class="tx"><b>{{ h.rating ?? h.statusLabel }}</b><span>{{ h.statusLabel }}</span></span><b>{{ h.finalScore ?? '—' }}</b>
              </div>
            </div>
          </template>
        </section>

        <section class="card ess-card">
          <h2>آخر طلباتي <RouterLink to="/me/requests">كل الطلبات</RouterLink></h2>
          <p v-if="!data.requests.recent.length" class="pm-empty">لم تقدم طلبات بعد</p>
          <div class="ess-list">
            <RouterLink v-for="(r, i) in data.requests.recent" :key="r.id" :to="`/me/requests/${r.id}`" class="ess-item" :style="{ '--i': i, '--c': REQ_COLOR[r.status] }">
              <span class="em">{{ KIND_ICON[r.kind] }}</span>
              <span class="tx"><b>{{ r.typeName }} <small class="pm-muted">#{{ r.requestNo }}</small></b><span>{{ r.summary }}</span></span>
              <span class="ess-pill" :style="{ '--c': REQ_COLOR[r.status] }">{{ r.statusLabel }}</span>
            </RouterLink>
          </div>
        </section>

        <section class="card ess-card">
          <h2>آخر نشاط</h2>
          <p v-if="!data.activity.length" class="pm-empty">لا يوجد نشاط بعد</p>
          <ol class="ess-timeline">
            <li v-for="(a, i) in data.activity" :key="i" :style="{ '--i': i, '--c': ACT_COLOR[a.kind] ?? '#a78bfa' }">
              <RouterLink v-if="a.link" :to="a.link">{{ a.text }}</RouterLink><template v-else>{{ a.text }}</template>
              <span>{{ rel(a.at) }}</span>
            </li>
          </ol>
        </section>

        <section class="card ess-card wide">
          <h2>الطلبات التي يمكنك رفعها <RouterLink to="/me/new">كل الطلبات</RouterLink></h2>
          <div class="ess-types">
            <RouterLink v-for="(t, i) in quick" :key="t.id" :to="`/me/new/${t.id}`" class="ess-type" :style="{ '--c': t.color, '--i': i }">
              <span class="em">{{ KIND_ICON[t.kind] }}</span><b>{{ t.name }}</b><small>{{ t.description }}</small>
            </RouterLink>
          </div>
        </section>

        <section class="card ess-card wide">
          <h2>ملفي الشخصي</h2>
          <dl class="pm-dl">
            <div><dt>الاسم</dt><dd>{{ data.employee.fullName }}</dd></div>
            <div><dt>الرقم الوظيفي</dt><dd>{{ data.employee.employeeNo }}</dd></div>
            <div><dt>الوظيفة</dt><dd>{{ data.employee.jobTitle }}</dd></div>
            <div><dt>الإدارة</dt><dd>{{ data.employee.unitName }}</dd></div>
            <div><dt>المرتبة</dt><dd>{{ data.employee.gradeName ?? '—' }}</dd></div>
            <div><dt>المدير المباشر</dt><dd>{{ data.employee.managerName ?? '—' }}</dd></div>
            <div><dt>تاريخ المباشرة</dt><dd>{{ fmtDate(data.employee.hireDate) }}<span class="hr-hijri">{{ hijri(data.employee.hireDate) }}</span></dd></div>
            <div><dt>نوع العقد</dt><dd>{{ data.employee.contractTypeLabel }}{{ data.employee.contractEnd ? ` حتى ${fmtDate(data.employee.contractEnd)}` : '' }}</dd></div>
            <div><dt>الجنسية</dt><dd>{{ data.employee.nationality }}</dd></div>
            <div><dt>انتهاء الهوية</dt><dd>{{ fmtDate(data.employee.idExpiry) }}</dd></div>
            <div><dt>الجوال</dt><dd dir="ltr" style="text-align: right">{{ data.employee.phone ?? '—' }}</dd></div>
            <div><dt>رقم التأمينات</dt><dd>{{ data.employee.gosiNumber ?? '—' }}</dd></div>
          </dl>
          <p class="pm-muted" style="margin-top: 10px">لتحديث بياناتك قدّم «طلب عام» لشؤون الموظفين.</p>
        </section>
      </div>
    </template>
    <div v-else-if="!error" class="ess-skeleton"><i /><i /><i /></div>
  </div>
</template>
