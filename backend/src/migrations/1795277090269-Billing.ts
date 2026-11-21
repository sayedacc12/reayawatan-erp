import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * الفوترة والمبيعات (المرحلة الأولى): إعدادات الفوترة لكل جمعية، وسجل العملاء، والأصناف والخدمات وفئاتها الضريبية،
 * والفواتير والإشعارات الدائنة والمدينة بمعرّفها الفريد وعدادها المتسلسل ورمز QR. جداول جديدة فقط، ويمكن التراجع عنها.
 */
export class Billing1795277090269 implements MigrationInterface {
    name = 'Billing1795277090269';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "bl_settings" ("organization_id" uuid NOT NULL, "mode" character varying(16) NOT NULL DEFAULT 'off', "seller_name" character varying(250), "seller_name_en" character varying(250), "vat_number" character varying(15), "id_type" character varying(4), "id_number" character varying(40), "address" jsonb, "vat_rate" numeric(5,2) NOT NULL DEFAULT '15', "receivables_account_id" uuid, "vat_output_account_id" uuid, "revenue_account_id" uuid, "customer_category_id" uuid, "analytic_id" uuid, "payment_days" integer NOT NULL DEFAULT '30', "terms" character varying(2000), "log" jsonb NOT NULL DEFAULT '[]', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_39f55bb5661a7cee343050396a4" PRIMARY KEY ("organization_id"))`);
        await queryRunner.query(`CREATE TABLE "bl_customers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "customer_no" integer NOT NULL, "kind" character varying(12) NOT NULL DEFAULT 'individual', "name" character varying(250) NOT NULL, "name_en" character varying(250), "vat_number" character varying(15), "id_type" character varying(4), "id_number" character varying(40), "address" jsonb, "phone" character varying(20), "email" character varying(200), "partner_id" uuid, "is_active" boolean NOT NULL DEFAULT true, "notes" character varying(1000), "log" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_441d9ddd9f0fe7c6254b017f7a7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_bl_customers_org" ON "bl_customers" ("organization_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_bl_customers_no" ON "bl_customers" ("organization_id", "customer_no") `);
        await queryRunner.query(`CREATE TABLE "bl_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "code" character varying(30) NOT NULL, "name" character varying(250) NOT NULL, "name_en" character varying(250), "kind" character varying(10) NOT NULL DEFAULT 'service', "unit" character varying(40), "price" numeric(16,2) NOT NULL DEFAULT '0', "vat_category" character varying(1) NOT NULL DEFAULT 'S', "reason_code" character varying(20), "revenue_account_id" uuid, "is_active" boolean NOT NULL DEFAULT true, "log" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3cc20e1cf9c6991a28bf4fc1de8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_bl_items_org" ON "bl_items" ("organization_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_bl_items_code" ON "bl_items" ("organization_id", "code") `);
        await queryRunner.query(`CREATE TABLE "bl_documents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "doc_no" integer NOT NULL, "kind" character varying(12) NOT NULL DEFAULT 'invoice', "doc_type" character varying(12) NOT NULL, "uuid" uuid, "icv" integer, "customer_id" uuid, "buyer" jsonb, "ref_id" uuid, "reason" character varying(500), "issue_date" date NOT NULL, "supply_date" date, "due_date" date, "lines" jsonb NOT NULL DEFAULT '[]', "breakdown" jsonb NOT NULL DEFAULT '[]', "gross" numeric(16,2) NOT NULL DEFAULT '0', "discount" numeric(16,2) NOT NULL DEFAULT '0', "taxable" numeric(16,2) NOT NULL DEFAULT '0', "vat" numeric(16,2) NOT NULL DEFAULT '0', "total" numeric(16,2) NOT NULL DEFAULT '0', "status" character varying(10) NOT NULL DEFAULT 'draft', "analytic_id" uuid, "qr" text, "issued_mode" character varying(16), "seller" jsonb, "entry_id" uuid, "paid_amount" numeric(16,2) NOT NULL DEFAULT '0', "credited_amount" numeric(16,2) NOT NULL DEFAULT '0', "debited_amount" numeric(16,2) NOT NULL DEFAULT '0', "notes" character varying(2000), "return_reason" character varying(1000), "created_by_id" uuid, "created_by_name" character varying(200) NOT NULL, "editor_ids" jsonb NOT NULL DEFAULT '[]', "issued_by_id" uuid, "issued_by_name" character varying(200), "issued_at" TIMESTAMP WITH TIME ZONE, "log" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_aaaed156da50702d8da6ba801c7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_bl_documents_ref" ON "bl_documents" ("organization_id", "ref_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_bl_documents_customer" ON "bl_documents" ("organization_id", "customer_id", "status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_bl_documents_no" ON "bl_documents" ("organization_id", "doc_no") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_bl_documents_icv" ON "bl_documents" ("organization_id", "icv") WHERE icv IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_bl_documents_uuid" ON "bl_documents" ("uuid") WHERE uuid IS NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."UQ_bl_documents_uuid"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_bl_documents_icv"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_bl_documents_no"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bl_documents_customer"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bl_documents_ref"`);
        await queryRunner.query(`DROP TABLE "bl_documents"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_bl_items_code"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bl_items_org"`);
        await queryRunner.query(`DROP TABLE "bl_items"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_bl_customers_no"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bl_customers_org"`);
        await queryRunner.query(`DROP TABLE "bl_customers"`);
        await queryRunner.query(`DROP TABLE "bl_settings"`);
    }
}
