import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { LedgerEntry, LedgerLine } from './entities';

export interface LedgerLineInput {
  accountCode: string | null;
  accountName: string;
  debit: number;
  credit: number;
  memo?: string | null;
  batchId?: string | null;
  activityId?: string | null;
}

export interface LedgerEntryInput {
  date: string;
  description: string;
  source: { module: string; type: string; id?: string | null };
  activityId?: string | null;
  batchId?: string | null;
  opportunityId?: string | null;
  createdByName?: string | null;
  lines: LedgerLineInput[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * دفتر اليومية المبسط المشترك بين الوحدات (الموارد المالية، المشاريع...).
 * كل قيد متوازن (مجموع المدين = مجموع الدائن)، والتصحيح يكون بقيد عكسي وليس بالتعديل.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly db: DataSource) {}

  async postEntry(orgId: string, input: LedgerEntryInput, m?: EntityManager): Promise<LedgerEntry> {
    const run = async (em: EntityManager) => {
      const lines = input.lines
        .map((l) => ({ ...l, debit: r2(l.debit || 0), credit: r2(l.credit || 0) }))
        .filter((l) => l.debit || l.credit);
      if (lines.length < 2) throw new BadRequestException('القيد يحتاج طرفين على الأقل');
      if (lines.some((l) => l.debit < 0 || l.credit < 0 || (l.debit && l.credit))) {
        throw new BadRequestException('كل سطر في القيد يكون مدينًا أو دائنًا بمبلغ موجب');
      }
      const debit = r2(lines.reduce((s, l) => s + l.debit, 0));
      const credit = r2(lines.reduce((s, l) => s + l.credit, 0));
      if (debit !== credit) throw new BadRequestException(`القيد غير متوازن: المدين ${debit} والدائن ${credit}`);
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ledger:${orgId}`]);
      const [{ next }] = await em.query('SELECT COALESCE(MAX(entry_no), 0) + 1 AS next FROM ledger_entries WHERE organization_id = $1', [orgId]);
      const entry = await em.save(em.create(LedgerEntry, {
        organizationId: orgId, entryNo: Number(next), date: input.date, description: input.description.slice(0, 500),
        sourceModule: input.source.module, sourceType: input.source.type, sourceId: input.source.id ?? null,
        activityId: input.activityId ?? null, batchId: input.batchId ?? null, opportunityId: input.opportunityId ?? null,
        total: debit, status: 'posted', createdByName: input.createdByName ?? null,
      }));
      await em.save(lines.map((l, i) => em.create(LedgerLine, {
        organizationId: orgId, entryId: entry.id, lineNo: i + 1, accountCode: l.accountCode ?? null,
        accountName: l.accountName, debit: l.debit, credit: l.credit, memo: l.memo ?? null,
        batchId: l.batchId ?? null, activityId: l.activityId ?? null,
      })));
      return entry;
    };
    return m ? run(m) : this.db.transaction(run);
  }

  /** قيد عكسي: نفس الأطراف بعكس المدين والدائن، والأصلي يُعلَّم "معكوس" */
  async reverseEntry(orgId: string, entryId: string, reason: string, m?: EntityManager, date?: string): Promise<LedgerEntry> {
    const run = async (em: EntityManager) => {
      const orig = await em.findOne(LedgerEntry, {
        where: { id: entryId, organizationId: orgId }, relations: { lines: true }, lock: { mode: 'pessimistic_write', tables: ['ledger_entries'] },
      });
      if (!orig) throw new NotFoundException('القيد غير موجود');
      if (orig.status === 'reversed') throw new BadRequestException(`القيد رقم ${orig.entryNo} معكوس بالفعل`);
      const rev = await this.postEntry(orgId, {
        date: date ?? new Date().toISOString().slice(0, 10),
        description: `عكس القيد رقم ${orig.entryNo}: ${reason}`,
        source: { module: orig.sourceModule, type: 'reversal', id: orig.sourceId },
        activityId: orig.activityId, batchId: orig.batchId, opportunityId: orig.opportunityId,
        lines: [...orig.lines!].sort((a, b) => a.lineNo - b.lineNo)
          .map((l) => ({ accountCode: l.accountCode, accountName: l.accountName, debit: l.credit, credit: l.debit, memo: l.memo, batchId: l.batchId, activityId: l.activityId })),
      }, em);
      rev.reversalOfId = orig.id;
      await em.update(LedgerEntry, { id: rev.id }, { reversalOfId: orig.id });
      await em.update(LedgerEntry, { id: orig.id }, { status: 'reversed', reversedById: rev.id });
      return rev;
    };
    return m ? run(m) : this.db.transaction(run);
  }

  async listEntries(orgId: string, f: { activityId?: string; batchId?: string; opportunityId?: string; from?: string; to?: string; module?: string } = {}) {
    const qb = this.db.getRepository(LedgerEntry).createQueryBuilder('e')
      .leftJoinAndSelect('e.lines', 'l')
      .where('e.organization_id = :org', { org: orgId })
      .orderBy('e.entry_no', 'DESC').addOrderBy('l.line_no', 'ASC');
    // المشروع أو الدفعة على مستوى القيد أو على مستوى أي سطر فيه
    if (f.activityId) qb.andWhere('(e.activity_id = :a OR EXISTS (SELECT 1 FROM ledger_lines x WHERE x.entry_id = e.id AND x.activity_id = :a))', { a: f.activityId });
    if (f.batchId) qb.andWhere('(e.batch_id = :b OR EXISTS (SELECT 1 FROM ledger_lines x WHERE x.entry_id = e.id AND x.batch_id = :b))', { b: f.batchId });
    if (f.opportunityId) qb.andWhere('e.opportunity_id = :o', { o: f.opportunityId });
    if (f.module) qb.andWhere('e.source_module = :m', { m: f.module });
    if (f.from) qb.andWhere('e.entry_date >= :from', { from: f.from });
    if (f.to) qb.andWhere('e.entry_date <= :to', { to: f.to });
    return qb.take(500).getMany();
  }
}
