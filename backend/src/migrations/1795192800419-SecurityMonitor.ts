import { MigrationInterface, QueryRunner } from "typeorm";

/** المراقب الأمني «سيد»: سجل الأحداث الأمنية والحوادث والعناوين المحظورة والتقارير اليومية (جداول منصة، لا بيانات جمعيات) */

export class SecurityMonitor1795192800419 implements MigrationInterface {
    name = 'SecurityMonitor1795192800419'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "sec_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "at" TIMESTAMP WITH TIME ZONE NOT NULL, "type" character varying(40) NOT NULL, "severity" character varying(10) NOT NULL DEFAULT 'info', "ip" character varying(64), "user_id" uuid, "org_id" uuid, "actor" character varying(160), "method" character varying(10), "route" character varying(200), "status" integer, "detail" jsonb, CONSTRAINT "PK_d498dafca9719a9940cb22fce49" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_sec_events_user_at" ON "sec_events" ("user_id", "at") `);
        await queryRunner.query(`CREATE INDEX "IDX_sec_events_ip_at" ON "sec_events" ("ip", "at") `);
        await queryRunner.query(`CREATE INDEX "IDX_sec_events_type_at" ON "sec_events" ("type", "at") `);
        await queryRunner.query(`CREATE INDEX "IDX_sec_events_at" ON "sec_events" ("at") `);
        await queryRunner.query(`CREATE TABLE "sec_incidents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "rule" character varying(40) NOT NULL, "severity" character varying(10) NOT NULL, "title" character varying(200) NOT NULL, "summary" character varying(2000) NOT NULL, "dedupe_key" character varying(200) NOT NULL, "ip" character varying(64), "user_id" uuid, "org_id" uuid, "hits" integer NOT NULL DEFAULT '1', "status" character varying(14) NOT NULL DEFAULT 'open', "actions" jsonb NOT NULL DEFAULT '[]', "pending_action" character varying(30), "alerted_at" TIMESTAMP WITH TIME ZONE, "first_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL, "closed_by" character varying(200), CONSTRAINT "PK_c8fcc1c9f670b749e52cc249e04" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_sec_incidents_key" ON "sec_incidents" ("dedupe_key", "last_seen_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_sec_incidents_status" ON "sec_incidents" ("status", "last_seen_at") `);
        await queryRunner.query(`CREATE TABLE "sec_blocks" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "ip" character varying(64) NOT NULL, "reason" character varying(300) NOT NULL, "incident_id" uuid, "created_by" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "lifted_at" TIMESTAMP WITH TIME ZONE, "lifted_by" character varying(200), "blocked_requests" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_db165f76e27551d99e766353186" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_sec_blocks_active" ON "sec_blocks" ("ip", "expires_at") `);
        await queryRunner.query(`CREATE TABLE "sec_reports" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "day" date NOT NULL, "summary" jsonb NOT NULL, "recipients" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_60ef18be2720224ee8bb6513068" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_sec_reports_day" ON "sec_reports" ("day") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."UQ_sec_reports_day"`);
        await queryRunner.query(`DROP TABLE "sec_reports"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_sec_blocks_active"`);
        await queryRunner.query(`DROP TABLE "sec_blocks"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_sec_incidents_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_sec_incidents_key"`);
        await queryRunner.query(`DROP TABLE "sec_incidents"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_sec_events_at"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_sec_events_type_at"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_sec_events_ip_at"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_sec_events_user_at"`);
        await queryRunner.query(`DROP TABLE "sec_events"`);
    }

}
