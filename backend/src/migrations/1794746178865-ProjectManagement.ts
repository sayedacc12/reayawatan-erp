import { MigrationInterface, QueryRunner } from "typeorm";

export class ProjectManagement1794746178865 implements MigrationInterface {
    name = 'ProjectManagement1794746178865'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // نفس تعريف أعمدة المشروع في migration الموارد المالية (أيهما يعمل أولًا والآخر لا يغير شيئًا)
        await queryRunner.query(`ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "funding_type" varchar(12) NOT NULL DEFAULT 'restricted'`);
        await queryRunner.query(`ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "zakat_eligible" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "approval_status" varchar(12) NOT NULL DEFAULT 'approved'`);
        await queryRunner.query(`CREATE TABLE "project_settings" ("organization_id" uuid NOT NULL, "expense_debit_code" character varying(50), "expense_debit_name" character varying(200), "payment_credit_code" character varying(50), "payment_credit_name" character varying(200), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_19f7482073c25a5f281722525c8" PRIMARY KEY ("organization_id"))`);
        await queryRunner.query(`CREATE TABLE "project_approval_stages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "name" character varying(200) NOT NULL, "instructions" character varying(1000), "sort_order" integer NOT NULL, "role_id" uuid, CONSTRAINT "PK_505340fa6ad29fb4ff64a8ff9ef" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_project_approval_stages_org" ON "project_approval_stages" ("organization_id", "sort_order") `);
        await queryRunner.query(`CREATE TABLE "project_profiles" ("activity_id" uuid NOT NULL, "organization_id" uuid NOT NULL, "project_no" integer NOT NULL, "spending_mode" character varying(15) NOT NULL DEFAULT 'beneficiaries', "manager_name" character varying(200), "start_date" date, "end_date" date, "budget" numeric(14,2), "target_beneficiaries" integer, "goals" text, "current_stage_id" uuid, "submitted_at" TIMESTAMP WITH TIME ZONE, "approved_at" TIMESTAMP WITH TIME ZONE, "created_by_name" character varying(200), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7d08562fb24aa3ac2cab2770a89" PRIMARY KEY ("activity_id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_project_profiles_no" ON "project_profiles" ("organization_id", "project_no") `);
        await queryRunner.query(`CREATE TABLE "project_actions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "activity_id" uuid NOT NULL, "kind" character varying(12) NOT NULL, "stage_name" character varying(200), "note" text, "user_id" uuid, "user_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5fdb5b1ee117e4ca507a45e88d5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_project_actions_project" ON "project_actions" ("activity_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "project_allocations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "allocation_no" integer NOT NULL, "kind" character varying(10) NOT NULL, "activity_id" uuid NOT NULL, "batch_id" uuid NOT NULL, "request_id" uuid, "beneficiary_id" uuid, "amount" numeric(14,2) NOT NULL, "spent_amount" numeric(14,2) NOT NULL DEFAULT '0', "released_amount" numeric(14,2) NOT NULL DEFAULT '0', "status" character varying(10) NOT NULL DEFAULT 'reserved', "notes" text, "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7a462ca39fe5d16b55005e95491" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_project_allocations_batch" ON "project_allocations" ("batch_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_project_allocations_project" ON "project_allocations" ("organization_id", "activity_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_project_allocations_no" ON "project_allocations" ("organization_id", "allocation_no") `);
        await queryRunner.query(`CREATE TABLE "project_payment_requests" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "request_no" integer NOT NULL, "activity_id" uuid NOT NULL, "allocation_id" uuid NOT NULL, "batch_id" uuid NOT NULL, "amount" numeric(14,2) NOT NULL, "method" character varying(10) NOT NULL, "payee_kind" character varying(12) NOT NULL, "payee_name" character varying(200) NOT NULL, "description" character varying(500), "status" character varying(10) NOT NULL DEFAULT 'pending', "requested_by_name" character varying(200) NOT NULL, "reference_no" character varying(60), "paid_on" date, "executed_by_name" character varying(200), "executed_at" TIMESTAMP WITH TIME ZONE, "reject_reason" text, "journal_entry_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a075207b0c8b7cd8abe43b009a5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_fa20d9cf352c7c1c5f1642926e" ON "project_payment_requests" ("allocation_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_project_payment_requests_status" ON "project_payment_requests" ("organization_id", "status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_project_payment_requests_no" ON "project_payment_requests" ("organization_id", "request_no") `);
        await queryRunner.query(`CREATE TABLE "opportunity_amendments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "amendment_no" integer NOT NULL, "opportunity_id" uuid NOT NULL, "batch_id" uuid NOT NULL, "new_batch_id" uuid, "effective_date" date NOT NULL, "amount" numeric(14,2) NOT NULL, "before" jsonb NOT NULL, "after" jsonb NOT NULL, "reason" text NOT NULL, "donor_approved" boolean NOT NULL DEFAULT false, "donor_approval_ref" character varying(300), "acknowledged_by_name" character varying(200) NOT NULL, "reversal_entry_id" uuid, "reissue_entry_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_630071d20a488dd80e1b824c41a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_52a11ea6b88ab29cb6c89e81ba" ON "opportunity_amendments" ("opportunity_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_opportunity_amendments_no" ON "opportunity_amendments" ("organization_id", "amendment_no") `);
        await queryRunner.query(`CREATE TABLE "project_transfers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "transfer_no" integer NOT NULL, "source_batch_id" uuid NOT NULL, "target_batch_id" uuid NOT NULL, "source_activity_id" uuid, "target_activity_id" uuid NOT NULL, "donor_id" uuid, "amount" numeric(14,2) NOT NULL, "reason" text NOT NULL, "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_96e671744fb6974531c270f937f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_42b2bd959417b0ee7e0c03b575" ON "project_transfers" ("source_batch_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_project_transfers_no" ON "project_transfers" ("organization_id", "transfer_no") `);
        await queryRunner.query(`ALTER TABLE "beneficiaries" ADD "nationality" character varying(60)`);
        await queryRunner.query(`ALTER TABLE "beneficiaries" ADD "residency" character varying(12)`);
        await queryRunner.query(`ALTER TABLE "project_approval_stages" ADD CONSTRAINT "FK_fa956f57dc391a54261693fc817" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "project_profiles" ADD CONSTRAINT "FK_7d08562fb24aa3ac2cab2770a89" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "project_profiles" ADD CONSTRAINT "FK_cfe6e7d7a9a8c691ea038f09bd1" FOREIGN KEY ("current_stage_id") REFERENCES "project_approval_stages"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "project_profiles" DROP CONSTRAINT "FK_cfe6e7d7a9a8c691ea038f09bd1"`);
        await queryRunner.query(`ALTER TABLE "project_profiles" DROP CONSTRAINT "FK_7d08562fb24aa3ac2cab2770a89"`);
        await queryRunner.query(`ALTER TABLE "project_approval_stages" DROP CONSTRAINT "FK_fa956f57dc391a54261693fc817"`);
        await queryRunner.query(`ALTER TABLE "beneficiaries" DROP COLUMN "residency"`);
        await queryRunner.query(`ALTER TABLE "beneficiaries" DROP COLUMN "nationality"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_project_transfers_no"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_42b2bd959417b0ee7e0c03b575"`);
        await queryRunner.query(`DROP TABLE "project_transfers"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_opportunity_amendments_no"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_52a11ea6b88ab29cb6c89e81ba"`);
        await queryRunner.query(`DROP TABLE "opportunity_amendments"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_project_payment_requests_no"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_project_payment_requests_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fa20d9cf352c7c1c5f1642926e"`);
        await queryRunner.query(`DROP TABLE "project_payment_requests"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_project_allocations_no"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_project_allocations_project"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_project_allocations_batch"`);
        await queryRunner.query(`DROP TABLE "project_allocations"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_project_actions_project"`);
        await queryRunner.query(`DROP TABLE "project_actions"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_project_profiles_no"`);
        await queryRunner.query(`DROP TABLE "project_profiles"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_project_approval_stages_org"`);
        await queryRunner.query(`DROP TABLE "project_approval_stages"`);
        await queryRunner.query(`DROP TABLE "project_settings"`);
    }

}
