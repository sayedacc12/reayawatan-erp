import { MigrationInterface, QueryRunner } from 'typeorm';

/** قائمة الجنسيات المعتمدة لكل جمعية (مشتركة بين المستفيدين والموارد المالية) */
export class OrgNationalities1794751773731 implements MigrationInterface {
  name = 'OrgNationalities1794751773731';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "organizations" ADD "nationalities" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "nationalities"`);
  }
}
