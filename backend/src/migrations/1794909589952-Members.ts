import { MigrationInterface, QueryRunner } from "typeorm";

export class Members1794909589952 implements MigrationInterface {
    name = 'Members1794909589952'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "mem_settings" ("organization_id" uuid NOT NULL, "public_enabled" boolean NOT NULL DEFAULT true, "intro" text, "types" jsonb NOT NULL DEFAULT '[]', "conditions" jsonb NOT NULL DEFAULT '[]', "regulation" jsonb NOT NULL DEFAULT '{}', "application_fields" jsonb NOT NULL DEFAULT '[]', "documents" jsonb NOT NULL DEFAULT '[]', "stages" jsonb NOT NULL DEFAULT '[]', "payment" jsonb NOT NULL DEFAULT '{}', "accounting" jsonb NOT NULL DEFAULT '{}', "renewal" jsonb NOT NULL DEFAULT '{}', "card" jsonb NOT NULL DEFAULT '{}', "initialized" boolean NOT NULL DEFAULT false, "next_application_no" integer NOT NULL DEFAULT '1', "next_member_no" integer NOT NULL DEFAULT '1', "next_invoice_no" integer NOT NULL DEFAULT '1', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_da2844fa6d8436bac9ea7d84079" PRIMARY KEY ("organization_id"))`);
        await queryRunner.query(`CREATE TABLE "mem_applications" ("full_name" character varying(200) NOT NULL, "national_id" character varying(20) NOT NULL, "id_expiry" date, "nationality" character varying(60) NOT NULL, "gender" character varying(10) NOT NULL, "birth_date" date, "mobile" character varying(20) NOT NULL, "email" character varying(200), "city" character varying(100), "address" character varying(300), "occupation" character varying(150), "employer" character varying(200), "qualification" character varying(100), "answers" jsonb NOT NULL DEFAULT '{}', "documents" jsonb NOT NULL DEFAULT '[]', "id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "application_no" character varying(30) NOT NULL, "type_code" character varying(40) NOT NULL, "accepted_conditions" jsonb NOT NULL DEFAULT '[]', "status" character varying(20) NOT NULL DEFAULT 'in_review', "stage_index" integer NOT NULL DEFAULT '0', "stages" jsonb NOT NULL DEFAULT '[]', "approval_log" jsonb NOT NULL DEFAULT '[]', "source" character varying(10) NOT NULL DEFAULT 'staff', "track_code" character varying(20) NOT NULL, "member_id" uuid, "invoice_id" uuid, "created_by_name" character varying(200), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2cf358fcb4c0e71aed9a18e534a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_mem_applications_nid" ON "mem_applications" ("organization_id", "national_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_mem_applications_org_no" ON "mem_applications" ("organization_id", "application_no") `);
        await queryRunner.query(`CREATE TABLE "mem_members" ("full_name" character varying(200) NOT NULL, "national_id" character varying(20) NOT NULL, "id_expiry" date, "nationality" character varying(60) NOT NULL, "gender" character varying(10) NOT NULL, "birth_date" date, "mobile" character varying(20) NOT NULL, "email" character varying(200), "city" character varying(100), "address" character varying(300), "occupation" character varying(150), "employer" character varying(200), "qualification" character varying(100), "answers" jsonb NOT NULL DEFAULT '{}', "documents" jsonb NOT NULL DEFAULT '[]', "id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "member_no" integer NOT NULL, "type_code" character varying(40) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'active', "joined_on" date NOT NULL, "start_date" date NOT NULL, "end_date" date NOT NULL, "application_id" uuid, "card_code" character varying(20) NOT NULL, "status_note" character varying(1000), "source" character varying(12) NOT NULL DEFAULT 'application', "history" jsonb NOT NULL DEFAULT '[]', "created_by_name" character varying(200), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_94a2f964cb8e1887ea0cd31f6b8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_mem_members_card" ON "mem_members" ("card_code") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_mem_members_org_nid" ON "mem_members" ("organization_id", "national_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_mem_members_org_no" ON "mem_members" ("organization_id", "member_no") `);
        await queryRunner.query(`CREATE TABLE "mem_invoices" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "invoice_no" character varying(30) NOT NULL, "kind" character varying(10) NOT NULL, "member_id" uuid, "application_id" uuid, "type_code" character varying(40) NOT NULL, "party_name" character varying(200) NOT NULL, "national_id" character varying(20) NOT NULL, "mobile" character varying(20) NOT NULL, "items" jsonb NOT NULL DEFAULT '[]', "amount" numeric(12,2) NOT NULL, "due_date" date NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'unpaid', "pay_token" character varying(40) NOT NULL, "method" character varying(10), "paid_on" date, "paid_at" TIMESTAMP WITH TIME ZONE, "period_start" date, "period_end" date, "gateway_id" character varying(120), "gateway_url" character varying(500), "transfer_receipt" jsonb, "payment_ref" character varying(120), "received_by_name" character varying(200), "voucher_id" uuid, "voucher_error" character varying(500), "note" character varying(1000), "created_by_name" character varying(200), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c187bef9a40052f1a69b3b4c8d4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_mem_invoices_member" ON "mem_invoices" ("organization_id", "member_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_mem_invoices_token" ON "mem_invoices" ("pay_token") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_mem_invoices_org_no" ON "mem_invoices" ("organization_id", "invoice_no") `);
        await queryRunner.query(`CREATE TABLE "mem_notices" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "member_id" uuid NOT NULL, "invoice_id" uuid, "channel" character varying(20) NOT NULL, "days_left" integer NOT NULL, "message" text NOT NULL, "sent_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_90005fb340c93e96300692d0007" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_mem_notices_member" ON "mem_notices" ("organization_id", "member_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_mem_notices_member"`);
        await queryRunner.query(`DROP TABLE "mem_notices"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_mem_invoices_org_no"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_mem_invoices_token"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_mem_invoices_member"`);
        await queryRunner.query(`DROP TABLE "mem_invoices"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_mem_members_org_no"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_mem_members_org_nid"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_mem_members_card"`);
        await queryRunner.query(`DROP TABLE "mem_members"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_mem_applications_org_no"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_mem_applications_nid"`);
        await queryRunner.query(`DROP TABLE "mem_applications"`);
        await queryRunner.query(`DROP TABLE "mem_settings"`);
    }

}
