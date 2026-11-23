import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { normalizePhone } from '../../core/contact-validation';
import { ACTIVITY_TYPES, ASSIGN_MODES, CHANNELS, CrmSettings, DECISION_ROLES, LEAD_STATUS, ListItem, LogChange, LogEntry, PARTY_KINDS, PARTY_ROLES } from './entities/crm.entity';
import { DEFAULT_INTERESTS, DEFAULT_REASONS, DEFAULT_SOURCES, SYSTEM_SOURCES } from './crm-defaults';
import { ListsDto, SettingsDto } from './crm.dto';
import { CRM_PERMISSIONS as P } from './crm.manifest';

export const clean = (s: string | null | undefined) => (s ?? '').trim() || null;
/** قيد في سجل التدقيق: من (الاسم والمعرّف) ومتى وماذا، والقيم قبل التعديل وبعده عند وجودها */
export const logEntry = (action: string, by: string | { id: string; fullName: string }, note: string | null = null, changes?: LogChange[]): LogEntry => ({
  action, note, byName: typeof by === 'string' ? by : by.fullName, byId: typeof by === 'string' ? null : by.id, at: new Date().toISOString(), ...(changes?.length ? { changes } : {}),
});
export const partyCode = (n: number) => `CR-${String(n).padStart(5, '0')}`;
export const leadCode = (n: number) => `LD-${String(n).padStart(5, '0')}`;
/** توحيد الجوال (السعودي على 05xxxxxxxx) والبريد (أحرف صغيرة) للمقارنة ومنع التكرار */
export const normPhone = (p: string | null | undefined) => {
  const v = clean(p);
  return v ? normalizePhone(v) : null;
};
export const normEmail = (e: string | null | undefined) => clean(e)?.toLowerCase() ?? null;
/** توحيد الاسم للمقارنة: بلا تشكيل ولا همزات ولا مسافات زائدة */
export const normName = (s: string) => s.trim().replace(/[ً-ٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').toLowerCase();
export const SYSTEM_ACTOR = 'النظام';
/**
 * شرط SQL: النشاط (بالاسم المستعار a) مرتبط بالجهة، مباشرةً (party_id) أو ضمن نشاط لعدة جهات.
 * party تعبير داخلي ثابت (مثل p.id أو $2) لا يأتي من المدخلات.
 */
export const ACT_OF_PARTY = (party: string) =>
  `(a.party_id = ${party} OR a.id IN (SELECT ap.activity_id FROM crm_activity_parties ap WHERE ap.organization_id = a.organization_id AND ap.party_id = ${party}))`;
/** وصف الجهات في نشاط لعدة جهات: «كل العملاء (25)» أو «جهات مختارة (3)» */
export const audienceLabel = (audience: string | null | undefined, role: string | null | undefined, count: number | null | undefined) => {
  if (!audience) return null;
  const n = Number(count ?? 0);
  if (audience === 'many') return `جهات مختارة (${n})`;
  if (!role) return `كل الجهات (${n})`;
  return role === 'customer' ? `كل العملاء (${n})` : `الكل: ${PARTY_ROLES[role as keyof typeof PARTY_ROLES] ?? role} (${n})`;
};

const has = (u: OrgUser, p: string) => u.isSuperadmin || u.permissions.includes(p);

/** الأساس المشترك لنظام علاقات العملاء: الإعدادات والصلاحيات والترقيم والفريق */
@Injectable()
export class CrmCore {
  constructor(readonly db: DataSource) {}

  readonly has = has;
  /** مدير المبيعات: يرى ويدير سجلات كل الفريق */
  canAll = (u: OrgUser) => has(u, P.all);
  canAssign = (u: OrgUser) => has(u, P.assign) || has(u, P.all);

  /** الإعدادات، وتُهيّأ بالقوائم المقترحة عند أول استخدام */
  async settings(org: string, em: EntityManager = this.db.manager): Promise<CrmSettings> {
    const found = await em.findOne(CrmSettings, { where: { organizationId: org } });
    if (found?.initialized) return found;
    await em.query(
      `INSERT INTO crm_settings (organization_id, initialized, sources, interests, disqualify_reasons) VALUES ($1, true, $2, $3, $4)
       ON CONFLICT (organization_id) DO UPDATE SET initialized = true,
         sources = CASE WHEN crm_settings.sources = '[]'::jsonb THEN EXCLUDED.sources ELSE crm_settings.sources END,
         interests = CASE WHEN crm_settings.interests = '[]'::jsonb THEN EXCLUDED.interests ELSE crm_settings.interests END,
         disqualify_reasons = CASE WHEN crm_settings.disqualify_reasons = '[]'::jsonb THEN EXCLUDED.disqualify_reasons ELSE crm_settings.disqualify_reasons END`,
      [org, JSON.stringify(DEFAULT_SOURCES), JSON.stringify(DEFAULT_INTERESTS), JSON.stringify(DEFAULT_REASONS)]);
    return em.findOneOrFail(CrmSettings, { where: { organizationId: org } });
  }

  /** موظفو المنشأة الفاعلون (للإسناد والفلاتر) */
  users(org: string): Promise<{ id: string; fullName: string }[]> {
    return this.db.query('SELECT id, full_name AS "fullName" FROM users WHERE organization_id = $1 AND is_active ORDER BY full_name', [org]);
  }

  /** يتحقق أن الموظف من المنشأة نفسها وفاعل */
  async user(org: string, id: string, em: EntityManager = this.db.manager): Promise<{ id: string; fullName: string }> {
    const [u] = await em.query('SELECT id, full_name AS "fullName" FROM users WHERE organization_id = $1 AND id = $2 AND is_active', [org, id]);
    if (!u) throw new BadRequestException('الموظف المختار غير موجود أو غير فاعل');
    return u;
  }

  async nextNo(em: EntityManager, table: 'crm_parties' | 'crm_leads', org: string): Promise<number> {
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${table}:${org}`]);
    const [{ n }] = table === 'crm_parties'
      ? await em.query('SELECT COALESCE(MAX(party_no), 0)::int + 1 AS n FROM crm_parties WHERE organization_id = $1', [org])
      : await em.query('SELECT COALESCE(MAX(lead_no), 0)::int + 1 AS n FROM crm_leads WHERE organization_id = $1', [org]);
    return n;
  }

  /** يتحقق أن المفتاح موجود في القائمة (مثل المصدر أو الاهتمام) */
  key(list: ListItem[], key: string | null | undefined, what: string): string | null {
    if (!key) return null;
    if (!list.some((i) => i.key === key)) throw new BadRequestException(`${what} غير موجود في القائمة، راجع الإعدادات`);
    return key;
  }

  label(list: ListItem[], key: string | null | undefined) {
    return key ? list.find((i) => i.key === key)?.label ?? key : null;
  }

  /**
   * التوزيع الآلي بالتناوب: العضو التالي من الفريق الفاعل. يقفل صف الإعدادات حتى لا يُسند اثنان للعضو نفسه في اللحظة نفسها.
   * يعيد null إن كان التوزيع يدويًا أو الفريق فارغًا.
   */
  async nextAssignee(em: EntityManager, org: string): Promise<{ id: string; fullName: string } | null> {
    const [s] = await em.query('SELECT assign_mode, team, rr_cursor FROM crm_settings WHERE organization_id = $1 FOR UPDATE', [org]);
    if (!s || s.assign_mode !== 'round_robin') return null;
    const team: string[] = s.team ?? [];
    if (!team.length) return null;
    const active: { id: string; full_name: string }[] = await em.query(
      'SELECT id, full_name FROM users WHERE organization_id = $1 AND is_active AND id = ANY($2)', [org, team]);
    const order = team.filter((id) => active.some((a) => a.id === id));
    if (!order.length) return null;
    const i = (Number(s.rr_cursor) + 1) % order.length;
    await em.query('UPDATE crm_settings SET rr_cursor = $2 WHERE organization_id = $1', [org, i]);
    const u = active.find((a) => a.id === order[i])!;
    return { id: u.id, fullName: u.full_name };
  }

  /** القوائم المرجعية للشاشات: الإعدادات والفريق والتسميات */
  async lookups(u: OrgUser) {
    const s = await this.settings(u.organizationId);
    return {
      settings: s, users: await this.users(u.organizationId),
      labels: { kinds: PARTY_KINDS, roles: PARTY_ROLES, leadStatus: LEAD_STATUS, activityTypes: ACTIVITY_TYPES, channels: CHANNELS, decisionRoles: DECISION_ROLES, assignModes: ASSIGN_MODES },
      can: {
        all: this.canAll(u), assign: this.canAssign(u), manage: has(u, P.manage), merge: has(u, P.merge), import: has(u, P.import), settings: has(u, P.settings), reports: has(u, P.reports),
      },
      me: u.id,
    };
  }

  async saveSettings(u: OrgUser, dto: SettingsDto) {
    const org = u.organizationId;
    await this.settings(org);
    const team = [...new Set(dto.team)];
    if (team.length) {
      const found: { id: string }[] = await this.db.query('SELECT id FROM users WHERE organization_id = $1 AND is_active AND id = ANY($2)', [org, team]);
      if (found.length !== team.length) throw new BadRequestException('بعض أعضاء الفريق غير موجودين أو غير فاعلين');
    }
    if (dto.assignMode === 'round_robin' && !team.length) throw new BadRequestException('اختر أعضاء الفريق قبل تفعيل التوزيع الآلي');
    await this.db.query(
      `UPDATE crm_settings SET sla_hours = $2, assign_mode = $3, team = $4, web_topics = $5, party_visibility = $6, rr_cursor = CASE WHEN team = $4::jsonb THEN rr_cursor ELSE 0 END, updated_at = now()
        WHERE organization_id = $1`, [org, dto.slaHours, dto.assignMode, JSON.stringify(team), JSON.stringify([...new Set(dto.webTopics)]), dto.partyVisibility]);
    return this.lookups(u);
  }

  async saveLists(u: OrgUser, dto: ListsDto) {
    const org = u.organizationId;
    await this.settings(org);
    const check = (list: ListItem[], what: string, required: string[] = []) => {
      const keys = list.map((i) => i.key);
      if (new Set(keys).size !== keys.length) throw new BadRequestException(`يوجد رمز مكرر في ${what}`);
      if (!list.some((i) => i.isActive)) throw new BadRequestException(`فعّل عنصرًا واحدًا على الأقل في ${what}`);
      const missing = required.filter((k) => !keys.includes(k));
      if (missing.length) throw new BadRequestException(`لا يمكن حذف هذه المصادر لأن النظام يستخدمها: ${missing.join('، ')}، ويمكن تغيير اسمها`);
      return list.map((i) => ({ key: i.key, label: i.label.trim(), isActive: i.isActive }));
    };
    await this.db.query(
      'UPDATE crm_settings SET sources = $2, interests = $3, disqualify_reasons = $4, updated_at = now() WHERE organization_id = $1',
      [org, JSON.stringify(check(dto.sources, 'المصادر', SYSTEM_SOURCES)), JSON.stringify(check(dto.interests, 'الاهتمامات')), JSON.stringify(check(dto.disqualifyReasons, 'أسباب عدم التأهيل'))]);
    return this.lookups(u);
  }

  notFound(what = 'السجل'): never {
    throw new NotFoundException(`${what} غير موجود`);
  }
}
