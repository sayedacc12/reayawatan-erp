import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * القوائم المالية: ربط الدليل ببنود القوائم (الربط اليدوي فقط، والافتراضي في الكود)، ومشروع توزيع الأرباح لكل سنة،
 * وسجل إصدار الملف النهائي للمراجع. ثلاثة جداول جديدة فقط، فلا تتغير القيود ولا الدليل.
 *
 * وتُضاف صلاحية «إعداد القوائم المالية» لدور «المدير المالي» الافتراضي في كل منشأة (البيانات المعتمدة تُدرج تلقائيًا)،
 * مع تعريف الصلاحية نفسها قبل أن يزامن النظام صلاحيات الوحدات عند التشغيل.
 * لا يُحذف شيء من سجلاتها: إلغاء الربط اليدوي يُبقي السطر بلا بند، وسحب مشروع التوزيع يُعلَّم بتاريخ السحب، وكلاهما يُسجَّل في سجل التغييرات.
 * قابلة للتراجع: يحذف الجداول الثلاثة والصلاحية وإسنادها.
 */
export class FinancialStatements1796000000000 implements MigrationInterface {
    name = 'FinancialStatements1796000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "acc_fs_mappings" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "account_id" uuid NOT NULL, "line_code" character varying(20), "history" jsonb NOT NULL DEFAULT '[]', "updated_by_name" character varying(200) NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_acc_fs_mappings" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_fs_mappings_account" ON "acc_fs_mappings" ("organization_id", "account_id") `);
        await queryRunner.query(`ALTER TABLE "acc_fs_mappings" ADD CONSTRAINT "FK_acc_fs_mappings_account" FOREIGN KEY ("account_id") REFERENCES "acc_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE TABLE "acc_fs_appropriations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "fiscal_year_id" uuid NOT NULL, "inputs" jsonb NOT NULL, "withdrawn_at" TIMESTAMP WITH TIME ZONE, "history" jsonb NOT NULL DEFAULT '[]', "created_by_name" character varying(200) NOT NULL, "updated_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_acc_fs_appropriations" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_fs_appropriations_year" ON "acc_fs_appropriations" ("organization_id", "fiscal_year_id") `);
        await queryRunner.query(`ALTER TABLE "acc_fs_appropriations" ADD CONSTRAINT "FK_acc_fs_appropriations_year" FOREIGN KEY ("fiscal_year_id") REFERENCES "acc_fiscal_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE TABLE "acc_fs_issues" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "issue_no" integer NOT NULL, "fiscal_year_id" uuid NOT NULL, "period_key" character varying(8) NOT NULL, "period_label" character varying(120) NOT NULL, "from_date" date NOT NULL, "to_date" date NOT NULL, "totals" jsonb NOT NULL, "sha256" character varying(64) NOT NULL, "issued_by_name" character varying(200) NOT NULL, "issued_by_id" uuid, "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_acc_fs_issues" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_acc_fs_issues_no" ON "acc_fs_issues" ("organization_id", "issue_no") `);
        await queryRunner.query(`CREATE INDEX "IDX_acc_fs_issues_year" ON "acc_fs_issues" ("organization_id", "fiscal_year_id") `);
        // قاعدة جديدة بلا وحدات بعد: يضيفها تزامن الوحدات عند التشغيل، ويُسند الدور الافتراضي من default-roles.ts
        await queryRunner.query(`INSERT INTO "permissions" ("code", "module_code", "name") SELECT 'accounting.statements.prepare', 'accounting', 'القوائم المالية: ربط الدليل ببنود القوائم ومشروع توزيع الأرباح وإصدار الملف النهائي للمراجع' WHERE EXISTS (SELECT 1 FROM "erp_modules" WHERE "code" = 'accounting') ON CONFLICT ("code") DO NOTHING`);
        await queryRunner.query(`INSERT INTO "role_permissions" ("role_id", "permission_code") SELECT r."id", p."code" FROM "roles" r JOIN "permissions" p ON p."code" = 'accounting.statements.prepare' WHERE r."name" = 'المدير المالي' ON CONFLICT DO NOTHING`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM "role_permissions" WHERE "permission_code" = 'accounting.statements.prepare'`);
        await queryRunner.query(`DELETE FROM "permissions" WHERE "code" = 'accounting.statements.prepare'`);
        await queryRunner.query(`DROP INDEX "public"."IDX_acc_fs_issues_year"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_fs_issues_no"`);
        await queryRunner.query(`DROP TABLE "acc_fs_issues"`);
        await queryRunner.query(`ALTER TABLE "acc_fs_appropriations" DROP CONSTRAINT "FK_acc_fs_appropriations_year"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_fs_appropriations_year"`);
        await queryRunner.query(`DROP TABLE "acc_fs_appropriations"`);
        await queryRunner.query(`ALTER TABLE "acc_fs_mappings" DROP CONSTRAINT "FK_acc_fs_mappings_account"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_acc_fs_mappings_account"`);
        await queryRunner.query(`DROP TABLE "acc_fs_mappings"`);
    }
}
