import { MigrationInterface, QueryRunner } from "typeorm";

export class EmployeeSeparation1794996149729 implements MigrationInterface {
    name = 'EmployeeSeparation1794996149729'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "hr_separations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "separation_no" integer NOT NULL, "employee_id" uuid NOT NULL, "reason" character varying(30) NOT NULL, "last_working_day" date NOT NULL, "notice_date" date, "request_id" uuid, "note" character varying(1000), "status" character varying(20) NOT NULL DEFAULT 'clearance', "items" jsonb NOT NULL DEFAULT '[]', "settlement" jsonb, "stage_index" integer, "entry_id" uuid, "voucher_id" uuid, "history" jsonb NOT NULL DEFAULT '[]', "created_by_id" uuid, "created_by_name" character varying(150) NOT NULL, "approved_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_aff381e5bcb9f2058334d7f8bc5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_hr_separations_emp" ON "hr_separations" ("organization_id", "employee_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_hr_separations_no" ON "hr_separations" ("organization_id", "separation_no") `);
        await queryRunner.query(`ALTER TABLE "hr_settings" ADD "separation_config" jsonb NOT NULL DEFAULT '{}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hr_settings" DROP COLUMN "separation_config"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_hr_separations_no"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_hr_separations_emp"`);
        await queryRunner.query(`DROP TABLE "hr_separations"`);
    }

}
