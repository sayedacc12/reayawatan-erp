import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { COUNT_KINDS, COUNT_STATUS, CountLine, PrCount } from './entities/stock.entity';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { logEntry, ProcurementCore, prToday } from './procurement-core.service';
import { can } from './requests.service';
import { r2 } from './sourcing-core.service';
import { countCode, GlLine, MoveCtx, q3, StockCore } from './stock-core.service';
import { CountDto, CountLinesDto } from './stock.dto';

/**
 * الجرد الفعلي للتحقق: تُثبَّت أرصدة النظام بالتشغيلة والصلاحية عند فتح الجرد، وتُدخل لجنة الجرد الكميات المعدودة،
 * ثم يعتمد الفروقات مسؤول مختلف عن مُدخلها، فتصدر حركات العجز والزيادة وقيد التسوية بسند مخازن.
 * عند الاعتماد يُعاد احتساب رصيد النظام حتى لا تُحتسب حركات تمت بعد فتح الجرد فروقًا.
 */
@Injectable()
export class CountsService {
  constructor(private readonly db: DataSource, private readonly core: ProcurementCore, private readonly stock: StockCore) {}

  async find(org: string, id: string) {
    const c = await this.db.getRepository(PrCount).findOne({ where: { id, organizationId: org } });
    if (!c) throw new NotFoundException('الجرد غير موجود');
    return c;
  }

  /** أرصدة النظام الحالية للمستودع بالتشغيلة والصلاحية (ومجموعة أصناف إن حُددت) */
  private async snapshot(org: string, warehouseId: string, groupId: string | null) {
    const rows: { item_id: string; lot: string | null; expiry: string | null; qty: string; cost: string }[] = await this.db.query(
      `WITH RECURSIVE g AS (SELECT id FROM pr_item_groups WHERE id = $3 UNION ALL SELECT c.id FROM pr_item_groups c JOIN g ON c.parent_id = g.id)
       SELECT l.item_id, l.lot, to_char(l.expiry_date, 'YYYY-MM-DD') AS expiry, SUM(l.qty_left) AS qty,
              CASE WHEN b.qty > 0 THEN b.value / b.qty ELSE 0 END AS cost
         FROM pr_stock_layers l JOIN pr_items i ON i.id = l.item_id JOIN pr_stock_balances b ON b.item_id = l.item_id AND b.warehouse_id = l.warehouse_id
        WHERE l.organization_id = $1 AND l.warehouse_id = $2 AND l.qty_left > 0 AND ($3::uuid IS NULL OR i.group_id IN (SELECT id FROM g))
        GROUP BY l.item_id, l.lot, l.expiry_date, b.qty, b.value, i.code ORDER BY i.code, l.expiry_date NULLS LAST, l.lot`, [org, warehouseId, groupId]);
    return rows.map((r) => ({ itemId: r.item_id, lot: r.lot, expiryDate: r.expiry, systemQty: q3(Number(r.qty)), unitCost: Math.round(Number(r.cost) * 10000) / 10000 }));
  }

  async create(a: OrgUser, dto: CountDto) {
    if (!can(a, P.stockOperate)) throw new ForbiddenException('فتح الجرد لأمناء المستودعات ومن لديه صلاحية عمليات المستودع');
    const org = a.organizationId;
    const w = await this.stock.warehouse(org, dto.warehouseId);
    this.stock.assertKeeper(a, w);
    const [open] = await this.db.query(`SELECT count_no FROM pr_counts WHERE organization_id = $1 AND warehouse_id = $2 AND status IN ('open', 'submitted') LIMIT 1`, [org, w.id]);
    if (open) throw new ConflictException(`للمستودع جرد مفتوح (${countCode(open.count_no)})، فأكمله أو ألغه أولًا`);
    const snap = await this.snapshot(org, w.id, dto.groupId ?? null);
    if (!snap.length) throw new ConflictException('لا توجد أرصدة في المستودع للجرد');
    const id = await this.db.transaction(async (em) => {
      const no = await this.stock.nextNo(em, 'pr_counts', 'count_no', org);
      const c = await em.save(em.create(PrCount, {
        organizationId: org, countNo: no, kind: dto.kind, warehouseId: w.id, groupId: dto.groupId ?? null, committeeIds: dto.committeeIds ?? [], date: dto.date,
        lines: snap.map((x) => ({ ...x, countedQty: null, diffQty: 0, diffValue: 0, note: null })), notes: dto.notes ?? null, createdByName: a.fullName,
        log: [logEntry('فتح الجرد وتثبيت أرصدة النظام', a.fullName, `${snap.length} سطر`)],
      }));
      return c.id;
    });
    return this.get(a, id);
  }

  private diff(l: CountLine): CountLine {
    if (l.countedQty === null || l.countedQty === undefined) return { ...l, diffQty: 0, diffValue: 0 };
    const d = q3(l.countedQty - l.systemQty);
    return { ...l, diffQty: d, diffValue: r2(d * l.unitCost) };
  }

  async saveLines(a: OrgUser, id: string, dto: CountLinesDto) {
    const c = await this.find(a.organizationId, id);
    if (c.status !== 'open') throw new ConflictException('الجرد ليس مفتوحًا للعد');
    if (!can(a, P.stockOperate) && !c.committeeIds.includes(a.id)) throw new ForbiddenException('إدخال الكميات للجنة الجرد وأمناء المستودع');
    for (const x of dto.lines) {
      const l = c.lines[x.index];
      if (!l) throw new BadRequestException('سطر غير موجود');
      c.lines[x.index] = this.diff({ ...l, countedQty: x.countedQty === null || x.countedQty === undefined ? null : q3(x.countedQty), note: x.note ?? l.note });
    }
    c.lines = [...c.lines];
    await this.db.getRepository(PrCount).save(c);
    return this.get(a, id);
  }

  async submit(a: OrgUser, id: string) {
    const c = await this.find(a.organizationId, id);
    if (c.status !== 'open') throw new ConflictException('الجرد ليس مفتوحًا');
    if (!can(a, P.stockOperate) && !c.committeeIds.includes(a.id)) throw new ForbiddenException('يرسل الجرد أعضاء لجنته أو أمناء المستودع');
    const missing = c.lines.filter((l) => l.countedQty === null || l.countedQty === undefined).length;
    if (missing) throw new BadRequestException(`أدخل الكمية المعدودة لكل الأسطر (باقي ${missing})، واكتب صفرًا لما لم يوجد`);
    c.status = 'submitted';
    c.submittedById = a.id;
    c.shortage = r2(-c.lines.filter((l) => l.diffValue < 0).reduce((t, l) => t + l.diffValue, 0));
    c.surplus = r2(c.lines.filter((l) => l.diffValue > 0).reduce((t, l) => t + l.diffValue, 0));
    c.log = [...c.log, logEntry('إرسال الفروقات للاعتماد', a.fullName, `عجز ${c.shortage} · زيادة ${c.surplus}`)];
    await this.db.getRepository(PrCount).save(c);
    return this.get(a, id);
  }

  async returnCount(a: OrgUser, id: string, note: string) {
    const c = await this.find(a.organizationId, id);
    if (c.status !== 'submitted') throw new ConflictException('الجرد ليس بانتظار الاعتماد');
    if (!can(a, P.stockApprove)) throw new ForbiddenException('لا تملك صلاحية اعتماد الجرد');
    c.status = 'open';
    c.log = [...c.log, logEntry('إعادة الجرد لإعادة العد', a.fullName, note)];
    await this.db.getRepository(PrCount).save(c);
    return this.get(a, id);
  }

  /** اعتماد الفروقات: حركات عجز وزيادة بالتكلفة الحالية، وقيد التسوية مقابل حساب الفروقات */
  async approve(a: OrgUser, id: string, note: string | null) {
    const org = a.organizationId;
    if (!can(a, P.stockApprove)) throw new ForbiddenException('اعتماد فروقات الجرد لمن لديه صلاحية اعتماد عمليات المستودعات');
    const s = await this.core.settings(org);
    await this.db.transaction(async (em) => {
      const c = await em.getRepository(PrCount).createQueryBuilder('c').setLock('pessimistic_write').where('c.id = :id AND c.organization_id = :org', { id, org }).getOne();
      if (!c) throw new NotFoundException('الجرد غير موجود');
      if (c.status !== 'submitted') throw new ConflictException('الجرد ليس بانتظار الاعتماد');
      if (!a.isSuperadmin && c.submittedById === a.id) throw new ForbiddenException('لا يعتمد الفروقاتِ من أدخلها');
      const w = await this.stock.warehouse(org, c.warehouseId, em);
      // رصيد النظام الآن (قد تكون حدثت حركات بعد فتح الجرد)
      const now = await this.snapshot(org, w.id, c.groupId);
      const key = (x: { itemId: string; lot: string | null; expiryDate: string | null }) => `${x.itemId}|${x.lot ?? ''}|${x.expiryDate ?? ''}`;
      const cur = new Map(now.map((x) => [key(x), x]));
      c.lines = c.lines.map((l) => {
        const n = cur.get(key(l));
        return this.diff({ ...l, systemQty: n?.systemQty ?? 0, unitCost: n?.unitCost ?? l.unitCost });
      });
      const changes = c.lines.filter((l) => l.diffQty !== 0);
      if (changes.length && !s.adjustAccountId) throw new BadRequestException('حدد حساب فروقات الجرد والإتلاف في إعدادات المستودعات أولًا');
      const items = await this.stock.items(org, changes.map((l) => l.itemId), em);
      const code = countCode(c.countNo);
      const ctx: MoveCtx = { org, date: c.date > prToday() ? prToday() : c.date, docType: 'count', docId: c.id, docCode: code, byName: a.fullName };
      const gl: GlLine[] = [];
      let shortage = 0;
      let surplus = 0;
      for (const l of changes) {
        const it = items.get(l.itemId)!;
        const eff = await this.stock.effective(org, it, s, em);
        const inv = await this.stock.inventoryAccount(org, it, w, s, em);
        if (l.diffQty < 0) {
          const out = await this.stock.outbound(em, ctx, {
            kind: 'count_out', item: it, warehouseId: w.id, warehouseName: w.name, qty: -l.diffQty, valuation: eff.valuation, accountId: inv, lot: l.lot, exactLot: true,
            expiryDate: l.expiryDate, allowExpired: true,
          });
          l.diffValue = -out.value;
          shortage = r2(shortage + out.value);
          gl.push({ accountId: s.adjustAccountId!, debit: out.value, credit: 0, label: `عجز جرد ${it.name}`, analyticId: s.adjustAnalyticId }, { accountId: inv, debit: 0, credit: out.value, label: `عجز جرد ${it.name}` });
        } else {
          const value = r2(l.diffQty * (l.unitCost || it.refPrice || 0));
          await this.stock.inbound(em, ctx, { kind: 'count_in', item: it, warehouseId: w.id, qty: l.diffQty, value, lot: l.lot, expiryDate: l.expiryDate, accountId: inv });
          l.diffValue = value;
          surplus = r2(surplus + value);
          gl.push({ accountId: inv, debit: value, credit: 0, label: `زيادة جرد ${it.name}` }, { accountId: s.adjustAccountId!, debit: 0, credit: value, label: `زيادة جرد ${it.name}`, analyticId: s.adjustAnalyticId });
        }
      }
      c.entryId = await this.stock.postEntry(em, a, { documentDate: ctx.date, description: `تسوية فروقات الجرد ${code} للمستودع ${w.name}` }, gl, 'إعدادات المستودعات (مركز تكلفة الفروقات)');
      c.shortage = shortage;
      c.surplus = surplus;
      c.status = 'approved';
      c.approvedByName = a.fullName;
      c.lines = [...c.lines];
      c.log = [...c.log, logEntry('اعتماد الفروقات وترحيل التسوية', a.fullName, note)];
      await em.save(c);
    });
    return this.get(a, id);
  }

  async cancel(a: OrgUser, id: string, reason: string) {
    const c = await this.find(a.organizationId, id);
    if (!['open', 'submitted'].includes(c.status)) throw new ConflictException('الجرد منتهٍ');
    if (!can(a, P.stockOperate) && !can(a, P.stockApprove)) throw new ForbiddenException('لا تملك صلاحية إلغاء الجرد');
    c.status = 'cancelled';
    c.log = [...c.log, logEntry('إلغاء الجرد', a.fullName, reason)];
    await this.db.getRepository(PrCount).save(c);
    return this.get(a, id);
  }

  async list(a: OrgUser, q: { status?: string; warehouse?: string }) {
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT c.id, c.count_no AS "countNo", c.kind, c.date, c.status, c.shortage::float AS shortage, c.surplus::float AS surplus, jsonb_array_length(c.lines)::int AS lines,
              (SELECT COUNT(*)::int FROM jsonb_array_elements(c.lines) l WHERE l->>'countedQty' IS NOT NULL) AS counted, c.created_by_name AS "createdByName",
              c.submitted_by_id AS "submittedById", w.name AS "warehouseName", g.name AS "groupName"
         FROM pr_counts c JOIN pr_warehouses w ON w.id = c.warehouse_id LEFT JOIN pr_item_groups g ON g.id = c.group_id
        WHERE c.organization_id = $1 AND ($2::text IS NULL OR c.status = $2) AND ($3::uuid IS NULL OR c.warehouse_id = $3::uuid)
        ORDER BY c.count_no DESC LIMIT 300`, [a.organizationId, q.status || null, q.warehouse || null]);
    return rows.map((r) => ({
      ...r, code: countCode(r.countNo as number), kindLabel: COUNT_KINDS[r.kind as keyof typeof COUNT_KINDS], statusLabel: COUNT_STATUS[r.status as keyof typeof COUNT_STATUS],
      myApproval: r.status === 'submitted' && can(a, P.stockApprove) && (a.isSuperadmin || r.submittedById !== a.id),
    }));
  }

  async get(a: OrgUser, id: string) {
    const org = a.organizationId;
    const c = await this.find(org, id);
    const [w, items, names, entry, group] = await Promise.all([
      this.stock.warehouse(org, c.warehouseId),
      this.stock.items(org, c.lines.map((l) => l.itemId)).catch(() => new Map()),
      this.core.userNames(org, c.committeeIds),
      this.stock.entryRef(org, c.entryId),
      c.groupId ? this.db.query('SELECT name FROM pr_item_groups WHERE id = $1', [c.groupId]) : Promise.resolve([]),
    ]);
    const uoms: { id: string; name: string }[] = await this.db.query('SELECT id, name FROM pr_uoms WHERE organization_id = $1', [org]);
    const uom = new Map(uoms.map((u) => [u.id, u.name]));
    const today = prToday();
    const operate = can(a, P.stockOperate) || c.committeeIds.includes(a.id);
    return {
      ...c, code: countCode(c.countNo), kindLabel: COUNT_KINDS[c.kind], statusLabel: COUNT_STATUS[c.status],
      warehouse: { id: w.id, code: w.code, name: w.name }, groupName: group[0]?.name ?? null, committee: c.committeeIds.map((x) => names.get(x) ?? '—'), entry,
      lines: c.lines.map((l, index) => {
        const it = items.get(l.itemId);
        return { ...l, index, itemCode: it?.code ?? null, itemName: it?.name ?? null, uomName: it ? uom.get(it.uomId) ?? null : null, expired: !!l.expiryDate && l.expiryDate < today };
      }),
      can: {
        count: c.status === 'open' && operate,
        submit: c.status === 'open' && operate,
        approve: c.status === 'submitted' && can(a, P.stockApprove) && (a.isSuperadmin || c.submittedById !== a.id),
        returnCount: c.status === 'submitted' && can(a, P.stockApprove),
        cancel: ['open', 'submitted'].includes(c.status) && (can(a, P.stockOperate) || can(a, P.stockApprove)),
      },
    };
  }
}
