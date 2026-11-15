import { MigrationInterface, QueryRunner } from "typeorm";

export class ProjectDocument1794749696125 implements MigrationInterface {
    name = 'ProjectDocument1794749696125'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "project_profiles" ADD "duration_type" character varying(12) NOT NULL DEFAULT 'annual'`);
        await queryRunner.query(`ALTER TABLE "project_profiles" ADD "fiscal_year" integer`);
        await queryRunner.query(`ALTER TABLE "project_profiles" ADD "idea" text`);
        await queryRunner.query(`ALTER TABLE "project_profiles" ADD "target_groups" text`);
        await queryRunner.query(`ALTER TABLE "project_profiles" ADD "location" character varying(300)`);
        await queryRunner.query(`ALTER TABLE "project_profiles" ADD "outcomes" text`);
        await queryRunner.query(`ALTER TABLE "project_profiles" ADD "risks" text`);
        await queryRunner.query(`ALTER TABLE "project_profiles" ADD "phases" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "project_profiles" ADD "kpis" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "project_profiles" ADD "budget_lines" jsonb NOT NULL DEFAULT '[]'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "project_profiles" DROP COLUMN "budget_lines"`);
        await queryRunner.query(`ALTER TABLE "project_profiles" DROP COLUMN "kpis"`);
        await queryRunner.query(`ALTER TABLE "project_profiles" DROP COLUMN "phases"`);
        await queryRunner.query(`ALTER TABLE "project_profiles" DROP COLUMN "risks"`);
        await queryRunner.query(`ALTER TABLE "project_profiles" DROP COLUMN "outcomes"`);
        await queryRunner.query(`ALTER TABLE "project_profiles" DROP COLUMN "location"`);
        await queryRunner.query(`ALTER TABLE "project_profiles" DROP COLUMN "target_groups"`);
        await queryRunner.query(`ALTER TABLE "project_profiles" DROP COLUMN "idea"`);
        await queryRunner.query(`ALTER TABLE "project_profiles" DROP COLUMN "fiscal_year"`);
        await queryRunner.query(`ALTER TABLE "project_profiles" DROP COLUMN "duration_type"`);
    }

}
