import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { PlanSettings } from './entities/planning.entity';
import { Decider, validateConfig } from './planning-calc';
import { CONFIGURABLE, defaultConfig, mergeConfig, NEEDS_DEVELOPMENT, PLAN_TEMPLATES, PlanningConfig } from './planning-defaults';
import { PLANNING_PERMISSIONS as P } from './planning.manifest';

/** اليوم بتوقيت الرياض */
export const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

/** الإعدادات والترقيم والقوائم المساعدة من الأنظمة الأخرى (قراءة فقط) */
@Injectable()
export class PlanningCore {
  constructor(private readonly db: DataSource) {}

  async settings(org: string, em: EntityManager = this.db.manager) {
    const repo = em.getRepository(PlanSettings);
    let s = await repo.findOne({ where: { organizationId: org } });
    if (!s) {
      await repo.createQueryBuilder().insert().values({ organizationId: org }).orIgnore().execute();
      s = await repo.findOneOrFail({ where: { organizationId: org } });
    }
    return s;
  }

  async config(org: string, em?: EntityManager): Promise<PlanningConfig> {
    return mergeConfig((await this.settings(org, em)).config);
  }

  async getConfig(actor: OrgUser) {
    return {
      config: await this.config(actor.organizationId), defaults: defaultConfig(),
      templates: PLAN_TEMPLATES.map((t) => ({ key: t.key, name: t.name, description: t.description, kind: t.kind, periodicity: t.periodicity, levels: t.levels })),
      configurable: CONFIGURABLE, needsDevelopment: NEEDS_DEVELOPMENT,
    };
  }

  async saveConfig(actor: OrgUser, input: Record<string, unknown>) {
    const cfg = mergeConfig(input as Partial<PlanningConfig>);
    cfg.thresholds = { green: Number(cfg.thresholds.green), amber: Number(cfg.thresholds.amber) };
    cfg.delayTolerance = Number(cfg.delayTolerance);
    cfg.routes = cfg.routes.map((r, i) => ({
      key: String(r.key || `route${i + 1}`).slice(0, 40), name: String(r.name ?? '').trim(), planKind: r.planKind, unitId: r.unitId || null,
      minCost: r.minCost === null || r.minCost === undefined || (r.minCost as unknown) === '' ? null : Number(r.minCost),
      stages: (r.stages ?? []).map((s) => ({ name: String(s.name ?? '').trim(), roleId: s.roleId || null })),
    }));
    cfg.customFields = cfg.customFields.map((f) => ({ ...f, label: String(f.label ?? '').trim(), options: (f.options ?? []).map((o) => String(o).trim()).filter(Boolean), appliesTo: f.appliesTo ?? 'all' }));
    validateConfig(cfg);
    const org = actor.organizationId;
    const roleIds = [...new Set(cfg.routes.flatMap((r) => r.stages.map((s) => s.roleId)).filter((x): x is string => !!x))];
    if (roleIds.length) {
      const rows: unknown[] = await this.db.query('SELECT id FROM roles WHERE organization_id = $1 AND id = ANY($2)', [org, roleIds]);
      if (rows.length !== roleIds.length) throw new BadRequestException('أحد الأدوار المختارة في مراحل الاعتماد غير موجود');
    }
    const unitIds = [...new Set(cfg.routes.map((r) => r.unitId).filter((x): x is string => !!x))];
    if (unitIds.length) {
      const rows: unknown[] = await this.db.query('SELECT id FROM hr_units WHERE organization_id = $1 AND id = ANY($2)', [org, unitIds]).catch(() => []);
      if (rows.length !== unitIds.length) throw new BadRequestException('إحدى الإدارات المختارة في مسارات الاعتماد غير موجودة');
    }
    await this.settings(org);
    await this.db.getRepository(PlanSettings).update({ organizationId: org }, { config: cfg });
    return this.getConfig(actor);
  }

  /** الرقم التالي لنوع (SP-001، OP-001، KPI-001) بقفل على صف الإعدادات */
  async nextCode(em: EntityManager, org: string, prefix: string) {
    await this.settings(org, em);
    const res = await em.query(
      `UPDATE plan_settings SET counters = jsonb_set(counters, ARRAY[$2::text], to_jsonb(COALESCE((counters->>$2)::int, 0) + 1))
       WHERE organization_id = $1 RETURNING (counters->>$2)::int AS n`, [org, prefix]);
    const row = (Array.isArray(res[0]) ? res[0] : res)[0];
    return `${prefix}-${String(row.n).padStart(3, '0')}`;
  }

  async decider(actor: OrgUser): Promise<Decider> {
    const rows: { role_id: string }[] = await this.db.query('SELECT role_id FROM user_roles WHERE user_id = $1', [actor.id]);
    return { name: actor.fullName, isSuperadmin: actor.isSuperadmin, hasPermission: actor.permissions.includes(P.approve), roleIds: new Set(rows.map((r) => r.role_id)) };
  }

  // ---------------- القوائم من الأنظمة الأخرى (قراءة فقط) ----------------

  async lookups(actor: OrgUser) {
    const org = actor.organizationId;
    const safe = <T>(p: Promise<T[]>) => p.catch(() => [] as T[]);
    const [units, users, roles, costCenters, projects, capitalLines] = await Promise.all([
      safe(this.db.query('SELECT id, name, level FROM hr_units WHERE organization_id = $1 ORDER BY level, sort_order, name', [org])),
      this.db.query('SELECT id, full_name AS "fullName" FROM users WHERE organization_id = $1 AND is_active ORDER BY full_name', [org]),
      this.db.query('SELECT id, name FROM roles WHERE organization_id = $1 ORDER BY name', [org]),
      safe(this.db.query(`SELECT id, code, name FROM acc_analytic_accounts WHERE organization_id = $1 AND is_active ORDER BY code`, [org])),
      safe(this.projectOptions(org)),
      safe(this.capitalOptions(org)),
    ]);
    return { units, users, roles, costCenters, projects, capitalLines };
  }

  projectOptions(org: string): Promise<{ id: string; code: string; name: string; budget: number | null; startDate: string | null; endDate: string | null; managerName: string | null }[]> {
    return this.db.query(
      `SELECT a.id, 'PRJ-' || LPAD(p.project_no::text, 4, '0') AS code, a.name, p.budget::float AS budget, p.start_date::text AS "startDate", p.end_date::text AS "endDate", p.manager_name AS "managerName"
         FROM activities a JOIN project_profiles p ON p.activity_id = a.id WHERE a.organization_id = $1 ORDER BY p.project_no`, [org]);
  }

  capitalOptions(org: string): Promise<{ id: string; code: string; name: string; amount: number; year: number; budgetTitle: string; status: string }[]> {
    return this.db.query(
      `SELECT l.id, b.title || ' / ' || l.line_no AS code, l.description AS name, (l.quantity * l.amount)::float AS amount, y.name AS year, b.title AS "budgetTitle", b.status
         FROM acc_asset_budget_lines l JOIN acc_asset_budgets b ON b.id = l.budget_id JOIN acc_fiscal_years y ON y.id = b.fiscal_year_id
        WHERE l.organization_id = $1 ORDER BY y.name DESC, b.title, l.line_no`, [org]);
  }

  async unitNames(org: string, ids: string[], em: EntityManager = this.db.manager) {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return new Map<string, string>();
    const rows: { id: string; name: string }[] = await em.query('SELECT id, name FROM hr_units WHERE organization_id = $1 AND id = ANY($2)', [org, uniq]).catch(() => []);
    if (rows.length !== uniq.length) throw new BadRequestException('إحدى الإدارات المختارة غير موجودة في الهيكل التنظيمي');
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async userName(org: string, id: string | null | undefined, em: EntityManager = this.db.manager) {
    if (!id) return null;
    const [u] = await em.query('SELECT full_name FROM users WHERE organization_id = $1 AND id = $2', [org, id]);
    if (!u) throw new BadRequestException('المستخدم المختار غير موجود');
    return u.full_name as string;
  }

  async costCenterName(org: string, id: string | null | undefined, em: EntityManager = this.db.manager) {
    if (!id) return null;
    const [c] = await em.query('SELECT code, name FROM acc_analytic_accounts WHERE organization_id = $1 AND id = $2', [org, id]).catch(() => []);
    if (!c) throw new BadRequestException('مركز التكلفة المختار غير موجود في النظام المالي');
    return `${c.code} ${c.name}`;
  }
}
