import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * فهارس كشفها اختبار الأداء مع البيانات الضخمة (جمعية بـ1.2 مليون سطر قيد و160 ألف طلب):
 * كل استعلام يربط أسطر القيود بقيودها أو يبحث عن تمويل طلب مستفيد كان يمسح الجدول كاملًا.
 */
export class PerformanceIndexes1795100000001 implements MigrationInterface {
  name = 'PerformanceIndexes1795100000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // أسطر القيد حسب القيد: فتح القيد، والتقارير واللوحات التي تجمع الأسطر لسنة مالية، وحذف القيد
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_acc_entry_lines_entry" ON "acc_entry_lines" ("entry_id")`);
    // أسطر حساب معيّن (كشف الحساب، أرصدة البنوك والصناديق، مطابقة الأصول)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_acc_entry_lines_account_entry" ON "acc_entry_lines" ("account_id", "entry_id")`);
    // كشف حساب الشريك
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_acc_entry_lines_partner_entry" ON "acc_entry_lines" ("partner_id", "entry_id") WHERE "partner_id" IS NOT NULL`);
    // قيود سنة مالية بحالتها وتاريخها (لوحة النظام المالي، ميزان المراجعة، الحوكمة)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_acc_entries_year_status_date" ON "acc_entries" ("fiscal_year_id", "status", "document_date")`);
    // المبالغ الممولة لكل طلب مستفيد (جهات توزيع التبرع، الدعم)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_fundraising_batches_request" ON "fundraising_batches" ("beneficiary_request_id") WHERE "beneficiary_request_id" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_project_allocations_request" ON "project_allocations" ("request_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_beneficiary_aids_request" ON "beneficiary_aids" ("request_id") WHERE "request_id" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of [
      'IDX_beneficiary_aids_request', 'IDX_project_allocations_request', 'IDX_fundraising_batches_request', 'IDX_acc_entries_year_status_date',
      'IDX_acc_entry_lines_partner_entry', 'IDX_acc_entry_lines_account_entry', 'IDX_acc_entry_lines_entry',
    ]) {
      await queryRunner.query(`DROP INDEX IF EXISTS "public"."${name}"`);
    }
  }
}
