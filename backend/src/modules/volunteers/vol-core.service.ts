import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Organization } from '../../core/entities';
import { accessProblem } from '../../core/organizations/org-access';
import { Audience, EventStage, LookupItem, VolDocumentVersion, VolSettings } from './entities/volunteers.entity';
import {
  DEFAULT_CERTIFICATES, DEFAULT_CHARTER, DEFAULT_CLOSURE_FIELDS, DEFAULT_CONTRACT_CLAUSES, DEFAULT_EVENT_CATEGORIES, DEFAULT_EVENT_FIELDS,
  DEFAULT_EVENT_STAGES, DEFAULT_POLICY, DEFAULT_REGISTRATION_FIELDS, DEFAULT_SURVEY_QUESTIONS, DEFAULT_VOLUNTEER_FIELDS, DEFAULT_VOLUNTEER_TYPES,
} from './volunteers-defaults';
import {
  normalizeCertificates, normalizeClauses, normalizeFields, normalizeLookups, normalizeQuestions, normalizeSections,
} from './vol-forms';

/** اليوم بتوقيت الرياض */
export const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
/** رمز عشوائي للروابط العامة (الاستبانة وتوقيع العقد) */
export const token = (bytes = 16) => randomBytes(bytes).toString('hex');
/** رمز قصير يسهل كتابته (التحقق من الشهادة ومتابعة الشكوى) */
export const shortCode = () => randomBytes(5).toString('hex').toUpperCase();

export type SettingsSection = 'registration' | 'lookups' | 'events' | 'closure' | 'surveys' | 'certificates' | 'contract' | 'general';
type Counter = 'nextVolunteerNo' | 'nextEventNo' | 'nextCertificateNo' | 'nextContractNo' | 'nextTicketNo';

/** الإعدادات واللائحة والميثاق والترقيم: مشتركة بين خدمات التطوع */
@Injectable()
export class VolCore {
  constructor(private readonly db: DataSource) {}

  /** الشركة من معرفها في الرابط العام، مع منع الشركة الموقوفة أو المنتهي اشتراكها */
  async organization(slug: string) {
    const org = await this.db.getRepository(Organization).findOne({ where: { slug: String(slug).toLowerCase() } });
    if (!org) throw new NotFoundException('الشركة غير موجودة');
    if (accessProblem(org)) throw new NotFoundException('صفحة الشركة غير متاحة حاليًا');
    return org;
  }

  /** إعدادات الشركة، وتُعبأ بالقيم الافتراضية عند أول استخدام */
  async settings(org: string, em: EntityManager = this.db.manager) {
    const repo = em.getRepository(VolSettings);
    let s = await repo.findOne({ where: { organizationId: org } });
    if (!s) {
      await repo.createQueryBuilder().insert().values({ organizationId: org }).orIgnore().execute();
      s = await repo.findOneOrFail({ where: { organizationId: org } });
    }
    if (!s.initialized) {
      Object.assign(s, {
        registrationFields: DEFAULT_REGISTRATION_FIELDS, eventFields: DEFAULT_EVENT_FIELDS, closureFields: DEFAULT_CLOSURE_FIELDS,
        volunteerTypes: DEFAULT_VOLUNTEER_TYPES, volunteerFields: DEFAULT_VOLUNTEER_FIELDS, eventCategories: DEFAULT_EVENT_CATEGORIES,
        eventStages: DEFAULT_EVENT_STAGES, surveyQuestions: DEFAULT_SURVEY_QUESTIONS, contractClauses: DEFAULT_CONTRACT_CLAUSES,
        certificateTemplates: DEFAULT_CERTIFICATES, initialized: true,
      });
      await repo.update({ organizationId: org, initialized: false }, {
        registrationFields: s.registrationFields, eventFields: s.eventFields, closureFields: s.closureFields, volunteerTypes: s.volunteerTypes,
        volunteerFields: s.volunteerFields, eventCategories: s.eventCategories, eventStages: s.eventStages, surveyQuestions: s.surveyQuestions,
        contractClauses: s.contractClauses, certificateTemplates: s.certificateTemplates, initialized: true,
      });
    }
    return s;
  }

  async getSettings(actor: OrgUser) {
    const s = await this.settings(actor.organizationId);
    const roles: { id: string; name: string }[] = await this.db.query('SELECT id, name FROM roles WHERE organization_id = $1 ORDER BY name', [actor.organizationId]);
    return {
      registrationFields: s.registrationFields, eventFields: s.eventFields, closureFields: s.closureFields,
      volunteerTypes: s.volunteerTypes, volunteerFields: s.volunteerFields, eventCategories: s.eventCategories, eventStages: s.eventStages,
      surveyQuestions: s.surveyQuestions, contractClauses: s.contractClauses, certificateTemplates: { ...DEFAULT_CERTIFICATES, ...s.certificateTemplates },
      publicRegistration: s.publicRegistration, roles, slug: actor.organizationSlug,
    };
  }

  /** القوائم المستخدمة في الشاشات (بدون صلاحية الإعدادات) */
  async lookups(org: string) {
    const s = await this.settings(org);
    return {
      volunteerTypes: s.volunteerTypes, volunteerFields: s.volunteerFields, eventCategories: s.eventCategories,
      registrationFields: s.registrationFields, eventFields: s.eventFields, closureFields: s.closureFields,
      stages: s.eventStages, publicRegistration: s.publicRegistration,
    };
  }

  /** حفظ قسم واحد من الإعدادات (كل تبويب يحفظ قسمه) */
  async saveSettings(actor: OrgUser, section: SettingsSection, body: Record<string, unknown>) {
    const org = actor.organizationId;
    const s = await this.settings(org);
    switch (section) {
      case 'registration':
        s.registrationFields = normalizeFields(body.registrationFields, 'نموذج تسجيل المتطوع');
        break;
      case 'lookups': {
        const used = async (sql: string) => new Set<string>((await this.db.query(sql, [org])).map((r: { code: string }) => r.code).filter(Boolean));
        s.volunteerTypes = normalizeLookups(body.volunteerTypes, 'أنواع التطوع', await used('SELECT DISTINCT type_code AS code FROM vol_volunteers WHERE organization_id = $1'));
        s.volunteerFields = normalizeLookups(body.volunteerFields, 'مجالات التطوع', await used(
          `SELECT DISTINCT jsonb_array_elements_text(field_codes) AS code FROM (SELECT field_codes FROM vol_volunteers WHERE organization_id = $1
           UNION ALL SELECT field_codes FROM vol_events WHERE organization_id = $1) t`));
        s.eventCategories = normalizeLookups(body.eventCategories, 'تصنيفات الفعاليات', await used('SELECT DISTINCT category_code AS code FROM vol_events WHERE organization_id = $1'));
        break;
      }
      case 'events': {
        s.eventFields = normalizeFields(body.eventFields, 'نموذج الفعالية');
        s.eventStages = await this.normalizeStages(org, body.eventStages);
        break;
      }
      case 'closure':
        s.closureFields = normalizeFields(body.closureFields, 'تقرير الإغلاق');
        break;
      case 'surveys':
        s.surveyQuestions = normalizeQuestions(body.surveyQuestions);
        break;
      case 'certificates':
        s.certificateTemplates = normalizeCertificates(body.certificateTemplates);
        break;
      case 'contract':
        s.contractClauses = normalizeClauses(body.contractClauses);
        break;
      case 'general':
        s.publicRegistration = body.publicRegistration !== false;
        break;
      default:
        throw new BadRequestException('قسم الإعدادات غير معروف');
    }
    await this.db.getRepository(VolSettings).save(s);
    return this.getSettings(actor);
  }

  private async normalizeStages(org: string, input: unknown): Promise<EventStage[]> {
    if (!Array.isArray(input) || !input.length) throw new BadRequestException('أضف مرحلة اعتماد واحدة على الأقل للفعاليات');
    if (input.length > 8) throw new BadRequestException('أقصى عدد مراحل اعتماد 8 مراحل');
    const stages = input.map((raw, i) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const name = String(r.name ?? '').trim().slice(0, 100);
      if (!name) throw new BadRequestException(`اكتب اسم المرحلة رقم ${i + 1}`);
      const roleId = typeof r.roleId === 'string' && r.roleId ? r.roleId : null;
      return { name, roleId };
    });
    const roleIds = stages.map((s) => s.roleId).filter((x): x is string => !!x);
    if (roleIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) throw new BadRequestException('أحد الأدوار المختارة غير موجود');
    const found: { id: string }[] = roleIds.length ? await this.db.query('SELECT id FROM roles WHERE organization_id = $1 AND id = ANY($2)', [org, roleIds]) : [];
    if (found.length !== new Set(roleIds).size) throw new BadRequestException('أحد الأدوار المختارة غير موجود');
    return stages;
  }

  /** اسم عنصر من قائمة (أو الرمز نفسه إن حُذف) */
  label(list: LookupItem[], code: string | null | undefined) {
    if (!code) return null;
    return list.find((x) => x.code === code)?.name ?? code;
  }

  checkCode(list: LookupItem[], code: string | null | undefined, what: string) {
    if (!code) return;
    const it = list.find((x) => x.code === code);
    if (!it || !it.isActive) throw new BadRequestException(`${what} غير متاح، اختر من القائمة المعرّفة في الإعدادات`);
  }

  /** رقم تسلسلي داخل معاملة، مع قفل صف الإعدادات */
  async nextNo(em: EntityManager, org: string, field: Counter) {
    await this.settings(org, em);
    const s = await em.getRepository(VolSettings).createQueryBuilder('s').setLock('pessimistic_write').where('s.organization_id = :org', { org }).getOneOrFail();
    const n = s[field];
    await em.getRepository(VolSettings).update({ organizationId: org }, { [field]: n + 1 });
    return n;
  }

  // ---------------- اللائحة والميثاق ----------------

  async document(org: string, kind: 'policy' | 'charter') {
    const rows = await this.db.getRepository(VolDocumentVersion).find({ where: { organizationId: org, kind }, order: { version: 'DESC' } });
    const d = kind === 'policy' ? DEFAULT_POLICY : DEFAULT_CHARTER;
    const cur = rows[0];
    return {
      kind,
      title: cur?.title ?? d.title,
      sections: cur?.sections ?? d.sections,
      current: cur ? { version: cur.version, effectiveDate: cur.effectiveDate, approvedByName: cur.approvedByName, note: cur.note, createdAt: cur.createdAt } : null,
      history: rows.map((r) => ({ version: r.version, effectiveDate: r.effectiveDate, approvedByName: r.approvedByName, note: r.note, createdAt: r.createdAt })),
      defaults: d,
    };
  }

  async documents(actor: OrgUser) {
    return { policy: await this.document(actor.organizationId, 'policy'), charter: await this.document(actor.organizationId, 'charter') };
  }

  async saveDocument(actor: OrgUser, kind: 'policy' | 'charter', dto: { title: string; sections: unknown; effectiveDate: string; note?: string | null }) {
    const sections = normalizeSections(dto.sections);
    const repo = this.db.getRepository(VolDocumentVersion);
    const last = await repo.findOne({ where: { organizationId: actor.organizationId, kind }, order: { version: 'DESC' } });
    await repo.save(repo.create({
      organizationId: actor.organizationId, kind, version: (last?.version ?? 0) + 1, title: dto.title.trim(), sections,
      effectiveDate: dto.effectiveDate, note: dto.note ?? null, approvedByName: actor.fullName,
    }));
    return this.documents(actor);
  }

  /** أسئلة الاستبانة الحالية لفئة */
  async questions(org: string, audience: Audience) {
    const s = await this.settings(org);
    return s.surveyQuestions[audience] ?? DEFAULT_SURVEY_QUESTIONS[audience];
  }
}
