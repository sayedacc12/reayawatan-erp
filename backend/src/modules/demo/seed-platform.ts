import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../core/auth/decorators';
import { Organization } from '../../core/entities';
import { ApplicationsService } from '../../core/subscriptions/applications.service';
import { ContractsService } from '../../core/subscriptions/contracts.service';
import { SubscriptionApplication } from '../../core/subscriptions/entities';
import { AdminApplicationDto } from '../../core/subscriptions/subscriptions.dto';
import { DEMO_EMAIL, daysAgo } from './demo-context';

/** ملف PDF صغير يمثل مستند الترخيص في البيانات التجريبية */
function licensePdf(title: string): Express.Multer.File {
  const text = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`;
  const buffer = Buffer.from(text, 'latin1');
  return { buffer, size: buffer.length, originalname: Buffer.from(`${title}.pdf`, 'utf8').toString('latin1'), mimetype: 'application/pdf' } as Express.Multer.File;
}

const contacts = (director: string, board: string, n: number) => ({
  directorName: director, directorPhone: `05011122${30 + n}`, directorEmail: `director${n}@example.sa`,
  boardName: board, boardPosition: 'رئيس مجلس الإدارة', boardPhone: `05022233${40 + n}`, boardEmail: `board${n}@example.sa`,
});

/**
 * إدارة المنصة: البيانات الرئيسية للشركة التجريبية وعقدها الموقّع إلكترونيًا،
 * وطلبا اشتراك من جمعيتين أخريين (قيد المراجعة، ومعاد للاستكمال) لتجربة دورة الاعتماد.
 */
@Injectable()
export class PlatformSeed {
  constructor(
    private readonly db: DataSource,
    private readonly applications: ApplicationsService,
    private readonly contracts: ContractsService,
  ) {}

  async run(org: Organization, platform: AuthUser, origin: string) {
    const licenseNumber = '1234';
    await this.applications.submit({
      organizationId: org.id, orgName: org.name, proposedSlug: org.slug, city: 'الرياض', orgEmail: 'info@sanabel-demo.sa', orgPhone: '0112345678',
      licenseNumber, licenseStartDate: daysAgo(900), ...contacts('أحمد بن صالح المالكي', 'سليمان بن عبدالله الراشد', 1),
    } as AdminApplicationDto, licensePdf('ترخيص جمعية سنابل الخير'), platform);

    // اشتراك سنوي بعقد إلكتروني: يُنشأ من الشروط الحالية ويُرسل ثم توقعه الشركة
    await this.db.getRepository(Organization).update({ id: org.id }, { subscriptionPrice: '12000', billingCycle: 'annual' });
    const draft = await this.contracts.createForOrganization(org.id, platform);
    await this.contracts.send(draft.id, platform, origin);
    const [{ token }] = await this.db.query('SELECT token FROM subscription_contracts WHERE id = $1', [draft.id]);
    await this.contracts.sign(token, { signerName: 'أحمد بن صالح المالكي', signerTitle: 'المدير التنفيذي', licenseNumber, agree: true }, '127.0.0.1');

    // طلبات اشتراك لجمعيات أخرى
    const pending = [
      { email: DEMO_EMAIL('apply-alnoor'), orgName: 'جمعية النور الخيرية', slug: 'alnoor', city: 'جدة', license: '5521', director: 'ماجد بن علي الغامدي', board: 'عبدالعزيز بن حمد الزهراني', n: 2 },
      { email: DEMO_EMAIL('apply-albaraka'), orgName: 'جمعية البركة لرعاية الأسر', slug: 'albaraka', city: 'الدمام', license: '7310', director: 'منيرة بنت سعد الدوسري', board: 'خالد بن فهد العنزي', n: 3, returnNote: 'مستند الترخيص المرفق غير واضح، نرجو رفع نسخة أوضح' },
    ];
    for (const a of pending) {
      if (await this.db.getRepository(SubscriptionApplication).exists({ where: { adminEmail: a.email } })) continue;
      if (await this.db.getRepository(Organization).exists({ where: { slug: a.slug } })) continue;
      const created = await this.applications.submit({
        orgName: a.orgName, proposedSlug: a.slug, city: a.city, orgEmail: `info${a.n}@example.sa`, orgPhone: `01${a.n}2345678`,
        licenseNumber: a.license, licenseStartDate: daysAgo(400 * a.n), ...contacts(a.director, a.board, a.n),
        adminFullName: a.director, adminEmail: a.email, adminPassword: 'Demo-Apply-2026',
      } as AdminApplicationDto, licensePdf(`ترخيص ${a.orgName}`));
      if (a.returnNote) await this.applications.returnForCompletion(created.id, a.returnNote, platform);
    }
  }
}
