import { MigrationInterface, QueryRunner } from "typeorm";

export class Governance1794998468627 implements MigrationInterface {
    name = 'Governance1794998468627'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "gov_settings" ("organization_id" uuid NOT NULL, "mapping" jsonb NOT NULL DEFAULT '{}', "facts" jsonb NOT NULL DEFAULT '{}', "alert_days" integer NOT NULL DEFAULT '30', "target_score" numeric(5,2) NOT NULL DEFAULT '90', "next_assessment_no" integer NOT NULL DEFAULT '1', "next_action_no" integer NOT NULL DEFAULT '1', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ad45e5be825100466891fc5c21a" PRIMARY KEY ("organization_id"))`);
        await queryRunner.query(`CREATE TABLE "gov_assessments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "code" character varying(20) NOT NULL, "title" character varying(250) NOT NULL, "kind" character varying(10) NOT NULL DEFAULT 'self', "period_type" character varying(12) NOT NULL DEFAULT 'quarterly', "fiscal_year" integer NOT NULL, "period_from" date NOT NULL, "period_to" date NOT NULL, "status" character varying(12) NOT NULL DEFAULT 'draft', "opinion" character varying(12) NOT NULL DEFAULT 'unqualified', "qualified_items" integer NOT NULL DEFAULT '0', "figures" jsonb, "figures_source" character varying(10) NOT NULL DEFAULT 'ledger', "figures_at" TIMESTAMP WITH TIME ZONE, "scores" jsonb, "notes" character varying(2000), "created_by_name" character varying(200) NOT NULL, "submitted_by_name" character varying(200), "approved_by_name" character varying(200), "approved_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_99f1b34cea18b2401ecc07fefdd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_gov_assessments_code" ON "gov_assessments" ("organization_id", "code") `);
        await queryRunner.query(`CREATE TABLE "gov_answers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "assessment_id" uuid NOT NULL, "item_code" character varying(20) NOT NULL, "choices" jsonb NOT NULL DEFAULT '[]', "percent" numeric(6,2), "points" numeric(8,4) NOT NULL DEFAULT '0', "evidence" character varying(2000), "note" character varying(2000), "from_signal" boolean NOT NULL DEFAULT false, "answered_by_name" character varying(200) NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_44eeb4423fd08d41189df3d8a01" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_gov_answers_item" ON "gov_answers" ("assessment_id", "item_code") `);
        await queryRunner.query(`CREATE TABLE "gov_actions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "code" character varying(20) NOT NULL, "assessment_id" uuid, "item_code" character varying(20), "practice_code" character varying(20), "title" character varying(300) NOT NULL, "description" text, "owner_name" character varying(200), "due_date" date, "status" character varying(12) NOT NULL DEFAULT 'planned', "priority" character varying(10) NOT NULL DEFAULT 'medium', "progress" integer NOT NULL DEFAULT '0', "expected_gain" numeric(8,3) NOT NULL DEFAULT '0', "source" character varying(10) NOT NULL DEFAULT 'manual', "completed_at" date, "note" character varying(2000), "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d60d88bf03e937283c8656cf9e9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_gov_actions_code" ON "gov_actions" ("organization_id", "code") `);
        await queryRunner.query(`CREATE TABLE "gov_obligations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "kind" character varying(20) NOT NULL, "title" character varying(300) NOT NULL, "fiscal_year" integer NOT NULL, "due_date" date NOT NULL, "done_date" date, "refs" jsonb NOT NULL DEFAULT '[]', "evidence" character varying(1000), "note" character varying(1000), "done_by_name" character varying(200), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_647ba7847acb555f3f1248b6706" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_gov_obligations_due" ON "gov_obligations" ("organization_id", "due_date") `);
        await queryRunner.query(`CREATE TABLE "gov_alert_states" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "alert_key" character varying(120) NOT NULL, "until_date" date, "note" character varying(1000), "by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e4d0f95650eb141d00f02d4fcbc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_gov_alert_states_key" ON "gov_alert_states" ("organization_id", "alert_key") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."UQ_gov_alert_states_key"`);
        await queryRunner.query(`DROP TABLE "gov_alert_states"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_gov_obligations_due"`);
        await queryRunner.query(`DROP TABLE "gov_obligations"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_gov_actions_code"`);
        await queryRunner.query(`DROP TABLE "gov_actions"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_gov_answers_item"`);
        await queryRunner.query(`DROP TABLE "gov_answers"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_gov_assessments_code"`);
        await queryRunner.query(`DROP TABLE "gov_assessments"`);
        await queryRunner.query(`DROP TABLE "gov_settings"`);
    }

}
