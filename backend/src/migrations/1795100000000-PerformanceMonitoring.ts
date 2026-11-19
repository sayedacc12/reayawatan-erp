import { MigrationInterface, QueryRunner } from 'typeorm';

/** مراقبة الأداء وحجم البيانات: القياسات (مع خط الأساس) وأزمنة الشاشات اليومية */
export class PerformanceMonitoring1795100000000 implements MigrationInterface {
  name = 'PerformanceMonitoring1795100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "perf_snapshots" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "taken_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "kind" character varying(10) NOT NULL, "label" character varying(200), "is_baseline" boolean NOT NULL DEFAULT false, "taken_by" character varying(200), "period_from" TIMESTAMP WITH TIME ZONE NOT NULL, "totals" jsonb NOT NULL, "modules" jsonb NOT NULL, "tables" jsonb NOT NULL, "orgs" jsonb NOT NULL, "endpoints" jsonb NOT NULL, "duration_ms" integer NOT NULL DEFAULT 0, CONSTRAINT "PK_perf_snapshots" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_perf_snapshots_taken" ON "perf_snapshots" ("taken_at") `);
    // خط أساس واحد فقط في أي وقت
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_perf_snapshots_baseline" ON "perf_snapshots" ("is_baseline") WHERE "is_baseline"`);
    await queryRunner.query(`CREATE TABLE "perf_endpoint_stats" ("day" date NOT NULL, "method" character varying(8) NOT NULL, "route" character varying(300) NOT NULL, "count" integer NOT NULL DEFAULT 0, "total_ms" bigint NOT NULL DEFAULT 0, "max_ms" integer NOT NULL DEFAULT 0, "slow_count" integer NOT NULL DEFAULT 0, "buckets" integer array NOT NULL, CONSTRAINT "PK_perf_endpoint_stats" PRIMARY KEY ("day", "method", "route"))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "perf_endpoint_stats"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_perf_snapshots_baseline"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_perf_snapshots_taken"`);
    await queryRunner.query(`DROP TABLE "perf_snapshots"`);
  }
}
