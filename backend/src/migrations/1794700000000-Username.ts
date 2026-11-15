import { MigrationInterface, QueryRunner } from 'typeorm';

/** اسم دخول اختياري للمستخدمين، ومدير المنصة يدخل باسم admin */
export class Username1794700000000 implements MigrationInterface {
  name = 'Username1794700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "username" character varying(50)`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_users_username" ON "users" ("username") WHERE "username" IS NOT NULL`);
    // مدير المنصة الموجود (واحد فقط عادةً): الأقدم ياخد admin
    await queryRunner.query(
      `UPDATE "users" SET "username" = 'admin' WHERE "id" = (SELECT "id" FROM "users" WHERE "is_platform_admin" ORDER BY "created_at" LIMIT 1)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_username"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "username"`);
  }
}
