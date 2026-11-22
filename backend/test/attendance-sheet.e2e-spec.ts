import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import ExcelJS from 'exceljs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { assertSafeZip, parseMark } from '../src/modules/hr/attendance-sheet';
import { distanceMeters } from '../src/modules/hr/attendance.service';

/**
 * الحضور بطرق أخرى: كشف الحضور الشهري (نموذج Excel من المنصة، فحص ثم ترحيل بخطوة واحدة، واستبدال وتراجع)،
 * والتسجيل من الجوال داخل نطاق مواقع العمل.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('attendance sheet values and distance', () => {
  it('reads the simple codes of the monthly sheet', () => {
    expect(parseMark('')).toBeNull();
    expect(parseMark('غ')).toEqual({ kind: 'absent', minutes: 0 });
    expect(parseMark(' إ ')).toEqual({ kind: 'leave', minutes: 0 });
    expect(parseMark('ا')).toEqual({ kind: 'leave', minutes: 0 });
    expect(parseMark('٣٠')).toEqual({ kind: 'late', minutes: 30 });
    expect(parseMark('45')).toEqual({ kind: 'late', minutes: 45 });
    expect(parseMark('ح')).toEqual({ kind: 'present', minutes: 0 });
    expect(parseMark('x')).toBe('invalid');
    expect(parseMark('900')).toBe('invalid');
  });

  it('rejects archives that inflate far beyond their size', () => {
    // دليل مركزي لملف واحد يدّعي حجمًا بعد الفك 2 جيجابايت
    const name = Buffer.from('xl/worksheets/sheet1.xml');
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt32LE(2 * 1024 * 1024 * 1024 - 1, 24);
    ch.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(46 + name.length, 12);
    end.writeUInt32LE(0, 16);
    expect(() => assertSafeZip(Buffer.concat([ch, name, end]))).toThrow('كبير جدًا');
    expect(() => assertSafeZip(Buffer.from('not a zip at all, just text................'))).toThrow('ليس ملف Excel');
  });

  it('measures distance in meters', () => {
    expect(distanceMeters({ lat: 24.7136, lng: 46.6753 }, { lat: 24.7136, lng: 46.6753 })).toBe(0);
    const d = distanceMeters({ lat: 24.7136, lng: 46.6753 }, { lat: 24.7145, lng: 46.6753 });
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
  });
});

describe('Attendance: monthly Excel sheet and mobile check-in', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let uploadDir: string;
  const tk: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const H = '/api/hr';
  const site = { name: 'المقر الرئيسي', lat: 24.7136, lng: 46.6753, radius: 100 };

  const now = new Date(Date.now() + 3 * 3600000);
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const month = prev.toISOString().slice(0, 7);
  const lastDay = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const days = Array.from({ length: Number(lastDay.slice(8)) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const workDays = days.filter((d) => ![5, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
  const weekend = days.find((d) => [5, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()))!;
  const dayN = (d: string) => Number(d.slice(8));

  async function template(token = tk.clerk) {
    const res = await http.get(`${H}/attendance/sheet/template?month=${month}`).set(as(token)).buffer(true).parse(binary).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer as unknown as ArrayBuffer);
    return wb;
  }
  /** يعبئ النموذج: { رقم الموظف: { اليوم: القيمة } } */
  async function filled(values: Record<number, Record<number, string | number>>, extraRows: (string | number)[][] = []) {
    const wb = await template();
    const ws = wb.worksheets[0];
    const header = ws.getRow(4);
    const colOf = new Map<number, number>();
    header.eachCell((c, col) => {
      const m = /^(\d+)/.exec(String(c.value));
      if (col > 3 && m) colOf.set(Number(m[1]), col);
    });
    ws.eachRow((row, r) => {
      if (r <= 4) return;
      const v = values[Number(row.getCell(1).value)];
      if (v) Object.entries(v).forEach(([d, val]) => (row.getCell(colOf.get(Number(d))!).value = val));
    });
    extraRows.forEach((er, i) => (ws.getRow(ws.rowCount + 1 + i).values = er));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  beforeAll(async () => {
    uploadDir = mkdtempSync(join(tmpdir(), 'sanabel-uploads-'));
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', UPLOAD_DIR: uploadDir,
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
    const platform = await login('admin', 'Platform123');
    for (const [name, slug] of [['جمعية الوفاء', 'wafa'], ['جمعية أخرى', 'other']]) {
      await http.post('/api/platform/organizations').set(as(platform)).send({
        name, slug, adminFullName: 'مدير النظام', adminEmail: `admin@${slug}.org`, adminPassword: 'Admin12345',
      }).expect(201);
    }
    tk.admin = await login('admin@wafa.org', 'Admin12345', 'wafa');
    tk.other = await login('admin@other.org', 'Admin12345', 'other');
    const role = (await http.post('/api/roles').set(as(tk.admin)).send({ name: 'مدخل الحضور', permissions: ['hr.dashboard.read', 'hr.attendance.manage'] }).expect(201)).body.id;
    const user = async (key: string, fullName: string, roleIds: string[] = []) => {
      ids[`${key}User`] = (await http.post('/api/users').set(as(tk.admin)).send({ fullName, email: `${key}@wafa.org`, password: 'Pass12345', roleIds }).expect(201)).body.id;
      tk[key] = await login(`${key}@wafa.org`, 'Pass12345', 'wafa');
    };
    await user('clerk', 'مدخل الحضور', [role]);
    await user('emp', 'موظف بالجوال');
    await user('desk', 'موظف بلا جوال');

    ids.unit = (await http.post(`${H}/units`).set(as(tk.admin)).send({ name: 'الإدارة العامة', level: 0 }).expect(201)).body.id;
    ids.job = (await http.post(`${H}/jobs`).set(as(tk.admin)).send({
      title: 'أخصائي', unitId: ids.unit, headcount: 5, purpose: 'عمل', responsibilities: ['مهمة'], experienceYears: 0, competencies: [], kpis: [],
    }).expect(201)).body.id;
    const hire = `${now.getUTCFullYear() - 1}-01-01`;
    let n = 0;
    const emp = async (fullName: string, over: Record<string, unknown> = {}) => {
      n++;
      return (await http.post(`${H}/employees`).set(as(tk.admin)).send({
        fullName, nationalId: `10000000${String(n).padStart(2, '0')}`, nationality: 'سعودي', isSaudi: true, gender: 'male', jobId: ids.job,
        hireDate: hire, contractType: 'indefinite', contractStart: hire, qiwaStatus: 'documented', basicSalary: 6000, allowances: [], ...over,
      }).expect(201)).body as { id: string };
    };
    const a = await emp('خالد سعد العتيبي', { userId: ids.empUser, mobileAttendance: true });
    const b = await emp('فهد علي الحربي', { userId: ids.deskUser });
    const c = await emp('ماجد عمر القحطاني', { attendanceExempt: true });
    Object.assign(ids, { a: a.id, b: b.id, c: c.id });
    const noOf = async (id: string) => String((await http.get(`${H}/employees/${id}`).set(as(tk.admin)).expect(200)).body.employeeNo);
    ids.aNo = await noOf(a.id);
    ids.bNo = await noOf(b.id);
    await http.put(`${H}/attendance/settings`).set(as(tk.admin)).send({ enabled: true, workStart: '08:00', workEnd: '15:00', weekend: [5, 6], holidays: [] }).expect(200);
  }, 60_000);

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('downloads a template with the employees who are tracked', async () => {
    await http.get(`${H}/attendance/sheet/template?month=${month}`).set(as(tk.emp)).expect(403);
    await http.get(`${H}/attendance/sheet/template?month=2026-13`).set(as(tk.clerk)).expect(400);
    const ws = (await template()).worksheets[0];
    expect(String(ws.getCell(3, 2).value)).toBe(month);
    const names: string[] = [];
    ws.eachRow((row, r) => r > 4 && names.push(String(row.getCell(2).value)));
    expect(names.sort()).toEqual(['خالد سعد العتيبي', 'فهد علي الحربي']);
    expect(ws.getRow(4).cellCount).toBe(3 + days.length);
  });

  it('previews errors and warnings before posting', async () => {
    const bad = await filled(
      { [Number(ids.aNo)]: { [dayN(workDays[0])]: 'غ', [dayN(workDays[1])]: 'x' }, [Number(ids.bNo)]: { [dayN(weekend)]: 'غ' } },
      [[999, 'مجهول']],
    );
    const p = (await http.post(`${H}/attendance/sheet/preview`).set(as(tk.clerk)).attach('file', bad, 'sheet.xlsx').expect(200)).body;
    expect(p.canCommit).toBe(false);
    expect(p.errors.map((e: { message: string }) => e.message).join(' ')).toContain('غير مفهومة');
    expect(p.errors.map((e: { message: string }) => e.message).join(' ')).toContain('لا يوجد موظف برقم 999');
    expect(p.warnings.map((e: { message: string }) => e.message).join(' ')).toContain('راحة أو عطلة');
    const res = await http.post(`${H}/attendance/sheet`).set(as(tk.clerk)).attach('file', bad, 'sheet.xlsx').expect(400);
    expect(res.body.message).toContain('خطأ');
    await http.post(`${H}/attendance/sheet/preview`).set(as(tk.clerk)).attach('file', Buffer.from('a,b\n1,2'), 'x.csv').expect(400);
    await http.post(`${H}/attendance/sheet/preview`).set(as(tk.emp)).attach('file', bad, 'sheet.xlsx').expect(403);
  });

  it('posts in one step: blanks are present, codes are absence, leave and late minutes', async () => {
    const file = await filled({ [Number(ids.aNo)]: { [dayN(workDays[0])]: 'غ', [dayN(workDays[1])]: 'إ', [dayN(workDays[2])]: 45 } });
    const p = (await http.post(`${H}/attendance/sheet/preview`).set(as(tk.clerk)).attach('file', file, 'sheet.xlsx').expect(200)).body;
    expect(p).toMatchObject({ canCommit: true, employees: 2, absentDays: 1, leaveDays: 1, lateMinutes: 45 });
    const imp = (await http.post(`${H}/attendance/sheet`).set(as(tk.clerk)).attach('file', file, 'sheet.xlsx').expect(201)).body;
    ids.imp1 = imp.id;
    expect(imp).toMatchObject({ kind: 'sheet', month, added: 3 });
    const s = (await http.get(`${H}/attendance?month=${month}`).set(as(tk.admin)).expect(200)).body;
    expect(s.sheetEmployees).toBe(2);
    const a = s.rows.find((r: { employeeId: string }) => r.employeeId === ids.a);
    expect(a).toMatchObject({ sheet: true, absentDays: 1, leaveDays: 1, deductibleMinutes: 45, presentDays: workDays.length - 2 });
    const b = s.rows.find((r: { employeeId: string }) => r.employeeId === ids.b);
    expect(b).toMatchObject({ sheet: true, absentDays: 0, presentDays: workDays.length });
    const detail = (await http.get(`${H}/attendance/employees/${ids.a}?month=${month}`).set(as(tk.admin)).expect(200)).body;
    expect(detail.days.find((d: { date: string }) => d.date === workDays[0]).statusLabel).toContain('كشف الحضور');
  });

  it('a newer sheet replaces the month for its employees; reverting removes it', async () => {
    const file = await filled({ [Number(ids.aNo)]: { [dayN(workDays[3])]: 'غ' } });
    ids.imp2 = (await http.post(`${H}/attendance/sheet`).set(as(tk.clerk)).attach('file', file, 'sheet2.xlsx').expect(201)).body.id;
    let a = (await http.get(`${H}/attendance?month=${month}`).set(as(tk.admin)).expect(200)).body.rows.find((r: { employeeId: string }) => r.employeeId === ids.a);
    expect(a).toMatchObject({ absentDays: 1, leaveDays: 0, deductibleMinutes: 0 });

    // التراجع بالترتيب: الأحدث أولًا
    expect((await http.delete(`${H}/attendance/imports/${ids.imp1}`).set(as(tk.clerk)).expect(409)).body.message).toContain('أحدث');
    await http.delete(`${H}/attendance/imports/${ids.imp2}`).set(as(tk.other)).expect(404);
    await http.delete(`${H}/attendance/imports/${ids.imp2}`).set(as(tk.emp)).expect(403);
    const rev = (await http.delete(`${H}/attendance/imports/${ids.imp2}`).set(as(tk.clerk)).expect(200)).body;
    expect(rev.revertedByName).toBe('مدخل الحضور');
    await http.delete(`${H}/attendance/imports/${ids.imp2}`).set(as(tk.clerk)).expect(409);
    // التراجع عن الكشف الثاني يعيد قيم الكشف الأول كما كانت
    a = (await http.get(`${H}/attendance?month=${month}`).set(as(tk.admin)).expect(200)).body.rows.find((r: { employeeId: string }) => r.employeeId === ids.a);
    expect(a).toMatchObject({ sheet: true, absentDays: 1, leaveDays: 1, deductibleMinutes: 45 });
    const list = (await http.get(`${H}/attendance/imports`).set(as(tk.admin)).expect(200)).body as { id: string; kind: string }[];
    expect(list.filter((i) => i.kind === 'sheet')).toHaveLength(2);
  });

  it('an approved payroll month cannot change its attendance', async () => {
    const db = app.get(DataSource);
    const [{ organization_id: org }] = await db.query(`SELECT organization_id FROM hr_employees WHERE id = $1`, [ids.a]);
    await db.query(`INSERT INTO hr_payroll_runs (organization_id, month, status, created_by_name) VALUES ($1, $2, 'approved', 'اختبار')`, [org, month]);
    const file = await filled({ [Number(ids.aNo)]: { [dayN(workDays[0])]: 'غ' } });
    const p = (await http.post(`${H}/attendance/sheet/preview`).set(as(tk.clerk)).attach('file', file, 'sheet.xlsx').expect(200)).body;
    expect(p.canCommit).toBe(false);
    expect(p.locked).toContain('معتمد');
    await http.post(`${H}/attendance/sheet`).set(as(tk.clerk)).attach('file', file, 'sheet.xlsx').expect(409);
    await http.delete(`${H}/attendance/imports/${ids.imp1}`).set(as(tk.clerk)).expect(409);
    await db.query(`DELETE FROM hr_payroll_runs WHERE organization_id = $1`, [org]);
  });

  it('mobile check-in works only inside a work site, with good accuracy, for allowed employees', async () => {
    const st = (await http.get(`${H}/me/attendance`).set(as(tk.emp)).expect(200)).body;
    expect(st.allowed).toBe(false);
    expect(st.reason).toContain('مواقع العمل');
    await http.put(`${H}/attendance/settings`).set(as(tk.admin)).send({
      enabled: true, workStart: '08:00', workEnd: '15:00', weekend: [5, 6], holidays: [], sites: [{ ...site, radius: 5 }],
    }).expect(400);
    const saved = (await http.put(`${H}/attendance/settings`).set(as(tk.admin)).send({
      enabled: true, workStart: '08:00', workEnd: '15:00', weekend: [5, 6], holidays: [], sites: [site],
    }).expect(200)).body;
    expect(saved.config.sites[0]).toMatchObject({ name: site.name, radius: 100 });
    expect(saved.config.sites[0].id).toMatch(/^[0-9a-f-]{36}$/);
    // حفظ الإعدادات دون إرسال المواقع يبقيها
    const kept = (await http.put(`${H}/attendance/settings`).set(as(tk.admin)).send({ enabled: true, workStart: '08:00', workEnd: '15:00', weekend: [5, 6], holidays: [] }).expect(200)).body;
    expect(kept.config.sites).toHaveLength(1);

    // غير مفعّل له الجوال، وحساب غير مربوط بموظف
    expect((await http.post(`${H}/me/attendance`).set(as(tk.desk)).send({ latitude: site.lat, longitude: site.lng, accuracy: 10 }).expect(403)).body.message).toContain('غير مفعّل');
    await http.post(`${H}/me/attendance`).set(as(tk.clerk)).send({ latitude: site.lat, longitude: site.lng, accuracy: 10 }).expect(403);
    await http.post(`${H}/me/attendance`).set(as(tk.emp)).send({ latitude: 'x', longitude: site.lng, accuracy: 10 }).expect(400);
    expect((await http.post(`${H}/me/attendance`).set(as(tk.emp)).send({ latitude: 24.72, longitude: site.lng, accuracy: 10 }).expect(400)).body.message).toContain('خارج نطاق');
    expect((await http.post(`${H}/me/attendance`).set(as(tk.emp)).send({ latitude: site.lat, longitude: site.lng, accuracy: 500 }).expect(400)).body.message).toContain('دقة');
    const ok = (await http.post(`${H}/me/attendance`).set(as(tk.emp)).send({ latitude: 24.7139, longitude: site.lng, accuracy: 12 }).expect(200)).body;
    expect(ok.punches).toHaveLength(1);
    expect(ok.punches[0].source).toBe('mobile');
    expect(ok.next).toBe('out');
    await http.post(`${H}/me/attendance`).set(as(tk.emp)).send({ latitude: site.lat, longitude: site.lng, accuracy: 12 }).expect(409);

    const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
    const detail = (await http.get(`${H}/attendance/employees/${ids.a}?month=${today.slice(0, 7)}`).set(as(tk.admin)).expect(200)).body;
    const p = detail.days.find((d: { date: string }) => d.date === today).punches[0];
    expect(p).toMatchObject({ source: 'mobile', sourceLabel: 'الجوال', accuracy: 12 });
    expect(p.clientIp).toBeTruthy();
    expect(p.distance).toBeGreaterThan(25);
    expect(p.note).toContain(site.name);
  });
});
