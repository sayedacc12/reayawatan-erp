import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ربط النشاط بأكثر من جهة (جهات مختارة أو كل العملاء)، ومتابعو النشاط للاطلاع فقط.
 * عمودان جديدان فارغان في crm_activities وجدولان جديدان، فلا تتغير الأنشطة الحالية. قابلة للتراجع
 * (التراجع يحذف روابط الأنشطة الجماعية ومتابعيها، وتبقى الأنشطة نفسها).
 */
export class CrmActivityAudience1795800000000 implements MigrationInterface {
    name = 'CrmActivityAudience1795800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "crm_activities" ADD "audience" character varying(4)`);
        await queryRunner.query(`ALTER TABLE "crm_activities" ADD "audience_role" character varying(12)`);
        await queryRunner.query(`CREATE TABLE "crm_activity_parties" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "activity_id" uuid NOT NULL, "party_id" uuid NOT NULL, "organization_id" uuid NOT NULL, CONSTRAINT "PK_crm_activity_parties" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_crm_activity_parties" ON "crm_activity_parties" ("activity_id", "party_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_crm_activity_parties_party" ON "crm_activity_parties" ("organization_id", "party_id") `);
        await queryRunner.query(`CREATE TABLE "crm_activity_followers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "activity_id" uuid NOT NULL, "user_id" uuid NOT NULL, "organization_id" uuid NOT NULL, CONSTRAINT "PK_crm_activity_followers" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_crm_activity_followers" ON "crm_activity_followers" ("activity_id", "user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_crm_activity_followers_user" ON "crm_activity_followers" ("organization_id", "user_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."UQ_crm_activity_followers"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_crm_activity_followers_user"`);
        await queryRunner.query(`DROP TABLE "crm_activity_followers"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_crm_activity_parties"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_crm_activity_parties_party"`);
        await queryRunner.query(`DROP TABLE "crm_activity_parties"`);
        await queryRunner.query(`ALTER TABLE "crm_activities" DROP COLUMN "audience_role"`);
        await queryRunner.query(`ALTER TABLE "crm_activities" DROP COLUMN "audience"`);
    }
}
