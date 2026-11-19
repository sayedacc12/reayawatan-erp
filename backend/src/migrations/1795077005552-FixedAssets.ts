import { MigrationInterface, QueryRunner } from "typeorm";

export class FixedAssets1795077005552 implements MigrationInterface {
    name = 'FixedAssets1795077005552'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "acc_asset_groups" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "code" character varying(12) NOT NULL, "name" character varying(150) NOT NULL, "description" character varying(1000), "asset_account_id" uuid NOT NULL, "accum_account_id" uuid, "expense_account_id" uuid, "gain_loss_account_id" uuid NOT NULL, "analytic_id" uuid, "method" character varying(16) NOT NULL DEFAULT 'straight_line', "rate" numeric(6,2) NOT NULL DEFAULT '0', "life_years" numeric(6,2), "is_tangible" boolean NOT NULL DEFAULT true, "fields" jsonb NOT NULL DEFAULT '[]', "is_active" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a280438a77002478128201e81d9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_asset_groups_code" ON "acc_asset_groups" ("organization_id", "code") `);
        await queryRunner.query(`CREATE TABLE "acc_assets" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "asset_no" integer NOT NULL, "code" character varying(40) NOT NULL, "name" character varying(250) NOT NULL, "description" character varying(2000), "group_id" uuid NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'draft', "serial_number" character varying(120), "location" character varying(250), "unit_id" uuid, "custodian_employee_id" uuid, "image" jsonb, "field_values" jsonb NOT NULL DEFAULT '{}', "maintenance" jsonb NOT NULL DEFAULT '[]', "method" character varying(16), "rate" numeric(6,2), "life_years" numeric(6,2), "salvage_value" numeric(16,2) NOT NULL DEFAULT '0', "analytic_id" uuid, "in_service_date" date, "cost" numeric(16,2) NOT NULL DEFAULT '0', "accum" numeric(16,2) NOT NULL DEFAULT '0', "depreciated_through" date, "acquisition" character varying(10), "disposed_at" date, "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1e86749fc0133071c7f30a8e21a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_acc_assets_custodian" ON "acc_assets" ("organization_id", "custodian_employee_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_acc_assets_group" ON "acc_assets" ("organization_id", "group_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_assets_code" ON "acc_assets" ("organization_id", "code") `);
        await queryRunner.query(`CREATE TABLE "acc_asset_moves" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "move_no" integer NOT NULL, "asset_id" uuid NOT NULL, "kind" character varying(10) NOT NULL, "date" date NOT NULL, "amount" numeric(16,2) NOT NULL DEFAULT '0', "accum_delta" numeric(16,2) NOT NULL DEFAULT '0', "proceeds" numeric(16,2) NOT NULL DEFAULT '0', "gain_loss" numeric(16,2) NOT NULL DEFAULT '0', "method" character varying(8), "cash_account_id" uuid, "partner_id" uuid, "counter_account_id" uuid, "party_name" character varying(250), "voucher_id" uuid, "entry_id" uuid, "dep_run_id" uuid, "status" character varying(10) NOT NULL DEFAULT 'done', "notes" character varying(1000), "created_by_name" character varying(200) NOT NULL, "cancelled_by_name" character varying(200), "cancel_reason" character varying(1000), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ed9466b6f21f2d8414329b3d3ba" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_acc_asset_moves_voucher" ON "acc_asset_moves" ("voucher_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_acc_asset_moves_asset" ON "acc_asset_moves" ("asset_id", "date") `);
        await queryRunner.query(`CREATE TABLE "acc_asset_dep_runs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "run_no" integer NOT NULL, "kind" character varying(10) NOT NULL, "period" character varying(7) NOT NULL, "to_date" date NOT NULL, "scope" jsonb NOT NULL, "total" numeric(16,2) NOT NULL DEFAULT '0', "asset_count" integer NOT NULL DEFAULT '0', "entry_id" uuid, "status" character varying(10) NOT NULL DEFAULT 'posted', "created_by_name" character varying(200) NOT NULL, "cancelled_at" TIMESTAMP WITH TIME ZONE, "cancelled_by_name" character varying(200), "cancel_reason" character varying(1000), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_594a4012280a7b111ce66f40ca1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_asset_dep_runs_no" ON "acc_asset_dep_runs" ("organization_id", "run_no") `);
        await queryRunner.query(`CREATE TABLE "acc_asset_dep_lines" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "run_id" uuid NOT NULL, "asset_id" uuid NOT NULL, "group_id" uuid NOT NULL, "from_date" date NOT NULL, "to_date" date NOT NULL, "amount" numeric(16,2) NOT NULL DEFAULT '0', "accum_before" numeric(16,2) NOT NULL DEFAULT '0', "cost" numeric(16,2) NOT NULL DEFAULT '0', "months" jsonb NOT NULL DEFAULT '[]', "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_822ea4d85a2d712fc2f88c2f7af" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_acc_asset_dep_lines_run" ON "acc_asset_dep_lines" ("run_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_acc_asset_dep_lines_asset" ON "acc_asset_dep_lines" ("asset_id", "to_date") `);
        await queryRunner.query(`CREATE TABLE "acc_asset_custody" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "form_no" integer NOT NULL, "asset_id" uuid NOT NULL, "kind" character varying(10) NOT NULL, "from_employee_id" uuid, "to_employee_id" uuid, "from_location" character varying(250), "to_location" character varying(250), "date" date NOT NULL, "condition" character varying(60), "notes" character varying(1000), "confirmed_at" TIMESTAMP WITH TIME ZONE, "confirmed_by_name" character varying(200), "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_37f1a757261895a7fb292008dad" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_asset_custody_no" ON "acc_asset_custody" ("organization_id", "form_no") `);
        await queryRunner.query(`CREATE INDEX "IDX_acc_asset_custody_asset" ON "acc_asset_custody" ("asset_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "acc_asset_stocktakes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "stocktake_no" integer NOT NULL, "title" character varying(200) NOT NULL, "date" date NOT NULL, "scope" jsonb NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'open', "lines" jsonb NOT NULL, "extras" jsonb NOT NULL DEFAULT '[]', "created_by_name" character varying(200) NOT NULL, "closed_at" TIMESTAMP WITH TIME ZONE, "closed_by_name" character varying(200), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_24188938186ae55cfe902ee8e0e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_asset_stocktakes_no" ON "acc_asset_stocktakes" ("organization_id", "stocktake_no") `);
        await queryRunner.query(`ALTER TABLE "acc_settings" ADD "asset_config" jsonb NOT NULL DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "acc_vouchers" ADD "custom_lines" jsonb`);
        await queryRunner.query(`ALTER TABLE "acc_vouchers" DROP CONSTRAINT "FK_c5cd45452da97419b0eab9358d8"`);
        await queryRunner.query(`ALTER TABLE "acc_vouchers" ALTER COLUMN "cash_account_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "acc_vouchers" ADD CONSTRAINT "FK_c5cd45452da97419b0eab9358d8" FOREIGN KEY ("cash_account_id") REFERENCES "acc_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "acc_vouchers" DROP CONSTRAINT "FK_c5cd45452da97419b0eab9358d8"`);
        await queryRunner.query(`ALTER TABLE "acc_vouchers" ALTER COLUMN "cash_account_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "acc_vouchers" ADD CONSTRAINT "FK_c5cd45452da97419b0eab9358d8" FOREIGN KEY ("cash_account_id") REFERENCES "acc_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "acc_vouchers" DROP COLUMN "custom_lines"`);
        await queryRunner.query(`ALTER TABLE "acc_settings" DROP COLUMN "asset_config"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_asset_stocktakes_no"`);
        await queryRunner.query(`DROP TABLE "acc_asset_stocktakes"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_acc_asset_custody_asset"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_asset_custody_no"`);
        await queryRunner.query(`DROP TABLE "acc_asset_custody"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_acc_asset_dep_lines_asset"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_acc_asset_dep_lines_run"`);
        await queryRunner.query(`DROP TABLE "acc_asset_dep_lines"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_asset_dep_runs_no"`);
        await queryRunner.query(`DROP TABLE "acc_asset_dep_runs"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_acc_asset_moves_asset"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_acc_asset_moves_voucher"`);
        await queryRunner.query(`DROP TABLE "acc_asset_moves"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_assets_code"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_acc_assets_group"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_acc_assets_custodian"`);
        await queryRunner.query(`DROP TABLE "acc_assets"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_asset_groups_code"`);
        await queryRunner.query(`DROP TABLE "acc_asset_groups"`);
    }

}
