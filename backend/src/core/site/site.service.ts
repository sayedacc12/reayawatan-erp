import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../auth/decorators';
import { PlatformSetting } from '../subscriptions/entities';
import { MailService } from '../mail/mail.service';
import { templates } from '../mail/mail-templates';
import { InquiryDto, InquiryUpdateDto, SiteContactDto } from './site.dto';
import { INQUIRY_STATUSES, InquiryStatus, SITE_SERVICES, SiteInquiry } from './site.entity';

export interface SiteContact {
  whatsapp: string | null;
  whatsappMessage: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}

/** القيم الأولية حتى يحدد مدير المنصة بيانات التواصل الفعلية */
const DEFAULT_CONTACT: SiteContact = {
  whatsapp: null,
  whatsappMessage: 'السلام عليكم، أرغب في معرفة المزيد عن خدمات سنابل للجمعيات',
  email: 'info@sanabelerp.com',
  phone: null,
  address: 'المملكة العربية السعودية',
};
const CONTACT_KEY = 'site_contact';
const KIND_LABELS: Record<string, string> = { consultation: 'استشارة مجانية', quote: 'طلب عرض سعر', demo: 'عرض تجريبي لمنصة سنابل' };

/** الصفحة التعريفية للمنصة: بيانات التواصل وطلبات الخدمات الواردة */
@Injectable()
export class SiteService {
  private readonly logger = new Logger('Site');

  constructor(
    private readonly mail: MailService,
    @InjectRepository(SiteInquiry) private readonly inquiries: Repository<SiteInquiry>,
    @InjectRepository(PlatformSetting) private readonly settings: Repository<PlatformSetting>,
  ) {}

  async contact(): Promise<SiteContact> {
    const row = await this.settings.findOne({ where: { key: CONTACT_KEY } });
    return { ...DEFAULT_CONTACT, ...(row?.value as Partial<SiteContact> | undefined) };
  }

  async saveContact(dto: SiteContactDto): Promise<SiteContact> {
    const value: SiteContact = {
      whatsapp: dto.whatsapp?.replace(/^\+/, '') ?? null,
      whatsappMessage: dto.whatsappMessage ?? null,
      email: dto.email?.toLowerCase() ?? null,
      phone: dto.phone ?? null,
      address: dto.address ?? null,
    };
    await this.settings.save({ key: CONTACT_KEY, value: value as unknown as Record<string, unknown> });
    return value;
  }

  /** يحفظ الطلب ويعيد رقمه. الطلب الذي يملأ الحقل المخفي يُقبل ظاهريًا ولا يُحفظ */
  async submit(dto: InquiryDto): Promise<{ number: number | null }> {
    if (dto.website) return { number: null };
    const row = await this.inquiries.save(this.inquiries.create({
      kind: dto.kind,
      serviceCode: dto.kind === 'demo' ? dto.serviceCode ?? 'digital' : dto.serviceCode ?? null,
      orgName: dto.orgName,
      contactName: dto.contactName,
      jobTitle: dto.jobTitle ?? null,
      phone: dto.phone,
      email: dto.email?.toLowerCase() ?? null,
      city: dto.city ?? null,
      message: dto.message ?? null,
      status: 'new',
      log: [],
    }));
    await this.notify(row).catch((e) => this.logger.error(`Inquiry mail failed: ${(e as Error).message}`));
    return { number: row.number };
  }

  /** إشعار الإدارة بالطلب الجديد، وتأكيد الاستلام لمقدمه إن كتب بريده */
  private async notify(row: SiteInquiry) {
    const kindLabel = KIND_LABELS[row.kind] ?? row.kind;
    const serviceLabel = SITE_SERVICES.find((x) => x.code === row.serviceCode)?.name ?? null;
    await this.mail.queue({
      to: await this.mail.adminRecipients(), kind: 'inquiry_admin', event: 'inquiries',
      ...templates.inquiryAdmin({ ...row, kindLabel, serviceLabel }),
    });
    if (row.email) {
      await this.mail.queue({ to: row.email, kind: 'inquiry_ack', event: 'inquiryAck', ...templates.inquiryAck({ number: row.number, contactName: row.contactName, kindLabel }) });
    }
  }

  async list(status?: string) {
    const where = status && (INQUIRY_STATUSES as readonly string[]).includes(status) ? { status: status as InquiryStatus } : {};
    const [rows, counts] = await Promise.all([
      this.inquiries.find({ where, order: { createdAt: 'DESC' }, take: 500 }),
      this.inquiries.createQueryBuilder('i').select('i.status', 'status').addSelect('COUNT(*)::int', 'count').groupBy('i.status').getRawMany<{ status: string; count: number }>(),
    ]);
    return {
      rows,
      counts: Object.fromEntries(counts.map((c) => [c.status, c.count])),
      services: SITE_SERVICES,
    };
  }

  async update(id: string, dto: InquiryUpdateDto, user: AuthUser) {
    const row = await this.inquiries.findOne({ where: { id } });
    if (!row) throw new NotFoundException('الطلب غير موجود');
    const at = new Date().toISOString();
    if (dto.status && dto.status !== row.status) {
      row.status = dto.status;
      row.log = [...row.log, { at, by: user.fullName, action: 'status', status: dto.status, note: dto.note }];
    } else if (dto.note) {
      row.log = [...row.log, { at, by: user.fullName, action: 'note', note: dto.note }];
    }
    return this.inquiries.save(row);
  }
}
