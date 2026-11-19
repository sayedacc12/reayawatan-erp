import { MigrationInterface, QueryRunner } from "typeorm";

export class FixedAssetsPhase21795079393129 implements MigrationInterface {
    name = 'FixedAssetsPhase21795079393129'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "acc_asset_maintenance" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "record_no" integer NOT NULL, "asset_id" uuid NOT NULL, "date" date NOT NULL, "kind" character varying(10) NOT NULL, "description" character varying(1000) NOT NULL, "vendor" character varying(250), "cost" numeric(16,2) NOT NULL DEFAULT '0', "downtime_days" integer NOT NULL DEFAULT '0', "voucher_id" uuid, "notes" character varying(1000), "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_04b0291ae68f96d44001d532e72" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_asset_maintenance_no" ON "acc_asset_maintenance" ("organization_id", "record_no") `);
        await queryRunner.query(`CREATE INDEX "IDX_acc_asset_maintenance_asset" ON "acc_asset_maintenance" ("asset_id", "date") `);
        await queryRunner.query(`CREATE TABLE "acc_asset_budgets" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "fiscal_year_id" uuid NOT NULL, "title" character varying(200) NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'draft', "external_ref" character varying(120), "notes" character varying(1000), "approved_by_name" character varying(200), "approved_at" TIMESTAMP WITH TIME ZONE, "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_23a3644c437f43e348ac55827bc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_asset_budgets_year" ON "acc_asset_budgets" ("organization_id", "fiscal_year_id") `);
        await queryRunner.query(`CREATE TABLE "acc_asset_budget_lines" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "budget_id" uuid NOT NULL, "line_no" integer NOT NULL, "group_id" uuid NOT NULL, "description" character varying(300) NOT NULL, "quantity" integer NOT NULL DEFAULT '1', "amount" numeric(16,2) NOT NULL DEFAULT '0', "quarter" integer, "unit_id" uuid, "external_ref" character varying(120), "notes" character varying(1000), CONSTRAINT "PK_4e945464f3aafd042f619ccd150" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_acc_asset_budget_lines_budget" ON "acc_asset_budget_lines" ("budget_id") `);
        await queryRunner.query(`CREATE TABLE "acc_asset_imports" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "file_name" character varying(250) NOT NULL, "status" character varying(10) NOT NULL, "total" integer NOT NULL DEFAULT '0', "imported" integer NOT NULL DEFAULT '0', "errors" jsonb NOT NULL DEFAULT '[]', "assets" jsonb NOT NULL DEFAULT '[]', "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ed9667c211b8ad2ab55c1517f09" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "acc_assets" ADD "insurance_required" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "acc_assets" ADD "insurance" jsonb`);
        await queryRunner.query(`ALTER TABLE "acc_assets" ADD "warranty_required" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "acc_assets" ADD "warranty" jsonb`);
        await queryRunner.query(`ALTER TABLE "acc_assets" ADD "maintenance_plan" jsonb`);
        await queryRunner.query(`ALTER TABLE "acc_asset_moves" ADD "funding_account_id" uuid`);
        await queryRunner.query(`ALTER TABLE "acc_asset_moves" ADD "funding_name" character varying(250)`);
        await queryRunner.query(`ALTER TABLE "acc_asset_moves" ADD "funded_amount" numeric(16,2) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "acc_asset_moves" ADD "funding_entry_id" uuid`);
        await queryRunner.query(`ALTER TABLE "acc_asset_moves" ADD "budget_line_id" uuid`);
        await queryRunner.query(`ALTER TABLE "acc_assets" ALTER COLUMN "acquisition" TYPE character varying(12)`);
        await queryRunner.query(`ALTER TABLE "acc_asset_moves" ALTER COLUMN "kind" TYPE character varying(12)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "acc_asset_moves" ALTER COLUMN "kind" TYPE character varying(10)`);
        await queryRunner.query(`ALTER TABLE "acc_assets" ALTER COLUMN "acquisition" TYPE character varying(10)`);
        await queryRunner.query(`ALTER TABLE "acc_asset_moves" DROP COLUMN "budget_line_id"`);
        await queryRunner.query(`ALTER TABLE "acc_asset_moves" DROP COLUMN "funding_entry_id"`);
        await queryRunner.query(`ALTER TABLE "acc_asset_moves" DROP COLUMN "funded_amount"`);
        await queryRunner.query(`ALTER TABLE "acc_asset_moves" DROP COLUMN "funding_name"`);
        await queryRunner.query(`ALTER TABLE "acc_asset_moves" DROP COLUMN "funding_account_id"`);
        await queryRunner.query(`ALTER TABLE "acc_assets" DROP COLUMN "maintenance_plan"`);
        await queryRunner.query(`ALTER TABLE "acc_assets" DROP COLUMN "warranty"`);
        await queryRunner.query(`ALTER TABLE "acc_assets" DROP COLUMN "warranty_required"`);
        await queryRunner.query(`ALTER TABLE "acc_assets" DROP COLUMN "insurance"`);
        await queryRunner.query(`ALTER TABLE "acc_assets" DROP COLUMN "insurance_required"`);
        await queryRunner.query(`DROP TABLE "acc_asset_imports"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_acc_asset_budget_lines_budget"`);
        await queryRunner.query(`DROP TABLE "acc_asset_budget_lines"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_asset_budgets_year"`);
        await queryRunner.query(`DROP TABLE "acc_asset_budgets"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_acc_asset_maintenance_asset"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_asset_maintenance_no"`);
        await queryRunner.query(`DROP TABLE "acc_asset_maintenance"`);
    }

}
