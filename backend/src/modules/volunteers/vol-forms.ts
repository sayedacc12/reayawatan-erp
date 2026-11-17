import { BadRequestException } from '@nestjs/common';
import {
  AUDIENCES, Audience, CertificateTemplates, ContractClause, DocSection, FIELD_TYPES, FieldType, FormField, LookupItem, QUESTION_TYPES,
  QuestionType, SurveyQuestion,
} from './entities/volunteers.entity';

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const keyOf = (v: unknown, i: number, prefix: string, used: Set<string>) => {
  let key = String(v ?? '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) key = `${prefix}${i + 1}`;
  while (used.has(key)) key = `${key}_${i + 1}`;
  used.add(key);
  return key;
};

/** يتحقق من حقول نموذج مرن قادم من الإعدادات وينظفه */
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

/** يتحقق من إجابات نموذج مرن حسب تعريف حقوله، ويرجع الإجابات النظيفة فقط */
export function validateAnswers(fields: FormField[], input: unknown): Record<string, unknown> {
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

/** قائمة قابلة للتعريف: الرمز ثابت بعد الإنشاء، والعنصر المستخدم يُوقف ولا يُحذف */
export function normalizeLookups(input: unknown, what: string, used: Set<string> = new Set()): LookupItem[] {
  if (!Array.isArray(input) || !input.length) throw new BadRequestException(`أضف عنصرًا واحدًا على الأقل في ${what}`);
  if (input.length > 60) throw new BadRequestException(`أقصى عدد في ${what} 60 عنصرًا`);
  const codes = new Set<string>();
  const names = new Set<string>();
  const items = input.map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const name = str(r.name, 150);
    if (!name) throw new BadRequestException(`اكتب اسم العنصر رقم ${i + 1} في ${what}`);
    if (names.has(name)) throw new BadRequestException(`الاسم «${name}» مكرر في ${what}`);
    names.add(name);
    return { code: keyOf(r.code, i, 'c', codes), name, description: str(r.description, 500) || null, isActive: r.isActive !== false };
  });
  for (const code of used) {
    if (!items.some((x) => x.code === code)) throw new BadRequestException(`لا يمكن حذف عنصر مستخدم في ${what}، أوقفه بدلًا من الحذف`);
  }
  return items;
}

export function normalizeQuestions(input: unknown): Record<Audience, SurveyQuestion[]> {
  const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out = {} as Record<Audience, SurveyQuestion[]>;
  for (const a of AUDIENCES) {
    const list = data[a];
    const label = a === 'volunteer' ? 'استبانة المتطوعين' : 'استبانة المستفيدين';
    if (!Array.isArray(list) || !list.length) throw new BadRequestException(`أضف سؤالًا واحدًا على الأقل في ${label}`);
    if (list.length > 30) throw new BadRequestException(`أقصى عدد أسئلة في ${label} 30 سؤالًا`);
    const keys = new Set<string>();
    out[a] = list.map((raw, i) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const text = str(r.text, 300);
      if (!text) throw new BadRequestException(`اكتب نص السؤال رقم ${i + 1} في ${label}`);
      const type = r.type as QuestionType;
      if (!QUESTION_TYPES.includes(type)) throw new BadRequestException(`نوع السؤال «${text}» غير صحيح`);
      return { key: keyOf(r.key, i, 'q', keys), text, type, required: r.required !== false && type !== 'text' ? true : !!r.required };
    });
  }
  return out;
}

/** يتحقق من إجابات الاستبانة ويحسب نسبة الرضا (التقييم من 5 والإجابة بنعم = 100%) */
export function scoreSurvey(questions: SurveyQuestion[], input: unknown) {
  const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const answers: Record<string, unknown> = {};
  const scores: number[] = [];
  for (const q of questions) {
    const v = data[q.key];
    const empty = v === undefined || v === null || v === '';
    if (empty) {
      if (q.required) throw new BadRequestException(`أجب عن السؤال: ${q.text}`);
      continue;
    }
    if (q.type === 'rating') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw new BadRequestException(`التقييم من 1 إلى 5 في: ${q.text}`);
      answers[q.key] = n;
      scores.push(((n - 1) / 4) * 100);
    } else if (q.type === 'yesno') {
      if (v !== 'yes' && v !== 'no') throw new BadRequestException(`اختر نعم أو لا في: ${q.text}`);
      answers[q.key] = v;
      scores.push(v === 'yes' ? 100 : 0);
    } else {
      answers[q.key] = String(v).trim().slice(0, 2000);
    }
  }
  const score = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null;
  return { answers, score };
}

export function normalizeClauses(input: unknown): ContractClause[] {
  if (!Array.isArray(input) || !input.length) throw new BadRequestException('أضف فقرة واحدة على الأقل في عقد التطوع');
  if (input.length > 60) throw new BadRequestException('أقصى عدد فقرات في العقد 60 فقرة');
  const keys = new Set<string>();
  const clauses = input.map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const title = str(r.title, 200);
    const body = str(r.body, 5000);
    if (!title || !body) throw new BadRequestException(`اكتب عنوان الفقرة رقم ${i + 1} ونصها`);
    return { key: keyOf(r.key, i, 'cl', keys), title, body, isActive: r.isActive !== false };
  });
  if (!clauses.some((c) => c.isActive)) throw new BadRequestException('فعّل فقرة واحدة على الأقل في العقد');
  return clauses;
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

export function normalizeCertificates(input: unknown): CertificateTemplates {
  const r = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const t: CertificateTemplates = {
    hoursTitle: str(r.hoursTitle, 200), hoursBody: str(r.hoursBody, 3000),
    thanksTitle: str(r.thanksTitle, 200), thanksBody: str(r.thanksBody, 3000),
    signatoryName: str(r.signatoryName, 200), signatoryTitle: str(r.signatoryTitle, 200),
  };
  if (!t.hoursTitle || !t.hoursBody) throw new BadRequestException('اكتب عنوان شهادة الساعات ونصها');
  if (!t.thanksTitle || !t.thanksBody) throw new BadRequestException('اكتب عنوان شهادة الشكر ونصها');
  return t;
}

/** يستبدل المتغيرات {الاسم} بقيمها، ويترك المتغير غير المعروف كما هو */
export function fillTemplate(text: string, vars: Record<string, string>) {
  return text.replace(/\{([^{}]{1,40})\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}
