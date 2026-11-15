import { MigrationInterface, QueryRunner } from "typeorm";

export class OrgSubscriptions1794746833253 implements MigrationInterface {
    name = 'OrgSubscriptions1794746833253'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "subscription_contracts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "number" character varying(32) NOT NULL, "token" character varying(64) NOT NULL, "organization_id" uuid NOT NULL, "application_id" uuid, "status" character varying(24) NOT NULL DEFAULT 'draft', "terms" jsonb NOT NULL, "items" jsonb NOT NULL DEFAULT '[]', "rendered" jsonb, "content_hash" character varying(64), "sent_at" TIMESTAMP WITH TIME ZONE, "change_request" text, "signed_at" TIMESTAMP WITH TIME ZONE, "signer_name" character varying(200), "signer_title" character varying(200), "signer_ip" character varying(64), "history" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1153f8b714083609dfe342e85d7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_131db9e87dd8834cd028e0e534" ON "subscription_contracts" ("number") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_cdaebd17e73d2b8eec2c626f72" ON "subscription_contracts" ("token") `);
        await queryRunner.query(`CREATE INDEX "IDX_dc2eeaf7fca5ce3dc0c5b96015" ON "subscription_contracts" ("organization_id") `);
        await queryRunner.query(`CREATE TABLE "subscription_applications" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "number" character varying(32) NOT NULL, "token" character varying(64) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'submitted', "org_name" character varying(200) NOT NULL, "proposed_slug" character varying(64) NOT NULL, "city" character varying(100) NOT NULL, "org_email" character varying(254) NOT NULL, "org_phone" character varying(30) NOT NULL, "license_number" character varying(50) NOT NULL, "license_start_date" date NOT NULL, "license_end_date" date, "license_file_key" character varying(200) NOT NULL, "license_file_mime" character varying(64) NOT NULL, "license_file_name" character varying(200) NOT NULL, "executive_director" jsonb NOT NULL, "board_member" jsonb NOT NULL, "admin_full_name" character varying(200) NOT NULL, "admin_email" character varying(254) NOT NULL, "admin_password_hash" character varying(100), "review_note" text, "decided_at" TIMESTAMP WITH TIME ZONE, "terms" jsonb, "history" jsonb NOT NULL DEFAULT '[]', "organization_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_55afc0a9281d4b4b6253f7bddca" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_4da6016986f0a90d50fa662df9" ON "subscription_applications" ("number") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b847eb5a42227d149005b4d7e6" ON "subscription_applications" ("token") `);
        await queryRunner.query(`CREATE INDEX "IDX_d40cce1dd6aee9857e2fc3bfaa" ON "subscription_applications" ("organization_id") `);
        await queryRunner.query(`CREATE TABLE "platform_settings" ("key" character varying(64) NOT NULL, "value" jsonb NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5d9031e30fac3ec3ec8b9602e17" PRIMARY KEY ("key"))`);
        await queryRunner.query(`CREATE TABLE "contract_clauses" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "sequence" integer NOT NULL DEFAULT '0', "title" character varying(200) NOT NULL, "paragraphs" jsonb NOT NULL DEFAULT '[]', "is_mandatory" boolean NOT NULL DEFAULT false, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9c4109fd05e6f683ae0c49b000b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "allowed_screens" jsonb`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "subscription_status" character varying(24) NOT NULL DEFAULT 'active'`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "trial_ends_on" date`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "subscription_starts_on" date`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "subscription_ends_on" date`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "subscription_price" numeric(12,2)`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "billing_cycle" character varying(16)`);
        await queryRunner.query(`ALTER TABLE "subscription_contracts" ADD CONSTRAINT "FK_dc2eeaf7fca5ce3dc0c5b96015d" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "subscription_applications" ADD CONSTRAINT "FK_d40cce1dd6aee9857e2fc3bfaa8" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "subscription_applications" DROP CONSTRAINT "FK_d40cce1dd6aee9857e2fc3bfaa8"`);
        await queryRunner.query(`ALTER TABLE "subscription_contracts" DROP CONSTRAINT "FK_dc2eeaf7fca5ce3dc0c5b96015d"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "billing_cycle"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "subscription_price"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "subscription_ends_on"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "subscription_starts_on"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "trial_ends_on"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "subscription_status"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "allowed_screens"`);
        await queryRunner.query(`DROP TABLE "contract_clauses"`);
        await queryRunner.query(`DROP TABLE "platform_settings"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d40cce1dd6aee9857e2fc3bfaa"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b847eb5a42227d149005b4d7e6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4da6016986f0a90d50fa662df9"`);
        await queryRunner.query(`DROP TABLE "subscription_applications"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dc2eeaf7fca5ce3dc0c5b96015"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cdaebd17e73d2b8eec2c626f72"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_131db9e87dd8834cd028e0e534"`);
        await queryRunner.query(`DROP TABLE "subscription_contracts"`);
    }

}
