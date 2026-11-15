import { MigrationInterface, QueryRunner } from "typeorm";

export class Beneficiaries1794729583694 implements MigrationInterface {
    name = 'Beneficiaries1794729583694'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "dynamic_forms" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "name" character varying(200) NOT NULL, "description" character varying(1000), "fields" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_dce91fd8b87315952243d10fd6e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "workflow_stages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "workflow_id" uuid NOT NULL, "name" character varying(200) NOT NULL, "instructions" character varying(1000), "sort_order" integer NOT NULL, "form_id" uuid, "role_id" uuid, "can_reject" boolean NOT NULL DEFAULT true, "can_return" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_a521b91fac23874e5750cbeccb2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5d599b6e49700103deaa1497f4" ON "workflow_stages" ("workflow_id") `);
        await queryRunner.query(`CREATE TABLE "workflows" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "name" character varying(200) NOT NULL, "description" character varying(1000), "is_default" boolean NOT NULL DEFAULT false, "application_form_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5b5757cc1cd86268019fef52e0c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "activities" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "level" character varying(10) NOT NULL, "parent_id" uuid, "name" character varying(200) NOT NULL, "description" character varying(1000), "workflow_id" uuid, "portal_visible" boolean NOT NULL DEFAULT true, "is_active" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7f4004429f731ffb9c88eb486a8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_activities_org_parent" ON "activities" ("organization_id", "parent_id") `);
        await queryRunner.query(`CREATE TABLE "beneficiary_request_actions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "request_id" uuid NOT NULL, "stage_id" uuid, "stage_name" character varying(200), "decision" character varying(20) NOT NULL, "notes" text, "form_name" character varying(200), "form_data" jsonb, "form_fields" jsonb, "actor_user_id" uuid, "actor_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_fdd0ec4746ff124fed36354f0e7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c30dda90eb8a444ece2de05b9c" ON "beneficiary_request_actions" ("request_id") `);
        await queryRunner.query(`CREATE TABLE "beneficiary_requests" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "request_no" integer NOT NULL, "beneficiary_id" uuid NOT NULL, "project_id" uuid NOT NULL, "workflow_id" uuid NOT NULL, "current_stage_id" uuid, "status" character varying(20) NOT NULL DEFAULT 'in_progress', "source" character varying(10) NOT NULL, "description" text, "application_data" jsonb NOT NULL DEFAULT '{}', "closed_at" TIMESTAMP WITH TIME ZONE, "created_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_220755d21228a250d498dea534b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0e8216334024ca989f98429679" ON "beneficiary_requests" ("beneficiary_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_beneficiary_requests_org_status" ON "beneficiary_requests" ("organization_id", "status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_beneficiary_requests_no" ON "beneficiary_requests" ("organization_id", "request_no") `);
        await queryRunner.query(`CREATE TABLE "beneficiary_aids" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "beneficiary_id" uuid NOT NULL, "aid_type" character varying(20) NOT NULL, "amount" numeric(12,2) NOT NULL DEFAULT '0', "description" character varying(300), "disbursed_on" date NOT NULL, "reference_no" character varying(50), "request_id" uuid, "created_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8dcda1087549b01efdb7865fcaa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e577e3ab8ba209458702bd23fd" ON "beneficiary_aids" ("beneficiary_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_beneficiary_aids_org_date" ON "beneficiary_aids" ("organization_id", "disbursed_on") `);
        await queryRunner.query(`CREATE TABLE "beneficiary_documents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "beneficiary_id" uuid NOT NULL, "title" character varying(200) NOT NULL, "doc_type" character varying(30) NOT NULL, "original_name" character varying(255) NOT NULL, "mime_type" character varying(100) NOT NULL, "size" integer NOT NULL, "storage_key" character varying(200) NOT NULL, "uploaded_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_73b80708747201c6c10bc65281b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_154c6274f74768fc7c8a7a9166" ON "beneficiary_documents" ("beneficiary_id") `);
        await queryRunner.query(`CREATE TABLE "beneficiary_researches" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "beneficiary_id" uuid NOT NULL, "visit_date" date NOT NULL, "researcher_name" character varying(200) NOT NULL, "findings" text NOT NULL, "decision" character varying(20) NOT NULL, "recommended_aid" character varying(300), "next_review_date" date, "created_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_65da5c6f3a0bebf03f7a0fe3403" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_98cfc2c1f8eb208ca94fa7fef4" ON "beneficiary_researches" ("beneficiary_id") `);
        await queryRunner.query(`CREATE TABLE "beneficiary_family_members" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "beneficiary_id" uuid NOT NULL, "full_name" character varying(200) NOT NULL, "relation" character varying(50) NOT NULL, "gender" character varying(10) NOT NULL, "birth_date" date, "national_id" character varying(20), "occupation" character varying(200), "monthly_income" numeric(12,2) NOT NULL DEFAULT '0', "health_status" character varying(300), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_acbe2b979a46153cef0427c1f23" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8c4eea7b2d11ee06d046ac277e" ON "beneficiary_family_members" ("beneficiary_id") `);
        await queryRunner.query(`CREATE TABLE "beneficiaries" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "file_no" integer NOT NULL, "full_name" character varying(200) NOT NULL, "national_id" character varying(20), "gender" character varying(10) NOT NULL, "birth_date" date, "phone" character varying(30), "alt_phone" character varying(30), "city" character varying(100), "address" character varying(300), "marital_status" character varying(20), "category" character varying(20) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'new', "monthly_income" numeric(12,2) NOT NULL DEFAULT '0', "income_source" character varying(200), "housing_type" character varying(20), "monthly_rent" numeric(12,2), "health_status" character varying(300), "notes" text, "created_by" uuid, "source" character varying(10) NOT NULL DEFAULT 'staff', "portal_password_hash" character varying(100), "portal_last_login_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c9356d282dec80f7f12a9eef10a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_349968c2ffa9fc5b7ce47e30d3" ON "beneficiaries" ("status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_beneficiaries_national_id" ON "beneficiaries" ("organization_id", "national_id") WHERE "national_id" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_beneficiaries_file_no" ON "beneficiaries" ("organization_id", "file_no") `);
        await queryRunner.query(`CREATE TABLE "beneficiary_tickets" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "ticket_no" integer NOT NULL, "beneficiary_id" uuid NOT NULL, "type" character varying(20) NOT NULL, "subject" character varying(200) NOT NULL, "message" text NOT NULL, "request_id" uuid, "status" character varying(20) NOT NULL DEFAULT 'open', "reply" text, "replied_by_name" character varying(200), "replied_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3c47aca21a6fa693ece0dc8e4ec" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f05bec1b51870802631df0359e" ON "beneficiary_tickets" ("beneficiary_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_beneficiary_tickets_no" ON "beneficiary_tickets" ("organization_id", "ticket_no") `);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" ADD CONSTRAINT "FK_68185cd617d12f7e81b4ed52cbd" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "workflow_stages" ADD CONSTRAINT "FK_5d599b6e49700103deaa1497f48" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "workflow_stages" ADD CONSTRAINT "FK_ab3ea9cfb2a99363a4af0b05481" FOREIGN KEY ("form_id") REFERENCES "dynamic_forms"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "workflow_stages" ADD CONSTRAINT "FK_fc9100682c9fdf8f3819153bbb1" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "workflows" ADD CONSTRAINT "FK_d0327b3752cf21c97fb7ae9f0b2" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "workflows" ADD CONSTRAINT "FK_dba653552691d5ee3391a876ac9" FOREIGN KEY ("application_form_id") REFERENCES "dynamic_forms"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "activities" ADD CONSTRAINT "FK_98a034f3603f95ab549c4259147" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "activities" ADD CONSTRAINT "FK_797b2408833193b3a5fd0216f42" FOREIGN KEY ("parent_id") REFERENCES "activities"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "activities" ADD CONSTRAINT "FK_9d84824ab1b323f1f89ba3df7ca" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "beneficiary_request_actions" ADD CONSTRAINT "FK_c30dda90eb8a444ece2de05b9c6" FOREIGN KEY ("request_id") REFERENCES "beneficiary_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" ADD CONSTRAINT "FK_0e8216334024ca989f984296791" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" ADD CONSTRAINT "FK_1029afd0c3e732b180f54f88fa2" FOREIGN KEY ("project_id") REFERENCES "activities"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" ADD CONSTRAINT "FK_94b4889c66d68fddfc4850b3525" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" ADD CONSTRAINT "FK_eb09f36f9904ecccd7ea97f2777" FOREIGN KEY ("current_stage_id") REFERENCES "workflow_stages"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "beneficiary_aids" ADD CONSTRAINT "FK_e577e3ab8ba209458702bd23fdf" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "beneficiary_aids" ADD CONSTRAINT "FK_9e2a20477cdc663f587331637a0" FOREIGN KEY ("request_id") REFERENCES "beneficiary_requests"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "beneficiary_documents" ADD CONSTRAINT "FK_154c6274f74768fc7c8a7a91662" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "beneficiary_researches" ADD CONSTRAINT "FK_98cfc2c1f8eb208ca94fa7fef45" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "beneficiary_family_members" ADD CONSTRAINT "FK_8c4eea7b2d11ee06d046ac277ec" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "beneficiaries" ADD CONSTRAINT "FK_85378642eed755d349226b3a895" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "beneficiary_tickets" ADD CONSTRAINT "FK_f05bec1b51870802631df0359e7" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "beneficiary_tickets" DROP CONSTRAINT "FK_f05bec1b51870802631df0359e7"`);
        await queryRunner.query(`ALTER TABLE "beneficiaries" DROP CONSTRAINT "FK_85378642eed755d349226b3a895"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_family_members" DROP CONSTRAINT "FK_8c4eea7b2d11ee06d046ac277ec"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_researches" DROP CONSTRAINT "FK_98cfc2c1f8eb208ca94fa7fef45"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_documents" DROP CONSTRAINT "FK_154c6274f74768fc7c8a7a91662"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_aids" DROP CONSTRAINT "FK_9e2a20477cdc663f587331637a0"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_aids" DROP CONSTRAINT "FK_e577e3ab8ba209458702bd23fdf"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" DROP CONSTRAINT "FK_eb09f36f9904ecccd7ea97f2777"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" DROP CONSTRAINT "FK_94b4889c66d68fddfc4850b3525"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" DROP CONSTRAINT "FK_1029afd0c3e732b180f54f88fa2"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" DROP CONSTRAINT "FK_0e8216334024ca989f984296791"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_request_actions" DROP CONSTRAINT "FK_c30dda90eb8a444ece2de05b9c6"`);
        await queryRunner.query(`ALTER TABLE "activities" DROP CONSTRAINT "FK_9d84824ab1b323f1f89ba3df7ca"`);
        await queryRunner.query(`ALTER TABLE "activities" DROP CONSTRAINT "FK_797b2408833193b3a5fd0216f42"`);
        await queryRunner.query(`ALTER TABLE "activities" DROP CONSTRAINT "FK_98a034f3603f95ab549c4259147"`);
        await queryRunner.query(`ALTER TABLE "workflows" DROP CONSTRAINT "FK_dba653552691d5ee3391a876ac9"`);
        await queryRunner.query(`ALTER TABLE "workflows" DROP CONSTRAINT "FK_d0327b3752cf21c97fb7ae9f0b2"`);
        await queryRunner.query(`ALTER TABLE "workflow_stages" DROP CONSTRAINT "FK_fc9100682c9fdf8f3819153bbb1"`);
        await queryRunner.query(`ALTER TABLE "workflow_stages" DROP CONSTRAINT "FK_ab3ea9cfb2a99363a4af0b05481"`);
        await queryRunner.query(`ALTER TABLE "workflow_stages" DROP CONSTRAINT "FK_5d599b6e49700103deaa1497f48"`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" DROP CONSTRAINT "FK_68185cd617d12f7e81b4ed52cbd"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_beneficiary_tickets_no"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f05bec1b51870802631df0359e"`);
        await queryRunner.query(`DROP TABLE "beneficiary_tickets"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_beneficiaries_file_no"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_beneficiaries_national_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_349968c2ffa9fc5b7ce47e30d3"`);
        await queryRunner.query(`DROP TABLE "beneficiaries"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8c4eea7b2d11ee06d046ac277e"`);
        await queryRunner.query(`DROP TABLE "beneficiary_family_members"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_98cfc2c1f8eb208ca94fa7fef4"`);
        await queryRunner.query(`DROP TABLE "beneficiary_researches"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_154c6274f74768fc7c8a7a9166"`);
        await queryRunner.query(`DROP TABLE "beneficiary_documents"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_beneficiary_aids_org_date"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e577e3ab8ba209458702bd23fd"`);
        await queryRunner.query(`DROP TABLE "beneficiary_aids"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_beneficiary_requests_no"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_beneficiary_requests_org_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0e8216334024ca989f98429679"`);
        await queryRunner.query(`DROP TABLE "beneficiary_requests"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c30dda90eb8a444ece2de05b9c"`);
        await queryRunner.query(`DROP TABLE "beneficiary_request_actions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_activities_org_parent"`);
        await queryRunner.query(`DROP TABLE "activities"`);
        await queryRunner.query(`DROP TABLE "workflows"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5d599b6e49700103deaa1497f4"`);
        await queryRunner.query(`DROP TABLE "workflow_stages"`);
        await queryRunner.query(`DROP TABLE "dynamic_forms"`);
    }

}
