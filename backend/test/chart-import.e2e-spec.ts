import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { crc32, deflateRawSync } from 'zlib';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

/**
 * دليل الشركات واستيراد الدليل من Excel: لا يوجد دليل الجمعيات، والاستيراد يفحص كل حساب وحده ويعرض تقريرًا قبل الحفظ،
 * ثم يُدرج المطابق فقط مع سبب كل مستبعد (ومنه كل حساب أبوه مستبعد). متى بدأ الدليل يدويًا أو بالاستيراد يتوقف زر الدليل الجاهز.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const HEADER = ['رقم الحساب *', 'اسم الحساب *', 'رقم الحساب الأب', 'النوع *', 'الطبيعة', 'يتطلب مركز تكلفة (نعم/لا)', 'الوصف', 'نشط (نعم/لا)'];

async function xlsx(rows: string[][], header = HEADER) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('الحسابات');
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}


/** أرشيف zip بجزء واحد مضغوط (لاختبار الملف الصغير الذي يتمدد عند فكه) */
function zipOf(name: string, content: Buffer) {
  const data = deflateRawSync(content);
  const n = Buffer.from(name);
  const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(8, 8);
  loc.writeUInt32LE(crc32(content), 14); loc.writeUInt32LE(data.length, 18); loc.writeUInt32LE(content.length, 22); loc.writeUInt16LE(n.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10);
  cen.writeUInt32LE(crc32(content), 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(content.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(0, 42);
  const cenAt = 30 + n.length + data.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(cenAt, 16);
  return Buffer.concat([loc, n, data, cen, n, end]);
}

describe('Companies chart and chart import from Excel', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let admin: string;
  let adminB: string;
  let viewer: string;
  let orgA: string;
  let orgB: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const A = '/api/accounting';
  const count = async (org: string) => Number((await db.query('SELECT count(*)::int AS n FROM acc_accounts WHERE organization_id = $1', [org]))[0].n);
  const upload = (t: string, buf: Buffer, mode?: string) => {
    const r = http.post(`${A}/accounts/import`).set(as(t)).attach('file', buf, 'chart.xlsx');
    return mode ? r.field('mode', mode) : r;
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', UPLOAD_DIR: '/tmp/rw-test-uploads',
      PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
    });
    const reset = new DataSource({ type: 'postgres', url: DB });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get(DataSource);
    const platform = await login('admin', 'Platform123');
    const mk = async (slug: string) => (await http.post('/api/platform/organizations').set(as(platform)).send({
      name: `شركة ${slug}`, slug, adminFullName: `مدير ${slug}`, adminEmail: `owner@${slug}.sa`, adminPassword: 'Owner12345',
    }).expect(201)).body.id as string;
    orgA = await mk('chart-a');
    orgB = await mk('chart-b');
    admin = await login('owner@chart-a.sa', 'Owner12345', 'chart-a');
    adminB = await login('owner@chart-b.sa', 'Owner12345', 'chart-b');
    const role = (await http.post('/api/roles').set(as(admin)).send({ name: 'مشاهد', permissions: ['accounting.dashboard.read'] }).expect(201)).body.id;
    await http.post('/api/users').set(as(admin)).send({ fullName: 'مشاهد', email: 'viewer@chart-a.sa', password: 'View12345', roleIds: [role] }).expect(201);
    viewer = await login('viewer@chart-a.sa', 'View12345', 'chart-a');
  }, 240000);

  afterAll(async () => {
    await db.destroy();
    await app.close();
  });

  it('offers the companies chart, not the associations chart', async () => {
    const info = (await http.get(`${A}/chart`).set(as(adminB)).expect(200)).body;
    expect(info.name).toContain('الشركات');
    expect(info.canInstall).toBe(true);
    await http.post(`${A}/chart/install`).set(as(adminB)).expect(201);
    const accounts = (await http.get(`${A}/accounts`).set(as(adminB)).expect(200)).body.accounts as { code: string; name: string; natureLabel: string }[];
    const names = accounts.map((a) => a.name).join(' ');
    expect(names).not.toMatch(/تبرع|الأوقاف|صافي الأصول|جمع الأموال|الجمعية/);
    expect(accounts.find((a) => a.code === '3110100101')?.name).toBe('إيرادات الاستشارات');
    expect(accounts.find((a) => a.code === '2310100101')?.natureLabel).toBe('حقوق ملكية');
    const [s] = await db.query('SELECT c.code FROM acc_settings s JOIN acc_accounts c ON c.id = s.closing_account_id WHERE s.organization_id = $1', [orgB]);
    expect(s.code).toBe('2310100101');
  });

  it('only chart managers get the template and import', async () => {
    await http.get(`${A}/accounts/import/template`).set(as(viewer)).expect(403);
    await upload(viewer, await xlsx([['1', 'الأصول', '', 'جذري', 'أصول']])).expect(403);
    const t = await http.get(`${A}/accounts/import/template`).set(as(admin)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(t.headers['content-disposition']).toContain('attachment');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.body as ArrayBuffer);
    expect((wb.getWorksheet('الحسابات')!.getRow(1).values as string[]).slice(1)).toEqual(HEADER);
  });

  it('rejects a file that is not the template', async () => {
    const r = await upload(admin, await xlsx([['1', 'الأصول']], ['رقم', 'اسم'])).expect(400);
    expect(r.body.message).toContain('ليس نموذج استيراد الدليل');
  });


  it('rejects a file that is not a real xlsx, or that expands too much when unzipped', async () => {
    await upload(admin, Buffer.from('not an excel file at all')).expect(400);
    const bomb = zipOf('xl/sharedStrings.xml', Buffer.alloc(40 * 1024 * 1024, 0x41));
    expect(bomb.length).toBeLessThan(200 * 1024);
    const r = await upload(admin, bomb).expect(400);
    expect(r.body.message).toContain('أكبر من المسموح');
    expect(await count(orgA)).toBe(0);
  });

  const FILE: string[][] = [
    ['1', 'الأصول', '', 'جذري', 'أصول'],
    ['11', 'الأصول المتداولة', '1', 'رئيسي', ''],
    ['1101', 'البنوك', '11', 'فرعي', '', 'لا'],
    ['1102', 'الصندوق', '11', 'فرعي', ''],
    ['1102', 'صندوق مكرر', '11', 'فرعي', ''],
    ['12', 'حساب بنوع خاطئ', '1', 'وسيط', ''],
    ['1201', 'ابن حساب مستبعد', '12', 'فرعي', ''],
    ['1301', 'أبوه غير موجود', '99', 'فرعي', ''],
    ['4', 'المصروفات', '', 'جذري', 'مصروفات'],
    ['41', 'المصاريف العمومية', '4', 'رئيسي', ''],
    ['4101', 'الرواتب', '41', 'فرعي', '', 'نعم'],
    ['410101', 'تحت حساب فرعي', '4101', 'فرعي', ''],
    ['5', 'جذر بلا طبيعة', '', 'جذري', ''],
  ];

  it('checks the file and reports per account without saving anything', async () => {
    const r = (await upload(admin, await xlsx(FILE)).expect(201)).body;
    expect(r.mode).toBe('check');
    expect(r.total).toBe(13);
    expect(r.created).toBe(0);
    expect(r.accepted.map((x: { code: string }) => x.code).sort()).toEqual(['1', '11', '1101', '1102', '4', '41', '4101'].sort());
    const reason = (row: number) => (r.skipped.find((x: { row: number }) => x.row === row)?.reasons ?? []).join(' | ');
    expect(reason(6)).toContain('مكرر في الملف');
    expect(reason(7)).toContain('النوع «وسيط» غير صحيح');
    expect(reason(8)).toContain('الحساب الأب 12 لم يُدرج');
    expect(reason(9)).toContain('غير موجود في الملف ولا في الدليل');
    expect(reason(13)).toContain('فرعي، ولا يُفتح حساب تحت حساب فرعي');
    expect(reason(14)).toContain('يحتاج طبيعة');
    // الطبيعة الفارغة تأخذ طبيعة الأب
    expect(r.accepted.find((x: { code: string }) => x.code === '4101').nature).toBe('expenses');
    expect(await count(orgA)).toBe(0);
    expect((await http.get(`${A}/chart`).set(as(admin)).expect(200)).body.canInstall).toBe(true);
  });

  it('imports only the compliant accounts, then the ready chart button stops', async () => {
    const r = (await upload(admin, await xlsx(FILE), 'apply').expect(201)).body;
    expect(r.created).toBe(7);
    expect(r.skipped).toHaveLength(6);
    expect(await count(orgA)).toBe(7);
    const rows = await db.query('SELECT code, nature, level, requires_analytic AS ra FROM acc_accounts WHERE organization_id = $1 ORDER BY code', [orgA]);
    expect(rows.find((x: { code: string }) => x.code === '4101')).toMatchObject({ nature: 'expenses', level: 3, ra: true });
    expect(rows.find((x: { code: string }) => x.code === '1101')).toMatchObject({ nature: 'assets', level: 3, ra: false });
    // بدأ الدليل يدويًا: لا تنصيب للدليل الجاهز فوقه
    expect((await http.get(`${A}/chart`).set(as(admin)).expect(200)).body.canInstall).toBe(false);
    await http.post(`${A}/chart/install`).set(as(admin)).expect(409);
    // إعادة الملف نفسه لا تكرر شيئًا: كل حساب موجود من قبل
    const again = (await upload(admin, await xlsx(FILE)).expect(201)).body;
    expect(again.accepted).toHaveLength(0);
    expect(again.skipped.find((x: { row: number }) => x.row === 2).reasons[0]).toContain('موجود في الدليل');
    // الحسابات الجديدة تحت دليل قائم تتبع مستوى التسجيل الحالي
    const more = (await upload(admin, await xlsx([['1103', 'العهد', '11', 'فرعي', ''], ['42', 'تكاليف المشاريع', '4', 'فرعي', '']]), 'apply').expect(201)).body;
    expect(more.created).toBe(1);
    expect(more.skipped[0].reasons[0]).toContain('في المستوى 3');
  });

  it('never touches another organization', async () => {
    const before = await count(orgB);
    await upload(admin, await xlsx([['1104', 'الودائع', '11', 'فرعي', '']]), 'apply').expect(201);
    expect(await count(orgB)).toBe(before);
    // ولا يرى أبًا من منشأة أخرى: رقم 31 موجود في دليل المنشأة الثانية فقط
    const r = (await upload(admin, await xlsx([['3101', 'إيراد', '31', 'فرعي', '']])).expect(201)).body;
    expect(r.skipped[0].reasons[0]).toContain('غير موجود في الملف ولا في الدليل');
  });

  it('exports the chart through the reports framework', async () => {
    await http.get('/api/reports/run/accounting.chart?level=9').set(as(admin)).expect(200).expect((res) => {
      expect(res.body.rows.map((x: { code: string }) => x.code)).toContain('4101');
    });
    await http.get('/api/reports/export/accounting.chart?level=9&format=xlsx').set(as(viewer)).expect(200);
    await http.get('/api/reports/run/accounting.chart?level=9').set(as(adminB)).expect(200).expect((res) => {
      expect(res.body.rows.map((x: { code: string }) => x.code)).not.toContain('4101');
    });
  });
});
