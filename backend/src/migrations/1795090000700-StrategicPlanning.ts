import { MigrationInterface, QueryRunner } from "typeorm";

/** التخطيط الاستراتيجي والتشغيلي: الخطط وعناصرها وعلاقاتها ومراجعها ومؤشراتها وقراءاتها وسجل الإنجاز والإصدارات والإعدادات */

export class StrategicPlanning1795090000700 implements MigrationInterface {
    name = 'StrategicPlanning1795090000700'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "plan_settings" ("organization_id" uuid NOT NULL, "config" jsonb NOT NULL DEFAULT '{}', "counters" jsonb NOT NULL DEFAULT '{}', CONSTRAINT "PK_320483c04a5144e3f1004ce53e0" PRIMARY KEY ("organization_id"))`);
        await queryRunner.query(`CREATE TABLE "plan_plans" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "code" character varying(20) NOT NULL, "kind" character varying(12) NOT NULL, "title" character varying(250) NOT NULL, "description" character varying(3000), "start_year" integer NOT NULL, "end_year" integer NOT NULL, "periodicity" character varying(12) NOT NULL DEFAULT 'annual', "vision" character varying(1000), "mission" character varying(1500), "values" jsonb NOT NULL DEFAULT '[]', "unit_id" uuid, "unit_name" character varying(200), "shared_units" jsonb NOT NULL DEFAULT '[]', "parent_plan_id" uuid, "levels" jsonb NOT NULL, "template_key" character varying(40), "owner_name" character varying(200), "status" character varying(12) NOT NULL DEFAULT 'draft', "stage_index" integer, "wf_stages" jsonb NOT NULL DEFAULT '[]', "route_name" character varying(150), "approvals" jsonb NOT NULL DEFAULT '[]', "version" integer NOT NULL DEFAULT '0', "revision_note" character varying(1000), "approved_at" TIMESTAMP WITH TIME ZONE, "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_915e1ccd447d203ecc345ca89e7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_plan_plans_code" ON "plan_plans" ("organization_id", "code") `);
        await queryRunner.query(`CREATE TABLE "plan_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "plan_id" uuid NOT NULL, "parent_id" uuid, "level" integer NOT NULL, "code" character varying(30) NOT NULL, "title" character varying(300) NOT NULL, "description" character varying(3000), "owner_user_id" uuid, "owner_name" character varying(200), "unit_id" uuid, "unit_name" character varying(200), "participants" jsonb NOT NULL DEFAULT '[]', "start_date" date, "end_date" date, "weight" numeric(9,2) NOT NULL DEFAULT '1', "targets" jsonb NOT NULL DEFAULT '[]', "milestones" jsonb NOT NULL DEFAULT '[]', "resources" jsonb NOT NULL DEFAULT '[]', "cost_by_year" jsonb NOT NULL DEFAULT '{}', "planned_cost" numeric(16,2) NOT NULL DEFAULT '0', "cost_method" character varying(12) NOT NULL DEFAULT 'direct', "funding_type" character varying(14), "cost_center_id" uuid, "cost_center_name" character varying(250), "custom_values" jsonb NOT NULL DEFAULT '{}', "progress" numeric(5,2) NOT NULL DEFAULT '0', "state" character varying(14) NOT NULL DEFAULT 'not_started', "progress_note" character varying(1000), "corrective_action" character varying(1000), "progress_updated_at" TIMESTAMP WITH TIME ZONE, "carried_from_id" uuid, "carried_to_id" uuid, "sort_order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7095e15f5d5d331a9f170564d5b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_plan_items_plan" ON "plan_items" ("plan_id") `);
        await queryRunner.query(`CREATE TABLE "plan_links" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "from_item_id" uuid NOT NULL, "to_item_id" uuid NOT NULL, "relation" character varying(30) NOT NULL, "contribution" numeric(5,2), "note" character varying(500), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ccb7299cfa4ea29c5fd29156fce" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_plan_links_pair" ON "plan_links" ("from_item_id", "to_item_id") `);
        await queryRunner.query(`CREATE TABLE "plan_refs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "item_id" uuid NOT NULL, "system" character varying(20) NOT NULL, "ref_id" character varying(60) NOT NULL, "ref_code" character varying(60), "ref_label" character varying(400) NOT NULL, "contribution" numeric(5,2), "note" character varying(500), "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_eb83c250fefdb494221293f14a3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_plan_refs_item" ON "plan_refs" ("item_id", "system", "ref_id") `);
        await queryRunner.query(`CREATE TABLE "plan_kpis" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "plan_id" uuid NOT NULL, "item_id" uuid, "code" character varying(20) NOT NULL, "name" character varying(300) NOT NULL, "description" character varying(1500), "unit" character varying(30) NOT NULL, "direction" character varying(4) NOT NULL DEFAULT 'up', "frequency" character varying(12) NOT NULL DEFAULT 'annual', "aggregation" character varying(4) NOT NULL DEFAULT 'last', "baseline" numeric(16,2), "targets" jsonb NOT NULL DEFAULT '{}', "weight" numeric(9,2) NOT NULL DEFAULT '1', "owner_name" character varying(200), "data_source" character varying(500), "sort_order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ab43d430b62e0a92262542a0b5e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_plan_kpis_code" ON "plan_kpis" ("organization_id", "code") `);
        await queryRunner.query(`CREATE TABLE "plan_kpi_readings" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "kpi_id" uuid NOT NULL, "period" character varying(10) NOT NULL, "value" numeric(16,2) NOT NULL, "note" character varying(1000), "entered_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_dd40d53d564582aaf6936dd79ba" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_plan_kpi_readings_period" ON "plan_kpi_readings" ("kpi_id", "period") `);
        await queryRunner.query(`CREATE TABLE "plan_progress_updates" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "item_id" uuid NOT NULL, "update_date" date NOT NULL, "progress" numeric(5,2) NOT NULL, "state" character varying(14) NOT NULL, "note" character varying(1000), "corrective_action" character varying(1000), "by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_220a8005cbcb4df38e792f29eb4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_plan_progress_item" ON "plan_progress_updates" ("item_id") `);
        await queryRunner.query(`CREATE TABLE "plan_versions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "plan_id" uuid NOT NULL, "version" integer NOT NULL, "snapshot" jsonb NOT NULL, "note" character varying(1000), "approved_by_name" character varying(200) NOT NULL, "approved_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_dd2f605d45f2679a86a7c1c5b20" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_plan_versions_no" ON "plan_versions" ("plan_id", "version") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."UQ_plan_versions_no"`);
        await queryRunner.query(`DROP TABLE "plan_versions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_plan_progress_item"`);
        await queryRunner.query(`DROP TABLE "plan_progress_updates"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_plan_kpi_readings_period"`);
        await queryRunner.query(`DROP TABLE "plan_kpi_readings"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_plan_kpis_code"`);
        await queryRunner.query(`DROP TABLE "plan_kpis"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_plan_refs_item"`);
        await queryRunner.query(`DROP TABLE "plan_refs"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_plan_links_pair"`);
        await queryRunner.query(`DROP TABLE "plan_links"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_plan_items_plan"`);
        await queryRunner.query(`DROP TABLE "plan_items"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_plan_plans_code"`);
        await queryRunner.query(`DROP TABLE "plan_plans"`);
        await queryRunner.query(`DROP TABLE "plan_settings"`);
    }

}
