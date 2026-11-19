import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * نظام التخطيط والموازنات، المرحلة الثانية: مكتبة المعادلات بإصدارات، والموازنات التقديرية وبنودها وإصداراتها المعتمدة،
 * وحجوزات الأنظمة الأخرى على بنود الموازنة (للمتاح عند التعميد).
 */
export class BudgetsFormulas1795100000100 implements MigrationInterface {
  name = 'BudgetsFormulas1795100000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "plan_formulas" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "code" character varying(40) NOT NULL, "name" character varying(200) NOT NULL, "target" character varying(20) NOT NULL, "expression" character varying(2000) NOT NULL, "description" character varying(1500), "status" character varying(12) NOT NULL DEFAULT 'active', "version" integer NOT NULL DEFAULT '1', "is_system" boolean NOT NULL DEFAULT false, "history" jsonb NOT NULL DEFAULT '[]', "updated_by_name" character varying(200), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ae078c2ce19c14f6deaeef48136" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_plan_formulas_code" ON "plan_formulas" ("organization_id", "code") `);
    await queryRunner.query(`CREATE TABLE "plan_budgets" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "code" character varying(20) NOT NULL, "title" character varying(250) NOT NULL, "fiscal_year" integer NOT NULL, "description" character varying(2000), "methodology" character varying(20) NOT NULL DEFAULT 'mixed', "variables" jsonb NOT NULL DEFAULT '[]', "raise_rules" jsonb NOT NULL DEFAULT '[]', "hr_setup" jsonb NOT NULL DEFAULT '{}', "ceilings" jsonb NOT NULL DEFAULT '[]', "history_years" integer NOT NULL DEFAULT '3', "is_scenario" boolean NOT NULL DEFAULT false, "base_budget_id" uuid, "status" character varying(12) NOT NULL DEFAULT 'draft', "stage_index" integer, "wf_stages" jsonb NOT NULL DEFAULT '[]', "route_name" character varying(150), "approvals" jsonb NOT NULL DEFAULT '[]', "version" integer NOT NULL DEFAULT '0', "revision_note" character varying(1000), "approved_at" TIMESTAMP WITH TIME ZONE, "calculated_at" TIMESTAMP WITH TIME ZONE, "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1a8406243663fd1c0b26388e177" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_plan_budgets_code" ON "plan_budgets" ("organization_id", "code") `);
    await queryRunner.query(`CREATE TABLE "plan_budget_lines" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "budget_id" uuid NOT NULL, "section" character varying(12) NOT NULL, "kind" character varying(20) NOT NULL, "name" character varying(300) NOT NULL, "source_id" uuid, "source_ref" character varying(120), "unit_id" uuid, "unit_name" character varying(200), "account_id" uuid, "account_code" character varying(40), "account_name" character varying(200), "cost_center_id" uuid, "cost_center_name" character varying(200), "funding_type" character varying(14), "methodology" character varying(20) NOT NULL DEFAULT 'mixed', "params" jsonb NOT NULL DEFAULT '{}', "history" jsonb NOT NULL DEFAULT '{}', "allocations" jsonb NOT NULL DEFAULT '[]', "auto" numeric(16,2) NOT NULL DEFAULT '0', "override_amount" numeric(16,2), "override_note" character varying(1000), "amount" numeric(16,2) NOT NULL DEFAULT '0', "monthly" jsonb NOT NULL DEFAULT '[]', "trace" jsonb NOT NULL DEFAULT '[]', "warnings" jsonb NOT NULL DEFAULT '[]', "included" boolean NOT NULL DEFAULT true, "note" character varying(1000), "sort_order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8e98107025a4ad06b5363e7e272" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_plan_budget_lines_budget" ON "plan_budget_lines" ("budget_id", "section") `);
    await queryRunner.query(`CREATE TABLE "plan_budget_versions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "budget_id" uuid NOT NULL, "version" integer NOT NULL, "snapshot" jsonb NOT NULL, "expenses" numeric(16,2) NOT NULL DEFAULT '0', "revenues" numeric(16,2) NOT NULL DEFAULT '0', "note" character varying(1000), "approved_by_name" character varying(200) NOT NULL, "approved_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_7c51cb5defeca95fc5e8e4fa04a" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_plan_budget_versions" ON "plan_budget_versions" ("budget_id", "version") `);
    await queryRunner.query(`CREATE TABLE "plan_budget_commitments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "budget_id" uuid NOT NULL, "line_id" uuid NOT NULL, "funding_batch_id" uuid, "source_module" character varying(40) NOT NULL, "source_ref" character varying(120) NOT NULL, "source_id" uuid, "amount" numeric(16,2) NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'reserved', "note" character varying(500), "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_83935a7cc6eefbebbc7edb49af6" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_plan_budget_commitments_line" ON "plan_budget_commitments" ("line_id", "status") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_plan_budget_commitments_line"`);
    await queryRunner.query(`DROP TABLE "plan_budget_commitments"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_plan_budget_versions"`);
    await queryRunner.query(`DROP TABLE "plan_budget_versions"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_plan_budget_lines_budget"`);
    await queryRunner.query(`DROP TABLE "plan_budget_lines"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_plan_budgets_code"`);
    await queryRunner.query(`DROP TABLE "plan_budgets"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_plan_formulas_code"`);
    await queryRunner.query(`DROP TABLE "plan_formulas"`);
  }
}
