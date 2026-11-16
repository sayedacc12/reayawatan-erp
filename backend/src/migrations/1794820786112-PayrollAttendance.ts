import { MigrationInterface, QueryRunner } from "typeorm";

export class PayrollAttendance1794820786112 implements MigrationInterface {
    name = 'PayrollAttendance1794820786112'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "hr_allowance_types" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "code" character varying(30) NOT NULL, "name" character varying(120) NOT NULL, "default_kind" character varying(10) NOT NULL DEFAULT 'fixed', "default_value" numeric(12,2) NOT NULL DEFAULT '0', "expense_account_id" uuid, "payable_account_id" uuid, "cash_account_id" uuid, "is_system" boolean NOT NULL DEFAULT false, "is_active" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_d1e59158be438f0c0d8fefd87b4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_hr_allowance_types_code" ON "hr_allowance_types" ("organization_id", "code") `);
        await queryRunner.query(`CREATE TABLE "hr_attendance_devices" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "brand" character varying(60), "serial_number" character varying(60) NOT NULL, "location" character varying(200), "is_active" boolean NOT NULL DEFAULT true, "last_seen_at" TIMESTAMP WITH TIME ZONE, "punch_count" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_47d6d1863a2843d8240a6ab426a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_hr_attendance_devices_serial" ON "hr_attendance_devices" ("serial_number") `);
        await queryRunner.query(`CREATE TABLE "hr_attendance_punches" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "employee_id" uuid, "attendance_code" character varying(30) NOT NULL, "punch_date" date NOT NULL, "punch_time" character varying(8) NOT NULL, "source" character varying(10) NOT NULL, "device_id" uuid, "import_id" uuid, "note" character varying(300), "created_by_name" character varying(200), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f879c90a52cc48c11c650d69939" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_hr_attendance_punches_emp" ON "hr_attendance_punches" ("organization_id", "employee_id", "punch_date") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_hr_attendance_punches" ON "hr_attendance_punches" ("organization_id", "attendance_code", "punch_date", "punch_time") `);
        await queryRunner.query(`CREATE TABLE "hr_attendance_imports" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "file_name" character varying(250) NOT NULL, "format" character varying(10) NOT NULL, "rows" integer NOT NULL, "added" integer NOT NULL, "duplicates" integer NOT NULL, "invalid" integer NOT NULL DEFAULT '0', "unknown_codes" jsonb NOT NULL DEFAULT '[]', "date_from" date, "date_to" date, "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_fd06c6be10eb525f27e4964c861" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "hr_payroll_runs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "month" character varying(7) NOT NULL, "status" character varying(12) NOT NULL DEFAULT 'draft', "stage_index" integer, "lines" jsonb NOT NULL DEFAULT '[]', "totals" jsonb NOT NULL DEFAULT '{}', "warnings" jsonb NOT NULL DEFAULT '[]', "history" jsonb NOT NULL DEFAULT '[]', "entry_id" uuid, "voucher_ids" jsonb NOT NULL DEFAULT '[]', "created_by_name" character varying(200) NOT NULL, "approved_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8c02c0017885d19031d251016b7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_hr_payroll_runs_month" ON "hr_payroll_runs" ("organization_id", "month") WHERE status <> 'cancelled'`);
        await queryRunner.query(`ALTER TABLE "hr_settings" ADD "payroll_config" jsonb NOT NULL DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "hr_settings" ADD "attendance_config" jsonb NOT NULL DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "hr_units" ADD "analytic_account_id" uuid`);
        await queryRunner.query(`ALTER TABLE "hr_employees" ADD "attendance_code" character varying(30)`);
        await queryRunner.query(`ALTER TABLE "hr_employees" ADD "attendance_exempt" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hr_employees" DROP COLUMN "attendance_exempt"`);
        await queryRunner.query(`ALTER TABLE "hr_employees" DROP COLUMN "attendance_code"`);
        await queryRunner.query(`ALTER TABLE "hr_units" DROP COLUMN "analytic_account_id"`);
        await queryRunner.query(`ALTER TABLE "hr_settings" DROP COLUMN "attendance_config"`);
        await queryRunner.query(`ALTER TABLE "hr_settings" DROP COLUMN "payroll_config"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_hr_payroll_runs_month"`);
        await queryRunner.query(`DROP TABLE "hr_payroll_runs"`);
        await queryRunner.query(`DROP TABLE "hr_attendance_imports"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_hr_attendance_punches"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_hr_attendance_punches_emp"`);
        await queryRunner.query(`DROP TABLE "hr_attendance_punches"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_hr_attendance_devices_serial"`);
        await queryRunner.query(`DROP TABLE "hr_attendance_devices"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_hr_allowance_types_code"`);
        await queryRunner.query(`DROP TABLE "hr_allowance_types"`);
    }

}
