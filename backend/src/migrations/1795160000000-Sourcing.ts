import { MigrationInterface, QueryRunner } from "typeorm";

/** المشتريات (المرحلة الثانية): طلبات الشراء، والمنافسات وطلبات العروض واستفساراتها، وعروض الموردين، والتعميدات وأوامر الشراء، وإعدادات أساليب الشراء ومصفوفة الاعتماد */
export class Sourcing1795160000000 implements MigrationInterface {
    name = 'Sourcing1795160000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "pr_requests" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "request_no" integer NOT NULL, "title" character varying(250) NOT NULL, "kind" character varying(12) NOT NULL DEFAULT 'goods', "unit_id" uuid, "project_id" uuid, "beneficiary_ref" character varying(120), "needed_by" date, "priority" character varying(8) NOT NULL DEFAULT 'normal', "justification" text, "method" character varying(10), "method_reason" character varying(1000), "budget_line_id" uuid, "funding_batch_id" uuid, "estimated_total" numeric(14,2) NOT NULL DEFAULT '0', "lines" jsonb NOT NULL DEFAULT '[]', "attachments" jsonb NOT NULL DEFAULT '[]', "status" character varying(10) NOT NULL DEFAULT 'draft', "budget_check" jsonb, "requested_by_id" uuid, "requested_by_name" character varying(200) NOT NULL, "submitted_at" TIMESTAMP WITH TIME ZONE, "decided_by_name" character varying(200), "decided_at" TIMESTAMP WITH TIME ZONE, "decision_note" character varying(2000), "log" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6399205123e8b062d223a408261" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pr_requests_status" ON "pr_requests" ("organization_id", "status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_requests_no" ON "pr_requests" ("organization_id", "request_no") `);
        await queryRunner.query(`CREATE TABLE "pr_rfqs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "rfq_no" integer NOT NULL, "request_id" uuid NOT NULL, "title" character varying(250) NOT NULL, "method" character varying(10) NOT NULL, "scope" text, "terms" text, "lines" jsonb NOT NULL DEFAULT '[]', "attachments" jsonb NOT NULL DEFAULT '[]', "questions_until" TIMESTAMP WITH TIME ZONE, "closes_at" TIMESTAMP WITH TIME ZONE, "invited_ids" jsonb NOT NULL DEFAULT '[]', "category_ids" jsonb NOT NULL DEFAULT '[]', "criteria" jsonb NOT NULL DEFAULT '[]', "technical_pass" integer NOT NULL DEFAULT '0', "committee_ids" jsonb NOT NULL DEFAULT '[]', "status" character varying(12) NOT NULL DEFAULT 'draft', "published_at" TIMESTAMP WITH TIME ZONE, "opened_at" TIMESTAMP WITH TIME ZONE, "opened_by_name" character varying(200), "recommended_quote_id" uuid, "recommendation" text, "recommended_by_name" character varying(200), "recommended_at" TIMESTAMP WITH TIME ZONE, "cancel_reason" character varying(1000), "log" jsonb NOT NULL DEFAULT '[]', "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c3451c2fc3b5f2a25ea279ab5dd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pr_rfqs_request" ON "pr_rfqs" ("organization_id", "request_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_rfqs_no" ON "pr_rfqs" ("organization_id", "rfq_no") `);
        await queryRunner.query(`CREATE TABLE "pr_quotes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "rfq_id" uuid NOT NULL, "supplier_id" uuid NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'draft', "lines" jsonb NOT NULL DEFAULT '[]', "vat_rate" numeric(5,2) NOT NULL DEFAULT '15', "subtotal" numeric(14,2) NOT NULL DEFAULT '0', "vat" numeric(14,2) NOT NULL DEFAULT '0', "total" numeric(14,2) NOT NULL DEFAULT '0', "delivery_days" integer, "validity_days" integer, "technical_note" text, "attachments" jsonb NOT NULL DEFAULT '[]', "via" character varying(8) NOT NULL DEFAULT 'portal', "submitted_at" TIMESTAMP WITH TIME ZONE, "submitted_by_name" character varying(200), "revisions" jsonb NOT NULL DEFAULT '[]', "scores" jsonb NOT NULL DEFAULT '{}', "excluded_reason" character varying(1000), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_04937fd9bdd0ee25c81c6ab2453" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_quotes_rfq_supplier" ON "pr_quotes" ("rfq_id", "supplier_id") `);
        await queryRunner.query(`CREATE TABLE "pr_rfq_questions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "rfq_id" uuid NOT NULL, "supplier_id" uuid, "question" character varying(2000) NOT NULL, "answer" character varying(4000), "published" boolean NOT NULL DEFAULT false, "asked_by_name" character varying(200) NOT NULL, "answered_by_name" character varying(200), "answered_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0d98d84c41ea388fcd600af556c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pr_rfq_questions_rfq" ON "pr_rfq_questions" ("rfq_id") `);
        await queryRunner.query(`CREATE TABLE "pr_orders" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "order_no" integer NOT NULL, "kind" character varying(12) NOT NULL DEFAULT 'goods', "request_id" uuid NOT NULL, "rfq_id" uuid, "quote_id" uuid, "supplier_id" uuid NOT NULL, "title" character varying(250) NOT NULL, "lines" jsonb NOT NULL DEFAULT '[]', "vat_rate" numeric(5,2) NOT NULL DEFAULT '15', "subtotal" numeric(14,2) NOT NULL DEFAULT '0', "vat" numeric(14,2) NOT NULL DEFAULT '0', "total" numeric(14,2) NOT NULL DEFAULT '0', "unit_id" uuid, "project_id" uuid, "beneficiary_ref" character varying(120), "budget_line_id" uuid, "funding_batch_id" uuid, "warehouse_id" uuid, "delivery_date" date, "delivery_place" character varying(500), "terms" text, "status" character varying(14) NOT NULL DEFAULT 'draft', "required_levels" jsonb NOT NULL DEFAULT '[]', "approvals" jsonb NOT NULL DEFAULT '[]', "commitment_id" uuid, "funding_reserved" numeric(14,2) NOT NULL DEFAULT '0', "budget_check" jsonb, "version" integer NOT NULL DEFAULT '1', "responses" jsonb NOT NULL DEFAULT '[]', "issued_at" TIMESTAMP WITH TIME ZONE, "acknowledged_at" TIMESTAMP WITH TIME ZONE, "accepted_at" TIMESTAMP WITH TIME ZONE, "cancel_reason" character varying(1000), "created_by_id" uuid, "created_by_name" character varying(200) NOT NULL, "log" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d67035acb58d6fa29022266b60b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pr_orders_request" ON "pr_orders" ("organization_id", "request_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_pr_orders_supplier" ON "pr_orders" ("organization_id", "supplier_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_pr_orders_status" ON "pr_orders" ("organization_id", "status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_orders_no" ON "pr_orders" ("organization_id", "order_no") `);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "method_limits" jsonb NOT NULL DEFAULT '{"direct": 10000, "quotes": 100000}'`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "min_quotes" integer NOT NULL DEFAULT '3'`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "approval_levels" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "eval_criteria" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "technical_pass" integer NOT NULL DEFAULT '60'`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "order_terms" text`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "disclose_winner" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "disclose_winner"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "order_terms"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "technical_pass"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "eval_criteria"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "approval_levels"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "min_quotes"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "method_limits"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_orders_no"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_orders_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_orders_supplier"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_orders_request"`);
        await queryRunner.query(`DROP TABLE "pr_orders"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_rfq_questions_rfq"`);
        await queryRunner.query(`DROP TABLE "pr_rfq_questions"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_quotes_rfq_supplier"`);
        await queryRunner.query(`DROP TABLE "pr_quotes"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_rfqs_no"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_rfqs_request"`);
        await queryRunner.query(`DROP TABLE "pr_rfqs"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_requests_no"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_requests_status"`);
        await queryRunner.query(`DROP TABLE "pr_requests"`);
    }

}
