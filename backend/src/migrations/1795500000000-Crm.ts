import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * علاقات العملاء والتسويق (المرحلة 1): الإعدادات، وسجل الجهات الموحد وروابطه بالأنظمة الأخرى، وأشخاص الاتصال،
 * والعملاء المحتملون، والأنشطة، وسجل الدمج. جداول جديدة فقط، ولا تمس بيانات أي نظام آخر. قابلة للتراجع.
 */
export class Crm1795500000000 implements MigrationInterface {
    name = 'Crm1795500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "crm_settings" ("organization_id" uuid NOT NULL, "initialized" boolean NOT NULL DEFAULT false, "sla_hours" integer NOT NULL DEFAULT '24', "assign_mode" character varying(12) NOT NULL DEFAULT 'manual', "team" jsonb NOT NULL DEFAULT '[]', "rr_cursor" integer NOT NULL DEFAULT '0', "web_topics" jsonb NOT NULL DEFAULT '[]', "party_visibility" character varying(6) NOT NULL DEFAULT 'all', "sources" jsonb NOT NULL DEFAULT '[]', "interests" jsonb NOT NULL DEFAULT '[]', "disqualify_reasons" jsonb NOT NULL DEFAULT '[]', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_910229eb071717871af176ee66f" PRIMARY KEY ("organization_id"))`);
        await queryRunner.query(`CREATE TABLE "crm_parties" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "party_no" integer NOT NULL, "kind" character varying(6) NOT NULL DEFAULT 'person', "name" character varying(250) NOT NULL, "phone" character varying(30), "email" character varying(200), "city" character varying(100), "vat_number" character varying(15), "cr_number" character varying(40), "owner_id" uuid, "source" character varying(40), "tags" jsonb NOT NULL DEFAULT '[]', "consents" jsonb NOT NULL DEFAULT '{}', "do_not_contact" boolean NOT NULL DEFAULT false, "notes" character varying(2000), "merged_into" uuid, "is_active" boolean NOT NULL DEFAULT true, "log" jsonb NOT NULL DEFAULT '[]', "created_by_name" character varying(200), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f694c1044184282ec4686c1695e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_crm_parties_owner" ON "crm_parties" ("organization_id", "owner_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_crm_parties_email" ON "crm_parties" ("organization_id", "email") `);
        await queryRunner.query(`CREATE INDEX "IDX_crm_parties_phone" ON "crm_parties" ("organization_id", "phone") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_crm_parties_no" ON "crm_parties" ("organization_id", "party_no") `);
        await queryRunner.query(`CREATE TABLE "crm_party_links" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "party_id" uuid NOT NULL, "role" character varying(12) NOT NULL, "ref_id" uuid NOT NULL, "linked_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d0d7a372aa637d8a8bb8b2bd514" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_crm_party_links_party" ON "crm_party_links" ("organization_id", "party_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_crm_party_links_ref" ON "crm_party_links" ("organization_id", "role", "ref_id") `);
        await queryRunner.query(`CREATE TABLE "crm_contacts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "party_id" uuid NOT NULL, "name" character varying(200) NOT NULL, "title" character varying(150), "phone" character varying(30), "email" character varying(200), "decision_role" character varying(16) NOT NULL DEFAULT 'other', "is_primary" boolean NOT NULL DEFAULT false, "notes" character varying(1000), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_bb46ecfcdfc9e97ef0df2905d14" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_crm_contacts_party" ON "crm_contacts" ("organization_id", "party_id") `);
        await queryRunner.query(`CREATE TABLE "crm_leads" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "lead_no" integer NOT NULL, "name" character varying(200) NOT NULL, "company" character varying(250), "title" character varying(150), "phone" character varying(30), "email" character varying(200), "city" character varying(100), "interest" character varying(40), "source" character varying(40) NOT NULL, "campaign" character varying(200), "message" character varying(4000), "status" character varying(14) NOT NULL DEFAULT 'new', "owner_id" uuid, "assigned_at" TIMESTAMP WITH TIME ZONE, "due_at" TIMESTAMP WITH TIME ZONE NOT NULL, "first_contact_at" TIMESTAMP WITH TIME ZONE, "disqualify_reason" character varying(40), "disqualify_note" character varying(1000), "party_id" uuid, "converted_at" TIMESTAMP WITH TIME ZONE, "web_message_id" uuid, "log" jsonb NOT NULL DEFAULT '[]', "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_023c67e7150b04458c964631db3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_crm_leads_web" ON "crm_leads" ("organization_id", "web_message_id") WHERE web_message_id IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_crm_leads_phone" ON "crm_leads" ("organization_id", "phone") `);
        await queryRunner.query(`CREATE INDEX "IDX_crm_leads_status" ON "crm_leads" ("organization_id", "status", "owner_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_crm_leads_no" ON "crm_leads" ("organization_id", "lead_no") `);
        await queryRunner.query(`CREATE TABLE "crm_activities" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "type" character varying(10) NOT NULL, "subject" character varying(250) NOT NULL, "details" character varying(4000), "due_at" TIMESTAMP WITH TIME ZONE, "done_at" TIMESTAMP WITH TIME ZONE, "outcome" character varying(2000), "party_id" uuid, "lead_id" uuid, "owner_id" uuid NOT NULL, "created_by_id" uuid, "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d56ffe80fd59fb40765d9f6ff35" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_crm_activities_lead" ON "crm_activities" ("organization_id", "lead_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_crm_activities_party" ON "crm_activities" ("organization_id", "party_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_crm_activities_owner" ON "crm_activities" ("organization_id", "owner_id", "done_at", "due_at") `);
        await queryRunner.query(`CREATE TABLE "crm_merges" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "kept_id" uuid NOT NULL, "removed_id" uuid NOT NULL, "snapshot" jsonb NOT NULL, "by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_99835195b55660ca87b803ff00b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_crm_merges_kept" ON "crm_merges" ("organization_id", "kept_id") `);
        // نطاق رؤية الجهة للموظف (انظر PartiesService.scope): كل السجلات، أو المسؤول عنها، أو الرؤية المشتركة
        // مع جهة بلا سجل خارجي أو لها سجل في نظام يملك الموظف صلاحية الاطلاع عليه
        await queryRunner.query(`CREATE OR REPLACE FUNCTION crm_party_visible(p_org uuid, p_party uuid, p_owner uuid, p_viewer uuid, p_all boolean, p_shared boolean, p_roles text[])
            RETURNS boolean LANGUAGE sql STABLE AS $fn$
              SELECT COALESCE(p_all, false) OR COALESCE(p_owner = p_viewer, false) OR (COALESCE(p_shared, false) AND (
                NOT EXISTS (SELECT 1 FROM crm_party_links x WHERE x.organization_id = p_org AND x.party_id = p_party AND x.role <> 'lead')
                OR EXISTS (SELECT 1 FROM crm_party_links x WHERE x.organization_id = p_org AND x.party_id = p_party AND x.role = ANY(p_roles))))
            $fn$`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP FUNCTION IF EXISTS crm_party_visible(uuid, uuid, uuid, uuid, boolean, boolean, text[])`);
        await queryRunner.query(`DROP INDEX "public"."IDX_crm_merges_kept"`);
        await queryRunner.query(`DROP TABLE "crm_merges"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_crm_activities_owner"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_crm_activities_party"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_crm_activities_lead"`);
        await queryRunner.query(`DROP TABLE "crm_activities"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_crm_leads_no"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_crm_leads_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_crm_leads_phone"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_crm_leads_web"`);
        await queryRunner.query(`DROP TABLE "crm_leads"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_crm_contacts_party"`);
        await queryRunner.query(`DROP TABLE "crm_contacts"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_crm_party_links_ref"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_crm_party_links_party"`);
        await queryRunner.query(`DROP TABLE "crm_party_links"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_crm_parties_no"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_crm_parties_phone"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_crm_parties_email"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_crm_parties_owner"`);
        await queryRunner.query(`DROP TABLE "crm_parties"`);
        await queryRunner.query(`DROP TABLE "crm_settings"`);
    }
}
