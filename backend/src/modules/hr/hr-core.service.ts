import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { HrAllowanceType, HrPolicyVersion, HrSettings, HrUnit } from './entities/hr.entity';
import { PolicyDto, SettingsDto } from './hr.dto';
import { defaultPolicy, HrPolicy, normalizePolicy } from './hr-policy';

/** اليوم بتوقيت الرياض */
export const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

const DEFAULT_TYPES = [
  { code: 'basic', name: 'الراتب الأساسي', defaultKind: 'fixed' as const, defaultValue: 0, isSystem: true, sortOrder: 0 },
  { code: 'housing', name: 'بدل السكن', defaultKind: 'percent' as const, defaultValue: 25, isSystem: false, sortOrder: 1 },
  { code: 'transport', name: 'بدل النقل', defaultKind: 'percent' as const, defaultValue: 10, isSystem: false, sortOrder: 2 },
];

/** الإعدادات واللائحة وبنود الراتب: مشتركة بين خدمات الموارد البشرية */
@Injectable()
export class HrCore {
  constructor(private readonly db: DataSource) {}

  async settings(org: string, em: EntityManager = this.db.manager) {
    const repo = em.getRepository(HrSettings);
    let s = await repo.findOne({ where: { organizationId: org } });
    if (!s) {
      await repo.createQueryBuilder().insert().values({ organizationId: org }).orIgnore().execute();
      s = await repo.findOneOrFail({ where: { organizationId: org } });
    }
    return s;
  }

  /** اللائحة السارية (الإصدار الأحدث)، أو القيم الافتراضية إن لم تُعتمد لائحة بعد */
  async policy(org: string): Promise<HrPolicy> {
    const v = await this.db.getRepository(HrPolicyVersion).findOne({ where: { organizationId: org }, order: { version: 'DESC' } });
    if (!v) return defaultPolicy();
    // نكمل أي حقل جديد أُضيف للائحة بعد حفظ هذا الإصدار
    const d = defaultPolicy();
    return { ...d, ...v.policy, payroll: { ...d.payroll, ...(v.policy.payroll ?? {}) } };
  }

  async getPolicy(actor: OrgUser) {
    const rows = await this.db.getRepository(HrPolicyVersion).find({ where: { organizationId: actor.organizationId }, order: { version: 'DESC' } });
    return {
      policy: await this.policy(actor.organizationId),
      defaults: defaultPolicy(),
      current: rows[0] ? { version: rows[0].version, effectiveDate: rows[0].effectiveDate, approvedByName: rows[0].approvedByName, note: rows[0].note, createdAt: rows[0].createdAt } : null,
      history: rows.map((r) => ({ version: r.version, effectiveDate: r.effectiveDate, approvedByName: r.approvedByName, note: r.note, createdAt: r.createdAt })),
    };
  }

  async savePolicy(actor: OrgUser, dto: PolicyDto) {
    const policy = normalizePolicy(dto.policy);
    const repo = this.db.getRepository(HrPolicyVersion);
    const last = await repo.findOne({ where: { organizationId: actor.organizationId }, order: { version: 'DESC' } });
    await repo.save(repo.create({
      organizationId: actor.organizationId, version: (last?.version ?? 0) + 1, policy, note: dto.note ?? null,
      effectiveDate: dto.effectiveDate, approvedByName: actor.fullName,
    }));
    return this.getPolicy(actor);
  }

  async getSettings(actor: OrgUser) {
    const s = await this.settings(actor.organizationId);
    return { structureLevels: s.structureLevels };
  }

  /** مستويات الهيكل: إضافة أو إعادة تسمية بحرية، والحذف من الآخر فقط إذا لم تُستخدم */
  async saveSettings(actor: OrgUser, dto: SettingsDto) {
    const levels = dto.structureLevels.map((l) => l.trim()).filter(Boolean);
    if (!levels.length) throw new BadRequestException('أضف مستوى واحدًا على الأقل للهيكل');
    if (new Set(levels).size !== levels.length) throw new BadRequestException('أسماء المستويات مكررة');
    const [{ max }] = await this.db.query('SELECT MAX(level)::int AS max FROM hr_units WHERE organization_id = $1', [actor.organizationId]);
    if (max !== null && max >= levels.length) {
      throw new BadRequestException(`يوجد في الهيكل وحدات على المستوى "${(await this.settings(actor.organizationId)).structureLevels[max] ?? max + 1}"، فلا يمكن حذفه`);
    }
    const s = await this.settings(actor.organizationId);
    s.structureLevels = levels;
    await this.db.getRepository(HrSettings).save(s);
    return this.getSettings(actor);
  }

  /** رقم تسلسلي (موظف أو وظيفة) داخل معاملة، مع قفل صف الإعدادات */
  async nextNo(em: EntityManager, org: string, field: 'nextEmployeeNo' | 'nextJobNo') {
    await this.settings(org, em);
    const s = await em.getRepository(HrSettings).createQueryBuilder('s').setLock('pessimistic_write').where('s.organization_id = :org', { org }).getOneOrFail();
    const n = s[field];
    await em.getRepository(HrSettings).update({ organizationId: org }, { [field]: n + 1 });
    return n;
  }

  async unit(org: string, id: string) {
    const u = await this.db.getRepository(HrUnit).findOne({ where: { id, organizationId: org } });
    if (!u) throw new NotFoundException('الوحدة التنظيمية غير موجودة');
    return u;
  }

  /** ينشئ البنود الافتراضية، وأي رمز مستخدم في المراتب أو الموظفين وليس له بند */
  async allowanceTypes(org: string, em: EntityManager = this.db.manager) {
    const repo = em.getRepository(HrAllowanceType);
    const rows = await repo.find({ where: { organizationId: org }, order: { sortOrder: 'ASC', name: 'ASC' } });
    const have = new Set(rows.map((r) => r.code));
    const missing = new Map<string, string>();
    DEFAULT_TYPES.forEach((d) => !have.has(d.code) && missing.set(d.code, d.name));
    const used: { code: string; name: string }[] = await em.query(
      `SELECT DISTINCT x->>'code' AS code, x->>'name' AS name FROM (
         SELECT jsonb_array_elements(allowances) AS x FROM hr_employees WHERE organization_id = $1
         UNION ALL SELECT jsonb_array_elements(allowances) FROM hr_grades WHERE organization_id = $1) t`, [org],
    );
    used.forEach((u) => u.code && !have.has(u.code) && !missing.has(u.code) && missing.set(u.code, u.name || u.code));
    if (!missing.size) return rows;
    let order = rows.length ? Math.max(...rows.map((r) => r.sortOrder)) + 1 : 0;
    await repo.createQueryBuilder().insert().values([...missing].map(([code, name]) => {
      const d = DEFAULT_TYPES.find((x) => x.code === code);
      return { organizationId: org, code, name, defaultKind: d?.defaultKind ?? 'fixed', defaultValue: d?.defaultValue ?? 0, isSystem: d?.isSystem ?? false, sortOrder: d?.sortOrder ?? order++ };
    })).orIgnore().execute();
    return repo.find({ where: { organizationId: org }, order: { sortOrder: 'ASC', name: 'ASC' } });
  }

  /** يتحقق من رموز البدلات (مرتبة أو موظف) ويعيد أسماءها من تعريف البنود */
  async checkCodes(org: string, codes: string[]) {
    const types = await this.allowanceTypes(org);
    const map = new Map(types.map((t) => [t.code, t]));
    for (const c of codes) {
      const t = map.get(c);
      if (!t || t.isSystem) throw new BadRequestException(`البدل «${c}» غير معرّف. عرّفه أولًا في تبويب البدلات بالإعدادات`);
    }
    return map;
  }
}
