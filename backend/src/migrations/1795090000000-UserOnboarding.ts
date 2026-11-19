import { MigrationInterface, QueryRunner } from "typeorm";

export class UserOnboarding1795090000000 implements MigrationInterface {
    name = 'UserOnboarding1795090000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "user_onboarding" ("user_id" uuid NOT NULL, "welcome_seen_at" TIMESTAMP WITH TIME ZONE, "tour_done_at" TIMESTAMP WITH TIME ZONE, "launch_hidden" boolean NOT NULL DEFAULT false, "marks" jsonb NOT NULL DEFAULT '{}', "celebrated" jsonb NOT NULL DEFAULT '[]', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_user_onboarding" PRIMARY KEY ("user_id"))`);
        await queryRunner.query(`ALTER TABLE "user_onboarding" ADD CONSTRAINT "FK_user_onboarding_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_onboarding" DROP CONSTRAINT "FK_user_onboarding_user"`);
        await queryRunner.query(`DROP TABLE "user_onboarding"`);
    }

}
