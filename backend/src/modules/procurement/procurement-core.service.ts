import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { toLatinDigits } from '../../core/contact-validation';
import {
  BANK_STATUS, DOC_STATUS, ENTITY_TYPES, ISSUE_POLICY, ITEM_KINDS, LOCATION_KINDS, LOCATION_PURPOSE, LogEntry, PORTAL_ROLES, PrItemGroup, PrSettings,
  PrSupplierCategory, PrUom, SUPPLIER_KINDS, SUPPLIER_STATUS, VALUATION, WAREHOUSE_KINDS,
} from './entities/procurement.entity';
import {
  ORDER_KINDS, ORDER_STATUS, PRIORITIES, PURCHASE_METHODS, QUOTE_STATUS, REQUEST_KINDS, REQUEST_STATUS, RFQ_STATUS,
} from './entities/sourcing.entity';
import { DEFAULT_APPROVAL_LEVELS, DEFAULT_EVAL_CRITERIA, DEFAULT_ORDER_TERMS, DEFAULT_ACTIVITIES, DEFAULT_DOC_TYPES, DEFAULT_ITEM_GROUPS, DEFAULT_SUPPLIER_CATEGORIES, DEFAULT_UOMS } from './procurement-defaults';

/** تاريخ اليوم بتوقيت الرياض */
export const prToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
export const supplierCode = (no: number) => `SUP-${String(no).padStart(4, '0')}`;

/** يوحد الاسم لمنع تكرار الأصناف: بلا تشكيل، والهمزات والتاء المربوطة والياء موحدة، ومسافات مفردة */
export function nameKey(name: string) {
  return toLatinDigits(name)
    .replace(/[ً-ْـ]/g, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 250);
}

/** الآيبان السعودي: SA ورقمان للتحقق ثم 20 رقمًا، مع التحقق الحسابي (mod 97) */
export function ibanProblem(raw: string): string | null {
  const iban = toLatinDigits(raw).replace(/\s+/g, '').toUpperCase();
  if (!/^SA\d{22}$/.test(iban)) return 'رقم الآيبان السعودي يبدأ بـ SA ويتكون من 24 خانة، مثل SA0380000000608010167519';
  const moved = iban.slice(4) + iban.slice(0, 4);
  const digits = moved.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1 ? null : 'رقم الآيبان غير صحيح، تحقق من الأرقام';
}
export const cleanIban = (raw: string) => toLatinDigits(raw).replace(/\s+/g, '').toUpperCase();

/** الرقم الضريبي السعودي: 15 رقمًا يبدأ وينتهي بـ 3 */
export const vatProblem = (v: string) => (/^3\d{13}3$/.test(v) ? null : 'الرقم الضريبي 15 رقمًا يبدأ بـ 3 وينتهي بـ 3');
/** السجل التجاري 10 أرقام (أو الرقم الموحد 7xxxxxxxxx) */
export const crProblem = (v: string) => (/^\d{10}$/.test(v) ? null : 'رقم السجل التجاري 10 أرقام');

export const logEntry = (action: string, byName: string, note: string | null = null): LogEntry => ({ action, note, byName, at: new Date().toISOString() });

/**
 * أساس نظام المشتريات والمستودعات: الإعدادات (تُنشأ بالقيم المقترحة عند أول استخدام)، والقوائم المرجعية،
 * والقراءة من الأنظمة الأخرى للاختيار فقط (الدليل المحاسبي، الهيكل التنظيمي، المشاريع، المستخدمون، مجموعات الأصول).
 */
@Injectable()
export class ProcurementCore {
  constructor(private readonly db: DataSource) {}

  async settings(org: string, em: EntityManager = this.db.manager): Promise<PrSettings> {
    const repo = em.getRepository(PrSettings);
    const s = await repo.findOne({ where: { organizationId: org } });
    if (s) return s;
    await this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`procurement:init:${org}`]);
      if (await tx.getRepository(PrSettings).exists({ where: { organizationId: org } })) return;
      await tx.getRepository(PrSettings).insert({ organizationId: org, supplierDocTypes: DEFAULT_DOC_TYPES, activities: DEFAULT_ACTIVITIES });
      if (!(await tx.getRepository(PrUom).exists({ where: { organizationId: org } }))) {
        await tx.getRepository(PrUom).insert(DEFAULT_UOMS.map((u, i) => ({ organizationId: org, ...u, sortOrder: i })));
      }
      if (!(await tx.getRepository(PrSupplierCategory).exists({ where: { organizationId: org } }))) {
        await tx.getRepository(PrSupplierCategory).insert(DEFAULT_SUPPLIER_CATEGORIES.map((c, i) => ({ organizationId: org, ...c, sortOrder: i })));
      }
      if (!(await tx.getRepository(PrItemGroup).exists({ where: { organizationId: org } }))) {
        const ids = new Map<string, string>();
        for (const [i, g] of DEFAULT_ITEM_GROUPS.entries()) {
          const row = await tx.getRepository(PrItemGroup).save(tx.create(PrItemGroup, {
            organizationId: org, code: g.code, name: g.name, kind: g.kind, parentId: g.parent ? ids.get(g.parent) ?? null : null, sortOrder: i,
          }));
          ids.set(g.code, row.id);
        }
      }
    });
    return repo.findOneOrFail({ where: { organizationId: org } });
  }

  /** حساب فرعي نشط في الدليل بطبيعة محددة */
  async account(org: string, id: string | null | undefined, nature: 'assets' | 'liabilities' | 'expenses' | 'revenue' | 'net_assets' | null, label: string, em: EntityManager = this.db.manager) {
    if (!id) return null;
    const [a] = await em.query('SELECT id, code, name, kind, nature, is_active FROM acc_accounts WHERE organization_id = $1 AND id = $2', [org, id]);
    if (!a) throw new BadRequestException(`${label}: الحساب غير موجود في الدليل`);
    if (a.kind !== 'sub') throw new BadRequestException(`${label}: الحساب ${a.code} ليس حسابًا فرعيًا`);
    if (!a.is_active) throw new BadRequestException(`${label}: الحساب ${a.code} موقوف`);
    if (nature && a.nature !== nature) {
      const names = { assets: 'الأصول', liabilities: 'الخصوم', expenses: 'المصروفات', revenue: 'الإيرادات والتبرعات', net_assets: 'صافي الأصول' };
      throw new BadRequestException(`${label}: يجب أن يكون الحساب من ${names[nature]}`);
    }
    return a as { id: string; code: string; name: string };
  }

  /** أسماء الحسابات بالمعرفات للعرض */
  async accountMap(org: string, ids: (string | null | undefined)[]) {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uniq.length) return new Map<string, { id: string; code: string; name: string }>();
    const rows: { id: string; code: string; name: string }[] = await this.db.query(
      'SELECT id, code, name FROM acc_accounts WHERE organization_id = $1 AND id = ANY($2)', [org, uniq]);
    return new Map(rows.map((r) => [r.id, r]));
  }

  async userNames(org: string, ids: string[]) {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return new Map<string, string>();
    const rows: { id: string; full_name: string }[] = await this.db.query('SELECT id, full_name FROM users WHERE organization_id = $1 AND id = ANY($2)', [org, uniq]);
    return new Map(rows.map((r) => [r.id, r.full_name]));
  }

  /** القوائم المرجعية لشاشات النظام */
  async lookups(org: string) {
    const safe = <T>(p: Promise<T[]>) => p.catch(() => [] as T[]);
    const s = await this.settings(org);
    const [uoms, groups, categories, units, users, projects, assetGroups, accounts, partnerCategories, suppliers, warehouses] = await Promise.all([
      this.db.getRepository(PrUom).find({ where: { organizationId: org }, order: { sortOrder: 'ASC', name: 'ASC' } }),
      this.db.getRepository(PrItemGroup).find({ where: { organizationId: org }, order: { sortOrder: 'ASC', code: 'ASC' } }),
      this.db.getRepository(PrSupplierCategory).find({ where: { organizationId: org }, order: { sortOrder: 'ASC', name: 'ASC' } }),
      safe(this.db.query('SELECT id, name, level FROM hr_units WHERE organization_id = $1 ORDER BY level, sort_order, name', [org])),
      this.db.query('SELECT id, full_name AS "fullName" FROM users WHERE organization_id = $1 AND is_active ORDER BY full_name', [org]),
      safe(this.db.query(
        `SELECT a.id, 'PRJ-' || LPAD(p.project_no::text, 4, '0') AS code, a.name
           FROM activities a JOIN project_profiles p ON p.activity_id = a.id WHERE a.organization_id = $1 ORDER BY p.project_no`, [org])),
      safe(this.db.query('SELECT id, code, name FROM acc_asset_groups WHERE organization_id = $1 AND is_active ORDER BY sort_order, code', [org])),
      safe(this.db.query(
        `SELECT id, code, name, nature FROM acc_accounts WHERE organization_id = $1 AND kind = 'sub' AND is_active AND nature IN ('assets', 'liabilities', 'expenses', 'revenue', 'net_assets') ORDER BY code`, [org])),
      safe(this.db.query(`SELECT id, name FROM acc_partner_categories WHERE organization_id = $1 AND behavior = 'supplier' ORDER BY sort_order, name`, [org])),
      this.db.query(
        `SELECT id, 'SUP-' || LPAD(supplier_no::text, 4, '0') AS code, name, supplier_kind AS "supplierKind", category_ids AS "categoryIds", activities
           FROM pr_suppliers WHERE organization_id = $1 AND status = 'approved' ORDER BY name`, [org]),
      this.db.query('SELECT id, code, name, kind FROM pr_warehouses WHERE organization_id = $1 AND is_active ORDER BY code', [org]),
    ]);
    return {
      settings: s, uoms, groups, categories, units, users, projects, assetGroups, accounts, partnerCategories,
      itemKinds: ITEM_KINDS, valuation: VALUATION, issuePolicy: ISSUE_POLICY, warehouseKinds: WAREHOUSE_KINDS, locationKinds: LOCATION_KINDS,
      locationPurpose: LOCATION_PURPOSE, entityTypes: ENTITY_TYPES, supplierKinds: SUPPLIER_KINDS, supplierStatus: SUPPLIER_STATUS,
      docStatus: DOC_STATUS, bankStatus: BANK_STATUS, portalRoles: PORTAL_ROLES,
      approvedSuppliers: suppliers, activeWarehouses: warehouses,
      sourcing: {
        methodLimits: s.methodLimits ?? { direct: 10000, quotes: 100000 }, minQuotes: s.minQuotes ?? 3,
        approvalLevels: s.approvalLevels?.length ? s.approvalLevels : DEFAULT_APPROVAL_LEVELS,
        evalCriteria: s.evalCriteria?.length ? s.evalCriteria : DEFAULT_EVAL_CRITERIA, technicalPass: s.technicalPass ?? 60,
        orderTerms: s.orderTerms ?? DEFAULT_ORDER_TERMS, discloseWinner: !!s.discloseWinner,
      },
      purchaseMethods: PURCHASE_METHODS, requestKinds: REQUEST_KINDS, priorities: PRIORITIES, requestStatus: REQUEST_STATUS, rfqStatus: RFQ_STATUS,
      quoteStatus: QUOTE_STATUS, orderStatus: ORDER_STATUS, orderKinds: ORDER_KINDS,
    };
  }
}
