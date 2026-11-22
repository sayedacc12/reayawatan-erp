import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { EntityManager, In } from 'typeorm';
import { Permission, Role, User } from '../../core/entities';
import { ACC_PERMISSIONS as A } from '../accounting/accounting.manifest';
import { QUALITY_PERMISSIONS as Q } from '../quality/quality.manifest';
import { PARTNERSHIP_PERMISSIONS as PT } from '../partnerships/partnerships.manifest';
import { WEBSITE_PERMISSIONS as W } from '../website/website.manifest';
import { ALL_PERMISSIONS, DemoTeam, SeedTarget, actorOf } from './demo-context';

/**
 * فريق المنشأة التجريبية: الموظفون بأدوارهم. تُسجَّل باسمهم عمليات بقية الأنظمة.
 * (رعاية وطن: حُذفت أنظمة المستفيدين والتمويل والمشاريع، فبقيت الأدوار الإدارية والمالية والجودة والموقع.)
 */
@Injectable()
export class TeamSeed {
  async setup(em: EntityManager, orgId: string, password: string, target: SeedTarget): Promise<{ team: DemoTeam; accounts: { role: string; email: string }[] }> {
    const hash = await bcrypt.hash(password, 12);
    const perms = (codes: string[]) => em.find(Permission, { where: { code: In(codes) } });
    const role = async (name: string, description: string, codes: string[]) =>
      em.save(em.create(Role, { organizationId: orgId, name, description, permissions: await perms(codes) }));

    const roleCodes = {
      researcher: [W.read, W.leadsRead],
      quality: [Q.read, Q.context, Q.documents, Q.reviewDocs, Q.audits, Q.ncr, Q.closeNcr, Q.risks, Q.objectives, Q.reviews, Q.feedback, Q.reports],
      caseManager: [W.read, W.leadsRead, W.leadsManage, W.bookings, Q.read, Q.feedback],
      fundraiser: [W.read, W.leadsRead, W.leadsManage, PT.read, PT.partners, PT.evaluate, PT.contracts, PT.reports],
      finance: [A.read, A.receipts, A.payments, A.approveVouchers, A.entries, A.post, A.cancel, A.partners, A.banks, A.reports,
        // شؤون الموظفين تتبع الإدارة المالية والإدارية: خطوة «شؤون الموظفين» في طلبات الخدمة الذاتية
        'hr.requests.read', 'hr.requests.approve', 'hr.separations.approve',
        // المالية تعتمد الحسابات البنكية للموردين (فصل المهام عن مسجّلها في المشتريات)
        'procurement.dashboard.read', 'procurement.suppliers.read', 'procurement.banks.approve', 'procurement.reports.read'],
      projectsManager: [W.read, W.leadsRead, W.bookings],
    };
    const researcherRole = await role('محلل أعمال', 'يطلع على طلبات العملاء ونتائج التقييم', roleCodes.researcher);
    const qualityRole = await role('مراجع الجودة', 'يدير نظام الجودة ISO 9001: الوثائق والمراجعات وعدم المطابقة والشكاوى', roleCodes.quality);
    const managerRole = await role('مدير الاستشارات', 'يتابع العملاء المحتملين ومواعيد جلسات التشخيص', roleCodes.caseManager);
    const fundraiserRole = await role('مسؤول تطوير الأعمال', 'يتابع العملاء المحتملين ويدير الشراكات وعقودها', roleCodes.fundraiser);
    const financeRole = await role('المدير المالي', 'ينفذ سندات القبض والصرف ويتابع القيود', roleCodes.finance);
    const projectsRole = await role('مدير المشاريع', 'يدير مشاريع العملاء وجلسات التشخيص', roleCodes.projectsManager);

    const user = (fullName: string, email: string, extra: Partial<User>) => em.save(em.create(User, {
      organizationId: orgId, fullName, email, passwordHash: hash, ...extra,
    }));
    const E = target.email;
    const admin = target.admin ?? await user('مدير المنشأة التجريبية', E('admin'), { isSuperadmin: true });
    const researcher = await user('منى عبد الرحمن', E('researcher'), { roles: [researcherRole] });
    const caseManager = await user('خالد إبراهيم', E('manager'), { roles: [managerRole] });
    const quality = await user('هبة سمير', E('quality'), { roles: [qualityRole] });
    const fundraiser = await user('سارة القحطاني', E('fundraising'), { roles: [fundraiserRole] });
    const finance = await user('عبدالله الشهري', E('finance'), { roles: [financeRole] });
    const projectsManager = await user('ريم الدوسري', E('projects'), { roles: [projectsRole] });

    const actor = (u: { id: string; fullName: string; email: string }, codes: string[], sa = false) => actorOf(orgId, u, codes, sa, target.slug);
    const team: DemoTeam = {
      slug: target.slug, email: E,
      admin: actor(admin, ALL_PERMISSIONS, true),
      researcher: actor(researcher, roleCodes.researcher),
      caseManager: actor(caseManager, roleCodes.caseManager),
      quality: actor(quality, roleCodes.quality),
      fundraiser: actor(fundraiser, roleCodes.fundraiser),
      finance: actor(finance, roleCodes.finance),
      projectsManager: actor(projectsManager, roleCodes.projectsManager),
      roles: {
        researcher: researcherRole.id, caseManager: managerRole.id, quality: qualityRole.id,
        fundraiser: fundraiserRole.id, finance: financeRole.id, projectsManager: projectsRole.id,
      },
    };
    return {
      team,
      accounts: [
        ...(target.admin ? [] : [{ role: 'مدير المنشأة (كل الصلاحيات)', email: admin.email }]),
        { role: 'محلل أعمال', email: researcher.email },
        { role: 'مدير الاستشارات', email: caseManager.email },
        { role: 'مراجع الجودة', email: quality.email },
        { role: 'مسؤول تطوير الأعمال', email: fundraiser.email },
        { role: 'المدير المالي', email: finance.email },
        { role: 'مدير المشاريع', email: projectsManager.email },
      ],
    };
  }
}
