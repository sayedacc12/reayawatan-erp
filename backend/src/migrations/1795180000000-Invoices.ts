import { MigrationInterface, QueryRunner } from 'typeorm';

/** المشتريات المرحلة الرابعة: فواتير الموردين والإشعارات الدائنة والمطابقة الثلاثية، وإعدادات التجاوز وضريبة المدخلات ومدة السداد */
export class Invoices1795180000000 implements MigrationInterface {
    name = 'Invoices1795180000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "pr_invoices" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "invoice_no" integer NOT NULL, "kind" character varying(12) NOT NULL DEFAULT 'invoice', "order_id" uuid NOT NULL, "supplier_id" uuid NOT NULL, "ref_invoice_id" uuid, "supplier_invoice_no" character varying(60) NOT NULL, "supplier_key" character varying(60) NOT NULL, "invoice_date" date NOT NULL, "due_date" date, "lines" jsonb NOT NULL DEFAULT '[]', "extra_amount" numeric(16,2) NOT NULL DEFAULT '0', "vat_rate" numeric(5,2) NOT NULL DEFAULT '15', "subtotal" numeric(16,2) NOT NULL DEFAULT '0', "vat" numeric(16,2) NOT NULL DEFAULT '0', "total" numeric(16,2) NOT NULL DEFAULT '0', "status" character varying(10) NOT NULL DEFAULT 'draft', "match" jsonb, "override" jsonb, "via" character varying(8) NOT NULL DEFAULT 'portal', "attachments" jsonb NOT NULL DEFAULT '[]', "messages" jsonb NOT NULL DEFAULT '[]', "notes" character varying(2000), "return_reason" character varying(1000), "submitted_at" TIMESTAMP WITH TIME ZONE, "approved_by_id" uuid, "approved_by_name" character varying(200), "approved_at" TIMESTAMP WITH TIME ZONE, "entry_id" uuid, "posted_by_name" character varying(200), "posted_at" TIMESTAMP WITH TIME ZONE, "paid_amount" numeric(16,2) NOT NULL DEFAULT '0', "credited_amount" numeric(16,2) NOT NULL DEFAULT '0', "budget_diff" numeric(16,2) NOT NULL DEFAULT '0', "funding_diff" numeric(16,2) NOT NULL DEFAULT '0', "budget_commitment_id" uuid, "asset_move_ids" jsonb NOT NULL DEFAULT '[]', "created_by_id" uuid, "editor_ids" jsonb NOT NULL DEFAULT '[]', "created_by_name" character varying(200) NOT NULL, "log" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_433314129d92acccee0c7d33bcb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pr_invoices_key" ON "pr_invoices" ("organization_id", "supplier_id", "supplier_key") `);
        await queryRunner.query(`CREATE INDEX "IDX_pr_invoices_order" ON "pr_invoices" ("organization_id", "order_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_pr_invoices_supplier" ON "pr_invoices" ("organization_id", "supplier_id", "status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_invoices_no" ON "pr_invoices" ("organization_id", "invoice_no") `);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "match_tolerance_pct" numeric(5,2) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "vat_input_account_id" uuid`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "payment_days" integer NOT NULL DEFAULT '30'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "payment_days"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "vat_input_account_id"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "match_tolerance_pct"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_invoices_no"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_invoices_supplier"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_invoices_order"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_invoices_key"`);
        await queryRunner.query(`DROP TABLE "pr_invoices"`);
    }
}
