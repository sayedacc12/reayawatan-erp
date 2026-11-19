import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * سجل النسخ الاحتياطي: يكتبه سكربت deploy/backup.sh على السيرفر بعد كل نسخة أو تجربة استرجاع،
 * وتعرضه شاشة «النسخ الاحتياطي» لمدير المنصة.
 */
export class PlatformBackups1795100000100 implements MigrationInterface {
  name = 'PlatformBackups1795100000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "platform_backup_runs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "target" character varying(20) NOT NULL, "kind" character varying(20) NOT NULL, "status" character varying(10) NOT NULL, "stamp" character varying(40), "db_bytes" bigint, "files_bytes" bigint, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "finished_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "message" text, CONSTRAINT "PK_platform_backup_runs" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_platform_backup_runs_started" ON "platform_backup_runs" ("started_at") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_platform_backup_runs_started"`);
    await queryRunner.query(`DROP TABLE "platform_backup_runs"`);
  }
}
