import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { LineDto } from '../accounting/accounting.dto';
import { AccountsService } from '../accounting/accounts.service';
import { EntriesService } from '../accounting/entries.service';
import { PrItem, PrItemGroup, PrSettings, PrWarehouse } from './entities/procurement.entity';
import { MoveKind, PrStockBalance, PrStockLayer, PrStockMove, StockDocKind } from './entities/stock.entity';
import { prToday } from './procurement-core.service';
import { r2 } from './sourcing-core.service';

const pad = (n: number) => String(n).padStart(4, '0');
export const receiptCode = (n: number) => `GRN-${pad(n)}`;
export const issueRequestCode = (n: number) => `ISR-${pad(n)}`;
export const countCode = (n: number) => `CNT-${pad(n)}`;
export const DOC_PREFIX: Record<StockDocKind, string> = { issue: 'ISS', transfer: 'TRF', return_supplier: 'RTS', return_in: 'RTN', writeoff: 'WOF' };
export const docCode = (kind: StockDocKind, n: number) => `${DOC_PREFIX[kind]}-${pad(n)}`;
/** الكميات بثلاث خانات عشرية */
export const q3 = (n: number) => Math.round(n * 1000) / 1000;

/** سياق حركة المخزون: المستند ومن نفذها */
export interface MoveCtx {
  org: string;
  date: string;
  docType: 'receipt' | 'doc' | 'count';
  docId: string;
  docCode: string;
  byName: string;
  projectId?: string | null;
  unitId?: string | null;
}

/** ما صُرف من طبقات المخزون في حركة صادرة */
export interface Pick {
  layerId: string;
  lot: string | null;
  expiryDate: string | null;
  locationId: string | null;
  qty: number;
  unitCost: number;
  sourceId: string;
  /** قيمة الكمية المصروفة من الطبقة حسب طريقة التقييم */
  value: number;
}

/** سطر قيد قبل التجميع */
export interface GlLine { accountId: string; debit: number; credit: number; label: string; analyticId?: string | null }

/**
 * أساس المستودعات: دفتر المخزون المستمر (كل حركة تحدّث الرصيد والقيمة فورًا وتُسجَّل بحساب المخزون الذي أثرت فيه)،
 * وطبقات المخزون بالتشغيلة والصلاحية والتكلفة (الصرف بالأقدم أو الأقرب انتهاءً، ولا يُصرف منتهي الصلاحية إلا بالإتلاف)،
 * والتقييم بالمتوسط المرجح أو الوارد أولًا، وتحديد الحسابات، وإصدار سندات المخازن في النظام المالي.
 */
@Injectable()
export class StockCore {
  constructor(private readonly db: DataSource, private readonly entries: EntriesService, private readonly accounts: AccountsService) {}

  /** الرقم التالي في جدول (تحت قفل الجمعية)، ولمستندات المخزون لكل نوع تسلسل مستقل */
  async nextNo(em: EntityManager, table: 'pr_receipts' | 'pr_issue_requests' | 'pr_stock_docs' | 'pr_counts', column: string, org: string, kind?: StockDocKind) {
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${table}:${kind ?? ''}:${org}`]);
    const [{ n }] = await em.query(
      `SELECT COALESCE(MAX(${column}), 0)::int + 1 AS n FROM ${table} WHERE organization_id = $1${kind ? ' AND kind = $2' : ''}`, kind ? [org, kind] : [org]);
    return n as number;
  }

  async warehouse(org: string, id: string, em: EntityManager = this.db.manager) {
    const w = await em.getRepository(PrWarehouse).findOne({ where: { id, organizationId: org } });
    if (!w) throw new NotFoundException('المستودع غير موجود');
    return w;
  }

  /** عمليات المستودع لأمنائه (إن حُدد له أمناء) أو مدير النظام */
  assertKeeper(a: OrgUser, w: PrWarehouse) {
    if (!w.isActive) throw new ConflictException(`المستودع «${w.name}» موقوف`);
    if (a.isSuperadmin || !w.keeperIds?.length || w.keeperIds.includes(a.id)) return;
    throw new ForbiddenException(`العمليات على المستودع «${w.name}» لأمنائه المحددين فقط`);
  }
  isKeeper(a: OrgUser, w: { keeperIds: string[] }) {
    return a.isSuperadmin || !w.keeperIds?.length || w.keeperIds.includes(a.id);
  }

  async items(org: string, ids: string[], em: EntityManager = this.db.manager) {
    const uniq = [...new Set(ids.filter(Boolean))];
    const rows = uniq.length ? await em.getRepository(PrItem).createQueryBuilder('i').where('i.organization_id = :org AND i.id IN (:...ids)', { org, ids: uniq }).getMany() : [];
    const map = new Map(rows.map((r) => [r.id, r]));
    for (const id of uniq) if (!map.has(id)) throw new BadRequestException('أحد الأصناف غير موجود');
    return map;
  }

  /** حسابات الصنف الفعلية (من الصنف ثم مجموعاته صعودًا) */
  async effective(org: string, item: PrItem, s: PrSettings, em: EntityManager = this.db.manager) {
    const groups = await em.getRepository(PrItemGroup).find({ where: { organizationId: org } });
    let inv = item.inventoryAccountId;
    let exp = item.expenseAccountId;
    let val = item.valuation;
    let assetGroupId: string | null = null;
    for (let g = groups.find((x) => x.id === item.groupId); g; g = groups.find((x) => x.id === g!.parentId)) {
      inv ??= g.inventoryAccountId;
      exp ??= g.expenseAccountId;
      val ??= g.valuation;
      assetGroupId ??= g.assetGroupId;
    }
    return { inventoryAccountId: inv, expenseAccountId: exp ?? s.defaultExpenseAccountId, valuation: val ?? s.valuation, assetGroupId };
  }

  /** حساب المخزون للصنف في المستودع: حساب المستودع إن كانت الحسابات على مستوى المستودع، وإلا حساب الصنف أو مجموعته */
  async inventoryAccount(org: string, item: PrItem, w: PrWarehouse, s: PrSettings, em: EntityManager = this.db.manager) {
    const id = s.accountLevel === 'warehouse' ? w.glAccountId ?? (await this.effective(org, item, s, em)).inventoryAccountId : (await this.effective(org, item, s, em)).inventoryAccountId;
    if (!id) {
      throw new BadRequestException(s.accountLevel === 'warehouse'
        ? `حدد حساب المخزون للمستودع «${w.name}» في شاشة المستودعات`
        : `حدد حساب المخزون للصنف «${item.name}» أو لمجموعته في دليل الأصناف`);
    }
    return id;
  }

  async expenseAccount(org: string, item: PrItem | null, s: PrSettings, em: EntityManager = this.db.manager) {
    const id = item ? (await this.effective(org, item, s, em)).expenseAccountId : s.defaultExpenseAccountId;
    if (!id) throw new BadRequestException(`حدد حساب المصروف ${item ? `للصنف «${item.name}» أو لمجموعته، ` : ''}أو حساب المصروف الافتراضي في إعدادات المستودعات`);
    return id;
  }

  private async lockBalance(em: EntityManager, org: string, itemId: string, warehouseId: string) {
    await em.createQueryBuilder().insert().into(PrStockBalance).values({ organizationId: org, itemId, warehouseId, qty: 0, value: 0 }).orIgnore().execute();
    return em.getRepository(PrStockBalance).createQueryBuilder('b').setLock('pessimistic_write')
      .where('b.organization_id = :org AND b.item_id = :itemId AND b.warehouse_id = :warehouseId', { org, itemId, warehouseId }).getOneOrFail();
  }

  private async move(em: EntityManager, ctx: MoveCtx, d: { kind: MoveKind; itemId: string; warehouseId: string; locationId: string | null; lot: string | null; expiryDate: string | null; qty: number; value: number; accountId: string; balance: PrStockBalance; cancelled?: boolean }) {
    await em.getRepository(PrStockMove).insert({
      organizationId: ctx.org, date: ctx.date, kind: d.kind, itemId: d.itemId, warehouseId: d.warehouseId, locationId: d.locationId, lot: d.lot, expiryDate: d.expiryDate,
      qty: q3(d.qty), value: r2(d.value), balanceQty: q3(d.balance.qty), balanceValue: r2(d.balance.value), accountId: d.accountId, docType: ctx.docType, docId: ctx.docId,
      docCode: ctx.docCode, projectId: ctx.projectId ?? null, unitId: ctx.unitId ?? null, cancelled: !!d.cancelled, byName: ctx.byName,
    });
  }

  /** حركة واردة: تزيد الرصيد والقيمة وتُنشئ طبقة بتكلفة الوحدة */
  async inbound(em: EntityManager, ctx: MoveCtx, d: { kind: MoveKind; item: PrItem; warehouseId: string; qty: number; value: number; lot?: string | null; expiryDate?: string | null; locationId?: string | null; accountId: string }) {
    const qty = q3(d.qty);
    if (!(qty > 0)) throw new BadRequestException('الكمية الواردة يجب أن تكون أكبر من صفر');
    if (d.item.trackBatch && !d.lot) throw new BadRequestException(`الصنف «${d.item.name}» يُتتبع بالتشغيلة: اكتب رقم التشغيلة`);
    if (d.item.trackExpiry && !d.expiryDate) throw new BadRequestException(`الصنف «${d.item.name}» له تاريخ صلاحية: حدده`);
    const bal = await this.lockBalance(em, ctx.org, d.item.id, d.warehouseId);
    bal.qty = q3(bal.qty + qty);
    bal.value = r2(bal.value + d.value);
    await em.getRepository(PrStockBalance).update({ id: bal.id }, { qty: bal.qty, value: bal.value });
    await em.getRepository(PrStockLayer).insert({
      organizationId: ctx.org, itemId: d.item.id, warehouseId: d.warehouseId, locationId: d.locationId ?? null, lot: d.lot ?? null, expiryDate: d.expiryDate ?? null,
      date: ctx.date, unitCost: Math.round((d.value / qty) * 10000) / 10000, qtyIn: qty, qtyLeft: qty, sourceId: ctx.docId,
    });
    await this.move(em, ctx, { kind: d.kind, itemId: d.item.id, warehouseId: d.warehouseId, locationId: d.locationId ?? null, lot: d.lot ?? null, expiryDate: d.expiryDate ?? null, qty, value: d.value, accountId: d.accountId, balance: bal });
  }

  /**
   * حركة صادرة: تختار الطبقات (تشغيلة محددة، أو الأقرب انتهاءً، أو الأقدم) وتحسب القيمة بطريقة التقييم،
   * وتمنع صرف منتهي الصلاحية إلا في الإتلاف. تعيد القيمة والطبقات المصروفة.
   */
  async outbound(em: EntityManager, ctx: MoveCtx, d: {
    kind: MoveKind; item: PrItem; warehouseId: string; warehouseName: string; qty: number; valuation: 'avg' | 'fifo'; accountId: string;
    lot?: string | null; locationId?: string | null; sourceId?: string | null; allowExpired?: boolean;
    /** التشغيلة كما هي (بلا تشغيلة = الطبقات التي ليس لها تشغيلة) */
    exactLot?: boolean; expiryDate?: string | null;
  }) {
    const qty = q3(d.qty);
    if (!(qty > 0)) throw new BadRequestException('الكمية الصادرة يجب أن تكون أكبر من صفر');
    const bal = await this.lockBalance(em, ctx.org, d.item.id, d.warehouseId);
    const today = prToday();
    const layers: PrStockLayer[] = await em.getRepository(PrStockLayer).createQueryBuilder('l').setLock('pessimistic_write')
      .where('l.organization_id = :org AND l.item_id = :item AND l.warehouse_id = :wh AND l.qty_left > 0', { org: ctx.org, item: d.item.id, wh: d.warehouseId })
      .andWhere(d.lot ? 'l.lot = :lot' : d.exactLot ? 'l.lot IS NULL' : '1=1', { lot: d.lot })
      .andWhere(d.exactLot ? (d.expiryDate ? 'l.expiry_date = :exp' : 'l.expiry_date IS NULL') : '1=1', { exp: d.expiryDate })
      .andWhere(d.locationId ? 'l.location_id = :loc' : '1=1', { loc: d.locationId })
      .andWhere(d.sourceId ? 'l.source_id = :src' : '1=1', { src: d.sourceId })
      .andWhere(d.allowExpired ? '1=1' : '(l.expiry_date IS NULL OR l.expiry_date >= :today)', { today })
      .orderBy(d.item.issuePolicy === 'fefo' ? 'l.expiryDate' : 'l.date', 'ASC', 'NULLS LAST').addOrderBy('l.date', 'ASC').addOrderBy('l.createdAt', 'ASC').getMany();
    const available = q3(layers.reduce((s, l) => s + l.qtyLeft, 0));
    if (available + 0.0005 < qty) {
      const expired = d.allowExpired ? 0 : Number((await em.query(
        `SELECT COALESCE(SUM(qty_left), 0)::float AS n FROM pr_stock_layers WHERE organization_id = $1 AND item_id = $2 AND warehouse_id = $3 AND qty_left > 0 AND expiry_date < $4`,
        [ctx.org, d.item.id, d.warehouseId, today]))[0].n);
      throw new ConflictException(`الرصيد المتاح من «${d.item.name}» في المستودع «${d.warehouseName}»${d.lot ? ` (التشغيلة ${d.lot})` : ''} هو ${available}، والمطلوب ${qty}`
        + (expired > 0 ? `. ويوجد ${q3(expired)} منتهية الصلاحية لا تُصرف إلا بالإتلاف` : ''));
    }
    const picks: Pick[] = [];
    let left = qty;
    for (const l of layers) {
      if (left <= 0) break;
      const take = q3(Math.min(left, l.qtyLeft));
      picks.push({ layerId: l.id, lot: l.lot, expiryDate: l.expiryDate, locationId: l.locationId, qty: take, unitCost: l.unitCost, sourceId: l.sourceId, value: 0 });
      await em.getRepository(PrStockLayer).update({ id: l.id }, { qtyLeft: q3(l.qtyLeft - take) });
      left = q3(left - take);
    }
    // القيمة: آخر كمية في المستودع تأخذ القيمة المتبقية كاملة حتى لا تبقى كسور
    let value: number;
    if (q3(bal.qty - qty) <= 0) value = bal.value;
    else if (d.valuation === 'fifo') value = r2(picks.reduce((s, p) => s + p.qty * p.unitCost, 0));
    else value = r2(bal.qty > 0 ? (qty * bal.value) / bal.qty : 0);
    bal.qty = q3(bal.qty - qty);
    bal.value = r2(bal.value - value);
    await em.getRepository(PrStockBalance).update({ id: bal.id }, { qty: bal.qty, value: bal.value });
    // حركة لكل تشغيلة/موقع لتبقى بطاقة الصنف مفصلة، وتتوزع القيمة عليها بنسبة الكمية
    let rest = value;
    for (const [i, p] of picks.entries()) {
      const v = i === picks.length - 1 ? rest : r2((value * p.qty) / qty);
      rest = r2(rest - v);
      p.value = v;
      await this.move(em, ctx, { kind: d.kind, itemId: d.item.id, warehouseId: d.warehouseId, locationId: p.locationId, lot: p.lot, expiryDate: p.expiryDate, qty: -p.qty, value: -v, accountId: d.accountId, balance: bal });
    }
    return { value: r2(value), picks };
  }

  /** إلغاء حركات واردة لم يُصرف منها شيء (إلغاء الاستلام): تُحذف طبقاتها وتُسجل حركات عكسية */
  async reverseInbound(em: EntityManager, ctx: MoveCtx, sourceId: string) {
    const layers = await em.getRepository(PrStockLayer).createQueryBuilder('l').setLock('pessimistic_write')
      .where('l.organization_id = :org AND l.source_id = :src', { org: ctx.org, src: sourceId }).getMany();
    if (layers.some((l) => q3(l.qtyLeft) !== q3(l.qtyIn))) return false;
    const moves = await em.getRepository(PrStockMove).find({ where: { organizationId: ctx.org, docId: sourceId, cancelled: false } });
    for (const m of moves.filter((x) => x.qty > 0)) {
      const bal = await this.lockBalance(em, ctx.org, m.itemId, m.warehouseId);
      bal.qty = q3(bal.qty - m.qty);
      bal.value = bal.qty <= 0 ? 0 : r2(bal.value - m.value);
      await em.getRepository(PrStockBalance).update({ id: bal.id }, { qty: bal.qty, value: bal.value });
      await this.move(em, ctx, { kind: m.kind, itemId: m.itemId, warehouseId: m.warehouseId, locationId: m.locationId, lot: m.lot, expiryDate: m.expiryDate, qty: -m.qty, value: -m.value, accountId: m.accountId!, balance: bal, cancelled: true });
    }
    await em.getRepository(PrStockMove).update({ organizationId: ctx.org, docId: sourceId }, { cancelled: true });
    await em.getRepository(PrStockLayer).delete({ organizationId: ctx.org, sourceId });
    return true;
  }

  /** يجمع أسطر القيد بالحساب ومركز التكلفة والجانب، ويتحقق من مراكز التكلفة الإلزامية، ثم يصدر سند المخازن */
  async postEntry(em: EntityManager, actor: { id: string | null; fullName: string; organizationId: string }, head: { documentDate: string; description: string; counterparty?: string | null }, raw: GlLine[], where: string) {
    const org = actor.organizationId;
    // صافي كل حساب ومركز تكلفة (التحويل بين مستودعين بنفس الحساب لا يصدر له قيد)
    const agg = new Map<string, { accountId: string; analyticId: string | null; label: string; net: number }>();
    for (const l of raw) {
      const key = `${l.accountId}|${l.analyticId ?? ''}`;
      const x = agg.get(key) ?? { accountId: l.accountId, analyticId: l.analyticId ?? null, label: l.label, net: 0 };
      x.net = r2(x.net + l.debit - l.credit);
      agg.set(key, x);
    }
    for (const [k, x] of agg) if (!x.net) agg.delete(k);
    if (!agg.size) return null;
    const lines: LineDto[] = [];
    for (const l of agg.values()) {
      const acc = await this.accounts.postable(org, l.accountId, em).catch((e: Error) => { throw new BadRequestException(`${where}: ${e.message}`); });
      if (acc.requiresAnalytic && !l.analyticId) throw new BadRequestException(`الحساب ${acc.code} «${acc.name}» يلزمه مركز تكلفة: حدده في ${where}`);
      lines.push({
        accountId: l.accountId, debit: l.net > 0 ? l.net : 0, credit: l.net < 0 ? -l.net : 0, label: l.label.slice(0, 250), partnerId: null,
        analytic: l.analyticId ? [{ analyticId: l.analyticId, percent: 100 }] : [],
      });
    }
    const e = await this.entries.createStockEntry(em, actor, head, lines);
    return e.id;
  }

  async cancelEntry(em: EntityManager, actor: { fullName: string; organizationId: string }, entryId: string | null, reason: string) {
    if (entryId) await this.entries.cancelStockEntry(em, actor, entryId, reason);
  }

  /** رقم السند في النظام المالي للعرض */
  async entryRef(org: string, entryId: string | null) {
    if (!entryId) return null;
    const [e] = await this.db.query(
      `SELECT e.id, e.entry_no AS "entryNo", e.voucher_serial AS serial, e.status, y.name AS year FROM acc_entries e JOIN acc_fiscal_years y ON y.id = e.fiscal_year_id
        WHERE e.organization_id = $1 AND e.id = $2`, [org, entryId]);
    return e ? { id: e.id, entryNo: e.entryNo, status: e.status, voucherNo: `${e.serial}/${e.year}` } : null;
  }

  /** أرصدة صنف في مستودع بالتشغيلة والصلاحية والموقع */
  async lots(org: string, itemId: string, warehouseId: string) {
    return this.db.query(
      `SELECT l.lot, to_char(l.expiry_date, 'YYYY-MM-DD') AS "expiryDate", l.location_id AS "locationId", loc.name AS "locationName", SUM(l.qty_left)::float AS qty,
              (l.expiry_date IS NOT NULL AND l.expiry_date < $4) AS expired
         FROM pr_stock_layers l LEFT JOIN pr_locations loc ON loc.id = l.location_id
        WHERE l.organization_id = $1 AND l.item_id = $2 AND l.warehouse_id = $3 AND l.qty_left > 0
        GROUP BY l.lot, l.expiry_date, l.location_id, loc.name ORDER BY l.expiry_date NULLS LAST, l.lot`, [org, itemId, warehouseId, prToday()]);
  }
}
