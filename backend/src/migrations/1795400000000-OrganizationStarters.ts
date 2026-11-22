import { MigrationInterface, QueryRunner } from "typeorm";

/** الإعدادات الافتراضية لكل نظام: سجل يمنع تفعيل الزر أكثر من مرة لكل (منشأة، نظام) ويحفظ من فعّله وما أضيف */

export class OrganizationStarters1795400000000 implements MigrationInterface {
    name = 'OrganizationStarters1795400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "organization_starters" ("organization_id" uuid NOT NULL, "module_code" character varying(40) NOT NULL, "status" character varying(12) NOT NULL, "applied_by" character varying(200) NOT NULL, "applied_by_id" uuid NOT NULL, "applied_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "results" jsonb NOT NULL DEFAULT '[]', CONSTRAINT "PK_organization_starters" PRIMARY KEY ("organization_id", "module_code"))`);
        await queryRunner.query(`CREATE INDEX "IDX_org_starters_org" ON "organization_starters" ("organization_id") `);
        await queryRunner.query(`ALTER TABLE "organization_starters" ADD CONSTRAINT "FK_organization_starters_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "organization_starters" DROP CONSTRAINT "FK_organization_starters_org"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_org_starters_org"`);
        await queryRunner.query(`DROP TABLE "organization_starters"`);
    }
}
