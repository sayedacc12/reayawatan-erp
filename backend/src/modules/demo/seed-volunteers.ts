import { Injectable } from '@nestjs/common';
import { EventsService } from '../volunteers/events.service';
import { VolCore } from '../volunteers/vol-core.service';
import { VolunteersService } from '../volunteers/volunteers.service';
import { DEFAULT_CHARTER, DEFAULT_POLICY } from '../volunteers/volunteers-defaults';
import { DemoTeam, daysAgo, daysAhead } from './demo-context';

/**
 * التطوع في الجمعية التجريبية: اللائحة والميثاق معتمدان، متطوعون بأنواع ومجالات مختلفة (منهم طلبات تسجيل جديدة)،
 * فعاليات ميدانية وعن بعد في كل المراحل (مغلقة بتقريرها واستبانتها، معتمدة قادمة، قيد الاعتماد، معادة، مسودة)،
 * شهادات ساعات وشكر، عقود موقعة وغير موقعة، وشكاوى ومقترحات واستفسارات. كل العمليات عبر خدمات الوحدة نفسها.
 */
@Injectable()
export class VolunteersSeed {
  constructor(private readonly core: VolCore, private readonly people: VolunteersService, private readonly events: EventsService) {}

  async run(team: DemoTeam) {
    const { admin } = team;
    const org = admin.organizationId;
    await this.core.settings(org);
    await this.core.saveDocument(admin, 'policy', { ...DEFAULT_POLICY, effectiveDate: daysAgo(200), note: 'اعتماد مجلس الإدارة للائحة التطوع' });
    await this.core.saveDocument(admin, 'charter', { ...DEFAULT_CHARTER, effectiveDate: daysAgo(200), note: 'اعتماد ميثاق التطوع' });
    await this.core.saveSettings(admin, 'events', {
      eventFields: (await this.core.settings(org)).eventFields,
      eventStages: [{ name: 'مراجعة مسؤول التطوع', roleId: team.roles.projectsManager }, { name: 'اعتماد المدير التنفيذي', roleId: null }],
    });
    await this.core.saveSettings(admin, 'certificates', {
      certificateTemplates: { ...(await this.core.getSettings(admin)).certificateTemplates, signatoryName: 'عبدالله بن سعد العتيبي' },
    });

    // ---- المتطوعون
    type V = { name: string; nid: string; mobile: string; gender: 'male' | 'female'; city: string; type: string; fields: string[]; skills?: string; q?: string };
    const list: V[] = [
      { name: 'فيصل عبدالرحمن القحطاني', nid: '1098765401', mobile: '0551000001', gender: 'male', city: 'الرياض', type: 'field', fields: ['relief', 'social'], skills: 'قيادة فرق، إسعافات أولية', q: 'بكالوريوس إدارة أعمال' },
      { name: 'نورة محمد الشهري', nid: '1098765402', mobile: '0551000002', gender: 'female', city: 'الرياض', type: 'remote', fields: ['media', 'tech'], skills: 'تصميم جرافيك، كتابة محتوى', q: 'بكالوريوس تصميم' },
      { name: 'خالد سعيد الغامدي', nid: '1098765403', mobile: '0551000003', gender: 'male', city: 'الرياض', type: 'professional', fields: ['health'], skills: 'طبيب عام', q: 'بكالوريوس طب وجراحة' },
      { name: 'ريم عبدالله الدوسري', nid: '1098765404', mobile: '0551000004', gender: 'female', city: 'الرياض', type: 'field', fields: ['education', 'social'], skills: 'تدريس، أنشطة أطفال', q: 'بكالوريوس رياض أطفال' },
      { name: 'عبدالعزيز ناصر المطيري', nid: '1098765405', mobile: '0551000005', gender: 'male', city: 'الخرج', type: 'seasonal', fields: ['relief'], skills: 'قيادة مركبات نقل' },
      { name: 'سارة فهد الزهراني', nid: '1098765406', mobile: '0551000006', gender: 'female', city: 'الرياض', type: 'administrative', fields: ['admin'], skills: 'تنظيم ملفات، إدخال بيانات', q: 'دبلوم سكرتارية' },
      { name: 'محمد علي العسيري', nid: '1098765407', mobile: '0551000007', gender: 'male', city: 'الرياض', type: 'remote', fields: ['tech'], skills: 'تطوير مواقع، دعم فني', q: 'بكالوريوس علوم حاسب' },
      { name: 'هيا سلمان الحربي', nid: '1098765408', mobile: '0551000008', gender: 'female', city: 'الرياض', type: 'field', fields: ['social', 'health'], skills: 'تواصل مع كبار السن' },
      { name: 'تركي حمد السبيعي', nid: '1098765409', mobile: '0551000009', gender: 'male', city: 'الدرعية', type: 'field', fields: ['environment', 'relief'], skills: 'تنظيم ميداني' },
      { name: 'لمى أحمد القرني', nid: '1098765410', mobile: '0551000010', gender: 'female', city: 'الرياض', type: 'professional', fields: ['education'], skills: 'إرشاد أسري', q: 'ماجستير إرشاد نفسي' },
      { name: 'يوسف إبراهيم البلوي', nid: '2098765411', mobile: '0551000011', gender: 'male', city: 'الرياض', type: 'field', fields: ['relief'], skills: 'تحميل وتوزيع' },
      { name: 'عبير خالد الرشيد', nid: '1098765412', mobile: '0551000012', gender: 'female', city: 'الرياض', type: 'remote', fields: ['media'], skills: 'تصوير، مونتاج' },
    ];
    const ids: Record<string, string> = {};
    for (const v of list) {
      const r = await this.people.create(admin, org, {
        fullName: v.name, nationalId: v.nid, mobile: v.mobile, gender: v.gender, city: v.city, typeCode: v.type, fieldCodes: v.fields, skills: v.skills ?? null,
        qualification: v.q ?? null, availability: v.type === 'remote' ? ['عن بعد', 'مسائي'] : ['صباحي', 'عطلة نهاية الأسبوع'],
        answers: { experience: 'نعم', hours_month: 12, emergency_contact: '0559999999' },
      });
      ids[v.nid] = r.id;
    }
    const vid = (n: number) => ids[`${n === 11 ? '2' : '1'}0987654${String(n).padStart(2, '0')}`];
    // طلبات تسجيل جديدة من الصفحة العامة (بانتظار القبول)، وطلب مرفوض
    const pub = async (fullName: string, nationalId: string, mobile: string, gender: 'male' | 'female', fields: string[]) =>
      this.people.register(org, { fullName, nationalId, mobile, gender, city: 'الرياض', typeCode: 'field', fieldCodes: fields, acceptCharter: true, answers: { experience: 'لا' } });
    await pub('عمر سليمان الشمري', '1098765420', '0551000020', 'male', ['social']);
    await pub('أسماء عبدالله الجهني', '1098765421', '0551000021', 'female', ['education', 'media']);
    await pub('بدر فهد العنزي', '1098765422', '0551000022', 'male', ['relief']);
    const rejected = (await this.people.list(admin, { search: '1098765422' }))[0];
    await this.people.setStatus(admin, rejected.id as string, { status: 'rejected', note: 'العمر أقل من الحد الأدنى في لائحة التطوع' });
    await this.people.setStatus(admin, vid(11), { status: 'inactive', note: 'اعتذر عن التطوع لسفره خارج المملكة' });

    // ---- الفعاليات
    const base = { volunteersNeeded: 0, targetBeneficiaries: 0, budget: 0, answers: { partners: '', needs_transport: false } };
    const approve = async (id: string) => {
      await this.events.submit(admin, id);
      await this.events.decide(admin, id, { decision: 'approve' });
      await this.events.decide(admin, id, { decision: 'approve' });
    };

    // 1) فعالية ميدانية مغلقة: توزيع سلال رمضان
    const ramadan = (await this.events.create(admin, {
      ...base, title: 'توزيع السلال الغذائية على الأسر المستفيدة', kind: 'field', categoryCode: 'distribution', fieldCodes: ['relief', 'social'],
      description: 'تجهيز السلال الغذائية في مستودع الجمعية وتوزيعها على الأسر المسجلة في حي النسيم.', objectives: 'إيصال 300 سلة غذائية للأسر المستحقة خلال يومين.',
      location: 'مستودع الجمعية، حي النسيم، الرياض', startDate: daysAgo(40), endDate: daysAgo(39), startTime: '08:00', endTime: '14:00', plannedHours: 6,
      volunteersNeeded: 10, targetBeneficiaries: 300, budget: 4500, supervisorName: 'فيصل عبدالرحمن القحطاني', answers: { partners: 'بنك الطعام السعودي', needs_transport: true },
    })).id;
    await approve(ramadan);
    await this.events.addParticipants(admin, ramadan, { volunteerIds: [1, 4, 5, 6, 8, 9].map(vid), role: 'توزيع' });
    let d = await this.events.detail(admin, ramadan);
    // قائد الفريق حضر اليومين (12 ساعة)، ومتطوع اعتذر فسُجل غيابه
    const leader = vid(1);
    const absent = vid(9);
    await this.events.attendance(admin, ramadan, {
      rows: d.participants.map((p) => ({
        id: p.id, status: p.volunteerId === absent ? 'absent' : 'attended', hours: p.volunteerId === absent ? 0 : p.volunteerId === leader ? 12 : 6,
        rating: p.volunteerId === absent ? null : p.volunteerId === leader ? 5 : 4, role: p.volunteerId === leader ? 'قائد الفريق' : p.role,
        note: p.volunteerId === absent ? 'اعتذر قبل يوم' : null,
      })),
    });
    await this.events.close(admin, ramadan, {
      actualBeneficiaries: 312, closureSummary: 'وُزعت 312 سلة غذائية على الأسر المستحقة خلال يومين بمشاركة 5 متطوعين وفريق الجمعية.',
      achievements: 'تجاوز المستهدف بـ 12 سلة بعد تبرع إضافي من الشريك.', challenges: 'ازدحام في نقطة التوزيع في اليوم الأول.',
      recommendations: 'تقسيم التوزيع على فترات زمنية حسب الأحياء، وتوفير مظلات للانتظار.', actualCost: 4200,
      closureAnswers: { goals_met: 'تحققت بالكامل', media_coverage: 'https://x.com/sanabel/status/1' }, openSurvey: true,
    });

    // 2) فعالية عن بعد مغلقة: ورشة تصميم
    const online = (await this.events.create(admin, {
      ...base, title: 'ورشة تصميم محتوى حملة كفالة الأيتام', kind: 'online', categoryCode: 'campaign', fieldCodes: ['media', 'tech'],
      description: 'تصميم بطاقات ومقاطع قصيرة لحملة كفالة الأيتام عبر منصة الاجتماعات.', objectives: 'إنتاج 12 تصميمًا و3 مقاطع قصيرة للحملة.',
      platform: 'Microsoft Teams', onlineLink: 'https://teams.microsoft.com/l/meetup-join/demo', startDate: daysAgo(20), endDate: daysAgo(18), startTime: '19:00', endTime: '22:00',
      plannedHours: 9, volunteersNeeded: 4, targetBeneficiaries: 0, supervisorName: 'نورة محمد الشهري',
    })).id;
    await approve(online);
    await this.events.addParticipants(admin, online, { volunteerIds: [2, 7, 12].map(vid), role: 'مصمم' });
    d = await this.events.detail(admin, online);
    await this.events.attendance(admin, online, { rows: d.participants.map((p) => ({ id: p.id, status: 'attended', hours: 9, rating: 5, role: p.role, note: null })) });
    await this.events.close(admin, online, {
      actualBeneficiaries: 0, closureSummary: 'أُنتجت 14 تصميمًا و3 مقاطع قصيرة نُشرت في حسابات الجمعية ضمن حملة كفالة الأيتام.',
      achievements: 'وصلت المقاطع إلى أكثر من 40 ألف مشاهدة.', challenges: null, recommendations: 'إشراك المتطوعين في التخطيط للحملة من بدايتها.',
      closureAnswers: { goals_met: 'تحققت بالكامل' }, openSurvey: true,
    });

    // ردود الاستبانات من المتطوعين والمستفيدين
    const token1 = (await this.events.detail(admin, ramadan)).surveyToken!;
    const token2 = (await this.events.detail(admin, online)).surveyToken!;
    const volAns = (a: number[], again: 'yes' | 'no', notes = '') => ({ organization: a[0], clarity: a[1], support: a[2], benefit: a[3], again, notes });
    const benAns = (a: number[], notes = '') => ({ service: a[0], treatment: a[1], timing: a[2], overall: a[3], notes });
    for (const [name, a, again, n] of [
      ['فيصل القحطاني', [5, 5, 5, 5], 'yes', 'تنظيم ممتاز'], ['ريم الدوسري', [4, 4, 5, 5], 'yes', ''], ['عبدالعزيز المطيري', [3, 4, 4, 4], 'yes', 'نحتاج تنظيمًا أفضل لنقطة التوزيع'],
      ['سارة الزهراني', [4, 5, 4, 4], 'yes', ''],
    ] as [string, number[], 'yes' | 'no', string][]) await this.events.answerSurvey(token1, { audience: 'volunteer', respondentName: name, answers: volAns(a, again, n) });
    for (const [a, n] of [[[5, 5, 4, 5], 'جزاكم الله خيرًا'], [[4, 5, 3, 4], 'الانتظار كان طويلًا'], [[5, 5, 5, 5], ''], [[4, 4, 4, 4], ''], [[5, 5, 4, 5], 'شكرًا للمتطوعين']] as [number[], string][]) {
      await this.events.answerSurvey(token1, { audience: 'beneficiary', respondentName: null, answers: benAns(a, n) });
    }
    for (const [name, a] of [['نورة الشهري', [5, 5, 4, 5]], ['محمد العسيري', [4, 4, 4, 5]]] as [string, number[]][]) {
      await this.events.answerSurvey(token2, { audience: 'volunteer', respondentName: name, answers: volAns(a, 'yes') });
    }

    // 3) فعالية ميدانية معتمدة قادمة (اليوم العالمي للتطوع)
    const upcoming = (await this.events.create(admin, {
      ...base, title: 'حملة اليوم العالمي للتطوع: زيارة دار المسنين', kind: 'field', categoryCode: 'community', fieldCodes: ['social', 'health'],
      description: 'زيارة دار رعاية المسنين وتقديم فحوصات صحية وأنشطة ترفيهية.', objectives: 'إدخال السرور على 60 مسنًا وتقديم فحص صحي أولي لهم.',
      location: 'دار الرعاية الاجتماعية للمسنين، الرياض', startDate: daysAhead(12), endDate: daysAhead(12), startTime: '09:00', endTime: '13:00', plannedHours: 4,
      volunteersNeeded: 15, targetBeneficiaries: 60, budget: 2500, supervisorName: 'هيا سلمان الحربي', answers: { partners: 'وزارة الموارد البشرية والتنمية الاجتماعية', needs_transport: true },
    })).id;
    await approve(upcoming);
    await this.events.addParticipants(admin, upcoming, { volunteerIds: [3, 8, 10, 4].map(vid), role: null });

    // 4) فعالية عن بعد قيد الاعتماد (في المرحلة الثانية)
    const inReview = (await this.events.create(admin, {
      ...base, title: 'دورة تدريبية: مهارات البحث عن عمل للمستفيدين', kind: 'online', categoryCode: 'training', fieldCodes: ['education'],
      description: 'دورة من 3 لقاءات عن بعد لأبناء الأسر المستفيدة في كتابة السيرة الذاتية والمقابلات.', objectives: 'تأهيل 40 شابًا وشابة لسوق العمل.',
      platform: 'Zoom', onlineLink: null, startDate: daysAhead(25), endDate: daysAhead(27), startTime: '20:00', endTime: '21:30', plannedHours: 4.5,
      volunteersNeeded: 3, targetBeneficiaries: 40, supervisorName: 'لمى أحمد القرني',
    })).id;
    await this.events.submit(admin, inReview);
    await this.events.decide(admin, inReview, { decision: 'approve', note: 'مناسبة لخطة التمكين' });

    // 5) فعالية معادة للتعديل
    const returned = (await this.events.create(admin, {
      ...base, title: 'حملة تشجير حي الملقا', kind: 'field', categoryCode: 'community', fieldCodes: ['environment'],
      description: 'زراعة 200 شتلة في الحدائق العامة.', location: 'حدائق حي الملقا، الرياض', startDate: daysAhead(40), endDate: daysAhead(40), plannedHours: 5,
      volunteersNeeded: 25, targetBeneficiaries: 0, budget: 8000, supervisorName: 'تركي حمد السبيعي',
    })).id;
    await this.events.submit(admin, returned);
    await this.events.decide(admin, returned, { decision: 'return', note: 'أرفق موافقة الأمانة على الموقع، وراجع الميزانية لتشمل أدوات السلامة' });

    // 6) مسودة
    await this.events.create(admin, {
      ...base, title: 'برنامج القراءة الصيفي للأطفال', kind: 'field', categoryCode: 'awareness', fieldCodes: ['education'],
      description: 'جلسات قراءة أسبوعية لأطفال الأسر المستفيدة في مقر الجمعية.', location: 'مقر الجمعية', startDate: daysAhead(60), endDate: daysAhead(90), plannedHours: 2,
      volunteersNeeded: 6, targetBeneficiaries: 50,
    });

    // ---- الشهادات
    await this.people.issueCertificate(admin, { volunteerId: vid(1), kind: 'hours', periodFrom: daysAgo(365), periodTo: daysAgo(1) });
    await this.people.issueCertificate(admin, { volunteerId: vid(1), kind: 'thanks', eventId: ramadan });
    await this.people.issueCertificate(admin, { volunteerId: vid(2), kind: 'thanks', eventId: online });
    await this.people.issueCertificate(admin, { volunteerId: vid(4), kind: 'hours', eventId: ramadan });

    // ---- العقود: موقّع إلكترونيًا، موقّع ورقيًا، وبانتظار التوقيع
    const c1 = await this.people.issueContract(admin, { volunteerId: vid(1), startDate: daysAgo(60), endDate: daysAhead(305) });
    await this.people.signContract(c1.signToken, 'فيصل عبدالرحمن القحطاني');
    const c2 = await this.people.issueContract(admin, { volunteerId: vid(3), startDate: daysAgo(30), endDate: daysAhead(335) });
    await this.people.contractAction(admin, c2.id, 'paper');
    await this.people.issueContract(admin, { volunteerId: vid(2), startDate: daysAgo(5), endDate: daysAhead(360) });
    await this.people.issueContract(admin, { volunteerId: vid(8), startDate: daysAgo(2), endDate: daysAhead(180) });

    // ---- الشكاوى والمقترحات والاستفسارات
    const t1 = await this.people.createTicket(org, {
      kind: 'complaint', senderName: 'عبدالعزيز ناصر المطيري', senderMobile: '0551000005', senderType: 'volunteer', volunteerId: vid(5), eventId: ramadan,
      subject: 'تأخر وصول وسيلة النقل', body: 'تأخرت حافلة نقل المتطوعين ساعة كاملة في اليوم الأول من التوزيع.',
    }, 'staff');
    await this.people.replyTicket(admin, t1.id, { reply: 'نعتذر عن التأخير، وتم التعاقد مع مقدم نقل بديل للفعاليات القادمة. شكرًا لملاحظتك.', status: 'closed' });
    await this.people.createTicket(org, {
      kind: 'suggestion', senderName: 'نورة محمد الشهري', senderEmail: 'noura@example.com', senderType: 'volunteer',
      subject: 'مجموعة تواصل للمتطوعين عن بعد', body: 'أقترح إنشاء مساحة تواصل للمتطوعين عن بعد لتبادل الخبرات والتصاميم.',
    }, 'public');
    const t3 = await this.people.createTicket(org, {
      kind: 'inquiry', senderName: 'أم محمد', senderMobile: '0552223334', senderType: 'beneficiary',
      subject: 'موعد التوزيع القادم', body: 'متى موعد توزيع السلال القادم في حي النسيم؟',
    }, 'public');
    await this.people.replyTicket(admin, t3.id, { reply: 'سنعلن الموعد عبر رسالة نصية للأسر المسجلة قبل أسبوع من التوزيع.', status: 'in_progress' });
  }
}
