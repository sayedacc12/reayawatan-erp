import { ValueTransformer } from 'typeorm';

/** PostgreSQL يرجّع numeric كنص؛ نحوله لرقم */
export const money: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};
