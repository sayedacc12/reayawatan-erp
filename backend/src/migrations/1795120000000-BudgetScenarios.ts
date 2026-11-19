import { MigrationInterface, QueryRunner } from 'typeorm';

/** نظام التخطيط والموازنات، المرحلة الثالثة: مؤثرات السيناريوهات وتحويلها إلى مشروع موازنة، وربط بند السيناريو ببند الأساسية */
export class BudgetScenarios1795120000000 implements MigrationInterface {
  name = 'BudgetScenarios1795120000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "plan_budgets" ADD "levers" jsonb NOT NULL DEFAULT '[]'`);
    await queryRunner.query(`ALTER TABLE "plan_budgets" ADD "promoted_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "plan_budgets" ADD "promoted_by_name" character varying(200)`);
    await queryRunner.query(`ALTER TABLE "plan_budget_lines" ADD "base_line_id" uuid`);
    await queryRunner.query(`CREATE INDEX "IDX_plan_budgets_base" ON "plan_budgets" ("base_budget_id") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_plan_budgets_base"`);
    await queryRunner.query(`ALTER TABLE "plan_budget_lines" DROP COLUMN "base_line_id"`);
    await queryRunner.query(`ALTER TABLE "plan_budgets" DROP COLUMN "promoted_by_name"`);
    await queryRunner.query(`ALTER TABLE "plan_budgets" DROP COLUMN "promoted_at"`);
    await queryRunner.query(`ALTER TABLE "plan_budgets" DROP COLUMN "levers"`);
  }
}
