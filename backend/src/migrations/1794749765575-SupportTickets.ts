import { MigrationInterface, QueryRunner } from "typeorm";

export class SupportTickets1794749765575 implements MigrationInterface {
    name = 'SupportTickets1794749765575'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "support_tickets" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "number" character varying(32) NOT NULL, "organization_id" uuid NOT NULL, "subject" character varying(200) NOT NULL, "category" character varying(24) NOT NULL, "priority" character varying(24) NOT NULL, "requested_priority" character varying(24) NOT NULL, "status" character varying(24) NOT NULL DEFAULT 'new', "screen" character varying(200), "created_by_id" uuid, "created_by_name" character varying(200) NOT NULL, "contact_phone" character varying(30), "assignee_id" uuid, "assignee_name" character varying(200), "response_due_at" TIMESTAMP WITH TIME ZONE NOT NULL, "resolution_due_at" TIMESTAMP WITH TIME ZONE NOT NULL, "first_response_at" TIMESTAMP WITH TIME ZONE, "waiting_since" TIMESTAMP WITH TIME ZONE, "resolved_at" TIMESTAMP WITH TIME ZONE, "closed_at" TIMESTAMP WITH TIME ZONE, "escalated_at" TIMESTAMP WITH TIME ZONE, "rating" smallint, "history" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_942e8d8f5df86100471d2324643" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_4dbd7a948ea8901cf5742dafc0" ON "support_tickets" ("number") `);
        await queryRunner.query(`CREATE INDEX "IDX_ba7b1a2ed4051fb3b39ff95444" ON "support_tickets" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_a627373eaf5903059f23fd98e9" ON "support_tickets" ("organization_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "support_messages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "ticket_id" uuid NOT NULL, "side" character varying(16) NOT NULL, "author_name" character varying(200) NOT NULL, "body" text NOT NULL, "is_internal" boolean NOT NULL DEFAULT false, "file_key" character varying(200), "file_name" character varying(200), "file_mime" character varying(64), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2aa37479e71ef29cbf4dba2b1a2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_2504f19a76ce14af20a65cfa1f" ON "support_messages" ("ticket_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "support_tickets" ADD CONSTRAINT "FK_d260da44741e5cb4df0d628ea40" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "support_messages" ADD CONSTRAINT "FK_d5e0c744062d01ccda719d7ef17" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "support_messages" DROP CONSTRAINT "FK_d5e0c744062d01ccda719d7ef17"`);
        await queryRunner.query(`ALTER TABLE "support_tickets" DROP CONSTRAINT "FK_d260da44741e5cb4df0d628ea40"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2504f19a76ce14af20a65cfa1f"`);
        await queryRunner.query(`DROP TABLE "support_messages"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a627373eaf5903059f23fd98e9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ba7b1a2ed4051fb3b39ff95444"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4dbd7a948ea8901cf5742dafc0"`);
        await queryRunner.query(`DROP TABLE "support_tickets"`);
    }

}
