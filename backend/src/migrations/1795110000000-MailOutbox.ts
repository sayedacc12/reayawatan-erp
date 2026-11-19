import { MigrationInterface, QueryRunner } from "typeorm";

export class MailOutbox1795110000000 implements MigrationInterface {
    name = 'MailOutbox1795110000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "mail_outbox" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "to_email" character varying(254) NOT NULL, "subject" character varying(300) NOT NULL, "html" text, "text" text, "kind" character varying(40) NOT NULL, "organization_id" uuid, "sensitive" boolean NOT NULL DEFAULT false, "dedupe_key" character varying(200), "status" character varying(16) NOT NULL DEFAULT 'queued', "attempts" integer NOT NULL DEFAULT 0, "last_error" character varying(500), "next_attempt_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "sent_at" TIMESTAMP WITH TIME ZONE, "created_by" character varying(200), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_mail_outbox" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_mail_outbox_due" ON "mail_outbox" ("status", "next_attempt_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_mail_outbox_dedupe" ON "mail_outbox" ("dedupe_key") `);
        await queryRunner.query(`CREATE INDEX "IDX_mail_outbox_created" ON "mail_outbox" ("created_at") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_mail_outbox_created"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_mail_outbox_dedupe"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_mail_outbox_due"`);
        await queryRunner.query(`DROP TABLE "mail_outbox"`);
    }

}
