import { MigrationInterface, QueryRunner } from 'typeorm';

/** حساب فرعي للداعم على سطور القيود: مستحقات الوعد بالدفع تُتابع لكل داعم */
export class FundraisingDonorLedger1794749708040 implements MigrationInterface {
  name = 'FundraisingDonorLedger1794749708040';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ledger_lines" ADD "donor_id" uuid`);
    await queryRunner.query(`CREATE INDEX "IDX_f1bf09aa3786df5db0478640be" ON "ledger_lines" ("donor_id") `);
    // تعبئة القيود السابقة: مدين إثبات الوعد، ودائن سداده، ثم قيود العكس المقابلة لهما
    await queryRunner.query(`
      UPDATE ledger_lines l SET donor_id = o.donor_id
        FROM ledger_entries e JOIN fundraising_opportunities o ON o.id = e.source_id
       WHERE l.entry_id = e.id
         AND ((e.source_type = 'opportunity_pledge' AND l.debit > 0) OR (e.source_type = 'pledge_collection' AND l.credit > 0))`);
    await queryRunner.query(`
      UPDATE ledger_lines rl SET donor_id = ol.donor_id
        FROM ledger_entries re JOIN ledger_lines ol ON ol.entry_id = re.reversal_of_id
       WHERE rl.entry_id = re.id AND ol.line_no = rl.line_no AND ol.donor_id IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_f1bf09aa3786df5db0478640be"`);
    await queryRunner.query(`ALTER TABLE "ledger_lines" DROP COLUMN "donor_id"`);
  }
}
