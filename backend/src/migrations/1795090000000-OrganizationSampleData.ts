import { MigrationInterface, QueryRunner } from "typeorm";

export class OrganizationSampleData1795090000000 implements MigrationInterface {
    name = 'OrganizationSampleData1795090000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "organization_sample_data" ("organization_id" uuid NOT NULL, "status" character varying(16) NOT NULL, "loaded_by" character varying(200) NOT NULL, "loaded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "baseline" jsonb NOT NULL, "sample" jsonb, "cleared_at" TIMESTAMP WITH TIME ZONE, "cleared_by" character varying(200), "log" jsonb NOT NULL DEFAULT '[]', CONSTRAINT "PK_organization_sample_data" PRIMARY KEY ("organization_id"))`);
        await queryRunner.query(`ALTER TABLE "organization_sample_data" ADD CONSTRAINT "FK_organization_sample_data_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "organization_sample_data"`);
    }

}
