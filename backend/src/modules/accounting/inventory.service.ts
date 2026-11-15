import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Organization } from '../../core/entities';
import { AccCore, CONTINUOUS, isBuiltin, serialSource, voucherNo } from './acc-core.service';
import { FiscalYear, InventoryRow, VoucherInventory, VoucherSequence } from './entities/accounting.entity';

/** مقارنة صفوف المحضر بغض النظر عن ترتيب المفاتيح (jsonb يعيد ترتيبها) */
const key = (r: InventoryRow) => [r.voucherType, r.first, r.last, r.count, r.posted, r.cancelled, r.draft, r.missing.join(',')].join('|');
const sameRows = (a: InventoryRow[], b: InventoryRow[]) => a.length === b.length && a.every((r, i) => key(r) === key(b[i]));

/**
 * محضر جرد السندات الإلكتروني: يحدد لكل نوع سند أول رقم وآخر رقم تُغلق عليه السنة،
 * وعدد المرحّل والملغي وغير المرحّل. يعتمده مدير النظام بنفسه، ولا تُغلق السنة بدونه.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly db: DataSource, private readonly core: AccCore) {}

  private async snapshot(em: EntityManager, year: FiscalYear): Promise<InventoryRow[]> {
    const out: InventoryRow[] = [];
    for (const t of await this.core.allTypes(year.organizationId, em)) {
      const src = serialSource(t).sql;
      const [r]: { first: number | null; last: number | null; count: number; posted: number; cancelled: number; draft: number }[] = await em.query(
        `SELECT MIN(voucher_serial)::int AS first, MAX(voucher_serial)::int AS last, COUNT(*)::int AS count,
                COUNT(*) FILTER (WHERE status = 'posted')::int AS posted, COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
                COUNT(*) FILTER (WHERE status = 'draft')::int AS draft
           FROM (${src}) s`, [year.id]);
      let missing: number[] = [];
      if (r.first !== null && r.last !== null && r.last - r.first + 1 !== r.count) {
        const serials: { s: number }[] = await em.query(
          `SELECT g AS s FROM generate_series($2::int, $3::int) g WHERE g NOT IN (SELECT voucher_serial FROM (${src}) s) LIMIT 50`,
          [year.id, r.first, r.last]);
        missing = serials.map((x) => Number(x.s));
      }
      // نوع السند الخاص بالجمعية لا يظهر في المحضر إلا إن صدر منه سند في السنة
      if (!isBuiltin(t) && !r.count) continue;
      out.push({
        voucherType: t, first: r.first, last: r.last, count: r.count, posted: r.posted, cancelled: r.cancelled, draft: r.draft, missing,
      });
    }
    return out;
  }

  async get(actor: OrgUser, yearId: string) {
    const org = actor.organizationId;
    const year = await this.core.year(org, yearId);
    const [inv, orgRow, seqs] = await Promise.all([
      this.db.getRepository(VoucherInventory).findOne({ where: { fiscalYearId: year.id } }),
      this.db.getRepository(Organization).findOneOrFail({ where: { id: org } }),
      this.db.getRepository(VoucherSequence).find({ where: { fiscalYearId: year.id } }),
    ]);
    const current = await this.snapshot(this.db.manager, year);
    const labels = await this.core.typeLabels(org);
    const rows = inv?.rows ?? current;
    return {
      year: { id: year.id, name: year.name, startDate: year.startDate, endDate: year.endDate, status: year.status },
      organizationName: orgRow.name,
      inventory: inv && {
        id: inv.id, status: inv.status, notes: inv.notes, preparedByName: inv.preparedByName, preparedAt: inv.preparedAt,
        approvedByName: inv.approvedByName, approvedAt: inv.approvedAt,
      },
      /** هل تغيرت السندات بعد إعداد المحضر؟ */
      outdated: !!inv && !sameRows(inv.rows, current),
      rows: rows.map((r) => {
        const seq = seqs.find((s) => s.voucherType === r.voucherType);
        return {
          ...r, label: labels[r.voucherType] ?? r.voucherType, continuous: CONTINUOUS.includes(r.voucherType),
          firstNo: r.first !== null ? voucherNo(r.voucherType, r.first, year.name) : null,
          lastNo: r.last !== null ? voucherNo(r.voucherType, r.last, year.name) : null,
          rangeStart: seq?.startSerial ?? 1, rangeEnd: seq?.endSerial ?? null,
        };
      }),
      canApprove: actor.isSuperadmin,
    };
  }

  /** إعداد المحضر (أو إعادة إعداده قبل الاعتماد) من واقع السندات في النظام */
  async prepare(actor: OrgUser, yearId: string, notes: string | null) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const year = await this.core.year(org, yearId, em);
      const repo = em.getRepository(VoucherInventory);
      const inv = await repo.findOne({ where: { fiscalYearId: year.id } });
      if (inv?.status === 'approved') throw new ConflictException('المحضر معتمد. ألغِ الاعتماد أولًا لإعادة إعداده');
      const rows = await this.snapshot(em, year);
      await repo.save(repo.create({
        ...(inv ?? {}), organizationId: org, fiscalYearId: year.id, status: 'draft', rows, notes, preparedByName: actor.fullName, preparedAt: new Date(),
        approvedByName: null, approvedAt: null,
      }));
    });
    return this.get(actor, yearId);
  }

  /** الاعتماد: من مدير النظام بنفسه فقط، وبعد ترحيل أو إلغاء كل القيود */
  async approve(actor: OrgUser, yearId: string) {
    if (!actor.isSuperadmin) throw new ForbiddenException('محضر جرد السندات يعتمده مدير النظام بنفسه');
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const year = await this.core.year(org, yearId, em);
      const repo = em.getRepository(VoucherInventory);
      const inv = await repo.findOne({ where: { fiscalYearId: year.id } });
      if (!inv) throw new NotFoundException('أعدّ المحضر أولًا');
      if (inv.status === 'approved') throw new ConflictException('المحضر معتمد بالفعل');
      const rows = await this.snapshot(em, year);
      if (!sameRows(rows, inv.rows)) throw new ConflictException('تغيرت السندات بعد إعداد المحضر. أعد إعداده ثم اعتمده');
      const drafts = rows.reduce((s, r) => s + r.draft, 0);
      if (drafts) throw new ConflictException(`في السنة ${drafts} سند غير مرحّل. رحّلها أو ألغها قبل اعتماد المحضر`);
      if (rows.some((r) => r.missing.length)) throw new ConflictException('توجد أرقام سندات مفقودة داخل المدى، راجع الدعم الفني');
      await repo.update({ id: inv.id }, { status: 'approved', approvedByName: actor.fullName, approvedAt: new Date() });
      // السنة التالية تبدأ أرقام القبض والصرف فيها بعد آخر رقم في المحضر، إن لم تصدر فيها سندات بعد
      const next = await em.getRepository(FiscalYear).createQueryBuilder('y')
        .where('y.organization_id = :org AND y.start_date > :d', { org, d: year.endDate }).orderBy('y.startDate', 'ASC').getOne();
      if (next) {
        for (const t of CONTINUOUS) {
          const row = rows.find((r) => r.voucherType === t);
          const seq = await em.getRepository(VoucherSequence).findOne({ where: { fiscalYearId: next.id, voucherType: t } });
          if (row?.last && seq && seq.nextSerial === seq.startSerial) {
            await em.getRepository(VoucherSequence).update({ id: seq.id }, { startSerial: row.last + 1, nextSerial: row.last + 1 });
          }
        }
      }
    });
    return this.get(actor, yearId);
  }

  async revoke(actor: OrgUser, yearId: string) {
    if (!actor.isSuperadmin) throw new ForbiddenException('إلغاء اعتماد محضر الجرد لمدير النظام فقط');
    const org = actor.organizationId;
    const year = await this.core.year(org, yearId);
    if (year.status === 'closed') throw new ConflictException('السنة المالية مغلقة. افتحها أولًا');
    const inv = await this.db.getRepository(VoucherInventory).findOne({ where: { fiscalYearId: year.id } });
    if (inv?.status !== 'approved') throw new ConflictException('المحضر غير معتمد');
    await this.db.getRepository(VoucherInventory).update({ id: inv.id }, { status: 'draft', approvedByName: null, approvedAt: null });
    return this.get(actor, yearId);
  }
}
