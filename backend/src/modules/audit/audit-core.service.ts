import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { HrUnit } from '../hr/entities/hr.entity';
import { AuditSettings, ControlRating, RISK_LEVELS, RiskLevel, ScopeType } from './entities/audit.entity';
import { SettingsDto } from './audit.dto';

/** اليوم بتوقيت الرياض */
export const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000);

export const LEVEL_AR: Record<string, string> = { low: 'منخفض', medium: 'متوسط', high: 'مرتفع', critical: 'حرج' };
export const CATEGORY_AR: Record<string, string> = {
  governance: 'الحوكمة', strategic: 'استراتيجي', operational: 'تشغيلي', financial: 'مالي', compliance: 'الالتزام', it: 'تقنية المعلومات',
  programs: 'البرامج والمستفيدون', fundraising: 'تنمية الموارد', hr: 'الموارد البشرية',
};
export const CONTROL_AR: Record<ControlRating, string> = { strong: 'قوية', adequate: 'مقبولة', weak: 'ضعيفة', unknown: 'غير مقيّمة' };
export const PLAN_STATUS_AR: Record<string, string> = { draft: 'مسودة', submitted: 'بانتظار الاعتماد', approved: 'معتمدة', closed: 'مغلقة' };
export const ENG_STATUS_AR: Record<string, string> = {
  planned: 'مخططة', fieldwork: 'قيد التنفيذ', review: 'بانتظار مراجعة التقرير', issued: 'صدر التقرير ـ متابعة التوصيات', closed: 'مغلقة', cancelled: 'ملغاة',
};
export const ITEM_RESULT_AR: Record<string, string> = { pending: 'لم يُختبر', satisfactory: 'مرضٍ', finding: 'عليه ملاحظة', na: 'لا ينطبق' };
export const OPINION_AR: Record<string, string> = { satisfactory: 'مرضٍ', needs_improvement: 'يحتاج إلى تحسين', unsatisfactory: 'غير مرضٍ' };
export const ACTION_STATUS_AR: Record<string, string> = {
  open: 'لم تبدأ', in_progress: 'قيد التنفيذ', submitted: 'تقرير الإغلاق بانتظار التحقق', closed: 'مغلقة', cancelled: 'ملغاة', overdue: 'متأخرة',
};
/** أثر تقييم الضوابط على أولوية المجال: الضوابط الضعيفة ترفع الأولوية */
export const CONTROL_FACTOR: Record<ControlRating, number> = { strong: 0.8, adequate: 1, weak: 1.25, unknown: 1.1 };

/** خطر من سجل المخاطر كما تعيده وحدة المخاطر (العقد المتفق عليه: RISK_REGISTER_LOOKUP) */
export interface RegisterRisk {
  id: string; code: string; title: string; category?: string | null; unitId?: string | null; unitName?: string | null;
  likelihood?: number | null; impact?: number | null; score: number | null; level: string; levelLabel?: string; status?: string;
}
export interface RegisterControl { id: string; code: string; name: string; type?: string; effectiveness?: string; riskIds: string[] }
interface RiskRegisterLookup {
  listRisks(orgId: string): Promise<RegisterRisk[]>;
  listControls?(orgId: string): Promise<RegisterControl[]>;
}
export const RISK_REGISTER_LOOKUP = 'RISK_REGISTER_LOOKUP';

/** الإعدادات والقوائم المشتركة ومستويات الخطر والربط بسجل المخاطر */
@Injectable()
export class AuditCore {
  private readonly logger = new Logger('Audit');

  constructor(private readonly db: DataSource, private readonly moduleRef: ModuleRef) {}

  async settings(org: string, em: EntityManager = this.db.manager) {
    const repo = em.getRepository(AuditSettings);
    let s = await repo.findOne({ where: { organizationId: org } });
    if (!s) {
      await repo.createQueryBuilder().insert().values({ organizationId: org }).orIgnore().execute();
      s = await repo.findOneOrFail({ where: { organizationId: org } });
    }
    return s;
  }

  async getSettings(actor: OrgUser) {
    const s = await this.settings(actor.organizationId);
    return { riskBands: s.riskBands, frequency: s.frequency, dueDays: s.dueDays, reminderDays: s.reminderDays };
  }

  async saveSettings(actor: OrgUser, dto: SettingsDto) {
    const b = { medium: Number(dto.riskBands.medium), high: Number(dto.riskBands.high), critical: Number(dto.riskBands.critical) };
    if (![b.medium, b.high, b.critical].every((n) => Number.isInteger(n) && n >= 2 && n <= 25) || !(b.medium < b.high && b.high < b.critical)) {
      throw new BadRequestException('حدود المستويات يجب أن تكون متصاعدة بين 2 و25 (متوسط ثم مرتفع ثم حرج)');
    }
    const months = (o: Record<string, number>, label: string, max: number) => Object.fromEntries(RISK_LEVELS.map((l) => {
      const v = Number(o?.[l]);
      if (!Number.isInteger(v) || v < 1 || v > max) throw new BadRequestException(`${label} للمستوى «${LEVEL_AR[l]}» غير صحيح`);
      return [l, v];
    })) as Record<RiskLevel, number>;
    const s = await this.settings(actor.organizationId);
    Object.assign(s, { riskBands: b, frequency: months(dto.frequency, 'تكرار المراجعة', 60), dueDays: months(dto.dueDays, 'مهلة التوصية', 365), reminderDays: dto.reminderDays });
    await this.db.getRepository(AuditSettings).save(s);
    return this.getSettings(actor);
  }

  /** مستوى الخطر من الدرجة (الاحتمال × الأثر) */
  levelOf(bands: AuditSettings['riskBands'], score: number): RiskLevel {
    if (score >= bands.critical) return 'critical';
    if (score >= bands.high) return 'high';
    if (score >= bands.medium) return 'medium';
    return 'low';
  }

  /** الرقم التالي في تسلسل (داخل معاملة) */
  async nextNo(em: EntityManager, org: string, field: 'nextEngagementNo' | 'nextActionNo') {
    await this.settings(org, em);
    const col = field === 'nextEngagementNo' ? 'next_engagement_no' : 'next_action_no';
    const res = await em.query(`UPDATE audit_settings SET ${col} = ${col} + 1 WHERE organization_id = $1 RETURNING ${col} - 1 AS n`, [org]);
    // TypeORM يعيد [الصفوف، عدد المتأثر] لأوامر UPDATE
    const rows = Array.isArray(res[0]) ? res[0] : res;
    return Number(rows[0].n);
  }

  // ---------------- الهيكل التنظيمي والمستخدمون ----------------

  async units(org: string) {
    const rows = await this.db.getRepository(HrUnit).find({ where: { organizationId: org }, order: { level: 'ASC', sortOrder: 'ASC', name: 'ASC' } });
    const mgr: { id: string; full_name: string }[] = await this.db.query(
      'SELECT id, full_name FROM hr_employees WHERE organization_id = $1 AND id = ANY($2::uuid[])', [org, rows.map((r) => r.managerEmployeeId).filter(Boolean)]);
    const m = new Map(mgr.map((x) => [x.id, x.full_name]));
    return rows.map((u) => ({ id: u.id, parentId: u.parentId, level: u.level, name: u.name, managerName: u.managerEmployeeId ? m.get(u.managerEmployeeId) ?? null : null }));
  }

  async unitNames(org: string) {
    const rows = await this.db.getRepository(HrUnit).find({ where: { organizationId: org }, select: ['id', 'name'] });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async checkUnit(org: string, id: string) {
    if (!(await this.db.getRepository(HrUnit).exist({ where: { id, organizationId: org } }))) throw new BadRequestException('الوحدة غير موجودة في الهيكل التنظيمي');
  }

  /** نطاق داخل الهيكل يلزمه وحدة، وخارج الهيكل يلزمه اسم الجهة */
  async checkScope(org: string, scopeType: ScopeType, unitId?: string | null, outsideLabel?: string | null) {
    if (scopeType === 'unit') {
      if (!unitId) throw new BadRequestException('اختر الوحدة من الهيكل التنظيمي');
      await this.checkUnit(org, unitId);
      return { unitId, outsideLabel: null };
    }
    if (scopeType === 'outside') {
      if (!outsideLabel) throw new BadRequestException('اكتب اسم الجهة خارج الهيكل (مثل شريك منفذ أو مورد أو فرع)');
      return { unitId: null, outsideLabel };
    }
    return { unitId: null, outsideLabel: null };
  }

  async users(org: string) {
    const rows: { id: string; full_name: string }[] = await this.db.query(
      'SELECT id, full_name FROM users WHERE organization_id = $1 AND is_active ORDER BY full_name', [org]);
    return rows.map((r) => ({ id: r.id, fullName: r.full_name }));
  }

  async userName(org: string, id: string) {
    const [u] = await this.db.query('SELECT full_name FROM users WHERE id = $1 AND organization_id = $2 AND is_active', [id, org]);
    if (!u) throw new BadRequestException('المستخدم غير موجود أو موقوف');
    return u.full_name as string;
  }

  // ---------------- سجل المخاطر ----------------

  private bridge(): RiskRegisterLookup | null {
    try {
      return this.moduleRef.get<RiskRegisterLookup>(RISK_REGISTER_LOOKUP, { strict: false });
    } catch {
      return null;
    }
  }

  async registerAvailable() {
    return !!this.bridge();
  }

  async risks(org: string): Promise<RegisterRisk[]> {
    const b = this.bridge();
    if (!b) return [];
    try {
      return await b.listRisks(org);
    } catch (e) {
      this.logger.warn(`Risk register lookup failed: ${(e as Error).message}`);
      return [];
    }
  }

  async controls(org: string): Promise<RegisterControl[]> {
    const b = this.bridge();
    if (!b?.listControls) return [];
    try {
      return await b.listControls(org);
    } catch {
      return [];
    }
  }

  async lookups(actor: OrgUser) {
    const org = actor.organizationId;
    const [units, users, risks, controls, s] = await Promise.all([this.units(org), this.users(org), this.risks(org), this.controls(org), this.settings(org)]);
    return {
      units, users, risks, controls, registerAvailable: !!this.bridge(),
      riskBands: s.riskBands, dueDays: s.dueDays,
      labels: { levels: LEVEL_AR, categories: CATEGORY_AR, controls: CONTROL_AR, opinions: OPINION_AR },
    };
  }

  notFound(what: string): never {
    throw new NotFoundException(`${what} غير موجود`);
  }
}
