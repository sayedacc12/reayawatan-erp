import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * رقم الهوية في ملف الموظف اختياري مؤقتًا: ملفات فريق الشركة أُدرجت تلقائيًا ويكملها شؤون الموظفين.
 * الفهرس الفريد (المنشأة، رقم الهوية) يبقى ويسمح بأكثر من ملف فارغ.
 * down يعيد الإلزام، ويفشل إن بقي ملف بلا رقم هوية (أكمِله أولًا).
 */
export class HrNationalIdOptional1795700000000 implements MigrationInterface {
    name = 'HrNationalIdOptional1795700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hr_employees" ALTER COLUMN "national_id" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hr_employees" ALTER COLUMN "national_id" SET NOT NULL`);
    }
}
