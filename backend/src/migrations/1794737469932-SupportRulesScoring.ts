import { MigrationInterface, QueryRunner } from "typeorm";

export class SupportRulesScoring1794737469932 implements MigrationInterface {
    name = 'SupportRulesScoring1794737469932'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "beneficiary_settings" ("organization_id" uuid NOT NULL, "contribution_debit_code" character varying(50), "contribution_debit_name" character varying(200), "contribution_credit_code" character varying(50), "contribution_credit_name" character varying(200), "contribution_description" character varying(300), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_957b52e0834e1bd05d1d6d982c4" PRIMARY KEY ("organization_id"))`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" ADD "scored" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" ADD "rules" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "workflow_stages" ADD "kind" character varying(20) NOT NULL DEFAULT 'standard'`);
        await queryRunner.query(`ALTER TABLE "activities" ADD "services" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "activities" ADD "multi_services" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "activities" ADD "allow_concurrent" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "activities" ADD "recurrence" character varying(12) NOT NULL DEFAULT 'once'`);
        await queryRunner.query(`ALTER TABLE "beneficiary_request_actions" ADD "score" numeric(5,2)`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" ADD "services" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" ADD "estimated_cost" numeric(14,2)`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" ADD "research_score" numeric(5,2)`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" ADD "research_outcome" character varying(20)`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" ADD "contribution_percent" numeric(5,2)`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" ADD "contribution_status" character varying(12) NOT NULL DEFAULT 'none'`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" ADD "contribution_amount" numeric(14,2)`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" ADD "contribution_document_id" uuid`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" ADD "contribution_sent_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" ADD "contribution_verified_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" ADD "contribution_journal" jsonb`);
        await queryRunner.query(`ALTER TABLE "beneficiary_settings" ADD CONSTRAINT "FK_957b52e0834e1bd05d1d6d982c4" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "beneficiary_settings" DROP CONSTRAINT "FK_957b52e0834e1bd05d1d6d982c4"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" DROP COLUMN "contribution_journal"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" DROP COLUMN "contribution_verified_at"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" DROP COLUMN "contribution_sent_at"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" DROP COLUMN "contribution_document_id"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" DROP COLUMN "contribution_amount"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" DROP COLUMN "contribution_status"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" DROP COLUMN "contribution_percent"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" DROP COLUMN "research_outcome"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" DROP COLUMN "research_score"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" DROP COLUMN "estimated_cost"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_requests" DROP COLUMN "services"`);
        await queryRunner.query(`ALTER TABLE "beneficiary_request_actions" DROP COLUMN "score"`);
        await queryRunner.query(`ALTER TABLE "activities" DROP COLUMN "recurrence"`);
        await queryRunner.query(`ALTER TABLE "activities" DROP COLUMN "allow_concurrent"`);
        await queryRunner.query(`ALTER TABLE "activities" DROP COLUMN "multi_services"`);
        await queryRunner.query(`ALTER TABLE "activities" DROP COLUMN "services"`);
        await queryRunner.query(`ALTER TABLE "workflow_stages" DROP COLUMN "kind"`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" DROP COLUMN "rules"`);
        await queryRunner.query(`ALTER TABLE "dynamic_forms" DROP COLUMN "scored"`);
        await queryRunner.query(`DROP TABLE "beneficiary_settings"`);
    }

}
