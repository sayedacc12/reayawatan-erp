import { MigrationInterface, QueryRunner } from "typeorm";

export class SiteInquiries1795078616779 implements MigrationInterface {
    name = 'SiteInquiries1795078616779'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "platform_inquiries" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "number" SERIAL NOT NULL, "kind" character varying(20) NOT NULL, "service_code" character varying(30), "org_name" character varying(200) NOT NULL, "contact_name" character varying(200) NOT NULL, "job_title" character varying(120), "phone" character varying(30) NOT NULL, "email" character varying(200), "city" character varying(100), "message" text, "status" character varying(20) NOT NULL DEFAULT 'new', "log" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cad6625222d392ca395384dc182" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_platform_inquiries_status" ON "platform_inquiries" ("status", "created_at") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_platform_inquiries_status"`);
        await queryRunner.query(`DROP TABLE "platform_inquiries"`);
    }

}
