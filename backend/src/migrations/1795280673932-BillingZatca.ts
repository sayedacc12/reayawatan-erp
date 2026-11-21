import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * الفوترة المرحلة الثانية: ربط كل جمعية بمنصة «فاتورة» (bl_zatca، الأسرار مشفرة)،
 * وأعمدة الملف الإلكتروني الموقّع وبصمته وسلسلة البصمات في المستندات. جداول وأعمدة جديدة فقط، وقابلة للتراجع.
 */
export class BillingZatca1795280673932 implements MigrationInterface {
    name = 'BillingZatca1795280673932'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "bl_zatca" ("organization_id" uuid NOT NULL, "env" character varying(12) NOT NULL DEFAULT 'simulation', "stage" character varying(12) NOT NULL DEFAULT 'none', "egs_serial" character varying(120), "common_name" character varying(120), "private_key_enc" text, "csr" text, "compliance_cert" text, "compliance_secret_enc" text, "compliance_request_id" character varying(60), "production_cert" text, "production_secret_enc" text, "cert_expires_at" TIMESTAMP WITH TIME ZONE, "checks" jsonb NOT NULL DEFAULT '[]', "last_hash" character varying(100), "last_error" character varying(2000), "log" jsonb NOT NULL DEFAULT '[]', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f1bfc9115b318c3516463f7bc9a" PRIMARY KEY ("organization_id"))`);
        await queryRunner.query(`ALTER TABLE "bl_documents" ADD "invoice_hash" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "bl_documents" ADD "pih" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "bl_documents" ADD "xml" text`);
        await queryRunner.query(`ALTER TABLE "bl_documents" ADD "signed_env" character varying(12)`);
        await queryRunner.query(`ALTER TABLE "bl_documents" ADD "zatca_status" character varying(16)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "bl_documents" DROP COLUMN "zatca_status"`);
        await queryRunner.query(`ALTER TABLE "bl_documents" DROP COLUMN "signed_env"`);
        await queryRunner.query(`ALTER TABLE "bl_documents" DROP COLUMN "xml"`);
        await queryRunner.query(`ALTER TABLE "bl_documents" DROP COLUMN "pih"`);
        await queryRunner.query(`ALTER TABLE "bl_documents" DROP COLUMN "invoice_hash"`);
        await queryRunner.query(`DROP TABLE "bl_zatca"`);
    }
}
