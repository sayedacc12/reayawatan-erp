import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FileStore } from '../../core/files/file-store.service';
import { ISSUE_POLICY, ITEM_KINDS, ItemFile, PrItem, PrItemGroup, PrUom, VALUATION } from './entities/procurement.entity';
import { AlternativeDto, ItemDto, ItemGroupDto, StopItemDto, UomDto } from './procurement.dto';
import { logEntry, nameKey, ProcurementCore } from './procurement-core.service';

const MAX_ATTACHMENTS = 15;

/** هل الاسمان متقاربان؟ (أحدهما يحتوي الآخر، أو يتشاركان كل الكلمات المهمة) */
export function similarNames(a: string, b: string) {
  const ka = nameKey(a);
  const kb = nameKey(b);
  if (!ka || !kb) return false;
  if (ka === kb || ka.includes(kb) || kb.includes(ka)) return true;
  const wa = new Set(ka.split(' ').filter((w) => w.length > 2));
  const wb = kb.split(' ').filter((w) => w.length > 2);
  if (wa.size < 2 || wb.length < 2) return false;
  const common = wb.filter((w) => wa.has(w)).length;
  return common / Math.max(wa.size, wb.length) >= 0.75;
}

/** دليل الأصناف: وحدات القياس، والمجموعات بحساباتها، والأصناف بترميز موحد ومنع للتكرار */
@Injectable()
export class CatalogService {
  constructor(private readonly db: DataSource, private readonly core: ProcurementCore, private readonly files: FileStore) {}

  // ---------------- وحدات القياس ----------------

  async uoms(org: string) {
    await this.core.settings(org);
    const rows = await this.db.getRepository(PrUom).find({ where: { organizationId: org }, order: { sortOrder: 'ASC', name: 'ASC' } });
    const used: { uom_id: string; n: number }[] = await this.db.query(
      `SELECT u.id AS uom_id, (SELECT COUNT(*)::int FROM pr_items i WHERE i.organization_id = $1 AND (i.uom_id = u.id OR i.units @> jsonb_build_array(jsonb_build_object('uomId', u.id::text)))) AS n
         FROM pr_uoms u WHERE u.organization_id = $1`, [org]);
    const n = new Map(used.map((r) => [r.uom_id, r.n]));
    return rows.map((u) => ({ ...u, items: n.get(u.id) ?? 0 }));
  }

  async createUom(a: OrgUser, dto: UomDto) {
    const org = a.organizationId;
    await this.core.settings(org);
    await this.assertUomName(org, dto.name);
    const [m] = await this.db.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM pr_uoms WHERE organization_id = $1', [org]);
    await this.db.getRepository(PrUom).insert({ organizationId: org, name: dto.name.trim(), symbol: dto.symbol?.trim() || null, sortOrder: Number(m.n), isActive: dto.isActive ?? true });
    return this.uoms(org);
  }

  async updateUom(a: OrgUser, id: string, dto: UomDto) {
    const org = a.organizationId;
    const u = await this.db.getRepository(PrUom).findOne({ where: { id, organizationId: org } });
    if (!u) throw new NotFoundException('وحدة القياس غير موجودة');
    await this.assertUomName(org, dto.name, id);
    await this.db.getRepository(PrUom).update({ id }, { name: dto.name.trim(), symbol: dto.symbol?.trim() || null, isActive: dto.isActive ?? u.isActive });
    return this.uoms(org);
  }

  async removeUom(a: OrgUser, id: string) {
    const org = a.organizationId;
    const u = (await this.uoms(org)).find((x) => x.id === id);
    if (!u) throw new NotFoundException('وحدة القياس غير موجودة');
    if (u.items) throw new ConflictException(`الوحدة مستخدمة في ${u.items} صنف، أوقفها بدل حذفها`);
    await this.db.getRepository(PrUom).delete({ id });
    return this.uoms(org);
  }

  private async assertUomName(org: string, name: string, except?: string) {
    const [dup] = await this.db.query('SELECT id FROM pr_uoms WHERE organization_id = $1 AND lower(trim(name)) = lower(trim($2)) AND id <> COALESCE($3::uuid, gen_random_uuid())', [org, name, except ?? null]);
    if (dup) throw new ConflictException('توجد وحدة قياس بهذا الاسم');
  }

  // ---------------- مجموعات الأصناف ----------------

  async groups(org: string) {
    await this.core.settings(org);
    const rows = await this.db.getRepository(PrItemGroup).find({ where: { organizationId: org }, order: { sortOrder: 'ASC', code: 'ASC' } });
    const counts: { group_id: string; n: number }[] = await this.db.query('SELECT group_id, COUNT(*)::int AS n FROM pr_items WHERE organization_id = $1 GROUP BY group_id', [org]);
    const n = new Map(counts.map((r) => [r.group_id, r.n]));
    const acc = await this.core.accountMap(org, rows.flatMap((g) => [g.inventoryAccountId, g.expenseAccountId]));
    const assetGroups: { id: string; code: string; name: string }[] = await this.db.query('SELECT id, code, name FROM acc_asset_groups WHERE organization_id = $1', [org]).catch(() => []);
    const ag = new Map(assetGroups.map((x) => [x.id, x]));
    return rows.map((g) => ({
      ...g, kindLabel: ITEM_KINDS[g.kind], valuationLabel: g.valuation ? VALUATION[g.valuation] : null, items: n.get(g.id) ?? 0,
      inventoryAccount: acc.get(g.inventoryAccountId ?? '') ?? null, expenseAccount: acc.get(g.expenseAccountId ?? '') ?? null,
      assetGroup: ag.get(g.assetGroupId ?? '') ?? null,
    }));
  }

  private async checkGroup(org: string, dto: ItemGroupDto, id?: string) {
    const repo = this.db.getRepository(PrItemGroup);
    const dup = await repo.findOne({ where: { organizationId: org, code: dto.code } });
    if (dup && dup.id !== id) throw new ConflictException(`الرمز ${dto.code} مستخدم لمجموعة «${dup.name}»`);
    if (dto.parentId) {
      const all = await repo.find({ where: { organizationId: org } });
      const parent = all.find((g) => g.id === dto.parentId);
      if (!parent) throw new BadRequestException('المجموعة الرئيسية غير موجودة');
      // منع الحلقات: لا تكون المجموعة تحت نفسها أو تحت أحد فروعها
      for (let p: PrItemGroup | undefined = parent; p; p = all.find((g) => g.id === p!.parentId)) {
        if (p.id === id) throw new BadRequestException('لا يمكن نقل المجموعة تحت نفسها أو تحت أحد فروعها');
      }
    }
    await this.core.account(org, dto.inventoryAccountId, 'assets', 'حساب المخزون');
    await this.core.account(org, dto.expenseAccountId, 'expenses', 'حساب المصروف');
    if (dto.assetGroupId) {
      const [ag] = await this.db.query('SELECT id FROM acc_asset_groups WHERE organization_id = $1 AND id = $2', [org, dto.assetGroupId]);
      if (!ag) throw new BadRequestException('مجموعة الأصول الثابتة غير موجودة');
    }
    if (dto.kind === 'asset' && !dto.assetGroupId) throw new BadRequestException('اختر مجموعة الأصول الثابتة التي تُسجل فيها أصناف هذه المجموعة عند استلامها');
  }

  private groupFields(dto: ItemGroupDto) {
    return {
      parentId: dto.parentId ?? null, code: dto.code, name: dto.name.trim(), kind: dto.kind,
      inventoryAccountId: dto.kind === 'service' ? null : dto.inventoryAccountId ?? null, expenseAccountId: dto.expenseAccountId ?? null,
      assetGroupId: dto.kind === 'asset' ? dto.assetGroupId ?? null : null, valuation: dto.valuation ?? null, description: dto.description ?? null,
    };
  }

  async createGroup(a: OrgUser, dto: ItemGroupDto) {
    const org = a.organizationId;
    await this.core.settings(org);
    await this.checkGroup(org, dto);
    const [m] = await this.db.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM pr_item_groups WHERE organization_id = $1', [org]);
    await this.db.getRepository(PrItemGroup).insert({ organizationId: org, ...this.groupFields(dto), sortOrder: Number(m.n), isActive: dto.isActive ?? true });
    return this.groups(org);
  }

  async updateGroup(a: OrgUser, id: string, dto: ItemGroupDto) {
    const org = a.organizationId;
    const g = await this.db.getRepository(PrItemGroup).findOne({ where: { id, organizationId: org } });
    if (!g) throw new NotFoundException('المجموعة غير موجودة');
    await this.checkGroup(org, dto, id);
    if (dto.code !== g.code && (await this.db.getRepository(PrItem).exists({ where: { organizationId: org, groupId: id } }))) {
      throw new ConflictException('لا يتغير رمز مجموعة فيها أصناف، لأن الرمز جزء من ترميز أصنافها');
    }
    if (dto.kind !== g.kind && (await this.db.getRepository(PrItem).exists({ where: { organizationId: org, groupId: id } }))) {
      throw new ConflictException('لا يتغير نوع مجموعة فيها أصناف');
    }
    await this.db.getRepository(PrItemGroup).update({ id }, { ...this.groupFields(dto), isActive: dto.isActive ?? g.isActive });
    return this.groups(org);
  }

  async removeGroup(a: OrgUser, id: string) {
    const org = a.organizationId;
    const g = await this.db.getRepository(PrItemGroup).findOne({ where: { id, organizationId: org } });
    if (!g) throw new NotFoundException('المجموعة غير موجودة');
    if (await this.db.getRepository(PrItemGroup).exists({ where: { organizationId: org, parentId: id } })) throw new ConflictException('احذف المجموعات الفرعية أولًا');
    if (await this.db.getRepository(PrItem).exists({ where: { organizationId: org, groupId: id } })) throw new ConflictException('المجموعة فيها أصناف، أوقفها بدل حذفها');
    await this.db.getRepository(PrItemGroup).delete({ id });
    return this.groups(org);
  }

  /** المجموعة وكل فروعها */
  private async subtree(org: string, id: string) {
    const all = await this.db.getRepository(PrItemGroup).find({ where: { organizationId: org } });
    const out = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const g of all) if (g.parentId && out.has(g.parentId) && !out.has(g.id)) { out.add(g.id); grew = true; }
    }
    return [...out];
  }

  /** الحسابات والتقييم الفعلي للصنف: من الصنف، ثم مجموعته وما فوقها، ثم إعداد الجمعية */
  async effective(org: string, item: Pick<PrItem, 'groupId' | 'inventoryAccountId' | 'expenseAccountId' | 'valuation'>, em: EntityManager = this.db.manager) {
    const groups = await em.getRepository(PrItemGroup).find({ where: { organizationId: org } });
    const s = await this.core.settings(org, em);
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
    return { inventoryAccountId: inv, expenseAccountId: exp, valuation: val ?? s.valuation, assetGroupId };
  }

  // ---------------- الأصناف ----------------

  async items(org: string, q: Record<string, string>) {
    await this.core.settings(org);
    const groupIds = q.group ? await this.subtree(org, q.group) : null;
    const search = q.q?.trim() ? `%${q.q.trim()}%` : null;
    const key = q.q?.trim() ? `%${nameKey(q.q)}%` : null;
    const rows = await this.db.query(
      `SELECT i.id, i.code, i.name, i.kind, i.status, i.barcode, i.track_batch AS "trackBatch", i.track_serial AS "trackSerial", i.track_expiry AS "trackExpiry",
              i.reorder_point::float AS "reorderPoint", i.min_qty::float AS "minQty", i.max_qty::float AS "maxQty", i.ref_price::float AS "refPrice",
              i.image_key IS NOT NULL AS "hasImage", g.id AS "groupId", g.name AS "groupName", g.code AS "groupCode", u.name AS uom, i.uom_id AS "uomId"
         FROM pr_items i JOIN pr_item_groups g ON g.id = i.group_id JOIN pr_uoms u ON u.id = i.uom_id
        WHERE i.organization_id = $1 AND ($2::uuid[] IS NULL OR i.group_id = ANY($2)) AND ($3::text IS NULL OR i.kind = $3)
          AND ($4::text IS NULL OR i.status = $4)
          AND ($5::text IS NULL OR i.name ILIKE $5 OR i.code ILIKE $5 OR i.barcode ILIKE $5 OR i.name_key LIKE $6 OR i.units::text ILIKE $5)
        ORDER BY i.code LIMIT 2000`,
      [org, groupIds, q.kind || null, q.status || null, search, key]);
    return rows.map((r: { kind: keyof typeof ITEM_KINDS }) => ({ ...r, kindLabel: ITEM_KINDS[r.kind] }));
  }

  /** الأصناف ذات الأسماء المتقاربة (للتنبيه قبل إنشاء صنف مكرر) */
  async similar(org: string, name: string, except?: string) {
    const k = nameKey(name);
    if (k.length < 2) return [];
    const words = k.split(' ').filter((w) => w.length > 2);
    const candidates: { id: string; code: string; name: string; status: string }[] = await this.db.query(
      `SELECT id, code, name, status FROM pr_items WHERE organization_id = $1 AND id <> COALESCE($2::uuid, gen_random_uuid())
          AND (name_key = $3 OR name_key LIKE '%' || $3 || '%' OR $3 LIKE '%' || name_key || '%' OR name_key LIKE ANY($4)) LIMIT 200`,
      [org, except ?? null, k, words.length ? words.map((w) => `%${w}%`) : ['%__no_match__%']]);
    return candidates.filter((c) => similarNames(c.name, name)).slice(0, 10);
  }

  async item(org: string, id: string) {
    const i = await this.db.getRepository(PrItem).findOne({ where: { id, organizationId: org } });
    if (!i) throw new NotFoundException('الصنف غير موجود');
    const [group, uoms, eff] = await Promise.all([
      this.db.getRepository(PrItemGroup).findOne({ where: { id: i.groupId } }),
      this.db.getRepository(PrUom).find({ where: { organizationId: org } }),
      this.effective(org, i),
    ]);
    const uom = new Map(uoms.map((u) => [u.id, u]));
    const refIds = [...i.alternatives.map((x) => x.itemId), ...(i.replacedById ? [i.replacedById] : [])];
    const refs: { id: string; code: string; name: string; status: string }[] = refIds.length
      ? await this.db.query('SELECT id, code, name, status FROM pr_items WHERE id = ANY($1)', [refIds]) : [];
    const ref = new Map(refs.map((r) => [r.id, r]));
    const replaces: { id: string; code: string; name: string }[] = await this.db.query('SELECT id, code, name FROM pr_items WHERE organization_id = $1 AND replaced_by_id = $2', [org, id]);
    const acc = await this.core.accountMap(org, [eff.inventoryAccountId, eff.expenseAccountId]);
    const [ag] = eff.assetGroupId ? await this.db.query('SELECT id, code, name FROM acc_asset_groups WHERE id = $1', [eff.assetGroupId]).catch(() => []) : [];
    return {
      ...i, kindLabel: ITEM_KINDS[i.kind], issuePolicyLabel: ISSUE_POLICY[i.issuePolicy],
      group: group && { id: group.id, code: group.code, name: group.name, kind: group.kind },
      uom: uom.get(i.uomId) ?? null,
      units: i.units.map((u) => ({ ...u, uom: uom.get(u.uomId)?.name ?? '—' })),
      alternatives: i.alternatives.map((x) => ({ ...x, item: ref.get(x.itemId) ?? null })),
      replacedBy: i.replacedById ? ref.get(i.replacedById) ?? null : null,
      replaces,
      effective: {
        valuation: eff.valuation, valuationLabel: VALUATION[eff.valuation],
        inventoryAccount: acc.get(eff.inventoryAccountId ?? '') ?? null, expenseAccount: acc.get(eff.expenseAccountId ?? '') ?? null,
        assetGroup: ag ?? null,
      },
      similar: await this.similar(org, i.name, i.id),
    };
  }

  private async checkItem(org: string, dto: ItemDto, id?: string) {
    const group = await this.db.getRepository(PrItemGroup).findOne({ where: { id: dto.groupId, organizationId: org } });
    if (!group) throw new BadRequestException('مجموعة الصنف غير موجودة');
    if (!group.isActive) throw new BadRequestException(`المجموعة «${group.name}» موقوفة`);
    // المجموعة الخدمية أو مجموعة الأصول تفرض نوعها؛ والمجموعة المخزنية تقبل صنفًا مخزنيًا أو مستهلكات
    const fixed = group.kind === 'asset' || group.kind === 'service';
    const kind = fixed ? group.kind : dto.kind ?? group.kind;
    if ((fixed && dto.kind && dto.kind !== group.kind) || (!fixed && (kind === 'asset' || kind === 'service'))) {
      throw new BadRequestException(`نوع الصنف يجب أن يطابق نوع المجموعة «${ITEM_KINDS[group.kind]}»`);
    }
    const uoms = await this.db.getRepository(PrUom).find({ where: { organizationId: org } });
    const uomOk = (uid: string, label: string) => {
      const u = uoms.find((x) => x.id === uid);
      if (!u) throw new BadRequestException(`${label} غير موجودة`);
      return u;
    };
    const base = uomOk(dto.uomId, 'وحدة القياس الأساسية');
    if (!base.isActive) throw new BadRequestException(`وحدة القياس «${base.name}» موقوفة`);
    const units = dto.units ?? [];
    const seen = new Set<string>([dto.uomId]);
    for (const u of units) {
      const x = uomOk(u.uomId, 'الوحدة البديلة');
      if (seen.has(u.uomId)) throw new BadRequestException(`الوحدة «${x.name}» مكررة أو هي الوحدة الأساسية`);
      seen.add(u.uomId);
      if (u.factor === 1) throw new BadRequestException(`معامل تحويل «${x.name}» لا يساوي 1، وإلا فهي نفس الوحدة الأساسية`);
    }
    if (dto.minQty != null && dto.maxQty != null && dto.minQty > dto.maxQty) throw new BadRequestException('الحد الأدنى أكبر من الحد الأعلى');
    if (dto.reorderPoint != null && dto.maxQty != null && dto.reorderPoint > dto.maxQty) throw new BadRequestException('نقطة إعادة الطلب أكبر من الحد الأعلى');
    if (dto.reorderPoint != null && dto.minQty != null && dto.reorderPoint < dto.minQty) throw new BadRequestException('نقطة إعادة الطلب أقل من الحد الأدنى');
    if (kind === 'service' && (dto.trackBatch || dto.trackSerial || dto.trackExpiry)) throw new BadRequestException('الخدمات لا تُتتبع بدفعات أو أرقام تسلسلية أو صلاحية');
    if (dto.trackSerial && dto.units?.length) throw new BadRequestException('الأصناف المتتبعة بأرقام تسلسلية تُدار بوحدة واحدة');
    // الباركود فريد في الصنف وفي وحداته وبين كل الأصناف
    const codes = [dto.barcode, ...units.map((u) => u.barcode)].filter((x): x is string => !!x);
    if (new Set(codes).size !== codes.length) throw new BadRequestException('الباركود مكرر بين وحدات الصنف');
    for (const c of codes) {
      const [dup] = await this.db.query(
        `SELECT code, name FROM pr_items WHERE organization_id = $1 AND id <> COALESCE($2::uuid, gen_random_uuid())
            AND (barcode = $3 OR units @> jsonb_build_array(jsonb_build_object('barcode', $3::text)))`, [org, id ?? null, c]);
      if (dup) throw new ConflictException(`الباركود ${c} مستخدم للصنف ${dup.code} «${dup.name}»`);
    }
    // الاسم الموحد لا يتكرر، والأسماء المتقاربة تحتاج تأكيدًا
    const k = nameKey(dto.name);
    if (!k) throw new BadRequestException('اكتب اسم الصنف');
    const [same] = await this.db.query('SELECT code, name FROM pr_items WHERE organization_id = $1 AND name_key = $2 AND id <> COALESCE($3::uuid, gen_random_uuid())', [org, k, id ?? null]);
    if (same) throw new ConflictException(`يوجد صنف بنفس الاسم: ${same.code} «${same.name}». استخدمه بدل إنشاء صنف مكرر`);
    if (!dto.confirmSimilar) {
      const sim = await this.similar(org, dto.name, id);
      if (sim.length) {
        throw new ConflictException(`توجد أصناف بأسماء قريبة: ${sim.slice(0, 3).map((s) => `${s.code} «${s.name}»`).join('، ')}. تأكد أنه صنف مختلف ثم أكّد الحفظ`);
      }
    }
    await this.core.account(org, dto.inventoryAccountId, 'assets', 'حساب المخزون');
    await this.core.account(org, dto.expenseAccountId, 'expenses', 'حساب المصروف');
    return { group, kind };
  }

  private itemFields(dto: ItemDto, kind: PrItem['kind']) {
    const service = kind === 'service';
    return {
      name: dto.name.trim().replace(/\s+/g, ' '), nameKey: nameKey(dto.name), groupId: dto.groupId, kind, uomId: dto.uomId,
      units: (dto.units ?? []).map((u) => ({ uomId: u.uomId, factor: u.factor, barcode: u.barcode || null })),
      barcode: dto.barcode || null, description: dto.description ?? null,
      specs: (dto.specs ?? []).filter((s) => s.name.trim()).map((s) => ({ name: s.name.trim(), value: s.value.trim() })),
      trackBatch: !service && !!dto.trackBatch, trackSerial: !service && !!dto.trackSerial, trackExpiry: !service && !!dto.trackExpiry,
      shelfLifeDays: dto.trackExpiry ? dto.shelfLifeDays ?? null : null,
      minQty: service ? null : dto.minQty ?? null, maxQty: service ? null : dto.maxQty ?? null,
      reorderPoint: service ? null : dto.reorderPoint ?? null, reorderQty: service ? null : dto.reorderQty ?? null,
      issuePolicy: dto.trackExpiry ? dto.issuePolicy ?? 'fefo' : dto.issuePolicy ?? 'fifo',
      valuation: service ? null : dto.valuation ?? null,
      inventoryAccountId: service ? null : dto.inventoryAccountId ?? null, expenseAccountId: dto.expenseAccountId ?? null,
      refPrice: dto.refPrice ?? null,
    };
  }

  async createItem(a: OrgUser, dto: ItemDto) {
    const org = a.organizationId;
    await this.core.settings(org);
    const { group, kind } = await this.checkItem(org, dto);
    const id = await this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pr-items:${org}`]);
      // الترميز: رمز المجموعة ثم تسلسل من 4 أرقام (FOOD-0001)
      const [m] = await em.query(
        `SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '^.*-', ''), '')::int), 0) + 1 AS n FROM pr_items
          WHERE organization_id = $1 AND code ~ ('^' || $2 || '-[0-9]+$')`, [org, group.code]);
      const row = await em.getRepository(PrItem).save(em.create(PrItem, {
        organizationId: org, code: `${group.code}-${String(m.n).padStart(4, '0')}`, ...this.itemFields(dto, kind),
        createdByName: a.fullName, log: [logEntry('إنشاء الصنف', a.fullName)],
      }));
      return row.id;
    });
    return this.item(org, id);
  }

  async updateItem(a: OrgUser, id: string, dto: ItemDto) {
    const org = a.organizationId;
    const i = await this.db.getRepository(PrItem).findOne({ where: { id, organizationId: org } });
    if (!i) throw new NotFoundException('الصنف غير موجود');
    const { kind } = await this.checkItem(org, dto, id);
    if (kind !== i.kind && (i.kind === 'service' || kind === 'service' || i.kind === 'asset' || kind === 'asset')) {
      throw new ConflictException('لا يتحول الصنف بين خدمة وأصل وصنف مخزني بعد إنشائه، أنشئ صنفًا جديدًا وأوقف هذا');
    }
    const fields = this.itemFields(dto, kind);
    const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter((k) => JSON.stringify(fields[k]) !== JSON.stringify(i[k as keyof PrItem]) && k !== 'nameKey');
    if (!changed.length) return this.item(org, id);
    const labels: Record<string, string> = {
      name: 'الاسم', groupId: 'المجموعة', kind: 'النوع', uomId: 'الوحدة الأساسية', units: 'الوحدات البديلة', barcode: 'الباركود', description: 'الوصف', specs: 'المواصفات',
      trackBatch: 'تتبع الدفعات', trackSerial: 'الأرقام التسلسلية', trackExpiry: 'تتبع الصلاحية', shelfLifeDays: 'مدة الصلاحية', minQty: 'الحد الأدنى', maxQty: 'الحد الأعلى',
      reorderPoint: 'نقطة إعادة الطلب', reorderQty: 'كمية إعادة الطلب', issuePolicy: 'سياسة الصرف', valuation: 'طريقة التقييم', inventoryAccountId: 'حساب المخزون',
      expenseAccountId: 'حساب المصروف', refPrice: 'السعر المرجعي',
    };
    await this.db.getRepository(PrItem).update({ id }, {
      ...fields, log: [...i.log, logEntry('تعديل الصنف', a.fullName, changed.map((k) => labels[k] ?? k).join('، '))],
    });
    return this.item(org, id);
  }

  async stopItem(a: OrgUser, id: string, dto: StopItemDto) {
    const org = a.organizationId;
    const i = await this.db.getRepository(PrItem).findOne({ where: { id, organizationId: org } });
    if (!i) throw new NotFoundException('الصنف غير موجود');
    if (i.status === 'stopped') throw new ConflictException('الصنف موقوف بالفعل');
    let note = dto.reason;
    if (dto.replacedById) {
      if (dto.replacedById === id) throw new BadRequestException('الصنف البديل هو نفس الصنف');
      const r = await this.db.getRepository(PrItem).findOne({ where: { id: dto.replacedById, organizationId: org } });
      if (!r || r.status !== 'active') throw new BadRequestException('الصنف البديل غير موجود أو موقوف');
      note += ` · البديل: ${r.code} ${r.name}`;
    }
    await this.db.getRepository(PrItem).update({ id }, {
      status: 'stopped', stopReason: dto.reason, replacedById: dto.replacedById ?? null, log: [...i.log, logEntry('إيقاف الصنف', a.fullName, note)],
    });
    return this.item(org, id);
  }

  async reactivateItem(a: OrgUser, id: string) {
    const org = a.organizationId;
    const i = await this.db.getRepository(PrItem).findOne({ where: { id, organizationId: org } });
    if (!i) throw new NotFoundException('الصنف غير موجود');
    if (i.status === 'active') throw new ConflictException('الصنف نشط');
    await this.db.getRepository(PrItem).update({ id }, { status: 'active', stopReason: null, replacedById: null, log: [...i.log, logEntry('إعادة تفعيل الصنف', a.fullName)] });
    return this.item(org, id);
  }

  /** إضافة صنف بديل أو مكافئ: يُعتمد من صاحب صلاحية الأصناف ويُسجل اسمه وتاريخه، والعلاقة متبادلة */
  async addAlternative(a: OrgUser, id: string, dto: AlternativeDto) {
    const org = a.organizationId;
    if (dto.itemId === id) throw new BadRequestException('اختر صنفًا آخر');
    await this.db.transaction(async (em) => {
      const repo = em.getRepository(PrItem);
      const [i, other] = await Promise.all([repo.findOne({ where: { id, organizationId: org } }), repo.findOne({ where: { id: dto.itemId, organizationId: org } })]);
      if (!i || !other) throw new NotFoundException('الصنف غير موجود');
      if (i.kind === 'service' ? other.kind !== 'service' : other.kind === 'service') throw new BadRequestException('البديل من نفس طبيعة الصنف (خدمة بخدمة)');
      const entry = (itemId: string) => ({ itemId, kind: dto.kind, note: dto.note ?? null, approvedByName: a.fullName, approvedAt: new Date().toISOString() });
      const label = dto.kind === 'equivalent' ? 'صنف مكافئ' : 'صنف بديل';
      await repo.update({ id }, {
        alternatives: [...i.alternatives.filter((x) => x.itemId !== other.id), entry(other.id)], log: [...i.log, logEntry(`اعتماد ${label}`, a.fullName, `${other.code} ${other.name}`)],
      });
      await repo.update({ id: other.id }, {
        alternatives: [...other.alternatives.filter((x) => x.itemId !== id), entry(id)], log: [...other.log, logEntry(`اعتماد ${label}`, a.fullName, `${i.code} ${i.name}`)],
      });
    });
    return this.item(org, id);
  }

  async removeAlternative(a: OrgUser, id: string, otherId: string) {
    const org = a.organizationId;
    await this.db.transaction(async (em) => {
      const repo = em.getRepository(PrItem);
      for (const [x, y] of [[id, otherId], [otherId, id]]) {
        const i = await repo.findOne({ where: { id: x, organizationId: org } });
        if (i) await repo.update({ id: x }, { alternatives: i.alternatives.filter((z) => z.itemId !== y), log: [...i.log, logEntry('إلغاء صنف بديل', a.fullName)] });
      }
    });
    return this.item(org, id);
  }

  // ---------------- الصور والمرفقات ----------------

  async setImage(a: OrgUser, id: string, file: Express.Multer.File) {
    const org = a.organizationId;
    const i = await this.db.getRepository(PrItem).findOne({ where: { id, organizationId: org } });
    if (!i) throw new NotFoundException('الصنف غير موجود');
    const saved = await this.files.save(`${org}/procurement`, file, 'صورة الصنف');
    if (!saved.mime.startsWith('image/')) {
      await this.files.remove(saved.key);
      throw new BadRequestException('صورة الصنف بصيغة JPG أو PNG أو WEBP');
    }
    if (i.imageKey) await this.files.remove(i.imageKey).catch(() => undefined);
    await this.db.getRepository(PrItem).update({ id }, { imageKey: saved.key, imageMime: saved.mime });
    return this.item(org, id);
  }

  async addAttachment(a: OrgUser, id: string, file: Express.Multer.File) {
    const org = a.organizationId;
    const i = await this.db.getRepository(PrItem).findOne({ where: { id, organizationId: org } });
    if (!i) throw new NotFoundException('الصنف غير موجود');
    if (i.attachments.length >= MAX_ATTACHMENTS) throw new BadRequestException(`الحد الأعلى ${MAX_ATTACHMENTS} مرفقًا للصنف`);
    const saved = await this.files.save(`${org}/procurement`, file, 'المرفق');
    const att: ItemFile = { key: saved.key, name: saved.name, mime: saved.mime, size: file.size, at: new Date().toISOString(), byName: a.fullName };
    await this.db.getRepository(PrItem).update({ id }, { attachments: [...i.attachments, att], log: [...i.log, logEntry('إرفاق مستند', a.fullName, saved.name)] });
    return this.item(org, id);
  }

  async removeAttachment(a: OrgUser, id: string, key: string) {
    const org = a.organizationId;
    const i = await this.db.getRepository(PrItem).findOne({ where: { id, organizationId: org } });
    const att = i?.attachments.find((x) => x.key.endsWith(`/${key}`));
    if (!i || !att) throw new NotFoundException('المرفق غير موجود');
    await this.files.remove(att.key).catch(() => undefined);
    await this.db.getRepository(PrItem).update({ id }, { attachments: i.attachments.filter((x) => x !== att), log: [...i.log, logEntry('حذف مرفق', a.fullName, att.name)] });
    return this.item(org, id);
  }

  async file(org: string, id: string, key: string | 'image') {
    const i = await this.db.getRepository(PrItem).findOne({ where: { id, organizationId: org } });
    if (!i) throw new NotFoundException('الصنف غير موجود');
    if (key === 'image') {
      if (!i.imageKey) throw new NotFoundException('لا توجد صورة');
      return { stream: this.files.open(i.imageKey), mime: i.imageMime ?? 'image/jpeg', name: `${i.code}.img` };
    }
    const att = i.attachments.find((x) => x.key.endsWith(`/${key}`));
    if (!att) throw new NotFoundException('المرفق غير موجود');
    return { stream: this.files.open(att.key), mime: att.mime, name: att.name };
  }
}
