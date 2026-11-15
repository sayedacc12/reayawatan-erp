import { MigrationInterface, QueryRunner } from "typeorm";

export class FormQualityControl1794743514140 implements MigrationInterface {
    name = 'FormQualityControl1794743514140'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "dynamic_forms" ADD "quality_code" character varying(50)`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" ADD "revision" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" ADD "history" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" ADD "reviewed_by_name" character varying(200)`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" ADD "reviewed_at" TIMESTAMP WITH TIME ZONE`);
        // النماذج القديمة: كود جودة مؤقت QF-001... لكل جمعية، والمعتمد منها يتسجل له اعتماد في السجل
        await queryRunner.query(`
            UPDATE "dynamic_forms" f SET "quality_code" = 'QF-' || lpad(n.rn::text, 3, '0')
            FROM (SELECT "id", row_number() OVER (PARTITION BY "organization_id" ORDER BY "created_at") AS rn FROM "dynamic_forms") n
            WHERE n."id" = f."id"`);
        await queryRunner.query(`
            UPDATE "dynamic_forms" SET "history" = jsonb_build_array(jsonb_build_object(
                'step', 'approved', 'by', coalesce("approved_by_name", 'النظام'), 'at', coalesce("approved_at", now()), 'revision', 0))
            WHERE "status" = 'approved'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_dynamic_forms_quality_code" ON "dynamic_forms" ("organization_id", "quality_code") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."UQ_dynamic_forms_quality_code"`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" DROP COLUMN "reviewed_at"`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" DROP COLUMN "reviewed_by_name"`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" DROP COLUMN "history"`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" DROP COLUMN "revision"`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" DROP COLUMN "quality_code"`);
    }

}
