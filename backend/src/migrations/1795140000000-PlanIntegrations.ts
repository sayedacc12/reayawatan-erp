import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * نظام التخطيط والموازنات، المرحلة الخامسة: الربط بالمخاطر وتحليلات PESTEL/SWOT والمراجعة الداخلية والأداء الوظيفي.
 * المرجع يحفظ حالة العنصر وقت الربط (ref_meta) وإصداره (ref_version) لمقارنتها بحالته الحالية في النظام المصدر.
 */
export class PlanIntegrations1795140000000 implements MigrationInterface {
  name = 'PlanIntegrations1795140000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "plan_refs" ALTER COLUMN "ref_id" TYPE character varying(100)`);
    await queryRunner.query(`ALTER TABLE "plan_refs" ADD "ref_meta" jsonb NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE "plan_refs" ADD "ref_version" character varying(40)`);
    await queryRunner.query(`CREATE INDEX "IDX_plan_refs_source" ON "plan_refs" ("organization_id", "system", "ref_id") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_plan_refs_source"`);
    await queryRunner.query(`ALTER TABLE "plan_refs" DROP COLUMN "ref_version"`);
    await queryRunner.query(`ALTER TABLE "plan_refs" DROP COLUMN "ref_meta"`);
    await queryRunner.query(`ALTER TABLE "plan_refs" ALTER COLUMN "ref_id" TYPE character varying(60)`);
  }
}
