import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * القضايا الجوهرية وخارطة المعنيين لكل خطة: جدولان جديدان فقط، فلا تتغير الخطط ولا إصداراتها الحالية.
 * قابلة للتراجع (التراجع يحذف الجدولين وما فيهما).
 */
export class PlanIssuesStakeholders1795910000000 implements MigrationInterface {
    name = 'PlanIssuesStakeholders1795910000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "plan_material_issues" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "plan_id" uuid NOT NULL, "code" character varying(12) NOT NULL, "title" character varying(300) NOT NULL, "summary" character varying(3000) NOT NULL, "recommendations" character varying(3000), "sort_order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_plan_material_issues" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_plan_material_issues_plan" ON "plan_material_issues" ("organization_id", "plan_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_plan_material_issues_code" ON "plan_material_issues" ("organization_id", "plan_id", "code") `);
        await queryRunner.query(`CREATE TABLE "plan_stakeholders" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "plan_id" uuid NOT NULL, "code" character varying(12) NOT NULL, "name" character varying(200) NOT NULL, "category" character varying(100) NOT NULL, "definition" character varying(2000), "expects_from_us" character varying(2000), "we_expect" character varying(2000), "sort_order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_plan_stakeholders" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_plan_stakeholders_plan" ON "plan_stakeholders" ("organization_id", "plan_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_plan_stakeholders_code" ON "plan_stakeholders" ("organization_id", "plan_id", "code") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."UQ_plan_stakeholders_code"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_plan_stakeholders_plan"`);
        await queryRunner.query(`DROP TABLE "plan_stakeholders"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_plan_material_issues_code"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_plan_material_issues_plan"`);
        await queryRunner.query(`DROP TABLE "plan_material_issues"`);
    }
}
