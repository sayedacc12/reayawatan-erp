import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * التكليفات: دور لمستخدم من تاريخ إلى تاريخ يسقط تلقائيًا (أو مفتوح بلا تاريخ نهاية حتى يُنهى)، والعرض effective_user_roles (الأدوار الدائمة + التكليفات السارية اليوم بتوقيت الرياض).
 * قابلة للتراجع: down يحذف العرض والجدول (وتضيع التكليفات المسجلة).
 */
export class RoleAssignments1795600000000 implements MigrationInterface {
    name = 'RoleAssignments1795600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "role_assignments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role_id" uuid NOT NULL, "start_date" date NOT NULL, "end_date" date, "note" character varying(500), "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "ended_at" TIMESTAMP WITH TIME ZONE, "ended_by_name" character varying(200), CONSTRAINT "CHK_role_assignments_dates" CHECK ("end_date" IS NULL OR "end_date" >= "start_date"), CONSTRAINT "PK_role_assignments" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_role_assignments_org_user" ON "role_assignments" ("organization_id", "user_id") `);
        await queryRunner.query(`ALTER TABLE "role_assignments" ADD CONSTRAINT "FK_role_assignments_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "role_assignments" ADD CONSTRAINT "FK_role_assignments_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "role_assignments" ADD CONSTRAINT "FK_role_assignments_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE VIEW "effective_user_roles" AS
            SELECT user_id, role_id FROM user_roles
            UNION
            SELECT user_id, role_id FROM role_assignments
             WHERE ended_at IS NULL
               AND start_date <= (now() AT TIME ZONE 'Asia/Riyadh')::date
               AND (end_date IS NULL OR end_date >= (now() AT TIME ZONE 'Asia/Riyadh')::date)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP VIEW "effective_user_roles"`);
        await queryRunner.query(`ALTER TABLE "role_assignments" DROP CONSTRAINT "FK_role_assignments_role"`);
        await queryRunner.query(`ALTER TABLE "role_assignments" DROP CONSTRAINT "FK_role_assignments_user"`);
        await queryRunner.query(`ALTER TABLE "role_assignments" DROP CONSTRAINT "FK_role_assignments_org"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_role_assignments_org_user"`);
        await queryRunner.query(`DROP TABLE "role_assignments"`);
    }
}
