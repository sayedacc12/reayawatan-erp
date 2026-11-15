import { MigrationInterface, QueryRunner } from "typeorm";

export class FormApproval1794742594392 implements MigrationInterface {
    name = 'FormApproval1794742594392'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "dynamic_forms" ADD "status" character varying(10) NOT NULL DEFAULT 'draft'`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" ADD "created_by_name" character varying(200)`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" ADD "approved_by_name" character varying(200)`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" ADD "approved_at" TIMESTAMP WITH TIME ZONE`);
        // النماذج الموجودة قبل كده شغالة بالفعل، فتعتبر معتمدة
        await queryRunner.query(`UPDATE "dynamic_forms" SET "status" = 'approved', "approved_at" = now()`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "dynamic_forms" DROP COLUMN "approved_at"`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" DROP COLUMN "approved_by_name"`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" DROP COLUMN "created_by_name"`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" DROP COLUMN "status"`);
    }

}
