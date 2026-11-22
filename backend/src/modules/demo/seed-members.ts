import { Injectable } from '@nestjs/common';
import { deflateSync } from 'zlib';
import { ApplicationsService } from '../members/applications.service';
import { BillingService } from '../members/billing.service';
import { MemCore, today } from '../members/mem-core.service';
import { ApplicationDto, DirectMemberDto } from '../members/members.dto';
import { MembersService } from '../members/members.service';
import { DemoTeam, daysAgo } from './demo-context';

// ---------------- صورة PNG صغيرة تمثل صورة الهوية في البيانات التجريبية ----------------

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/** بطاقة ملونة بشريط علوي ومربع للصورة، بحجم بطاقة الهوية */
function idImage(hue: [number, number, number], name: string, key = 'id_front'): Express.Multer.File {
  const w = 240;
  const h = 150;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const band = y < 28;
      const photo = x > 16 && x < 76 && y > 44 && y < 124;
      const line = x > 92 && x < 220 && [56, 76, 96, 116].some((l) => y >= l && y < l + 6);
      const [r, g, b] = band ? hue : photo ? [200, 206, 214] : line ? [170, 178, 190] : [244 - (y >> 3), 246 - (y >> 3), 240];
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const buffer = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return {
    fieldname: key, buffer, size: buffer.length, mimetype: 'image/png',
    originalname: Buffer.from(`${key === 'id_front' ? 'هوية-' : ''}${name}.png`, 'utf8').toString('latin1'),
  } as Express.Multer.File;
}
const GREEN: [number, number, number] = [15, 118, 110];
const BLUE: [number, number, number] = [30, 58, 138];

/**
 * عضوية الجمعية العمومية في الشركة التجريبية: ربط مالي وسداد تجريبي، أعضاء قائمون بحالات مختلفة
 * (سارية، تنتهي قريبًا، في مهلة السماح، منتهية، موقوفة)، وطلبات عضوية في كل مراحلها، وسدادات تُنشئ سندات قبض.
 * كل العمليات عبر خدمات الوحدة نفسها (بنفس التحقق).
 */
@Injectable()
export class MembersSeed {
  constructor(
    private readonly core: MemCore,
    private readonly people: MembersService,
    private readonly apps: ApplicationsService,
    private readonly billing: BillingService,
  ) {}

  async run(team: DemoTeam) {
    const { admin, finance } = team;
    const org = admin.organizationId;

    // ---- الإعدادات: حق التصويت للعضو العامل بعد 90 يومًا، والربط المالي، وطرق السداد
    const s = await this.core.getSettings(admin);
    await this.core.saveSettings(admin, 'types', {
      types: s.types.map((t) => (t.code === 'working' ? { ...t, votingAfterDays: 90 } : t)),
    });
    const acc = (s.accounts as { id: string; code: string }[]).find((a) => a.code.startsWith('31205001'));
    const cash = (name: string) => (s.cashAccounts as { id: string; name: string }[]).find((c) => c.name.startsWith(name))?.id ?? null;
    await this.core.saveSettings(admin, 'accounting', {
      revenueAccountId: acc?.id ?? null, onlineCashAccountId: cash('بنك الرياض'), transferCashAccountId: cash('مصرف الراجحي'), cashCashAccountId: cash('الصندوق العام'),
    });
    await this.core.saveSettings(admin, 'payment', {
      online: true, transfer: true, cash: true, provider: 'sandbox', dueDays: 14,
      bankName: 'مصرف الراجحي', accountName: 'جمعية سنابل الخير', iban: 'SA0380000000608010167519',
    });
    await this.core.saveSettings(admin, 'general', {
      publicEnabled: true,
      intro: 'انضم إلى الجمعية العمومية لجمعية سنابل الخير، وكن شريكًا في القرار ومتابعة أثر العمل الخيري في منطقتك.',
    });
    await this.core.saveSettings(admin, 'card', {
      title: 'بطاقة عضوية الجمعية العمومية', signatoryName: 'عبدالله بن سعد الشهري', signatoryTitle: 'رئيس مجلس الإدارة',
      note: 'هذه البطاقة شخصية، ويُتحقق من صلاحيتها برمز التحقق.',
    });

    // ---- أعضاء قائمون قبل تشغيل النظام، بحالات مختلفة
    const base = { nationality: 'سعودي', city: 'أبها', answers: {} } as const;
    const direct: (Partial<DirectMemberDto> & { fullName: string; nationalId: string; mobile: string; typeCode: string; joinedOn: string; startDate: string; gender: 'male' | 'female' })[] = [
      { fullName: 'عبدالله بن سعد الشهري', nationalId: '1012345670', mobile: '0551000101', gender: 'male', typeCode: 'working', birthDate: '1968-03-12', occupation: 'رجل أعمال', joinedOn: '2016-02-01', startDate: daysAgo(120), memberNo: 1 },
      { fullName: 'محمد بن علي القحطاني', nationalId: '1023456781', mobile: '0551000102', gender: 'male', typeCode: 'working', birthDate: '1972-07-04', occupation: 'مهندس', joinedOn: '2016-02-01', startDate: daysAgo(200), memberNo: 2 },
      { fullName: 'نورة بنت فهد العسيري', nationalId: '1034567892', mobile: '0551000103', gender: 'female', typeCode: 'working', birthDate: '1980-11-20', occupation: 'معلمة', joinedOn: '2017-09-15', startDate: daysAgo(90) },
      { fullName: 'خالد بن عبدالرحمن الغامدي', nationalId: '1045678903', mobile: '0551000104', gender: 'male', typeCode: 'working', birthDate: '1975-01-30', occupation: 'طبيب', joinedOn: '2018-03-10', startDate: daysAgo(340) },
      { fullName: 'سارة بنت محمد الزهراني', nationalId: '1056789014', mobile: '0551000105', gender: 'female', typeCode: 'working', birthDate: '1985-05-18', occupation: 'محاسبة', joinedOn: '2019-01-05', startDate: daysAgo(355) },
      { fullName: 'فهد بن ناصر الأحمري', nationalId: '1067890125', mobile: '0551000106', gender: 'male', typeCode: 'working', birthDate: '1978-09-09', occupation: 'موظف حكومي', joinedOn: '2019-06-01', startDate: daysAgo(375) },
      { fullName: 'هند بنت سليمان الشمراني', nationalId: '1078901236', mobile: '0551000107', gender: 'female', typeCode: 'working', birthDate: '1990-02-14', occupation: 'أخصائية اجتماعية', joinedOn: '2020-10-10', startDate: daysAgo(30) },
      { fullName: 'سعيد بن مانع آل مشيط', nationalId: '1089012347', mobile: '0551000108', gender: 'male', typeCode: 'working', birthDate: '1965-12-01', occupation: 'متقاعد', joinedOn: '2016-02-01', startDate: daysAgo(430) },
      { fullName: 'ريم بنت عبدالعزيز القرني', nationalId: '1090123458', mobile: '0551000109', gender: 'female', typeCode: 'affiliate', birthDate: '1995-04-22', occupation: 'مصممة', joinedOn: '2022-04-01', startDate: daysAgo(60) },
      { fullName: 'أحمد محمود عبدالله', nationalId: '2101234569', mobile: '0551000110', gender: 'male', typeCode: 'affiliate', birthDate: '1983-08-08', occupation: 'مهندس برمجيات', joinedOn: '2023-01-15', startDate: daysAgo(345), ...{ nationality: 'مصري' } },
      { fullName: 'تركي بن سالم العمري', nationalId: '1112345670', mobile: '0551000111', gender: 'male', typeCode: 'working', birthDate: '1988-06-06', occupation: 'محامٍ', joinedOn: daysAgo(45), startDate: daysAgo(45) },
      { fullName: 'الشيخ إبراهيم بن حمد آل سعود', nationalId: '1123456781', mobile: '0551000112', gender: 'male', typeCode: 'honorary', birthDate: '1955-10-10', occupation: 'داعم', joinedOn: '2018-12-01', startDate: daysAgo(150) },
      { fullName: 'عائشة بنت حسن الحربي', nationalId: '1134567892', mobile: '0551000113', gender: 'female', typeCode: 'working', birthDate: '1982-03-03', occupation: 'إدارية', joinedOn: '2021-05-20', startDate: daysAgo(250) },
    ];
    const ids: string[] = [];
    for (const [i, d] of direct.entries()) {
      const m = await this.people.createDirect(admin, { ...base, email: `member${i + 1}@example.sa`, ...d } as DirectMemberDto);
      ids.push(m.id);
      if (i % 4 !== 3) await this.people.uploadDocument(admin, m.id, idImage(i % 2 ? BLUE : GREEN, d.fullName));
    }
    // إيقاف عضوية لعدم الالتزام بقرار المجلس
    await this.people.setStatus(admin, ids[12], { status: 'suspended', note: 'قرار مجلس الإدارة رقم 14 بإيقاف العضوية لحين تسوية الملاحظات' });

    // ---- التجديد: سارة (تنتهي بعد 10 أيام) سددت نقدًا، وفهد (في مهلة السماح) صدرت مطالبته ونُبّه بواتساب،
    // وخالد (تنتهي بعد 25 يومًا) صدرت مطالبته ورفع إيصال تحويل
    const sara = await this.billing.issueRenewal(org, ids[4], finance.fullName);
    if (sara.invoice) await this.billing.recordPayment(finance, sara.invoice.id, { method: 'cash', paidOn: today(), reference: 'إيصال 1045' });
    await this.billing.issueRenewal(org, ids[5], finance.fullName);
    const fahdRow = (await this.billing.renewals(admin, 'https://sanabelerp.com')).rows.find((r) => r.id === ids[5]);
    await this.billing.notice(admin, ids[5], { channel: 'whatsapp', message: fahdRow?.message ?? 'تذكير بتجديد العضوية' });
    const khaled = await this.billing.issueRenewal(org, ids[3], finance.fullName);
    if (khaled.invoice) await this.billing.submitTransfer(khaled.invoice.payToken, idImage(BLUE, 'إيصال تحويل', 'receipt'), 'TRX-88231');

    // ---- طلبات العضوية في كل المراحل
    const conditions = s.conditions.filter((c) => c.isActive).map((c) => c.key);
    const apply = async (d: Partial<ApplicationDto> & { fullName: string; nationalId: string; mobile: string; gender: 'male' | 'female' }, source: 'public' | 'staff', typeCode = 'working') =>
      this.apps.create(org, {
        nationality: 'سعودي', city: 'خميس مشيط', birthDate: '1990-01-01', typeCode, answers: {}, acceptedConditions: conditions, email: null, ...d,
      } as ApplicationDto, [idImage(GREEN, d.fullName)], source, source === 'staff' ? admin.fullName : null);
    const approve = (id: string, note: string | null = null) => this.apps.decide(admin, id, { decision: 'approve', note });

    // جديد بانتظار المرحلة الأولى
    await apply({ fullName: 'يوسف بن ماجد الشهراني', nationalId: '1145678903', mobile: '0552000201', gender: 'male', occupation: 'مهندس مدني' }, 'public');
    await apply({ fullName: 'لمى بنت خالد الأسمري', nationalId: '1156789014', mobile: '0552000202', gender: 'female', occupation: 'طالبة دراسات عليا', birthDate: '1999-02-02' }, 'public', 'affiliate');
    // اجتاز المرحلة الأولى وينتظر اعتماد المجلس
    const a2 = await apply({ fullName: 'بندر بن عوض القحطاني', nationalId: '1167890125', mobile: '0552000203', gender: 'male', occupation: 'رجل أعمال', birthDate: '1979-05-05' }, 'public');
    await approve(a2.id, 'استوفى الشروط');
    // معاد لاستكمال البيانات
    const a3 = await apply({ fullName: 'منيرة بنت سعد الوادعي', nationalId: '1178901236', mobile: '0552000204', gender: 'female', occupation: 'معلمة' }, 'public');
    await this.apps.decide(admin, a3.id, { decision: 'return', note: 'صورة الهوية غير واضحة، أعيدي رفعها بصورة أوضح' });
    // مرفوض
    const a4 = await apply({ fullName: 'مقدم طلب غير مستوف', nationalId: '1189012347', mobile: '0552000205', gender: 'male', birthDate: '2001-01-01' }, 'public');
    await this.apps.decide(admin, a4.id, { decision: 'reject', note: 'سبق إنهاء عضويته بقرار من مجلس الإدارة' });
    // معتمد بانتظار السداد
    const a5 = await apply({ fullName: 'ماجد بن فايز العسيري', nationalId: '1190123458', mobile: '0552000206', gender: 'male', occupation: 'محاسب' }, 'staff');
    await approve(a5.id);
    await approve(a5.id, 'اعتماد المجلس في جلسته الرابعة');
    // سدد إلكترونيًا (بيئة الدفع التجريبية) وأصبح عضوًا
    const a6 = await apply({ fullName: 'عبدالرحمن بن صالح الألمعي', nationalId: '1201234569', mobile: '0552000207', gender: 'male', occupation: 'مستشار' }, 'public');
    await approve(a6.id);
    const d6 = await approve(a6.id);
    if (d6.invoice) {
      const pay = await this.billing.startOnline(d6.invoice.payToken, 'https://sanabelerp.com');
      await this.billing.sandboxPay(d6.invoice.payToken, new URL(pay.url).searchParams.get('sandbox') ?? '');
    }
    // حوّل بنكيًا ورفع الإيصال، وينتظر تأكيد المالية
    const a7 = await apply({ fullName: 'غادة بنت ناصر البيشي', nationalId: '1212345670', mobile: '0552000208', gender: 'female', occupation: 'صيدلانية' }, 'public', 'affiliate');
    await approve(a7.id);
    const d7 = await approve(a7.id);
    if (d7.invoice) await this.billing.submitTransfer(d7.invoice.payToken, idImage(BLUE, 'إيصال تحويل', 'receipt'), 'TRX-55410');
    // حوّل بنكيًا وأكدت المالية السداد
    const a8 = await apply({ fullName: 'حمد بن مسفر الشهري', nationalId: '1223456781', mobile: '0552000209', gender: 'male', occupation: 'موظف قطاع خاص' }, 'staff');
    await approve(a8.id);
    const d8 = await approve(a8.id);
    if (d8.invoice) {
      await this.billing.submitTransfer(d8.invoice.payToken, idImage(BLUE, 'إيصال تحويل', 'receipt'), 'TRX-55602');
      await this.billing.recordPayment(finance, d8.invoice.id, { method: 'transfer', paidOn: daysAgo(0), reference: 'TRX-55602' });
    }
  }
}
