import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * المتعاونون: نوع العلاقة وأساس الأجر وقيمته في ملف الموظف، ونوع كشف الرواتب (الموظفون أو المتعاونون)
 * فيصبح لكل شهر كشفان مستقلان. أعمدة جديدة فقط بقيم افتراضية تحفظ البيانات القائمة، وقابلة للتراجع.
 */
export class HrContractors1795292529549 implements MigrationInterface {
    name = 'HrContractors1795292529549'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hr_employees" ADD "employment_kind" character varying(12) NOT NULL DEFAULT 'staff'`);
        await queryRunner.query(`ALTER TABLE "hr_employees" ADD "pay_basis" character varying(10)`);
        await queryRunner.query(`ALTER TABLE "hr_employees" ADD "pay_rate" numeric(14,2)`);
        await queryRunner.query(`ALTER TABLE "hr_payroll_runs" ADD "kind" character varying(12) NOT NULL DEFAULT 'staff'`);
        await queryRunner.query(`DROP INDEX "public"."UQ_hr_payroll_runs_month"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_hr_payroll_runs_month" ON "hr_payroll_runs" ("organization_id", "month", "kind") WHERE status <> 'cancelled'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // التراجع يفشل إن وُجد للشهر نفسه كشف موظفين وكشف متعاونين غير ملغيين (يُلغى أحدهما أولًا)
        await queryRunner.query(`DROP INDEX "public"."UQ_hr_payroll_runs_month"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_hr_payroll_runs_month" ON "hr_payroll_runs" ("organization_id", "month") WHERE ((status)::text <> 'cancelled'::text)`);
        await queryRunner.query(`ALTER TABLE "hr_payroll_runs" DROP COLUMN "kind"`);
        await queryRunner.query(`ALTER TABLE "hr_employees" DROP COLUMN "pay_rate"`);
        await queryRunner.query(`ALTER TABLE "hr_employees" DROP COLUMN "pay_basis"`);
        await queryRunner.query(`ALTER TABLE "hr_employees" DROP COLUMN "employment_kind"`);
    }
}
