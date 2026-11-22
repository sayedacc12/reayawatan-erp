import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * الفوترة: تاريخ نفاذ التسجيل في ضريبة القيمة المضافة، والحساب البنكي المطبوع في الفاتورة. عمودان جديدان يقبلان الفراغ
 * (فراغ التاريخ يعني أن التسجيل نافذ)، فلا يتغير سلوك أي بيانات قائمة. قابلة للتراجع.
 */
export class BillingVatEffectiveDate1795600000000 implements MigrationInterface {
    name = 'BillingVatEffectiveDate1795600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "bl_settings" ADD "vat_effective_from" date`);
        await queryRunner.query(`ALTER TABLE "bl_settings" ADD "payment_cash_account_id" uuid`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "bl_settings" DROP COLUMN "payment_cash_account_id"`);
        await queryRunner.query(`ALTER TABLE "bl_settings" DROP COLUMN "vat_effective_from"`);
    }
}
