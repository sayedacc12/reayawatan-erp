import { MigrationInterface, QueryRunner } from 'typeorm';

/** المشتريات المرحلة الثالثة: الاستلام والفحص، ودفتر المخزون وطبقاته وأرصدته، وطلبات الصرف، ومستندات المخزون، والجرد، وإعدادات المستودعات */
export class Stock1795170000000 implements MigrationInterface {
    name = 'Stock1795170000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "pr_receipts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "receipt_no" integer NOT NULL, "kind" character varying(10) NOT NULL, "order_id" uuid, "supplier_id" uuid, "warehouse_id" uuid, "date" date NOT NULL, "delivery_ref" character varying(80), "donor_name" character varying(250), "analytic_id" uuid, "project_id" uuid, "lines" jsonb NOT NULL DEFAULT '[]', "extra_cost" numeric(16,2) NOT NULL DEFAULT '0', "extra_note" character varying(500), "total" numeric(16,2) NOT NULL DEFAULT '0', "order_value" numeric(16,2) NOT NULL DEFAULT '0', "inspection" jsonb, "status" character varying(10) NOT NULL DEFAULT 'posted', "entry_id" uuid, "consumed" numeric(16,2) NOT NULL DEFAULT '0', "funding_spent" numeric(16,2) NOT NULL DEFAULT '0', "notes" character varying(2000), "attachments" jsonb NOT NULL DEFAULT '[]', "cancel_reason" character varying(1000), "created_by_id" uuid, "created_by_name" character varying(200) NOT NULL, "log" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b2831ce688940586b9a39e1e3d2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pr_receipts_order" ON "pr_receipts" ("organization_id", "order_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_receipts_no" ON "pr_receipts" ("organization_id", "receipt_no") `);
        await queryRunner.query(`CREATE TABLE "pr_stock_moves" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "date" date NOT NULL, "kind" character varying(16) NOT NULL, "item_id" uuid NOT NULL, "warehouse_id" uuid NOT NULL, "location_id" uuid, "lot" character varying(60), "expiry_date" date, "qty" numeric(14,3) NOT NULL DEFAULT '0', "value" numeric(16,2) NOT NULL DEFAULT '0', "balance_qty" numeric(14,3) NOT NULL DEFAULT '0', "balance_value" numeric(16,2) NOT NULL DEFAULT '0', "account_id" uuid, "doc_type" character varying(16) NOT NULL, "doc_id" uuid NOT NULL, "doc_code" character varying(20) NOT NULL, "project_id" uuid, "unit_id" uuid, "cancelled" boolean NOT NULL DEFAULT false, "by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c0a8d39b921530cd13f81a6447c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pr_stock_moves_account" ON "pr_stock_moves" ("organization_id", "account_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_pr_stock_moves_doc" ON "pr_stock_moves" ("doc_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_pr_stock_moves_item" ON "pr_stock_moves" ("organization_id", "item_id", "warehouse_id", "date") `);
        await queryRunner.query(`CREATE TABLE "pr_stock_layers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "item_id" uuid NOT NULL, "warehouse_id" uuid NOT NULL, "location_id" uuid, "lot" character varying(60), "expiry_date" date, "date" date NOT NULL, "unit_cost" numeric(16,4) NOT NULL, "qty_in" numeric(14,3) NOT NULL DEFAULT '0', "qty_left" numeric(14,3) NOT NULL DEFAULT '0', "source_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a04dead3e5d7a9ba70d9fea5923" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pr_stock_layers_item" ON "pr_stock_layers" ("organization_id", "item_id", "warehouse_id") `);
        await queryRunner.query(`CREATE TABLE "pr_stock_balances" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "item_id" uuid NOT NULL, "warehouse_id" uuid NOT NULL, "qty" numeric(14,3) NOT NULL DEFAULT '0', "value" numeric(16,2) NOT NULL DEFAULT '0', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_15bee4614e2d3c36a79780dc894" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_stock_balances" ON "pr_stock_balances" ("organization_id", "item_id", "warehouse_id") `);
        await queryRunner.query(`CREATE TABLE "pr_issue_requests" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "request_no" integer NOT NULL, "warehouse_id" uuid NOT NULL, "purpose" character varying(250) NOT NULL, "unit_id" uuid, "project_id" uuid, "funding_batch_id" uuid, "analytic_id" uuid, "beneficiary_ref" character varying(120), "receiver_name" character varying(200), "needed_by" date, "lines" jsonb NOT NULL DEFAULT '[]', "status" character varying(10) NOT NULL DEFAULT 'draft', "decision_note" character varying(1000), "decided_by_name" character varying(200), "requested_by_id" uuid, "requested_by_name" character varying(200) NOT NULL, "log" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b42d0124b9e1e785bd90159ebe8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_issue_requests_no" ON "pr_issue_requests" ("organization_id", "request_no") `);
        await queryRunner.query(`CREATE TABLE "pr_stock_docs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "kind" character varying(16) NOT NULL, "doc_no" integer NOT NULL, "date" date NOT NULL, "warehouse_id" uuid NOT NULL, "to_warehouse_id" uuid, "issue_request_id" uuid, "ref_id" uuid, "supplier_id" uuid, "unit_id" uuid, "project_id" uuid, "analytic_id" uuid, "funding_batch_id" uuid, "receiver_name" character varying(200), "reason" character varying(12), "lines" jsonb NOT NULL DEFAULT '[]', "total" numeric(16,2) NOT NULL DEFAULT '0', "budget_back" numeric(16,2) NOT NULL DEFAULT '0', "funding_back" numeric(16,2) NOT NULL DEFAULT '0', "status" character varying(10) NOT NULL DEFAULT 'posted', "entry_id" uuid, "notes" character varying(2000), "approved_by_name" character varying(200), "cancel_reason" character varying(1000), "created_by_id" uuid, "created_by_name" character varying(200) NOT NULL, "log" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6d74aabc54f3b3f42870144f6e2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_stock_docs_no" ON "pr_stock_docs" ("organization_id", "kind", "doc_no") `);
        await queryRunner.query(`CREATE TABLE "pr_counts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "count_no" integer NOT NULL, "kind" character varying(10) NOT NULL, "warehouse_id" uuid NOT NULL, "group_id" uuid, "committee_ids" jsonb NOT NULL DEFAULT '[]', "date" date NOT NULL, "lines" jsonb NOT NULL DEFAULT '[]', "status" character varying(10) NOT NULL DEFAULT 'open', "shortage" numeric(16,2) NOT NULL DEFAULT '0', "surplus" numeric(16,2) NOT NULL DEFAULT '0', "entry_id" uuid, "notes" character varying(2000), "approved_by_name" character varying(200), "submitted_by_id" uuid, "created_by_name" character varying(200) NOT NULL, "log" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_053c5547ac26f3cb5c2ca3f94ab" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_counts_no" ON "pr_counts" ("organization_id", "count_no") `);
        await queryRunner.query(`ALTER TABLE "acc_asset_moves" ADD "pr_receipt_id" uuid`);
        await queryRunner.query(`ALTER TABLE "pr_orders" ADD "close_kind" character varying(10)`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "grni_account_id" uuid`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "adjust_account_id" uuid`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "adjust_analytic_id" uuid`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "donation_account_id" uuid`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "opening_account_id" uuid`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "default_expense_account_id" uuid`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "expiry_alert_days" integer NOT NULL DEFAULT '60'`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "over_receipt_pct" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "vat_in_cost" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "require_inspection" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`CREATE INDEX "IDX_pr_stock_layers_source" ON "pr_stock_layers" ("source_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_pr_stock_docs_ref" ON "pr_stock_docs" ("ref_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_stock_docs_ref"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_stock_layers_source"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "require_inspection"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "vat_in_cost"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "over_receipt_pct"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "expiry_alert_days"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "default_expense_account_id"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "opening_account_id"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "donation_account_id"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "adjust_analytic_id"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "adjust_account_id"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "grni_account_id"`);
        await queryRunner.query(`ALTER TABLE "pr_orders" DROP COLUMN "close_kind"`);
        await queryRunner.query(`ALTER TABLE "acc_asset_moves" DROP COLUMN "pr_receipt_id"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_counts_no"`);
        await queryRunner.query(`DROP TABLE "pr_counts"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_stock_docs_no"`);
        await queryRunner.query(`DROP TABLE "pr_stock_docs"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_issue_requests_no"`);
        await queryRunner.query(`DROP TABLE "pr_issue_requests"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_stock_balances"`);
        await queryRunner.query(`DROP TABLE "pr_stock_balances"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_stock_layers_item"`);
        await queryRunner.query(`DROP TABLE "pr_stock_layers"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_stock_moves_item"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_stock_moves_doc"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_stock_moves_account"`);
        await queryRunner.query(`DROP TABLE "pr_stock_moves"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_receipts_no"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_receipts_order"`);
        await queryRunner.query(`DROP TABLE "pr_receipts"`);
    }
}
