import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { MailService } from '../../core/mail/mail.service';
import { mailLayout, publicOrigin } from '../../core/mail/mail-templates';
import { FundraisingService } from '../fundraising/fundraising.service';
import { AvailabilityCheck, BudgetAvailability } from '../planning/budget/budget-availability.service';
import { PrSettings } from './entities/procurement.entity';
import { ApprovalLevel, BudgetCheckSnapshot, EvalCriterion, OrderKind, PurchaseMethod } from './entities/sourcing.entity';
import { prToday } from './procurement-core.service';
import { DEFAULT_APPROVAL_LEVELS, DEFAULT_EVAL_CRITERIA, DEFAULT_ORDER_TERMS } from './procurement-defaults';

export const r2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(4, '0');
export const requestCode = (n: number) => `REQ-${pad(n)}`;
export const rfqCode = (n: number) => `RFQ-${pad(n)}`;
export const orderCode = (n: number) => `PO-${pad(n)}`;
const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** ترتيب أساليب الشراء من الأدنى رقابةً إلى الأعلى */
export const METHOD_RANK: Record<PurchaseMethod, number> = { emergency: 0, direct: 1, quotes: 2, tender: 3 };

/** إعدادات الشراء الفعلية (القيم المقترحة عند عدم ضبطها) */
export function sourcingSettings(s: PrSettings) {
  return {
    methodLimits: s.methodLimits ?? { direct: 10000, quotes: 100000 },
    minQuotes: s.minQuotes ?? 3,
    approvalLevels: (s.approvalLevels?.length ? s.approvalLevels : DEFAULT_APPROVAL_LEVELS) as ApprovalLevel[],
    evalCriteria: (s.evalCriteria?.length ? s.evalCriteria : DEFAULT_EVAL_CRITERIA) as EvalCriterion[],
    technicalPass: s.technicalPass ?? 60,
    orderTerms: s.orderTerms ?? DEFAULT_ORDER_TERMS,
    discloseWinner: !!s.discloseWinner,
  };
}

/** الأسلوب المقترح حسب القيمة التقديرية */
export function suggestMethod(total: number, s: PrSettings): PurchaseMethod {
  const l = sourcingSettings(s).methodLimits;
  if (total <= l.direct) return 'direct';
  if (total <= l.quotes) return 'quotes';
  return 'tender';
}

/** المستويات المطلوبة لاعتماد تعميد بهذه القيمة */
export const levelsFor = (total: number, s: PrSettings) =>
  sourcingSettings(s).approvalLevels.filter((l) => total >= l.minAmount).sort((a, b) => a.minAmount - b.minAmount);

export interface SourcingCheck extends AvailabilityCheck {
  /** مخالفات شروط مصدر التمويل (الغرض، المدة، الحد الأعلى) */
  problems: string[];
}

/** ما يحتاجه فحص الموازنة والتمويل من الطلب أو التعميد */
export interface FundingContext {
  amount: number;
  budgetLineId: string | null;
  fundingBatchId: string | null;
  projectId: string | null;
  kind: OrderKind | 'goods' | 'services' | 'assets' | 'beneficiary';
}

/**
 * أساس الشراء: الترقيم، والربط بنظام التخطيط (بند الموازنة) ونظام تنمية الموارد (مصدر التمويل).
 * قاعدة التعميد (قرار المستخدم): يُفحص مصدر التمويل أولًا إن وُجد، وإلا فبند الموازنة حدٌّ لا يُتجاوز.
 * والتحقق من مصدر التمويل يشمل شروطه: الغرض والمشروع ومدة الاستخدام والحد الأعلى للصرف.
 */
@Injectable()
export class SourcingCore {
  private readonly logger = new Logger(SourcingCore.name);
  constructor(
    private readonly db: DataSource, private readonly avail: BudgetAvailability, private readonly fundraising: FundraisingService, private readonly mail: MailService,
  ) {}

  /** إشعار موردين بالبريد (بريد المنشأة ومستخدمي البوابة النشطين) برابط الصفحة في البوابة */
  async notifySuppliers(org: string, supplierIds: string[], m: { kind: string; title: string; paragraphs: string[]; facts?: { label: string; value: string }[]; path: string; dedupe: string }) {
    if (!supplierIds.length) return;
    try {
      const [o] = await this.db.query('SELECT name, slug FROM organizations WHERE id = $1', [org]);
      const rows: { id: string; name: string; emails: string[] }[] = await this.db.query(
        `SELECT s.id, s.name, ARRAY_REMOVE(ARRAY_AGG(DISTINCT u.email) || ARRAY[s.email]::varchar[], NULL) AS emails
           FROM pr_suppliers s LEFT JOIN pr_supplier_users u ON u.supplier_id = s.id AND u.is_active
          WHERE s.organization_id = $1 AND s.id = ANY($2) GROUP BY s.id`, [org, supplierIds]);
      const url = `${publicOrigin() ?? ''}/supplier/${o?.slug ?? ''}${m.path}`;
      for (const r of rows) {
        const to = [...new Set(r.emails.map((e) => e.toLowerCase()))];
        if (!to.length) continue;
        await this.mail.queue({
          to, kind: m.kind, organizationId: org, dedupeKey: `${m.dedupe}:${r.id}`,
          ...mailLayout({
            title: m.title, greeting: `السادة ${r.name} المحترمين`, paragraphs: [...m.paragraphs, `من ${o?.name ?? 'الجمعية'}.`], facts: m.facts,
            button: { label: 'فتح بوابة الموردين', url },
          }),
        });
      }
    } catch (e) {
      this.logger.warn(`تعذر إشعار الموردين: ${(e as Error).message}`);
    }
  }

  /** الرقم التالي في جدول (تحت قفل الجمعية) */
  async nextNo(em: EntityManager, table: 'pr_requests' | 'pr_rfqs' | 'pr_orders', column: 'request_no' | 'rfq_no' | 'order_no', org: string) {
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${table}:${org}`]);
    const [{ n }] = await em.query(`SELECT COALESCE(MAX(${column}), 0)::int + 1 AS n FROM ${table} WHERE organization_id = $1`, [org]);
    return n as number;
  }

  /** مخالفات شروط مصدر التمويل لهذا الشراء */
  async fundingProblems(org: string, ctx: FundingContext): Promise<string[]> {
    if (!ctx.fundingBatchId) return [];
    const b = await this.fundraising.getBatch(org, ctx.fundingBatchId);
    const out: string[] = [];
    if (b.status !== 'active') out.push(`مصدر التمويل (الدفعة ${b.batchNo}) غير نشط`);
    const c = (b.conditions ?? {}) as { endDate?: string | null; maxSpend?: number | null };
    if (c.endDate && c.endDate < prToday()) out.push(`انتهت فترة استخدام التمويل في ${c.endDate} حسب شروط الداعم`);
    if (c.maxSpend && ctx.amount > c.maxSpend) out.push(`المبلغ يتجاوز الحد الأعلى للصرف في شروط الداعم (${fmt(c.maxSpend)} ريال)`);
    if (b.targetKind === 'program' && b.activityId && b.activityId !== ctx.projectId) {
      out.push(`مصدر التمويل مخصص لمشروع «${b.targetName}»، والشراء غير مرتبط به، فلا يتوافق مع غرض التبرع`);
    }
    if (b.targetKind === 'case' && ctx.kind !== 'beneficiary') out.push('مصدر التمويل مخصص لحالة مستفيد، ولا يُستخدم إلا في تعميد خدمة لمستفيد');
    if (b.targetKind === 'waqf') out.push('مصدر التمويل مخصص لمشروع وقفي، ولا يُصرف في المشتريات من هنا');
    return out;
  }

  /** فحص المبلغ مقابل مصدر التمويل أو بند الموازنة، مع شروط التمويل */
  async check(org: string, ctx: FundingContext): Promise<SourcingCheck> {
    if (!ctx.budgetLineId && !ctx.fundingBatchId) {
      return {
        allowed: false, basis: 'budget', amount: ctx.amount, available: 0, shortfall: ctx.amount, funding: null, line: null, warnings: [], problems: [],
        message: 'لا يوجد بند موازنة ولا مصدر تمويل: حدد أحدهما قبل المتابعة',
      };
    }
    if (!(ctx.amount > 0)) {
      return { allowed: false, basis: ctx.fundingBatchId ? 'funding' : 'budget', amount: 0, available: 0, shortfall: 0, funding: null, line: null, warnings: [], problems: [], message: 'المبلغ صفر' };
    }
    const [c, problems] = await Promise.all([
      this.avail.check(org, { amount: ctx.amount, budgetLineId: ctx.budgetLineId, fundingBatchId: ctx.fundingBatchId }),
      this.fundingProblems(org, ctx),
    ]);
    if (problems.length) return { ...c, allowed: false, problems, message: `لا يُسمح: ${problems[0]}` };
    return { ...c, problems };
  }

  snapshot(c: SourcingCheck): BudgetCheckSnapshot {
    return { allowed: c.allowed, basis: c.basis, amount: c.amount, available: c.available, message: c.message, warnings: [...c.problems, ...c.warnings], at: new Date().toISOString() };
  }

  /**
   * حجز مبلغ التعميد: على بند الموازنة (في التخطيط) إن وُجد، وعلى مصدر التمويل (في تنمية الموارد) إن وُجد.
   * يُرفض إن لم يسمح الفحص. إن فشل حجز التمويل بعد حجز البند يُفك حجز البند.
   */
  async reserve(org: string, ctx: FundingContext & { sourceRef: string; sourceId: string; byName: string; note?: string | null }) {
    const c = await this.check(org, ctx);
    if (!c.allowed) throw new ConflictException(c.message);
    let commitmentId: string | null = null;
    if (ctx.budgetLineId) {
      const r = await this.avail.reserve(org, {
        amount: ctx.amount, budgetLineId: ctx.budgetLineId, fundingBatchId: ctx.fundingBatchId, sourceModule: 'procurement', sourceRef: ctx.sourceRef,
        sourceId: ctx.sourceId, note: ctx.note ?? null, byName: ctx.byName,
      });
      commitmentId = r.commitment.id;
    }
    let fundingReserved = 0;
    if (ctx.fundingBatchId) {
      try {
        await this.fundraising.reserve(org, ctx.fundingBatchId, ctx.amount);
        fundingReserved = ctx.amount;
      } catch (e) {
        if (commitmentId) await this.avail.setStatus(org, commitmentId, 'released').catch(() => undefined);
        throw e;
      }
    }
    return { commitmentId, fundingReserved, snapshot: this.snapshot(c) };
  }

  /** فك الحجز عند إلغاء التعميد أو تخفيضه */
  async release(org: string, o: { commitmentId: string | null; fundingBatchId: string | null; fundingReserved: number }) {
    if (o.commitmentId) {
      await this.avail.setStatus(org, o.commitmentId, 'released').catch((e: Error) => this.logger.warn(`فك حجز البند: ${e.message}`));
    }
    if (o.fundingBatchId && o.fundingReserved > 0) await this.fundraising.release(org, o.fundingBatchId, o.fundingReserved);
  }

  /** خيارات الربط المالي: بنود الموازنة المعتمدة بالمتاح فيها، ومصادر التمويل النشطة بشروطها */
  async budgetOptions(org: string, year: number) {
    const [b, funding] = await Promise.all([
      this.avail.lines(org, year).catch(() => ({ budget: null, lines: [] })),
      this.db.query(
        `SELECT b.id, b.batch_no AS "batchNo", b.target_name AS "targetName", b.target_kind AS "targetKind", b.activity_id AS "activityId", b.is_zakat AS "isZakat",
                b.conditions, (b.amount - b.reserved_amount - b.spent_amount - b.transferred_amount)::float AS available, d.name AS "donorName"
           FROM fundraising_batches b LEFT JOIN fundraising_donors d ON d.id = b.donor_id
          WHERE b.organization_id = $1 AND b.status = 'active' AND b.amount - b.reserved_amount - b.spent_amount - b.transferred_amount > 0
          ORDER BY b.batch_no`, [org]).catch(() => []),
    ]);
    return { budget: b.budget, lines: b.lines, funding };
  }

  /** أسماء بنود الموازنة ومصادر التمويل للعرض */
  async financeLabels(org: string, lineIds: (string | null)[], batchIds: (string | null)[]) {
    const ls = [...new Set(lineIds.filter((x): x is string => !!x))];
    const bs = [...new Set(batchIds.filter((x): x is string => !!x))];
    const [lines, batches] = await Promise.all([
      ls.length ? this.db.query(
        `SELECT l.id, l.name, b.code AS "budgetCode", b.fiscal_year AS year FROM plan_budget_lines l JOIN plan_budgets b ON b.id = l.budget_id
          WHERE l.organization_id = $1 AND l.id = ANY($2)`, [org, ls]).catch(() => []) : [],
      bs.length ? this.db.query(
        `SELECT id, batch_no AS "batchNo", target_name AS "targetName" FROM fundraising_batches WHERE organization_id = $1 AND id = ANY($2)`, [org, bs]).catch(() => []) : [],
    ]);
    return {
      lines: new Map<string, { id: string; name: string; budgetCode: string; year: number }>(lines.map((l: { id: string }) => [l.id, l])),
      batches: new Map<string, { id: string; batchNo: number; targetName: string }>(batches.map((b: { id: string }) => [b.id, b])),
    };
  }

  /** أسماء الإدارات والمشاريع للعرض */
  async orgLabels(org: string, unitIds: (string | null)[], projectIds: (string | null)[]) {
    const us = [...new Set(unitIds.filter((x): x is string => !!x))];
    const ps = [...new Set(projectIds.filter((x): x is string => !!x))];
    const [units, projects] = await Promise.all([
      us.length ? this.db.query('SELECT id, name FROM hr_units WHERE organization_id = $1 AND id = ANY($2)', [org, us]).catch(() => []) : [],
      ps.length ? this.db.query(
        `SELECT a.id, a.name, 'PRJ-' || LPAD(p.project_no::text, 4, '0') AS code FROM activities a LEFT JOIN project_profiles p ON p.activity_id = a.id
          WHERE a.organization_id = $1 AND a.id = ANY($2)`, [org, ps]).catch(() => []) : [],
    ]);
    return {
      units: new Map<string, string>(units.map((u: { id: string; name: string }) => [u.id, u.name])),
      projects: new Map<string, string>(projects.map((p: { id: string; name: string; code: string | null }) => [p.id, p.code ? `${p.code} · ${p.name}` : p.name])),
    };
  }

  /** يتحقق أن بند الموازنة ومصدر التمويل موجودان في الجمعية */
  async assertFinance(org: string, budgetLineId: string | null | undefined, fundingBatchId: string | null | undefined) {
    if (budgetLineId) await this.avail.line(org, budgetLineId);
    if (fundingBatchId) {
      const [b] = await this.db.query('SELECT id FROM fundraising_batches WHERE organization_id = $1 AND id = $2', [org, fundingBatchId]).catch(() => []);
      if (!b) throw new BadRequestException('مصدر التمويل غير موجود');
    }
  }
}
