import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * رعاية وطن: وحدة الموقع الجديدة (rw_*): محتوى الصفحات، الخدمات، العملاء المحتملون وسجل متابعتهم،
 * حجوزات جلسات التشخيص (فهرس فريد جزئي يمنع حجزين نشطين لنفس الموعد)، ومكتبة الأدلة وروابط تنزيلها.
 * جداول جديدة فقط، وقابلة للتراجع. جداول الموقع الخيري القديم (web_*) تبقى كما هي دون استخدام.
 */
export class ReayaWatanWebsite1795300000000 implements MigrationInterface {
  name = 'ReayaWatanWebsite1795300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "rw_site_content" ("organization_id" uuid NOT NULL, "key" character varying(40) NOT NULL, "data" jsonb NOT NULL,
      "updated_by" uuid, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_rw_site_content" PRIMARY KEY ("organization_id", "key"),
      CONSTRAINT "FK_rw_site_content_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE)`);

    await q.query(`CREATE TABLE "rw_services" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "slug" character varying(60) NOT NULL,
      "title" character varying(160) NOT NULL, "stage" character varying(60) NOT NULL DEFAULT '', "icon" character varying(30) NOT NULL DEFAULT 'strategy',
      "short" text NOT NULL DEFAULT '', "intro" text NOT NULL DEFAULT '', "value" text NOT NULL DEFAULT '',
      "deliverables" jsonb NOT NULL DEFAULT '[]', "audience" jsonb NOT NULL DEFAULT '[]', "steps" jsonb NOT NULL DEFAULT '[]', "shifts" jsonb NOT NULL DEFAULT '[]', "kpis" jsonb NOT NULL DEFAULT '[]',
      "featured" boolean NOT NULL DEFAULT false, "published" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT 0,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_rw_services" PRIMARY KEY ("id"),
      CONSTRAINT "FK_rw_services_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE)`);
    await q.query(`CREATE INDEX "IDX_rw_services_org" ON "rw_services" ("organization_id")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_rw_services_slug" ON "rw_services" ("organization_id", "slug")`);

    await q.query(`CREATE TABLE "rw_leads" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "lead_no" integer NOT NULL,
      "source" character varying(20) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'new', "name" character varying(160) NOT NULL,
      "org_name" character varying(200), "email" character varying(200) NOT NULL, "phone" character varying(30), "org_type" character varying(60),
      "service_slug" character varying(60), "message" text, "result" jsonb, "score" integer, "assigned_to" uuid, "next_action_on" date, "meta" jsonb,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_rw_leads" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_rw_leads_no" UNIQUE ("organization_id", "lead_no"),
      CONSTRAINT "CHK_rw_leads_source" CHECK ("source" IN ('consultation','calculator','assessment','guide','booking')),
      CONSTRAINT "CHK_rw_leads_status" CHECK ("status" IN ('new','contacted','qualified','proposal','won','lost','spam')),
      CONSTRAINT "FK_rw_leads_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_rw_leads_assignee" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL)`);
    await q.query(`CREATE INDEX "IDX_rw_leads_org" ON "rw_leads" ("organization_id")`);
    await q.query(`CREATE INDEX "IDX_rw_leads_org_created" ON "rw_leads" ("organization_id", "created_at")`);
    await q.query(`CREATE INDEX "IDX_rw_leads_email" ON "rw_leads" ("organization_id", "email")`);

    await q.query(`CREATE TABLE "rw_lead_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "lead_id" uuid NOT NULL,
      "kind" character varying(20) NOT NULL, "text" text, "before" jsonb, "after" jsonb, "user_id" uuid, "user_name" character varying(200),
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_rw_lead_events" PRIMARY KEY ("id"),
      CONSTRAINT "FK_rw_lead_events_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_rw_lead_events_lead" FOREIGN KEY ("lead_id") REFERENCES "rw_leads"("id") ON DELETE CASCADE)`);
    await q.query(`CREATE INDEX "IDX_rw_lead_events_org" ON "rw_lead_events" ("organization_id")`);
    await q.query(`CREATE INDEX "IDX_rw_lead_events_lead" ON "rw_lead_events" ("lead_id")`);

    await q.query(`CREATE TABLE "rw_bookings" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "lead_id" uuid NOT NULL,
      "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'booked',
      "topic" character varying(300), "meeting_url" character varying(500), "consultant_id" uuid, "manage_token_hash" character varying(64) NOT NULL,
      "cancel_reason" character varying(500), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_rw_bookings" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_rw_bookings_status" CHECK ("status" IN ('booked','confirmed','done','cancelled','no_show')),
      CONSTRAINT "CHK_rw_bookings_time" CHECK ("ends_at" > "starts_at"),
      CONSTRAINT "FK_rw_bookings_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_rw_bookings_lead" FOREIGN KEY ("lead_id") REFERENCES "rw_leads"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_rw_bookings_consultant" FOREIGN KEY ("consultant_id") REFERENCES "users"("id") ON DELETE SET NULL)`);
    await q.query(`CREATE INDEX "IDX_rw_bookings_org" ON "rw_bookings" ("organization_id")`);
    await q.query(`CREATE INDEX "IDX_rw_bookings_lead" ON "rw_bookings" ("lead_id")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_rw_bookings_token" ON "rw_bookings" ("manage_token_hash")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_rw_bookings_active_slot" ON "rw_bookings" ("organization_id", "starts_at") WHERE "status" IN ('booked','confirmed')`);

    await q.query(`CREATE TABLE "rw_guides" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "slug" character varying(80) NOT NULL,
      "title" character varying(200) NOT NULL, "summary" text NOT NULL DEFAULT '', "service_slug" character varying(60), "pages" integer,
      "file_key" character varying(200), "file_name" character varying(200), "file_mime" character varying(60), "file_size" integer,
      "cover_key" character varying(200), "cover_mime" character varying(60), "published" boolean NOT NULL DEFAULT false, "sort_order" integer NOT NULL DEFAULT 0,
      "downloads" integer NOT NULL DEFAULT 0, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_rw_guides" PRIMARY KEY ("id"),
      CONSTRAINT "FK_rw_guides_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE)`);
    await q.query(`CREATE INDEX "IDX_rw_guides_org" ON "rw_guides" ("organization_id")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_rw_guides_slug" ON "rw_guides" ("organization_id", "slug")`);

    await q.query(`CREATE TABLE "rw_guide_downloads" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "guide_id" uuid NOT NULL,
      "lead_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_count" integer NOT NULL DEFAULT 0,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_rw_guide_downloads" PRIMARY KEY ("id"),
      CONSTRAINT "FK_rw_guide_downloads_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_rw_guide_downloads_guide" FOREIGN KEY ("guide_id") REFERENCES "rw_guides"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_rw_guide_downloads_lead" FOREIGN KEY ("lead_id") REFERENCES "rw_leads"("id") ON DELETE CASCADE)`);
    await q.query(`CREATE INDEX "IDX_rw_guide_downloads_org" ON "rw_guide_downloads" ("organization_id")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_rw_guide_downloads_token" ON "rw_guide_downloads" ("token_hash")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "rw_guide_downloads"`);
    await q.query(`DROP TABLE "rw_guides"`);
    await q.query(`DROP TABLE "rw_bookings"`);
    await q.query(`DROP TABLE "rw_lead_events"`);
    await q.query(`DROP TABLE "rw_leads"`);
    await q.query(`DROP TABLE "rw_services"`);
    await q.query(`DROP TABLE "rw_site_content"`);
  }
}
