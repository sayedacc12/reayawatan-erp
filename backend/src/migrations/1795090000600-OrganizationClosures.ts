import { MigrationInterface, QueryRunner } from "typeorm";

export class OrganizationClosures1795090000600 implements MigrationInterface {
    name = 'OrganizationClosures1795090000600'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "organization_closures" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "org_name" character varying(200) NOT NULL, "org_slug" character varying(64) NOT NULL, "reason" character varying(16) NOT NULL, "status" character varying(16) NOT NULL, "delete_on" date NOT NULL, "agreement" jsonb, "requested_by" character varying(200) NOT NULL, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_records" integer, "log" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_organization_closures" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_organization_closures_org" ON "organization_closures" ("organization_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_organization_closures_org"`);
        await queryRunner.query(`DROP TABLE "organization_closures"`);
    }

}
