import { MigrationInterface, QueryRunner } from "typeorm";

export class Beneficiaries1794728701986 implements MigrationInterface {
    name = 'Beneficiaries1794728701986'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "beneficiary_aids" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "beneficiary_id" uuid NOT NULL, "aid_type" character varying(20) NOT NULL, "amount" numeric(12,2) NOT NULL DEFAULT '0', "description" character varying(300), "disbursed_on" date NOT NULL, "reference_no" character varying(50), "created_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8dcda1087549b01efdb7865fcaa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e577e3ab8ba209458702bd23fd" ON "beneficiary_aids" ("beneficiary_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_beneficiary_aids_org_date" ON "beneficiary_aids" ("organization_id", "disbursed_on") `);
        await queryRunner.query(`CREATE TABLE "beneficiary_documents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "beneficiary_id" uuid NOT NULL, "title" character varying(200) NOT NULL, "doc_type" character varying(30) NOT NULL, "original_name" character varying(255) NOT NULL, "mime_type" character varying(100) NOT NULL, "size" integer NOT NULL, "storage_key" character varying(200) NOT NULL, "uploaded_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_73b80708747201c6c10bc65281b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_154c6274f74768fc7c8a7a9166" ON "beneficiary_documents" ("beneficiary_id") `);
        await queryRunner.query(`CREATE TABLE "beneficiary_family_members" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "beneficiary_id" uuid NOT NULL, "full_name" character varying(200) NOT NULL, "relation" character varying(50) NOT NULL, "gender" character varying(10) NOT NULL, "birth_date" date, "national_id" character varying(20), "occupation" character varying(200), "monthly_income" numeric(12,2) NOT NULL DEFAULT '0', "health_status" character varying(300), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_acbe2b979a46153cef0427c1f23" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8c4eea7b2d11ee06d046ac277e" ON "beneficiary_family_members" ("beneficiary_id") `);
        await queryRunner.query(`CREATE TABLE "beneficiaries" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "file_no" integer NOT NULL, "full_name" character varying(200) NOT NULL, "national_id" character varying(20), "gender" character varying(10) NOT NULL, "birth_date" date, "phone" character varying(30), "alt_phone" character varying(30), "city" character varying(100), "address" character varying(300), "marital_status" character varying(20), "category" character varying(20) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'new', "monthly_income" numeric(12,2) NOT NULL DEFAULT '0', "income_source" character varying(200), "housing_type" character varying(20), "monthly_rent" numeric(12,2), "health_status" character varying(300), "notes" text, "created_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c9356d282dec80f7f12a9eef10a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_349968c2ffa9fc5b7ce47e30d3" ON "beneficiaries" ("status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_beneficiaries_national_id" ON "beneficiaries" ("organization_id", "national_id") WHERE "national_id" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_beneficiaries_file_no" ON "beneficiaries" ("organization_id", "file_no") `);
        await queryRunner.query(`CREATE TABLE "beneficiary_researches" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "beneficiary_id" uuid NOT NULL, "visit_date" date NOT NULL, "researcher_name" character varying(200) NOT NULL, "findings" text NOT NULL, "decision" character varying(20) NOT NULL, "recommended_aid" character varying(300), "next_review_date" date, "created_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_65da5c6f3a0bebf03f7a0fe3403" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_98cfc2c1f8eb208ca94fa7fef4" ON "beneficiary_researches" ("beneficiary_id") `);
        await queryRunner.query(`ALTER TABLE "beneficiary_aids" ADD CONSTRAINT "FK_e577e3ab8ba209458702bd23fdf" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "beneficiary_documents" ADD CONSTRAINT "FK_154c6274f74768fc7c8a7a91662" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "beneficiary_family_members" ADD CONSTRAINT "FK_8c4eea7b2d11ee06d046ac277ec" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "beneficiaries" ADD CONSTRAINT "FK_85378642eed755d349226b3a895" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "beneficiary_researches" ADD CONSTRAINT "FK_98cfc2c1f8eb208ca94fa7fef45" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "beneficiary_researches" DROP CONSTRAINT "FK_98cfc2c1f8eb208ca94fa7fef45"`);
        await queryRunner.query(`ALTER TABLE "beneficiaries" DROP CONSTRAINT "FK_85378642eed755d349226b3a895"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_family_members" DROP CONSTRAINT "FK_8c4eea7b2d11ee06d046ac277ec"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_documents" DROP CONSTRAINT "FK_154c6274f74768fc7c8a7a91662"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_aids" DROP CONSTRAINT "FK_e577e3ab8ba209458702bd23fdf"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_98cfc2c1f8eb208ca94fa7fef4"`);
        await queryRunner.query(`DROP TABLE "beneficiary_researches"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_beneficiaries_file_no"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_beneficiaries_national_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_349968c2ffa9fc5b7ce47e30d3"`);
        await queryRunner.query(`DROP TABLE "beneficiaries"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8c4eea7b2d11ee06d046ac277e"`);
        await queryRunner.query(`DROP TABLE "beneficiary_family_members"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_154c6274f74768fc7c8a7a9166"`);
        await queryRunner.query(`DROP TABLE "beneficiary_documents"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_beneficiary_aids_org_date"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e577e3ab8ba209458702bd23fd"`);
        await queryRunner.query(`DROP TABLE "beneficiary_aids"`);
    }

}
