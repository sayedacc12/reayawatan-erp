import { MigrationInterface, QueryRunner } from "typeorm";

export class SupportDesk1794751927091 implements MigrationInterface {
    name = 'SupportDesk1794751927091'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "support_tasks" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "number" character varying(32) NOT NULL, "ticket_id" uuid, "title" character varying(200) NOT NULL, "description" text NOT NULL DEFAULT '', "priority" character varying(24) NOT NULL, "status" character varying(24) NOT NULL DEFAULT 'todo', "assignee_id" uuid NOT NULL, "assignee_name" character varying(200) NOT NULL, "created_by_id" uuid NOT NULL, "created_by_name" character varying(200) NOT NULL, "due_at" TIMESTAMP WITH TIME ZONE NOT NULL, "estimated_hours" numeric(7,2), "spent_hours" numeric(7,2) NOT NULL DEFAULT '0', "started_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "history" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e252e4f37b85fe52fe3f7df4a30" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_1643d2407f90f79fdccd82d95c" ON "support_tasks" ("number") `);
        await queryRunner.query(`CREATE INDEX "IDX_517daa980d259a96ed3a81b5b8" ON "support_tasks" ("ticket_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_d22818095602421f359ea230e1" ON "support_tasks" ("assignee_id", "status") `);
        await queryRunner.query(`ALTER TABLE "support_tickets" ADD "assigned_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "support_tickets" ADD "first_response_by_id" uuid`);
        await queryRunner.query(`ALTER TABLE "support_tickets" ADD "resolved_by_id" uuid`);
        await queryRunner.query(`ALTER TABLE "users" ADD "platform_role" character varying(24)`);
        await queryRunner.query(`ALTER TABLE "support_tasks" ADD CONSTRAINT "FK_517daa980d259a96ed3a81b5b85" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "support_tasks" DROP CONSTRAINT "FK_517daa980d259a96ed3a81b5b85"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "platform_role"`);
        await queryRunner.query(`ALTER TABLE "support_tickets" DROP COLUMN "resolved_by_id"`);
        await queryRunner.query(`ALTER TABLE "support_tickets" DROP COLUMN "first_response_by_id"`);
        await queryRunner.query(`ALTER TABLE "support_tickets" DROP COLUMN "assigned_at"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d22818095602421f359ea230e1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_517daa980d259a96ed3a81b5b8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1643d2407f90f79fdccd82d95c"`);
        await queryRunner.query(`DROP TABLE "support_tasks"`);
    }

}
