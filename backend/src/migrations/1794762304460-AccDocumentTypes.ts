import { MigrationInterface, QueryRunner } from "typeorm";

export class AccDocumentTypes1794762304460 implements MigrationInterface {
    name = 'AccDocumentTypes1794762304460'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "acc_document_types" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "code" character varying(20) NOT NULL, "name" character varying(80) NOT NULL, "description" character varying(300), "is_active" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_28f9d6938fc450b74ee3d1a19b1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_document_types_name" ON "acc_document_types" ("organization_id", "name") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_document_types_code" ON "acc_document_types" ("organization_id", "code") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_document_types_code"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_document_types_name"`);
        await queryRunner.query(`DROP TABLE "acc_document_types"`);
    }

}
