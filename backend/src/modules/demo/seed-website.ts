import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BookingService } from '../website/booking.service';
import { ContentService } from '../website/content.service';
import { FormsService } from '../website/forms.service';
import { GuidesService } from '../website/guides.service';
import { LeadsService } from '../website/leads.service';
import { DemoTeam, daysAhead } from './demo-context';

/**
 * الموقع والعملاء المحتملون: طلبات من نماذج الموقع (استشارة، حاسبة، تقييم)، وحجز جلسة تشخيص،
 * ودليل في المكتبة، ومتابعة الفريق للطلبات. كل شيء عبر خدمات الوحدة نفسها كما يصل من الموقع.
 */
@Injectable()
export class WebsiteSeed {
  constructor(
    private readonly db: DataSource,
    private readonly content: ContentService,
    private readonly forms: FormsService,
    private readonly leads: LeadsService,
    private readonly booking: BookingService,
    private readonly guides: GuidesService,
  ) {}

  async run(team: DemoTeam) {
    const org = team.admin.organizationId;
    const { admin, caseManager } = team;
    await this.content.saveSection(admin, 'notify', { emails: [], confirmVisitor: false });
    await this.content.saveSection(admin, 'booking', {
      weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, from: '08:00', to: '20:00' })), minNoticeHours: 1, horizonDays: 21,
    });
    await this.content.services(org);

    const v = (name: string, email: string, orgName: string) => ({ name, email: team.email(email), orgName, phone: '0500000000', orgType: 'جمعية صحية', page: '/contact' });
    await this.forms.submit(org, { ...v('أحمد الزهراني', 'lead-1', 'جمعية السكري الخيرية'), source: 'consultation', serviceSlug: 'impact', message: 'نرغب في قياس أثر برنامج التوعية بالسكري لتقديمه للمانحين' });
    await this.forms.submit(org, { ...v('نورة العتيبي', 'lead-2', 'جمعية البر'), source: 'calculator', calculator: { budget: 3_000_000, cost: 1500, efficiency: 10 } });
    await this.forms.submit(org, { ...v('فهد القرني', 'lead-3', 'مؤسسة رعاية الطفولة'), source: 'assessment', assessment: { answers: [2, 1, 0, 1, 2, 0, 1] } });

    const slots = await this.booking.slots(org);
    const start = slots.days[2]?.slots[0] ?? slots.days[0]?.slots[0];
    if (start) await this.booking.book(org, { ...v('ليلى الشمري', 'lead-4', 'جمعية أصدقاء المرضى'), startsAt: start, topic: 'تنويع مصادر التمويل' });

    await this.guides.create(admin, { slug: 'impact-basics', title: 'دليل قياس الأثر للجمعيات', summary: 'خطوات عملية لبناء مؤشرات الأثر وخط الأساس.', serviceSlug: 'impact', pages: 24, published: false });

    // متابعة الفريق: إسناد ومتابعة وتغيير حالة
    const [first]: { id: string }[] = await this.db.query('SELECT id FROM rw_leads WHERE organization_id = $1 ORDER BY lead_no LIMIT 1', [org]);
    if (first) {
      await this.leads.update(admin, first.id, { assignedTo: caseManager.id, nextActionOn: daysAhead(2), note: 'تواصلنا هاتفيًا، وسنرسل عرضًا مبدئيًا' });
      await this.leads.update(admin, first.id, { status: 'contacted' });
    }
  }
}
