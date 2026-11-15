import { ValueTransformer } from 'typeorm';

/** PostgreSQL يرجّع numeric كنص؛ نحوله لرقم */
export const money: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};

export const moneyCol = (name: string, nullable = false) => ({
  name, type: 'numeric' as const, precision: 14, scale: 2, transformer: money, nullable, ...(nullable ? {} : { default: 0 }),
});
