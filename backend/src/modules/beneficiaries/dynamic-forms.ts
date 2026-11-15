import { BadRequestException } from '@nestjs/common';
import type { FieldType, FormField } from './entities';

export const FIELD_TYPES: FieldType[] = ['text', 'textarea', 'number', 'date', 'select', 'checkbox'];

/** يتحقق من تعريف حقول نموذج قادم من شاشة الإعدادات وينظفه */
export function normalizeFields(input: unknown): FormField[] {
  if (!Array.isArray(input)) throw new BadRequestException('حقول النموذج غير صحيحة');
  if (input.length > 60) throw new BadRequestException('أقصى عدد حقول في النموذج 60');
  const keys = new Set<string>();
  return input.map((raw, i) => {
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
    return field;
  });
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
