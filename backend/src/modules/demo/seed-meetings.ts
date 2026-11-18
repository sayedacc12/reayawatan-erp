import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MtgAttendee, MtgMeeting } from '../meetings/entities/meetings.entity';
import { MeetingsCore } from '../meetings/meetings-core.service';
import { MeetingsService } from '../meetings/meetings.service';
import { MinutesService } from '../meetings/minutes.service';
import { daysAgo, daysAhead } from './demo-context';
import { CommsTeam } from './seed-comms';

const pdf = (name: string) => ({
  buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'), size: 64, originalname: Buffer.from(name, 'utf8').toString('latin1'),
} as Express.Multer.File);

/**
 * الاجتماعات واللجان في الجمعية التجريبية: الجمعية العمومية (أعضاؤها من نظام العضوية)، مجلس الإدارة، لجنة تنفيذية،
 * وفريق عمل إدارة الحالات. واجتماعات في كل المراحل: محضر معتمد بالتوقيع الإلكتروني تحولت توصياته إلى مهام،
 * محضر بانتظار التوقيع، محضر اعتُمد بالنسخة الموقعة يدويًا، اجتماع انتهى ويُحرر محضره، اجتماع منعقد الآن،
 * دعوة لاجتماع الجمعية العمومية، وخطة بانتظار الاعتماد.
 */
@Injectable()
export class MeetingsSeed {
  constructor(
    private readonly db: DataSource,
    private readonly core: MeetingsCore,
    private readonly meetings: MeetingsService,
    private readonly minutes: MinutesService,
  ) {}

  async run(t: CommsTeam, password: string, origin: string) {
    const org = t.admin.organizationId;
    const s = await this.core.settings(org);
    await this.db.query(`UPDATE mtg_settings SET minutes_footer = $2 WHERE organization_id = $1`, [org, 'حُرر هذا المحضر في نظام سنابل، ويُتحقق من صحة توقيعاته برمز التحقق المطبوع عليه.']);
    void s;
    const assembly = await this.core.assemblyMembers(org);
    const [unit] = await this.db.query(`SELECT id FROM hr_units WHERE organization_id = $1 AND name = 'إدارة البرامج والخدمات'`, [org]);
    const u = (a: { id: string }, role: string, title: string | null = null, voting = true) => ({ type: 'user' as const, userId: a.id, role: role as 'member', title, voting });
    const mem = (i: number, role: string, title: string | null = null) => assembly[i] ? [{ type: 'member' as const, memberId: assembly[i].id, role: role as 'member', title, voting: true }] : [];

    // ---- الجهات
    const ga = await this.meetings.saveBody(t.admin, null, {
      kind: 'general_assembly', code: 'GA', name: 'الجمعية العمومية', description: 'أعلى سلطة في الجمعية: تعتمد القوائم المالية وتنتخب مجلس الإدارة', quorumPercent: 50,
      isConfidential: false, isActive: true, secretaryUserId: t.admin.id,
      members: assembly.filter((m) => m.voting).slice(0, 12).map((m, i) => ({ type: 'member' as const, memberId: m.id, role: i === 0 ? 'chair' as const : 'member' as const, title: null, voting: true })),
    });
    const board = await this.meetings.saveBody(t.admin, null, {
      kind: 'board', code: 'BRD', name: 'مجلس الإدارة', description: 'مجلس الإدارة للدورة الحالية (أربع سنوات)', quorumPercent: 60, isConfidential: false, isActive: true,
      secretaryUserId: t.admin.id, termStart: daysAgo(400), termEnd: daysAhead(1060),
      members: [
        ...mem(0, 'chair', 'رئيس مجلس الإدارة'), ...mem(1, 'vice', 'نائب الرئيس'), ...mem(2, 'member', 'المشرف المالي'),
        { type: 'external', name: 'د. نورة بنت فهد العتيبي', role: 'member', title: 'عضو مستقل', mobile: '0559000111', voting: true },
        u(t.finance, 'member', 'عضو مجلس (المدير المالي)'), u(t.admin, 'secretary', 'المدير التنفيذي ـ أمين السر', false),
      ],
    });
    const exec = await this.meetings.saveBody(t.admin, null, {
      kind: 'committee', code: 'EXC', name: 'اللجنة التنفيذية', description: 'تتابع تنفيذ قرارات المجلس والخطة التشغيلية شهريًا', quorumPercent: 50, isConfidential: false, isActive: true,
      approverUserId: t.admin.id, secretaryUserId: t.quality.id,
      members: [u(t.finance, 'chair', 'المدير المالي'), u(t.caseManager, 'member', 'مدير البرامج'), u(t.projectsManager, 'member', 'مدير المشاريع'), u(t.fundraiser, 'member', 'تنمية الموارد'), u(t.quality, 'secretary', 'الجودة')],
    });
    const audit = await this.meetings.saveBody(t.admin, null, {
      kind: 'committee', code: 'ARC', name: 'لجنة المراجعة', description: 'لجنة المراجعة المنبثقة من المجلس (اجتماعاتها سرية)', quorumPercent: 60, isConfidential: true, isActive: true,
      secretaryUserId: t.finance.id, members: [...mem(2, 'chair', 'رئيس اللجنة'), { type: 'external', name: 'أ. ماجد السبيعي', role: 'member', title: 'محاسب قانوني', voting: true }, u(t.finance, 'secretary', null, false)],
    });
    void audit;
    const team = await this.meetings.saveBody(t.caseManager, null, {
      kind: 'team', code: 'TM-CASE', name: 'فريق إدارة الحالات', description: 'الاجتماع الأسبوعي لفريق البحث الاجتماعي وإدارة الحالات', quorumPercent: 50, isConfidential: false, isActive: true,
      unitId: unit?.id ?? null, secretaryUserId: t.caseManager.id,
      members: [u(t.caseManager, 'chair', 'مدير البرامج'), u(t.researcher, 'member', 'باحثة اجتماعية'), u(t.quality, 'member', 'الجودة')],
    });

    // ---- أدوات مساعدة
    const item = async (actor: typeof t.admin, id: string, i: number, discussion: string, recs: { kind?: 'recommendation' | 'decision'; text: string; owner?: string; supporters?: string[]; due?: string; votes?: [number, number, number] }[]) => {
      const m = await this.meetings.get(actor, id);
      const it = m.agenda[i];
      await this.meetings.discussion(actor, id, it.id, { discussion, status: 'discussed' });
      for (const r of recs) {
        await this.meetings.addRec(actor, id, it.id, {
          kind: r.kind ?? 'recommendation', text: r.text, ownerUserId: r.owner ?? null, supporterUserIds: r.supporters ?? [], dueDate: r.due ?? null,
          votesFor: r.votes?.[0] ?? null, votesAgainst: r.votes?.[1] ?? null, votesAbstain: r.votes?.[2] ?? null,
        });
      }
    };
    const presentAll = async (actor: typeof t.admin, id: string, except: string[] = [], excused: string[] = []) => {
      const m = await this.meetings.get(actor, id);
      await this.meetings.attendance(actor, id, { rows: m.attendees.map((a) => ({ id: a.id, attendance: excused.includes(a.name) ? 'excused' : except.includes(a.name) ? 'absent' : 'present' })) });
    };
    /** يرحّل الاجتماع لتاريخ سابق قبل إصدار محضره (بيانات تجريبية فقط) */
    const backdate = async (id: string, days: number) => {
      await this.db.getRepository(MtgMeeting).update({ id }, { meetingDate: daysAgo(days), startedAt: new Date(Date.now() - days * 86400000), endedAt: new Date(Date.now() - days * 86400000 + 2 * 3600000) });
    };
    const signAll = async (id: string, skip: string[] = [], abstain: Record<string, string> = {}) => {
      const m = await this.meetings.get(t.admin, id);
      for (const a of m.attendees.filter((x) => x.signStatus === 'pending' && !skip.includes(x.name))) {
        const reason = abstain[a.name] ?? null;
        if (a.userId) {
          const actor = Object.values(t).find((x) => x.id === a.userId)!;
          await this.minutes.sign(actor, id, { decision: reason ? 'abstain' : 'sign', password, reason }, '127.0.0.1');
        } else {
          const link = await this.minutes.signLink(t.admin, id, a.id, origin);
          await this.minutes.publicSign(link.url.split('/').pop()!, { decision: reason ? 'abstain' : 'sign', code: link.code, reason }, '127.0.0.1');
        }
      }
    };

    // ---- 1) اجتماع مجلس الإدارة الأول: محضر معتمد إلكترونيًا وتحولت توصياته إلى مهام
    const b1 = await this.meetings.create(t.admin, {
      bodyId: board.id, title: 'الاجتماع الدوري الثالث لمجلس الإدارة', meetingType: 'ordinary', mode: 'hybrid', location: 'قاعة الاجتماعات بمقر الجمعية',
      onlineLink: 'https://meet.example.org/board-3', meetingDate: daysAhead(1), startTime: '18:00', endTime: '20:00',
      objectives: 'مراجعة أداء الربع الثالث واعتماد الخطة التشغيلية المعدلة', agenda: ['المصادقة على محضر الاجتماع السابق', 'تقرير الأداء المالي للربع الثالث', 'الخطة التشغيلية المعدلة', 'ما يستجد من أعمال'],
    });
    await this.meetings.submit(t.admin, b1.id);
    await this.meetings.start(t.admin, b1.id);
    await presentAll(t.admin, b1.id, [], ['د. نورة بنت فهد العتيبي']);
    await this.meetings.minutesText(t.admin, b1.id, {
      opening: 'افتتح رئيس المجلس الاجتماع بالترحيب بالأعضاء، وبعد التحقق من اكتمال النصاب بدأ المجلس مناقشة جدول الأعمال.',
      closing: 'اختُتم الاجتماع في تمام الساعة الثامنة مساءً، وشكر الرئيس الأعضاء وفريق العمل.',
    });
    await item(t.admin, b1.id, 0, 'اطلع المجلس على محضر الاجتماع السابق ولم ترد عليه ملاحظات.', [{ kind: 'decision', text: 'المصادقة على محضر الاجتماع الدوري الثاني', votes: [5, 0, 0] }]);
    await item(t.admin, b1.id, 1, 'عرض المدير المالي تقرير الأداء المالي، وبلغت الإيرادات 82% من المستهدف، وناقش المجلس ارتفاع المصروفات الإدارية.', [
      { text: 'إعداد خطة لخفض المصروفات الإدارية إلى 15% من إجمالي المصروفات وعرضها في الاجتماع القادم', owner: t.finance.id, supporters: [t.quality.id], due: daysAhead(25), votes: [5, 0, 0] },
      { text: 'تفعيل حملة لتحصيل الوعود المتأخرة لدى الداعمين', owner: t.fundraiser.id, supporters: [t.finance.id], due: daysAhead(15) },
    ]);
    await item(t.admin, b1.id, 2, 'ناقش المجلس الخطة التشغيلية المعدلة وأضاف مؤشرًا لرضا المستفيدين.', [
      { kind: 'decision', text: 'اعتماد الخطة التشغيلية المعدلة مع إضافة مؤشر رضا المستفيدين', owner: t.caseManager.id, due: daysAhead(30), votes: [4, 0, 1] },
    ]);
    await item(t.admin, b1.id, 3, 'لا يوجد.', []);
    await this.meetings.end(t.admin, b1.id);
    await backdate(b1.id, 20);
    await this.minutes.issue(t.admin, b1.id);
    await signAll(b1.id);

    // ---- 2) اجتماع اللجنة التنفيذية: المحضر بانتظار التوقيع (وقّع بعضهم، وامتنع واحد)
    const e1 = await this.meetings.create(t.quality, {
      bodyId: exec.id, title: 'اجتماع اللجنة التنفيذية لشهر الحالي', meetingType: 'ordinary', mode: 'in_person', location: 'مكتب المدير المالي', meetingDate: daysAhead(1), startTime: '10:00', endTime: '11:30',
      agenda: ['متابعة قرارات المجلس', 'جاهزية مشروع الحقيبة المدرسية'],
    });
    await this.meetings.submit(t.quality, e1.id);
    await this.meetings.decide(t.admin, e1.id, { decision: 'approve', note: 'معتمد' });
    await this.meetings.start(t.quality, e1.id);
    await presentAll(t.quality, e1.id);
    await item(t.quality, e1.id, 0, 'استعرضت اللجنة حالة قرارات المجلس، وتبين تأخر خطة خفض المصروفات.', [
      { text: 'متابعة أسبوعية لخطة خفض المصروفات الإدارية مع المدير المالي', owner: t.quality.id, due: daysAhead(20) },
    ]);
    await item(t.quality, e1.id, 1, 'أفاد مدير المشاريع بجاهزية 70% من الحقائب، والباقي ينتظر وصول الشحنة.', [
      { text: 'استكمال توريد الحقائب المتبقية قبل بداية العام الدراسي', owner: t.projectsManager.id, supporters: [t.fundraiser.id], due: daysAhead(12) },
    ]);
    await this.meetings.end(t.quality, e1.id);
    await backdate(e1.id, 3);
    await this.minutes.issue(t.quality, e1.id);
    await signAll(e1.id, [t.caseManager.fullName, t.finance.fullName], { [t.fundraiser.fullName]: 'لم أحضر مناقشة البند الثاني كاملًا' });

    // ---- 3) لجنة تنفيذية سابقة: اعتُمد محضرها برفع النسخة الموقعة بالتوقيع الحي
    const e0 = await this.meetings.create(t.quality, {
      bodyId: exec.id, title: 'اجتماع اللجنة التنفيذية للشهر الماضي', meetingType: 'ordinary', mode: 'in_person', location: 'قاعة الاجتماعات', meetingDate: daysAhead(1), startTime: '10:00',
      agenda: ['اعتماد جدول توزيع السلال الغذائية'],
    });
    await this.meetings.submit(t.quality, e0.id);
    await this.meetings.decide(t.admin, e0.id, { decision: 'approve', note: null });
    await this.meetings.start(t.quality, e0.id);
    await presentAll(t.quality, e0.id, [t.fundraiser.fullName]);
    await item(t.quality, e0.id, 0, 'اعتمدت اللجنة جدول التوزيع على ثلاث دفعات.', [{ kind: 'decision', text: 'اعتماد جدول توزيع السلال على ثلاث دفعات', owner: t.projectsManager.id, due: daysAgo(5) }]);
    await this.meetings.end(t.quality, e0.id);
    await backdate(e0.id, 35);
    await this.minutes.issue(t.quality, e0.id);
    await this.minutes.wetCopy(t.quality, e0.id, pdf('محضر اللجنة التنفيذية موقع.pdf'), 'وقّع الأعضاء على النسخة الورقية في الاجتماع');

    // ---- 4) فريق إدارة الحالات: انتهى الاجتماع ويُحرر المحضر
    const tm = await this.meetings.create(t.caseManager, {
      bodyId: team.id, title: 'الاجتماع الأسبوعي لفريق إدارة الحالات', meetingType: 'ordinary', mode: 'in_person', location: 'مكتب إدارة البرامج', meetingDate: daysAhead(1), startTime: '09:00', endTime: '10:00',
      agenda: ['الحالات العاجلة', 'الزيارات الميدانية للأسبوع القادم'],
    });
    await this.meetings.submit(t.caseManager, tm.id);
    await this.meetings.start(t.caseManager, tm.id);
    await presentAll(t.caseManager, tm.id);
    await item(t.caseManager, tm.id, 0, 'نوقشت ثلاث حالات عاجلة، منها حالة عملية جراحية.', [{ text: 'رفع حالة العملية الجراحية للجنة الحالات هذا الأسبوع', owner: t.researcher.id, due: daysAhead(3) }]);
    await this.meetings.end(t.caseManager, tm.id);
    await backdate(tm.id, 1);

    // ---- 5) اجتماع فريق منعقد الآن (تأكيد الحضور من الأعضاء)
    const now = await this.meetings.create(t.caseManager, {
      bodyId: team.id, title: 'متابعة جودة ملفات المستفيدين', meetingType: 'extraordinary', mode: 'online', onlineLink: 'https://meet.example.org/case-team', meetingDate: daysAhead(0), startTime: '13:00',
      agenda: ['نتائج تدقيق الجودة على ملفات المستفيدين'],
    });
    await this.meetings.submit(t.caseManager, now.id);
    await this.meetings.start(t.caseManager, now.id);
    await this.meetings.checkIn(t.researcher, now.id);

    // ---- 6) دعوة لاجتماع الجمعية العمومية العادي (بعضهم أكد الحضور)
    const g1 = await this.meetings.create(t.admin, {
      bodyId: ga.id, title: 'اجتماع الجمعية العمومية العادي السنوي', meetingType: 'ordinary', mode: 'in_person', location: 'قاعة الملك فهد الثقافية', meetingDate: daysAhead(21), startTime: '19:00', endTime: '21:00',
      objectives: 'اعتماد القوائم المالية المدققة وتقرير مجلس الإدارة وتعيين المراجع الخارجي',
      agenda: ['تقرير مجلس الإدارة عن العام المالي', 'القوائم المالية المدققة وتقرير المراجع الخارجي', 'تعيين المراجع الخارجي للعام القادم وتحديد أتعابه', 'إبراء ذمة أعضاء مجلس الإدارة'],
    });
    await this.meetings.submit(t.admin, g1.id);

    // ---- 7) خطة اجتماع للجنة التنفيذية بانتظار اعتماد المدير التنفيذي
    const e2 = await this.meetings.create(t.quality, {
      bodyId: exec.id, title: 'اجتماع طارئ لمناقشة ملاحظات المراجع الداخلي', meetingType: 'extraordinary', mode: 'in_person', location: 'قاعة الاجتماعات', meetingDate: daysAhead(4), startTime: '11:00',
      agenda: ['ملاحظات المراجع الداخلي على دورة الصرف', 'خطة المعالجة'],
    });
    await this.meetings.submit(t.quality, e2.id);

    // ---- 8) اجتماع مجلس قادم معتمد (المدير المالي أكد حضوره)
    const b2 = await this.meetings.create(t.admin, {
      bodyId: board.id, title: 'الاجتماع الدوري الرابع لمجلس الإدارة', meetingType: 'ordinary', mode: 'hybrid', location: 'قاعة الاجتماعات بمقر الجمعية', onlineLink: 'https://meet.example.org/board-4',
      meetingDate: daysAhead(9), startTime: '18:00', agenda: ['متابعة قرارات الاجتماع السابق', 'خطة خفض المصروفات الإدارية', 'الاستعداد لاجتماع الجمعية العمومية'],
    });
    await this.meetings.submit(t.admin, b2.id);
    await this.meetings.rsvp(t.finance, b2.id, { rsvp: 'accepted', note: null });
    await this.db.getRepository(MtgAttendee).createQueryBuilder().update().set({ rsvp: 'accepted', rsvpAt: new Date() })
      .where('meeting_id = :id AND type = :t AND role IN (:...r)', { id: b2.id, t: 'member', r: ['chair', 'vice'] }).execute();
  }
}
