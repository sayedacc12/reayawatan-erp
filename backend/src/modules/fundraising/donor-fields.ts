import { BadRequestException } from '@nestjs/common';
import type { DonorField, DonorFieldType } from './entities';

export const DONOR_FIELD_TYPES: DonorFieldType[] = ['text', 'textarea', 'number', 'percent', 'mobile', 'email', 'date', 'select', 'checkbox'];

const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));

/** يتحقق من تعريف الحقول المرنة لسجل الداعمين وينظفه (المفاتيح ثابتة حتى لا تضيع البيانات) */
export function normalizeDonorFields(input: unknown[]): DonorField[] {
  const keys = new Set<string>();
  return input.map((raw, i) => {
    const f = (raw ?? {}) as Record<string, unknown>;
    const label = String(f.label ?? '').trim();
    if (label.length < 2) throw new BadRequestException(`اكتب اسم الحقل رقم ${i + 1}`);
    const type = f.type as DonorFieldType;
    if (!DONOR_FIELD_TYPES.includes(type)) throw new BadRequestException(`نوع الحقل "${label}" غير صحيح`);
    let key = String(f.key ?? '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) key = `f${Date.now().toString(36)}${i}`;
    if (keys.has(key)) throw new BadRequestException(`الحقل "${label}" مكرر`);
    keys.add(key);
    const field: DonorField = { key, label: label.slice(0, 200), type, required: !!f.required, isActive: f.isActive !== false };
    if (type === 'select') {
      const options = Array.isArray(f.options) ? [...new Set(f.options.map((o) => String(o).trim()).filter(Boolean))].slice(0, 50) : [];
      if (!options.length) throw new BadRequestException(`أضف خيارات للقائمة "${label}"`);
      field.options = options;
    }
    if (type === 'number' || type === 'percent') {
      let min = num(f.min);
      let max = num(f.max);
      if (type === 'percent') { min = min ?? 0; max = max ?? 100; }
      if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max)) || (min !== null && max !== null && min > max)) {
        throw new BadRequestException(`حدود الحقل "${label}" غير صحيحة`);
      }
      if (type === 'percent' && (min! < 0 || max! > 100)) throw new BadRequestException(`حدود النسبة في "${label}" من 0 إلى 100`);
      field.min = min;
      field.max = max;
    }
    return field;
  });
}

/** يتحقق من قيم الحقول المرنة لداعم حسب ضوابطها */
export function validateDonorData(fields: DonorField[], data: Record<string, unknown> | undefined, previous: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = { ...previous };
  const input = data ?? {};
  for (const f of fields) {
    if (!f.isActive) continue;
    const v = input[f.key];
    const empty = v === undefined || v === null || v === '' || (f.type === 'checkbox' && v === false && f.required);
    if (empty) {
      if (f.required) throw new BadRequestException(`الحقل "${f.label}" مطلوب`);
      delete out[f.key];
      continue;
    }
    switch (f.type) {
      case 'number':
      case 'percent': {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new BadRequestException(`الحقل "${f.label}" يجب أن يكون رقمًا`);
        if (f.min !== null && f.min !== undefined && n < f.min) throw new BadRequestException(`الحقل "${f.label}" لا يقل عن ${f.min}`);
        if (f.max !== null && f.max !== undefined && n > f.max) throw new BadRequestException(`الحقل "${f.label}" لا يزيد عن ${f.max}`);
        out[f.key] = n;
        break;
      }
      case 'mobile': {
        const s = String(v).replace(/\s/g, '');
        if (!/^(\+9665|009665|9665|05)[0-9]{8}$/.test(s)) throw new BadRequestException(`الحقل "${f.label}": أدخل رقم جوال سعودي صحيح مثل 05xxxxxxxx`);
        out[f.key] = s;
        break;
      }
      case 'email': {
        const s = String(v).trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new BadRequestException(`الحقل "${f.label}": البريد الإلكتروني غير صحيح`);
        out[f.key] = s;
        break;
      }
      case 'date': {
        const s = String(v);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new BadRequestException(`الحقل "${f.label}": التاريخ غير صحيح`);
        out[f.key] = s;
        break;
      }
      case 'select':
        if (!f.options?.includes(String(v))) throw new BadRequestException(`اختر قيمة صحيحة في "${f.label}"`);
        out[f.key] = String(v);
        break;
      case 'checkbox':
        out[f.key] = v === true;
        break;
      default:
        out[f.key] = String(v).slice(0, f.type === 'textarea' ? 4000 : 500);
    }
  }
  return out;
}
