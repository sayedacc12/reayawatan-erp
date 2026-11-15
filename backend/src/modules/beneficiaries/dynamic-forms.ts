import { BadRequestException } from '@nestjs/common';
import type { FieldType, FormField, ScoreOutcome, ScoreRule } from './entities';

export const FIELD_TYPES: FieldType[] = ['text', 'textarea', 'number', 'date', 'select', 'checkbox'];

/** يتحقق من تعريف حقول نموذج قادم من شاشة الإعدادات وينظفه */
export function normalizeFields(input: unknown, scored = false): FormField[] {
  if (!Array.isArray(input)) throw new BadRequestException('حقول النموذج غير صحيحة');
  if (input.length > 60) throw new BadRequestException('أقصى عدد حقول في النموذج 60');
  const keys = new Set<string>();
  const fields = input.map((raw, i) => {
    const f = (raw ?? {}) as Record<string, unknown>;
    const label = String(f.label ?? '').trim();
    if (!label) throw new BadRequestException(`اكتب اسم الحقل رقم ${i + 1}`);
    const type = f.type as FieldType;
    if (!FIELD_TYPES.includes(type)) throw new BadRequestException(`نوع الحقل "${label}" غير صحيح`);
    let key = String(f.key ?? '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) key = `f${i + 1}`;
    while (keys.has(key)) key = `${key}_${i + 1}`;
    keys.add(key);
    const field: FormField = { key, label: label.slice(0, 200), type, required: !!f.required };
    if (typeof f.placeholder === 'string' && f.placeholder.trim()) field.placeholder = f.placeholder.trim().slice(0, 200);
    if (type === 'select') {
      const options = Array.isArray(f.options)
        ? [...new Set(f.options.map((o) => String(o).trim()).filter(Boolean))].slice(0, 50)
        : [];
      if (!options.length) throw new BadRequestException(`أضف خيارات للقائمة "${label}"`);
      field.options = options.map((o) => o.slice(0, 200));
    }
    if (scored) scoreField(field, f);
    return field;
  });
  if (scored) {
    const total = fields.reduce((sum, f) => sum + (f.weight ?? 0), 0);
    if (Math.abs(total - 100) > 0.001) {
      throw new BadRequestException(`إجمالي الأهمية النسبية للبنود لازم يكون 100%، الإجمالي الحالي ${round(total)}%`);
    }
  }
  return fields;
}

const round = (n: number) => Math.round(n * 100) / 100;
const pct = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? round(n) : NaN;
};

/** أوزان ودرجات بند في نموذج التقييم: القائمة (درجة لكل خيار) ومربع التأكيد (100 لو متعلم) فقط */
function scoreField(field: FormField, raw: Record<string, unknown>) {
  const weight = raw.weight === undefined || raw.weight === null || raw.weight === '' ? 0 : pct(raw.weight);
  if (Number.isNaN(weight)) throw new BadRequestException(`الأهمية النسبية للبند "${field.label}" لازم تكون من 0 لـ 100`);
  if (!weight) return;
  if (field.type !== 'select' && field.type !== 'checkbox') {
    throw new BadRequestException(`البند "${field.label}" مايتقيّمش. الأهمية النسبية بتتحط على القوائم ومربعات التأكيد بس`);
  }
  field.weight = weight;
  if (field.type === 'select') {
    const scores = Array.isArray(raw.optionScores) ? raw.optionScores.map(pct) : [];
    if (scores.length !== field.options!.length || scores.some((n) => Number.isNaN(n))) {
      throw new BadRequestException(`حط درجة من 0 لـ 100 لكل اختيار في "${field.label}"`);
    }
    field.optionScores = scores;
  }
}

/** قواعد نتيجة التقييم: نطاقات من 0 لـ 100 مايتداخلوش */
export function normalizeRules(input: unknown): ScoreRule[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 20) throw new BadRequestException('قواعد النتيجة غير صحيحة');
  const rules = input.map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const min = pct(r.min);
    const max = pct(r.max);
    if (Number.isNaN(min) || Number.isNaN(max) || min > max) {
      throw new BadRequestException(`القاعدة رقم ${i + 1}: النطاق لازم يكون من 0 لـ 100 والبداية أصغر من النهاية`);
    }
    const outcome = r.outcome as ScoreOutcome;
    if (!['reject', 'approve', 'contribution'].includes(outcome)) throw new BadRequestException(`القاعدة رقم ${i + 1}: اختر النتيجة`);
    const rule: ScoreRule = { min, max, outcome };
    if (outcome === 'contribution') {
      const c = pct(r.contributionPercent);
      if (Number.isNaN(c) || c <= 0) throw new BadRequestException(`القاعدة رقم ${i + 1}: اكتب نسبة مساهمة المستفيد (أكبر من 0 لحد 100)`);
      rule.contributionPercent = c;
    }
    return rule;
  }).sort((a, b) => a.min - b.min);
  for (let i = 1; i < rules.length; i++) {
    if (rules[i].min <= rules[i - 1].max) {
      throw new BadRequestException(`القواعد متداخلة: ${rules[i - 1].min}–${rules[i - 1].max} و ${rules[i].min}–${rules[i].max}`);
    }
  }
  return rules;
}

export interface ScoreResult {
  score: number;
  outcome: ScoreOutcome | null;
  contributionPercent: number;
}

/** يحسب نتيجة التقييم من 100: مجموع (أهمية البند × درجة الإجابة) ثم يطبق القواعد */
export function scoreAnswers(form: { fields: FormField[]; rules: ScoreRule[] }, data: Record<string, unknown>): ScoreResult {
  let score = 0;
  for (const f of form.fields) {
    if (!f.weight) continue;
    let s = 0;
    if (f.type === 'checkbox') s = data[f.key] === true ? 100 : 0;
    else if (f.type === 'select') {
      const i = f.options?.indexOf(String(data[f.key] ?? '')) ?? -1;
      s = i >= 0 ? f.optionScores?.[i] ?? 0 : 0;
    }
    score += (f.weight * s) / 100;
  }
  score = round(score);
  const rule = (form.rules ?? []).find((r) => score >= r.min && score <= r.max);
  return {
    score,
    outcome: rule?.outcome ?? null,
    contributionPercent: rule?.outcome === 'contribution' ? rule.contributionPercent ?? 0 : 0,
  };
}

/** يتحقق من إجابات نموذج حسب تعريف حقوله، ويرجع الإجابات النظيفة فقط */
export function validateAnswers(fields: FormField[], input: unknown): Record<string, unknown> {
  const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    let v = data[f.key];
    if (typeof v === 'string') v = v.trim();
    const empty = v === undefined || v === null || v === '' || (f.type === 'checkbox' && v !== true);
    if (empty) {
      if (f.required) {
        throw new BadRequestException(f.type === 'checkbox' ? `لازم تأكيد "${f.label}"` : `الحقل "${f.label}" مطلوب`);
      }
      if (f.type === 'checkbox') out[f.key] = false;
      continue;
    }
    switch (f.type) {
      case 'number': {
        const n = Number(String(v).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)));
        if (!Number.isFinite(n)) throw new BadRequestException(`الحقل "${f.label}" لازم يكون رقم`);
        out[f.key] = n;
        break;
      }
      case 'date':
        if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BadRequestException(`تاريخ "${f.label}" غير صحيح`);
        out[f.key] = v;
        break;
      case 'select':
        if (!f.options?.includes(String(v))) throw new BadRequestException(`اختر قيمة صحيحة في "${f.label}"`);
        out[f.key] = String(v);
        break;
      case 'checkbox':
        out[f.key] = true;
        break;
      default:
        out[f.key] = String(v).slice(0, f.type === 'textarea' ? 5000 : 500);
    }
  }
  return out;
}
