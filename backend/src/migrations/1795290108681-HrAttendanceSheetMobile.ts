import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * الحضور: كشف الحضور الشهري من نموذج المنصة (hr_attendance_marks وأعمدة الكشف في سجل الملفات)،
 * والتسجيل من الجوال بالموقع (أعمدة الموقع في البصمات، وخيار الجوال في ملف الموظف). جداول وأعمدة جديدة فقط، وقابلة للتراجع.
 */
export class HrAttendanceSheetMobile1795290108681 implements MigrationInterface {
    name = 'HrAttendanceSheetMobile1795290108681'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "hr_attendance_marks" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "employee_id" uuid NOT NULL, "mark_date" date NOT NULL, "kind" character varying(10) NOT NULL, "minutes" integer NOT NULL DEFAULT '0', "import_id" uuid NOT NULL, "superseded_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c763959abfb44ecda9bfee054dd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_hr_attendance_marks" ON "hr_attendance_marks" ("organization_id", "employee_id", "mark_date") WHERE superseded_by IS NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_hr_attendance_marks_import" ON "hr_attendance_marks" ("organization_id", "import_id") `);
        await queryRunner.query(`ALTER TABLE "hr_employees" ADD "mobile_attendance" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_punches" ADD "latitude" numeric(9,6)`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_punches" ADD "longitude" numeric(9,6)`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_punches" ADD "accuracy" integer`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_punches" ADD "distance" integer`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_punches" ADD "client_ip" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_punches" ADD "user_agent" character varying(300)`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_imports" ADD "kind" character varying(10) NOT NULL DEFAULT 'punches'`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_imports" ADD "month" character varying(7)`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_imports" ADD "employee_ids" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_imports" ADD "reverted_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_imports" ADD "reverted_by_name" character varying(200)`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_imports" ADD "created_by_id" uuid`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_imports" ADD "reverted_by_id" uuid`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hr_attendance_imports" DROP COLUMN "reverted_by_id"`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_imports" DROP COLUMN "created_by_id"`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_imports" DROP COLUMN "reverted_by_name"`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_imports" DROP COLUMN "reverted_at"`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_imports" DROP COLUMN "employee_ids"`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_imports" DROP COLUMN "month"`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_imports" DROP COLUMN "kind"`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_punches" DROP COLUMN "user_agent"`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_punches" DROP COLUMN "client_ip"`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_punches" DROP COLUMN "distance"`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_punches" DROP COLUMN "accuracy"`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_punches" DROP COLUMN "longitude"`);
        await queryRunner.query(`ALTER TABLE "hr_attendance_punches" DROP COLUMN "latitude"`);
        await queryRunner.query(`ALTER TABLE "hr_employees" DROP COLUMN "mobile_attendance"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_hr_attendance_marks_import"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_hr_attendance_marks"`);
        await queryRunner.query(`DROP TABLE "hr_attendance_marks"`);
    }
}
