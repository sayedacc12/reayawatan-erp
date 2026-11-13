import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1794592252822 implements MigrationInterface {
    name = 'Init1794592252822'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "organizations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(200) NOT NULL, "slug" character varying(64) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6b031fcd0863e3f6b44230163f9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_963693341bd612aa01ddf3a4b6" ON "organizations" ("slug") `);
        await queryRunner.query(`CREATE TABLE "erp_modules" ("code" character varying(64) NOT NULL, "name" character varying(200) NOT NULL, "description" text, "icon" character varying(64), "version" character varying(32) NOT NULL, "sequence" integer NOT NULL DEFAULT '100', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_654475b2376f61033d9b79ca6dd" PRIMARY KEY ("code"))`);
        await queryRunner.query(`CREATE TABLE "permissions" ("code" character varying(128) NOT NULL, "module_code" character varying(64) NOT NULL, "name" character varying(200) NOT NULL, CONSTRAINT "PK_8dad765629e83229da6feda1c1d" PRIMARY KEY ("code"))`);
        await queryRunner.query(`CREATE TABLE "roles" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8bdcf7999d2e71031da1f4869a" ON "roles" ("organization_id", "name") `);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid, "full_name" character varying(200) NOT NULL, "email" character varying(254) NOT NULL, "password_hash" character varying(100) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "is_superadmin" boolean NOT NULL DEFAULT false, "is_platform_admin" boolean NOT NULL DEFAULT false, "last_login_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_users_tenant" CHECK (("is_platform_admin" AND "organization_id" IS NULL) OR (NOT "is_platform_admin" AND "organization_id" IS NOT NULL)), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `);
        await queryRunner.query(`CREATE TABLE "organization_modules" ("organization_id" uuid NOT NULL, "module_code" character varying(64) NOT NULL, "enabled_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5b8c6af55056c0286f6605f9319" PRIMARY KEY ("organization_id", "module_code"))`);
        await queryRunner.query(`CREATE TABLE "role_permissions" ("role_id" uuid NOT NULL, "permission_code" character varying(128) NOT NULL, CONSTRAINT "PK_0938f91f02174dc620f8cdfed89" PRIMARY KEY ("role_id", "permission_code"))`);
        await queryRunner.query(`CREATE INDEX "IDX_178199805b901ccd220ab7740e" ON "role_permissions" ("role_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_aae7df9d481dcdb2dafd1d938c" ON "role_permissions" ("permission_code") `);
        await queryRunner.query(`CREATE TABLE "user_roles" ("user_id" uuid NOT NULL, "role_id" uuid NOT NULL, CONSTRAINT "PK_23ed6f04fe43066df08379fd034" PRIMARY KEY ("user_id", "role_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_87b8888186ca9769c960e92687" ON "user_roles" ("user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_b23c65e50a758245a33ee35fda" ON "user_roles" ("role_id") `);
        await queryRunner.query(`ALTER TABLE "permissions" ADD CONSTRAINT "FK_4372646f04f61caf3854360239a" FOREIGN KEY ("module_code") REFERENCES "erp_modules"("code") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "roles" ADD CONSTRAINT "FK_c328a1ecd12a5f153a96df4509e" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_21a659804ed7bf61eb91688dea7" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_modules" ADD CONSTRAINT "FK_5301c10d432744b08ffa1711049" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_modules" ADD CONSTRAINT "FK_5549693108e42f2bb4045840ced" FOREIGN KEY ("module_code") REFERENCES "erp_modules"("code") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_178199805b901ccd220ab7740ec" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_aae7df9d481dcdb2dafd1d938c1" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "user_roles" ADD CONSTRAINT "FK_87b8888186ca9769c960e926870" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "user_roles" ADD CONSTRAINT "FK_b23c65e50a758245a33ee35fda1" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_roles" DROP CONSTRAINT "FK_b23c65e50a758245a33ee35fda1"`);
        await queryRunner.query(`ALTER TABLE "user_roles" DROP CONSTRAINT "FK_87b8888186ca9769c960e926870"`);
        await queryRunner.query(`ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_aae7df9d481dcdb2dafd1d938c1"`);
        await queryRunner.query(`ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_178199805b901ccd220ab7740ec"`);
        await queryRunner.query(`ALTER TABLE "organization_modules" DROP CONSTRAINT "FK_5549693108e42f2bb4045840ced"`);
        await queryRunner.query(`ALTER TABLE "organization_modules" DROP CONSTRAINT "FK_5301c10d432744b08ffa1711049"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_21a659804ed7bf61eb91688dea7"`);
        await queryRunner.query(`ALTER TABLE "roles" DROP CONSTRAINT "FK_c328a1ecd12a5f153a96df4509e"`);
        await queryRunner.query(`ALTER TABLE "permissions" DROP CONSTRAINT "FK_4372646f04f61caf3854360239a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b23c65e50a758245a33ee35fda"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_87b8888186ca9769c960e92687"`);
        await queryRunner.query(`DROP TABLE "user_roles"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_aae7df9d481dcdb2dafd1d938c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_178199805b901ccd220ab7740e"`);
        await queryRunner.query(`DROP TABLE "role_permissions"`);
        await queryRunner.query(`DROP TABLE "organization_modules"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8bdcf7999d2e71031da1f4869a"`);
        await queryRunner.query(`DROP TABLE "roles"`);
        await queryRunner.query(`DROP TABLE "permissions"`);
        await queryRunner.query(`DROP TABLE "erp_modules"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_963693341bd612aa01ddf3a4b6"`);
        await queryRunner.query(`DROP TABLE "organizations"`);
    }

}
