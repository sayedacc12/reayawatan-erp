import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { r2 } from './budget-calc';
import { Budget, BudgetCommitment, BudgetLine, BudgetVersion } from './budget.entity';

export interface FundingAvailability {
  batchId: string; batchNo: number; targetName: string; status: string; amount: number; reserved: number; spent: number; transferred: number; available: number;
}
export interface LineAvailability {
  lineId: string; budgetId: string; budgetCode: string; fiscalYear: number; name: string; section: string; unitName: string | null; accountCode: string | null;
  approved: boolean; budgeted: number; reserved: number; consumed: number; available: number;
}
export interface AvailabilityCheck {
  allowed: boolean;
  /** funding: الحد هو رصيد مصدر التمويل · budget: لا مصدر تمويل فالحد هو بند الموازنة */
  basis: 'funding' | 'budget';
  amount: number; available: number; shortfall: number; message: string; warnings: string[];
  funding: FundingAvailability | null; line: LineAvailability | null;
}

/**
 * «المتاح» للصرف، وقاعدة التعميد (قرار المستخدم):
 * 1) إن كان للصرف مصدر تمويل (تبرع مقيد أو منحة = دفعة في نظام تنمية الموارد) يُفحص رصيد المصدر أولًا ولا يُتجاوز،
 *    وتجاوز بند الموازنة عندها تنبيه فقط.
 * 2) إن لم يوجد مصدر تمويل، فبند الموازنة المعتمد حدٌّ لا يُتجاوز.
 * يستدعيها نظام المشتريات (لاحقًا) قبل التعميد، ثم reserve/consume/release لتسجيل الحجز على البند.
 */
@Injectable()
export class BudgetAvailability {
  constructor(private readonly db: DataSource) {}

  async funding(org: string, batchId: string, em: EntityManager = this.db.manager): Promise<FundingAvailability> {
    const [b] = await em.query(
      `SELECT id, batch_no AS "batchNo", target_name AS "targetName", status, amount::float, reserved_amount::float AS reserved, spent_amount::float AS spent, transferred_amount::float AS transferred
         FROM fundraising_batches WHERE organization_id = $1 AND id = $2`, [org, batchId]).catch(() => []);
    if (!b) throw new NotFoundException('مصدر التمويل غير موجود');
    const available = b.status === 'active' ? r2(b.amount - b.reserved - b.spent - b.transferred) : 0;
    return { batchId: b.id, batchNo: b.batchNo, targetName: b.targetName, status: b.status, amount: r2(b.amount), reserved: r2(b.reserved), spent: r2(b.spent), transferred: r2(b.transferred), available };
  }

  /** مصادر التمويل المتاحة (الدفعات النشطة التي بقي فيها رصيد) */
  async fundingSources(org: string) {
    const rows: { id: string }[] = await this.db.query(
      `SELECT id FROM fundraising_batches WHERE organization_id = $1 AND status = 'active'
          AND amount - reserved_amount - spent_amount - transferred_amount > 0 ORDER BY batch_no`, [org]).catch(() => []);
    return Promise.all(rows.map((r) => this.funding(org, r.id)));
  }

  /** المتاح في بند: المعتمد (من آخر إصدار معتمد إن كانت الموازنة قيد تعديل) ناقص المحجوز والمصروف */
  async line(org: string, lineId: string, em: EntityManager = this.db.manager): Promise<LineAvailability> {
    const l = await em.getRepository(BudgetLine).findOne({ where: { id: lineId, organizationId: org } });
    if (!l) throw new NotFoundException('بند الموازنة غير موجود');
    const b = await em.getRepository(Budget).findOneOrFail({ where: { id: l.budgetId } });
    let budgeted = 0;
    if (b.status === 'approved') budgeted = l.included ? l.amount : 0;
    else if (b.version > 0) {
      const v = await em.getRepository(BudgetVersion).findOne({ where: { budgetId: b.id, version: b.version } });
      const sl = v?.snapshot.lines.find((x) => x.id === l.id);
      budgeted = sl && sl.included ? sl.amount : 0;
    }
    const [c] = await em.query(
      `SELECT COALESCE(SUM(CASE WHEN status = 'reserved' THEN amount END), 0)::float AS reserved, COALESCE(SUM(CASE WHEN status = 'consumed' THEN amount END), 0)::float AS consumed
         FROM plan_budget_commitments WHERE line_id = $1`, [l.id]);
    return {
      lineId: l.id, budgetId: b.id, budgetCode: b.code, fiscalYear: b.fiscalYear, name: l.name, section: l.section, unitName: l.unitName, accountCode: l.accountCode,
      approved: b.version > 0, budgeted: r2(budgeted), reserved: r2(c.reserved), consumed: r2(c.consumed), available: r2(budgeted - c.reserved - c.consumed),
    };
  }

  /** بنود المصروفات في الموازنة المعتمدة للسنة مع المتاح في كل بند */
  async lines(org: string, year: number) {
    const b = await this.db.getRepository(Budget).findOne({ where: { organizationId: org, fiscalYear: year, isScenario: false }, order: { version: 'DESC', updatedAt: 'DESC' } });
    if (!b || b.version < 1) return { budget: null, lines: [] as LineAvailability[] };
    const ls = await this.db.getRepository(BudgetLine).find({ where: { budgetId: b.id }, order: { section: 'ASC', sortOrder: 'ASC' }, select: ['id', 'section', 'kind', 'included'] });
    const out: LineAvailability[] = [];
    for (const l of ls.filter((x) => x.included && x.section !== 'revenue' && x.kind !== 'employee')) out.push(await this.line(org, l.id));
    return { budget: { id: b.id, code: b.code, title: b.title, version: b.version }, lines: out };
  }

  /** فحص صرف مبلغ: يرجع هل يُسمح به وعلى أي أساس، وما المتاح والعجز */
  async check(org: string, input: { amount: number; budgetLineId?: string | null; fundingBatchId?: string | null }, em: EntityManager = this.db.manager): Promise<AvailabilityCheck> {
    const amount = r2(Number(input.amount));
    if (!(amount > 0)) throw new BadRequestException('المبلغ يجب أن يكون أكبر من صفر');
    if (!input.budgetLineId && !input.fundingBatchId) throw new BadRequestException('حدد بند الموازنة أو مصدر التمويل');
    const line = input.budgetLineId ? await this.line(org, input.budgetLineId, em) : null;
    const warnings: string[] = [];
    const fmt = (v: number) => v.toLocaleString('en-US');
    if (input.fundingBatchId) {
      const f = await this.funding(org, input.fundingBatchId, em);
      const allowed = f.available >= amount;
      if (line && line.available < amount) warnings.push(`المبلغ يتجاوز المتاح في بند الموازنة «${line.name}» (${fmt(line.available)})، والصرف محكوم برصيد مصدر التمويل`);
      if (line && !line.approved) warnings.push('بند الموازنة غير معتمد بعد');
      return {
        allowed, basis: 'funding', amount, available: f.available, shortfall: allowed ? 0 : r2(amount - f.available), funding: f, line, warnings,
        message: allowed ? `يُسمح: رصيد مصدر التمويل (الدفعة ${f.batchNo}) ${fmt(f.available)}` : `لا يُسمح: المبلغ يتجاوز رصيد مصدر التمويل (الدفعة ${f.batchNo}) المتاح ${fmt(f.available)}`,
      };
    }
    const l = line!;
    if (!l.approved) {
      return { allowed: false, basis: 'budget', amount, available: 0, shortfall: amount, funding: null, line: l, warnings, message: 'لا يُسمح: الموازنة غير معتمدة، ولا يوجد مصدر تمويل' };
    }
    const allowed = l.available >= amount;
    return {
      allowed, basis: 'budget', amount, available: l.available, shortfall: allowed ? 0 : r2(amount - l.available), funding: null, line: l, warnings,
      message: allowed ? `يُسمح: المتاح في بند الموازنة «${l.name}» ${fmt(l.available)}` : `لا يُسمح: لا يوجد مصدر تمويل، والمبلغ يتجاوز المتاح في بند الموازنة «${l.name}» (${fmt(l.available)})`,
    };
  }

  /** حجز على بند (من نظام آخر) بعد تطبيق القاعدة؛ يُرفض إن لم يُسمح */
  async reserve(org: string, input: { amount: number; budgetLineId: string; fundingBatchId?: string | null; sourceModule: string; sourceRef: string; sourceId?: string | null; note?: string | null; byName: string }) {
    return this.db.transaction(async (em) => {
      await em.query('SELECT id FROM plan_budget_lines WHERE id = $1 AND organization_id = $2 FOR UPDATE', [input.budgetLineId, org]);
      const c = await this.check(org, input, em);
      if (!c.allowed) throw new ConflictException(c.message);
      const repo = em.getRepository(BudgetCommitment);
      const row = await repo.save(repo.create({
        organizationId: org, budgetId: c.line!.budgetId, lineId: input.budgetLineId, fundingBatchId: input.fundingBatchId ?? null, sourceModule: input.sourceModule.slice(0, 40),
        sourceRef: input.sourceRef.slice(0, 120), sourceId: input.sourceId ?? null, amount: c.amount, status: 'reserved', note: input.note ?? null, createdByName: input.byName,
      }));
      return { commitment: row, check: c };
    });
  }

  async setStatus(org: string, id: string, status: 'consumed' | 'released') {
    const repo = this.db.getRepository(BudgetCommitment);
    const c = await repo.findOne({ where: { id, organizationId: org } });
    if (!c) throw new NotFoundException('الحجز غير موجود');
    if (c.status !== 'reserved') throw new ConflictException('الحجز ليس قائمًا');
    c.status = status;
    return repo.save(c);
  }
}
