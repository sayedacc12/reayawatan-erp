import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FundingBatch, FundingGateway, net } from './funding.gateway';
import { ProjectsService, STATUS_AR } from './projects.service';
import { SupportService } from './support.service';
import { TransfersService } from './transfers.service';

const r2 = (n: number) => Math.round(n * 100) / 100;
const FUNDING_AR: Record<string, string> = { restricted: 'مقيد', unrestricted: 'غير مقيد', operational: 'تشغيلي', endowment: 'وقف' };
const MODE_AR: Record<string, string> = { beneficiaries: 'على المستفيدين', general: 'صرف عام' };
const ALLOC_AR: Record<string, string> = { reserved: 'محجوز', partial: 'مصروف جزئيًا', spent: 'مخصوم', released: 'ملغى الحجز' };
const PAY_AR: Record<string, string> = { pending: 'قيد التنفيذ', paid: 'مصروف', rejected: 'مرفوض' };
const METHOD_AR: Record<string, string> = { voucher: 'سند صرف', invoice: 'فاتورة' };

type Col = { key: string; label: string; type?: 'money' | 'number' | 'date' | 'percent' | 'text' };
export const REPORTS: { key: string; name: string; description: string; dated?: boolean }[] = [
  { key: 'financial', name: 'الموقف المالي للمشاريع', description: 'الميزانية والدعم الوارد والمحجوز والمخصوم والمتاح ونسبة الإنفاق لكل مشروع' },
  { key: 'hierarchy', name: 'المشاريع حسب المحاور والبرامج', description: 'إجماليات كل محور وبرنامج من الدعم والصرف وعدد المشاريع' },
  { key: 'donors', name: 'الدعم حسب الداعم', description: 'دعم كل داعم على كل مشروع: الوارد والمحجوز والمخصوم والمتاح' },
  { key: 'beneficiaries', name: 'المستفيدون المخدومون', description: 'تحميلات الدعم على طلبات المستفيدين وما صُرف منها', dated: true },
  { key: 'payments', name: 'طلبات الصرف والصرف المالي', description: 'طلبات الصرف بحالتها وأرقام سندات الصرف والفواتير', dated: true },
  { key: 'transfers', name: 'سجل المناقلات', description: 'المبالغ المنقولة بين المشاريع لنفس الداعم', dated: true },
  { key: 'amendments', name: 'تعديلات فرص التبرع', description: 'التعديلات المعتمدة وقيود التسوية', dated: true },
  { key: 'approvals', name: 'حالة اعتماد المشاريع', description: 'حالة كل مشروع في مراحل الاعتماد وتواريخها' },
];

/** لوحة المعلومات، صفحة المشروع، إجمالي المشاريع، والتقارير */
@Injectable()
export class InsightsService {
  constructor(
    private readonly db: DataSource,
    private readonly projects: ProjectsService,
    private readonly support: SupportService,
    private readonly transfers: TransfersService,
    private readonly funding: FundingGateway,
  ) {}

  /** صف لكل مشروع بإجمالياته (أساس اللوحة وصفحة الإجمالي والتقارير) */
  async rows(actor: OrgUser) {
    const org = actor.organizationId;
    const [tree, batches, alloc, reqs] = await Promise.all([
      this.projects.tree(actor),
      this.funding.listBatches(org, {}),
      this.db.query(
        `SELECT activity_id AS id, SUM(amount - spent_amount - released_amount)::float AS reserved, SUM(spent_amount)::float AS spent,
                COUNT(DISTINCT beneficiary_id)::int AS served
         FROM project_allocations WHERE organization_id = $1 GROUP BY activity_id`, [org]),
      this.db.query(
        `SELECT project_id AS id, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
                COUNT(*) FILTER (WHERE status IN ('in_progress', 'returned'))::int AS open
         FROM beneficiary_requests WHERE organization_id = $1 GROUP BY project_id`, [org]),
    ]);
    const byId = new Map(tree.map((t) => [t.id, t]));
    const allocBy = new Map<string, { reserved: number; spent: number; served: number }>(alloc.map((a: { id: string }) => [a.id, a]));
    const reqBy = new Map<string, { total: number; approved: number; open: number }>(reqs.map((a: { id: string }) => [a.id, a]));
    const batchesBy = new Map<string, FundingBatch[]>();
    for (const b of batches) if (b.activityId) batchesBy.set(b.activityId, [...(batchesBy.get(b.activityId) ?? []), b]);

    const projects = tree.filter((t) => t.level === 'project').map((p) => {
      const program = byId.get(p.parentId!);
      const axis = program ? byId.get(program.parentId!) : undefined;
      const own = batchesBy.get(p.id) ?? [];
      const donors = new Map<string, { id: string; name: string; amount: number }>();
      for (const b of own) {
        const d = donors.get(b.donorId) ?? { id: b.donorId, name: b.donorName ?? '—', amount: 0 };
        d.amount = r2(d.amount + b.amount - b.transferredAmount);
        donors.set(b.donorId, d);
      }
      const a = allocBy.get(p.id);
      return {
        id: p.id, code: p.code!, name: p.name, isActive: p.isActive,
        axisId: axis?.id ?? null, axisName: axis?.name ?? '—', programId: program?.id ?? null, programName: program?.name ?? '—',
        fundingType: p.fundingType!, zakatEligible: p.zakatEligible!, approvalStatus: p.approvalStatus!, spendingMode: p.spendingMode!,
        currentStage: p.currentStage, managerName: p.managerName, startDate: p.startDate, endDate: p.endDate,
        budget: p.budget ?? null, targetBeneficiaries: p.targetBeneficiaries ?? null, services: p.services.length,
        requests: reqBy.get(p.id) ?? { total: 0, approved: 0, open: 0 }, served: a?.served ?? 0,
        funds: r2(own.reduce((s, b) => s + b.amount - b.transferredAmount, 0)),
        available: r2(own.reduce((s, b) => s + Math.max(0, net(b)), 0)),
        reserved: r2(a?.reserved ?? 0), spent: r2(a?.spent ?? 0),
        batchCount: own.length, donors: [...donors.values()],
      };
    });
    const programIds = new Set(tree.filter((t) => t.level === 'program').map((t) => t.id));
    const programFunds = batches.filter((b) => b.activityId && programIds.has(b.activityId)).map((b) => ({
      batchId: b.id, batchNo: b.batchNo, programId: b.activityId!, programName: byId.get(b.activityId!)?.name ?? '—',
      donorName: b.donorName, amount: r2(b.amount - b.transferredAmount), net: net(b),
    }));
    return { projects, programFunds, batches };
  }

  async dashboard(actor: OrgUser) {
    const { projects, programFunds } = await this.rows(actor);
    const monthly: { month: string; activityId: string; amount: number }[] = await this.db.query(
      `SELECT to_char(paid_on, 'YYYY-MM') AS month, activity_id AS "activityId", SUM(amount)::float AS amount
       FROM project_payment_requests WHERE organization_id = $1 AND status = 'paid' AND paid_on >= (date_trunc('month', now()) - interval '11 months')
       GROUP BY 1, 2 ORDER BY 1`, [actor.organizationId]);
    const [pending] = await this.db.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::float AS amount FROM project_payment_requests WHERE organization_id = $1 AND status = 'pending'`,
      [actor.organizationId]);
    return { projects, programFunds, monthly, pendingPayments: pending };
  }

  async overview(actor: OrgUser) {
    return (await this.rows(actor)).projects;
  }

  /** صفحة المشروع: التفاصيل المالية والمستفيدون والدفعات والداعمون والقيود، وكلها بروابط */
  async projectPage(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const detail = await this.projects.detail(actor, id);
    const [requests, batches, allocations, payments, transfers, amendments, entries] = await Promise.all([
      this.db.query(
        `SELECT r.id, r.request_no AS "requestNo", r.status, r.estimated_cost::float AS "estimatedCost", r.support_percent::float AS "supportPercent",
                r.services, r.created_at AS "createdAt", b.id AS "beneficiaryId", b.full_name AS "beneficiaryName", b.file_no AS "fileNo",
                COALESCE((SELECT SUM(amount - released_amount) FROM project_allocations al WHERE al.request_id = r.id), 0)::float AS covered,
                COALESCE((SELECT SUM(spent_amount) FROM project_allocations al WHERE al.request_id = r.id), 0)::float AS spent
         FROM beneficiary_requests r JOIN beneficiaries b ON b.id = r.beneficiary_id
         WHERE r.organization_id = $1 AND r.project_id = $2 ORDER BY r.created_at DESC`, [org, id]),
      this.funding.listBatches(org, { activityIds: [id, detail.program.id] }),
      this.support.allocations(actor, { activityId: id }),
      this.support.payments(actor, { activityId: id }),
      this.transfers.listTransfers(actor, id),
      this.transfers.listAmendments(actor, id),
      this.funding.listEntries(org, { activityId: id }).catch(() => []),
    ]);
    const own = batches.filter((b) => b.activityId === id);
    const donors = new Map<string, { id: string; name: string | null; amount: number; net: number; opportunities: { id: string; no: number | null }[] }>();
    for (const b of own) {
      const d = donors.get(b.donorId) ?? { id: b.donorId, name: b.donorName, amount: 0, net: 0, opportunities: [] };
      d.amount = r2(d.amount + b.amount - b.transferredAmount);
      d.net = r2(d.net + net(b));
      if (!d.opportunities.some((o) => o.id === b.opportunityId)) d.opportunities.push({ id: b.opportunityId, no: b.opportunityNo });
      donors.set(b.donorId, d);
    }
    const sum = (xs: { [k: string]: unknown }[], k: string) => r2(xs.reduce((s, x) => s + Number(x[k] ?? 0), 0));
    const reserved = r2(allocations.reduce((s, a) => s + (a.remaining as number), 0));
    return {
      ...detail,
      summary: {
        funds: r2(own.reduce((s, b) => s + b.amount - b.transferredAmount, 0)),
        available: r2(own.reduce((s, b) => s + Math.max(0, net(b)), 0)),
        reserved, spent: sum(allocations, 'spentAmount'),
        pendingPayments: sum(payments.filter((p) => p.status === 'pending'), 'amount'),
        transfersIn: sum(transfers.filter((t) => t.targetActivityId === id), 'amount'),
        transfersOut: sum(transfers.filter((t) => t.sourceActivityId === id), 'amount'),
        requests: requests.length, served: new Set(allocations.map((a) => a.beneficiaryId).filter(Boolean)).size,
      },
      requests,
      batches: batches.map((b) => ({ ...b, net: net(b), level: b.activityId === id ? 'project' : 'program' })),
      donors: [...donors.values()],
      allocations, payments, transfers, amendments, entries,
    };
  }

  // ---------------- التقارير ----------------

  async report(actor: OrgUser, key: string, from?: string, to?: string) {
    const inRange = (d: string | Date | null | undefined) => {
      if (!d) return !from && !to;
      const s = (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
      return (!from || s >= from) && (!to || s <= to);
    };
    const def = REPORTS.find((r) => r.key === key);
    if (!def) throw new BadRequestException('التقرير غير موجود');
    let columns: Col[] = [];
    let rows: Record<string, unknown>[] = [];
    if (['financial', 'hierarchy', 'donors', 'approvals'].includes(key)) {
      const { projects } = await this.rows(actor);
      if (key === 'financial') {
        columns = [
          { key: 'code', label: 'رقم المشروع' }, { key: 'name', label: 'المشروع' }, { key: 'programName', label: 'البرنامج' },
          { key: 'type', label: 'النوع' }, { key: 'budget', label: 'الميزانية', type: 'money' }, { key: 'funds', label: 'الدعم الوارد', type: 'money' },
          { key: 'reserved', label: 'محجوز', type: 'money' }, { key: 'spent', label: 'مخصوم', type: 'money' },
          { key: 'available', label: 'المتاح', type: 'money' }, { key: 'utilization', label: 'نسبة الإنفاق', type: 'percent' },
        ];
        rows = projects.map((p) => ({ ...p, type: FUNDING_AR[p.fundingType] + (p.zakatEligible ? ' (زكاة)' : ''), utilization: p.funds ? r2((p.spent / p.funds) * 100) : 0 }));
      } else if (key === 'hierarchy') {
        columns = [
          { key: 'axisName', label: 'المحور' }, { key: 'programName', label: 'البرنامج' }, { key: 'projects', label: 'عدد المشاريع', type: 'number' },
          { key: 'approved', label: 'المعتمدة', type: 'number' }, { key: 'funds', label: 'الدعم الوارد', type: 'money' },
          { key: 'reserved', label: 'محجوز', type: 'money' }, { key: 'spent', label: 'مخصوم', type: 'money' }, { key: 'served', label: 'المستفيدون', type: 'number' },
        ];
        const groups = new Map<string, Record<string, number | string>>();
        for (const p of projects) {
          const k = `${p.axisName}|${p.programName}`;
          const g = groups.get(k) ?? { axisName: p.axisName, programName: p.programName, projects: 0, approved: 0, funds: 0, reserved: 0, spent: 0, served: 0 };
          g.projects = (g.projects as number) + 1;
          g.approved = (g.approved as number) + (p.approvalStatus === 'approved' ? 1 : 0);
          for (const f of ['funds', 'reserved', 'spent', 'served'] as const) g[f] = r2((g[f] as number) + p[f]);
          groups.set(k, g);
        }
        rows = [...groups.values()].sort((a, b) => String(a.axisName).localeCompare(String(b.axisName), 'ar'));
      } else if (key === 'donors') {
        const { batches } = await this.rows(actor);
        const names = new Map(projects.map((p) => [p.id, p.name]));
        columns = [
          { key: 'donorName', label: 'الداعم' }, { key: 'projectName', label: 'المشروع / البرنامج' }, { key: 'batches', label: 'عدد الدفعات', type: 'number' },
          { key: 'amount', label: 'الدعم الوارد', type: 'money' }, { key: 'reserved', label: 'محجوز', type: 'money' },
          { key: 'spent', label: 'مخصوم', type: 'money' }, { key: 'net', label: 'المتاح', type: 'money' },
        ];
        const tree = new Map((await this.projects.tree(actor)).map((t) => [t.id, t.name]));
        const groups = new Map<string, Record<string, number | string>>();
        for (const b of batches) {
          const k = `${b.donorId}|${b.activityId}`;
          const g = groups.get(k) ?? { donorName: b.donorName ?? '—', projectName: names.get(b.activityId ?? '') ?? tree.get(b.activityId ?? '') ?? 'تشغيلي عام', batches: 0, amount: 0, reserved: 0, spent: 0, net: 0 };
          g.batches = (g.batches as number) + 1;
          g.amount = r2((g.amount as number) + b.amount - b.transferredAmount);
          g.reserved = r2((g.reserved as number) + b.reservedAmount);
          g.spent = r2((g.spent as number) + b.spentAmount);
          g.net = r2((g.net as number) + net(b));
          groups.set(k, g);
        }
        rows = [...groups.values()];
      } else {
        columns = [
          { key: 'code', label: 'رقم المشروع' }, { key: 'name', label: 'المشروع' }, { key: 'programName', label: 'البرنامج' },
          { key: 'status', label: 'حالة الاعتماد' }, { key: 'stage', label: 'المرحلة الحالية' }, { key: 'type', label: 'النوع' },
          { key: 'mode', label: 'طريقة الصرف' }, { key: 'managerName', label: 'مدير المشروع' },
        ];
        rows = projects.map((p) => ({
          ...p, status: STATUS_AR[p.approvalStatus], stage: p.currentStage?.name ?? '—',
          type: FUNDING_AR[p.fundingType] + (p.zakatEligible ? ' (زكاة)' : ''), mode: MODE_AR[p.spendingMode], managerName: p.managerName ?? '—',
        }));
      }
    } else if (key === 'beneficiaries') {
      columns = [
        { key: 'allocationNo', label: 'رقم التحميل', type: 'number' }, { key: 'createdAt', label: 'التاريخ', type: 'date' },
        { key: 'beneficiaryName', label: 'المستفيد' }, { key: 'requestNo', label: 'رقم الطلب', type: 'number' }, { key: 'projectName', label: 'المشروع' },
        { key: 'donorName', label: 'الداعم' }, { key: 'batchNo', label: 'الدفعة' }, { key: 'amount', label: 'المحمّل', type: 'money' },
        { key: 'spentAmount', label: 'المصروف', type: 'money' }, { key: 'statusLabel', label: 'الحالة' },
      ];
      rows = (await this.support.allocations(actor)).filter((a) => a.kind === 'request' && inRange(a.createdAt as Date))
        .map((a) => ({ ...a, statusLabel: ALLOC_AR[a.status as string] }));
    } else if (key === 'payments') {
      columns = [
        { key: 'requestNo', label: 'رقم طلب الصرف', type: 'number' }, { key: 'createdAt', label: 'تاريخ الطلب', type: 'date' },
        { key: 'projectName', label: 'المشروع' }, { key: 'payeeName', label: 'المستفيد من الصرف' }, { key: 'methodLabel', label: 'الطريقة' },
        { key: 'amount', label: 'المبلغ', type: 'money' }, { key: 'statusLabel', label: 'الحالة' }, { key: 'referenceNo', label: 'رقم السند / الفاتورة' },
        { key: 'paidOn', label: 'تاريخ الصرف', type: 'date' },
      ];
      rows = (await this.support.payments(actor)).filter((p) => inRange((p.paidOn as string) ?? (p.createdAt as Date)))
        .map((p) => ({ ...p, statusLabel: PAY_AR[p.status as string], methodLabel: METHOD_AR[p.method as string] }));
    } else if (key === 'transfers') {
      columns = [
        { key: 'transferNo', label: 'رقم المناقلة', type: 'number' }, { key: 'createdAt', label: 'التاريخ', type: 'date' },
        { key: 'donorName', label: 'الداعم' }, { key: 'sourceName', label: 'من مشروع' }, { key: 'sourceBatchNo', label: 'من دفعة' },
        { key: 'targetName', label: 'إلى مشروع' }, { key: 'targetBatchNo', label: 'الدفعة الجديدة' }, { key: 'amount', label: 'المبلغ', type: 'money' },
        { key: 'reason', label: 'السبب' },
      ];
      rows = (await this.transfers.listTransfers(actor)).filter((t) => inRange(t.createdAt as Date));
    } else if (key === 'amendments') {
      columns = [
        { key: 'amendmentNo', label: 'رقم التعديل', type: 'number' }, { key: 'effectiveDate', label: 'تاريخ السريان', type: 'date' },
        { key: 'donorName', label: 'الداعم' }, { key: 'opportunityNo', label: 'الفرصة' }, { key: 'batchNo', label: 'الدفعة' },
        { key: 'fromProject', label: 'المشروع قبل' }, { key: 'toProject', label: 'المشروع بعد' }, { key: 'amount', label: 'المبلغ', type: 'money' },
        { key: 'acknowledgedByName', label: 'أقر به' },
      ];
      rows = (await this.transfers.listAmendments(actor)).filter((a) => inRange(a.effectiveDate))
        .map((a) => ({ ...a, fromProject: a.before.activityName ?? '—', toProject: a.after.activityName ?? '—' }));
    }
    const totals: Record<string, number> = {};
    for (const c of columns) if (c.type === 'money') totals[c.key] = r2(rows.reduce((s, r) => s + Number(r[c.key] ?? 0), 0));
    return { key, name: def.name, description: def.description, from: from ?? null, to: to ?? null, columns, rows, totals };
  }

  // ---------------- قيود الحذف وإعادة الفتح ----------------

  async hasActiveSupport(org: string, activityId: string, em?: EntityManager) {
    return (await this.support.activeOnProject(org, activityId, em)) > 0;
  }

  async ensureNoSupport(actor: OrgUser, activityId: string) {
    const [row] = await this.db.query('SELECT 1 FROM project_allocations WHERE activity_id = $1 LIMIT 1', [activityId]);
    if (row) throw new ConflictException('على المشروع عمليات دعم مسجلة، لذا أوقفه بدلًا من حذفه');
    const batches = await this.funding.listBatches(actor.organizationId, { activityId });
    if (batches.length) throw new ConflictException('على المشروع دفعات من داعمين، لذا أوقفه بدلًا من حذفه');
  }
}
