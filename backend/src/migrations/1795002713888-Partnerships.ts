import { MigrationInterface, QueryRunner } from "typeorm";

export class Partnerships1795002713888 implements MigrationInterface {
    name = 'Partnerships1795002713888'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "pt_settings" ("organization_id" uuid NOT NULL, "tiers" jsonb NOT NULL DEFAULT '[]', "clause_categories" jsonb NOT NULL DEFAULT '[]', "alert_days" integer NOT NULL DEFAULT '60', "evaluation_months" integer NOT NULL DEFAULT '24', "signer_name" character varying(200), "signer_title" character varying(200), "org_city" character varying(100), "org_license" character varying(60), "court_city" character varying(100), CONSTRAINT "PK_014238459e22238aaed53da6df8" PRIMARY KEY ("organization_id"))`);
        await queryRunner.query(`CREATE TABLE "pt_types" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "description" character varying(500), "color" character varying(9) NOT NULL DEFAULT '#0f766e', "min_score" integer NOT NULL DEFAULT '60', "default_months" integer NOT NULL DEFAULT '12', "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_98e6ae77f78c705c86665006b98" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pt_types_org" ON "pt_types" ("organization_id") `);
        await queryRunner.query(`CREATE TABLE "pt_classes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "description" character varying(500), "color" character varying(9) NOT NULL DEFAULT '#0369a1', "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_e5de6ade87facb84ad6742f7e56" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pt_classes_org" ON "pt_classes" ("organization_id") `);
        await queryRunner.query(`CREATE TABLE "pt_criteria" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "name" character varying(200) NOT NULL, "guide" character varying(800), "weight" integer NOT NULL, "knockout" boolean NOT NULL DEFAULT false, "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_8d2809f54c5f38b1bdf06f89577" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pt_criteria_org" ON "pt_criteria" ("organization_id") `);
        await queryRunner.query(`CREATE TABLE "pt_clauses" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "category_id" character varying(40) NOT NULL, "title" character varying(200) NOT NULL, "paragraphs" jsonb NOT NULL DEFAULT '[]', "type_ids" jsonb NOT NULL DEFAULT '[]', "is_mandatory" boolean NOT NULL DEFAULT false, "is_default" boolean NOT NULL DEFAULT true, "is_active" boolean NOT NULL DEFAULT true, "sequence" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_82a6c0ae67c74cff8c5568ec71c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pt_clauses_org" ON "pt_clauses" ("organization_id") `);
        await queryRunner.query(`CREATE TABLE "pt_partners" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "partner_no" integer NOT NULL, "name" character varying(200) NOT NULL, "class_id" uuid, "type_ids" jsonb NOT NULL DEFAULT '[]', "registration_no" character varying(60), "city" character varying(100), "website" character varying(300), "contact_name" character varying(200), "contact_title" character varying(200), "phone" character varying(30), "email" character varying(200), "about" text, "donor_id" uuid, "show_on_website" boolean NOT NULL DEFAULT false, "status" character varying(20) NOT NULL DEFAULT 'prospect', "tier" character varying(30), "score" numeric(5,2), "approved_at" TIMESTAMP WITH TIME ZONE, "next_evaluation_on" date, "log" jsonb NOT NULL DEFAULT '[]', "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_215886123cc717e42193a95f08c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pt_partners_no" ON "pt_partners" ("organization_id", "partner_no") `);
        await queryRunner.query(`CREATE INDEX "IDX_pt_partners_org" ON "pt_partners" ("organization_id", "status") `);
        await queryRunner.query(`CREATE TABLE "pt_evaluations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "partner_id" uuid NOT NULL, "type_id" uuid, "scores" jsonb NOT NULL DEFAULT '[]', "total" numeric(5,2) NOT NULL DEFAULT '0', "tier" character varying(30), "min_score" integer NOT NULL DEFAULT '0', "knockout_failed" boolean NOT NULL DEFAULT false, "recommendation" text, "status" character varying(12) NOT NULL DEFAULT 'draft', "overridden" boolean NOT NULL DEFAULT false, "decision_note" character varying(1000), "evaluator_name" character varying(200) NOT NULL, "submitted_at" TIMESTAMP WITH TIME ZONE, "decided_by_name" character varying(200), "decided_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cb36c6b5e7b62ff6811a52703f6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pt_evaluations_partner" ON "pt_evaluations" ("organization_id", "partner_id") `);
        await queryRunner.query(`CREATE TABLE "pt_contracts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "number" character varying(32) NOT NULL, "token" character varying(64) NOT NULL, "partner_id" uuid NOT NULL, "type_id" uuid, "title" character varying(250) NOT NULL, "project_id" uuid, "starts_on" date NOT NULL, "ends_on" date NOT NULL, "value" numeric(14,2), "org_signer_name" character varying(200), "org_signer_title" character varying(200), "status" character varying(20) NOT NULL DEFAULT 'draft', "version" integer NOT NULL DEFAULT '0', "items" jsonb NOT NULL DEFAULT '[]', "rendered" jsonb, "content_hash" character varying(64), "versions" jsonb NOT NULL DEFAULT '[]', "sent_at" TIMESTAMP WITH TIME ZONE, "change_request" text, "signed_at" TIMESTAMP WITH TIME ZONE, "signer_name" character varying(200), "signer_title" character varying(200), "signer_ip" character varying(64), "sign_method" character varying(12), "renewal_of" uuid, "ended_at" TIMESTAMP WITH TIME ZONE, "end_reason" character varying(1000), "log" jsonb NOT NULL DEFAULT '[]', "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2184c2096274804b57e0d162c16" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2e4a5fa4d8062a86e988fad095" ON "pt_contracts" ("token") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pt_contracts_number" ON "pt_contracts" ("organization_id", "number") `);
        await queryRunner.query(`CREATE INDEX "IDX_pt_contracts_org" ON "pt_contracts" ("organization_id", "status") `);
        await queryRunner.query(`CREATE TABLE "pt_followups" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "contract_id" uuid NOT NULL, "title" character varying(250) NOT NULL, "kind" character varying(12) NOT NULL DEFAULT 'obligation', "party" character varying(8) NOT NULL DEFAULT 'org', "due_date" date NOT NULL, "responsible" character varying(200), "done_at" date, "note" character varying(1000), "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b3593f335f069c0e7fb85fe35f2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pt_followups_due" ON "pt_followups" ("organization_id", "due_date") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_pt_followups_due"`);
        await queryRunner.query(`DROP TABLE "pt_followups"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pt_contracts_org"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pt_contracts_number"`);
        await queryRunner.query(`DROP TABLE "pt_contracts"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pt_evaluations_partner"`);
        await queryRunner.query(`DROP TABLE "pt_evaluations"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pt_partners_org"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pt_partners_no"`);
        await queryRunner.query(`DROP TABLE "pt_partners"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pt_clauses_org"`);
        await queryRunner.query(`DROP TABLE "pt_clauses"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pt_criteria_org"`);
        await queryRunner.query(`DROP TABLE "pt_criteria"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pt_classes_org"`);
        await queryRunner.query(`DROP TABLE "pt_classes"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pt_types_org"`);
        await queryRunner.query(`DROP TABLE "pt_types"`);
        await queryRunner.query(`DROP TABLE "pt_settings"`);
    }

}
