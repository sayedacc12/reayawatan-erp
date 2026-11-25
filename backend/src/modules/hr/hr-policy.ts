import { BadRequestException } from '@nestjs/common';

/**
 * لائحة الموارد البشرية: كل النسب والمدد والقواعد في مكان واحد، بقيم نظام العمل السعودي ونظام التأمينات
 * جاهزة، وكل جمعية تعدّلها حسب لائحتها المعتمدة. الحسابات هنا دوال خالصة حتى تُختبر وحدها.
 */

export type LeaveAccrual = 'monthly' | 'yearly' | 'per_request' | 'once';
export type LeavePay = 'full' | 'partial' | 'unpaid';
export type WageBase = 'basic' | 'basic_housing' | 'total';

export interface LeaveTypeRule {
  code: string;
  name: string;
  /** الأيام في السنة (أو في المرة الواحدة لنوع per_request و once). 0 = بلا حد */
  days: number;
  /** رصيد أعلى بعد عدد سنوات خدمة (مثل 30 يومًا بعد 5 سنوات) */
  daysAfter: { years: number; days: number } | null;
  accrual: LeaveAccrual;
  pay: LeavePay;
  gender: 'male' | 'female' | null;
  minServiceMonths: number;
  /** الحد الأعلى للرصيد المرحّل (للإجازة السنوية). null = بلا حد */
  maxCarryover: number | null;
  note: string | null;
}

export interface HrPolicy {
  work: {
    dailyHours: number; weeklyHours: number; ramadanHours: number; overtimeRate: number;
    probationDays: number; maxProbationDays: number; noticeDaysEmployer: number; noticeDaysEmployee: number;
  };
  gosi: {
    minWage: number; maxWage: number; wageBase: Exclude<WageBase, 'total'>;
    saudi: { pensionEmployee: number; pensionEmployer: number; sanedEmployee: number; sanedEmployer: number; hazardsEmployer: number };
    nonSaudi: { hazardsEmployer: number };
    /** النظام الجديد للمشتركين لأول مرة من تاريخ النفاذ: نسبة المعاشات (لكل طرف) ترتفع تدريجيًا */
    newLaw: { effectiveFrom: string; schedule: { from: string; rate: number }[] };
  };
  eos: {
    firstYears: number; firstRate: number; afterRate: number; wageBase: WageBase;
    /** نسبة الاستحقاق عند الاستقالة حسب سنوات الخدمة */
    resignation: { minYears: number; factor: number }[];
  };
  leaveTypes: LeaveTypeRule[];
  performance: { objectivesWeight: number; maxAchievement: number; bands: { min: number; label: string }[] };
  payroll: {
    dayBasis: number;
    /** خصم أيام الغياب بدون عذر من الراتب، وكم يومًا يُخصم عن كل يوم غياب */
    deductAbsence: boolean; absenceFactor: number;
    /** خصم دقائق التأخير والخروج المبكر بعد فترة السماح، بأجر الدقيقة مضروبًا في المعامل */
    deductLate: boolean; lateGraceMinutes: number; lateFactor: number;
  };
}

const lt = (code: string, name: string, days: number, accrual: LeaveAccrual, pay: LeavePay, extra: Partial<LeaveTypeRule> = {}): LeaveTypeRule => ({
  code, name, days, accrual, pay, daysAfter: null, gender: null, minServiceMonths: 0, maxCarryover: null, note: null, ...extra,
});

/** القيم الافتراضية حسب نظام العمل السعودي ونظام التأمينات الاجتماعية (قابلة للتعديل من اللائحة) */
export function defaultPolicy(): HrPolicy {
  return {
    work: { dailyHours: 8, weeklyHours: 48, ramadanHours: 6, overtimeRate: 1.5, probationDays: 90, maxProbationDays: 180, noticeDaysEmployer: 60, noticeDaysEmployee: 30 },
    gosi: {
      minWage: 1500, maxWage: 45000, wageBase: 'basic_housing',
      saudi: { pensionEmployee: 9, pensionEmployer: 9, sanedEmployee: 0.75, sanedEmployer: 0.75, hazardsEmployer: 2 },
      nonSaudi: { hazardsEmployer: 2 },
      newLaw: {
        effectiveFrom: '2024-07-03',
        schedule: [
          { from: '2024-07-03', rate: 9 }, { from: '2025-07-01', rate: 9.5 }, { from: '2026-07-01', rate: 10 },
          { from: '2027-07-01', rate: 10.5 }, { from: '2028-07-01', rate: 11 },
        ],
      },
    },
    eos: {
      firstYears: 5, firstRate: 0.5, afterRate: 1, wageBase: 'total',
      resignation: [{ minYears: 0, factor: 0 }, { minYears: 2, factor: 1 / 3 }, { minYears: 5, factor: 2 / 3 }, { minYears: 10, factor: 1 }],
    },
    leaveTypes: [
      lt('annual', 'الإجازة السنوية', 21, 'monthly', 'full', { daysAfter: { years: 5, days: 30 }, maxCarryover: 30 }),
      lt('sick', 'الإجازة المرضية', 120, 'yearly', 'partial', { note: '30 يومًا بأجر كامل، ثم 60 يومًا بثلاثة أرباع الأجر، ثم 30 يومًا بدون أجر خلال السنة' }),
      lt('maternity', 'إجازة الوضع', 84, 'per_request', 'full', { gender: 'female' }),
      lt('marriage', 'إجازة الزواج', 5, 'per_request', 'full'),
      lt('bereavement', 'إجازة الوفاة', 5, 'per_request', 'full', { note: 'وفاة الزوج أو أحد الأصول أو الفروع' }),
      lt('paternity', 'إجازة المولود', 3, 'per_request', 'full', { gender: 'male' }),
      lt('hajj', 'إجازة الحج', 10, 'once', 'full', { minServiceMonths: 24, note: 'مرة واحدة طوال الخدمة، وتشمل إجازة عيد الأضحى' }),
      lt('exam', 'إجازة الامتحانات', 0, 'per_request', 'full', { note: 'بقدر أيام الامتحان، بعد تقديم ما يثبته' }),
      lt('unpaid', 'إجازة بدون أجر', 0, 'per_request', 'unpaid', { note: 'تُخصم أيامها من الراتب' }),
    ],
    performance: {
      objectivesWeight: 70, maxAchievement: 120,
      bands: [{ min: 90, label: 'ممتاز' }, { min: 80, label: 'جيد جدًا' }, { min: 70, label: 'جيد' }, { min: 60, label: 'مرضٍ' }, { min: 0, label: 'يحتاج إلى تحسين' }],
    },
    payroll: { dayBasis: 30, deductAbsence: true, absenceFactor: 1, deductLate: true, lateGraceMinutes: 15, lateFactor: 1 },
  };
}

// ---------------- التحقق من اللائحة ----------------

const bad = (m: string): never => {
  throw new BadRequestException(m);
};
const numIn = (v: unknown, min: number, max: number, label: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) bad(`${label}: القيمة يجب أن تكون بين ${min} و${max}`);
  return Math.round(n * 10000) / 10000;
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateOf = (v: unknown, label: string) => (typeof v === 'string' && DATE.test(v) ? v : bad(`${label}: التاريخ غير صحيح`));
const obj = (v: unknown, label: string) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : bad(`${label} غير مكتمل`));
const arr = (v: unknown, label: string) => (Array.isArray(v) ? (v as unknown[]) : bad(`${label} غير مكتمل`));

/** يتحقق من لائحة مرسلة من الواجهة ويعيدها نظيفة (بدون حقول زائدة) */
export function normalizePolicy(input: unknown): HrPolicy {
  const p = obj(input, 'اللائحة');
  const w = obj(p.work, 'ساعات العمل');
  const g = obj(p.gosi, 'التأمينات');
  const gs = obj(g.saudi, 'نسب السعوديين');
  const gn = obj(g.nonSaudi, 'نسب غير السعوديين');
  const nl = obj(g.newLaw, 'النظام الجديد');
  const e = obj(p.eos, 'نهاية الخدمة');
  const pf = obj(p.performance, 'الأداء');
  const py = obj(p.payroll ?? { dayBasis: 30 }, 'الرواتب');

  const work = {
    dailyHours: numIn(w.dailyHours, 1, 12, 'ساعات العمل اليومية'),
    weeklyHours: numIn(w.weeklyHours, 1, 60, 'ساعات العمل الأسبوعية'),
    ramadanHours: numIn(w.ramadanHours, 1, 12, 'ساعات العمل في رمضان'),
    overtimeRate: numIn(w.overtimeRate, 1, 3, 'معامل أجر العمل الإضافي'),
    probationDays: numIn(w.probationDays, 0, 180, 'فترة التجربة'),
    maxProbationDays: numIn(w.maxProbationDays, 0, 180, 'الحد الأعلى لفترة التجربة'),
    noticeDaysEmployer: numIn(w.noticeDaysEmployer, 0, 180, 'مهلة الإشعار من صاحب العمل'),
    noticeDaysEmployee: numIn(w.noticeDaysEmployee, 0, 180, 'مهلة الإشعار من الموظف'),
  };
  if (work.probationDays > work.maxProbationDays) bad('فترة التجربة أطول من حدها الأعلى');

  const schedule = arr(nl.schedule, 'جدول نسب النظام الجديد').map((s, i) => {
    const r = obj(s, `سطر ${i + 1} في جدول النظام الجديد`);
    return { from: dateOf(r.from, `سطر ${i + 1} في جدول النظام الجديد`), rate: numIn(r.rate, 0, 30, `نسبة سطر ${i + 1}`) };
  }).sort((a, b) => a.from.localeCompare(b.from));
  const gosi = {
    minWage: numIn(g.minWage, 0, 100000, 'الحد الأدنى للأجر الخاضع'),
    maxWage: numIn(g.maxWage, 1, 1000000, 'الحد الأعلى للأجر الخاضع'),
    wageBase: (g.wageBase === 'basic' ? 'basic' : 'basic_housing') as 'basic' | 'basic_housing',
    saudi: {
      pensionEmployee: numIn(gs.pensionEmployee, 0, 30, 'المعاشات على الموظف'),
      pensionEmployer: numIn(gs.pensionEmployer, 0, 30, 'المعاشات على الشركة'),
      sanedEmployee: numIn(gs.sanedEmployee, 0, 10, 'ساند على الموظف'),
      sanedEmployer: numIn(gs.sanedEmployer, 0, 10, 'ساند على الشركة'),
      hazardsEmployer: numIn(gs.hazardsEmployer, 0, 10, 'الأخطار المهنية للسعوديين'),
    },
    nonSaudi: { hazardsEmployer: numIn(gn.hazardsEmployer, 0, 10, 'الأخطار المهنية لغير السعوديين') },
    newLaw: { effectiveFrom: dateOf(nl.effectiveFrom, 'تاريخ نفاذ النظام الجديد'), schedule },
  };
  if (gosi.minWage > gosi.maxWage) bad('الحد الأدنى للأجر الخاضع أكبر من الحد الأعلى');

  const resignation = arr(e.resignation, 'نسب الاستقالة').map((s, i) => {
    const r = obj(s, `شريحة الاستقالة ${i + 1}`);
    return { minYears: numIn(r.minYears, 0, 60, `سنوات شريحة ${i + 1}`), factor: numIn(r.factor, 0, 1, `نسبة شريحة ${i + 1}`) };
  }).sort((a, b) => a.minYears - b.minYears);
  if (!resignation.length || resignation[0].minYears !== 0) bad('شرائح الاستقالة يجب أن تبدأ من 0 سنة');
  const eos = {
    firstYears: numIn(e.firstYears, 0, 60, 'سنوات الشريحة الأولى'),
    firstRate: numIn(e.firstRate, 0, 3, 'أجر الشريحة الأولى عن كل سنة'),
    afterRate: numIn(e.afterRate, 0, 3, 'أجر ما بعد الشريحة الأولى عن كل سنة'),
    wageBase: (['basic', 'basic_housing', 'total'].includes(e.wageBase as string) ? e.wageBase : 'total') as WageBase,
    resignation,
  };

  const codes = new Set<string>();
  const leaveTypes = arr(p.leaveTypes, 'أنواع الإجازات').map((s, i) => {
    const r = obj(s, `نوع الإجازة ${i + 1}`);
    const code = typeof r.code === 'string' && /^[a-z][a-z0-9_]{1,29}$/.test(r.code) ? r.code : bad(`رمز نوع الإجازة ${i + 1} غير صحيح (حروف إنجليزية صغيرة)`);
    if (codes.has(code)) bad(`رمز الإجازة "${code}" مكرر`);
    codes.add(code);
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 100) : bad(`اكتب اسم نوع الإجازة ${i + 1}`);
    const da = r.daysAfter ? obj(r.daysAfter, `رصيد ${name} بعد سنوات`) : null;
    return {
      code, name,
      days: numIn(r.days, 0, 366, `أيام ${name}`),
      daysAfter: da ? { years: numIn(da.years, 1, 60, `سنوات ${name}`), days: numIn(da.days, 0, 366, `أيام ${name} بعد السنوات`) } : null,
      accrual: (['monthly', 'yearly', 'per_request', 'once'].includes(r.accrual as string) ? r.accrual : bad(`طريقة استحقاق ${name} غير صحيحة`)) as LeaveAccrual,
      pay: (['full', 'partial', 'unpaid'].includes(r.pay as string) ? r.pay : bad(`نوع أجر ${name} غير صحيح`)) as LeavePay,
      gender: r.gender === 'male' || r.gender === 'female' ? r.gender : null,
      minServiceMonths: numIn(r.minServiceMonths ?? 0, 0, 600, `مدة الخدمة المطلوبة لـ ${name}`),
      maxCarryover: r.maxCarryover === null || r.maxCarryover === undefined || r.maxCarryover === '' ? null : numIn(r.maxCarryover, 0, 366, `الحد المرحّل لـ ${name}`),
      note: typeof r.note === 'string' && r.note.trim() ? r.note.trim().slice(0, 300) : null,
    } as LeaveTypeRule;
  });
  if (!codes.has('annual')) bad('لا يمكن حذف الإجازة السنوية من اللائحة');

  const bands = arr(pf.bands, 'تقديرات الأداء').map((s, i) => {
    const r = obj(s, `التقدير ${i + 1}`);
    const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 40) : bad(`اكتب اسم التقدير ${i + 1}`);
    return { min: numIn(r.min, 0, 100, `حد ${label}`), label };
  }).sort((a, b) => b.min - a.min);
  if (!bands.length || bands[bands.length - 1].min !== 0) bad('أقل تقدير في الأداء يجب أن يبدأ من 0');
  const performance = {
    objectivesWeight: numIn(pf.objectivesWeight, 0, 100, 'وزن الأهداف'),
    maxAchievement: numIn(pf.maxAchievement, 100, 200, 'أعلى نسبة إنجاز محسوبة'),
    bands,
  };
  const dp = defaultPolicy().payroll;
  const payroll = {
    dayBasis: numIn(py.dayBasis, 28, 31, 'عدد أيام الشهر في احتساب الأجر اليومي'),
    deductAbsence: py.deductAbsence === undefined ? dp.deductAbsence : py.deductAbsence === true,
    absenceFactor: numIn(py.absenceFactor ?? dp.absenceFactor, 0, 3, 'أيام الخصم عن كل يوم غياب'),
    deductLate: py.deductLate === undefined ? dp.deductLate : py.deductLate === true,
    lateGraceMinutes: numIn(py.lateGraceMinutes ?? dp.lateGraceMinutes, 0, 120, 'دقائق السماح في التأخير'),
    lateFactor: numIn(py.lateFactor ?? dp.lateFactor, 0, 3, 'معامل خصم دقيقة التأخير'),
  };
  return { work, gosi, eos, leaveTypes, performance, payroll };
}

// ---------------- الحسابات ----------------

export const round2 = (n: number) => Math.round(n * 100) / 100;

export interface WageParts { basic: number; housing: number; transport: number; others: number }
export const wageTotal = (w: WageParts) => w.basic + w.housing + w.transport + w.others;
export function wageFor(base: WageBase, w: WageParts) {
  if (base === 'basic') return w.basic;
  if (base === 'basic_housing') return w.basic + w.housing;
  return wageTotal(w);
}

/** نسبة المعاشات (لكل طرف) للمشترك السعودي في تاريخ معيّن */
export function pensionRate(policy: HrPolicy, firstRegistration: string | null, onDate: string, side: 'employee' | 'employer') {
  const old = side === 'employee' ? policy.gosi.saudi.pensionEmployee : policy.gosi.saudi.pensionEmployer;
  const nl = policy.gosi.newLaw;
  if (!firstRegistration || firstRegistration < nl.effectiveFrom) return old;
  const step = [...nl.schedule].reverse().find((s) => s.from <= onDate);
  return step ? step.rate : old;
}

export interface GosiResult {
  base: number;
  employee: { pension: number; saned: number; total: number };
  employer: { pension: number; saned: number; hazards: number; total: number };
  rates: { pension: number; employerPension: number; newLaw: boolean };
}

/** اشتراكات التأمينات الشهرية */
export function gosi(policy: HrPolicy, w: WageParts, isSaudi: boolean, firstRegistration: string | null, onDate: string): GosiResult {
  const g = policy.gosi;
  const raw = wageFor(g.wageBase, w);
  const base = round2(Math.min(Math.max(raw, raw > 0 ? g.minWage : 0), g.maxWage));
  if (!isSaudi) {
    const hazards = round2((base * g.nonSaudi.hazardsEmployer) / 100);
    return { base, employee: { pension: 0, saned: 0, total: 0 }, employer: { pension: 0, saned: 0, hazards, total: hazards }, rates: { pension: 0, employerPension: 0, newLaw: false } };
  }
  const pe = pensionRate(policy, firstRegistration, onDate, 'employee');
  const pr = pensionRate(policy, firstRegistration, onDate, 'employer');
  const employee = { pension: round2((base * pe) / 100), saned: round2((base * g.saudi.sanedEmployee) / 100), total: 0 };
  employee.total = round2(employee.pension + employee.saned);
  const employer = {
    pension: round2((base * pr) / 100), saned: round2((base * g.saudi.sanedEmployer) / 100), hazards: round2((base * g.saudi.hazardsEmployer) / 100), total: 0,
  };
  employer.total = round2(employer.pension + employer.saned + employer.hazards);
  const newLaw = !!firstRegistration && firstRegistration >= g.newLaw.effectiveFrom;
  return { base, employee, employer, rates: { pension: pe, employerPension: pr, newLaw } };
}

const DAY = 86400000;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);

/** مدة الخدمة بالسنوات والأشهر والأيام (تقريبية بالتقويم الميلادي) */
export function serviceSpan(from: string, to: string) {
  const days = Math.max(daysBetween(from, to) + 1, 0);
  const years = Math.floor(days / 365);
  const rest = days - years * 365;
  return { totalDays: days, years, months: Math.floor(rest / 30), days: rest % 30, decimalYears: days / 365 };
}

export const EOS_REASONS = {
  contract_end: { label: 'انتهاء مدة العقد', kind: 'full' },
  employer_termination: { label: 'إنهاء من صاحب العمل', kind: 'full' },
  mutual: { label: 'اتفاق الطرفين', kind: 'full' },
  retirement: { label: 'بلوغ سن التقاعد', kind: 'full' },
  death: { label: 'الوفاة', kind: 'full' },
  disability: { label: 'العجز عن العمل', kind: 'full' },
  force_majeure: { label: 'القوة القاهرة', kind: 'full' },
  female_marriage: { label: 'إنهاء الموظفة خلال 6 أشهر من زواجها أو 3 أشهر من وضعها', kind: 'full' },
  article81: { label: 'ترك العمل لإخلال صاحب العمل (المادة 81)', kind: 'full' },
  resignation: { label: 'الاستقالة', kind: 'resignation' },
  article80: { label: 'الفصل وفق المادة 80', kind: 'none' },
} as const;
export type EosReason = keyof typeof EOS_REASONS;

export interface EosResult {
  service: ReturnType<typeof serviceSpan>;
  wage: number;
  firstPart: number;
  secondPart: number;
  fullAmount: number;
  factor: number;
  amount: number;
  reason: EosReason;
  reasonLabel: string;
  explanation: string;
}

/** مكافأة نهاية الخدمة حسب اللائحة */
export function endOfService(policy: HrPolicy, wage: number, start: string, end: string, reason: EosReason): EosResult {
  const e = policy.eos;
  const service = serviceSpan(start, end);
  const y = service.decimalYears;
  const firstPart = round2(Math.min(y, e.firstYears) * e.firstRate * wage);
  const secondPart = round2(Math.max(y - e.firstYears, 0) * e.afterRate * wage);
  const fullAmount = round2(firstPart + secondPart);
  const rule = EOS_REASONS[reason];
  let factor = 1;
  let explanation = 'مكافأة كاملة';
  if (rule.kind === 'none') {
    factor = 0;
    explanation = 'لا يستحق مكافأة';
  } else if (rule.kind === 'resignation') {
    const band = [...e.resignation].reverse().find((b) => y >= b.minYears) ?? e.resignation[0];
    factor = band.factor;
    explanation = factor === 0 ? `لا يستحق مكافأة عند الاستقالة قبل ${e.resignation[1]?.minYears ?? 2} سنوات` : factor === 1 ? 'مكافأة كاملة لطول الخدمة' : `يستحق ${factor < 0.5 ? 'ثلث' : 'ثلثي'} المكافأة`;
  }
  return { service, wage: round2(wage), firstPart, secondPart, fullAmount, factor, amount: round2(fullAmount * factor), reason, reasonLabel: rule.label, explanation };
}

export const CONTRACTOR_NO_EOS = 'متعاون بعقد تعاون: لا يستحق مكافأة نهاية خدمة ولا تعويض رصيد إجازات';

/** المتعاون لا يستحق مكافأة نهاية الخدمة ولا يُجنَّب له مخصص، أيًا كان سبب انتهاء التعاون */
export function contractorEos(start: string, end: string, reason: EosReason): EosResult {
  return {
    service: serviceSpan(start, end), wage: 0, firstPart: 0, secondPart: 0, fullAmount: 0, factor: 0, amount: 0,
    reason, reasonLabel: EOS_REASONS[reason].label, explanation: CONTRACTOR_NO_EOS,
  };
}

/** مكافأة نهاية الخدمة لموظف مسجل: صفر للمتعاون، وحسب اللائحة لغيره */
export function employeeEos(policy: HrPolicy, kind: string, wage: number, start: string, end: string, reason: EosReason): EosResult {
  return kind === 'contractor' ? contractorEos(start, end, reason) : endOfService(policy, wage, start, end, reason);
}

/** حصة الشهر من مخصص نهاية الخدمة حسب مدة الخدمة الحالية */
export function monthlyEosProvision(policy: HrPolicy, wage: number, serviceYears: number) {
  const rate = serviceYears < policy.eos.firstYears ? policy.eos.firstRate : policy.eos.afterRate;
  return round2((wage * rate) / 12);
}

/** رصيد الإجازة السنوية المستحق بين تاريخين، شهرًا بشهر حسب سنوات الخدمة */
export function accruedMonthly(rule: LeaveTypeRule, hireDate: string, from: string, to: string) {
  if (to < from) return 0;
  let total = 0;
  const days = daysBetween(from, to) + 1;
  // نحسب يوميًا بمعدل السنة الحالية للخدمة (دقيق ويغطي الانتقال من 21 إلى 30 يومًا)
  const switchDay = rule.daysAfter ? addDays(hireDate, Math.round(rule.daysAfter.years * 365)) : null;
  if (!switchDay || switchDay > to) total = (days * rule.days) / 365;
  else if (switchDay <= from) total = (days * (rule.daysAfter as { days: number }).days) / 365;
  else {
    const before = daysBetween(from, switchDay);
    total = (before * rule.days) / 365 + ((days - before) * (rule.daysAfter as { days: number }).days) / 365;
  }
  return Math.round(total * 100) / 100;
}

export interface ObjectiveInput { weight: number; achievement: number | null }
export interface CompetencyInput { requiredLevel: number; rating: number | null }

/** نتيجة بطاقة الأداء: الأهداف بنسبة الإنجاز (بحد أعلى)، والجدارات بالمستوى الفعلي مقابل المطلوب */
export function performanceScore(policy: HrPolicy, objectivesWeight: number, objectives: ObjectiveInput[], competencies: CompetencyInput[]) {
  const max = policy.performance.maxAchievement;
  const objectivesScore = objectives.length
    ? round2(objectives.reduce((s, o) => s + (o.weight * Math.min(Math.max(o.achievement ?? 0, 0), max)) / 100, 0))
    : null;
  const rated = competencies.filter((c) => c.rating !== null);
  const competenciesScore = rated.length
    ? round2((rated.reduce((s, c) => s + Math.min((c.rating as number) / Math.max(c.requiredLevel, 1), 1), 0) / rated.length) * 100)
    : null;
  let final: number;
  if (objectivesScore === null && competenciesScore === null) final = 0;
  else if (competenciesScore === null) final = objectivesScore as number;
  else if (objectivesScore === null) final = competenciesScore;
  else final = (objectivesScore * objectivesWeight + competenciesScore * (100 - objectivesWeight)) / 100;
  // نسبة الإنجاز قد تتجاوز المستهدف في الأهداف، لكن النتيجة النهائية من 100
  final = round2(Math.min(final, 100));
  const band = policy.performance.bands.find((b) => final >= b.min) ?? policy.performance.bands[policy.performance.bands.length - 1];
  return { objectivesScore, competenciesScore, finalScore: final, rating: band.label };
}
