import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FileStore } from '../../core/files/file-store.service';
import {
  AmendmentDecisionDto, AmendmentDto, ContractDto, ContractEndDto, ContractListQueryDto, ContractPriceDto, KpiReadingDto, PenaltyDecisionDto, PenaltyDto,
} from './contract.dto';
import {
  AMENDMENT_KINDS, CONTRACT_KINDS, CONTRACT_STATUS, ContractAmendment, ContractPenalty, ContractPrice, ContractStatus, GUARANTEE_KINDS, PENALTY_BASIS, PrContract,
} from './entities/contract.entity';
import { ItemFile, PrSupplier } from './entities/procurement.entity';
import { ORDER_STATUS, PrOrder } from './entities/sourcing.entity';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { addDays, logEntry, ProcurementCore, prToday, supplierCode } from './procurement-core.service';
import { can } from './requests.service';
import { orderCode, r2, SourcingCore } from './sourcing-core.service';
import { SupplierPortalUser } from './supplier-portal.guard';

/** قراءة سجل المخاطر وتوصيات المراجعة تخضع لصلاحيات نظاميهما، لا لصلاحيات المشتريات */
export const canRisk = (a: OrgUser) => a.isSuperadmin || a.permissions.includes('risk.dashboard.read');
export const canAudit = (a: OrgUser) => a.isSuperadmin || a.permissions.includes('audit.dashboard.read');
export const contractCode = (n: number) => `CT-${String(n).padStart(4, '0')}`;
/** حالات التعميد التي تُحتسب على سقف العقد */
const COUNTED_ORDER = ['pending', 'issued', 'acknowledged', 'accepted', 'clarification', 'partial', 'closed'];
const LIVE_CONTRACT: ContractStatus[] = ['active', 'suspended'];
const MAX_FILES = 10;
const key = () => randomUUID().slice(0, 8);

interface RiskLookup { listRisks(orgId: string): Promise<{ id: string; code: string; title: string; score: number | null; level: string; levelLabel?: string; status?: string }[]> }

/**
 * عقود الموردين والاتفاقيات الإطارية: السقف والمدة والأسعار التعاقدية والضمانات ومستويات الخدمة والجزاءات والملاحق،
 * وربطها بالتعميدات (لا تتجاوز سقفه) والفواتير والتقييمات، وبعقد الشراكة إذا كان العقد مشتركًا مع شريك، وبسجل المخاطر.
 */
@Injectable()
export class ContractsService {
  constructor(
    private readonly db: DataSource, private readonly core: ProcurementCore, private readonly sc: SourcingCore, private readonly files: FileStore,
    private readonly moduleRef: ModuleRef,
  ) {}

  private riskLookup(): RiskLookup | null {
    try {
      return this.moduleRef.get<RiskLookup>('RISK_REGISTER_LOOKUP', { strict: false });
    } catch {
      return null;
    }
  }

  private canRead(a: OrgUser) {
    return [P.contracts, P.contractsApprove, P.sourcing, P.approveOrders, P.approveOrdersHigh, P.invoices, P.suppliersRead, P.reports].some((x) => can(a, x));
  }

  async find(org: string, id: string, em: EntityManager = this.db.manager) {
    const c = await em.getRepository(PrContract).findOne({ where: { id, organizationId: org } });
    if (!c) throw new NotFoundException('العقد غير موجود');
    return c;
  }

  private async lock(em: EntityManager, org: string, id: string) {
    const c = await em.getRepository(PrContract).createQueryBuilder('c').setLock('pessimistic_write').where('c.id = :id AND c.organization_id = :org', { id, org }).getOne();
    if (!c) throw new NotFoundException('العقد غير موجود');
    return c;
  }

  /** المستخدم من سقف العقد: إجمالي التعميدات المرتبطة به (عدا تعميد محدد) */
  async used(org: string, contractId: string, exceptOrderId: string | null = null, em: EntityManager = this.db.manager) {
    const [{ t }] = await em.query(
      `SELECT COALESCE(SUM(total), 0)::float AS t FROM pr_orders WHERE organization_id = $1 AND contract_id = $2 AND status = ANY($3) AND ($4::uuid IS NULL OR id <> $4::uuid)`,
      [org, contractId, COUNTED_ORDER, exceptOrderId]);
    return r2(t);
  }

  /** فحص ربط تعميد بالعقد: العقد ساري لنفس المورد وفي مدته، والتعميد لا يتجاوز المتبقي من السقف (يُقفل العقد حتى نهاية المعاملة) */
  async assertOrderFits(em: EntityManager, org: string, contractId: string, o: { id?: string | null; supplierId: string; total: number }) {
    const c = await this.lock(em, org, contractId);
    if (c.supplierId !== o.supplierId) throw new BadRequestException('العقد المختار لمورد آخر');
    if (c.status !== 'active') throw new ConflictException(`العقد ${contractCode(c.contractNo)} «${CONTRACT_STATUS[c.status]}»، فلا يُربط به تعميد`);
    const today = prToday();
    if (today < c.startsOn || today > c.endsOn) throw new ConflictException(`التعميد خارج مدة العقد ${contractCode(c.contractNo)} (${c.startsOn} إلى ${c.endsOn})`);
    const left = r2(c.value - (await this.used(org, c.id, o.id ?? null, em)));
    if (o.total > left + 0.005) throw new ConflictException(`التعميد ${o.total} يتجاوز المتبقي من سقف العقد ${contractCode(c.contractNo)} (${Math.max(0, left)})`);
    return c;
  }

  /** تنبيه الأسعار: البنود التي تزيد أسعارها عن السعر التعاقدي للصنف */
  async priceWarnings(org: string, contractId: string, lines: { itemId: string | null; description: string; unitPrice: number }[]) {
    const c = await this.find(org, contractId);
    const byItem = new Map(c.prices.filter((p) => p.itemId).map((p) => [p.itemId!, p.unitPrice]));
    return lines.filter((l) => l.itemId && byItem.has(l.itemId) && l.unitPrice > byItem.get(l.itemId)! + 0.005)
      .map((l) => `سعر «${l.description}» ${l.unitPrice} أعلى من السعر التعاقدي ${byItem.get(l.itemId!)}`);
  }

  private async validate(org: string, dto: ContractDto) {
    if (dto.endsOn < dto.startsOn) throw new BadRequestException('تاريخ نهاية العقد قبل بدايته');
    const sup = await this.db.getRepository(PrSupplier).findOne({ where: { id: dto.supplierId, organizationId: org } });
    if (!sup) throw new NotFoundException('المورد غير موجود');
    if (sup.status !== 'approved') throw new ConflictException(`المورد «${sup.name}» غير معتمد، فلا يُبرم معه عقد`);
    await this.sc.assertFinance(org, dto.budgetLineId, dto.fundingBatchId);
    if (dto.projectId) {
      const [p] = await this.db.query('SELECT id FROM activities WHERE organization_id = $1 AND id = $2', [org, dto.projectId]).catch(() => []);
      if (!p) throw new BadRequestException('المشروع غير موجود');
    }
    if (dto.ptContractId) {
      const [p] = await this.db.query('SELECT id FROM pt_contracts WHERE organization_id = $1 AND id = $2', [org, dto.ptContractId]).catch(() => []);
      if (!p) throw new BadRequestException('عقد الشراكة غير موجود');
    }
    const riskIds = [...new Set(dto.riskIds ?? [])];
    if (riskIds.length) {
      const risks = await this.riskLookup()?.listRisks(org).catch(() => []) ?? [];
      const ok = new Set(risks.map((r) => r.id));
      if (riskIds.some((r) => !ok.has(r))) throw new BadRequestException('أحد المخاطر غير موجود في سجل المخاطر');
    }
    const itemIds = [...new Set((dto.prices ?? []).map((p) => p.itemId).filter((x): x is string => !!x))];
    if (itemIds.length) {
      const [{ n }] = await this.db.query('SELECT COUNT(*)::int AS n FROM pr_items WHERE organization_id = $1 AND id = ANY($2)', [org, itemIds]);
      if (n !== itemIds.length) throw new BadRequestException('أحد أصناف الأسعار التعاقدية غير موجود');
    }
    return { sup, riskIds };
  }

  private prices(list: ContractPriceDto[] | undefined): ContractPrice[] {
    return (list ?? []).map((p) => ({ key: p.key ?? key(), itemId: p.itemId ?? null, description: p.description, unit: p.unit ?? null, unitPrice: r2(p.unitPrice), maxQty: p.maxQty ?? null }));
  }

  private body(dto: ContractDto, riskIds: string[]) {
    return {
      kind: dto.kind, supplierId: dto.supplierId, reference: dto.reference ?? null, title: dto.title, scope: dto.scope ?? null, terms: dto.terms ?? null,
      startsOn: dto.startsOn, endsOn: dto.endsOn, value: r2(dto.value), alertPct: dto.alertPct ?? 80, alertDays: dto.alertDays ?? 30,
      projectId: dto.projectId ?? null, budgetLineId: dto.budgetLineId ?? null, fundingBatchId: dto.fundingBatchId ?? null, ptContractId: dto.ptContractId ?? null, riskIds,
      prices: this.prices(dto.prices),
      guarantees: (dto.guarantees ?? []).map((g) => ({ key: g.key ?? key(), kind: g.kind, amount: r2(g.amount), ref: g.ref ?? null, issuer: g.issuer ?? null, expiresOn: g.expiresOn ?? null, released: false })),
      slas: (dto.slas ?? []).map((x) => ({ key: x.key ?? key(), name: x.name, target: x.target, unit: x.unit, direction: x.direction })),
      penaltyRules: (dto.penaltyRules ?? []).map((x) => ({ key: x.key ?? key(), name: x.name, basis: x.basis, rate: x.rate, capPct: x.capPct ?? null })),
      requiredDocs: (dto.requiredDocs ?? []).map((d) => d.trim()).filter(Boolean), shareWithSupplier: dto.shareWithSupplier ?? true,
    };
  }

  async create(a: OrgUser, dto: ContractDto) {
    if (!can(a, P.contracts)) throw new ForbiddenException('لا تملك صلاحية إدارة العقود');
    const org = a.organizationId;
    const { riskIds } = await this.validate(org, dto);
    const c = await this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pr_contracts:${org}`]);
      const [{ n }] = await em.query('SELECT COALESCE(MAX(contract_no), 0)::int + 1 AS n FROM pr_contracts WHERE organization_id = $1', [org]);
      return em.save(em.create(PrContract, {
        organizationId: org, contractNo: n, ...this.body(dto, riskIds), status: 'draft', createdById: a.id, createdByName: a.fullName, editorIds: [a.id],
        log: [logEntry('إنشاء العقد', a.fullName)],
      }));
    });
    return this.get(a, c.id);
  }

  async update(a: OrgUser, id: string, dto: ContractDto) {
    if (!can(a, P.contracts)) throw new ForbiddenException('لا تملك صلاحية إدارة العقود');
    const org = a.organizationId;
    const { riskIds } = await this.validate(org, dto);
    await this.db.transaction(async (em) => {
      const c = await this.lock(em, org, id);
      if (!['draft', 'returned'].includes(c.status)) throw new ConflictException('يُعدل العقد وهو مسودة أو معاد، وبعد سريانه بملحق معتمد');
      // الضمان لا يُفرج عنه من نموذج العقد: يبقى كما هو، والإفراج من إجراء المعتمد فقط
      const released = new Map(c.guarantees.map((g) => [g.key, g.released]));
      Object.assign(c, this.body(dto, riskIds));
      c.guarantees = c.guarantees.map((g) => ({ ...g, released: released.get(g.key) ?? false }));
      if (!c.editorIds.includes(a.id)) c.editorIds = [...c.editorIds, a.id];
      c.log = [...c.log, logEntry('تعديل', a.fullName)];
      await em.save(c);
    });
    return this.get(a, id);
  }

  async submit(a: OrgUser, id: string) {
    if (!can(a, P.contracts)) throw new ForbiddenException('لا تملك صلاحية إدارة العقود');
    await this.db.transaction(async (em) => {
      const c = await this.lock(em, a.organizationId, id);
      if (!['draft', 'returned'].includes(c.status)) throw new ConflictException('العقد ليس مسودة');
      if (!c.editorIds.includes(a.id)) c.editorIds = [...c.editorIds, a.id];
      c.status = 'pending';
      c.returnReason = null;
      c.log = [...c.log, logEntry('إرسال للاعتماد', a.fullName)];
      await em.save(c);
    });
    return this.get(a, id);
  }

  /** اعتماد العقد أو إعادته: المعتمد غير من أعده (فصل المهام) */
  async decide(a: OrgUser, id: string, decision: 'approve' | 'return', note: string | null) {
    if (!can(a, P.contractsApprove)) throw new ForbiddenException('لا تملك صلاحية اعتماد العقود');
    await this.db.transaction(async (em) => {
      const c = await this.lock(em, a.organizationId, id);
      if (c.status !== 'pending') throw new ConflictException('العقد لا ينتظر الاعتماد');
      if (!a.isSuperadmin && (c.createdById === a.id || c.editorIds.includes(a.id))) throw new ForbiddenException('لا يعتمد العقد من أعده أو عدّله أو أرسله (فصل المهام)');
      if (decision === 'return') {
        if (!note || note.length < 3) throw new BadRequestException('اكتب سبب الإعادة');
        c.status = 'returned';
        c.returnReason = note;
        c.log = [...c.log, logEntry('إعادة للتعديل', a.fullName, note)];
      } else {
        const sup = await em.getRepository(PrSupplier).findOne({ where: { id: c.supplierId, organizationId: c.organizationId } });
        if (sup?.status !== 'approved') throw new ConflictException('المورد غير معتمد');
        c.status = 'active';
        c.approvedById = a.id;
        c.approvedByName = a.fullName;
        c.approvedAt = new Date();
        c.log = [...c.log, logEntry('اعتماد العقد وسريانه', a.fullName, note)];
      }
      await em.save(c);
    });
    return this.get(a, id);
  }

  async end(a: OrgUser, id: string, dto: ContractEndDto) {
    const org = a.organizationId;
    const approver = can(a, P.contractsApprove);
    if (!approver && !(dto.action === 'cancel' && can(a, P.contracts))) throw new ForbiddenException('إيقاف العقد أو إنهاؤه لمن يعتمد العقود');
    if (dto.action !== 'resume' && dto.action !== 'close' && !(dto.reason && dto.reason.length >= 3)) throw new BadRequestException('اكتب السبب');
    await this.db.transaction(async (em) => {
      const c = await this.lock(em, org, id);
      const to: Record<ContractEndDto['action'], { from: ContractStatus[]; status: ContractStatus; label: string }> = {
        suspend: { from: ['active'], status: 'suspended', label: 'إيقاف مؤقت' },
        resume: { from: ['suspended'], status: 'active', label: 'استئناف' },
        close: { from: ['active', 'suspended'], status: 'closed', label: 'إغلاق العقد' },
        terminate: { from: ['active', 'suspended'], status: 'terminated', label: 'إنهاء العقد' },
        cancel: { from: ['draft', 'returned', 'pending'], status: 'cancelled', label: 'إلغاء' },
      };
      const t = to[dto.action];
      if (!t.from.includes(c.status)) throw new ConflictException(`لا يُنفذ «${t.label}» على عقد «${CONTRACT_STATUS[c.status]}»`);
      if (dto.action === 'terminate' || dto.action === 'close') {
        const [{ n }] = await em.query(
          `SELECT COUNT(*)::int AS n FROM pr_orders WHERE organization_id = $1 AND contract_id = $2 AND status IN ('pending', 'issued', 'acknowledged', 'accepted', 'clarification', 'partial')`, [org, c.id]);
        if (n && dto.action === 'close') throw new ConflictException(`على العقد ${n} تعميد غير منتهٍ، فيُغلق بعد استلامها أو إغلاقها`);
      }
      c.status = t.status;
      if (['closed', 'terminated', 'cancelled'].includes(t.status)) c.endReason = dto.reason ?? null;
      c.log = [...c.log, logEntry(t.label, a.fullName, dto.reason ?? null)];
      await em.save(c);
    });
    return this.get(a, id);
  }

  // ---------------- الملاحق ----------------

  async amend(a: OrgUser, id: string, dto: AmendmentDto) {
    if (!can(a, P.contracts)) throw new ForbiddenException('لا تملك صلاحية إدارة العقود');
    const org = a.organizationId;
    await this.db.transaction(async (em) => {
      const c = await this.lock(em, org, id);
      if (!LIVE_CONTRACT.includes(c.status)) throw new ConflictException('يُطلب الملحق على عقد ساري');
      if (c.amendments.some((x) => x.status === 'pending')) throw new ConflictException('على العقد ملحق بانتظار الاعتماد');
      const before = { endsOn: c.endsOn, value: c.value, terms: c.terms, prices: c.prices };
      const after = {
        endsOn: dto.endsOn ?? c.endsOn, value: dto.value !== undefined ? r2(dto.value) : c.value, terms: dto.terms !== undefined ? dto.terms : c.terms,
        prices: dto.prices ? this.prices(dto.prices) : c.prices,
      };
      if (after.endsOn < c.startsOn) throw new BadRequestException('نهاية العقد قبل بدايته');
      if (JSON.stringify(before) === JSON.stringify(after)) throw new BadRequestException('لم يتغير شيء في الملحق');
      const used = await this.used(org, c.id, null, em);
      if (after.value < used - 0.005) throw new ConflictException(`السقف الجديد أقل من المستخدم من العقد (${used})`);
      const am: ContractAmendment = {
        no: c.amendments.length + 1, kind: dto.kind, reason: dto.reason, status: 'pending', before, after, byId: a.id, byName: a.fullName, at: new Date().toISOString(),
        decidedByName: null, decidedAt: null, decisionNote: null,
      };
      c.amendments = [...c.amendments, am];
      c.log = [...c.log, logEntry(`طلب ملحق رقم ${am.no}: ${AMENDMENT_KINDS[dto.kind]}`, a.fullName, dto.reason)];
      await em.save(c);
    });
    return this.get(a, id);
  }

  async decideAmendment(a: OrgUser, id: string, no: number, dto: AmendmentDecisionDto) {
    if (!can(a, P.contractsApprove)) throw new ForbiddenException('لا تملك صلاحية اعتماد العقود');
    const org = a.organizationId;
    await this.db.transaction(async (em) => {
      const c = await this.lock(em, org, id);
      const am = c.amendments.find((x) => x.no === no);
      if (!am || am.status !== 'pending') throw new NotFoundException('الملحق غير موجود أو لا ينتظر الاعتماد');
      if (!a.isSuperadmin && am.byId === a.id) throw new ForbiddenException('لا يعتمد الملحق من طلبه (فصل المهام)');
      am.status = dto.decision === 'approve' ? 'approved' : 'rejected';
      am.decidedByName = a.fullName;
      am.decidedAt = new Date().toISOString();
      am.decisionNote = dto.note ?? null;
      if (am.status === 'approved') {
        const used = await this.used(org, c.id, null, em);
        if (am.after.value < used - 0.005) throw new ConflictException(`السقف الجديد أقل من المستخدم من العقد (${used})`);
        c.endsOn = am.after.endsOn;
        c.value = am.after.value;
        c.terms = am.after.terms;
        c.prices = am.after.prices;
        c.version += 1;
      }
      c.amendments = [...c.amendments];
      c.log = [...c.log, logEntry(`${am.status === 'approved' ? 'اعتماد' : 'رفض'} الملحق رقم ${no}`, a.fullName, dto.note ?? null)];
      await em.save(c);
    });
    return this.get(a, id);
  }

  // ---------------- الجزاءات ومستويات الخدمة والضمانات ----------------

  async penalty(a: OrgUser, id: string, dto: PenaltyDto) {
    if (!can(a, P.contracts)) throw new ForbiddenException('لا تملك صلاحية إدارة العقود');
    const org = a.organizationId;
    if (dto.date > prToday()) throw new BadRequestException('تاريخ المخالفة في المستقبل');
    await this.db.transaction(async (em) => {
      const c = await this.lock(em, org, id);
      if (!LIVE_CONTRACT.includes(c.status) && c.status !== 'closed') throw new ConflictException('تُسجل الجزاءات على عقد ساري أو منتهٍ');
      let o: PrOrder | null = null;
      if (dto.orderId) {
        o = await em.getRepository(PrOrder).findOne({ where: { id: dto.orderId, organizationId: org } });
        if (!o || (o as PrOrder & { contractId?: string | null }).contractId !== c.id) throw new BadRequestException('التعميد ليس من تعميدات هذا العقد');
      }
      const rule = dto.ruleKey ? c.penaltyRules.find((r) => r.key === dto.ruleKey) : null;
      if (dto.ruleKey && !rule) throw new BadRequestException('قاعدة الجزاء غير موجودة في العقد');
      let amount = dto.amount ?? 0;
      if (rule) {
        if (rule.basis === 'fixed') amount = rule.rate;
        else if (rule.basis === 'per_day') {
          if (!dto.days) throw new BadRequestException('اكتب عدد أيام التأخير');
          amount = rule.rate * dto.days;
        } else {
          if (!o) throw new BadRequestException('اختر التعميد الذي يُحتسب منه الجزاء');
          amount = (o.total * rule.rate) / 100;
        }
      }
      amount = r2(amount);
      if (!(amount > 0)) throw new BadRequestException('مبلغ الجزاء غير صحيح');
      if (rule?.capPct) {
        const sum = c.penalties.filter((p) => p.ruleKey === rule.key && p.status !== 'rejected').reduce((t, p) => t + p.amount, 0);
        const cap = r2((c.value * rule.capPct) / 100);
        if (sum + amount > cap + 0.005) throw new ConflictException(`يتجاوز سقف «${rule.name}» (${rule.capPct}% من قيمة العقد = ${cap})، والمسجل منه ${r2(sum)}`);
      }
      const p: ContractPenalty = {
        id: randomUUID(), ruleKey: rule?.key ?? null, ruleName: rule?.name ?? null, date: dto.date, amount, reason: dto.reason, orderId: o?.id ?? null,
        status: 'pending', byId: a.id, byName: a.fullName, at: new Date().toISOString(), decidedByName: null, decidedAt: null, decisionNote: null,
      };
      c.penalties = [...c.penalties, p];
      c.log = [...c.log, logEntry('تسجيل جزاء بانتظار الاعتماد', a.fullName, `${amount}: ${dto.reason}`)];
      await em.save(c);
    });
    return this.get(a, id);
  }

  async decidePenalty(a: OrgUser, id: string, penaltyId: string, dto: PenaltyDecisionDto) {
    if (!can(a, P.contractsApprove)) throw new ForbiddenException('لا تملك صلاحية اعتماد العقود');
    await this.db.transaction(async (em) => {
      const c = await this.lock(em, a.organizationId, id);
      const p = c.penalties.find((x) => x.id === penaltyId);
      if (!p || p.status !== 'pending') throw new NotFoundException('الجزاء غير موجود أو لا ينتظر الاعتماد');
      if (!a.isSuperadmin && p.byId === a.id) throw new ForbiddenException('لا يعتمد الجزاء من سجله (فصل المهام)');
      if (dto.decision === 'reject' && !(dto.note && dto.note.length >= 3)) throw new BadRequestException('اكتب سبب الرفض');
      p.status = dto.decision === 'approve' ? 'approved' : 'rejected';
      p.decidedByName = a.fullName;
      p.decidedAt = new Date().toISOString();
      p.decisionNote = dto.note ?? null;
      c.penalties = [...c.penalties];
      c.log = [...c.log, logEntry(`${p.status === 'approved' ? 'اعتماد' : 'رفض'} جزاء بمبلغ ${p.amount}`, a.fullName, dto.note ?? null)];
      await em.save(c);
    });
    return this.get(a, id);
  }

  async kpi(a: OrgUser, id: string, dto: KpiReadingDto) {
    if (!can(a, P.contracts)) throw new ForbiddenException('لا تملك صلاحية إدارة العقود');
    await this.db.transaction(async (em) => {
      const c = await this.lock(em, a.organizationId, id);
      if (!LIVE_CONTRACT.includes(c.status) && c.status !== 'closed') throw new ConflictException('تُسجل القراءات على عقد ساري');
      const sla = c.slas.find((s) => s.key === dto.slaKey);
      if (!sla) throw new BadRequestException('المؤشر غير موجود في العقد');
      const met = sla.direction === 'min' ? dto.value >= sla.target : dto.value <= sla.target;
      c.kpiReadings = [...c.kpiReadings.filter((r) => !(r.slaKey === sla.key && r.period === dto.period)),
        { slaKey: sla.key, period: dto.period, value: dto.value, met, note: dto.note ?? null, byName: a.fullName, at: new Date().toISOString() }];
      c.log = [...c.log, logEntry(`قراءة «${sla.name}» لشهر ${dto.period}`, a.fullName, `${dto.value} ${sla.unit} (${met ? 'محقق' : 'غير محقق'})`)];
      await em.save(c);
    });
    return this.get(a, id);
  }

  async releaseGuarantee(a: OrgUser, id: string, gKey: string) {
    if (!can(a, P.contractsApprove)) throw new ForbiddenException('الإفراج عن الضمانات لمن يعتمد العقود');
    await this.db.transaction(async (em) => {
      const c = await this.lock(em, a.organizationId, id);
      const g = c.guarantees.find((x) => x.key === gKey);
      if (!g || g.released) throw new NotFoundException('الضمان غير موجود أو أُفرج عنه');
      g.released = true;
      c.guarantees = [...c.guarantees];
      c.log = [...c.log, logEntry(`الإفراج عن ${GUARANTEE_KINDS[g.kind]}`, a.fullName, g.ref)];
      await em.save(c);
    });
    return this.get(a, id);
  }

  // ---------------- المرفقات ----------------

  async addFile(a: OrgUser, id: string, file: Express.Multer.File) {
    if (!can(a, P.contracts)) throw new ForbiddenException('لا تملك صلاحية إدارة العقود');
    const c = await this.find(a.organizationId, id);
    if (['cancelled'].includes(c.status)) throw new ConflictException('العقد ملغى');
    if (c.attachments.length >= MAX_FILES) throw new BadRequestException(`الحد الأعلى ${MAX_FILES} مرفقات`);
    const saved = await this.files.save(`${c.organizationId}/procurement`, file, 'المرفق');
    const att: ItemFile = { key: saved.key, name: saved.name, mime: saved.mime, size: file.size, at: new Date().toISOString(), byName: a.fullName };
    await this.db.query(`UPDATE pr_contracts SET attachments = attachments || $3::jsonb, updated_at = now() WHERE id = $1 AND organization_id = $2`, [c.id, c.organizationId, JSON.stringify([att])]);
    return this.get(a, id);
  }

  async removeFile(a: OrgUser, id: string, fkey: string) {
    if (!can(a, P.contracts)) throw new ForbiddenException('لا تملك صلاحية إدارة العقود');
    const removed = await this.db.transaction(async (em) => {
      const c = await this.lock(em, a.organizationId, id);
      if (!['draft', 'returned'].includes(c.status)) throw new ConflictException('لا تُحذف مرفقات العقد بعد إرساله للاعتماد');
      const att = c.attachments.find((x) => x.key.endsWith(`/${fkey}`));
      if (!att) throw new NotFoundException('المرفق غير موجود');
      c.attachments = c.attachments.filter((x) => x !== att);
      await em.save(c);
      return att.key;
    });
    // حذف الملف بعد تثبيت المعاملة، فلا يبقى سجل بلا ملف
    await this.files.remove(removed).catch(() => undefined);
    return this.get(a, id);
  }

  async file(a: OrgUser, id: string, fkey: string) {
    if (!this.canRead(a)) throw new ForbiddenException('لا تملك صلاحية عرض العقود');
    return this.openFile(await this.find(a.organizationId, id), fkey);
  }

  private openFile(c: PrContract, fkey: string) {
    const att = c.attachments.find((x) => x.key.endsWith(`/${fkey}`));
    if (!att) throw new NotFoundException('المرفق غير موجود');
    return { stream: this.files.open(att.key), mime: att.mime, name: att.name };
  }

  // ---------------- العرض ----------------

  private alerts(c: PrContract, used: number) {
    const out: string[] = [];
    if (!LIVE_CONTRACT.includes(c.status)) return out;
    const today = prToday();
    if (c.endsOn < today) out.push('انتهت مدة العقد ولم يُغلق');
    else if (c.endsOn <= addDays(today, c.alertDays)) out.push(`ينتهي العقد في ${c.endsOn}`);
    const pct = c.value ? (used / c.value) * 100 : 0;
    if (pct >= c.alertPct) out.push(`بلغ المستخدم ${Math.round(pct)}% من سقف العقد`);
    for (const g of c.guarantees) if (!g.released && g.expiresOn && g.expiresOn <= addDays(today, 30)) out.push(`${GUARANTEE_KINDS[g.kind]} ${g.ref ?? ''} ينتهي في ${g.expiresOn}`.replace('  ', ' '));
    return out;
  }

  async list(a: OrgUser, q: ContractListQueryDto) {
    if (!this.canRead(a)) throw new ForbiddenException('لا تملك صلاحية عرض العقود');
    const org = a.organizationId;
    const rows: (PrContract & { supplierName: string; supplierNo: number; used: number })[] = await this.db.query(
      `SELECT c.id, c.contract_no AS "contractNo", c.kind, c.title, c.reference, c.supplier_id AS "supplierId", s.name AS "supplierName", s.supplier_no AS "supplierNo",
              to_char(c.starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(c.ends_on, 'YYYY-MM-DD') AS "endsOn", c.value::float AS value, c.status, c.alert_pct AS "alertPct", c.alert_days AS "alertDays",
              c.guarantees, c.pt_contract_id AS "ptContractId",
              COALESCE((SELECT SUM(o.total) FROM pr_orders o WHERE o.organization_id = c.organization_id AND o.contract_id = c.id AND o.status = ANY($7)), 0)::float AS used
         FROM pr_contracts c JOIN pr_suppliers s ON s.id = c.supplier_id AND s.organization_id = c.organization_id
        WHERE c.organization_id = $1 AND ($2::text IS NULL OR c.status = $2) AND ($3::uuid IS NULL OR c.supplier_id = $3::uuid) AND ($4::uuid IS NULL OR c.pt_contract_id = $4::uuid)
          AND ($5::text IS NULL OR c.title ILIKE '%' || $5 || '%' OR s.name ILIKE '%' || $5 || '%' OR c.reference ILIKE '%' || $5 || '%' OR 'CT-' || LPAD(c.contract_no::text, 4, '0') ILIKE '%' || $5 || '%')
          AND ($6::boolean IS NOT TRUE OR c.status IN ('active', 'suspended'))
        ORDER BY c.contract_no DESC`,
      [org, q.status || null, q.supplier || null, q.ptContract || null, q.q?.trim() || null, q.view === 'alerts', COUNTED_ORDER]);
    const out = rows.map((r) => {
      const alerts = this.alerts(r as PrContract, r.used);
      return {
        id: r.id, code: contractCode(r.contractNo), kind: r.kind, kindLabel: CONTRACT_KINDS[r.kind], title: r.title, reference: r.reference, supplierId: r.supplierId,
        supplierName: r.supplierName, supplierCode: supplierCode(r.supplierNo), startsOn: r.startsOn, endsOn: r.endsOn, value: r.value, used: r2(r.used),
        remaining: r2(r.value - r.used), usedPct: r.value ? Math.round((r.used / r.value) * 1000) / 10 : 0, status: r.status, statusLabel: CONTRACT_STATUS[r.status],
        joint: !!r.ptContractId, alerts,
      };
    });
    return q.view === 'alerts' ? out.filter((r) => r.alerts.length) : out;
  }

  async get(a: OrgUser, id: string) {
    if (!this.canRead(a)) throw new ForbiddenException('لا تملك صلاحية عرض العقود');
    const org = a.organizationId;
    const c = await this.find(org, id);
    const used = await this.used(org, c.id);
    const [sup, orders, invoices, evals, pt, fin, labels, names] = await Promise.all([
      this.db.getRepository(PrSupplier).findOneOrFail({ where: { id: c.supplierId, organizationId: org } }),
      this.db.query(
        `SELECT id, order_no AS "orderNo", title, total::float AS total, status, to_char(delivery_date, 'YYYY-MM-DD') AS "deliveryDate" FROM pr_orders
          WHERE organization_id = $1 AND contract_id = $2 ORDER BY order_no DESC`, [org, c.id]),
      this.db.query(
        `SELECT i.id, i.kind, i.invoice_no AS "invoiceNo", i.supplier_invoice_no AS "supplierInvoiceNo", i.total::float AS total, i.status, i.paid_amount::float AS paid
           FROM pr_invoices i JOIN pr_orders o ON o.id = i.order_id AND o.organization_id = i.organization_id
          WHERE i.organization_id = $1 AND o.contract_id = $2 AND i.status NOT IN ('draft', 'cancelled', 'rejected') ORDER BY i.invoice_no DESC`, [org, c.id]),
      this.db.query(
        `SELECT id, eval_no AS "evalNo", total::float AS total, grade, status, to_char(period_to, 'YYYY-MM-DD') AS "periodTo" FROM pr_supplier_evaluations
          WHERE organization_id = $1 AND contract_id = $2 ORDER BY eval_no DESC`, [org, c.id]),
      c.ptContractId ? this.db.query(
        `SELECT k.id, k.number, k.title, k.status, p.name AS "partnerName" FROM pt_contracts k LEFT JOIN pt_partners p ON p.id = k.partner_id AND p.organization_id = k.organization_id
          WHERE k.organization_id = $1 AND k.id = $2`, [org, c.ptContractId]).catch(() => []) : [],
      this.sc.financeLabels(org, [c.budgetLineId], [c.fundingBatchId]),
      this.sc.orgLabels(org, [], [c.projectId]),
      this.core.userNames(org, [c.createdById, c.approvedById].filter((x): x is string => !!x)),
    ]);
    void names;
    const risks = c.riskIds.length ? ((await this.riskLookup()?.listRisks(org).catch(() => [])) ?? []).filter((r) => c.riskIds.includes(r.id)) : [];
    const invoiced = r2(invoices.reduce((t: number, i: { kind: string; total: number; status: string }) => t + (['posted', 'partial', 'paid'].includes(i.status) ? (i.kind === 'credit_note' ? -i.total : i.total) : 0), 0));
    const paid = r2(invoices.reduce((t: number, i: { paid: number }) => t + i.paid, 0));
    const approvedPenalties = r2(c.penalties.filter((p) => p.status === 'approved').reduce((t, p) => t + p.amount, 0));
    const mine = (by: string) => !a.isSuperadmin && by === a.id;
    const editable = ['draft', 'returned'].includes(c.status) && can(a, P.contracts);
    const live = LIVE_CONTRACT.includes(c.status);
    const line = c.budgetLineId ? fin.lines.get(c.budgetLineId) : null;
    const batch = c.fundingBatchId ? fin.batches.get(c.fundingBatchId) : null;
    return {
      ...c, code: contractCode(c.contractNo), kindLabel: CONTRACT_KINDS[c.kind], statusLabel: CONTRACT_STATUS[c.status],
      supplier: { id: sup.id, code: supplierCode(sup.supplierNo), name: sup.name, grade: (sup as PrSupplier & { grade?: string | null }).grade ?? null },
      used, remaining: r2(c.value - used), usedPct: c.value ? Math.round((used / c.value) * 1000) / 10 : 0, invoiced, paid, approvedPenalties,
      alerts: this.alerts(c, used),
      orders: orders.map((o: { orderNo: number; status: string }) => ({ ...o, code: orderCode(o.orderNo), statusLabel: ORDER_STATUS[o.status as keyof typeof ORDER_STATUS] })),
      invoices: invoices.map((i: { kind: string; invoiceNo: number }) => ({ ...i, code: `${i.kind === 'credit_note' ? 'CRN' : 'INV'}-${String(i.invoiceNo).padStart(4, '0')}` })),
      evaluations: evals.map((e: { evalNo: number }) => ({ ...e, code: `EV-${String(e.evalNo).padStart(4, '0')}` })),
      partnership: pt[0] ?? null, risks,
      project: c.projectId ? labels.projects.get(c.projectId) ?? null : null,
      budgetLine: line ? `${line.budgetCode} · ${line.name}` : null, fundingBatch: batch ? `دفعة ${batch.batchNo} · ${batch.targetName}` : null,
      penaltyBasis: PENALTY_BASIS, guaranteeKinds: GUARANTEE_KINDS, amendmentKinds: AMENDMENT_KINDS,
      can: {
        edit: editable, submit: editable, decide: c.status === 'pending' && can(a, P.contractsApprove) && !mine(c.createdById ?? '') && (a.isSuperadmin || !c.editorIds.includes(a.id)),
        cancel: ['draft', 'returned', 'pending'].includes(c.status) && (can(a, P.contracts) || can(a, P.contractsApprove)),
        suspend: c.status === 'active' && can(a, P.contractsApprove), resume: c.status === 'suspended' && can(a, P.contractsApprove),
        close: live && can(a, P.contractsApprove), terminate: live && can(a, P.contractsApprove),
        amend: live && can(a, P.contracts) && !c.amendments.some((x) => x.status === 'pending'),
        decideAmendment: can(a, P.contractsApprove), penalty: (live || c.status === 'closed') && can(a, P.contracts), decidePenalty: can(a, P.contractsApprove),
        kpi: (live || c.status === 'closed') && can(a, P.contracts) && c.slas.length > 0, files: c.status !== 'cancelled' && can(a, P.contracts),
        release: can(a, P.contractsApprove),
      },
      me: a.id,
    };
  }

  /** القوائم المساعدة لنموذج العقد: الموردون المعتمدون وعقود الشراكة والمخاطر والأصناف */
  async lookups(a: OrgUser) {
    if (!this.canRead(a)) throw new ForbiddenException('لا تملك صلاحية عرض العقود');
    const org = a.organizationId;
    const [suppliers, ptContracts, items, risks, projects] = await Promise.all([
      this.db.query(`SELECT id, name, supplier_no AS "supplierNo" FROM pr_suppliers WHERE organization_id = $1 AND status = 'approved' ORDER BY name`, [org]),
      this.db.query(
        `SELECT k.id, k.number, k.title, k.status, p.name AS "partnerName" FROM pt_contracts k LEFT JOIN pt_partners p ON p.id = k.partner_id AND p.organization_id = k.organization_id
          WHERE k.organization_id = $1 AND k.status NOT IN ('cancelled', 'draft') ORDER BY k.number DESC`, [org]).catch(() => []),
      this.db.query(`SELECT id, name, code FROM pr_items WHERE organization_id = $1 AND is_active ORDER BY name`, [org]).catch(() => []),
      canRisk(a) ? this.riskLookup()?.listRisks(org).catch(() => []) ?? [] : [],
      this.db.query(
        `SELECT a.id, a.name, 'PRJ-' || LPAD(p.project_no::text, 4, '0') AS code FROM activities a JOIN project_profiles p ON p.activity_id = a.id
          WHERE a.organization_id = $1 ORDER BY p.project_no`, [org]).catch(() => []),
    ]);
    const budget = await this.sc.budgetOptions(org, Number(prToday().slice(0, 4)));
    return {
      kinds: CONTRACT_KINDS, status: CONTRACT_STATUS, guaranteeKinds: GUARANTEE_KINDS, penaltyBasis: PENALTY_BASIS, amendmentKinds: AMENDMENT_KINDS,
      suppliers: suppliers.map((s: { supplierNo: number }) => ({ ...s, code: supplierCode(s.supplierNo) })), ptContracts, items,
      risks: (risks as { id: string; code: string; title: string; levelLabel?: string }[]).map((r) => ({ id: r.id, code: r.code, title: r.title, level: r.levelLabel ?? null })),
      projects, budgetLines: budget.lines, funding: budget.funding,
    };
  }

  /** العقود السارية للمورد لربط تعميد بها */
  async forSupplier(a: OrgUser, supplierId: string) {
    if (!this.canRead(a)) throw new ForbiddenException('لا تملك صلاحية عرض العقود');
    const sup = await this.db.getRepository(PrSupplier).findOne({ where: { id: supplierId, organizationId: a.organizationId } });
    if (!sup) throw new NotFoundException('المورد غير موجود');
    const rows = await this.list(a, { supplier: supplierId, status: 'active' });
    const today = prToday();
    return rows.filter((r) => r.startsOn <= today && r.endsOn >= today);
  }

  // ---------------- بوابة المورد ----------------

  async portalList(p: SupplierPortalUser) {
    if (p.supplierStatus !== 'approved') throw new ForbiddenException('تظهر العقود بعد اعتماد حسابكم مورّدًا');
    const rows: { id: string; contractNo: number; kind: keyof typeof CONTRACT_KINDS; title: string; startsOn: string; endsOn: string; value: number; status: ContractStatus }[] = await this.db.query(
      `SELECT id, contract_no AS "contractNo", kind, title, to_char(starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(ends_on, 'YYYY-MM-DD') AS "endsOn", value::float AS value, status
         FROM pr_contracts WHERE organization_id = $1 AND supplier_id = $2 AND share_with_supplier AND status IN ('active', 'suspended', 'closed', 'terminated') ORDER BY contract_no DESC`,
      [p.organizationId, p.supplierId]);
    return rows.map((r) => ({ ...r, code: contractCode(r.contractNo), kindLabel: CONTRACT_KINDS[r.kind], statusLabel: CONTRACT_STATUS[r.status] }));
  }

  async portalGet(p: SupplierPortalUser, id: string) {
    if (p.supplierStatus !== 'approved') throw new ForbiddenException('تظهر العقود بعد اعتماد حسابكم مورّدًا');
    const c = await this.db.getRepository(PrContract).findOne({ where: { id, organizationId: p.organizationId, supplierId: p.supplierId, shareWithSupplier: true } });
    if (!c || !['active', 'suspended', 'closed', 'terminated'].includes(c.status)) throw new NotFoundException('العقد غير موجود');
    const used = await this.used(p.organizationId, c.id);
    return {
      id: c.id, code: contractCode(c.contractNo), kind: c.kind, kindLabel: CONTRACT_KINDS[c.kind], reference: c.reference, title: c.title, scope: c.scope, terms: c.terms,
      startsOn: c.startsOn, endsOn: c.endsOn, value: c.value, used, remaining: r2(c.value - used), status: c.status, statusLabel: CONTRACT_STATUS[c.status], version: c.version,
      prices: c.prices.map((x) => ({ description: x.description, unit: x.unit, unitPrice: x.unitPrice, maxQty: x.maxQty })),
      guarantees: c.guarantees.map((g) => ({ kind: GUARANTEE_KINDS[g.kind], amount: g.amount, ref: g.ref, expiresOn: g.expiresOn, released: g.released })),
      slas: c.slas, kpiReadings: c.kpiReadings.map((r) => ({ slaKey: r.slaKey, period: r.period, value: r.value, met: r.met })),
      penalties: c.penalties.filter((x) => x.status === 'approved').map((x) => ({ date: x.date, amount: x.amount, reason: x.reason, rule: x.ruleName })),
      amendments: c.amendments.filter((x) => x.status === 'approved').map((x) => ({ no: x.no, kind: AMENDMENT_KINDS[x.kind], reason: x.reason, at: x.decidedAt })),
      requiredDocs: c.requiredDocs, attachments: c.attachments.map((f) => ({ key: f.key, name: f.name, size: f.size })),
    };
  }

  async portalFile(p: SupplierPortalUser, id: string, fkey: string) {
    await this.portalGet(p, id);
    return this.openFile(await this.find(p.organizationId, id), fkey);
  }
}
