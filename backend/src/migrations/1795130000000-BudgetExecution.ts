import { MigrationInterface, QueryRunner } from 'typeorm';

/** نظام التخطيط والموازنات، المرحلة الرابعة: متابعة التنفيذ مع النظام المالي، والمناقلات والزيادات والتخفيضات بمسار اعتماد */
export class BudgetExecution1795130000000 implements MigrationInterface {
  name = 'BudgetExecution1795130000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "plan_budget_lines" ADD "actual_map" jsonb`);
    await queryRunner.query(`CREATE TABLE "plan_budget_transfers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "budget_id" uuid NOT NULL, "code" character varying(20) NOT NULL, "kind" character varying(10) NOT NULL, "from_line_id" uuid, "from_name" character varying(300), "to_line_id" uuid, "to_name" character varying(300), "amount" numeric(16,2) NOT NULL, "from_month" integer NOT NULL DEFAULT '1', "reason" character varying(1500) NOT NULL, "impact" jsonb NOT NULL DEFAULT '{}', "status" character varying(12) NOT NULL DEFAULT 'draft', "stage_index" integer, "wf_stages" jsonb NOT NULL DEFAULT '[]', "route_name" character varying(150), "approvals" jsonb NOT NULL DEFAULT '[]', "approved_at" TIMESTAMP WITH TIME ZONE, "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_plan_budget_transfers" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_plan_budget_transfers_budget" ON "plan_budget_transfers" ("budget_id", "status") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_plan_budget_transfers_budget"`);
    await queryRunner.query(`DROP TABLE "plan_budget_transfers"`);
    await queryRunner.query(`ALTER TABLE "plan_budget_lines" DROP COLUMN "actual_map"`);
  }
}
