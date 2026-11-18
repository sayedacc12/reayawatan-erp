import { MigrationInterface, QueryRunner } from "typeorm";

export class EmployeeSelfService1794993848280 implements MigrationInterface {
    name = 'EmployeeSelfService1794993848280'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "hr_request_types" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "code" character varying(40) NOT NULL, "name" character varying(150) NOT NULL, "kind" character varying(16) NOT NULL, "category" character varying(60) NOT NULL DEFAULT 'أخرى', "description" character varying(500), "color" character varying(9) NOT NULL DEFAULT '#6366f1', "fields" jsonb NOT NULL DEFAULT '[]', "approval" jsonb NOT NULL DEFAULT '[]', "rules" jsonb NOT NULL DEFAULT '{}', "leave_types" jsonb NOT NULL DEFAULT '[]', "permission_kinds" jsonb NOT NULL DEFAULT '[]', "templates" jsonb NOT NULL DEFAULT '[]', "is_active" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c83322b112cb2835f9b5e6403f4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_hr_request_types_code" ON "hr_request_types" ("organization_id", "code") `);
        await queryRunner.query(`CREATE TABLE "hr_requests" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "request_no" integer NOT NULL, "type_id" uuid NOT NULL, "kind" character varying(16) NOT NULL, "type_name" character varying(150) NOT NULL, "employee_id" uuid NOT NULL, "data" jsonb NOT NULL DEFAULT '{}', "summary" character varying(300) NOT NULL, "start_date" date, "status" character varying(12) NOT NULL DEFAULT 'pending', "steps" jsonb NOT NULL DEFAULT '[]', "step_index" integer, "attachments" jsonb NOT NULL DEFAULT '[]', "history" jsonb NOT NULL DEFAULT '[]', "result" jsonb, "leave_id" uuid, "created_by_name" character varying(200) NOT NULL, "decided_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5c42d20e14f0b1640a5ef7e43e5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_hr_requests_emp" ON "hr_requests" ("organization_id", "employee_id", "status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_hr_requests_no" ON "hr_requests" ("organization_id", "request_no") `);
        await queryRunner.query(`CREATE TABLE "hr_advances" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "employee_id" uuid NOT NULL, "request_id" uuid, "amount" numeric(14,2) NOT NULL DEFAULT '0', "installments" integer NOT NULL, "installment_amount" numeric(14,2) NOT NULL DEFAULT '0', "start_month" character varying(7) NOT NULL, "status" character varying(12) NOT NULL DEFAULT 'active', "reason" character varying(500), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_55304e0292b18f3ecd07be265db" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_hr_advances_emp" ON "hr_advances" ("organization_id", "employee_id") `);
        await queryRunner.query(`CREATE TABLE "hr_advance_repayments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "advance_id" uuid NOT NULL, "run_id" uuid, "month" character varying(7) NOT NULL, "amount" numeric(14,2) NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6e5929935b88fcdfba675deeb13" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_hr_advance_repayments" ON "hr_advance_repayments" ("advance_id") `);
        await queryRunner.query(`ALTER TABLE "hr_employees" ADD "user_id" uuid`);
        await queryRunner.query(`ALTER TABLE "hr_leave_requests" ADD "request_id" uuid`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_hr_employees_user" ON "hr_employees" ("user_id") WHERE "user_id" IS NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."UQ_hr_employees_user"`);
        await queryRunner.query(`ALTER TABLE "hr_leave_requests" DROP COLUMN "request_id"`);
        await queryRunner.query(`ALTER TABLE "hr_employees" DROP COLUMN "user_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_hr_advance_repayments"`);
        await queryRunner.query(`DROP TABLE "hr_advance_repayments"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_hr_advances_emp"`);
        await queryRunner.query(`DROP TABLE "hr_advances"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_hr_requests_no"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_hr_requests_emp"`);
        await queryRunner.query(`DROP TABLE "hr_requests"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_hr_request_types_code"`);
        await queryRunner.query(`DROP TABLE "hr_request_types"`);
    }

}
