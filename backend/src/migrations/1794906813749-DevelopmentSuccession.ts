import { MigrationInterface, QueryRunner } from "typeorm";

export class DevelopmentSuccession1794906813749 implements MigrationInterface {
    name = 'DevelopmentSuccession1794906813749'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "hr_expense_profiles" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(300), "accounts" jsonb NOT NULL DEFAULT '{}', "is_default" boolean NOT NULL DEFAULT false, "sort_order" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_5ab708f91cb7dd2e5e4821f62fc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_hr_expense_profiles_name" ON "hr_expense_profiles" ("organization_id", "name") `);
        await queryRunner.query(`CREATE TABLE "hr_dev_plans" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "serial" integer NOT NULL, "employee_id" uuid NOT NULL, "job_id" uuid, "kind" character varying(12) NOT NULL DEFAULT 'individual', "target_job_id" uuid, "year" integer NOT NULL, "title" character varying(200) NOT NULL, "goals" jsonb NOT NULL DEFAULT '[]', "items" jsonb NOT NULL DEFAULT '[]', "status" character varying(12) NOT NULL DEFAULT 'draft', "stage_index" integer, "history" jsonb NOT NULL DEFAULT '[]', "created_by_name" character varying(200) NOT NULL, "approved_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_69ddbe1a951dedd2ae59ad1c0fc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "hr_succession_candidates" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "job_id" uuid NOT NULL, "employee_id" uuid NOT NULL, "readiness" character varying(4) NOT NULL DEFAULT '1y', "note" character varying(500), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4e9101cbdd81f6f60ae541224bc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_hr_succession_candidates" ON "hr_succession_candidates" ("organization_id", "job_id", "employee_id") `);
        // حسابات المصروف تنتقل من البدل إلى فئة تحميل المصروف: الفئة الافتراضية لكل جمعية تأخذ حسابات بنودها الحالية
        // وحساب مصروف التأمينات من الربط المحاسبي (المفتاح gosi)
        await queryRunner.query(`INSERT INTO "hr_expense_profiles" ("organization_id", "name", "accounts", "is_default", "sort_order")
          SELECT t."organization_id", 'المصروفات الإدارية',
            COALESCE(jsonb_object_agg(t."code", t."expense_account_id"::text) FILTER (WHERE t."expense_account_id" IS NOT NULL), '{}'::jsonb)
              || COALESCE((SELECT jsonb_build_object('gosi', s."payroll_config"->>'gosiExpenseAccountId') FROM "hr_settings" s
                           WHERE s."organization_id" = t."organization_id" AND s."payroll_config"->>'gosiExpenseAccountId' IS NOT NULL), '{}'::jsonb),
            true, 0
          FROM "hr_allowance_types" t GROUP BY t."organization_id"`);
        await queryRunner.query(`UPDATE "hr_settings" SET "payroll_config" = "payroll_config" - 'gosiExpenseAccountId'`);
        await queryRunner.query(`ALTER TABLE "hr_allowance_types" DROP COLUMN "expense_account_id"`);
        await queryRunner.query(`ALTER TABLE "hr_settings" ADD "development_config" jsonb NOT NULL DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "hr_jobs" ADD "expense_profile_id" uuid`);
        await queryRunner.query(`ALTER TABLE "hr_jobs" ADD "backup_job_id" uuid`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hr_jobs" DROP COLUMN "backup_job_id"`);
        await queryRunner.query(`ALTER TABLE "hr_jobs" DROP COLUMN "expense_profile_id"`);
        await queryRunner.query(`ALTER TABLE "hr_settings" DROP COLUMN "development_config"`);
        await queryRunner.query(`ALTER TABLE "hr_allowance_types" ADD "expense_account_id" uuid`);
        await queryRunner.query(`DROP INDEX "public"."UQ_hr_succession_candidates"`);
        await queryRunner.query(`DROP TABLE "hr_succession_candidates"`);
        await queryRunner.query(`DROP TABLE "hr_dev_plans"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_hr_expense_profiles_name"`);
        await queryRunner.query(`DROP TABLE "hr_expense_profiles"`);
    }

}
