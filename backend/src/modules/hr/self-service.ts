import { BadRequestException } from '@nestjs/common';
import {
  APPROVER_KINDS, ApprovalStepDef, FieldKind, HrEmployee, HrUnit, LetterTemplate, PermissionKind, REQUEST_KINDS, RequestField, RequestKind, RequestRules,
} from './entities/hr.entity';

/**
 * الخدمة الذاتية للموظفين: أنواع الطلبات الافتراضية، القيود المرنة، خط التبعية الإدارية في الهيكل،
 * ونماذج الخطابات. الدوال هنا خالصة حتى تُختبر وحدها.
 */

export const KIND_AR: Record<RequestKind, string> = {
  leave: 'إجازة', permission: 'استئذان', exit_reentry: 'خروج وعودة', letter: 'خطاب', advance: 'سلفة', general: 'طلب عام',
};
export const REQUEST_STATUS_AR = { pending: 'قيد الاعتماد', returned: 'معاد للتعديل', approved: 'معتمد', rejected: 'مرفوض', cancelled: 'ملغي' } as const;
export const APPROVER_AR: Record<(typeof APPROVER_KINDS)[number], string> = {
  direct_manager: 'المدير المباشر', second_manager: 'مدير المدير المباشر', unit_head: 'رئيس الوحدة في مستوى محدد', top_manager: 'أعلى الهيكل (المدير التنفيذي)',
  role: 'دور محدد', hr: 'شؤون الموظفين',
};
export const ACTION_AR: Record<string, string> = {
  submit: 'تقديم الطلب', resubmit: 'إعادة التقديم بعد التعديل', approve: 'موافقة', final: 'الاعتماد النهائي', return: 'إرجاع للتعديل', reject: 'رفض',
  cancel: 'إلغاء من الموظف', attach: 'إرفاق ملف', skip: 'تجاوز خطوة', hr_decision: 'قرار شؤون الموظفين من شاشة الإجازات',
};

export const DEFAULT_RULES: RequestRules = {
  gender: null, nationality: 'all', minServiceMonths: 0, allowPastDays: 0, minNoticeDays: 0, maxFutureDays: 365, maxPerMonth: null, maxPerYear: null,
  oneOpen: false, attachment: 'optional', attachmentHint: null, maxHoursPerMonth: null, maxSalaryMultiple: null, maxInstallments: null,
};
export const rulesOf = (r: Partial<RequestRules> | null | undefined): RequestRules => ({ ...DEFAULT_RULES, ...(r ?? {}) });

const bad = (m: string): never => {
  throw new BadRequestException(m);
};
const intIn = (v: unknown, min: number, max: number, label: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) bad(`${label}: القيمة يجب أن تكون عددًا صحيحًا بين ${min} و${max}`);
  return n;
};
const optInt = (v: unknown, min: number, max: number, label: string) => (v === null || v === undefined || v === '' ? null : intIn(v, min, max, label));
const optNum = (v: unknown, min: number, max: number, label: string) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) bad(`${label}: القيمة يجب أن تكون بين ${min} و${max}`);
  return Math.round(n * 100) / 100;
};
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function normalizeRules(input: unknown): RequestRules {
  const r = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: RequestRules = {
    gender: r.gender === 'male' || r.gender === 'female' ? r.gender : null,
    nationality: r.nationality === 'saudi' || r.nationality === 'non_saudi' ? r.nationality : 'all',
    minServiceMonths: intIn(r.minServiceMonths ?? 0, 0, 600, 'مدة الخدمة المطلوبة'),
    allowPastDays: intIn(r.allowPastDays ?? 0, 0, 365, 'الأيام السابقة المسموحة'),
    minNoticeDays: intIn(r.minNoticeDays ?? 0, 0, 365, 'مدة الإشعار المسبق'),
    maxFutureDays: optInt(r.maxFutureDays, 1, 1000, 'أبعد تاريخ مسموح'),
    maxPerMonth: optInt(r.maxPerMonth, 1, 100, 'الحد الشهري لعدد الطلبات'),
    maxPerYear: optInt(r.maxPerYear, 1, 1000, 'الحد السنوي لعدد الطلبات'),
    oneOpen: r.oneOpen === true,
    attachment: r.attachment === 'none' || r.attachment === 'required' ? r.attachment : 'optional',
    attachmentHint: text(r.attachmentHint, 200),
    maxHoursPerMonth: optNum(r.maxHoursPerMonth, 0.5, 200, 'الحد الشهري لساعات الاستئذان'),
    maxSalaryMultiple: optNum(r.maxSalaryMultiple, 0.1, 24, 'الحد الأعلى للسلفة'),
    maxInstallments: optInt(r.maxInstallments, 1, 60, 'أقصى عدد للأقساط'),
  };
  if (out.minNoticeDays > 0 && out.allowPastDays > 0) bad('لا يجتمع الإشعار المسبق مع السماح بتاريخ سابق، اختر أحدهما');
  return out;
}

const FIELD_TYPES: FieldKind[] = ['text', 'textarea', 'number', 'date', 'time', 'select', 'checkbox'];
export function normalizeFields(input: unknown): RequestField[] {
  if (!Array.isArray(input)) return [];
  const keys = new Set<string>();
  return input.slice(0, 30).map((f, i) => {
    const o = (f ?? {}) as Record<string, unknown>;
    const label = text(o.label, 100) ?? bad(`اكتب عنوان الحقل ${i + 1}`);
    const type = FIELD_TYPES.includes(o.type as FieldKind) ? (o.type as FieldKind) : bad(`نوع الحقل «${label}» غير صحيح`);
    let key = typeof o.key === 'string' && /^[a-z][a-z0-9_]{0,29}$/.test(o.key) ? o.key : `f${i + 1}`;
    while (keys.has(key)) key = `${key}_${i}`;
    keys.add(key);
    const options = type === 'select' ? (Array.isArray(o.options) ? o.options.map((x) => text(x, 100)).filter(Boolean) as string[] : []) : undefined;
    if (type === 'select' && !options?.length) bad(`أضف خيارات للحقل «${label}»`);
    return { key, label, type, required: o.required === true, ...(options ? { options } : {}), hint: text(o.hint, 200) };
  });
}

export function normalizeApproval(input: unknown): ApprovalStepDef[] {
  if (!Array.isArray(input)) return [];
  if (input.length > 8) bad('مسار الاعتماد 8 خطوات على الأكثر');
  return input.map((s, i) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const kind = APPROVER_KINDS.includes(o.kind as never) ? (o.kind as ApprovalStepDef['kind']) : bad(`نوع المعتمد في الخطوة ${i + 1} غير صحيح`);
    const step: ApprovalStepDef = { kind, name: text(o.name, 100) ?? APPROVER_AR[kind] };
    if (kind === 'unit_head') step.level = intIn(o.level, 0, 7, `مستوى الهيكل في الخطوة ${i + 1}`);
    if (kind === 'role') step.roleId = typeof o.roleId === 'string' && o.roleId ? o.roleId : bad(`اختر الدور في الخطوة ${i + 1}`);
    return step;
  });
}

export function normalizeTemplates(input: unknown): LetterTemplate[] {
  if (!Array.isArray(input)) return [];
  const ids = new Set<string>();
  return input.slice(0, 20).map((t, i) => {
    const o = (t ?? {}) as Record<string, unknown>;
    let id = typeof o.id === 'string' && /^[a-z0-9_-]{1,40}$/.test(o.id) ? o.id : `t${i + 1}`;
    while (ids.has(id)) id = `${id}x`;
    ids.add(id);
    return {
      id, name: text(o.name, 100) ?? bad(`اكتب اسم النموذج ${i + 1}`),
      body: (typeof o.body === 'string' && o.body.trim() ? o.body.trim().slice(0, 5000) : bad(`اكتب نص النموذج ${i + 1}`)) as string,
      withSalary: o.withSalary === true,
    };
  });
}

export function normalizePermissionKinds(input: unknown): PermissionKind[] {
  if (!Array.isArray(input)) return [];
  const codes = new Set<string>();
  return input.slice(0, 12).map((k, i) => {
    const o = (k ?? {}) as Record<string, unknown>;
    let code = typeof o.code === 'string' && /^[a-z][a-z0-9_]{0,29}$/.test(o.code) ? o.code : `k${i + 1}`;
    while (codes.has(code)) code = `${code}_${i}`;
    codes.add(code);
    return { code, name: text(o.name, 100) ?? bad(`اكتب اسم نوع الاستئذان ${i + 1}`), maxHours: optNum(o.maxHours, 0.25, 12, `ساعات ${String(o.name ?? '')}`) };
  });
}

export const isKind = (v: unknown): v is RequestKind => REQUEST_KINDS.includes(v as RequestKind);

// ---------------- القيود على التواريخ ----------------

const dayMs = 86400000;
export const addDaysStr = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);
export const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / dayMs);

/**
 * قيود تاريخ بداية الطلب حسب إعدادات النوع:
 * - لا يُقبل تاريخ سابق لليوم إلا في حدود «الأيام السابقة المسموحة» (مثل الإجازة المرضية بعد وقوعها)
 * - الإشعار المسبق: البداية بعد عدد أيام من اليوم (مثل الإجازة السنوية قبل أسبوع)
 * - أبعد تاريخ مسموح من اليوم
 */
export function checkStartDate(rules: RequestRules, start: string, today: string, label = 'تاريخ الطلب') {
  const delta = diffDays(today, start);
  if (delta < 0) {
    if (rules.allowPastDays === 0) bad(`لا يمكن أن يكون ${label} قبل تاريخ اليوم`);
    if (-delta > rules.allowPastDays) bad(`${label} يسبق اليوم بـ ${-delta} يومًا، والمسموح ${rules.allowPastDays} يومًا فقط`);
  }
  if (rules.minNoticeDays > 0 && delta < rules.minNoticeDays) {
    bad(`يجب تقديم الطلب قبل ${rules.minNoticeDays} يومًا على الأقل من ${label} (أقرب تاريخ مسموح ${addDaysStr(today, rules.minNoticeDays)})`);
  }
  if (rules.maxFutureDays && delta > rules.maxFutureDays) bad(`${label} بعيد جدًا، والمسموح حتى ${rules.maxFutureDays} يومًا من اليوم`);
}

/** شروط الأهلية: الجنس والجنسية ومدة الخدمة */
export function checkEligibility(rules: RequestRules, e: Pick<HrEmployee, 'gender' | 'isSaudi' | 'hireDate'>, today: string, typeName: string) {
  if (rules.gender && rules.gender !== e.gender) bad(`${typeName} ${rules.gender === 'female' ? 'للموظفات' : 'للموظفين'} فقط`);
  if (rules.nationality === 'saudi' && !e.isSaudi) bad(`${typeName} للموظفين السعوديين فقط`);
  if (rules.nationality === 'non_saudi' && e.isSaudi) bad(`${typeName} لغير السعوديين فقط`);
  const months = diffDays(e.hireDate, today) / 30.4;
  if (rules.minServiceMonths && months < rules.minServiceMonths) bad(`${typeName} بعد إكمال ${rules.minServiceMonths} شهرًا في الخدمة`);
}

export function eligible(rules: RequestRules, e: Pick<HrEmployee, 'gender' | 'isSaudi' | 'hireDate'>, today: string) {
  try {
    checkEligibility(rules, e, today, '');
    return true;
  } catch {
    return false;
  }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export function hoursBetween(from: string, to: string) {
  if (!TIME.test(from) || !TIME.test(to)) bad('اكتب الوقت بصيغة صحيحة');
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const d = m(to) - m(from);
  if (d <= 0) bad('وقت النهاية يجب أن يكون بعد وقت البداية');
  return Math.round((d / 60) * 100) / 100;
}

/** يتحقق من الحقول الإضافية ويعيد قيمها النظيفة */
export function checkFields(fields: RequestField[], values: Record<string, unknown> | undefined) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values?.[f.key];
    const empty = v === undefined || v === null || v === '' || (f.type === 'checkbox' && v !== true);
    if (empty) {
      if (f.required) bad(`أكمل حقل «${f.label}»`);
      continue;
    }
    if (f.type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) bad(`«${f.label}» يجب أن يكون رقمًا`);
      out[f.key] = n;
    } else if (f.type === 'date') {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) bad(`«${f.label}» تاريخ غير صحيح`);
      out[f.key] = v;
    } else if (f.type === 'time') {
      if (typeof v !== 'string' || !TIME.test(v)) bad(`«${f.label}» وقت غير صحيح`);
      out[f.key] = v;
    } else if (f.type === 'select') {
      if (!f.options?.includes(String(v))) bad(`اختر قيمة صحيحة في «${f.label}»`);
      out[f.key] = String(v);
    } else if (f.type === 'checkbox') out[f.key] = true;
    else out[f.key] = String(v).trim().slice(0, f.type === 'textarea' ? 2000 : 300);
  }
  return out;
}

// ---------------- خط التبعية الإدارية ----------------

/**
 * مدير الموظف في الهيكل: المدير المحدد في ملفه، وإلا مدير وحدته، وإن كان هو مدير وحدته فمدير الوحدة الأعلى.
 */
export function reportingLine(employees: Pick<HrEmployee, 'id' | 'managerId' | 'unitId' | 'status'>[], units: Pick<HrUnit, 'id' | 'parentId' | 'managerEmployeeId' | 'level'>[]) {
  const unitMap = new Map(units.map((u) => [u.id, u]));
  const active = new Set(employees.filter((e) => e.status === 'active').map((e) => e.id));
  const managerOf = (e: Pick<HrEmployee, 'id' | 'managerId' | 'unitId'>): string | null => {
    if (e.managerId && e.managerId !== e.id && active.has(e.managerId)) return e.managerId;
    let u = unitMap.get(e.unitId);
    const seen = new Set<string>();
    while (u && !seen.has(u.id)) {
      seen.add(u.id);
      if (u.managerEmployeeId && u.managerEmployeeId !== e.id && active.has(u.managerEmployeeId)) return u.managerEmployeeId;
      u = u.parentId ? unitMap.get(u.parentId) : undefined;
    }
    return null;
  };
  const map = new Map(employees.map((e) => [e.id, managerOf(e)]));
  /** سلسلة المديرين من الأقرب للأعلى */
  const chain = (id: string) => {
    const out: string[] = [];
    let cur = map.get(id) ?? null;
    while (cur && !out.includes(cur) && cur !== id) {
      out.push(cur);
      cur = map.get(cur) ?? null;
    }
    return out;
  };
  /** كل من يتبع الموظف مباشرة أو بشكل غير مباشر */
  const team = (id: string) => employees.filter((e) => e.id !== id && e.status === 'active' && chain(e.id).includes(id)).map((e) => e.id);
  const direct = (id: string) => employees.filter((e) => e.status === 'active' && map.get(e.id) === id).map((e) => e.id);
  /** مدير الوحدة في مستوى معيّن فوق وحدة الموظف (أو وحدته نفسها) */
  const unitHead = (e: Pick<HrEmployee, 'id' | 'unitId'>, level: number) => {
    let u = unitMap.get(e.unitId);
    const seen = new Set<string>();
    while (u && !seen.has(u.id)) {
      seen.add(u.id);
      if (u.level === level) return u.managerEmployeeId && active.has(u.managerEmployeeId) ? u.managerEmployeeId : null;
      if (u.level < level) return null;
      u = u.parentId ? unitMap.get(u.parentId) : undefined;
    }
    return null;
  };
  const top = () => {
    const roots = units.filter((u) => !u.parentId).sort((a, b) => a.level - b.level);
    for (const r of roots) if (r.managerEmployeeId && active.has(r.managerEmployeeId)) return r.managerEmployeeId;
    return null;
  };
  return { managerOf: (id: string) => map.get(id) ?? null, chain, team, direct, unitHead, top };
}

// ---------------- الخطابات ----------------

/** المتغيرات المتاحة في نماذج الخطابات */
export const LETTER_VARS: { key: string; label: string }[] = [
  { key: 'اسم_الموظف', label: 'اسم الموظف' }, { key: 'رقم_الهوية', label: 'رقم الهوية أو الإقامة' }, { key: 'الجنسية', label: 'الجنسية' },
  { key: 'الرقم_الوظيفي', label: 'الرقم الوظيفي' }, { key: 'المسمى_الوظيفي', label: 'المسمى الوظيفي' }, { key: 'الإدارة', label: 'الإدارة أو القسم' },
  { key: 'تاريخ_المباشرة', label: 'تاريخ المباشرة' }, { key: 'مدة_الخدمة', label: 'مدة الخدمة' }, { key: 'الراتب_الأساسي', label: 'الراتب الأساسي' },
  { key: 'البدلات', label: 'تفصيل البدلات' }, { key: 'إجمالي_الراتب', label: 'إجمالي الراتب' }, { key: 'الجهة', label: 'الجهة الموجه إليها الخطاب' },
  { key: 'اسم_الجمعية', label: 'اسم الجمعية' }, { key: 'التاريخ', label: 'تاريخ الخطاب' }, { key: 'التاريخ_الهجري', label: 'التاريخ الهجري' },
  { key: 'رقم_الخطاب', label: 'رقم الخطاب' },
];

export function renderLetter(body: string, vars: Record<string, string>) {
  return body.replace(/\{([^{}\s]{2,30})\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

export const money = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ريال`;

// ---------------- الأنواع الافتراضية ----------------

const step = (kind: ApprovalStepDef['kind'], name?: string, extra: Partial<ApprovalStepDef> = {}): ApprovalStepDef => ({ kind, name: name ?? APPROVER_AR[kind], ...extra });

export interface DefaultType {
  code: string; name: string; kind: RequestKind; category: string; description: string; color: string;
  approval: ApprovalStepDef[]; rules: Partial<RequestRules>; leaveTypes?: string[]; permissionKinds?: PermissionKind[]; templates?: LetterTemplate[]; fields?: RequestField[];
}

const SALARY_BODY = `إلى من يهمه الأمر
{الجهة}

تشهد {اسم_الجمعية} بأن السيد/ة {اسم_الموظف}، {الجنسية} الجنسية، بموجب هوية رقم {رقم_الهوية}، يعمل لديها بوظيفة {المسمى_الوظيفي} في {الإدارة} منذ تاريخ {تاريخ_المباشرة}، ولا يزال على رأس العمل حتى تاريخه.

ويتقاضى راتبًا شهريًا إجماليًا قدره {إجمالي_الراتب}، تفصيله:
الراتب الأساسي: {الراتب_الأساسي}
{البدلات}

وقد أُعطي هذا الخطاب بناءً على طلبه دون أدنى مسؤولية على الجمعية.`;

const NO_SALARY_BODY = `إلى من يهمه الأمر
{الجهة}

تشهد {اسم_الجمعية} بأن السيد/ة {اسم_الموظف}، {الجنسية} الجنسية، بموجب هوية رقم {رقم_الهوية}، يعمل لديها بوظيفة {المسمى_الوظيفي} في {الإدارة} منذ تاريخ {تاريخ_المباشرة}، ولا يزال على رأس العمل حتى تاريخه.

وقد أُعطي هذا الخطاب بناءً على طلبه دون أدنى مسؤولية على الجمعية.`;

const BANK_BODY = `المكرمين/ {الجهة}
السلام عليكم ورحمة الله وبركاته،

نفيدكم بأن السيد/ة {اسم_الموظف} (هوية رقم {رقم_الهوية}) يعمل لدى {اسم_الجمعية} بوظيفة {المسمى_الوظيفي} منذ {تاريخ_المباشرة}، براتب شهري إجمالي قدره {إجمالي_الراتب}، يُحوَّل إلى حسابه لديكم.

وتلتزم الجمعية بإشعاركم في حال انتهاء خدماته، وقد أُعطي هذا الخطاب بناءً على طلبه.`;

const EXPERIENCE_BODY = `شهادة خبرة

تشهد {اسم_الجمعية} بأن السيد/ة {اسم_الموظف}، {الجنسية} الجنسية، بموجب هوية رقم {رقم_الهوية}، عمل لديها بوظيفة {المسمى_الوظيفي} في {الإدارة} من تاريخ {تاريخ_المباشرة} لمدة {مدة_الخدمة}، وكان خلالها مثالًا في حسن الأداء والالتزام.

وقد أُعطيت هذه الشهادة بناءً على طلبه، متمنين له التوفيق.`;

export function defaultRequestTypes(): DefaultType[] {
  return [
    {
      code: 'leave', name: 'طلب إجازة', kind: 'leave', category: 'الإجازات', color: '#14b8a6',
      description: 'الإجازة السنوية وإجازات المناسبات حسب لائحة الجمعية، ويُخصم من رصيدك بعد الاعتماد',
      approval: [step('direct_manager'), step('hr')],
      rules: { allowPastDays: 0, minNoticeDays: 3, maxFutureDays: 180, attachment: 'optional' },
      leaveTypes: ['annual', 'marriage', 'bereavement', 'paternity', 'maternity', 'hajj', 'exam', 'unpaid'],
    },
    {
      code: 'sick_leave', name: 'إجازة مرضية', kind: 'leave', category: 'الإجازات', color: '#f43f5e',
      description: 'تُقدَّم بعد وقوعها بأيام قليلة، ويلزم إرفاق التقرير الطبي',
      approval: [step('direct_manager'), step('hr')],
      rules: { allowPastDays: 5, minNoticeDays: 0, maxFutureDays: 30, attachment: 'required', attachmentHint: 'التقرير الطبي المعتمد (صحتي)' },
      leaveTypes: ['sick'],
    },
    {
      code: 'permission', name: 'استئذان', kind: 'permission', category: 'الاستئذان', color: '#f59e0b',
      description: 'تأخر صباحي أو خروج مبكر أو خروج أثناء الدوام لساعات محدودة',
      approval: [step('direct_manager')],
      rules: { allowPastDays: 0, maxFutureDays: 30, maxPerMonth: 4, maxHoursPerMonth: 8, attachment: 'none' },
      permissionKinds: [
        { code: 'late', name: 'تأخر صباحي', maxHours: 2 }, { code: 'early', name: 'خروج مبكر', maxHours: 2 },
        { code: 'personal', name: 'خروج أثناء الدوام لظرف شخصي', maxHours: 3 }, { code: 'official', name: 'مهمة رسمية خارج المقر', maxHours: 6 },
      ],
    },
    {
      code: 'exit_reentry', name: 'تأشيرة خروج وعودة', kind: 'exit_reentry', category: 'الخدمات الحكومية', color: '#0ea5e9',
      description: 'إصدار تأشيرة خروج وعودة عبر منصة مقيم، لغير السعوديين',
      approval: [step('direct_manager'), step('hr')],
      rules: { nationality: 'non_saudi', allowPastDays: 0, minNoticeDays: 7, maxFutureDays: 180, oneOpen: true, attachment: 'optional', attachmentHint: 'صورة الجواز أو تذكرة السفر' },
    },
    {
      code: 'salary_certificate', name: 'خطاب تعريف', kind: 'letter', category: 'الخطابات', color: '#8b5cf6',
      description: 'تعريف بالراتب أو بدونه أو موجه لبنك، أو شهادة خبرة، ويُطبع بعد الاعتماد',
      approval: [step('hr')],
      rules: { maxPerMonth: 3, attachment: 'none' },
      templates: [
        { id: 'salary', name: 'تعريف بالراتب', body: SALARY_BODY, withSalary: true },
        { id: 'no_salary', name: 'تعريف بدون راتب', body: NO_SALARY_BODY, withSalary: false },
        { id: 'bank', name: 'تعريف موجه لبنك', body: BANK_BODY, withSalary: true },
        { id: 'experience', name: 'شهادة خبرة', body: EXPERIENCE_BODY, withSalary: false },
      ],
    },
    {
      code: 'advance', name: 'طلب سلفة', kind: 'advance', category: 'الطلبات المالية', color: '#ec4899',
      description: 'سلفة على الراتب تُسترد بأقساط شهرية من مسير الرواتب',
      approval: [step('direct_manager'), step('hr'), step('top_manager', 'المدير التنفيذي')],
      rules: { minServiceMonths: 6, maxSalaryMultiple: 2, maxInstallments: 10, oneOpen: true, attachment: 'none' },
    },
    {
      code: 'general', name: 'طلب عام', kind: 'general', category: 'أخرى', color: '#64748b',
      description: 'أي طلب آخر لشؤون الموظفين، مثل تحديث بيانات أو عهدة',
      approval: [step('direct_manager'), step('hr')],
      rules: { attachment: 'optional' },
      fields: [
        { key: 'subject', label: 'موضوع الطلب', type: 'text', required: true, hint: null },
        { key: 'details', label: 'التفاصيل', type: 'textarea', required: true, hint: null },
      ],
    },
  ];
}
