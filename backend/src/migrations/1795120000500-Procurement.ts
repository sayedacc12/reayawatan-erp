import { MigrationInterface, QueryRunner } from "typeorm";

/** المشتريات والمستودعات (المرحلة الأولى): الأصناف ووحدات القياس والمجموعات، والمستودعات ومواقعها، والموردون ومستنداتهم وحساباتهم البنكية ومستخدمو بوابتهم */
export class Procurement1795120000500 implements MigrationInterface {
    name = 'Procurement1795120000500'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "pr_settings" ("organization_id" uuid NOT NULL, "valuation" character varying(6) NOT NULL DEFAULT 'avg', "account_level" character varying(10) NOT NULL DEFAULT 'group', "doc_alert_days" integer NOT NULL DEFAULT '30', "supplier_doc_types" jsonb NOT NULL DEFAULT '[]', "activities" jsonb NOT NULL DEFAULT '[]', "portal_open" boolean NOT NULL DEFAULT true, "portal_intro" text, "partner_category_id" uuid, "payables_account_id" uuid, CONSTRAINT "PK_eba7c47894cd73b4721e32cd64b" PRIMARY KEY ("organization_id"))`);
        await queryRunner.query(`CREATE TABLE "pr_uoms" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "name" character varying(60) NOT NULL, "symbol" character varying(20), "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_2c6dfd04d62710855919372feac" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pr_uoms_org" ON "pr_uoms" ("organization_id") `);
        await queryRunner.query(`CREATE TABLE "pr_item_groups" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "parent_id" uuid, "code" character varying(12) NOT NULL, "name" character varying(150) NOT NULL, "kind" character varying(12) NOT NULL DEFAULT 'stock', "inventory_account_id" uuid, "expense_account_id" uuid, "asset_group_id" uuid, "valuation" character varying(6), "description" character varying(500), "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_e584828485ab5b1230ccb5b07df" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_item_groups_code" ON "pr_item_groups" ("organization_id", "code") `);
        await queryRunner.query(`CREATE TABLE "pr_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "code" character varying(30) NOT NULL, "name" character varying(250) NOT NULL, "name_key" character varying(250) NOT NULL, "group_id" uuid NOT NULL, "kind" character varying(12) NOT NULL, "uom_id" uuid NOT NULL, "units" jsonb NOT NULL DEFAULT '[]', "barcode" character varying(60), "description" text, "specs" jsonb NOT NULL DEFAULT '[]', "track_batch" boolean NOT NULL DEFAULT false, "track_serial" boolean NOT NULL DEFAULT false, "track_expiry" boolean NOT NULL DEFAULT false, "shelf_life_days" integer, "min_qty" numeric(14,3), "max_qty" numeric(14,3), "reorder_point" numeric(14,3), "reorder_qty" numeric(14,3), "issue_policy" character varying(6) NOT NULL DEFAULT 'fifo', "valuation" character varying(6), "inventory_account_id" uuid, "expense_account_id" uuid, "ref_price" numeric(14,2), "image_key" character varying(120), "image_mime" character varying(40), "attachments" jsonb NOT NULL DEFAULT '[]', "alternatives" jsonb NOT NULL DEFAULT '[]', "status" character varying(10) NOT NULL DEFAULT 'active', "stop_reason" character varying(500), "replaced_by_id" uuid, "log" jsonb NOT NULL DEFAULT '[]', "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_59b8b671a374fe06250e7b24581" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pr_items_group" ON "pr_items" ("organization_id", "group_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_items_barcode" ON "pr_items" ("organization_id", "barcode") WHERE barcode IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_items_name" ON "pr_items" ("organization_id", "name_key") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_items_code" ON "pr_items" ("organization_id", "code") `);
        await queryRunner.query(`CREATE TABLE "pr_warehouses" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "code" character varying(20) NOT NULL, "name" character varying(200) NOT NULL, "kind" character varying(10) NOT NULL DEFAULT 'main', "parent_id" uuid, "unit_id" uuid, "project_id" uuid, "city" character varying(100), "address" character varying(500), "keeper_ids" jsonb NOT NULL DEFAULT '[]', "gl_account_id" uuid, "capacity" character varying(500), "notes" character varying(1000), "is_active" boolean NOT NULL DEFAULT true, "log" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9699bf8eb8f4c7b7d45dd897ba7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_warehouses_code" ON "pr_warehouses" ("organization_id", "code") `);
        await queryRunner.query(`CREATE TABLE "pr_locations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "warehouse_id" uuid NOT NULL, "parent_id" uuid, "code" character varying(30) NOT NULL, "name" character varying(150) NOT NULL, "kind" character varying(8) NOT NULL DEFAULT 'zone', "purpose" character varying(12) NOT NULL DEFAULT 'storage', "capacity" character varying(200), "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_87013590db5868169b55945dca0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_locations_code" ON "pr_locations" ("warehouse_id", "code") `);
        await queryRunner.query(`CREATE TABLE "pr_supplier_categories" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "description" character varying(500), "color" character varying(9) NOT NULL DEFAULT '#0f766e', "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_28f74fd1f132aa0baf1a3122d25" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pr_supplier_categories_org" ON "pr_supplier_categories" ("organization_id") `);
        await queryRunner.query(`CREATE TABLE "pr_suppliers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "supplier_no" integer NOT NULL, "name" character varying(250) NOT NULL, "name_en" character varying(250), "entity_type" character varying(14) NOT NULL DEFAULT 'company', "supplier_kind" character varying(16) NOT NULL DEFAULT 'supplier', "category_ids" jsonb NOT NULL DEFAULT '[]', "activities" jsonb NOT NULL DEFAULT '[]', "about" text, "cr_number" character varying(20), "cr_expiry" date, "vat_number" character varying(20), "national_id" character varying(12), "city" character varying(100), "address" character varying(500), "phone" character varying(30), "email" character varying(200), "website" character varying(300), "contacts" jsonb NOT NULL DEFAULT '[]', "branches" jsonb NOT NULL DEFAULT '[]', "status" character varying(10) NOT NULL DEFAULT 'pending', "source" character varying(10) NOT NULL DEFAULT 'internal', "submitted_at" TIMESTAMP WITH TIME ZONE, "review_note" character varying(2000), "decided_by_name" character varying(200), "decided_at" TIMESTAMP WITH TIME ZONE, "acc_partner_id" uuid, "log" jsonb NOT NULL DEFAULT '[]', "created_by_name" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_fb9b776bb17c7c45640e52afc70" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pr_suppliers_status" ON "pr_suppliers" ("organization_id", "status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_suppliers_vat" ON "pr_suppliers" ("organization_id", "vat_number") WHERE vat_number IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_suppliers_cr" ON "pr_suppliers" ("organization_id", "cr_number") WHERE cr_number IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_suppliers_no" ON "pr_suppliers" ("organization_id", "supplier_no") `);
        await queryRunner.query(`CREATE TABLE "pr_supplier_docs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "supplier_id" uuid NOT NULL, "doc_type" character varying(40) NOT NULL, "title" character varying(200) NOT NULL, "number" character varying(60), "issue_date" date, "expiry_date" date, "file_key" character varying(120) NOT NULL, "file_name" character varying(200) NOT NULL, "file_mime" character varying(40) NOT NULL, "file_size" integer NOT NULL DEFAULT '0', "status" character varying(10) NOT NULL DEFAULT 'pending', "is_current" boolean NOT NULL DEFAULT true, "review_note" character varying(1000), "reviewed_by_name" character varying(200), "reviewed_at" TIMESTAMP WITH TIME ZONE, "uploaded_via" character varying(8) NOT NULL DEFAULT 'staff', "uploaded_by_name" character varying(200) NOT NULL, "alerted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b131036a366bea1c7282123f48d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pr_supplier_docs_supplier" ON "pr_supplier_docs" ("organization_id", "supplier_id") `);
        await queryRunner.query(`CREATE TABLE "pr_supplier_banks" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "supplier_id" uuid NOT NULL, "bank_name" character varying(120) NOT NULL, "iban" character varying(34) NOT NULL, "account_name" character varying(250) NOT NULL, "file_key" character varying(120), "file_name" character varying(200), "file_mime" character varying(40), "status" character varying(10) NOT NULL DEFAULT 'pending', "is_primary" boolean NOT NULL DEFAULT false, "requested_via" character varying(8) NOT NULL DEFAULT 'staff', "requested_by_id" uuid, "requested_by_name" character varying(200) NOT NULL, "decided_by_name" character varying(200), "decided_at" TIMESTAMP WITH TIME ZONE, "decision_note" character varying(1000), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_abc8db15b33a2d1d897c7aefc61" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pr_supplier_banks_supplier" ON "pr_supplier_banks" ("organization_id", "supplier_id") `);
        await queryRunner.query(`CREATE TABLE "pr_supplier_users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "supplier_id" uuid NOT NULL, "full_name" character varying(200) NOT NULL, "email" character varying(200) NOT NULL, "phone" character varying(30), "role" character varying(10) NOT NULL DEFAULT 'owner', "password_hash" character varying(100), "must_change_password" boolean NOT NULL DEFAULT false, "is_active" boolean NOT NULL DEFAULT true, "failed_logins" integer NOT NULL DEFAULT '0', "locked_until" TIMESTAMP WITH TIME ZONE, "last_login_at" TIMESTAMP WITH TIME ZONE, "sessions_valid_after" TIMESTAMP WITH TIME ZONE, "reset_token_hash" character varying(64), "reset_expires_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4898dabb314dae799d7126cd908" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pr_supplier_users_email" ON "pr_supplier_users" ("organization_id", "email") `);
        await queryRunner.query(`CREATE TABLE "pr_portal_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "supplier_id" uuid, "user_id" uuid, "user_name" character varying(200), "event" character varying(40) NOT NULL, "detail" character varying(500), "ip" character varying(64), "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1cec28616bb7fccfedcda92fc45" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pr_portal_events_supplier" ON "pr_portal_events" ("organization_id", "supplier_id", "at") `);
        // المستودعات المعرفة سابقًا في النظام المالي تنتقل لنظام المستودعات بنفس المعرّف وحسابها
        await queryRunner.query(`INSERT INTO "pr_warehouses" ("id", "organization_id", "code", "name", "kind", "address", "gl_account_id", "is_active", "notes", "log", "created_at")
            SELECT w.id, w.organization_id, 'WH-' || LPAD((ROW_NUMBER() OVER (PARTITION BY w.organization_id ORDER BY w.created_at))::text, 2, '0'), w.name, 'main', NULL, w.gl_account_id, w.is_active,
                   NULLIF(concat_ws(' · ', 'نوعه في النظام المالي: ' || w.type, w.description), ''),
                   jsonb_build_array(jsonb_build_object('action', 'نقل المستودع من النظام المالي', 'note', NULL, 'byName', 'النظام', 'at', now())), w.created_at
              FROM "acc_warehouses" w`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_portal_events_supplier"`);
        await queryRunner.query(`DROP TABLE "pr_portal_events"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_supplier_users_email"`);
        await queryRunner.query(`DROP TABLE "pr_supplier_users"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_supplier_banks_supplier"`);
        await queryRunner.query(`DROP TABLE "pr_supplier_banks"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_supplier_docs_supplier"`);
        await queryRunner.query(`DROP TABLE "pr_supplier_docs"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_suppliers_no"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_suppliers_cr"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_suppliers_vat"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_suppliers_status"`);
        await queryRunner.query(`DROP TABLE "pr_suppliers"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_supplier_categories_org"`);
        await queryRunner.query(`DROP TABLE "pr_supplier_categories"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_locations_code"`);
        await queryRunner.query(`DROP TABLE "pr_locations"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_warehouses_code"`);
        await queryRunner.query(`DROP TABLE "pr_warehouses"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_items_code"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_items_name"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_items_barcode"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_items_group"`);
        await queryRunner.query(`DROP TABLE "pr_items"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pr_item_groups_code"`);
        await queryRunner.query(`DROP TABLE "pr_item_groups"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pr_uoms_org"`);
        await queryRunner.query(`DROP TABLE "pr_uoms"`);
        await queryRunner.query(`DROP TABLE "pr_settings"`);
    }
}
