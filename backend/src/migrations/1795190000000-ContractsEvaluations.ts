/** المرحلة الخامسة: عقود الموردين وتقييمهم، وربط التعميد بالعقد. قابل للتراجع. */
import { MigrationInterface, QueryRunner } from "typeorm";

export class ContractsEvaluations1795190000000 implements MigrationInterface {
    name = 'ContractsEvaluations1795190000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "pr_contracts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "contract_no" integer NOT NULL, "kind" character varying(12) NOT NULL DEFAULT 'supply', "supplier_id" uuid NOT NULL, "reference" character varying(60), "title" character varying(250) NOT NULL, "scope" text, "terms" text, "starts_on" date NOT NULL, "ends_on" date NOT NULL, "value" numeric(16,2) NOT NULL DEFAULT '0', "alert_pct" integer NOT NULL DEFAULT '80', "alert_days" integer NOT NULL DEFAULT '30', "project_id" uuid, "budget_line_id" uuid, "funding_batch_id" uuid, "pt_contract_id" uuid, "risk_ids" jsonb NOT NULL DEFAULT '[]', "prices" jsonb NOT NULL DEFAULT '[]', "guarantees" jsonb NOT NULL DEFAULT '[]', "slas" jsonb NOT NULL DEFAULT '[]', "kpi_readings" jsonb NOT NULL DEFAULT '[]', "penalty_rules" jsonb NOT NULL DEFAULT '[]', "penalties" jsonb NOT NULL DEFAULT '[]', "amendments" jsonb NOT NULL DEFAULT '[]', "required_docs" jsonb NOT NULL DEFAULT '[]', "attachments" jsonb NOT NULL DEFAULT '[]', "share_with_supplier" boolean NOT NULL DEFAULT true, "status" character varying(12) NOT NULL DEFAULT 'draft', "version" integer NOT NULL DEFAULT '1', "return_reason" character varying(1000), "end_reason" character varying(1000), "approved_by_id" uuid, "approved_by_name" character varying(200), "approved_at" TIMESTAMP WITH TIME ZONE, "created_by_id" uuid, "created_by_name" character varying(200) NOT NULL, "editor_ids" jsonb NOT NULL DEFAULT '[]', "log" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c7aac417faaa4f229146c0940ee" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_contracts_no" ON "pr_contracts" ("organization_id", "contract_no") `);
        await queryRunner.query(`CREATE INDEX "IDX_pr_contracts_supplier" ON "pr_contracts" ("organization_id", "supplier_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_pr_contracts_org" ON "pr_contracts" ("organization_id", "status") `);
        await queryRunner.query(`CREATE TABLE "pr_supplier_evaluations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "eval_no" integer NOT NULL, "supplier_id" uuid NOT NULL, "kind" character varying(10) NOT NULL DEFAULT 'periodic', "order_id" uuid, "contract_id" uuid, "period_from" date NOT NULL, "period_to" date NOT NULL, "metrics" jsonb NOT NULL, "scores" jsonb NOT NULL DEFAULT '[]', "total" numeric(5,2) NOT NULL DEFAULT '0', "grade" character varying(1) NOT NULL DEFAULT 'C', "strengths" text, "weaknesses" text, "recommendation" text, "status" character varying(10) NOT NULL DEFAULT 'draft', "share_with_supplier" boolean NOT NULL DEFAULT true, "supplier_response" text, "improvement_plan" text, "response_at" TIMESTAMP WITH TIME ZONE, "return_reason" character varying(1000), "evaluator_id" uuid, "evaluator_name" character varying(200) NOT NULL, "editor_ids" jsonb NOT NULL DEFAULT '[]', "approved_by_id" uuid, "approved_by_name" character varying(200), "approved_at" TIMESTAMP WITH TIME ZONE, "log" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_37fb47ba97816c42227a2095684" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_sup_evals_no" ON "pr_supplier_evaluations" ("organization_id", "eval_no") `);
        await queryRunner.query(`CREATE INDEX "IDX_pr_sup_evals_supplier" ON "pr_supplier_evaluations" ("organization_id", "supplier_id") `);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "supplier_criteria" jsonb`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "grade_limits" jsonb`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "block_weak" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "pr_settings" ADD "audit_area_ids" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "pr_suppliers" ADD "rating" numeric(5,2)`);
        await queryRunner.query(`ALTER TABLE "pr_suppliers" ADD "grade" character varying(1)`);
        await queryRunner.query(`ALTER TABLE "pr_suppliers" ADD "rated_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "pr_orders" ADD "contract_id" uuid`);
        await queryRunner.query(`CREATE INDEX "IDX_pr_orders_contract" ON "pr_orders" ("organization_id", "contract_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_orders_contract"`);
        await queryRunner.query(`ALTER TABLE "pr_orders" DROP COLUMN "contract_id"`);
        await queryRunner.query(`ALTER TABLE "pr_suppliers" DROP COLUMN "rated_at"`);
        await queryRunner.query(`ALTER TABLE "pr_suppliers" DROP COLUMN "grade"`);
        await queryRunner.query(`ALTER TABLE "pr_suppliers" DROP COLUMN "rating"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "audit_area_ids"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "block_weak"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "grade_limits"`);
        await queryRunner.query(`ALTER TABLE "pr_settings" DROP COLUMN "supplier_criteria"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_sup_evals_supplier"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_sup_evals_no"`);
        await queryRunner.query(`DROP TABLE "pr_supplier_evaluations"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_contracts_org"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_contracts_supplier"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_contracts_no"`);
        await queryRunner.query(`DROP TABLE "pr_contracts"`);
    }

}
