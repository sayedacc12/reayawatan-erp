import { MigrationInterface, QueryRunner } from "typeorm";

export class Accounting1794758445565 implements MigrationInterface {
    name = 'Accounting1794758445565'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "acc_settings" ("organization_id" uuid NOT NULL, "next_entry_no" integer NOT NULL DEFAULT '1', "analytic_levels" integer NOT NULL DEFAULT '3', "closing_account_id" uuid, "warehouse_types" jsonb NOT NULL DEFAULT '["مستودع رئيسي","مستودع فرعي","مستودع التبرعات العينية"]', "chart_installed_at" TIMESTAMP WITH TIME ZONE, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_07a791a883e8e929540618e3343" PRIMARY KEY ("organization_id"))`);
        await queryRunner.query(`CREATE TABLE "acc_fiscal_years" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "name" integer NOT NULL, "start_date" date NOT NULL, "end_date" date NOT NULL, "is_first" boolean NOT NULL DEFAULT false, "status" character varying(10) NOT NULL DEFAULT 'open', "closed_at" TIMESTAMP WITH TIME ZONE, "closed_by_name" character varying(200), "reopened_at" TIMESTAMP WITH TIME ZONE, "reopened_by_name" character varying(200), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_42df099b9573f67d0176c41da0d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_fiscal_years_org_name" ON "acc_fiscal_years" ("organization_id", "name") `);
        await queryRunner.query(`CREATE TABLE "acc_period_locks" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "fiscal_year_id" uuid NOT NULL, "month" character varying(7) NOT NULL, "closed_by_name" character varying(200) NOT NULL, "closed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c963a386bd1d1f99f66e9774a38" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_period_locks" ON "acc_period_locks" ("organization_id", "month") `);
        await queryRunner.query(`CREATE TABLE "acc_voucher_sequences" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "fiscal_year_id" uuid NOT NULL, "voucher_type" character varying(20) NOT NULL, "start_serial" integer NOT NULL DEFAULT '1', "end_serial" integer, "next_serial" integer NOT NULL DEFAULT '1', CONSTRAINT "PK_c4e3c1e4679ca6f0b9588e375dc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_voucher_sequences" ON "acc_voucher_sequences" ("fiscal_year_id", "voucher_type") `);
        await queryRunner.query(`CREATE TABLE "acc_accounts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "code" character varying(30) NOT NULL, "name" character varying(250) NOT NULL, "kind" character varying(10) NOT NULL, "nature" character varying(20) NOT NULL, "parent_id" uuid, "level" integer NOT NULL, "requires_analytic" boolean NOT NULL DEFAULT false, "description" character varying(1000), "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2efc8d35e38370853009ce7cba3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_accounts_org_code" ON "acc_accounts" ("organization_id", "code") `);
        await queryRunner.query(`CREATE TABLE "acc_analytic_accounts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "code" character varying(30) NOT NULL, "name" character varying(250) NOT NULL, "kind" character varying(10) NOT NULL, "parent_id" uuid, "level" integer NOT NULL, "description" character varying(1000), "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f964426fb8883590a921e63e050" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_analytic_org_code" ON "acc_analytic_accounts" ("organization_id", "code") `);
        await queryRunner.query(`CREATE TABLE "acc_partner_categories" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "behavior" character varying(12) NOT NULL, "sort_order" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_fa44cc06ae3bf433299bdc27b1c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "acc_partners" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "partner_no" integer NOT NULL, "name" character varying(250) NOT NULL, "category_id" uuid NOT NULL, "description" character varying(1000), "phones" jsonb NOT NULL DEFAULT '[]', "emails" jsonb NOT NULL DEFAULT '[]', "addresses" jsonb NOT NULL DEFAULT '[]', "tax_number" character varying(30), "cr_number" character varying(30), "account_id" uuid, "credit_limit" numeric(16,2), "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f9e47393e670b834697fece6c16" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_acc_partners_org" ON "acc_partners" ("organization_id", "name") `);
        await queryRunner.query(`CREATE TABLE "acc_cash_accounts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "kind" character varying(10) NOT NULL, "name" character varying(200) NOT NULL, "bank_name" character varying(200), "account_number" character varying(60), "iban" character varying(34), "description" character varying(500), "gl_account_id" uuid NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_01acb1d06617f21510f43595310" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_cash_accounts_gl" ON "acc_cash_accounts" ("organization_id", "gl_account_id") `);
        await queryRunner.query(`CREATE TABLE "acc_warehouses" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "name" character varying(200) NOT NULL, "type" character varying(120) NOT NULL, "description" character varying(500), "gl_account_id" uuid NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b05c2b8345eb263c6325b7b57dd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "acc_entries" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "entry_no" integer NOT NULL, "fiscal_year_id" uuid NOT NULL, "voucher_type" character varying(20) NOT NULL, "voucher_serial" integer NOT NULL, "entry_date" date NOT NULL, "document_date" date NOT NULL, "description" character varying(1000) NOT NULL, "counterparty" character varying(250), "status" character varying(12) NOT NULL DEFAULT 'draft', "source" character varying(10) NOT NULL DEFAULT 'manual', "voucher_id" uuid, "total" numeric(16,2) NOT NULL DEFAULT '0', "created_by_id" uuid, "created_by_name" character varying(200) NOT NULL, "posted_at" TIMESTAMP WITH TIME ZONE, "posted_by_name" character varying(200), "cancel_requested_by_id" uuid, "cancel_requested_by_name" character varying(200), "cancel_requested_at" TIMESTAMP WITH TIME ZONE, "cancel_reason" character varying(1000), "cancelled_at" TIMESTAMP WITH TIME ZONE, "cancelled_by_name" character varying(200), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9a8f179a28659ded1100232c1f8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_acc_entries_org_date" ON "acc_entries" ("organization_id", "document_date") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_entries_voucher" ON "acc_entries" ("fiscal_year_id", "voucher_type", "voucher_serial") WHERE status <> 'cancelled'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_entries_org_no" ON "acc_entries" ("organization_id", "entry_no") `);
        await queryRunner.query(`CREATE TABLE "acc_entry_lines" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "entry_id" uuid NOT NULL, "line_no" integer NOT NULL, "account_id" uuid NOT NULL, "debit" numeric(16,2) NOT NULL DEFAULT '0', "credit" numeric(16,2) NOT NULL DEFAULT '0', "label" character varying(500), "partner_id" uuid, "analytic" jsonb NOT NULL DEFAULT '[]', CONSTRAINT "PK_7cadef89ad174001a980d9b9576" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_acc_entry_lines_partner" ON "acc_entry_lines" ("organization_id", "partner_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_acc_entry_lines_account" ON "acc_entry_lines" ("organization_id", "account_id") `);
        await queryRunner.query(`CREATE TABLE "acc_voucher_inventories" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "fiscal_year_id" uuid NOT NULL, "status" character varying(12) NOT NULL DEFAULT 'draft', "rows" jsonb NOT NULL, "notes" character varying(1000), "prepared_by_name" character varying(200) NOT NULL, "prepared_at" TIMESTAMP WITH TIME ZONE NOT NULL, "approved_by_name" character varying(200), "approved_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_3c7175ecaa4b8d914098dd1c16a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_voucher_inventories_year" ON "acc_voucher_inventories" ("fiscal_year_id") `);
        await queryRunner.query(`CREATE TABLE "acc_voucher_stages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "kind" character varying(10) NOT NULL, "name" character varying(200) NOT NULL, "instructions" character varying(1000), "sort_order" integer NOT NULL, "role_id" uuid, CONSTRAINT "PK_a3216e483e6351353915d0a167a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_acc_voucher_stages_org" ON "acc_voucher_stages" ("organization_id", "kind", "sort_order") `);
        await queryRunner.query(`CREATE TABLE "acc_vouchers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "kind" character varying(10) NOT NULL, "fiscal_year_id" uuid NOT NULL, "serial" integer NOT NULL, "voucher_date" date NOT NULL, "party_name" character varying(250) NOT NULL, "partner_id" uuid, "amount" numeric(16,2) NOT NULL DEFAULT '0', "purpose" character varying(1000) NOT NULL, "source_type" character varying(12) NOT NULL DEFAULT 'manual', "source_ref" character varying(120), "project_name" character varying(250), "method" character varying(10) NOT NULL DEFAULT 'cash', "method_ref" character varying(120), "cash_account_id" uuid NOT NULL, "counter_account_id" uuid NOT NULL, "analytic" jsonb NOT NULL DEFAULT '[]', "status" character varying(12) NOT NULL DEFAULT 'draft', "current_stage_id" uuid, "entry_id" uuid, "request_kind" character varying(10), "request_by_id" uuid, "request_by_name" character varying(200), "request_reason" character varying(1000), "request_at" TIMESTAMP WITH TIME ZONE, "created_by_id" uuid, "created_by_name" character varying(200) NOT NULL, "approved_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5b11582085860f9ad85746357be" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_acc_vouchers_org" ON "acc_vouchers" ("organization_id", "kind", "voucher_date") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_vouchers_serial" ON "acc_vouchers" ("fiscal_year_id", "kind", "serial") `);
        await queryRunner.query(`CREATE TABLE "acc_voucher_actions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "voucher_id" uuid NOT NULL, "action" character varying(20) NOT NULL, "stage_name" character varying(200), "note" character varying(1000), "actor_id" uuid, "actor_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9444770f6961137a9cb0a14d6b3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_acc_voucher_actions_voucher" ON "acc_voucher_actions" ("voucher_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "tax_number" character varying(30)`);
        await queryRunner.query(`ALTER TABLE "acc_period_locks" ADD CONSTRAINT "FK_06e24bb28b9c16d1b2883ea54b1" FOREIGN KEY ("fiscal_year_id") REFERENCES "acc_fiscal_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "acc_voucher_sequences" ADD CONSTRAINT "FK_450a622c6b7f59bac06d4024cfb" FOREIGN KEY ("fiscal_year_id") REFERENCES "acc_fiscal_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "acc_accounts" ADD CONSTRAINT "FK_b7a0fda4dd52daa22c99f49252a" FOREIGN KEY ("parent_id") REFERENCES "acc_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "acc_analytic_accounts" ADD CONSTRAINT "FK_a07e135258fe65fe526c363e449" FOREIGN KEY ("parent_id") REFERENCES "acc_analytic_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "acc_partners" ADD CONSTRAINT "FK_ab0f206dbfcdcd96aeca3ea46b7" FOREIGN KEY ("category_id") REFERENCES "acc_partner_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "acc_partners" ADD CONSTRAINT "FK_b02adbcc64c2d4665df2a6b1d25" FOREIGN KEY ("account_id") REFERENCES "acc_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "acc_cash_accounts" ADD CONSTRAINT "FK_ac59eafc419cdad7a744778833d" FOREIGN KEY ("gl_account_id") REFERENCES "acc_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "acc_warehouses" ADD CONSTRAINT "FK_92ec6d9583a6d6618280d3d1b82" FOREIGN KEY ("gl_account_id") REFERENCES "acc_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "acc_entries" ADD CONSTRAINT "FK_858120ed93b87d5ed1f112cb816" FOREIGN KEY ("fiscal_year_id") REFERENCES "acc_fiscal_years"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "acc_entry_lines" ADD CONSTRAINT "FK_c8a1bfb439bd7801542f6f9c9ec" FOREIGN KEY ("entry_id") REFERENCES "acc_entries"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "acc_entry_lines" ADD CONSTRAINT "FK_ec4eb7670ca3a065e986bd2c606" FOREIGN KEY ("account_id") REFERENCES "acc_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "acc_entry_lines" ADD CONSTRAINT "FK_14803f3397145c0f71bde1d8c11" FOREIGN KEY ("partner_id") REFERENCES "acc_partners"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "acc_voucher_inventories" ADD CONSTRAINT "FK_74f5d2fa74277960f6e31302fb3" FOREIGN KEY ("fiscal_year_id") REFERENCES "acc_fiscal_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "acc_vouchers" ADD CONSTRAINT "FK_5be5c917403f0a4e4be2a5bb2ed" FOREIGN KEY ("fiscal_year_id") REFERENCES "acc_fiscal_years"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "acc_vouchers" ADD CONSTRAINT "FK_7ff4277b38cb29867e70725fc13" FOREIGN KEY ("partner_id") REFERENCES "acc_partners"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "acc_vouchers" ADD CONSTRAINT "FK_c5cd45452da97419b0eab9358d8" FOREIGN KEY ("cash_account_id") REFERENCES "acc_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "acc_vouchers" ADD CONSTRAINT "FK_7083f4f5cadd37ee8d4e5f1b58e" FOREIGN KEY ("counter_account_id") REFERENCES "acc_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "acc_voucher_actions" ADD CONSTRAINT "FK_9e1c5edf992c772a7f27029a2cb" FOREIGN KEY ("voucher_id") REFERENCES "acc_vouchers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "acc_voucher_actions" DROP CONSTRAINT "FK_9e1c5edf992c772a7f27029a2cb"`);
        await queryRunner.query(`ALTER TABLE "acc_vouchers" DROP CONSTRAINT "FK_7083f4f5cadd37ee8d4e5f1b58e"`);
        await queryRunner.query(`ALTER TABLE "acc_vouchers" DROP CONSTRAINT "FK_c5cd45452da97419b0eab9358d8"`);
        await queryRunner.query(`ALTER TABLE "acc_vouchers" DROP CONSTRAINT "FK_7ff4277b38cb29867e70725fc13"`);
        await queryRunner.query(`ALTER TABLE "acc_vouchers" DROP CONSTRAINT "FK_5be5c917403f0a4e4be2a5bb2ed"`);
        await queryRunner.query(`ALTER TABLE "acc_voucher_inventories" DROP CONSTRAINT "FK_74f5d2fa74277960f6e31302fb3"`);
        await queryRunner.query(`ALTER TABLE "acc_entry_lines" DROP CONSTRAINT "FK_14803f3397145c0f71bde1d8c11"`);
        await queryRunner.query(`ALTER TABLE "acc_entry_lines" DROP CONSTRAINT "FK_ec4eb7670ca3a065e986bd2c606"`);
        await queryRunner.query(`ALTER TABLE "acc_entry_lines" DROP CONSTRAINT "FK_c8a1bfb439bd7801542f6f9c9ec"`);
        await queryRunner.query(`ALTER TABLE "acc_entries" DROP CONSTRAINT "FK_858120ed93b87d5ed1f112cb816"`);
        await queryRunner.query(`ALTER TABLE "acc_warehouses" DROP CONSTRAINT "FK_92ec6d9583a6d6618280d3d1b82"`);
        await queryRunner.query(`ALTER TABLE "acc_cash_accounts" DROP CONSTRAINT "FK_ac59eafc419cdad7a744778833d"`);
        await queryRunner.query(`ALTER TABLE "acc_partners" DROP CONSTRAINT "FK_b02adbcc64c2d4665df2a6b1d25"`);
        await queryRunner.query(`ALTER TABLE "acc_partners" DROP CONSTRAINT "FK_ab0f206dbfcdcd96aeca3ea46b7"`);
        await queryRunner.query(`ALTER TABLE "acc_analytic_accounts" DROP CONSTRAINT "FK_a07e135258fe65fe526c363e449"`);
        await queryRunner.query(`ALTER TABLE "acc_accounts" DROP CONSTRAINT "FK_b7a0fda4dd52daa22c99f49252a"`);
        await queryRunner.query(`ALTER TABLE "acc_voucher_sequences" DROP CONSTRAINT "FK_450a622c6b7f59bac06d4024cfb"`);
        await queryRunner.query(`ALTER TABLE "acc_period_locks" DROP CONSTRAINT "FK_06e24bb28b9c16d1b2883ea54b1"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "tax_number"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_acc_voucher_actions_voucher"`);
        await queryRunner.query(`DROP TABLE "acc_voucher_actions"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_vouchers_serial"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_acc_vouchers_org"`);
        await queryRunner.query(`DROP TABLE "acc_vouchers"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_acc_voucher_stages_org"`);
        await queryRunner.query(`DROP TABLE "acc_voucher_stages"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_voucher_inventories_year"`);
        await queryRunner.query(`DROP TABLE "acc_voucher_inventories"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_acc_entry_lines_account"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_acc_entry_lines_partner"`);
        await queryRunner.query(`DROP TABLE "acc_entry_lines"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_entries_org_no"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_entries_voucher"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_acc_entries_org_date"`);
        await queryRunner.query(`DROP TABLE "acc_entries"`);
        await queryRunner.query(`DROP TABLE "acc_warehouses"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_cash_accounts_gl"`);
        await queryRunner.query(`DROP TABLE "acc_cash_accounts"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_acc_partners_org"`);
        await queryRunner.query(`DROP TABLE "acc_partners"`);
        await queryRunner.query(`DROP TABLE "acc_partner_categories"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_analytic_org_code"`);
        await queryRunner.query(`DROP TABLE "acc_analytic_accounts"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_accounts_org_code"`);
        await queryRunner.query(`DROP TABLE "acc_accounts"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_voucher_sequences"`);
        await queryRunner.query(`DROP TABLE "acc_voucher_sequences"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_period_locks"`);
        await queryRunner.query(`DROP TABLE "acc_period_locks"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_fiscal_years_org_name"`);
        await queryRunner.query(`DROP TABLE "acc_fiscal_years"`);
        await queryRunner.query(`DROP TABLE "acc_settings"`);
    }

}
