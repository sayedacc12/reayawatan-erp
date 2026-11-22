import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { COMPANY_TEAM } from '../../core/company-team';
import { findCompany } from '../../core/company';
import { User } from '../../core/entities';
import { OrganizationStarter } from '../starter/starter.entity';
import { HrEmployee, HrJob, HrUnit } from './entities/hr.entity';
import { HrCore } from './hr-core.service';

const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

/**
 * ملفات فريق الشركة في الموارد البشرية (company-team.ts): لكل عضو له حساب دخول ملف «متعاون» مربوط بحسابه،
 * بوظيفته في «الإدارة العامة»، بلا رقم هوية ولا أجر حتى يكملها شؤون الموظفين، ومعفى من البصمة.
 * مرة واحدة (organization_starters = hr.team)، ولا يمس موظفًا موجودًا مربوطًا بالحساب نفسه.
 * يعمل بعد اكتمال التشغيل، بعد أن تكون حسابات الفريق وتكليفاته قد أُنشئت.
 */
@Injectable()
export class TeamFilesService implements OnApplicationBootstrap {
  private readonly logger = new Logger('TeamFiles');

  constructor(private readonly db: DataSource, private readonly core: HrCore) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    setTimeout(() => { this.run().catch((e) => this.logger.error(`Team HR files not applied: ${(e as Error).message}`)); }, 3000).unref();
  }

  async run(): Promise<number | null> {
    return this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(424246)');
      const org = await findCompany(em);
      if (!org) return null;
      if (!(await em.exists(OrganizationStarter, { where: { organizationId: org.id, moduleCode: 'core.team' } }))) return null;
      if (await em.exists(OrganizationStarter, { where: { organizationId: org.id, moduleCode: 'hr.team' } })) return null;
      const director = await em.findOne(User, { where: { organizationId: org.id, isSuperadmin: true }, order: { createdAt: 'ASC' } });
      if (!director) return null;
      const users = await em.find(User, { where: { organizationId: org.id, email: In(COMPANY_TEAM.map((m) => m.email.toLowerCase())) } });
      const byEmail = new Map(users.map((u) => [u.email, u]));

      // الإدارة العامة: الوحدة العليا الموجودة، أو تُنشأ
      let top = await em.findOne(HrUnit, { where: { organizationId: org.id, level: 0 }, order: { sortOrder: 'ASC', createdAt: 'ASC' } });
      top ??= await em.save(em.create(HrUnit, { organizationId: org.id, parentId: null, level: 0, name: 'الإدارة العامة' }));

      let added = 0;
      for (const m of COMPANY_TEAM) {
        const user = byEmail.get(m.email.toLowerCase());
        if (!user) continue;
        if (await em.exists(HrEmployee, { where: { organizationId: org.id, userId: user.id } })) continue;
        let job = await em.findOne(HrJob, { where: { organizationId: org.id, title: m.title } });
        if (!job) {
          const no = await this.core.nextNo(em, org.id, 'nextJobNo');
          job = await em.save(em.create(HrJob, {
            organizationId: org.id, code: `JOB-${String(no).padStart(3, '0')}`, title: m.title, unitId: top.id,
            qualityCode: `QF-HR-JD-${String(no).padStart(3, '0')}`, responsibilities: m.roles.map((r) => `مهام دور «${r}» (بالتكليف)`),
          }));
        }
        const no = await this.core.nextNo(em, org.id, 'nextEmployeeNo');
        const t = today();
        await em.save(em.create(HrEmployee, {
          organizationId: org.id, userId: user.id, employeeNo: no, fullName: m.fullName, nationalId: null,
          nationality: 'لم تُحدد', isSaudi: true, gender: 'male', email: user.email,
          unitId: top.id, jobId: job.id, hireDate: t, contractStart: t,
          employmentKind: 'contractor', payBasis: 'monthly', payRate: 0, basicSalary: 0, allowances: [],
          qiwaStatus: 'not_documented', attendanceExempt: true,
        }));
        added++;
      }
      await em.save(em.create(OrganizationStarter, {
        organizationId: org.id, moduleCode: 'hr.team', status: 'applied', appliedBy: 'النظام (فريق الشركة)', appliedById: director.id,
        results: [{ key: 'employees', label: 'ملفات فريق الشركة (متعاونون)', added, note: 'رقم الهوية والجنسية والأجر تُستكمل من ملف كل متعاون' }],
      }));
      this.logger.log(`Team HR files added: ${added}`);
      return added;
    });
  }
}
