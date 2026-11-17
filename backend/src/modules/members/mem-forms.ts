import { BadRequestException } from '@nestjs/common';
import {
  DocSection, DocumentRequirement, FIELD_TYPES, FieldType, FormField, MembershipCondition, MembershipType,
} from './entities/members.entity';

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const keyOf = (v: unknown, i: number, prefix: string, used: Set<string>) => {
  let key = String(v ?? '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) key = `${prefix}${i + 1}`;
  while (used.has(key)) key = `${key}_${i + 1}`;
  used.add(key);
  return key;
};
const money = (v: unknown, what: string) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new BadRequestException(`${what} يجب أن يكون رقمًا من صفر فأكثر`);
  return Math.round(n * 100) / 100;
};

/** يتحقق من حقول النموذج الإضافية القادمة من الإعدادات وينظفها */
export function normalizeFields(input: unknown, what: string): FormField[] {
  if (!Array.isArray(input)) throw new BadRequestException(`حقول ${what} غير صحيحة`);
  if (input.length > 40) throw new BadRequestException(`أقصى عدد حقول في ${what} 40 حقلًا`);
  const keys = new Set<string>();
  return input.map((raw, i) => {
    const f = (raw ?? {}) as Record<string, unknown>;
    const label = str(f.label, 200);
    if (!label) throw new BadRequestException(`اكتب اسم الحقل رقم ${i + 1} في ${what}`);
    const type = f.type as FieldType;
    if (!FIELD_TYPES.includes(type)) throw new BadRequestException(`نوع الحقل «${label}» غير صحيح`);
    const field: FormField = { key: keyOf(f.key, i, 'f', keys), label, type, required: !!f.required };
    if (typeof f.placeholder === 'string' && f.placeholder.trim()) field.placeholder = str(f.placeholder, 200);
    if (type === 'select') {
      const options = Array.isArray(f.options) ? [...new Set(f.options.map((o) => str(o, 200)).filter(Boolean))].slice(0, 50) : [];
      if (!options.length) throw new BadRequestException(`أضف خيارات للقائمة «${label}»`);
      field.options = options;
    }
    return field;
  });
}

/** يتحقق من إجابات الحقول الإضافية حسب تعريفها، ويرجع الإجابات النظيفة فقط */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validateAnswers(fields: FormField[], input: unknown): Record<string, any> {
  const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    let v = data[f.key];
    if (typeof v === 'string') v = v.trim();
    const empty = v === undefined || v === null || v === '' || (f.type === 'checkbox' && v !== true);
    if (empty) {
      if (f.required) throw new BadRequestException(f.type === 'checkbox' ? `يجب تأكيد «${f.label}»` : `الحقل «${f.label}» مطلوب`);
      if (f.type === 'checkbox') out[f.key] = false;
      continue;
    }
    switch (f.type) {
      case 'number': {
        const n = Number(String(v).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)));
        if (!Number.isFinite(n)) throw new BadRequestException(`الحقل «${f.label}» يجب أن يكون رقمًا`);
        out[f.key] = n;
        break;
      }
      case 'date':
        if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BadRequestException(`تاريخ «${f.label}» غير صحيح`);
        out[f.key] = v;
        break;
      case 'select':
        if (!f.options?.includes(String(v))) throw new BadRequestException(`اختر قيمة صحيحة في «${f.label}»`);
        out[f.key] = String(v);
        break;
      case 'checkbox':
        out[f.key] = true;
        break;
      default:
        out[f.key] = String(v).slice(0, f.type === 'textarea' ? 4000 : 500);
    }
  }
  return out;
}

/** أنواع العضوية: الرمز ثابت، والنوع المستخدم يُوقف ولا يُحذف */
export function normalizeTypes(input: unknown, used: Set<string>): MembershipType[] {
  if (!Array.isArray(input) || !input.length) throw new BadRequestException('أضف نوع عضوية واحدًا على الأقل');
  if (input.length > 20) throw new BadRequestException('أقصى عدد لأنواع العضوية 20 نوعًا');
  const codes = new Set<string>();
  const names = new Set<string>();
  const types = input.map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const name = str(r.name, 100);
    if (!name) throw new BadRequestException(`اكتب اسم نوع العضوية رقم ${i + 1}`);
    if (names.has(name)) throw new BadRequestException(`نوع العضوية «${name}» مكرر`);
    names.add(name);
    const duration = Number(r.durationMonths ?? 12);
    if (!Number.isInteger(duration) || duration < 1 || duration > 120) throw new BadRequestException(`مدة «${name}» بالأشهر من 1 إلى 120`);
    const minAge = r.minAge === null || r.minAge === undefined || r.minAge === '' ? null : Number(r.minAge);
    if (minAge !== null && (!Number.isInteger(minAge) || minAge < 0 || minAge > 100)) throw new BadRequestException(`أقل عمر في «${name}» غير صحيح`);
    const votingAfterDays = Number(r.votingAfterDays ?? 0);
    if (!Number.isInteger(votingAfterDays) || votingAfterDays < 0 || votingAfterDays > 3650) throw new BadRequestException(`مدة اكتساب حق التصويت في «${name}» غير صحيحة`);
    const color = typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : '#0f766e';
    const revenueAccountId = typeof r.revenueAccountId === 'string' && /^[0-9a-f-]{36}$/i.test(r.revenueAccountId) ? r.revenueAccountId : null;
    return {
      code: keyOf(r.code, i, 't', codes), name, description: str(r.description, 500) || null,
      fee: money(r.fee, `قيمة اشتراك «${name}»`), joiningFee: money(r.joiningFee, `رسوم انتساب «${name}»`), durationMonths: duration,
      votingRights: !!r.votingRights, votingAfterDays, minAge, saudiOnly: !!r.saudiOnly, publicApply: r.publicApply !== false,
      benefits: str(r.benefits, 2000) || null, revenueAccountId, color, isActive: r.isActive !== false,
    };
  });
  for (const code of used) {
    if (!types.some((t) => t.code === code)) throw new BadRequestException('لا يمكن حذف نوع عضوية مستخدم، أوقفه بدلًا من الحذف');
  }
  if (!types.some((t) => t.isActive)) throw new BadRequestException('فعّل نوع عضوية واحدًا على الأقل');
  return types;
}

export function normalizeConditions(input: unknown): MembershipCondition[] {
  if (!Array.isArray(input)) throw new BadRequestException('شروط العضوية غير صحيحة');
  if (input.length > 40) throw new BadRequestException('أقصى عدد لشروط العضوية 40 شرطًا');
  const keys = new Set<string>();
  return input.map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const text = str(r.text, 1000);
    if (!text) throw new BadRequestException(`اكتب نص الشرط رقم ${i + 1}`);
    return { key: keyOf(r.key, i, 'c', keys), text, reference: str(r.reference, 200) || null, isActive: r.isActive !== false };
  });
}

export function normalizeDocuments(input: unknown): DocumentRequirement[] {
  if (!Array.isArray(input)) throw new BadRequestException('المستندات المطلوبة غير صحيحة');
  if (input.length > 10) throw new BadRequestException('أقصى عدد للمستندات المطلوبة 10 مستندات');
  const keys = new Set<string>();
  return input.map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const name = str(r.name, 150);
    if (!name) throw new BadRequestException(`اكتب اسم المستند رقم ${i + 1}`);
    return { key: keyOf(r.key, i, 'd', keys), name, required: !!r.required, isActive: r.isActive !== false };
  });
}

export function normalizeSections(input: unknown): DocSection[] {
  if (!Array.isArray(input) || !input.length) throw new BadRequestException('أضف قسمًا واحدًا على الأقل');
  if (input.length > 80) throw new BadRequestException('أقصى عدد أقسام 80 قسمًا');
  return input.map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const title = str(r.title, 200);
    const body = str(r.body, 10000);
    if (!title || !body) throw new BadRequestException(`اكتب عنوان القسم رقم ${i + 1} ونصه`);
    return { title, body };
  });
}

/** يستبدل المتغيرات {الاسم} بقيمها، ويترك المتغير غير المعروف كما هو */
export function fillTemplate(text: string, vars: Record<string, string>) {
  return text.replace(/\{([^{}]{1,40})\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

/** العمر بالسنوات الكاملة في تاريخ معين */
export function ageOn(birthDate: string, on: string) {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** إضافة أشهر لتاريخ (مع ضبط آخر الشهر) */
export function addMonths(date: string, months: number) {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number) {
  return new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string) {
  return Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86400000);
}

/** نهاية مدة عضوية تبدأ من تاريخ معين: آخر يوم قبل نفس التاريخ بعد المدة */
export const periodEnd = (start: string, months: number) => addDays(addMonths(start, months), -1);
