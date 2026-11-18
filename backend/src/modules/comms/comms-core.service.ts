import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { COMMS_PERMISSIONS as P } from './comms.manifest';
import { Category, CommsSettings, CommsTransaction, Confidentiality } from './entities/comms.entity';

/** اليوم بتوقيت الرياض */
export const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000);

export const CONF_AR: Record<string, string> = { normal: 'عادية', medium: 'متوسطة السرية', confidential: 'سرية', top_secret: 'عالية السرية' };
export const PRIORITY_AR: Record<string, string> = { normal: 'عادية', urgent: 'عاجلة', very_urgent: 'عاجلة جدًا' };
export const DOC_AR: Record<string, string> = { transaction: 'معاملة', decision: 'قرار', circular: 'تعميم' };
export const KIND_AR: Record<string, string> = { admin: 'إدارية', financial: 'مالية' };
export const DIRECTION_AR: Record<string, string> = { internal: 'داخلية', incoming: 'واردة', outgoing: 'صادرة' };
export const PURPOSE_AR: Record<string, string> = { action: 'للتنفيذ', opinion: 'لإبداء الرأي', approve: 'للاعتماد', sign: 'للتوقيع', info: 'للاطلاع' };
export const TXN_STATUS_AR: Record<string, string> = {
  draft: 'مسودة', open: 'جارية', closed: 'منجزة', archived: 'محفوظة', issued: 'صادر', cancelled: 'ملغاة',
};
export const TASK_STATUS_AR: Record<string, string> = { open: 'لم تبدأ', in_progress: 'قيد التنفيذ', done: 'منجزة', cancelled: 'ملغاة' };
export const SOURCE_AR: Record<string, string> = { manual: 'مهمة مباشرة', meeting: 'توصية اجتماع', transaction: 'معاملة' };

export const DEFAULT_CATEGORIES: Category[] = [
  { code: 'general', name: 'مراسلة إدارية عامة', kind: 'admin', dueDays: 5, isActive: true },
  { code: 'memo', name: 'مذكرة داخلية', kind: 'admin', dueDays: 3, isActive: true },
  { code: 'hr', name: 'شؤون الموظفين', kind: 'admin', dueDays: 5, isActive: true },
  { code: 'external', name: 'خطاب جهة خارجية', kind: 'admin', dueDays: 7, isActive: true },
  { code: 'purchase', name: 'طلب شراء أو صرف', kind: 'financial', dueDays: 5, isActive: true },
  { code: 'custody', name: 'عهدة وتسويتها', kind: 'financial', dueDays: 7, isActive: true },
  { code: 'collection', name: 'تحصيل أو إيراد', kind: 'financial', dueDays: 5, isActive: true },
];

export interface Person { id: string; fullName: string; unitId: string | null; unitName: string | null; jobTitle: string | null }

const bad = (m: string): never => {
  throw new BadRequestException(m);
};

/** القوائم المشتركة: الإعدادات والترقيم ودليل الموظفين والهيكل، وقواعد الاطلاع حسب السرية */
@Injectable()
export class CommsCore {
  constructor(private readonly db: DataSource) {}

  async settings(org: string, em: EntityManager = this.db.manager) {
    const repo = em.getRepository(CommsSettings);
    let s = await repo.findOne({ where: { organizationId: org } });
    if (!s) {
      await repo.createQueryBuilder().insert().values({ organizationId: org, categories: DEFAULT_CATEGORIES }).orIgnore().execute();
      s = await repo.findOneOrFail({ where: { organizationId: org } });
    }
    return s;
  }

  async getSettings(actor: OrgUser) {
    const s = await this.settings(actor.organizationId);
    return { categories: s.categories, taskReminderDays: s.taskReminderDays };
  }

  async saveSettings(actor: OrgUser, dto: { categories: Category[]; taskReminderDays: number }) {
    const codes = new Set<string>();
    for (const c of dto.categories) {
      if (codes.has(c.code)) bad(`رمز التصنيف «${c.code}» مكرر`);
      codes.add(c.code);
    }
    await this.settings(actor.organizationId);
    await this.db.getRepository(CommsSettings).update({ organizationId: actor.organizationId }, { categories: dto.categories, taskReminderDays: dto.taskReminderDays });
    return this.getSettings(actor);
  }

  /** الرقم التالي داخل معاملة: TR-2026-0007 */
  async nextRef(em: EntityManager, org: string, prefix: string, pad = 4) {
    await this.settings(org, em);
    const key = `${prefix}-${today().slice(0, 4)}`;
    const res = await em.query(
      `UPDATE comms_settings SET counters = jsonb_set(counters, ARRAY[$2::text], to_jsonb(COALESCE((counters->>$2)::int, 0) + 1)) WHERE organization_id = $1 RETURNING (counters->>$2)::int AS n`,
      [org, key],
    );
    const rows = Array.isArray(res[0]) ? res[0] : res;
    return `${key}-${String(rows[0].n).padStart(pad, '0')}`;
  }

  // ---------------- دليل الموظفين والهيكل ----------------

  /** المستخدمون النشطون مع إداراتهم من الهيكل التنظيمي (إن كانوا مربوطين بملف موظف) */
  async people(org: string): Promise<Person[]> {
    const rows: { id: string; full_name: string; unit_id: string | null; unit_name: string | null; job: string | null }[] = await this.db.query(
      `SELECT u.id, u.full_name, e.unit_id, un.name AS unit_name, j.title AS job
         FROM users u
         LEFT JOIN hr_employees e ON e.user_id = u.id AND e.organization_id = u.organization_id AND e.status <> 'terminated'
         LEFT JOIN hr_units un ON un.id = e.unit_id
         LEFT JOIN hr_jobs j ON j.id = e.job_id
        WHERE u.organization_id = $1 AND u.is_active ORDER BY u.full_name`, [org],
    );
    const seen = new Set<string>();
    return rows.filter((r) => !seen.has(r.id) && seen.add(r.id)).map((r) => ({ id: r.id, fullName: r.full_name, unitId: r.unit_id, unitName: r.unit_name, jobTitle: r.job }));
  }

  async person(org: string, id: string, em: EntityManager = this.db.manager): Promise<Person> {
    const [r] = await em.query(
      `SELECT u.id, u.full_name, e.unit_id, un.name AS unit_name, j.title AS job FROM users u
         LEFT JOIN hr_employees e ON e.user_id = u.id AND e.organization_id = u.organization_id AND e.status <> 'terminated'
         LEFT JOIN hr_units un ON un.id = e.unit_id LEFT JOIN hr_jobs j ON j.id = e.job_id
        WHERE u.id = $1 AND u.organization_id = $2 AND u.is_active LIMIT 1`, [id, org],
    );
    if (!r) bad('الموظف غير موجود أو حسابه موقوف');
    return { id: r.id, fullName: r.full_name, unitId: r.unit_id, unitName: r.unit_name, jobTitle: r.job };
  }

  async units(org: string) {
    const rows: { id: string; parent_id: string | null; level: number; name: string; manager_user_id: string | null; manager_name: string | null }[] = await this.db.query(
      `SELECT un.id, un.parent_id, un.level, un.name, e.user_id AS manager_user_id, e.full_name AS manager_name
         FROM hr_units un LEFT JOIN hr_employees e ON e.id = un.manager_employee_id
        WHERE un.organization_id = $1 ORDER BY un.level, un.sort_order, un.name`, [org],
    );
    return rows.map((r) => ({ id: r.id, parentId: r.parent_id, level: r.level, name: r.name, managerUserId: r.manager_user_id, managerName: r.manager_name }));
  }

  /** الإحالة إلى إدارة أو قسم تصل إلى مديره في الهيكل التنظيمي */
  async unitHolder(org: string, unitId: string, em: EntityManager = this.db.manager) {
    const [u] = await em.query(
      `SELECT un.name, e.user_id, us.full_name FROM hr_units un LEFT JOIN hr_employees e ON e.id = un.manager_employee_id
         LEFT JOIN users us ON us.id = e.user_id AND us.is_active WHERE un.id = $1 AND un.organization_id = $2`, [unitId, org],
    );
    if (!u) bad('الوحدة غير موجودة في الهيكل التنظيمي');
    if (!u.user_id || !u.full_name) bad(`لا يوجد مدير بحساب دخول نشط لـ«${u.name}». حدد مديرها في الهيكل التنظيمي أو أحِل المعاملة لموظف بعينه`);
    return { userId: u.user_id as string, name: u.full_name as string, unitName: u.name as string };
  }

  /** كل مستخدمي وحدة (ووحداتها الفرعية) لتوجيه القرارات والتعاميم */
  async unitUsers(org: string, unitIds: string[]) {
    if (!unitIds.length) return [];
    const rows: { id: string; full_name: string; unit_name: string }[] = await this.db.query(
      `WITH RECURSIVE t AS (SELECT id FROM hr_units WHERE organization_id = $1 AND id = ANY($2::uuid[])
                             UNION SELECT c.id FROM hr_units c JOIN t ON c.parent_id = t.id)
       SELECT DISTINCT u.id, u.full_name, un.name AS unit_name FROM hr_employees e JOIN t ON t.id = e.unit_id JOIN users u ON u.id = e.user_id AND u.is_active
         JOIN hr_units un ON un.id = e.unit_id WHERE e.organization_id = $1 AND e.status <> 'terminated'`, [org, unitIds],
    );
    return rows.map((r) => ({ id: r.id, fullName: r.full_name, unitName: r.unit_name }));
  }

  // ---------------- السرية والاطلاع ----------------

  can(u: OrgUser, p: string) {
    return u.isSuperadmin || u.permissions.includes(p);
  }

  /**
   * من يرى المعاملة:
   * - أطرافها (المنشئ ومن أحيلت إليه ومن وُجهت إليه) دائمًا.
   * - المتابعون، إلا في المعاملات عالية السرية فلا متابعين لها.
   * - العادية: من يملك سجل المعاملات. متوسطة السرية: من يملك صلاحيتها.
   * - السرية والعالية السرية: الموجهة لهم فقط، حتى مدير النظام لا يراها.
   */
  canSee(u: OrgUser, t: Pick<CommsTransaction, 'partyUserIds' | 'followerUserIds' | 'confidentiality' | 'status' | 'createdById'>) {
    if (t.partyUserIds.includes(u.id)) return true;
    if (t.status === 'draft') return t.createdById === u.id;
    if (t.confidentiality !== 'top_secret' && t.followerUserIds.includes(u.id)) return true;
    if (t.confidentiality === 'normal') return this.can(u, P.registry);
    if (t.confidentiality === 'medium') return this.can(u, P.registryMedium);
    return false;
  }

  /** شرط SQL مطابق لـ canSee على جدول comms_transactions بالاسم المستعار t */
  visibleSql(u: OrgUser, idx: number) {
    const reg = this.can(u, P.registry);
    const med = this.can(u, P.registryMedium);
    return `($${idx}::uuid = ANY(t.party_user_ids) OR (t.status <> 'draft' AND (
      (t.confidentiality <> 'top_secret' AND $${idx}::uuid = ANY(t.follower_user_ids))
      ${reg ? `OR t.confidentiality = 'normal'` : ''} ${med ? `OR t.confidentiality = 'medium'` : ''})))`;
  }

  confLevel(c: Confidentiality) {
    return ['normal', 'medium', 'confidential', 'top_secret'].indexOf(c);
  }

  notFound(what: string): never {
    throw new NotFoundException(`${what} غير موجود`);
  }
}
