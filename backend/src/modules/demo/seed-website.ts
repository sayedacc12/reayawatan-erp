import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { deflateSync } from 'zlib';
import { OrgUser } from '../../core/auth/decorators';
import { IdentityService } from '../../core/identity/identity.service';
import { KNOWLEDGE_PERMISSIONS } from '../knowledge/knowledge.manifest';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { ContentService } from '../website/content.service';
import { SiteService } from '../website/site.service';
import { StoreService } from '../website/store.service';
import { WebCore } from '../website/web-core.service';
import { WEBSITE_PERMISSIONS } from '../website/website.manifest';
import { DemoTeam, DemoTree, daysAgo, daysAhead } from './demo-context';

// ---------------- صور وملفات تجريبية تُولَّد بالكود ----------------

type RGB = [number, number, number];
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
/** صورة PNG من دالة لون لكل نقطة (RGBA) */
function png(w: number, h: number, px: (x: number, y: number) => [number, number, number, number], name: string): Express.Multer.File {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      const [r, g, b, a] = px(x, y);
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const buffer = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return { fieldname: 'file', buffer, size: buffer.length, mimetype: 'image/png', originalname: Buffer.from(`${name}.png`, 'utf8').toString('latin1') } as Express.Multer.File;
}
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * Math.max(0, Math.min(1, t)))) as RGB;
/** مشهد زخرفي: تدرج لوني مع دوائر ضوئية وتلال، يمثل صورة البرنامج أو الخبر */
function scene(a: RGB, b: RGB, glow: RGB, seed: number, name: string, w = 640, h = 400) {
  const orbs = Array.from({ length: 5 }, (_, i) => ({ x: ((seed * 97 + i * 151) % w), y: ((seed * 53 + i * 89) % (h * 0.6)), r: 40 + ((seed + i * 37) % 90) }));
  return png(w, h, (x, y) => {
    let c = mix(a, b, (x / w) * 0.6 + (y / h) * 0.4);
    for (const o of orbs) {
      const d = Math.hypot(x - o.x, y - o.y);
      if (d < o.r) c = mix(c, glow, (1 - d / o.r) * 0.45);
    }
    const hill = h * 0.72 + Math.sin((x + seed * 13) / 70) * 22 + Math.sin(x / 23) * 6;
    if (y > hill) c = mix(c, [255, 255, 255], 0.12 + ((y - hill) / h) * 0.3);
    return [c[0], c[1], c[2], 255];
  }, name);
}
/** شعار الجمعية: سنبلة مبسطة داخل دائرة */
function logo(color: RGB, accent: RGB, name: string) {
  const s = 240;
  return png(s, s, (x, y) => {
    const cx = s / 2;
    const d = Math.hypot(x - cx, y - cx);
    if (d > 112) return [0, 0, 0, 0];
    if (d > 100) return [...color, 255] as [number, number, number, number];
    const stem = Math.abs(x - cx) < 4 && y > 60 && y < 196;
    const grains = [0, 1, 2, 3, 4].some((i) => {
      const gy = 78 + i * 22;
      return Math.hypot((x - (cx - 16)) * 1.6, y - gy) < 13 || Math.hypot((x - (cx + 16)) * 1.6, y - gy - 8) < 13;
    });
    const top = Math.hypot((x - cx) * 1.5, y - 62) < 11;
    if (stem || grains || top) return [...accent, 255] as [number, number, number, number];
    return [255, 255, 255, 255];
  }, name);
}
/** ملف PDF صغير صالح، يمثل وثيقة في الأرشيف */
function pdf(title: string, name: string): Express.Multer.File {
  const text = title.replace(/[()\\]/g, '');
  const stream = `BT /F1 22 Tf 72 720 Td (${text}) Tj 0 -34 Td /F1 12 Tf (Sanabel ERP - demo document) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const buffer = Buffer.from(out, 'latin1');
  return { fieldname: 'file', buffer, size: buffer.length, mimetype: 'application/pdf', originalname: Buffer.from(`${name}.pdf`, 'utf8').toString('latin1') } as Express.Multer.File;
}

const TEAL: RGB = [15, 118, 110];
const DEEP: RGB = [11, 42, 46];
const GOLD: RGB = [232, 176, 75];
const SKY: RGB = [14, 116, 144];
const PLUM: RGB = [91, 33, 182];
const ROSE: RGB = [190, 18, 60];

/**
 * هوية الجمعية التجريبية وأرشيف معرفتها وموقعها الإلكتروني: صفحات كاملة، وأخبار وبرامج في مراحل اعتماد مختلفة،
 * وتبرعات حقيقية عبر المتجر بالبيئة التجريبية (بإيصالات وسندات قبض)، وتبرع شهري وإهداء، ورسائل زوار.
 */
@Injectable()
export class WebsiteSeed {
  constructor(
    private readonly db: DataSource,
    private readonly identity: IdentityService,
    private readonly knowledge: KnowledgeService,
    private readonly web: WebCore,
    private readonly content: ContentService,
    private readonly site: SiteService,
    private readonly store: StoreService,
  ) {}

  async run(team: DemoTeam, tree: DemoTree, origin: string) {
    const { admin } = team;
    const editor: OrgUser = { ...team.fundraiser, permissions: [...team.fundraiser.permissions, WEBSITE_PERMISSIONS.read, WEBSITE_PERMISSIONS.edit, KNOWLEDGE_PERMISSIONS.read, KNOWLEDGE_PERMISSIONS.manage] };
    await this.seedIdentity(admin);
    const docs = await this.seedKnowledge(admin, team);
    await this.seedWebsite(admin, editor, tree, docs, origin);
  }

  // ---------------- الهوية ----------------

  private async seedIdentity(admin: OrgUser) {
    await this.identity.save(admin, {
      displayName: 'جمعية سنابل الخير', shortName: 'سنابل الخير', englishName: 'Sanabel Al-Khair Charity',
      slogan: 'نزرع الخير.. ليحصده المحتاج',
      about: 'جمعية أهلية غير ربحية مسجلة لدى المركز الوطني لتنمية القطاع غير الربحي، تعمل في مدينة الرياض منذ عام 2012م على رعاية الأيتام والأسر المحتاجة، ودعم المرضى والطلاب، عبر برامج نوعية وشراكات فاعلة ومتطوعين مؤهلين.',
      vision: 'الريادة في التنمية الاجتماعية المستدامة وتمكين الأسر المحتاجة.',
      mission: 'تقديم خدمات اجتماعية وتنموية نوعية للأيتام والأسر المحتاجة والمرضى والطلاب، بشراكات فاعلة وكفاءة في إدارة الموارد وشفافية في الأداء.',
      goals: [
        'رعاية الأيتام وكفالتهم كفالة شاملة حتى الاستقلال.',
        'تمكين الأسر المحتاجة اقتصاديًا ونقلها من الرعاية إلى الإنتاج.',
        'دعم المرضى غير القادرين على تكاليف العلاج والعمليات.',
        'تعزيز التعليم بدعم الطلاب المحتاجين بالحقائب والرسوم.',
        'بناء شراكات مستدامة مع القطاعين الحكومي والخاص.',
      ],
      values: [
        { title: 'الأمانة', text: 'نحفظ أموال المتبرعين ونصرفها في وجهها.' }, { title: 'الشفافية', text: 'نفصح عن أعمالنا ونتائجنا للجميع.' },
        { title: 'الإتقان', text: 'نقدم خدماتنا بجودة عالية وقياس مستمر.' }, { title: 'الرحمة', text: 'نخدم المستفيدين بكرامة واحترام.' },
      ],
      colors: { primary: '#0f766e', secondary: '#14b8a6', accent: '#e8b04b', dark: '#0b2a2e' },
      fonts: { body: 'Tajawal', heading: 'El Messiri' },
      contact: {
        phone: '0112345678', email: 'info@sanabel-demo.org.sa', address: 'حي النرجس، طريق الملك عبدالعزيز', city: 'الرياض',
        mapUrl: 'https://maps.google.com/?q=24.8364,46.6582', workingHours: 'الأحد إلى الخميس، 8 صباحًا إلى 4 مساءً', poBox: 'ص.ب 12345 الرياض 11564',
        social: { x: 'https://x.com/sanabel_demo', instagram: 'https://instagram.com/sanabel_demo', linkedin: '', youtube: 'https://youtube.com/@sanabel_demo', snapchat: '', tiktok: '', facebook: '', whatsapp: '966500000000' },
      },
      licenseNo: '1234', licenseAuthority: 'المركز الوطني لتنمية القطاع غير الربحي', foundedOn: '2012-03-14', applyToSystem: false,
    });
    await this.identity.uploadLogo(admin, 'logo', logo(TEAL, GOLD, 'شعار-سنابل-الخير'));
    await this.identity.uploadLogo(admin, 'logoLight', logo([255, 255, 255], GOLD, 'شعار-فاتح'));
  }

  // ---------------- أرشيف المعرفة ----------------

  private async seedKnowledge(admin: OrgUser, team: DemoTeam) {
    const cats = await this.knowledge.categories(admin.organizationId);
    const cat = (name: string) => cats.find((c) => c.name.startsWith(name))?.id ?? null;
    const make = async (d: {
      code?: string; title: string; cat: string; type: string; summary: string; owner: string; approvedBy?: string; issued: string; review?: string; version?: string;
      file?: string; content?: string; publicDoc?: boolean; publish?: boolean; tags?: string[]; by?: OrgUser;
    }) => {
      const by = d.by ?? admin;
      const doc = await this.knowledge.create(by, {
        code: d.code ?? null, title: d.title, categoryId: cat(d.cat), docType: d.type, summary: d.summary, content: d.content ?? null, tags: d.tags ?? [],
        version: d.version ?? '1.0', issuedOn: d.issued, reviewOn: d.review ?? null, ownerName: d.owner, approvedBy: d.approvedBy ?? null, externalUrl: null,
      });
      if (d.file) await this.knowledge.attach(by, doc.id, pdf(d.file, d.title));
      if (d.publish !== false) await this.knowledge.setStatus(admin, doc.id, { status: 'published', visibility: d.publicDoc ? 'public' : 'internal' });
      return doc.id;
    };
    const ids = {
      bylaws: await make({ code: 'ل-01', title: 'اللائحة الأساسية للجمعية', cat: 'الحوكمة', type: 'regulation', summary: 'أهداف الجمعية وعضويتها وجمعيتها العمومية ومجلس إدارتها وماليتها.', owner: 'مجلس الإدارة', approvedBy: 'الجمعية العمومية', issued: '2023-01-10', review: daysAhead(200), file: 'Bylaws L-01', publicDoc: true, tags: ['حوكمة', 'لائحة'] }),
      board: await make({ code: 'ل-02', title: 'لائحة عمل مجلس الإدارة', cat: 'الحوكمة', type: 'regulation', summary: 'اختصاصات المجلس واجتماعاته وآلية اتخاذ القرار.', owner: 'مجلس الإدارة', approvedBy: 'الجمعية العمومية', issued: '2024-02-01', review: daysAhead(120), file: 'Board Charter L-02', publicDoc: true }),
      finance: await make({ code: 'ل-05', title: 'اللائحة المالية', cat: 'المالية', type: 'regulation', summary: 'الصلاحيات المالية والصرف والتحصيل والموازنة والرقابة.', owner: 'الإدارة المالية', approvedBy: 'مجلس الإدارة', issued: '2024-05-20', review: daysAgo(5), file: 'Financial Regulation L-05', publicDoc: true, version: '2.1' }),
      hr: await make({ code: 'ل-07', title: 'لائحة الموارد البشرية', cat: 'الموارد البشرية', type: 'regulation', summary: 'التعيين والرواتب والإجازات والتقييم وإنهاء الخدمة.', owner: 'الموارد البشرية', approvedBy: 'مجلس الإدارة', issued: '2025-01-05', review: daysAhead(300), file: 'HR Regulation L-07', publicDoc: true }),
      coi: await make({ code: 'س-01', title: 'سياسة تعارض المصالح', cat: 'الحوكمة', type: 'policy', summary: 'تعريف تعارض المصالح والإفصاح عنه وإدارته.', owner: 'لجنة المراجعة', approvedBy: 'مجلس الإدارة', issued: '2024-03-11', review: daysAhead(90), file: 'Conflict of Interest P-01', publicDoc: true }),
      whistle: await make({ code: 'س-02', title: 'سياسة الإبلاغ عن المخالفات وحماية مقدميها', cat: 'الحوكمة', type: 'policy', summary: 'قنوات الإبلاغ السرية وحماية المبلغين.', owner: 'لجنة المراجعة', approvedBy: 'مجلس الإدارة', issued: '2024-03-11', review: daysAhead(90), file: 'Whistleblowing P-02', publicDoc: true }),
      privacy: await make({ code: 'س-03', title: 'سياسة خصوصية البيانات وحمايتها', cat: 'الحوكمة', type: 'policy', summary: 'جمع بيانات المتبرعين والمستفيدين وحفظها ومشاركتها.', owner: 'تقنية المعلومات', approvedBy: 'مجلس الإدارة', issued: '2024-06-01', file: 'Data Privacy P-03', publicDoc: true }),
      fundraising: await make({ code: 'س-05', title: 'سياسة جمع التبرعات', cat: 'الحوكمة', type: 'policy', summary: 'ضوابط جمع التبرعات وقنواتها وصرفها في وجهها.', owner: 'تنمية الموارد', approvedBy: 'مجلس الإدارة', issued: '2024-06-01', file: 'Fundraising P-05', publicDoc: true }),
      annual: await make({ code: 'ت-2025', title: 'التقرير السنوي لعام 2025م', cat: 'التقارير', type: 'report', summary: 'إنجازات الجمعية وبرامجها وأثرها خلال عام 2025م.', owner: 'الإدارة التنفيذية', approvedBy: 'مجلس الإدارة', issued: '2026-03-30', file: 'Annual Report 2025', publicDoc: true }),
      statements: await make({ code: 'ق-2025', title: 'القوائم المالية المدققة لعام 2025م', cat: 'التقارير', type: 'report', summary: 'القوائم المالية مع تقرير المراجع الخارجي.', owner: 'الإدارة المالية', approvedBy: 'الجمعية العمومية', issued: '2026-04-15', file: 'Audited Financial Statements 2025', publicDoc: true }),
      kit: await make({ code: 'ح-01', title: 'الحقيبة التعريفية لبرنامج كفالة الأيتام', cat: 'البرامج', type: 'media', summary: 'تعريف بالبرنامج وخدماته ومؤشراته وطرق دعمه.', owner: 'إدارة البرامج', issued: '2026-01-15', file: 'Orphan Sponsorship Program Kit', publicDoc: true }),
      research: await make({ code: 'QP-BEN-01', title: 'دليل إجراءات البحث الاجتماعي', cat: 'البرامج', type: 'procedure', summary: 'خطوات الزيارة الميدانية وتعبئة نموذج البحث وتقييم الاستحقاق.', owner: 'إدارة الخدمات الاجتماعية', approvedBy: 'المدير التنفيذي', issued: '2025-09-01', review: daysAhead(30), file: 'Social Research Procedure', tags: ['مستفيدون', 'بحث اجتماعي'] }),
      lesson: await make({
        title: 'درس مستفاد: توزيع السلال الرمضانية بالقسائم الإلكترونية', cat: 'الجودة', type: 'lesson', owner: 'إدارة البرامج', issued: '2026-04-20',
        summary: 'ما تعلمناه من تحويل توزيع السلال من التوزيع المباشر إلى القسائم الإلكترونية في رمضان 1447هـ.',
        content: 'الموقف:\nكان التوزيع المباشر للسلال الرمضانية يسبب ازدحامًا وتأخيرًا ويصعب معه التحقق من وصول السلة للأسرة.\n\nما فعلناه:\nتحولنا إلى قسائم إلكترونية تُرسل لجوال الأسرة، وتُصرف من متاجر شريكة.\n\nالنتيجة:\nانخفض وقت التوزيع 60%، وارتفع رضا الأسر إلى 94%، وصار لكل قسيمة أثر يمكن تتبعه.\n\nالتوصية:\nتعميم القسائم على برامج الكسوة والحقيبة المدرسية، مع اتفاقيات واضحة مع المتاجر الشريكة.',
        tags: ['رمضان', 'قسائم', 'تحسين'],
      }),
      draft: await make({ code: 'QF-HR-04', title: 'نموذج طلب تطوع داخلي', cat: 'الموارد البشرية', type: 'form', summary: 'نموذج لطلب الموظفين المشاركة في الأعمال التطوعية.', owner: 'الموارد البشرية', issued: daysAgo(3), publish: false, by: { ...team.quality, permissions: [...team.quality.permissions, KNOWLEDGE_PERMISSIONS.read, KNOWLEDGE_PERMISSIONS.manage] } }),
    };
    // إصدار جديد للائحة المالية (يحفظ الإصدار السابق في السجل)
    await this.knowledge.newVersion(admin, ids.finance, { version: '2.2', issuedOn: daysAgo(20), note: 'تحديث صلاحيات الصرف' }, pdf('Financial Regulation L-05 v2.2', 'اللائحة المالية 2.2'));
    await this.db.query('UPDATE kn_documents SET views = 10 + floor(random() * 120)::int, downloads = floor(random() * 40)::int WHERE organization_id = $1', [admin.organizationId]);
    return ids;
  }

  // ---------------- الموقع الإلكتروني ----------------

  private async seedWebsite(admin: OrgUser, editor: OrgUser, tree: DemoTree, docs: Record<string, string>, origin: string) {
    const org = admin.organizationId;
    const img = async (a: RGB, b: RGB, glow: RGB, seed: number, name: string) => (await this.web.upload(admin, scene(a, b, glow, seed, name))).id;
    const media = {
      hero: await img(DEEP, TEAL, GOLD, 7, 'واجهة الموقع'), about: await img(TEAL, SKY, [255, 255, 255], 3, 'عن الجمعية'),
      orphans: await img([13, 148, 136], [6, 95, 70], GOLD, 11, 'كفالة الأيتام'), ramadan: await img([180, 83, 9], [120, 53, 15], [253, 224, 71], 5, 'السلال الرمضانية'),
      surgery: await img(SKY, [8, 47, 73], [186, 230, 253], 19, 'العمليات الجراحية'), school: await img(PLUM, [49, 46, 129], [251, 191, 36], 23, 'الحقيبة المدرسية'),
      waqf: await img(DEEP, [17, 94, 89], GOLD, 29, 'وقف سنابل'), widows: await img(ROSE, [136, 19, 55], [254, 205, 211], 31, 'تمكين الأرامل'),
      n1: await img(TEAL, DEEP, GOLD, 37, 'خبر 1'), n2: await img([180, 83, 9], DEEP, GOLD, 41, 'خبر 2'), n3: await img(SKY, DEEP, [255, 255, 255], 43, 'خبر 3'),
      n4: await img(PLUM, DEEP, GOLD, 47, 'خبر 4'), leader1: await img([71, 85, 105], [30, 41, 59], [226, 232, 240], 53, 'رئيس المجلس'),
      leader2: await img([71, 85, 105], [30, 41, 59], [226, 232, 240], 59, 'المدير التنفيذي'),
    };

    // ---- الإعدادات
    const s = await this.site.getSettings(admin);
    const acc = (code: string) => (s.accounts as { id: string; code: string }[]).find((a) => a.code.startsWith(code))?.id ?? null;
    const cash = (s.cashAccounts as { id: string; name: string }[]).find((c) => c.name.startsWith('بنك الرياض'))?.id ?? null;
    await this.site.saveSettings(admin, 'general', {
      published: true, sections: { about: true, programs: true, news: true, governance: true, partners: true, contact: true, store: true, volunteer: true, membership: true, portal: true },
      seo: { title: 'جمعية سنابل الخير', description: 'جمعية أهلية في الرياض لرعاية الأيتام والأسر المحتاجة. تبرع إلكترونيًا بإيصال فوري.', keywords: 'جمعية خيرية، تبرع، كفالة أيتام، الرياض' },
      footerText: 'جمعية سنابل الخير، مسجلة لدى المركز الوطني لتنمية القطاع غير الربحي برقم 1234.', customDomain: '',
    });
    await this.site.saveSettings(admin, 'store', {
      enabled: true, general: true, generalTitle: 'تبرع عام غير مقيد (حيث الحاجة)', min: 10, max: 50000, presets: [50, 100, 250, 500, 1000],
      gift: true, monthly: true, receiptNote: 'الجمعية مسجلة برقم 1234، والتبرع يُصرف في وجهه وفق سياسة جمع التبرعات.', thanks: 'جزاك الله خيرًا وبارك في مالك، وصل تبرعك وسيصل أثره بإذن الله.',
    });
    await this.site.saveSettings(admin, 'payment', { provider: 'sandbox' });
    await this.site.saveSettings(admin, 'accounting', { generalRevenueAccountId: acc('31201001'), waqfRevenueAccountId: acc('31301'), onlineCashAccountId: cash });

    // ---- الصفحات
    await this.site.savePage(admin, 'home', {
      kicker: 'جمعية أهلية غير ربحية · الرياض', title: 'نزرع الخير.. ليحصده المحتاج',
      text: 'نكفل الأيتام، ونمكّن الأسر، ونعالج المرضى، وندعم الطلاب. تبرعك يصل بإيصال فوري ويُصرف في وجهه بشفافية.',
      imageId: media.hero, primaryCta: { label: 'تبرّع الآن', target: 'donate' }, secondaryCta: { label: 'تعرّف على برامجنا', target: 'programs' },
      stats: [{ value: '1,240', label: 'يتيمًا مكفولًا' }, { value: '3,800', label: 'أسرة مستفيدة' }, { value: '320', label: 'متطوعًا' }, { value: '14', label: 'عامًا من العطاء' }],
      showTicker: true, showGoals: true, showValues: true,
      announcement: { on: true, text: 'حملة الشتاء: ساهم في كسوة 500 أسرة قبل نهاية الشهر', link: 'donate' },
    });
    await this.site.savePage(admin, 'about', {
      story: 'بدأت جمعية سنابل الخير عام 2012م بمبادرة من مجموعة من أهل الخير في حي النرجس بالرياض، لكفالة عشرين يتيمًا.\n\nونمت الجمعية بثقة المتبرعين وجهود المتطوعين حتى أصبحت تخدم آلاف الأسر سنويًا عبر برامج الرعاية والتمكين والصحة والتعليم.\n\nونعمل اليوم وفق معايير الحوكمة الصادرة من المركز الوطني لتنمية القطاع غير الربحي، ونقيس أثر برامجنا وننشر تقاريرنا للجميع.',
      imageId: media.about, showStructure: true,
    });
    await this.site.savePage(admin, 'governance', {
      intro: 'نلتزم بمعايير الحوكمة والشفافية والإفصاح الصادرة من المركز الوطني لتنمية القطاع غير الربحي، ونتيح لوائحنا وسياساتنا وتقاريرنا المعتمدة للجميع.',
      leaders: [{ name: 'د. عبدالله بن سعد العتيبي', role: 'رئيس مجلس الإدارة', photoId: media.leader1 }, { name: 'أ. نورة بنت محمد القحطاني', role: 'المدير التنفيذي', photoId: media.leader2 }],
      boardRows: [
        { k: 'عدد أعضاء المجلس', v: '7 أعضاء' }, { k: 'مدة الدورة', v: '4 سنوات (2024 - 2028م)' }, { k: 'عدد اجتماعات 2025م', v: '6 اجتماعات' }, { k: 'الأعضاء المستقلون', v: '3 أعضاء' },
      ],
      assembly: 'الجمعية العمومية', committees: [{ name: 'لجنة المراجعة' }, { name: 'اللجنة التنفيذية' }, { name: 'لجنة الاستثمار' }], ceo: 'المدير التنفيذي',
      units: [{ name: 'إدارة البرامج' }, { name: 'الخدمات الاجتماعية' }, { name: 'تنمية الموارد' }, { name: 'الشؤون المالية' }, { name: 'الموارد البشرية' }, { name: 'الجودة والتميز' }],
      structureImageId: null,
      disclosures: [
        { title: 'التقرير السنوي', text: 'إنجازات الجمعية وأثر برامجها لعام 2025م.', status: 'منشور', docId: docs.annual },
        { title: 'القوائم المالية المدققة', text: 'القوائم المالية لعام 2025م مع تقرير المراجع الخارجي.', status: 'منشور', docId: docs.statements },
        { title: 'الإفصاح عن تعارض المصالح', text: 'لا توجد حالات تعارض مصالح خلال العام.', status: 'محدث', docId: docs.coi },
      ],
      showDocuments: true, showStructure: true, showBoard: true,
    });
    await this.site.savePage(admin, 'partners', {
      partners: [
        { name: 'وزارة الموارد البشرية والتنمية الاجتماعية', url: 'https://hrsd.gov.sa', kind: 'جهة إشرافية' },
        { name: 'المركز الوطني لتنمية القطاع غير الربحي', url: 'https://ncnp.gov.sa', kind: 'جهة إشرافية' },
        { name: 'منصة إحسان', url: 'https://ehsan.sa', kind: 'شريك تقني' }, { name: 'شركة الخير للأغذية (تجريبية)', url: '', kind: 'شريك داعم' },
        { name: 'مستشفى الشفاء (تجريبي)', url: '', kind: 'شريك صحي' }, { name: 'مكتبة المعرفة (تجريبية)', url: '', kind: 'شريك تعليمي' },
      ],
    });

    // ---- البرامج
    type P = Parameters<ContentService['programCreate']>[1];
    const base = (p: Partial<P>): P => ({ services: [], points: [], about: null, audience: null, timing: null, tagline: null, kitDocId: null, activityId: null, imageId: null, icon: 'heart', action: 'draft', ...p } as P);
    const approve = async (id: string, store: Record<string, unknown> | null, featured = false) => this.content.programDecide(admin, id, {
      decision: 'approve', showOnSite: true, featured, note: null as unknown as string,
      store: store ? { on: true, kind: 'project', goal: 0, endDate: null, min: 0, max: 0, presets: [], stop: false, monthly: true, gift: true, revenueAccountId: null, ...store } as never : undefined,
    });
    const orphans = await this.content.programCreate(editor, base({
      slug: 'orphans', name: 'كفالة الأيتام', tagline: 'كن سندًا ليتيم حتى يشتد عوده', icon: 'hands', imageId: media.orphans, activityId: tree.projects.orphans, kitDocId: docs.kit, action: 'submit',
      summary: 'كفالة شاملة للأيتام تغطي احتياجاتهم المعيشية والتعليمية والصحية، مع متابعة اجتماعية ونفسية مستمرة.',
      about: 'يكفل البرنامج الأيتام في أسرهم، ويقدم لهم مخصصًا شهريًا وبرامج تعليمية وصحية وترفيهية.\n\nويتابع الأخصائي الاجتماعي كل يتيم بزيارات دورية وتقارير يطلع عليها الكافل.',
      audience: 'الأيتام السعوديون والمقيمون دون 18 عامًا في مدينة الرياض.', timing: 'على مدار العام',
      services: [{ icon: 'heart', title: 'مخصص شهري', text: 'دعم مالي شهري لاحتياجات اليتيم الأساسية.' }, { icon: 'book', title: 'دعم تعليمي', text: 'رسوم ودروس تقوية وحقيبة مدرسية.' }, { icon: 'health', title: 'رعاية صحية', text: 'تأمين وفحوص دورية وعلاج.' }],
      points: ['تقرير دوري للكافل عن حالة اليتيم', 'كفالة كاملة 400 ريال شهريًا', 'إمكانية الكفالة الجزئية'],
    }));
    await approve(orphans.id, { goal: 480000, monthly: true, gift: true, presets: [100, 200, 400, 1000], revenueAccountId: acc('31102001') }, true);
    const ramadan = await this.content.programCreate(admin, base({
      slug: 'food-basket', name: 'السلة الغذائية', tagline: 'إطعام الأسر المحتاجة طوال العام', icon: 'food', imageId: media.ramadan, activityId: tree.projects.ramadan, action: 'submit',
      summary: 'قسائم غذائية إلكترونية للأسر المحتاجة تُصرف من متاجر شريكة، بكرامة وسهولة.',
      about: 'تُرسل القسيمة إلى جوال الأسرة وتصرفها من المتاجر الشريكة، ويتابع البرنامج أثر كل قسيمة.',
      audience: 'الأسر المسجلة في الجمعية والمستحقة بعد البحث الاجتماعي.', timing: 'شهريًا، وتتضاعف في رمضان',
      services: [{ icon: 'gift', title: 'قسيمة شهرية', text: 'قيمة 300 ريال للأسرة.' }, { icon: 'phone', title: 'صرف إلكتروني', text: 'برسالة على الجوال دون انتظار.' }],
      points: ['قيمة السلة 300 ريال', 'تصل للأسرة خلال 48 ساعة'],
    }));
    await approve(ramadan.id, { goal: 150000, endDate: daysAhead(45), presets: [50, 150, 300, 600], revenueAccountId: acc('31102004') }, true);
    const surgery = await this.content.programCreate(admin, base({
      slug: 'surgeries', name: 'العمليات الجراحية', tagline: 'شفاء يعيد الأمل', icon: 'health', imageId: media.surgery, activityId: tree.projects.surgery, action: 'submit',
      summary: 'المساهمة في تكاليف العمليات الجراحية للمرضى غير القادرين، بالتعاون مع مستشفيات شريكة.',
      audience: 'المرضى المحتاجون بتقرير طبي معتمد.', timing: 'على مدار العام',
      services: [{ icon: 'health', title: 'تكاليف العملية', text: 'سداد مباشر للمستشفى الشريك.' }, { icon: 'users', title: 'متابعة الحالة', text: 'تواصل مع المريض حتى التعافي.' }],
    }));
    await approve(surgery.id, { goal: 90000, stop: true, gift: true, monthly: false });
    const school = await this.content.programCreate(admin, base({
      slug: 'school-bag', name: 'الحقيبة المدرسية', tagline: 'علم ينير المستقبل', icon: 'book', imageId: media.school, activityId: tree.projects.school, action: 'submit',
      summary: 'حقيبة مدرسية متكاملة لأبناء الأسر المحتاجة مع بداية كل فصل دراسي.',
      services: [{ icon: 'book', title: 'أدوات مدرسية', text: 'حقيبة وأدوات وزي مدرسي.' }],
    }));
    await approve(school.id, { goal: 60000, endDate: daysAgo(10), monthly: false });
    const waqf = await this.content.programCreate(admin, base({
      slug: 'waqf', name: 'وقف سنابل الخير', tagline: 'صدقة جارية يبقى أجرها', icon: 'building', imageId: media.waqf, action: 'submit',
      summary: 'وقف استثماري يُحفظ أصله ويُصرف ريعه على برامج الجمعية، لاستدامة العطاء.',
      about: 'يُستثمر مال الوقف في أصول عقارية آمنة، ويُصرف ريعه على كفالة الأيتام والأسر المحتاجة.',
      points: ['الأصل محفوظ لا يُصرف', 'الريع للبرامج', 'تقرير سنوي عن أداء الوقف'],
    }));
    await approve(waqf.id, { kind: 'waqf', goal: 2000000, presets: [100, 500, 1000, 5000], monthly: true, gift: true });
    // برنامج بانتظار الاعتماد ومسودة لدى المحرر
    await this.content.programCreate(editor, base({
      slug: 'widows', name: 'تمكين الأرامل', tagline: 'من الرعاية إلى الإنتاج', icon: 'users', imageId: media.widows, activityId: tree.projects.widows, action: 'submit',
      summary: 'تدريب الأرامل على مهن منزلية مدرة للدخل، مع تمويل صغير لبدء المشروع.',
    }));
    await this.content.programCreate(editor, base({ slug: 'winter', name: 'كسوة الشتاء', icon: 'gift', summary: 'كسوة شتوية للأسر المحتاجة قبل دخول البرد.', action: 'draft' }));

    // ---- الأخبار
    const news = [
      { t: 'توقيع شراكة مع مستشفى الشفاء لإجراء 50 عملية جراحية', s: 'وقعت الجمعية اتفاقية شراكة لتغطية تكاليف 50 عملية جراحية للمرضى غير القادرين خلال العام.', i: media.n3, d: 2 },
      { t: 'إطلاق القسائم الغذائية الإلكترونية لـ 800 أسرة', s: 'أطلقت الجمعية القسائم الغذائية الإلكترونية التي تصل إلى جوال الأسرة وتُصرف من متاجر شريكة.', i: media.n2, d: 6 },
      { t: 'حفل تكريم الأيتام المتفوقين دراسيًا', s: 'كرمت الجمعية 45 يتيمًا من المتفوقين دراسيًا بحضور الكافلين وأولياء الأمور.', i: media.n1, d: 12 },
      { t: 'نشر التقرير السنوي والقوائم المالية لعام 2025م', s: 'نشرت الجمعية تقريرها السنوي وقوائمها المالية المدققة في صفحة الحوكمة والشفافية.', i: media.n4, d: 20 },
      { t: 'تخريج الدفعة الثالثة من برنامج تمكين الأرامل', s: 'تخرجت 30 مستفيدة من برنامج التدريب المهني وبدأت 12 منهن مشاريعهن المنزلية.', i: null, d: 34 },
    ];
    for (const n of news) {
      await this.content.newsCreate(admin, {
        title: n.t, summary: n.s, body: `${n.s}\n\nوأكد المدير التنفيذي أن هذه الخطوة تأتي ضمن خطة الجمعية لتوسيع أثرها وتعزيز الشفافية مع المتبرعين والشركاء.\n\nوتدعو الجمعية أهل الخير إلى المساهمة في برامجها عبر المتجر الإلكتروني في موقعها.`,
        imageId: n.i, newsDate: daysAgo(n.d), ticker: n.d < 15, action: 'publish',
      });
    }
    await this.content.newsCreate(editor, {
      title: 'زيارة ميدانية لفريق التطوع إلى دار المسنين', summary: 'زار فريق التطوع في الجمعية دار المسنين وقدم برنامجًا ترفيهيًا وهدايا.',
      body: 'زار فريق التطوع في الجمعية دار المسنين وقدم برنامجًا ترفيهيًا وهدايا رمزية للنزلاء، بمشاركة 25 متطوعًا ومتطوعة.', imageId: null, newsDate: daysAgo(1), ticker: true, action: 'submit',
    });
    const returned = await this.content.newsCreate(editor, {
      title: 'ورشة عمل عن الاستدامة المالية', summary: 'نظمت الجمعية ورشة عمل عن الاستدامة المالية للجمعيات الأهلية.',
      body: 'نظمت الجمعية ورشة عمل عن الاستدامة المالية للجمعيات الأهلية بمشاركة عدد من الخبراء.', imageId: null, newsDate: daysAgo(3), ticker: false, action: 'submit',
    });
    await this.content.newsDecide(admin, returned.id, { decision: 'return', note: 'أضف صورة من الورشة وأسماء المتحدثين' });

    // ---- التبرعات عبر المتجر (البيئة التجريبية): إيصالات وسندات قبض حقيقية
    const give = async (programId: string | null, amount: number, name: string | null, phone: string, extra: Record<string, unknown> = {}, ago = 0) => {
      const r = await this.store.donate('demo', { programId, amount, name: name ?? undefined, phone, ...extra } as never, origin);
      const info = await this.store.payInfo('demo', r.token);
      await this.store.sandboxPay('demo', r.token, info.gatewayId!);
      if (ago) {
        const at = new Date(Date.now() - ago * 86400000 - (amount % 7) * 3600000);
        const res = await this.db.query('UPDATE web_donations SET paid_at = $2, created_at = $2 WHERE pay_token = $1 RETURNING voucher_id', [r.token, at]);
        const d = (Array.isArray(res[0]) ? res[0] : res)[0];
        if (d?.voucher_id) await this.db.query('UPDATE acc_vouchers SET voucher_date = $2 WHERE id = $1 AND status = $3', [d.voucher_id, new Date(at.getTime() + 3 * 3600000).toISOString().slice(0, 10), 'draft']);
      }
      return r.token;
    };
    await give(orphans.id, 400, 'عبدالرحمن السبيعي', '0551234501', { monthly: true }, 24);
    await give(orphans.id, 1000, 'شركة البناء الحديث', '0551234502', {}, 21);
    await give(ramadan.id, 300, null, '0551234503', {}, 18);
    await give(ramadan.id, 600, 'أم خالد', '0551234504', { gift: { to: 'والدتي الغالية', phone: '0551234599', message: 'تبرعت عنك بسلة غذائية، جعلها الله في ميزان حسناتك' } }, 15);
    await give(surgery.id, 2500, 'محمد العنزي', '0551234505', {}, 13);
    await give(null, 150, null, '0551234506', {}, 11);
    await give(waqf.id, 5000, 'فاعل خير', '0551234507', {}, 9);
    await give(orphans.id, 200, 'سارة الدوسري', '0551234508', { monthly: true }, 7);
    await give(ramadan.id, 150, 'فهد الحربي', '0551234509', {}, 5);
    await give(waqf.id, 1000, 'نوف المطيري', '0551234510', { gift: { to: 'روح والدي رحمه الله', message: 'وقف عن روحك يا أبي' } }, 4);
    await give(surgery.id, 500, null, '0551234511', {}, 3);
    await give(null, 100, 'زائر كريم', '0551234512', { monthly: true }, 2);
    await give(orphans.id, 400, 'خالد الشمري', '0551234513', {}, 1);
    await give(ramadan.id, 300, 'هند القحطاني', '0551234514', {}, 0);
    // تبرع بدأه زائر ولم يكمل الدفع
    await this.store.donate('demo', { programId: orphans.id, amount: 250, name: 'زائر', phone: '0551234515' } as never, origin);
    // اشتراك شهري حل موعده: يُصدر له رابط سداد
    await this.db.query(`UPDATE web_subscriptions SET next_due = $2 WHERE organization_id = $1 AND donor_phone = '0551234501'`, [org, daysAgo(1)]);
    await this.store.processDue(org);

    // ---- رسائل الزوار
    const msgs = [
      { name: 'ريم العتيبي', phone: '0561112233', topic: 'inquiry', body: 'كيف أسجل أسرتي في برنامج السلة الغذائية؟ وما المستندات المطلوبة؟' },
      { name: 'شركة النماء (تجريبية)', email: 'csr@namaa-demo.sa', topic: 'partnership', body: 'نرغب في رعاية برنامج الحقيبة المدرسية للعام القادم ضمن المسؤولية الاجتماعية للشركة.' },
      { name: 'عبدالله', phone: '0562223344', topic: 'suggestion', body: 'أقترح إضافة خيار التبرع عبر Apple Pay في المتجر لتسهيل التبرع.' },
      { name: 'متبرع', phone: '0563334455', topic: 'complaint', body: 'لم يصلني إيصال التبرع على الجوال بعد الدفع، أرجو المساعدة.' },
    ];
    for (const m of msgs) await this.site.contact('demo', m as never);
    const [done] = await this.db.query(`SELECT id FROM web_messages WHERE organization_id = $1 AND topic = 'complaint'`, [org]);
    if (done) await this.site.updateMessage(admin, done.id, { status: 'closed', replyNote: 'تواصلنا مع المتبرع وأرسلنا له رابط الإيصال، والإيصال متاح دائمًا من صفحة الإيصال.' });
  }
}
