import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { BackupsService } from '../src/core/backups/backups.service';

/** شاشة النسخ الاحتياطي: الحالة من سجل السكربت، والتنبيه بالبريد مرة واحدة لكل مشكلة */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Platform backups', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let db: DataSource;

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
      MAIL_TRANSPORT: 'test', MAIL_FROM: 'ops@sanabel.test',
    });
    const { DataSource: DS } = await import('typeorm');
    const reset = new DS({ type: 'postgres', url: DB });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get(DataSource);
    token = (await http.post('/api/auth/login').send({ login: 'admin', password: 'Platform123' }).expect(200)).body.accessToken;
  });

  afterAll(async () => {
    for (const k of ['MAIL_TRANSPORT', 'MAIL_FROM']) delete process.env[k];
    await db.destroy();
    await app.close();
  });

  const get = async () => (await http.get('/api/platform/backups').set({ Authorization: `Bearer ${token}` }).expect(200)).body;
  const run = (target: string, kind: string, status: string, hoursAgo: number, message: string | null = null) =>
    db.query(
      `INSERT INTO platform_backup_runs (target, kind, status, stamp, db_bytes, files_bytes, started_at, finished_at, message)
       VALUES ($1, $2, $3, 'x', 1000, 10, now() - make_interval(hours => $4), now() - make_interval(hours => $4), $5)`,
      [target, kind, status, hoursAgo, message],
    );
  const alerts = () => db.query(`SELECT to_email, subject FROM mail_outbox WHERE kind = 'backup_alert'`);

  it('reports "off" until the server script records a run', async () => {
    const o = await get();
    expect(o.overall).toBe('off');
    expect(o.targets.map((t: { health: string }) => t.health)).toEqual(['off', 'off']);
    expect(await app.get(BackupsService).alert()).toEqual([]);
  });

  it('shows healthy destinations, and flags a failure and a stale destination', async () => {
    await run('oracle', 'daily', 'success', 2);
    await run('oracle', 'verify', 'success', 2);
    await run('gdrive', 'weekly', 'success', 2);
    await run('gdrive', 'verify', 'success', 2);
    let o = await get();
    expect(o.overall).toBe('ok');
    expect(o.targets.every((t: { verifyWarning: boolean }) => !t.verifyWarning)).toBe(true);
    expect(o.targets[0].lastSuccess.dbBytes).toBe(1000);

    await run('oracle', 'daily', 'failed', 1, 'AccessDenied');
    o = await get();
    expect(o.overall).toBe('alert');
    expect(o.targets[0]).toMatchObject({ code: 'oracle', health: 'failed' });
    expect(o.targets[1]).toMatchObject({ code: 'gdrive', health: 'ok' });

    await db.query(`UPDATE platform_backup_runs SET started_at = now() - interval '40 hours' WHERE target = 'gdrive' AND kind = 'weekly'`);
    expect((await get()).targets[1].health).toBe('stale');
  });

  it('emails the admins once per problem', async () => {
    const svc = app.get(BackupsService);
    expect((await svc.alert()).length).toBe(2);
    await svc.alert();
    const rows = await alerts();
    expect(rows).toHaveLength(2);
    expect(rows[0].to_email).toBe('ops@sanabel.test');
    expect(rows.map((r: { subject: string }) => r.subject).join(' ')).toContain('فشلت آخر نسخة');

    // فشل جديد = رسالة جديدة
    await run('oracle', 'daily', 'failed', 0, 'timeout');
    await svc.alert();
    expect(await alerts()).toHaveLength(3);
  });
});
