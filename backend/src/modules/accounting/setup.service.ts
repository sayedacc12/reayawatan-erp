import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, MoreThan } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Organization } from '../../core/entities';
import {
  AccCore, addDays, addMonths, cents, CONTINUOUS, fmtSar, fromCents, monthsBetween, serialSource, today,
} from './acc-core.service';
import { SequencesDto, SetupDto, SetupUpdateDto } from './accounting.dto';
import { EntriesService } from './entries.service';
import { FiscalYear, JournalEntry, PeriodLock, VoucherInventory, VoucherSequence } from './entities/accounting.entity';

/** فارق بين رصيد نهاية المدة في سنة ورصيد بداية المدة في السنة التالية */
export interface OpeningMismatch {
  fromYear: number; toYear: number; toYearId: string;
  rows: { accountCode: string; accountName: string; partnerName: string | null; expected: number; actual: number }[];
}

type OpeningLine = { accountId: string; partnerId: string | null; net: number };

/**
 * الافتتاحيات والبيانات الأساسية والسنوات المالية: الإعداد الأول، فتح سنة جديدة بقيد افتتاحي آلي
 * (يُقفل فيه نتائج النشاط في صافي الأصول)، إغلاق الشهور والسنوات وفكها، ومتابعة اختلاف الأرصدة بين السنوات.
 */
@Injectable()
export class SetupService {
  constructor(private readonly db: DataSource, private readonly core: AccCore, private readonly entries: EntriesService) {}

  async overview(actor: OrgUser) {
    const org = actor.organizationId;
    const [years, orgRow, seqs, locks, invs, s] = await Promise.all([
      this.core.years(org),
      this.db.getRepository(Organization).findOneOrFail({ where: { id: org } }),
      this.db.getRepository(VoucherSequence).find({ where: { organizationId: org } }),
      this.db.getRepository(PeriodLock).find({ where: { organizationId: org } }),
      this.db.getRepository(VoucherInventory).find({ where: { organizationId: org } }),
      this.core.settings(org),
    ]);
    const counts: { fiscal_year_id: string; status: string; n: number }[] = await this.db.query(
      'SELECT fiscal_year_id, status, COUNT(*)::int AS n FROM acc_entries WHERE organization_id = $1 GROUP BY 1, 2', [org]);
    const now = today();
    const [types, labels] = await Promise.all([this.core.allTypes(org), this.core.typeLabels(org)]);
    const last = years[years.length - 1];
    const next = last ? this.nextYearWindow(last) : null;
    return {
      configured: years.length > 0,
      taxNumber: orgRow.taxNumber,
      organizationName: orgRow.name,
      today: now,
      closingAccountId: s.closingAccountId,
      years: years.map((y) => ({
        id: y.id, name: y.name, startDate: y.startDate, endDate: y.endDate, isFirst: y.isFirst, status: y.status,
        closedAt: y.closedAt, closedByName: y.closedByName, reopenedAt: y.reopenedAt, reopenedByName: y.reopenedByName,
        isCurrent: y.startDate <= now && now <= y.endDate,
        months: monthsBetween(y.startDate, y.endDate).map((m) => {
          const lock = locks.find((l) => l.fiscalYearId === y.id && l.month === m);
          return { month: m, closed: !!lock, closedAt: lock?.closedAt ?? null, closedByName: lock?.closedByName ?? null };
        }),
        sequences: types.map((t) => {
          const q = seqs.find((x) => x.fiscalYearId === y.id && x.voucherType === t);
          return {
            voucherType: t, label: labels[t] ?? t, continuous: CONTINUOUS.includes(t),
            startSerial: q?.startSerial ?? 1, endSerial: q?.endSerial ?? null, nextSerial: q?.nextSerial ?? 1,
          };
        }),
        entries: Object.fromEntries(counts.filter((c) => c.fiscal_year_id === y.id).map((c) => [c.status, c.n])),
        inventory: invs.find((i) => i.fiscalYearId === y.id)?.status ?? null,
      })),
      nextYear: next && {
        name: last.name + 1, startDate: next.start, endDate: next.end, opensOn: next.opensOn, canOpen: now >= next.opensOn,
      },
      mismatches: await this.mismatches(org),
    };
  }

  /** نافذة السنة التالية: تبدأ بعد نهاية آخر سنة، ولا تُفتح قبل بدايتها بأكثر من شهرين */
  private nextYearWindow(last: FiscalYear) {
    const start = addDays(last.endDate, 1);
    return { start, end: addDays(addMonths(start, 12), -1), opensOn: addMonths(start, -2) };
  }

  private checkFuture(start: string) {
    const opensOn = addMonths(start, -2);
    if (today() < opensOn) {
      throw new BadRequestException(`لا يمكن فتح سنة مالية مستقبلية قبل بدايتها بأكثر من شهرين. هذه السنة تبدأ ${start} ويمكن فتحها من ${opensOn}`);
    }
  }

  /** الإعداد الأول: السنة المالية وتواريخها، والرقم الضريبي، وبداية أرقام سندات القبض والصرف */
  async setup(actor: OrgUser, dto: SetupDto) {
    const org = actor.organizationId;
    if (dto.endDate <= dto.startDate) throw new BadRequestException('تاريخ نهاية السنة المالية يجب أن يكون بعد تاريخ بدايتها');
    if (addDays(addMonths(dto.startDate, 12), -1) !== dto.endDate) {
      throw new BadRequestException('السنة المالية 12 شهرًا: تاريخ النهاية يكون قبل نفس تاريخ البداية في العام التالي بيوم');
    }
    let start = dto.startDate;
    let end = dto.endDate;
    if (dto.isFirstYear) {
      if (!dto.firstYearStart || !dto.firstYearEnd) throw new BadRequestException('اكتب تاريخ بداية ونهاية السنة المالية الأولى');
      if (dto.firstYearEnd <= dto.firstYearStart) throw new BadRequestException('نهاية السنة المالية الأولى يجب أن تكون بعد بدايتها');
      if (dto.firstYearEnd > addDays(addMonths(dto.firstYearStart, 24), -1)) throw new BadRequestException('السنة المالية الأولى لا تزيد عن 24 شهرًا');
      start = dto.firstYearStart;
      end = dto.firstYearEnd;
    } else if (!dto.receiptStart || !dto.paymentStart) {
      throw new BadRequestException('اكتب أول رقم لسندات القبض وأول رقم لسندات الصرف، تاليًا لآخر رقم في محضر جرد السندات للسنة السابقة');
    }
    this.checkFuture(start);
    await this.db.transaction(async (em) => {
      if (await em.getRepository(FiscalYear).exist({ where: { organizationId: org } })) throw new ConflictException('تم إعداد الافتتاحيات من قبل');
      const year = await em.getRepository(FiscalYear).save(em.create(FiscalYear, {
        organizationId: org, name: dto.fiscalYear, startDate: start, endDate: end, isFirst: dto.isFirstYear, status: 'open',
      }));
      // السنة الأولى: سندات القبض والصرف تبدأ من 1 تلقائيًا
      await this.createSequences(em, year, dto.isFirstYear ? 1 : dto.receiptStart!, dto.isFirstYear ? 1 : dto.paymentStart!);
      if (dto.taxNumber !== undefined) await em.update(Organization, { id: org }, { taxNumber: dto.taxNumber ?? null });
    });
    return this.overview(actor);
  }

  private async createSequences(em: EntityManager, year: FiscalYear, receipt: number, payment: number) {
    const repo = em.getRepository(VoucherSequence);
    for (const t of await this.core.allTypes(year.organizationId, em)) {
      const start = t === 'receipt' ? receipt : t === 'payment' ? payment : 1;
      await repo.save(repo.create({ organizationId: year.organizationId, fiscalYearId: year.id, voucherType: t, startSerial: start, nextSerial: start }));
    }
  }

  async updateBasics(actor: OrgUser, dto: SetupUpdateDto) {
    if (dto.taxNumber !== undefined) await this.db.getRepository(Organization).update({ id: actor.organizationId }, { taxNumber: dto.taxNumber ?? null });
    return this.overview(actor);
  }

  /** تعديل مدى أرقام السندات: البداية تُعدَّل قبل إصدار أول سند فقط */
  async saveSequences(actor: OrgUser, yearId: string, dto: SequencesDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const year = await this.core.year(org, yearId, em);
      if (year.status === 'closed') throw new ConflictException('السنة المالية مغلقة');
      const repo = em.getRepository(VoucherSequence);
      const labels = await this.core.typeLabels(org, em);
      for (const s of dto.sequences) {
        const q = await repo.findOne({ where: { fiscalYearId: year.id, voucherType: s.voucherType } });
        if (!q) continue;
        const used = q.nextSerial > q.startSerial;
        if (s.startSerial !== q.startSerial) {
          if (used) throw new ConflictException(`صدرت سندات من نوع ${labels[s.voucherType]}، فلا يمكن تغيير أول رقم في المدى`);
          if (year.isFirst && CONTINUOUS.includes(s.voucherType)) {
            throw new BadRequestException('في السنة المالية الأولى تبدأ سندات القبض والصرف من رقم 1 تلقائيًا');
          }
          q.startSerial = s.startSerial;
          q.nextSerial = s.startSerial;
        }
        if (s.endSerial != null && s.endSerial < q.nextSerial - 1) {
          throw new BadRequestException(`نهاية مدى ${labels[s.voucherType]} أقل من آخر رقم صدر (${q.nextSerial - 1})`);
        }
        if (s.endSerial != null && s.endSerial < q.startSerial) throw new BadRequestException(`نهاية مدى ${labels[s.voucherType]} قبل بدايته`);
        q.endSerial = s.endSerial ?? null;
        await repo.save(q);
      }
    });
    return this.overview(actor);
  }

  // ---------------- إغلاق الفترات ----------------

  async closeMonth(actor: OrgUser, yearId: string, month: string) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const y = await this.core.year(org, yearId, em);
      if (y.status === 'closed') throw new ConflictException('السنة المالية مغلقة');
      if (!monthsBetween(y.startDate, y.endDate).includes(month)) throw new BadRequestException('الشهر خارج السنة المالية');
      if (await this.core.isMonthLocked(org, month, em)) throw new ConflictException('الشهر مغلق بالفعل');
      // الإغلاق بالتسلسل: لا يُغلق شهر وما قبله من شهور السنة مفتوح
      const before = monthsBetween(y.startDate, y.endDate).filter((m) => m < month);
      if (before.length) {
        const locked = await em.getRepository(PeriodLock).count({ where: { organizationId: org, fiscalYearId: y.id, month: In(before) } });
        if (locked < before.length) throw new ConflictException('أغلق الشهور السابقة أولًا: لا يُغلق شهر وما قبله مفتوح');
      }
      const from = `${month}-01` < y.startDate ? y.startDate : `${month}-01`;
      const to = addDays(addMonths(`${month}-01`, 1), -1);
      const drafts = await this.entries.draftCount(em, org, from, to);
      if (drafts) throw new ConflictException(`لا يُغلق الشهر قبل ترحيل كل مستنداته: فيه ${drafts} قيد غير مرحّل. رحّلها أو ألغها أولًا`);
      const open = await this.entries.openVoucherCount(em, org, from, to);
      if (open) throw new ConflictException(`لا يُغلق الشهر قبل ترحيل كل مستنداته: فيه ${open} سند قبض أو صرف لم يكتمل اعتماده أو عليه طلب معلق`);
      await em.getRepository(PeriodLock).save(em.create(PeriodLock, { organizationId: org, fiscalYearId: y.id, month, closedByName: actor.fullName }));
    });
    return this.overview(actor);
  }

  /** شاشة إغلاق الفترات: شهور السنة مع حالة كل شهر وما يمنع إغلاقه */
  async periods(actor: OrgUser, yearId: string) {
    const org = actor.organizationId;
    const y = await this.core.year(org, yearId);
    const locks = await this.db.getRepository(PeriodLock).find({ where: { organizationId: org, fiscalYearId: y.id } });
    const drafts: { m: string; n: number }[] = await this.db.query(
      `SELECT to_char(document_date, 'YYYY-MM') AS m, COUNT(*)::int AS n FROM acc_entries
        WHERE organization_id = $1 AND status = 'draft' AND document_date BETWEEN $2 AND $3 GROUP BY 1`, [org, y.startDate, y.endDate]);
    const open: { m: string; n: number }[] = await this.db.query(
      `SELECT to_char(voucher_date, 'YYYY-MM') AS m, COUNT(*)::int AS n FROM acc_vouchers
        WHERE organization_id = $1 AND voucher_date BETWEEN $2 AND $3 AND (status IN ('draft', 'pending', 'returned') OR request_kind IS NOT NULL) GROUP BY 1`,
      [org, y.startDate, y.endDate]);
    const posted: { m: string; n: number }[] = await this.db.query(
      `SELECT to_char(document_date, 'YYYY-MM') AS m, COUNT(*)::int AS n FROM acc_entries
        WHERE organization_id = $1 AND status = 'posted' AND document_date BETWEEN $2 AND $3 GROUP BY 1`, [org, y.startDate, y.endDate]);
    const n = (rows: { m: string; n: number }[], m: string) => rows.find((r) => r.m === m)?.n ?? 0;
    const now = today().slice(0, 7);
    return {
      year: {
        id: y.id, name: y.name, status: y.status, startDate: y.startDate, endDate: y.endDate, closedAt: y.closedAt, closedByName: y.closedByName,
        reopenedAt: y.reopenedAt, reopenedByName: y.reopenedByName,
        inventory: (await this.db.getRepository(VoucherInventory).findOne({ where: { fiscalYearId: y.id } }))?.status ?? null,
      },
      months: monthsBetween(y.startDate, y.endDate).map((m) => {
        const lock = locks.find((l) => l.month === m);
        return {
          month: m, closed: !!lock, closedAt: lock?.closedAt ?? null, closedByName: lock?.closedByName ?? null, future: m > now,
          draftEntries: n(drafts, m), openVouchers: n(open, m), postedEntries: n(posted, m),
        };
      }),
    };
  }

  /** إغلاق عدة شهور دفعة واحدة: يُغلق كل شهر جاهز، ويُرجع سبب تعذر إغلاق الباقي */
  async closeMonths(actor: OrgUser, yearId: string, months: string[]) {
    const done: string[] = [];
    const failed: { month: string; reason: string }[] = [];
    for (const m of [...new Set(months)].sort()) {
      try {
        await this.closeMonth(actor, yearId, m);
        done.push(m);
      } catch (e) {
        failed.push({ month: m, reason: (e as Error).message });
      }
    }
    return { done, failed, ...(await this.periods(actor, yearId)) };
  }

  async reopenMonths(actor: OrgUser, yearId: string, months: string[]) {
    const done: string[] = [];
    const failed: { month: string; reason: string }[] = [];
    for (const m of [...new Set(months)].sort().reverse()) {
      try {
        await this.reopenMonth(actor, yearId, m);
        done.push(m);
      } catch (e) {
        failed.push({ month: m, reason: (e as Error).message });
      }
    }
    return { done, failed, ...(await this.periods(actor, yearId)) };
  }

  async reopenMonth(actor: OrgUser, yearId: string, month: string) {
    const org = actor.organizationId;
    const y = await this.core.year(org, yearId);
    if (y.status === 'closed') throw new ConflictException('السنة المالية مغلقة. افتح السنة أولًا ثم فك إغلاق الشهر');
    // الفتح بعكس التسلسل: لا يُفتح شهر وما بعده مغلق
    const later = await this.db.getRepository(PeriodLock).count({ where: { organizationId: org, fiscalYearId: y.id, month: MoreThan(month) } });
    if (later) throw new ConflictException('افتح الشهور اللاحقة أولًا: لا يُفتح شهر وما بعده مغلق');
    const r = await this.db.getRepository(PeriodLock).delete({ organizationId: org, fiscalYearId: y.id, month });
    if (!r.affected) throw new ConflictException('الشهر غير مغلق');
    return this.overview(actor);
  }

  /** إغلاق السنة: يتطلب محضر جرد سندات معتمدًا، وعدم وجود قيود غير مرحّلة، ويغلق كل شهورها */
  async closeYear(actor: OrgUser, yearId: string) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const y = await this.core.year(org, yearId, em);
      if (y.status === 'closed') throw new ConflictException('السنة المالية مغلقة بالفعل');
      const prev = await em.getRepository(FiscalYear).findOne({ where: { organizationId: org, endDate: addDays(y.startDate, -1) } });
      if (prev && prev.status !== 'closed') throw new ConflictException(`أغلق السنة المالية ${prev.name} أولًا`);
      const drafts = await this.entries.draftCount(em, org, y.startDate, y.endDate);
      if (drafts) throw new ConflictException(`في السنة ${drafts} قيد غير مرحّل. رحّلها أو ألغها قبل إغلاق السنة`);
      if (await this.entries.openVoucherCount(em, org, y.startDate, y.endDate)) throw new ConflictException('توجد سندات قبض أو صرف لم يكتمل اعتمادها أو عليها طلبات معلقة');
      const inv = await em.getRepository(VoucherInventory).findOne({ where: { fiscalYearId: y.id } });
      if (inv?.status !== 'approved') {
        throw new ConflictException('لا تُغلق السنة إلا بعد إعداد محضر جرد السندات الإلكتروني واعتماده من مدير النظام');
      }
      // لا يُقبل داخل السنة المغلقة سندات خارج مدى محضر الجرد المعتمد
      for (const row of inv.rows) {
        const src = serialSource(row.voucherType).sql;
        const [r] = await em.query(
          `SELECT COUNT(*)::int AS n FROM (${src}) s WHERE ($2::int IS NULL OR voucher_serial < $2 OR voucher_serial > $3)`, [y.id, row.first, row.last]);
        const [all] = await em.query(`SELECT COUNT(*)::int AS n FROM (${src}) s`, [y.id]);
        if ((row.first === null && all.n > 0) || (row.first !== null && r.n > 0) || all.n !== row.count) {
          throw new ConflictException(`توجد ${(await this.core.typeLabels(org, em))[row.voucherType] ?? row.voucherType} خارج مدى محضر الجرد المعتمد. أعد إعداد المحضر واعتماده`);
        }
      }
      for (const m of monthsBetween(y.startDate, y.endDate)) {
        await em.createQueryBuilder().insert().into(PeriodLock)
          .values({ organizationId: org, fiscalYearId: y.id, month: m, closedByName: actor.fullName }).orIgnore().execute();
      }
      await em.update(FiscalYear, { id: y.id }, { status: 'closed', closedAt: new Date(), closedByName: actor.fullName });
    });
    return this.overview(actor);
  }

  /** فك إغلاق السنة (صاحب الصلاحية): تبقى شهورها مغلقة حتى يُفك إغلاق الشهر المطلوب */
  async reopenYear(actor: OrgUser, yearId: string) {
    const org = actor.organizationId;
    const y = await this.core.year(org, yearId);
    if (y.status !== 'closed') throw new ConflictException('السنة المالية مفتوحة');
    const next = await this.db.getRepository(FiscalYear).findOne({ where: { organizationId: org, startDate: addDays(y.endDate, 1) } });
    if (next?.status === 'closed') throw new ConflictException(`السنة ${next.name} مغلقة، افتحها أولًا`);
    await this.db.getRepository(FiscalYear).update({ id: y.id }, { status: 'open', reopenedAt: new Date(), reopenedByName: actor.fullName });
    return this.overview(actor);
  }

  // ---------------- فتح سنة جديدة ----------------

  /** أرصدة نهاية المدة لسنة: حسابات الميزانية برصيدها، ونتائج النشاط (إيرادات - مصروفات) تُقفل في حساب صافي الأصول */
  private async closingBalances(em: EntityManager, org: string, year: FiscalYear, closingAccountId: string | null) {
    const rows: { account_id: string; partner_id: string | null; nature: string; net: string }[] = await em.query(
      `SELECT l.account_id, l.partner_id, a.nature, SUM(l.debit - l.credit) AS net
         FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id JOIN acc_accounts a ON a.id = l.account_id
        WHERE e.organization_id = $1 AND e.fiscal_year_id = $2 AND e.status = 'posted'
        GROUP BY l.account_id, l.partner_id, a.nature`, [org, year.id]);
    const lines = new Map<string, OpeningLine>();
    let result = 0;
    for (const r of rows) {
      const net = cents(r.net);
      if (r.nature === 'revenue' || r.nature === 'expenses') {
        result += net;
        continue;
      }
      const key = `${r.account_id}|${r.partner_id ?? ''}`;
      lines.set(key, { accountId: r.account_id, partnerId: r.partner_id, net: (lines.get(key)?.net ?? 0) + net });
    }
    if (result) {
      if (!closingAccountId) throw new BadRequestException('حدد حساب إقفال نتائج النشاط (من حسابات صافي الأصول) في إعدادات النظام المالي');
      const key = `${closingAccountId}|`;
      lines.set(key, { accountId: closingAccountId, partnerId: null, net: (lines.get(key)?.net ?? 0) + result });
    }
    return [...lines.values()].filter((l) => l.net !== 0);
  }

  async openNextYear(actor: OrgUser) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const years = await this.core.years(org, em);
      const last = years[years.length - 1];
      if (!last) throw new BadRequestException('أعدّ الافتتاحيات والسنة المالية الأولى أولًا');
      const now = today();
      if (years.some((y) => y.startDate > now)) throw new ConflictException('لا يمكن فتح أكثر من سنة مالية مستقبلية واحدة');
      const w = this.nextYearWindow(last);
      this.checkFuture(w.start);
      const { closingAccountId } = await this.core.settings(org, em);
      const year = await em.getRepository(FiscalYear).save(em.create(FiscalYear, {
        organizationId: org, name: last.name + 1, startDate: w.start, endDate: w.end, isFirst: false, status: 'open',
      }));
      // أرقام القبض والصرف تبدأ بعد محضر جرد السنة السابقة (أو بعد آخر رقم صدر)
      const [r, p] = await Promise.all(['receipt', 'payment'].map((t) => this.continueFrom(em, last, t as 'receipt' | 'payment')));
      await this.createSequences(em, year, r, p);
      await this.writeOpening(em, actor, last, year, closingAccountId);
    });
    return this.overview(actor);
  }

  private async continueFrom(em: EntityManager, prev: FiscalYear, type: 'receipt' | 'payment') {
    const inv = await em.getRepository(VoucherInventory).findOne({ where: { fiscalYearId: prev.id } });
    const row = inv?.status === 'approved' ? inv.rows.find((x) => x.voucherType === type) : undefined;
    if (row?.last) return row.last + 1;
    const seq = await em.getRepository(VoucherSequence).findOne({ where: { fiscalYearId: prev.id, voucherType: type } });
    return seq?.nextSerial ?? 1;
  }

  private async writeOpening(em: EntityManager, actor: OrgUser, prev: FiscalYear, year: FiscalYear, closingAccountId: string | null) {
    const balances = await this.closingBalances(em, actor.organizationId, prev, closingAccountId);
    if (!balances.length) return;
    await this.entries.createSystemEntry(em, actor, year, 'opening', {
      documentDate: year.startDate,
      description: `القيد الافتتاحي للسنة المالية ${year.name}: أرصدة نهاية المدة للسنة ${prev.name} وإقفال نتائج النشاط في صافي الأصول`,
    }, balances.map((b) => ({
      accountId: b.accountId, partnerId: b.partnerId, debit: b.net > 0 ? fromCents(b.net) : 0, credit: b.net < 0 ? fromCents(-b.net) : 0,
      label: `رصيد افتتاحي من السنة ${prev.name}`, analytic: [],
    })));
  }

  /** تحديث القيد الافتتاحي بعد تعديل السنة السابقة: يُلغى القديم (يبقى رقمه) ويُنشأ قيد جديد بالأرصدة الحالية */
  async refreshOpening(actor: OrgUser, yearId: string) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const year = await this.core.year(org, yearId, em);
      await this.core.assertWritable(org, year.startDate, em);
      const prev = await em.getRepository(FiscalYear).findOne({ where: { organizationId: org, endDate: addDays(year.startDate, -1) } });
      if (!prev) throw new BadRequestException('لا توجد سنة سابقة لهذه السنة');
      const { closingAccountId } = await this.core.settings(org, em);
      await em.getRepository(JournalEntry).update(
        { fiscalYearId: year.id, voucherType: 'opening', source: 'system', status: 'posted' },
        { status: 'cancelled', cancelledAt: new Date(), cancelledByName: actor.fullName, cancelReason: 'استبدال بقيد افتتاحي محدث بعد تعديل أرصدة السنة السابقة' },
      );
      await this.writeOpening(em, actor, prev, year, closingAccountId);
    });
    return this.overview(actor);
  }

  /** مقارنة أرصدة نهاية كل سنة ببداية السنة التالية (تنبيه مستمر لمدير النظام عند الاختلاف) */
  async mismatches(org: string): Promise<OpeningMismatch[]> {
    const years = await this.core.years(org);
    const { closingAccountId } = await this.core.settings(org);
    const out: OpeningMismatch[] = [];
    for (let i = 1; i < years.length; i++) {
      const prev = years[i - 1];
      const year = years[i];
      if (year.isFirst) continue;
      let expected: OpeningLine[];
      try {
        expected = await this.closingBalances(this.db.manager, org, prev, closingAccountId);
      } catch {
        expected = [];
      }
      const actualRows: { account_id: string; partner_id: string | null; net: string }[] = await this.db.query(
        `SELECT l.account_id, l.partner_id, SUM(l.debit - l.credit) AS net FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id
          WHERE e.fiscal_year_id = $1 AND e.voucher_type = 'opening' AND e.source = 'system' AND e.status = 'posted' GROUP BY 1, 2`, [year.id]);
      const exp = new Map(expected.map((l) => [`${l.accountId}|${l.partnerId ?? ''}`, l.net]));
      const act = new Map(actualRows.map((r) => [`${r.account_id}|${r.partner_id ?? ''}`, cents(r.net)]));
      const diff = [...new Set([...exp.keys(), ...act.keys()])].filter((k) => (exp.get(k) ?? 0) !== (act.get(k) ?? 0));
      if (!diff.length) continue;
      const ids = diff.map((k) => k.split('|'));
      const names = new Map<string, { code: string; name: string }>((await this.db.query(
        'SELECT id, code, name FROM acc_accounts WHERE id = ANY($1)', [ids.map((x) => x[0])])).map((a: { id: string; code: string; name: string }) => [a.id, a]));
      const partners = new Map<string, string>((await this.db.query(
        'SELECT id, name FROM acc_partners WHERE id = ANY($1)', [ids.map((x) => x[1]).filter(Boolean)])).map((p: { id: string; name: string }) => [p.id, p.name]));
      out.push({
        fromYear: prev.name, toYear: year.name, toYearId: year.id,
        rows: diff.map((k) => {
          const [a, p] = k.split('|');
          return {
            accountCode: names.get(a)?.code ?? '', accountName: names.get(a)?.name ?? '', partnerName: p ? partners.get(p) ?? null : null,
            expected: fromCents(exp.get(k) ?? 0), actual: fromCents(act.get(k) ?? 0),
          };
        }),
      });
    }
    return out;
  }

  /** نص التنبيه المختصر */
  static mismatchText(m: OpeningMismatch) {
    const total = m.rows.reduce((s, r) => s + Math.abs(cents(r.expected) - cents(r.actual)), 0);
    return `يوجد اختلاف بين أرصدة نهاية المدة في سنة ${m.fromYear} وبداية المدة في سنة ${m.toYear} (${m.rows.length} حساب، بفارق ${fmtSar(total)})`;
  }
}
