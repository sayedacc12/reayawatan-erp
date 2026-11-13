import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { join } from 'path';

export function dataSourceOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    url: process.env.DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp',
    // كل الوحدات تشترك في قاعدة بيانات واحدة؛ الكيانات تُكتشف من أي مجلد entities
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, '..', 'migrations', '*.{ts,js}')],
    synchronize: false,
    // gen_random_uuid() مدمجة في PostgreSQL 13+ بدون إضافات
    uuidExtension: 'pgcrypto',
  };
}

export default new DataSource(dataSourceOptions());
