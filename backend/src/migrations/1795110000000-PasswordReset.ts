import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * استعادة كلمة المرور: سجل الطلبات، وكلمة المرور المؤقتة (تغييرها إلزامي ولها مدة صلاحية)،
 * وإنهاء الجلسات المفتوحة عند إصدار كلمة مؤقتة، للموظفين ولمستفيدي البوابة.
 */
export class PasswordReset1795110000000 implements MigrationInterface {
  name = 'PasswordReset1795110000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "users" ADD "must_change_password" boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE "users" ADD "temp_password_expires_at" TIMESTAMP WITH TIME ZONE`);
    await q.query(`ALTER TABLE "users" ADD "sessions_valid_after" TIMESTAMP WITH TIME ZONE`);
    await q.query(`ALTER TABLE "beneficiaries" ADD "portal_must_change_password" boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE "beneficiaries" ADD "portal_temp_expires_at" TIMESTAMP WITH TIME ZONE`);
    await q.query(`ALTER TABLE "beneficiaries" ADD "portal_sessions_valid_after" TIMESTAMP WITH TIME ZONE`);
    await q.query(`CREATE TABLE "password_resets" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid, "audience" character varying(12) NOT NULL,
      "user_id" uuid, "beneficiary_id" uuid, "subject_name" character varying(200) NOT NULL,
      "origin" character varying(10) NOT NULL DEFAULT 'request', "channel" character varying(10) NOT NULL DEFAULT 'manual',
      "status" character varying(12) NOT NULL DEFAULT 'pending', "request_ip" character varying(64),
      "issued_at" TIMESTAMP WITH TIME ZONE, "issued_by" character varying(200), "expires_at" TIMESTAMP WITH TIME ZONE,
      "completed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_password_resets" PRIMARY KEY ("id"))`);
    await q.query(`CREATE INDEX "IDX_password_resets_org_status" ON "password_resets" ("organization_id", "status")`);
    await q.query(`CREATE INDEX "IDX_password_resets_user" ON "password_resets" ("user_id")`);
    await q.query(`CREATE INDEX "IDX_password_resets_beneficiary" ON "password_resets" ("beneficiary_id")`);
    await q.query(`ALTER TABLE "password_resets" ADD CONSTRAINT "FK_password_resets_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE`);
    await q.query(`ALTER TABLE "password_resets" ADD CONSTRAINT "FK_password_resets_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`);
    await q.query(`ALTER TABLE "password_resets" ADD CONSTRAINT "FK_password_resets_beneficiary" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE CASCADE`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "password_resets"`);
    for (const c of ['portal_sessions_valid_after', 'portal_temp_expires_at', 'portal_must_change_password']) await q.query(`ALTER TABLE "beneficiaries" DROP COLUMN "${c}"`);
    for (const c of ['sessions_valid_after', 'temp_password_expires_at', 'must_change_password']) await q.query(`ALTER TABLE "users" DROP COLUMN "${c}"`);
  }
}
