import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * قيود RESTRICT كانت تمنع حذف الجمعية بالكامل (الحذف المتتابع من الجمعية)، فصارت NO ACTION:
 * نفس الحماية عند حذف داعم أو حساب أو مشروع منفردًا، مع السماح بحذف الجمعية وكل بياناتها.
 * والمشاريع ذات الصرف العام تُخفى من بوابة المستفيدين لأنها لا تستقبل طلبات.
 */
export class DemoCascade1794749203369 implements MigrationInterface {
    name = 'DemoCascade1794749203369'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "fundraising_batches" DROP CONSTRAINT "FK_beaae9c81fd01a2cd84d7f014e7"`);
        await queryRunner.query(`ALTER TABLE "fundraising_batches" DROP CONSTRAINT "FK_f3a5853a59a81c612131e5a8f5b"`);
        await queryRunner.query(`ALTER TABLE "fundraising_batches" DROP CONSTRAINT "FK_80907156ce35d12986f04df74f2"`);
        await queryRunner.query(`ALTER TABLE "fundraising_batches" DROP CONSTRAINT "FK_fundraising_batches_activity"`);
        await queryRunner.query(`ALTER TABLE "fundraising_batches" DROP CONSTRAINT "FK_fundraising_batches_request"`);
        await queryRunner.query(`ALTER TABLE "fundraising_opportunities" DROP CONSTRAINT "FK_e86cee09678c8c22067b78641ed"`);
        await queryRunner.query(`ALTER TABLE "fundraising_opportunities" DROP CONSTRAINT "FK_ef1755c69eae18291e0d6bcd18f"`);
        await queryRunner.query(`ALTER TABLE "fundraising_pledge_collections" DROP CONSTRAINT "FK_e11e2a4aeacc7e2ffae338d232e"`);
        await queryRunner.query(`ALTER TABLE "fundraising_batches" ADD CONSTRAINT "FK_beaae9c81fd01a2cd84d7f014e7" FOREIGN KEY ("donor_id") REFERENCES "fundraising_donors"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "fundraising_batches" ADD CONSTRAINT "FK_f3a5853a59a81c612131e5a8f5b" FOREIGN KEY ("waqf_project_id") REFERENCES "fundraising_waqf_projects"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "fundraising_batches" ADD CONSTRAINT "FK_80907156ce35d12986f04df74f2" FOREIGN KEY ("parent_batch_id") REFERENCES "fundraising_batches"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "fundraising_opportunities" ADD CONSTRAINT "FK_e86cee09678c8c22067b78641ed" FOREIGN KEY ("donor_id") REFERENCES "fundraising_donors"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "fundraising_opportunities" ADD CONSTRAINT "FK_ef1755c69eae18291e0d6bcd18f" FOREIGN KEY ("bank_account_id") REFERENCES "fundraising_bank_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "fundraising_pledge_collections" ADD CONSTRAINT "FK_e11e2a4aeacc7e2ffae338d232e" FOREIGN KEY ("bank_account_id") REFERENCES "fundraising_bank_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "fundraising_batches" ADD CONSTRAINT "FK_fundraising_batches_activity" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "fundraising_batches" ADD CONSTRAINT "FK_fundraising_batches_request" FOREIGN KEY ("beneficiary_request_id") REFERENCES "beneficiary_requests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`UPDATE "activities" SET "portal_visible" = false WHERE "id" IN (SELECT "activity_id" FROM "project_profiles" WHERE "spending_mode" = 'general')`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "fundraising_batches" DROP CONSTRAINT "FK_fundraising_batches_request"`);
        await queryRunner.query(`ALTER TABLE "fundraising_batches" DROP CONSTRAINT "FK_fundraising_batches_activity"`);
        await queryRunner.query(`ALTER TABLE "fundraising_pledge_collections" DROP CONSTRAINT "FK_e11e2a4aeacc7e2ffae338d232e"`);
        await queryRunner.query(`ALTER TABLE "fundraising_opportunities" DROP CONSTRAINT "FK_ef1755c69eae18291e0d6bcd18f"`);
        await queryRunner.query(`ALTER TABLE "fundraising_opportunities" DROP CONSTRAINT "FK_e86cee09678c8c22067b78641ed"`);
        await queryRunner.query(`ALTER TABLE "fundraising_batches" DROP CONSTRAINT "FK_80907156ce35d12986f04df74f2"`);
        await queryRunner.query(`ALTER TABLE "fundraising_batches" DROP CONSTRAINT "FK_f3a5853a59a81c612131e5a8f5b"`);
        await queryRunner.query(`ALTER TABLE "fundraising_batches" DROP CONSTRAINT "FK_beaae9c81fd01a2cd84d7f014e7"`);
        await queryRunner.query(`ALTER TABLE "fundraising_pledge_collections" ADD CONSTRAINT "FK_e11e2a4aeacc7e2ffae338d232e" FOREIGN KEY ("bank_account_id") REFERENCES "fundraising_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "fundraising_opportunities" ADD CONSTRAINT "FK_ef1755c69eae18291e0d6bcd18f" FOREIGN KEY ("bank_account_id") REFERENCES "fundraising_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "fundraising_opportunities" ADD CONSTRAINT "FK_e86cee09678c8c22067b78641ed" FOREIGN KEY ("donor_id") REFERENCES "fundraising_donors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "fundraising_batches" ADD CONSTRAINT "FK_fundraising_batches_request" FOREIGN KEY ("beneficiary_request_id") REFERENCES "beneficiary_requests"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "fundraising_batches" ADD CONSTRAINT "FK_fundraising_batches_activity" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "fundraising_batches" ADD CONSTRAINT "FK_80907156ce35d12986f04df74f2" FOREIGN KEY ("parent_batch_id") REFERENCES "fundraising_batches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "fundraising_batches" ADD CONSTRAINT "FK_f3a5853a59a81c612131e5a8f5b" FOREIGN KEY ("waqf_project_id") REFERENCES "fundraising_waqf_projects"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "fundraising_batches" ADD CONSTRAINT "FK_beaae9c81fd01a2cd84d7f014e7" FOREIGN KEY ("donor_id") REFERENCES "fundraising_donors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

}
