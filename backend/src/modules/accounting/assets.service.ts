import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import QRCode from 'qrcode';
import { DataSource, EntityManager, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FileStore } from '../../core/files/file-store.service';
import { AccCore, cents, fromCents, today } from './acc-core.service';
import { ACC_PERMISSIONS as P } from './accounting.manifest';
import { AccountsService } from './accounts.service';
import { DEP_METHOD_AR, lifeOf } from './depreciation';
import { AssetConfig } from './entities/accounting.entity';
import {
  AssetCustody, AssetFieldDef, AssetGroup, AssetMove, AssetStatus, AssetStocktake, DEP_METHODS, DepLine, DepMethod, FIELD_TYPES, FixedAsset,
  MaintenanceContract, StocktakeLine,
} from './entities/assets.entity';

export const bad = (m: string): never => {
  throw new BadRequestException(m);
};
export const str = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const dateOf = (v: unknown, label: string) => (typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : bad(`اكتب ${label} بصيغة صحيحة`));
export const amountOf = (v: unknown, label: string, min = 0.01) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > 1_000_000_000) bad(`${label} غير صحيح`);
  return fromCents(cents(n));
};
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const idOf = (v: unknown, label: string) => (typeof v === 'string' && uuidRe.test(v) ? v : bad(`اختر ${label}`));
export const optId = (v: unknown) => (typeof v === 'string' && uuidRe.test(v) ? v : null);

export const ASSET_STATUS_AR: Record<AssetStatus, string> = {
  draft: 'مسجل بلا قيمة', pending_purchase: 'بانتظار اعتماد سند الشراء', active: 'في الخدمة', pending_sale: 'بانتظار اعتماد سند البيع',
  sold: 'مُباع', scrapped: 'مُخرَّد',
};
export const CUSTODY_AR: Record<string, string> = { issue: 'تسليم عهدة', transfer: 'نقل عهدة', return: 'استلام عهدة من الموظف', release: 'إنهاء العهدة' };
/** الحالات التي يكون فيها الأصل في دفاتر الجمعية */
export const IN_BOOKS: AssetStatus[] = ['active', 'pending_sale'];
/** الحالات التي يكون فيها الأصل في حيازة الجمعية (يحتاج عهدة) */
export const HELD: AssetStatus[] = ['draft', 'pending_purchase', 'active', 'pending_sale'];

const DEFAULT_CONFIG: Required<AssetConfig> = { prefix: 'FA', requireCustody: true, alertDays: 30, partialMonth: 'days', donationAccountId: null };

export interface Emp { id: string; fullName: string; employeeNo: number; unitId: string | null; status: string }

/**
 * الأصول الثابتة (تبويب مستقل داخل النظام المالي): الإعدادات، مجموعات الأصول وتوجيهها المحاسبي، بطاقات الأصول وحقولها المرنة
 * وصورها وعقود صيانتها، الأرصدة الافتتاحية، العهد ونماذج التسليم والنقل، الجرد الدوري بملصقات QR.
 * العمليات المالية (الشراء والبيع والتخريد والإهلاك) في AssetOpsService.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly db: DataSource,
    private readonly core: AccCore,
    private readonly accounts: AccountsService,
    private readonly files: FileStore,
  ) {}

  // ---------------- أدوات مشتركة ----------------

  can(actor: OrgUser, perm: string) {
    return actor.isSuperadmin || actor.permissions.includes(perm);
  }

  need(actor: OrgUser, perm: string, msg: string) {
    if (!this.can(actor, perm)) throw new ForbiddenException(msg);
  }

  async config(org: string, em: EntityManager = this.db.manager): Promise<Required<AssetConfig>> {
    return { ...DEFAULT_CONFIG, ...((await this.core.settings(org, em)).assetConfig ?? {}) };
  }

  async getConfig(actor: OrgUser) {
    const c = await this.config(actor.organizationId);
    const acc = c.donationAccountId ? (await this.db.query('SELECT id, code, name FROM acc_accounts WHERE id = $1', [c.donationAccountId]))[0] ?? null : null;
    return { ...c, donationAccount: acc };
  }

  async saveConfig(actor: OrgUser, input: Partial<AssetConfig>) {
    const org = actor.organizationId;
    const cur = await this.config(org);
    const prefix = input.prefix === undefined ? cur.prefix : (str(input.prefix, 8) ?? bad('اكتب بادئة الترميز')).toUpperCase();
    if (!/^[A-Z0-9-]{1,8}$/.test(prefix)) bad('بادئة الترميز حروف إنجليزية كبيرة أو أرقام (حتى 8)');
    const alertDays = input.alertDays === undefined ? cur.alertDays : Number(input.alertDays);
    if (!Number.isInteger(alertDays) || alertDays < 1 || alertDays > 365) bad('أيام التنبيه بين 1 و365');
    const partialMonth = input.partialMonth === undefined ? cur.partialMonth : input.partialMonth;
    if (partialMonth !== 'days' && partialMonth !== 'next_month') bad('اختر قاعدة الشهر الجزئي');
    if (partialMonth !== cur.partialMonth) {
      const [r] = await this.db.query('SELECT COUNT(*)::int AS n FROM acc_asset_dep_lines WHERE organization_id = $1 AND active', [org]);
      if (r.n) bad('لا تُغيَّر قاعدة الشهر الجزئي بعد ترحيل إهلاك، حتى لا تختلف طريقة الاحتساب بين الفترات');
    }
    let donationAccountId = input.donationAccountId === undefined ? cur.donationAccountId : optId(input.donationAccountId);
    if (donationAccountId) donationAccountId = (await this.accounts.postable(org, donationAccountId)).id;
    const assetConfig: AssetConfig = {
      prefix, alertDays, partialMonth, donationAccountId, requireCustody: input.requireCustody === undefined ? cur.requireCustody : input.requireCustody === true,
    };
    await this.core.settings(org);
    await this.db.query('UPDATE acc_settings SET asset_config = $2 WHERE organization_id = $1', [org, JSON.stringify(assetConfig)]);
    return this.getConfig(actor);
  }

  /** قفل تسلسلي لعمليات الأصول في الجمعية (الترقيم والإهلاك) */
  async lock(em: EntityManager, org: string) {
    await em.query(`SELECT pg_advisory_xact_lock(hashtext('acc_assets:' || $1))`, [org]);
  }

  async nextNo(em: EntityManager, table: string, col: string, org: string) {
    const [r] = await em.query(`SELECT COALESCE(MAX(${col}), 0) + 1 AS n FROM ${table} WHERE organization_id = $1`, [org]);
    return Number(r.n);
  }

  async employees(org: string, ids?: string[], em: EntityManager = this.db.manager): Promise<Emp[]> {
    const rows = await em.query(
      `SELECT e.id, e.full_name AS "fullName", e.employee_no AS "employeeNo", e.unit_id AS "unitId", e.status
         FROM hr_employees e WHERE e.organization_id = $1 AND ($2::uuid[] IS NULL OR e.id = ANY($2)) ORDER BY e.employee_no`,
      [org, ids ?? null]).catch(() => []);
    return rows as Emp[];
  }

  async units(org: string): Promise<{ id: string; name: string }[]> {
    return this.db.query('SELECT id, name FROM hr_units WHERE organization_id = $1 ORDER BY level, name', [org]).catch(() => []);
  }

  async activeEmployee(org: string, id: string, em: EntityManager = this.db.manager) {
    const [e] = await this.employees(org, [id], em);
    if (!e) bad('الموظف غير موجود');
    if (e.status !== 'active') bad(`الموظف «${e.fullName}» ليس على رأس العمل`);
    return e;
  }

  /** قوائم الشاشات: المجموعات والموظفون والوحدات والحسابات التحليلية والبنوك والشركاء */
  async lookups(actor: OrgUser) {
    const org = actor.organizationId;
    const [groups, employees, units, analytic, cash, partners, config] = await Promise.all([
      this.listGroups(actor), this.employees(org), this.units(org),
      this.db.query(`SELECT id, code, name FROM acc_analytic_accounts WHERE organization_id = $1 AND kind = 'sub' AND is_active ORDER BY code`, [org]),
      this.db.query(`SELECT id, name, kind FROM acc_cash_accounts WHERE organization_id = $1 AND is_active ORDER BY kind, name`, [org]),
      this.db.query(`SELECT p.id, p.name, p.account_id AS "accountId" FROM acc_partners p WHERE p.organization_id = $1 AND p.is_active ORDER BY p.name`, [org]),
      this.getConfig(actor),
    ]);
    return {
      groups, employees: employees.filter((e) => e.status === 'active'), units, analytic, cash, partners, config,
      methods: DEP_METHODS.map((m) => ({ value: m, label: DEP_METHOD_AR[m] })),
    };
  }

  // ---------------- مجموعات الأصول ----------------

  async listGroups(actor: OrgUser) {
    const org = actor.organizationId;
    const rows = await this.db.getRepository(AssetGroup).find({ where: { organizationId: org }, order: { sortOrder: 'ASC', createdAt: 'ASC' } });
    const ids = [...new Set(rows.flatMap((g) => [g.assetAccountId, g.accumAccountId, g.expenseAccountId, g.gainLossAccountId].filter(Boolean)))] as string[];
    const accs: { id: string; code: string; name: string }[] = ids.length ? await this.db.query('SELECT id, code, name FROM acc_accounts WHERE id = ANY($1)', [ids]) : [];
    const an: { id: string; code: string; name: string }[] = await this.db.query('SELECT id, code, name FROM acc_analytic_accounts WHERE organization_id = $1', [org]);
    const stats: { group_id: string; n: number; books: number; cost: string; accum: string }[] = await this.db.query(
      `SELECT group_id, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status IN ('active', 'pending_sale'))::int AS books,
              COALESCE(SUM(cost) FILTER (WHERE status IN ('active', 'pending_sale')), 0) AS cost, COALESCE(SUM(accum) FILTER (WHERE status IN ('active', 'pending_sale')), 0) AS accum
         FROM acc_assets WHERE organization_id = $1 GROUP BY 1`, [org]);
    const acc = (id: string | null) => (id ? accs.find((a) => a.id === id) ?? null : null);
    return rows.map((g) => {
      const s = stats.find((x) => x.group_id === g.id);
      return {
        id: g.id, code: g.code, name: g.name, description: g.description, method: g.method, methodLabel: DEP_METHOD_AR[g.method],
        rate: g.rate, lifeYears: g.lifeYears ?? (lifeOf(g.rate, null) === null ? null : Math.round(lifeOf(g.rate, null)! * 100) / 100), lifeBasis: g.lifeYears ? 'life' : 'rate', depreciable: g.rate > 0 || !!g.lifeYears,
        isTangible: g.isTangible, isActive: g.isActive, sortOrder: g.sortOrder, fields: g.fields,
        assetAccount: acc(g.assetAccountId), accumAccount: acc(g.accumAccountId), expenseAccount: acc(g.expenseAccountId), gainLossAccount: acc(g.gainLossAccountId),
        analytic: g.analyticId ? an.find((a) => a.id === g.analyticId) ?? null : null,
        assets: s?.n ?? 0, inBooks: s?.books ?? 0, cost: Number(s?.cost ?? 0), accum: Number(s?.accum ?? 0), nbv: fromCents(cents(s?.cost) - cents(s?.accum)),
      };
    });
  }

  private cleanFields(input: unknown): AssetFieldDef[] {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input)) bad('الحقول المرنة غير صحيحة');
    const arr = input as Partial<AssetFieldDef>[];
    if (arr.length > 30) bad('الحقول المرنة 30 حقلًا على الأكثر');
    const keys = new Set<string>();
    const valid = (k: unknown): k is string => typeof k === 'string' && /^[a-z][a-z0-9_]{0,29}$/.test(k);
    // مفاتيح الحقول الموجودة تبقى كما هي حتى لا تنفصل عن قيمها المحفوظة، والحقول الجديدة تأخذ مفتاحًا غير مستخدم
    const taken = new Set(arr.map((f) => f?.key).filter(valid));
    let n = 0;
    const fresh = () => { let k: string; do k = `f${++n}`; while (taken.has(k) || keys.has(k)); return k; };
    return arr.map((f, i) => {
      const label = str(f?.label, 80) ?? bad(`اكتب اسم الحقل ${i + 1}`);
      const type = FIELD_TYPES.includes(f.type as never) ? f.type! : bad(`اختر نوع الحقل «${label}»`);
      let key = valid(f.key) && !keys.has(f.key) ? f.key : fresh();
      while (keys.has(key)) key = fresh();
      keys.add(key);
      const out: AssetFieldDef = { key, label, type, required: f.required === true };
      if (type === 'select') {
        const opts = (Array.isArray(f.options) ? f.options : []).map((o) => str(o, 80)).filter(Boolean) as string[];
        if (opts.length < 2) bad(`اكتب خيارين على الأقل للحقل «${label}»`);
        out.options = opts.slice(0, 30);
      }
      if (type === 'date' && f.expiry === true) out.expiry = true;
      return out;
    });
  }

  private async groupData(org: string, input: Record<string, unknown>, existing?: AssetGroup) {
    const name = str(input.name, 150) ?? bad('اكتب اسم المجموعة');
    const code = (str(input.code, 12) ?? bad('اكتب رمز المجموعة')).toUpperCase();
    if (!/^[A-Z0-9]{1,12}$/.test(code)) bad('رمز المجموعة حروف إنجليزية كبيرة أو أرقام');
    const method = (DEP_METHODS as readonly string[]).includes(input.method as string) ? (input.method as DepMethod) : bad('اختر طريقة الإهلاك');
    const rate = input.rate === undefined || input.rate === null || input.rate === '' ? 0 : Number(input.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) bad('نسبة الإهلاك بين 0 و100');
    const lifeYears = input.lifeYears === undefined || input.lifeYears === null || input.lifeYears === '' ? null : Number(input.lifeYears);
    if (lifeYears !== null && (!Number.isFinite(lifeYears) || lifeYears <= 0 || lifeYears > 100)) bad('العمر الإنتاجي بين سنة و100 سنة');
    const depreciable = rate > 0 || lifeYears !== null;
    if (method === 'declining' && depreciable && !(rate > 0)) bad('طريقة القسط المتناقص تحتاج نسبة إهلاك');
    const acc = async (v: unknown, label: string, need: boolean) => {
      const id = optId(v);
      if (!id) return need ? bad(`اختر ${label}`) : null;
      return (await this.accounts.postable(org, id).catch((e: Error) => bad(`${label}: ${e.message}`))).id;
    };
    const assetAccountId = (await acc(input.assetAccountId, 'حساب الأصل', true))!;
    const accumAccountId = await acc(input.accumAccountId, 'حساب مجمع الإهلاك', depreciable);
    const expenseAccountId = await acc(input.expenseAccountId, 'حساب مصروف الإهلاك', depreciable);
    const gainLossAccountId = (await acc(input.gainLossAccountId, 'حساب أرباح وخسائر البيع', true))!;
    const ids = [assetAccountId, accumAccountId, expenseAccountId, gainLossAccountId].filter(Boolean);
    if (new Set(ids).size !== ids.length) bad('لكل غرض حساب مختلف: الأصل، ومجمع الإهلاك، ومصروف الإهلاك، والأرباح والخسائر');
    const analyticId = optId(input.analyticId);
    if (analyticId) await this.accounts.analyticPostable(org, analyticId);
    if (existing) {
      const [used] = await this.db.query(
        `SELECT (SELECT COUNT(*) FROM acc_asset_moves m JOIN acc_assets a ON a.id = m.asset_id WHERE a.group_id = $1 AND m.status <> 'cancelled')::int AS moves,
                (SELECT COUNT(*) FROM acc_asset_dep_lines WHERE group_id = $1 AND active)::int AS dep`, [existing.id]);
      if (used.moves + used.dep > 0) {
        const changed = (['assetAccountId', 'accumAccountId'] as const).filter((k) => ({ assetAccountId, accumAccountId })[k] !== existing[k]);
        if (changed.length) bad('لا يُغيَّر حساب الأصل أو حساب مجمع الإهلاك بعد تسجيل حركات على أصول المجموعة، حتى لا تختل المطابقة مع الدليل');
      }
    }
    return {
      name, code, description: str(input.description, 1000), method, rate, lifeYears, isTangible: input.isTangible !== false,
      assetAccountId, accumAccountId, expenseAccountId, gainLossAccountId, analyticId, fields: this.cleanFields(input.fields),
      isActive: input.isActive !== false,
    };
  }

  async createGroup(actor: OrgUser, input: Record<string, unknown>) {
    this.need(actor, P.assetsManage, 'ليست لديك صلاحية إدارة مجموعات الأصول');
    const org = actor.organizationId;
    const data = await this.groupData(org, input);
    if (await this.db.getRepository(AssetGroup).exist({ where: { organizationId: org, code: data.code } })) bad(`الرمز ${data.code} مستخدم لمجموعة أخرى`);
    const repo = this.db.getRepository(AssetGroup);
    const sortOrder = await this.nextNo(this.db.manager, 'acc_asset_groups', 'sort_order', org);
    const g = await repo.save(repo.create({ organizationId: org, ...data, sortOrder }));
    return (await this.listGroups(actor)).find((x) => x.id === g.id);
  }

  async updateGroup(actor: OrgUser, id: string, input: Record<string, unknown>) {
    this.need(actor, P.assetsManage, 'ليست لديك صلاحية إدارة مجموعات الأصول');
    const org = actor.organizationId;
    const repo = this.db.getRepository(AssetGroup);
    const g = await repo.findOne({ where: { id, organizationId: org } }) ?? bad('المجموعة غير موجودة');
    const data = await this.groupData(org, input, g);
    if (data.code !== g.code && await repo.exist({ where: { organizationId: org, code: data.code } })) bad(`الرمز ${data.code} مستخدم لمجموعة أخرى`);
    await repo.update({ id }, data);
    return (await this.listGroups(actor)).find((x) => x.id === id);
  }

  async deleteGroup(actor: OrgUser, id: string) {
    this.need(actor, P.assetsManage, 'ليست لديك صلاحية إدارة مجموعات الأصول');
    const n = await this.db.getRepository(FixedAsset).count({ where: { groupId: id, organizationId: actor.organizationId } });
    if (n) throw new ConflictException(`في المجموعة ${n} أصل، فلا تُحذف. يمكن إيقافها`);
    await this.db.getRepository(AssetGroup).delete({ id, organizationId: actor.organizationId });
    return { ok: true };
  }

  async group(org: string, id: string, em: EntityManager = this.db.manager) {
    const g = await em.getRepository(AssetGroup).findOne({ where: { id, organizationId: org } });
    if (!g) throw new NotFoundException('مجموعة الأصول غير موجودة');
    return g;
  }

  // ---------------- بطاقات الأصول ----------------

  async load(em: EntityManager, org: string, id: string, lock = true) {
    const qb = em.getRepository(FixedAsset).createQueryBuilder('a').where('a.id = :id AND a.organization_id = :org', { id, org });
    if (lock) qb.setLock('pessimistic_write');
    const a = await qb.getOne();
    if (!a) throw new NotFoundException('الأصل غير موجود');
    return a;
  }

  /** صافي القيمة الدفترية */
  nbv(a: FixedAsset) {
    return fromCents(cents(a.cost) - cents(a.accum));
  }

  /** طريقة الإهلاك ونسبته وعمره للأصل (من بطاقته أو مجموعته) */
  policy(a: FixedAsset, g: AssetGroup) {
    const rate = a.rate ?? g.rate;
    const lifeYears = a.lifeYears ?? g.lifeYears ?? null;
    return { method: a.method ?? g.method, rate, lifeYears, life: lifeOf(rate, lifeYears) };
  }

  async list(actor: OrgUser, f: { q?: string; groupId?: string; status?: string; custodian?: string; unitId?: string }) {
    const org = actor.organizationId;
    const qb = this.db.getRepository(FixedAsset).createQueryBuilder('a').where('a.organization_id = :org', { org });
    if (f.groupId) qb.andWhere('a.group_id = :g', { g: f.groupId });
    if (f.status === 'books') qb.andWhere(`a.status IN ('active', 'pending_sale')`);
    else if (f.status === 'disposed') qb.andWhere(`a.status IN ('sold', 'scrapped')`);
    else if (f.status) qb.andWhere('a.status = :st', { st: f.status });
    if (f.custodian) qb.andWhere('a.custodian_employee_id = :c', { c: f.custodian });
    if (f.unitId) qb.andWhere('a.unit_id = :u', { u: f.unitId });
    if (f.q) qb.andWhere('(a.name ILIKE :q OR a.code ILIKE :q OR a.serial_number ILIKE :q OR a.location ILIKE :q)', { q: `%${f.q.trim()}%` });
    const rows = await qb.orderBy('a.asset_no', 'DESC').take(2000).getMany();
    return this.rows(org, rows);
  }

  async rows(org: string, rows: FixedAsset[]) {
    const groups = await this.db.getRepository(AssetGroup).find({ where: { organizationId: org } });
    const emps = await this.employees(org, [...new Set(rows.map((r) => r.custodianEmployeeId).filter(Boolean))] as string[]);
    const units = await this.units(org);
    return rows.map((a) => {
      const g = groups.find((x) => x.id === a.groupId)!;
      const e = emps.find((x) => x.id === a.custodianEmployeeId);
      return {
        id: a.id, assetNo: a.assetNo, code: a.code, name: a.name, groupId: a.groupId, groupName: g?.name ?? '', status: a.status, statusLabel: ASSET_STATUS_AR[a.status],
        serialNumber: a.serialNumber, location: a.location, unitId: a.unitId, unitName: units.find((u) => u.id === a.unitId)?.name ?? null,
        custodianId: a.custodianEmployeeId, custodianName: e?.fullName ?? null, custodianNo: e?.employeeNo ?? null,
        cost: a.cost, accum: a.accum, nbv: this.nbv(a), inServiceDate: a.inServiceDate, depreciatedThrough: a.depreciatedThrough, acquisition: a.acquisition,
        hasImage: !!a.image, disposedAt: a.disposedAt, isTangible: g?.isTangible ?? true,
      };
    });
  }

  async get(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const a = await this.load(this.db.manager, org, id, false);
    const g = await this.group(org, a.groupId);
    const [row] = await this.rows(org, [a]);
    const moves = await this.db.getRepository(AssetMove).find({ where: { assetId: id }, order: { date: 'ASC', moveNo: 'ASC' } });
    const vIds = moves.map((m) => m.voucherId).filter(Boolean) as string[];
    const vouchers: { id: string; kind: string; serial: number; status: string }[] = vIds.length ? await this.db.query('SELECT id, kind, serial, status FROM acc_vouchers WHERE id = ANY($1)', [vIds]) : [];
    const eIds = moves.map((m) => m.entryId).filter(Boolean) as string[];
    const entries: { id: string; entry_no: number; voucher_serial: number; status: string }[] = eIds.length ? await this.db.query('SELECT id, entry_no, voucher_serial, status FROM acc_entries WHERE id = ANY($1)', [eIds]) : [];
    const dep: { id: string; run_id: string; run_no: number; kind: string; period: string; from_date: string; to_date: string; amount: string; accum_before: string; active: boolean; entry_id: string | null; entry_no: number | null }[] = await this.db.query(
      `SELECT l.id, l.run_id, r.run_no, r.kind, r.period, to_char(l.from_date, 'YYYY-MM-DD') AS from_date, to_char(l.to_date, 'YYYY-MM-DD') AS to_date, l.amount, l.accum_before, l.active,
              r.entry_id, e.entry_no
         FROM acc_asset_dep_lines l JOIN acc_asset_dep_runs r ON r.id = l.run_id LEFT JOIN acc_entries e ON e.id = r.entry_id
        WHERE l.asset_id = $1 ORDER BY l.to_date, r.run_no`, [id]);
    const custody = await this.custodyOf(org, [id]);
    const pol = this.policy(a, g);
    const cfg = await this.config(org);
    return {
      ...row, description: a.description, fieldValues: a.fieldValues, maintenance: a.maintenance, salvageValue: a.salvageValue,
      method: a.method, rate: a.rate, lifeYears: a.lifeYears, analyticId: a.analyticId,
      effective: { method: pol.method, methodLabel: DEP_METHOD_AR[pol.method], rate: pol.rate, lifeYears: pol.life ? Math.round(pol.life * 100) / 100 : null, monthlyApprox: pol.life ? fromCents(cents((a.cost - a.salvageValue) / (pol.life * 12))) : 0 },
      group: { id: g.id, name: g.name, code: g.code, fields: g.fields, isTangible: g.isTangible, method: g.method, rate: g.rate, lifeYears: g.lifeYears },
      moves: moves.map((m) => {
        const v = vouchers.find((x) => x.id === m.voucherId);
        const e = entries.find((x) => x.id === m.entryId);
        return {
          id: m.id, moveNo: m.moveNo, kind: m.kind, kindLabel: MOVE_AR[m.kind], date: m.date, amount: m.amount, accumDelta: m.accumDelta, proceeds: m.proceeds,
          gainLoss: m.gainLoss, status: m.status, partyName: m.partyName, notes: m.notes, createdByName: m.createdByName, cancelReason: m.cancelReason,
          voucher: v ? { id: v.id, kind: v.kind, serial: v.serial, status: v.status } : null, entry: e ? { id: e.id, entryNo: e.entry_no, serial: e.voucher_serial, status: e.status } : null,
        };
      }),
      depreciation: dep.map((d) => ({
        id: d.id, runId: d.run_id, runNo: d.run_no, kind: d.kind, period: d.period, from: d.from_date, to: d.to_date, amount: Number(d.amount),
        accumBefore: Number(d.accum_before), active: d.active, entryId: d.entry_id, entryNo: d.entry_no,
      })),
      custody,
      alerts: this.alerts(a, g, cfg.alertDays),
      createdByName: a.createdByName, createdAt: a.createdAt,
    };
  }

  /** تنبيهات الأصل: تراخيص وعقود صيانة تنتهي قريبًا أو انتهت */
  alerts(a: FixedAsset, g: AssetGroup, days: number) {
    const t = today();
    const limit = new Date(Date.parse(`${t}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    const out: { kind: string; label: string; date: string; expired: boolean }[] = [];
    for (const f of g.fields.filter((x) => x.type === 'date' && x.expiry)) {
      const v = a.fieldValues?.[f.key];
      if (typeof v === 'string' && v <= limit) out.push({ kind: 'field', label: f.label, date: v, expired: v < t });
    }
    for (const m of a.maintenance ?? []) {
      if (m.endDate <= limit) out.push({ kind: 'maintenance', label: `عقد صيانة: ${m.provider}`, date: m.endDate, expired: m.endDate < t });
    }
    return out;
  }

  private async assetData(org: string, input: Record<string, unknown>, g: AssetGroup) {
    const name = str(input.name, 250) ?? bad('اكتب اسم الأصل');
    const values: Record<string, string | number | null> = {};
    const raw = (input.fieldValues ?? {}) as Record<string, unknown>;
    for (const f of g.fields) {
      const v = raw[f.key];
      const empty = v === undefined || v === null || v === '';
      if (empty) {
        if (f.required) bad(`اكتب «${f.label}»`);
        values[f.key] = null;
        continue;
      }
      if (f.type === 'number') {
        const n = Number(v);
        if (!Number.isFinite(n)) bad(`«${f.label}» يجب أن يكون رقمًا`);
        values[f.key] = n;
      } else if (f.type === 'date') values[f.key] = dateOf(v, f.label);
      else if (f.type === 'select') values[f.key] = f.options?.includes(String(v)) ? String(v) : bad(`اختر قيمة صحيحة لـ«${f.label}»`);
      else values[f.key] = str(v, 500);
    }
    const method = input.method ? ((DEP_METHODS as readonly string[]).includes(input.method as string) ? (input.method as DepMethod) : bad('طريقة الإهلاك غير صحيحة')) : null;
    const rate = input.rate === undefined || input.rate === null || input.rate === '' ? null : Number(input.rate);
    if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) bad('نسبة الإهلاك بين 0 و100');
    const lifeYears = input.lifeYears === undefined || input.lifeYears === null || input.lifeYears === '' ? null : Number(input.lifeYears);
    if (lifeYears !== null && (!Number.isFinite(lifeYears) || lifeYears <= 0 || lifeYears > 100)) bad('العمر الإنتاجي بين سنة و100 سنة');
    const salvageValue = input.salvageValue === undefined || input.salvageValue === null || input.salvageValue === '' ? 0 : amountOf(input.salvageValue, 'القيمة التخريدية', 0);
    const unitId = optId(input.unitId);
    if (unitId && !(await this.units(org)).some((u) => u.id === unitId)) bad('الجهة المسؤولة غير موجودة');
    const analyticId = optId(input.analyticId);
    if (analyticId) await this.accounts.analyticPostable(org, analyticId);
    const maintenance: MaintenanceContract[] = (Array.isArray(input.maintenance) ? input.maintenance : []).slice(0, 20).map((m: Record<string, unknown>, i: number) => {
      const provider = str(m?.provider, 200) ?? bad(`اكتب الجهة المنفذة لعقد الصيانة ${i + 1}`);
      const startDate = dateOf(m.startDate, `بداية عقد الصيانة ${i + 1}`);
      const endDate = dateOf(m.endDate, `نهاية عقد الصيانة ${i + 1}`);
      if (endDate < startDate) bad(`نهاية عقد الصيانة ${i + 1} قبل بدايته`);
      return { id: typeof m.id === 'string' && m.id ? m.id.slice(0, 40) : randomUUID(), provider, startDate, endDate, cost: m.cost ? amountOf(m.cost, 'قيمة العقد', 0) : 0, notes: str(m.notes, 500) };
    });
    return {
      name, description: str(input.description, 2000), serialNumber: str(input.serialNumber, 120), location: str(input.location, 250), unitId,
      fieldValues: values, method, rate, lifeYears, salvageValue, analyticId, maintenance,
    };
  }

  async create(actor: OrgUser, input: Record<string, unknown>) {
    this.need(actor, P.assetsManage, 'ليست لديك صلاحية تسجيل الأصول');
    const org = actor.organizationId;
    const id = await this.db.transaction(async (em) => {
      await this.lock(em, org);
      const g = await this.group(org, idOf(input.groupId, 'مجموعة الأصل'), em);
      if (!g.isActive) bad(`المجموعة «${g.name}» موقوفة`);
      const data = await this.assetData(org, input, g);
      const cfg = await this.config(org, em);
      const custodian = optId(input.custodianEmployeeId);
      if (g.isTangible && cfg.requireCustody && !custodian) bad('الأصول المادية يجب أن تكون في عهدة موظف. اختر الموظف المستلم');
      const emp = custodian ? await this.activeEmployee(org, custodian, em) : null;
      const assetNo = await this.nextNo(em, 'acc_assets', 'asset_no', org);
      const code = `${cfg.prefix}-${g.code}-${String(assetNo).padStart(4, '0')}`;
      const a = await em.getRepository(FixedAsset).save(em.create(FixedAsset, {
        organizationId: org, assetNo, code, groupId: g.id, status: 'draft', ...data, unitId: data.unitId ?? emp?.unitId ?? null,
        custodianEmployeeId: null, createdByName: actor.fullName,
      }));
      if (emp) await this.addCustody(em, actor, a, { kind: 'issue', toEmployeeId: emp.id, toLocation: a.location, date: dateOrToday(input.custodyDate), condition: str(input.condition, 60) ?? 'جديد', notes: 'تسليم عند تسجيل الأصل' });
      return a.id;
    });
    return this.get(actor, id);
  }

  async update(actor: OrgUser, id: string, input: Record<string, unknown>) {
    this.need(actor, P.assetsManage, 'ليست لديك صلاحية تعديل الأصول');
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const a = await this.load(em, org, id);
      if (a.status === 'sold' || a.status === 'scrapped') bad('الأصل مستبعد، ولا تُعدَّل بياناته');
      let g = await this.group(org, a.groupId, em);
      const groupId = optId(input.groupId);
      if (groupId && groupId !== a.groupId) {
        const [m] = await em.query(`SELECT COUNT(*)::int AS n FROM acc_asset_moves WHERE asset_id = $1 AND status <> 'cancelled'`, [id]);
        if (m.n) bad('لا تُغيَّر مجموعة الأصل بعد تسجيل قيمته، لأن المجموعة تحدد حساباته في الدليل');
        g = await this.group(org, groupId, em);
      }
      const data = await this.assetData(org, input, g);
      const [dep] = await em.query('SELECT COUNT(*)::int AS n FROM acc_asset_dep_lines WHERE asset_id = $1 AND active', [id]);
      if (dep.n && (data.method !== a.method || data.rate !== a.rate || data.lifeYears !== a.lifeYears || data.salvageValue !== a.salvageValue)) {
        bad('لا تُغيَّر طريقة الإهلاك أو نسبته أو العمر أو القيمة التخريدية بعد ترحيل إهلاك للأصل. ألغِ حركات الإهلاك أولًا إن لزم');
      }
      await em.getRepository(FixedAsset).update({ id }, { ...data, groupId: g.id });
    });
    return this.get(actor, id);
  }

  async remove(actor: OrgUser, id: string) {
    this.need(actor, P.assetsManage, 'ليست لديك صلاحية حذف الأصول');
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const a = await this.load(em, org, id);
      const [m] = await em.query('SELECT COUNT(*)::int AS n FROM acc_asset_moves WHERE asset_id = $1', [id]);
      if (m.n || a.status !== 'draft') bad('لا يُحذف أصل له حركات مالية. يُستبعد بالبيع أو التخريد');
      if (a.image) await this.files.remove(a.image.key);
      await em.getRepository(AssetCustody).delete({ assetId: id });
      await em.getRepository(FixedAsset).delete({ id });
    });
    return { ok: true };
  }

  async setImage(actor: OrgUser, id: string, file: Express.Multer.File | undefined) {
    this.need(actor, P.assetsManage, 'ليست لديك صلاحية تعديل الأصول');
    const a = await this.load(this.db.manager, actor.organizationId, id, false);
    const saved = await this.files.save(`assets/${actor.organizationId}`, file, 'صورة الأصل');
    if (saved.mime === 'application/pdf') {
      await this.files.remove(saved.key);
      bad('صورة الأصل تكون JPG أو PNG');
    }
    if (a.image) await this.files.remove(a.image.key);
    await this.db.getRepository(FixedAsset).update({ id }, { image: saved });
    return { ok: true };
  }

  async removeImage(actor: OrgUser, id: string) {
    this.need(actor, P.assetsManage, 'ليست لديك صلاحية تعديل الأصول');
    const a = await this.load(this.db.manager, actor.organizationId, id, false);
    if (a.image) await this.files.remove(a.image.key);
    await this.db.getRepository(FixedAsset).update({ id }, { image: null });
    return { ok: true };
  }

  async image(actor: OrgUser, id: string) {
    const a = await this.load(this.db.manager, actor.organizationId, id, false);
    if (!a.image) throw new NotFoundException('لا توجد صورة للأصل');
    return { mime: a.image.mime, name: a.image.name, stream: this.files.open(a.image.key) };
  }

  async byCode(actor: OrgUser, code: string) {
    const a = await this.db.getRepository(FixedAsset).findOne({ where: { organizationId: actor.organizationId, code: code.trim().toUpperCase() } });
    if (!a) throw new NotFoundException(`لا يوجد أصل بالترميز ${code}`);
    return { id: a.id, code: a.code, name: a.name };
  }

  /** ملصقات QR للأصول: الرمز يفتح بطاقة الأصل مباشرة بكاميرا الجوال */
  async labels(actor: OrgUser, ids: string[], base: string) {
    if (!/^https?:\/\/[^\s/]+$/.test(base)) bad('عنوان المنصة غير صحيح');
    const org = actor.organizationId;
    const rows = await this.db.getRepository(FixedAsset).find({ where: { organizationId: org, ...(ids.length ? { id: In(ids) } : {}) }, order: { assetNo: 'ASC' }, take: 500 });
    const groups = await this.db.getRepository(AssetGroup).find({ where: { organizationId: org } });
    const [o] = await this.db.query('SELECT name FROM organizations WHERE id = $1', [org]);
    return {
      organization: o?.name ?? '',
      labels: await Promise.all(rows.filter((a) => a.status !== 'sold' && a.status !== 'scrapped').map(async (a) => ({
        id: a.id, code: a.code, name: a.name, groupName: groups.find((g) => g.id === a.groupId)?.name ?? '', location: a.location,
        svg: await QRCode.toString(`${base}/accounting/assets/a/${encodeURIComponent(a.code)}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
      }))),
    };
  }

  /** إعادة حساب التكلفة ومجمع الإهلاك وحالة الأصل من حركاته (بعد أي عملية) */
  async refresh(em: EntityManager, org: string, id: string) {
    const a = await this.load(em, org, id);
    const moves = await em.getRepository(AssetMove).find({ where: { assetId: id }, order: { date: 'ASC', moveNo: 'ASC' } });
    const lines = await em.getRepository(DepLine).find({ where: { assetId: id, active: true } });
    const done = moves.filter((m) => m.status === 'done');
    const acq = done.filter((m) => ['opening', 'purchase', 'donation', 'addition'].includes(m.kind));
    const disposal = done.find((m) => m.kind === 'sale' || m.kind === 'scrap');
    const pendingSale = moves.find((m) => m.kind === 'sale' && m.status === 'pending');
    const pendingPurchase = moves.find((m) => m.kind === 'purchase' && m.status === 'pending');
    const first = acq.find((m) => m.kind !== 'addition');
    let status: AssetStatus = 'draft';
    if (disposal) status = disposal.kind === 'sale' ? 'sold' : 'scrapped';
    else if (pendingSale && first) status = 'pending_sale';
    else if (first) status = 'active';
    else if (pendingPurchase) status = 'pending_purchase';
    const cost = acq.reduce((s, m) => s + cents(m.amount), 0);
    const accum = done.filter((m) => m.kind === 'opening').reduce((s, m) => s + cents(m.accumDelta), 0) + lines.reduce((s, l) => s + cents(l.amount), 0);
    const opening = done.find((m) => m.kind === 'opening');
    const through = [opening?.date, ...lines.map((l) => l.toDate)].filter(Boolean).sort().at(-1) ?? null;
    const patch: Partial<FixedAsset> = {
      status, cost: fromCents(cost), accum: fromCents(accum), depreciatedThrough: through, disposedAt: disposal?.date ?? null,
      acquisition: first ? (first.kind as 'purchase' | 'donation' | 'opening') : null,
    };
    if (first && first.kind !== 'opening') patch.inServiceDate = first.date;
    if (!first) patch.inServiceDate = null;
    await em.getRepository(FixedAsset).update({ id }, patch);
    return { ...a, ...patch } as FixedAsset;
  }

  // ---------------- الأرصدة الافتتاحية ----------------

  async openingList(actor: OrgUser) {
    const org = actor.organizationId;
    const rows: { id: string; asset_id: string; code: string; name: string; group_name: string; date: string; in_service: string | null; amount: string; accum: string; status: string; dep: number; created_by_name: string }[] = await this.db.query(
      `SELECT m.id, m.asset_id, a.code, a.name, g.name AS group_name, to_char(m.date, 'YYYY-MM-DD') AS date, to_char(a.in_service_date, 'YYYY-MM-DD') AS in_service,
              m.amount, m.accum_delta AS accum, m.status, m.created_by_name,
              (SELECT COUNT(*) FROM acc_asset_dep_lines l WHERE l.asset_id = m.asset_id AND l.active)::int AS dep
         FROM acc_asset_moves m JOIN acc_assets a ON a.id = m.asset_id JOIN acc_asset_groups g ON g.id = a.group_id
        WHERE m.organization_id = $1 AND m.kind = 'opening' AND m.status = 'done' ORDER BY a.asset_no`, [org]);
    const years = await this.core.years(org);
    const first = years.find((y) => y.isFirst) ?? years[0];
    return {
      defaultDate: first ? addDaysIso(first.startDate, -1) : null,
      rows: rows.map((r) => ({
        id: r.id, assetId: r.asset_id, code: r.code, name: r.name, groupName: r.group_name, asOf: r.date, purchaseDate: r.in_service, cost: Number(r.amount),
        accum: Number(r.accum), nbv: fromCents(cents(r.amount) - cents(r.accum)), locked: r.dep > 0, createdByName: r.created_by_name,
      })),
      totals: { cost: rows.reduce((s, r) => s + Number(r.amount), 0), accum: rows.reduce((s, r) => s + Number(r.accum), 0) },
    };
  }

  /** رصيد افتتاحي لأصل: تاريخ الشراء وقيمته عند الشراء ورصيد مجمع إهلاكه في تاريخ بدء النظام (بدون قيد، لأن أرصدة الدليل في القيد الافتتاحي) */
  async saveOpening(actor: OrgUser, input: Record<string, unknown>) {
    this.need(actor, P.assetsManage, 'ليست لديك صلاحية الأرصدة الافتتاحية للأصول');
    const org = actor.organizationId;
    const assetId = idOf(input.assetId, 'الأصل');
    await this.db.transaction(async (em) => {
      await this.lock(em, org);
      const a = await this.load(em, org, assetId);
      const purchaseDate = dateOf(input.purchaseDate, 'تاريخ شراء الأصل');
      const asOf = dateOf(input.asOf, 'تاريخ الرصيد الافتتاحي');
      if (purchaseDate > asOf) bad('تاريخ الشراء بعد تاريخ الرصيد الافتتاحي');
      const cost = amountOf(input.cost, 'قيمة الأصل عند الشراء');
      const accum = input.accum === undefined || input.accum === null || input.accum === '' ? 0 : amountOf(input.accum, 'رصيد مجمع الإهلاك', 0);
      if (cents(accum) > cents(cost) - 100) bad('رصيد مجمع الإهلاك لا يتجاوز قيمة الأصل ناقص ريال واحد (صافي القيمة لا يقل عن ريال)');
      const moves = await em.getRepository(AssetMove).find({ where: { assetId } });
      const existing = moves.find((m) => m.kind === 'opening' && m.status === 'done');
      if (moves.some((m) => m.kind !== 'opening' && m.status !== 'cancelled')) bad('للأصل حركات شراء أو بيع، فلا يُسجَّل له رصيد افتتاحي');
      const [dep] = await em.query('SELECT COUNT(*)::int AS n FROM acc_asset_dep_lines WHERE asset_id = $1 AND active', [assetId]);
      if (dep.n) bad('احتُسب إهلاك للأصل بعد رصيده الافتتاحي، فلا يُعدَّل إلا بعد إلغاء حركات الإهلاك');
      const years = await this.core.years(org, em);
      const firstYear = years.find((y) => y.isFirst) ?? years[0];
      if (firstYear && asOf >= firstYear.startDate) bad(`تاريخ الرصيد الافتتاحي يكون قبل بداية أول سنة مالية في النظام (${firstYear.startDate})`);
      const g = await this.group(org, a.groupId, em);
      const cfg = await this.config(org, em);
      if (g.isTangible && cfg.requireCustody && !a.custodianEmployeeId) bad('سلّم الأصل لموظف أولًا (الأصول المادية يجب أن تكون في عهدة موظف)');
      if (existing) {
        await em.getRepository(AssetMove).update({ id: existing.id }, { date: asOf, amount: cost, accumDelta: accum, notes: str(input.notes, 1000) });
      } else {
        await em.getRepository(AssetMove).save(em.create(AssetMove, {
          organizationId: org, moveNo: await this.nextNo(em, 'acc_asset_moves', 'move_no', org), assetId, kind: 'opening', date: asOf, amount: cost,
          accumDelta: accum, status: 'done', notes: str(input.notes, 1000), createdByName: actor.fullName,
        }));
      }
      await em.getRepository(FixedAsset).update({ id: assetId }, { inServiceDate: purchaseDate });
      await this.refresh(em, org, assetId);
    });
    return this.openingList(actor);
  }

  async deleteOpening(actor: OrgUser, moveId: string) {
    this.need(actor, P.assetsManage, 'ليست لديك صلاحية الأرصدة الافتتاحية للأصول');
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const m = await em.getRepository(AssetMove).findOne({ where: { id: moveId, organizationId: org, kind: 'opening' } }) ?? bad('الرصيد الافتتاحي غير موجود');
      const [dep] = await em.query('SELECT COUNT(*)::int AS n FROM acc_asset_dep_lines WHERE asset_id = $1 AND active', [m.assetId]);
      if (dep.n) bad('احتُسب إهلاك للأصل، فلا يُحذف رصيده الافتتاحي إلا بعد إلغاء حركات الإهلاك');
      const [other] = await em.query(`SELECT COUNT(*)::int AS n FROM acc_asset_moves WHERE asset_id = $1 AND kind <> 'opening' AND status <> 'cancelled'`, [m.assetId]);
      if (other.n) bad('للأصل حركات بعد الرصيد الافتتاحي');
      await em.getRepository(AssetMove).delete({ id: moveId });
      await this.refresh(em, org, m.assetId);
    });
    return this.openingList(actor);
  }

  // ---------------- العهد ----------------

  async custodyOf(org: string, assetIds: string[] | null, employeeId?: string) {
    const rows = await this.db.getRepository(AssetCustody).createQueryBuilder('c')
      .where('c.organization_id = :org', { org })
      .andWhere(assetIds ? 'c.asset_id IN (:...ids)' : '1=1', assetIds ? { ids: assetIds.length ? assetIds : ['00000000-0000-0000-0000-000000000000'] } : {})
      .andWhere(employeeId ? '(c.to_employee_id = :e OR c.from_employee_id = :e)' : '1=1', employeeId ? { e: employeeId } : {})
      .orderBy('c.form_no', 'DESC').take(1000).getMany();
    const emps = await this.employees(org, [...new Set(rows.flatMap((r) => [r.fromEmployeeId, r.toEmployeeId]).filter(Boolean))] as string[]);
    const assets = rows.length ? await this.db.getRepository(FixedAsset).find({ where: { id: In([...new Set(rows.map((r) => r.assetId))]) }, select: ['id', 'code', 'name'] }) : [];
    const name = (id: string | null) => (id ? emps.find((e) => e.id === id)?.fullName ?? '' : null);
    return rows.map((c) => ({
      id: c.id, formNo: c.formNo, kind: c.kind, kindLabel: CUSTODY_AR[c.kind], date: c.date, assetId: c.assetId,
      assetCode: assets.find((a) => a.id === c.assetId)?.code ?? '', assetName: assets.find((a) => a.id === c.assetId)?.name ?? '',
      fromEmployeeId: c.fromEmployeeId, fromName: name(c.fromEmployeeId), toEmployeeId: c.toEmployeeId, toName: name(c.toEmployeeId),
      fromLocation: c.fromLocation, toLocation: c.toLocation, condition: c.condition, notes: c.notes,
      confirmedAt: c.confirmedAt, confirmedByName: c.confirmedByName, createdByName: c.createdByName, createdAt: c.createdAt,
    }));
  }

  async addCustody(em: EntityManager, actor: { fullName: string; organizationId: string }, a: FixedAsset, d: {
    kind: 'issue' | 'transfer' | 'return' | 'release'; toEmployeeId: string | null; toLocation: string | null; date: string; condition: string | null; notes: string | null;
  }) {
    const org = actor.organizationId;
    const c = await em.getRepository(AssetCustody).save(em.create(AssetCustody, {
      organizationId: org, formNo: await this.nextNo(em, 'acc_asset_custody', 'form_no', org), assetId: a.id, kind: d.kind,
      fromEmployeeId: a.custodianEmployeeId, toEmployeeId: d.toEmployeeId, fromLocation: a.location, toLocation: d.toLocation ?? a.location,
      date: d.date, condition: d.condition, notes: d.notes, createdByName: actor.fullName,
    }));
    await em.getRepository(FixedAsset).update({ id: a.id }, { custodianEmployeeId: d.toEmployeeId, location: d.toLocation ?? a.location });
    return c;
  }

  /** تسليم أو نقل أو استلام عهدة بنموذج مرقم */
  async moveCustody(actor: OrgUser, assetId: string, input: Record<string, unknown>) {
    this.need(actor, P.assetsCustody, 'ليست لديك صلاحية إدارة العهد');
    const org = actor.organizationId;
    let formId = '';
    await this.db.transaction(async (em) => {
      await this.lock(em, org);
      const a = await this.load(em, org, assetId);
      if (!HELD.includes(a.status)) bad('الأصل مستبعد من الجمعية، ولا تُسجَّل عليه عهدة');
      const kind = input.kind === 'return' ? 'return' : a.custodianEmployeeId ? 'transfer' : 'issue';
      const to = await this.activeEmployee(org, idOf(input.toEmployeeId, kind === 'return' ? 'الموظف المستلم نيابة عن الجمعية' : 'الموظف المستلم'), em);
      if (to.id === a.custodianEmployeeId && (str(input.toLocation, 250) ?? a.location) === a.location) bad('الأصل في عهدة هذا الموظف وفي الموقع نفسه بالفعل');
      if (kind === 'return' && !a.custodianEmployeeId) bad('الأصل ليس في عهدة موظف');
      const date = dateOrToday(input.date);
      if (date > today()) bad('تاريخ النموذج في المستقبل');
      const c = await this.addCustody(em, actor, a, {
        kind, toEmployeeId: to.id, toLocation: str(input.toLocation, 250), date, condition: str(input.condition, 60), notes: str(input.notes, 1000),
      });
      formId = c.id;
    });
    return (await this.custodyOf(org, [assetId])).find((c) => c.id === formId);
  }

  /** إقرار المستلم باستلام العهدة (الموظف نفسه أو مسؤول العهد) */
  async confirmCustody(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const c = await this.db.getRepository(AssetCustody).findOne({ where: { id, organizationId: org } }) ?? bad('النموذج غير موجود');
    if (c.confirmedAt) bad('أُقر بالاستلام من قبل');
    if (!c.toEmployeeId) bad('هذا النموذج لا يحتاج إقرارًا');
    const [own] = await this.db.query('SELECT 1 FROM hr_employees WHERE id = $1 AND user_id = $2', [c.toEmployeeId, actor.id]).catch(() => []);
    if (!own && !this.can(actor, P.assetsCustody)) throw new ForbiddenException('يقر بالاستلام الموظف المستلم أو مسؤول العهد');
    await this.db.getRepository(AssetCustody).update({ id }, { confirmedAt: new Date(), confirmedByName: actor.fullName });
    return (await this.custodyOf(org, [c.assetId])).find((x) => x.id === id);
  }

  async custodyForm(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const c = await this.db.getRepository(AssetCustody).findOne({ where: { id, organizationId: org } }) ?? bad('النموذج غير موجود');
    const row = (await this.custodyOf(org, [c.assetId])).find((x) => x.id === id)!;
    const asset = await this.get(actor, c.assetId);
    const [o] = await this.db.query('SELECT name FROM organizations WHERE id = $1', [org]);
    const emps = await this.employees(org, [c.fromEmployeeId, c.toEmployeeId].filter(Boolean) as string[]);
    const units = await this.units(org);
    const empView = (eid: string | null) => {
      const e = emps.find((x) => x.id === eid);
      return e ? { name: e.fullName, no: e.employeeNo, unit: units.find((u) => u.id === e.unitId)?.name ?? '' } : null;
    };
    return {
      organization: o?.name ?? '', form: row, from: empView(c.fromEmployeeId), to: empView(c.toEmployeeId),
      asset: { code: asset.code, name: asset.name, groupName: asset.groupName, serialNumber: asset.serialNumber, description: asset.description, cost: asset.cost, fields: asset.group.fields.map((f) => ({ label: f.label, value: asset.fieldValues?.[f.key] ?? null })) },
    };
  }

  /** العهد حسب الموظف */
  async custodyBoard(actor: OrgUser) {
    const org = actor.organizationId;
    const rows: { custodian_employee_id: string; n: number; cost: string; nbv: string }[] = await this.db.query(
      `SELECT custodian_employee_id, COUNT(*)::int AS n, COALESCE(SUM(cost), 0) AS cost, COALESCE(SUM(cost - accum), 0) AS nbv
         FROM acc_assets WHERE organization_id = $1 AND custodian_employee_id IS NOT NULL AND status IN ('draft', 'pending_purchase', 'active', 'pending_sale')
        GROUP BY 1`, [org]);
    const emps = await this.employees(org, rows.map((r) => r.custodian_employee_id));
    const units = await this.units(org);
    const unconfirmed: { to_employee_id: string; n: number }[] = await this.db.query(
      `SELECT c.to_employee_id, COUNT(*)::int AS n FROM acc_asset_custody c JOIN acc_assets a ON a.id = c.asset_id AND a.custodian_employee_id = c.to_employee_id
        WHERE c.organization_id = $1 AND c.confirmed_at IS NULL AND c.kind <> 'release'
          AND c.form_no = (SELECT MAX(form_no) FROM acc_asset_custody x WHERE x.asset_id = c.asset_id) GROUP BY 1`, [org]);
    const [none] = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM acc_assets a JOIN acc_asset_groups g ON g.id = a.group_id
        WHERE a.organization_id = $1 AND g.is_tangible AND a.custodian_employee_id IS NULL AND a.status IN ('draft', 'pending_purchase', 'active', 'pending_sale')`, [org]);
    return {
      employees: rows.map((r) => {
        const e = emps.find((x) => x.id === r.custodian_employee_id);
        return {
          employeeId: r.custodian_employee_id, name: e?.fullName ?? '', employeeNo: e?.employeeNo ?? null, unitName: units.find((u) => u.id === e?.unitId)?.name ?? '',
          employeeStatus: e?.status ?? '', assets: r.n, cost: Number(r.cost), nbv: Number(r.nbv), unconfirmed: unconfirmed.find((u) => u.to_employee_id === r.custodian_employee_id)?.n ?? 0,
        };
      }).sort((a, b) => b.assets - a.assets),
      withoutCustodian: none.n as number,
      recent: (await this.custodyOf(org, null)).slice(0, 30),
    };
  }

  /** الأصول التي في عهدة موظف حاليًا (لإخلاء الطرف) */
  async heldBy(org: string, employeeId: string, em: EntityManager = this.db.manager) {
    const rows: { id: string; code: string; name: string; status: AssetStatus }[] = await em.query(
      `SELECT id, code, name, status FROM acc_assets WHERE organization_id = $1 AND custodian_employee_id = $2
          AND status IN ('draft', 'pending_purchase', 'active', 'pending_sale') ORDER BY asset_no`, [org, employeeId]);
    return rows;
  }

  /** يمنع إخلاء طرف موظف لديه عهدة أصول ثابتة حتى تُستلم منه أو تُنقل لموظف آخر */
  async assertNoCustody(org: string, employeeId: string, em: EntityManager = this.db.manager) {
    const held = await this.heldBy(org, employeeId, em);
    if (held.length) {
      throw new ConflictException(`لدى الموظف عهدة أصول ثابتة (${held.map((h) => `${h.code} ${h.name}`).join('، ')}). لا يُقبل إخلاء طرفه إلا بعد استلامها منه أو نقلها لموظف آخر من شاشة العهد في الأصول الثابتة`);
    }
  }

  // ---------------- الجرد الدوري ----------------

  async stocktakes(actor: OrgUser) {
    const rows = await this.db.getRepository(AssetStocktake).find({ where: { organizationId: actor.organizationId }, order: { stocktakeNo: 'DESC' } });
    return rows.map((s) => this.stocktakeView(s, false));
  }

  stocktakeView(s: AssetStocktake, full = true) {
    const c = (r: StocktakeLine['result']) => s.lines.filter((l) => l.result === r).length;
    const moved = s.lines.filter((l) => l.result === 'found' && l.foundLocation && l.expectedLocation && l.foundLocation !== l.expectedLocation).length;
    return {
      id: s.id, stocktakeNo: s.stocktakeNo, title: s.title, date: s.date, scope: s.scope, status: s.status, createdByName: s.createdByName,
      closedAt: s.closedAt, closedByName: s.closedByName,
      counts: { total: s.lines.length, found: c('found'), missing: c('missing'), pending: c('pending'), moved, extras: s.extras.length },
      ...(full ? { lines: s.lines, extras: s.extras } : {}),
    };
  }

  async createStocktake(actor: OrgUser, input: Record<string, unknown>) {
    this.need(actor, P.assetsCustody, 'ليست لديك صلاحية الجرد');
    const org = actor.organizationId;
    const groupIds = (Array.isArray(input.groupIds) ? input.groupIds : []).map(optId).filter(Boolean) as string[];
    const location = str(input.location, 250);
    const qb = this.db.getRepository(FixedAsset).createQueryBuilder('a').where('a.organization_id = :org', { org })
      .andWhere(`a.status IN ('draft', 'pending_purchase', 'active', 'pending_sale')`);
    if (groupIds.length) qb.andWhere('a.group_id IN (:...g)', { g: groupIds });
    if (location) qb.andWhere('a.location ILIKE :l', { l: `%${location}%` });
    const assets = await qb.orderBy('a.asset_no', 'ASC').getMany();
    if (!assets.length) bad('لا توجد أصول في نطاق الجرد');
    const emps = await this.employees(org, [...new Set(assets.map((a) => a.custodianEmployeeId).filter(Boolean))] as string[]);
    const groups = groupIds.length ? await this.db.getRepository(AssetGroup).find({ where: { id: In(groupIds) } }) : [];
    const label = [groups.length ? groups.map((g) => g.name).join('، ') : 'كل المجموعات', location ? `الموقع: ${location}` : null].filter(Boolean).join(' · ');
    const s = await this.db.transaction(async (em) => {
      await this.lock(em, org);
      return em.getRepository(AssetStocktake).save(em.create(AssetStocktake, {
        organizationId: org, stocktakeNo: await this.nextNo(em, 'acc_asset_stocktakes', 'stocktake_no', org),
        title: str(input.title, 200) ?? `جرد الأصول ${today()}`, date: dateOrToday(input.date), scope: { groupIds, location, label }, status: 'open', createdByName: actor.fullName,
        lines: assets.map((a) => ({
          assetId: a.id, code: a.code, name: a.name, expectedLocation: a.location, expectedCustodian: emps.find((e) => e.id === a.custodianEmployeeId)?.fullName ?? null,
          result: 'pending' as const, foundLocation: null, condition: null, notes: null, countedByName: null, countedAt: null,
        })),
        extras: [],
      }));
    });
    return this.stocktakeView(s);
  }

  async stocktake(actor: OrgUser, id: string) {
    const s = await this.db.getRepository(AssetStocktake).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!s) throw new NotFoundException('الجرد غير موجود');
    return this.stocktakeView(s);
  }

  /** تسجيل نتيجة جرد أصل (بمسح ملصق QR أو كتابة الترميز) */
  async count(actor: OrgUser, id: string, input: Record<string, unknown>) {
    this.need(actor, P.assetsCustody, 'ليست لديك صلاحية الجرد');
    const org = actor.organizationId;
    let result: { matched: boolean; code: string; name: string | null } = { matched: false, code: '', name: null };
    await this.db.transaction(async (em) => {
      const s = await em.getRepository(AssetStocktake).createQueryBuilder('s').setLock('pessimistic_write')
        .where('s.id = :id AND s.organization_id = :org', { id, org }).getOne() ?? bad('الجرد غير موجود');
      if (s.status !== 'open') bad('الجرد مغلق');
      let code = (str(input.code, 300) ?? bad('امسح الملصق أو اكتب ترميز الأصل')).trim();
      const m = code.match(/\/assets\/a\/([^/?#]+)/);
      if (m) code = decodeURIComponent(m[1]);
      code = code.toUpperCase();
      const line = s.lines.find((l) => l.code === code);
      const at = new Date().toISOString();
      if (!line) {
        s.extras = [...s.extras.filter((x) => x.code !== code), { code, note: str(input.notes, 500), byName: actor.fullName, at }];
        const [a] = await em.query('SELECT name FROM acc_assets WHERE organization_id = $1 AND code = $2', [org, code]);
        result = { matched: false, code, name: a?.name ?? null };
      } else {
        const missing = input.result === 'missing';
        Object.assign(line, {
          result: missing ? 'missing' : 'found', foundLocation: missing ? null : str(input.location, 250) ?? line.expectedLocation,
          condition: str(input.condition, 60), notes: str(input.notes, 500), countedByName: actor.fullName, countedAt: at,
        });
        result = { matched: true, code, name: line.name };
      }
      await em.getRepository(AssetStocktake).update({ id }, { lines: s.lines, extras: s.extras });
    });
    return { ...result, stocktake: await this.stocktake(actor, id) };
  }

  async closeStocktake(actor: OrgUser, id: string) {
    this.need(actor, P.assetsCustody, 'ليست لديك صلاحية الجرد');
    const org = actor.organizationId;
    const s = await this.db.getRepository(AssetStocktake).findOne({ where: { id, organizationId: org } }) ?? bad('الجرد غير موجود');
    if (s.status !== 'open') bad('الجرد مغلق بالفعل');
    const lines = s.lines.map((l) => (l.result === 'pending' ? { ...l, result: 'missing' as const, notes: l.notes ?? 'لم يُعثر عليه أثناء الجرد' } : l));
    await this.db.getRepository(AssetStocktake).update({ id }, { lines, status: 'closed', closedAt: new Date(), closedByName: actor.fullName });
    return this.stocktake(actor, id);
  }
}

export const MOVE_AR: Record<string, string> = {
  opening: 'رصيد افتتاحي', purchase: 'شراء', donation: 'تبرع عيني', addition: 'إضافة وتحسين', sale: 'بيع', scrap: 'تخريد',
};
export const dateOrToday = (v: unknown) => (v ? dateOf(v, 'التاريخ') : today());
export const addDaysIso = (s: string, n: number) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export type { DepMethod };
